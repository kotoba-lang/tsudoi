// tsudoi browser host -- mechanism only.
//
// The application (what posts, comments and votes are, what to fetch, what
// to publish, what the page shows) is the Kotoba module in web/gen. This
// file owns what that module was deliberately not granted:
//
//   * WebSockets to Nostr relays,
//   * the user's signing key,
//   * a cache of verified events, replayed to the guest like a local relay,
//   * the clock, the URL hash and the DOM listeners.
//
// It never decides what an event means. It checks signatures, matches
// events against the filters the guest asked for, and keeps vote registers
// (last writer wins per voter and target) so a changed vote can be reported
// as a change.

import { instantiateKotoba } from "./gen/tsudoi.mjs";
import { reconcileUiDocument } from "./vendor/browser-host.mjs";
import * as nostr from "./vendor/nostr.mjs";
import { toDoc, fromDoc } from "./doc.mjs";

const BUDGETS = Object.freeze({ fuel: 50_000_000, frames: 4096 });
const MAX_CONTENT = 16000;
const MAX_TAGS = 32;
const MAX_CACHE = 5000;
const KEY_STORE = "tsudoi.secret";
const RELAY_STORE = "tsudoi.relays";

const $ = sel => document.querySelector(sel);
const mount = $("#app");
const status = $("#status");

// --- the guest ------------------------------------------------------------
//
// A fresh instance per call: fuel is a per-instance budget that is spent and
// never refilled, and the state is a plain value the host holds in between.

const guest = (name, ...args) => instantiateKotoba({}, BUDGETS)[name](...args);

let state = guest("init");
let dirty = true;

// Wants are recomputed in a microtask after every change, so that a route
// change resets delivery before the next relay message (a macrotask) can be
// delivered against the old route.
let pending = false;
function apply(name, ...args) {
  try {
    state = guest(name, state, ...args);
    dirty = true;
    schedule();
    if (!pending) {
      pending = true;
      queueMicrotask(() => { pending = false; afterUpdate(); });
    }
  } catch (error) {
    console.error(`tsudoi: guest ${name} trapped`, error);
  }
}
const ingest = input => apply("ingest", toDoc(input));

let frame = 0;
function schedule() {
  if (frame) return;
  // A timer, not requestAnimationFrame: a hidden tab never runs rAF, and a
  // page opened in the background would stay blank until it was shown.
  frame = setTimeout(() => {
    frame = 0;
    if (!dirty) return;
    dirty = false;
    try {
      reconcileUiDocument(mount, guest("view", state));
    } catch (error) {
      console.error("tsudoi: view trapped", error);
    }
  }, 16);
}

// --- identity -------------------------------------------------------------

let secret = null;
try { secret = localStorage.getItem(KEY_STORE); } catch {}
if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
  secret = nostr.newSecret();
  try { localStorage.setItem(KEY_STORE, secret); } catch {}
}
let me = nostr.publicOf(secret);
let useExtension = false;

async function sign(template) {
  if (useExtension && window.nostr) return window.nostr.signEvent(template);
  return nostr.signEvent(template, secret);
}

function showIdentity() {
  $("#npub").textContent = nostr.npub(me);
  $("#ext").hidden = !window.nostr;
}

$("#reveal").addEventListener("click", () => {
  const out = $("#nsec");
  out.hidden = !out.hidden;
  out.value = out.hidden ? "" : nostr.nsec(secret);
});
$("#import").addEventListener("click", () => {
  const text = prompt("paste your nsec (it stays in this browser)");
  if (!text) return;
  try {
    secret = nostr.decodeNsec(text);
    localStorage.setItem(KEY_STORE, secret);
    useExtension = false;
    setMe(nostr.publicOf(secret));
  } catch (e) {
    alert("that is not an nsec: " + e.message);
  }
});
$("#ext").addEventListener("click", async () => {
  try {
    const pk = await window.nostr.getPublicKey();
    useExtension = true;
    setMe(pk);
  } catch (e) {
    alert("the extension refused: " + e.message);
  }
});

function setMe(pk) {
  me = pk;
  showIdentity();
  ingest({ type: "me", pubkey: me });
  // my own votes are now someone else's; replay registers under the new id
  resetDelivery();
  deliverFromCache();
}

// --- cache: a local relay -------------------------------------------------

const events = new Map();          // id -> verified event
const votes = new Map();           // `${voter}|${target}` -> reaction event

