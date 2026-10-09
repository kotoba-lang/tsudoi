// Drives the compiled Kotoba guest the way web/host.mjs does, with no network.
import assert from "node:assert/strict";
import { instantiateKotoba } from "../web/gen/tsudoi.mjs";
import { toDoc, fromDoc } from "../web/doc.mjs";

const fresh = () => instantiateKotoba({}, { fuel: 50_000_000, frames: 4096 });
const call = (name, ...a) => fresh()[name](...a);
const H = c => c.repeat(64);
const ME = H("a"), BOB = H("b");

let s = call("init");
const ingest = x => { s = call("ingest", s, toDoc(x)); };
const step = (t, k, v = "") => { s = call("step", s, t, k, v); };
const get = () => fromDoc(s);

ingest({ type: "me", pubkey: ME });
ingest({ type: "tick", now: 1_000_000 });
const post = (id, sub, title, created, author = BOB) => ({
  type: "event", id, pubkey: author, created_at: created, kind: 1,
  content: `${title}\n\nbody of ${title}`,
  tags: [["t", "tsudoi"], ["t", `tsudoi-${sub}`], ["subject", title]]
});
ingest(post(H("1"), "vibecoding", "first", 999_000));
ingest(post(H("2"), "kotoba", "second", 999_500));
ingest({ type: "event", id: H("9"), pubkey: BOB, created_at: 1, kind: 1, content: "plain note", tags: [["t", "tsudoi"]] });
let st = get();
assert.equal(st.posts.length, 2, "two posts, the plain note dropped");
assert.equal(st.posts[0].body, "body of first", "title stripped from body");
assert.deepEqual(st.subs, ["vibecoding", "kotoba"]);

// votes: LWW changes from the host
ingest({ type: "vote", target: H("1"), voter: BOB, had: 0, old: "", new: "+" });
ingest({ type: "vote", target: H("1"), voter: ME, had: 0, old: "", new: "-" });
ingest({ type: "vote", target: H("1"), voter: ME, had: 1, old: "-", new: "+" });
st = get();
assert.equal(st.posts[0].score, 2);
assert.equal(st.posts[0].mine, 1);

// comments counted in feed
ingest({ type: "event", id: H("c"), pubkey: BOB, created_at: 999_900, kind: 1, content: "nice",
         tags: [["e", H("1"), "", "root"]] });
assert.equal(get().posts[0].ncom, 1);

// wants follow the window
let w = fromDoc(call("wants", s));
assert.equal(w.filters.length, 3);
assert.deepEqual(w.filters[0].values, ["tsudoi"]);
assert.equal(w.filters[2].values.length, 2);

// view renders
const v = fromDoc(call("view", s));
assert.equal(v.tag, "div");

// sort
step("sort:new", "click");
assert.equal(get().sort, "new");

// submit a post
ingest({ type: "route", hash: "#/submit" });
step("draft-sub", "input", "VibeCoding");
step("draft-title", "input", "日本語のタイトル");
step("draft-body", "input", "本文");
step("submit", "click");
st = get();
assert.equal(st.outbox.length, 1, st.notice);
assert.equal(st.outbox[0].content, "日本語のタイトル\n\n本文");
assert.deepEqual(st.outbox[0].tags[1], ["t", "tsudoi-vibecoding"]);
ingest({ type: "sent" });
assert.equal(get().outbox.length, 0);

// thread
ingest({ type: "route", hash: `#/p/${H("1")}` });
ingest(post(H("1"), "vibecoding", "first", 999_000));
const cm = (id, parent, created, text) => ({
  type: "event", id, pubkey: BOB, created_at: created, kind: 1, content: text,
  tags: [["e", H("1"), "", "root"], ["e", parent, "", "reply"]]
});
ingest(cm(H("c"), H("1"), 10, "top level A"));
ingest(cm(H("d"), H("c"), 11, "reply to A"));
ingest(cm(H("e"), H("1"), 12, "top level B"));
ingest(cm(H("f"), H("d"), 13, "reply to reply"));
ingest({ type: "vote", target: H("e"), voter: BOB, had: 0, old: "", new: "+" });
st = get();
assert.equal(st.root.title, "first");
assert.equal(st.comments.length, 4);
const tv = fromDoc(call("view", s));
const thread = tv.children[tv.children.length - 1];
const order = thread.children.filter(n => (n.attrs.class || "").startsWith("comment")).map(n => n.attrs.class);
assert.deepEqual(order, ["comment d0", "comment d0", "comment d1", "comment d2"], "B (score 1) first, then A's subtree");

// reply
step(`reply:${H("d")}`, "click");
step("reply-body", "input", "me too");
step("send-reply", "click");
st = get();
assert.equal(st.outbox.length, 1);
assert.deepEqual(st.outbox[0].tags[1], ["e", H("d"), "", "reply"]);

// vote button
step(`up:${H("c")}`, "click");
assert.equal(get().outbox.length, 2);
assert.equal(get().outbox[1].content, "+");

// window cap: 40 posts keep 25
ingest({ type: "route", hash: "#/" });
for (let i = 0; i < 40; i++) ingest(post(i.toString(16).padStart(64, "0"), "x_y", `p${i}`, 900_000 + i));
assert.equal(get().posts.length, 25);
assert.ok(get().posts.every(p => Number(p.title.slice(1)) >= 15), "oldest evicted");

// a 2000-byte japanese body is cut on a code point boundary
const long = "あ".repeat(700);
ingest({ ...post(H("7"), "x_y", "long", 2_000_000), content: "long\n\n" + long });
const lp = get().posts.find(p => p.title === "long");
assert.ok(lp.body.endsWith("…") && lp.body.length < 200);

console.log("guest ok");

// every route's view stays inside the document bounds
for (const hash of ["#/", "#/r/abc", "#/submit", "#/settings", `#/p/${H("1")}`]) {
  ingest({ type: "route", hash });
  call("view", s);
}
step("relay-draft", "input", "ws://localhost:7447");
step("add-relay", "click");
assert.equal(get().relays.length, 5);
step("drop-relay:0", "click");
assert.equal(get().relays[0], "wss://nos.lol");
console.log("views ok");