const voteTarget = e => {
  // NIP-25: the reacted-to event is the last "e" tag.
  for (let i = e.tags.length - 1; i >= 0; i--)
    if (e.tags[i][0] === "e" && /^[0-9a-f]{64}$/.test(e.tags[i][1] || "")) return e.tags[i][1];
  return null;
};

function remember(e) {
  if (events.has(e.id)) return false;
  events.set(e.id, e);
  if (events.size > MAX_CACHE) events.delete(events.keys().next().value);
  persist(e);
  return true;
}

// --- delivery -------------------------------------------------------------
//
// The guest is told about each event once per epoch, and about each vote
// register's current value once. A new epoch (a new route) starts over and
// replays from the cache.

let wants = { epoch: 0, relays: [], filters: [] };
let delivered = new Set();
let deliveredVotes = new Map();

function resetDelivery() {
  delivered = new Set();
  deliveredVotes = new Map();
}

function matches(e, f) {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.tag) {
    const hit = e.tags.some(t => t[0] === f.tag && f.values.includes(t[1]));
    if (!hit) return false;
  }
  return true;
}
const wanted = e => wants.filters.some(f => matches(e, f));

function bounded(e) {
  return {
    type: "event",
    id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind,
    content: e.content.length > MAX_CONTENT ? e.content.slice(0, MAX_CONTENT) : e.content,
    tags: e.tags.slice(0, MAX_TAGS).map(t => t.slice(0, 4).map(x => x.slice(0, 256)))
  };
}

function deliver(e) {
  if (e.kind === 7) return deliverVote(e);
  if (delivered.has(e.id) || !wanted(e)) return;
  delivered.add(e.id);
  ingest(bounded(e));
}

function deliverVote(e) {
  const target = voteTarget(e);
  if (!target) return;
  const key = `${e.pubkey}|${target}`;
  const current = votes.get(key);
  if (!current || current.created_at < e.created_at) votes.set(key, e);
  const latest = votes.get(key);
  if (!wanted(latest)) return;
  const had = deliveredVotes.has(key);
  const old = deliveredVotes.get(key) ?? "";
  if (had && old === latest.content) return;
  deliveredVotes.set(key, latest.content);
  ingest({ type: "vote", target, voter: e.pubkey, had: had ? 1 : 0, old, new: latest.content });
}

function deliverFromCache() {
  const list = [...events.values()].filter(wanted).sort((a, b) => a.created_at - b.created_at);
  for (const e of list) deliver(e);
}

// --- relays ---------------------------------------------------------------

const sockets = new Map();         // url -> {ws, open, queue}
const SUB = "tsudoi";

function relayFilters() {
  return wants.filters.map(f => {
    const out = {};
    if (f.ids) out.ids = f.ids;
    if (f.kinds) out.kinds = f.kinds;
    if (f.tag) out["#" + f.tag] = f.values;
    if (f.limit) out.limit = f.limit;
    return out;
  });
}

function send(relay, msg) {
  const text = JSON.stringify(msg);
  if (relay.open) relay.ws.send(text); else relay.queue.push(text);
}

function connect(url) {
  if (sockets.has(url)) return sockets.get(url);
  const relay = { url, ws: null, open: false, queue: [], backoff: 1000 };
  sockets.set(url, relay);
  const open = () => {
    let ws;
    try { ws = new WebSocket(url); } catch { return; }
    relay.ws = ws;
    ws.onopen = () => {
      relay.open = true;
      relay.backoff = 1000;
      for (const t of relay.queue.splice(0)) ws.send(t);
      subscribe(relay);
      showStatus();
    };
    ws.onmessage = m => onRelayMessage(relay, m.data);
    ws.onclose = () => {
      relay.open = false;
      showStatus();
      if (sockets.get(url) === relay) setTimeout(open, relay.backoff = Math.min(relay.backoff * 2, 60000));
    };
    ws.onerror = () => {};
  };
  open();
  return relay;
}

function subscribe(relay) {
  const filters = relayFilters();
  if (!relay.open) return;
  relay.ws.send(JSON.stringify(["CLOSE", SUB]));
  if (filters.length) relay.ws.send(JSON.stringify(["REQ", SUB, ...filters]));
}

function onRelayMessage(relay, data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (!Array.isArray(msg)) return;
  if (msg[0] === "EVENT" && msg[1] === SUB) {
    const e = msg[2];
    if (events.has(e?.id)) { deliver(events.get(e.id)); return; }
    if (!nostr.verifyEvent(e)) return;
    remember(e);
    deliver(e);
  } else if (msg[0] === "OK" && msg[2] === false) {
    console.warn(`tsudoi: ${relay.url} refused ${msg[1]}: ${msg[3]}`);
  } else if (msg[0] === "NOTICE") {
    console.info(`tsudoi: ${relay.url}: ${msg[1]}`);
  }
}

function syncRelays() {
  const want = new Set(wants.relays);
  for (const [url, relay] of sockets) {
    if (!want.has(url)) {
      sockets.delete(url);
      try { relay.ws?.close(); } catch {}
    }
  }
  for (const url of want) connect(url);
  try { localStorage.setItem(RELAY_STORE, JSON.stringify(wants.relays)); } catch {}
  showStatus();
}

function showStatus() {
  const open = [...sockets.values()].filter(r => r.open).length;
  status.textContent = `${open}/${sockets.size} relays · ${events.size} events cached`;
}

// --- after every update: wants and outbox ---------------------------------

let lastWants = "";
let lastRelays = "";
function afterUpdate() {
  let w;
  try { w = fromDoc(guest("wants", state)); } catch (e) { console.error(e); return; }
  const key = JSON.stringify(w.filters) + "#" + w.epoch;
  const relaysKey = JSON.stringify(w.relays);
  const epochChanged = w.epoch !== wants.epoch;
  wants = w;
  if (relaysKey !== lastRelays) { lastRelays = relaysKey; syncRelays(); }
  if (key !== lastWants) {
    lastWants = key;
    if (epochChanged) resetDelivery();
    deliverFromCache();
    for (const relay of sockets.values()) subscribe(relay);
  }
  drainOutbox();
}

let sending = false;
async function drainOutbox() {
  const outbox = fromDoc(state).outbox;
  if (sending || !outbox.length) return;
  sending = true;
  ingest({ type: "sent" });
  try {
    for (const t of outbox) {
      const signed = await sign({
        kind: t.kind, content: t.content, tags: t.tags,
        created_at: Math.floor(Date.now() / 1000)
      });
      if (!nostr.verifyEvent(signed)) throw new Error("signature did not verify");
      for (const relay of sockets.values()) send(relay, ["EVENT", signed]);
      remember(signed);
      deliver(signed);
    }
  } catch (e) {
    ingest({ type: "notice", text: "could not sign: " + e.message });
  } finally {
    sending = false;
    showStatus();
  }
}

// --- persistence: the cache survives a reload ------------------------------

let db = null;
function openDb() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open("tsudoi", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("events", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
function persist(e) {
  if (!db) return;
  try { db.transaction("events", "readwrite").objectStore("events").put(e); } catch {}
}
function loadCache() {
  return new Promise(resolve => {
    if (!db) return resolve();
    try {
      const req = db.transaction("events").objectStore("events").getAll();
      req.onsuccess = () => {
        // Re-verified: the cache is storage, not authority.
        for (const e of req.result.slice(-MAX_CACHE)) if (nostr.verifyEvent(e)) events.set(e.id, e);
        resolve();
      };
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

// --- DOM events -----------------------------------------------------------

function nominal(node) {
  for (let n = node; n && n !== mount; n = n.parentNode)
    if (n.nodeType === 1 && n.getAttribute("data-k")) return n.getAttribute("data-k");
  return null;
}
for (const kind of ["click", "input"]) {
  mount.addEventListener(kind, event => {
    const target = nominal(event.target);
    if (!target) return;
    const value = typeof event.target.value === "string" ? event.target.value.slice(0, 16000) : "";
    apply("step", target, kind, value);
  });
}
addEventListener("hashchange", () => ingest({ type: "route", hash: location.hash }));
setInterval(() => ingest({ type: "tick", now: Math.floor(Date.now() / 1000) }), 30000);

// --- boot -----------------------------------------------------------------

showIdentity();
ingest({ type: "me", pubkey: me });
ingest({ type: "tick", now: Math.floor(Date.now() / 1000) });
try {
  const saved = JSON.parse(localStorage.getItem(RELAY_STORE) || "null");
  if (Array.isArray(saved) && saved.length) {
    // The guest decides which relays are acceptable; replay them as edits.
    const fresh = fromDoc(state).relays;
    for (const url of saved) if (!fresh.includes(url)) { apply("step", "relay-draft", "input", url); apply("step", "add-relay", "click", ""); }
    for (let i = fromDoc(state).relays.length - 1; i >= 0; i--)
      if (!saved.includes(fromDoc(state).relays[i])) apply("step", `drop-relay:${i}`, "click", "");
  }
} catch {}
ingest({ type: "route", hash: location.hash });
db = await openDb();
await loadCache();
showStatus();
lastWants = "";
afterUpdate();
dirty = true;
schedule();
