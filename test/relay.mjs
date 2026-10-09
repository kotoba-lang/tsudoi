// A minimal in-memory Nostr relay for local development (NIP-01 subset:
// EVENT, REQ with ids/kinds/#tag/limit, CLOSE). It does not verify
// signatures -- the client does. Run: node test/relay.mjs [port]
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] || 7447);
const events = [];
const subs = new Map(); // ws -> Map(subId -> filters)

const match = (e, f) =>
  (!f.ids || f.ids.includes(e.id)) &&
  (!f.kinds || f.kinds.includes(e.kind)) &&
  Object.entries(f).every(([k, vs]) =>
    !k.startsWith("#") || e.tags.some(t => t[0] === k.slice(1) && vs.includes(t[1])));

new WebSocketServer({ port }).on("connection", ws => {
  subs.set(ws, new Map());
  ws.on("close", () => subs.delete(ws));
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg[0] === "EVENT") {
      const e = msg[1];
      if (!events.some(x => x.id === e.id)) events.push(e);
      ws.send(JSON.stringify(["OK", e.id, true, ""]));
      for (const [peer, s] of subs)
        for (const [id, fs] of s)
          if (fs.some(f => match(e, f))) peer.send(JSON.stringify(["EVENT", id, e]));
    } else if (msg[0] === "REQ") {
      const [, id, ...fs] = msg;
      subs.get(ws).set(id, fs);
      const seen = new Set();
      for (const f of fs) {
        const hits = events.filter(e => match(e, f)).sort((a, b) => b.created_at - a.created_at)
          .slice(0, f.limit || 500);
        for (const e of hits) if (!seen.has(e.id)) { seen.add(e.id); ws.send(JSON.stringify(["EVENT", id, e])); }
      }
      ws.send(JSON.stringify(["EOSE", id]));
    } else if (msg[0] === "CLOSE") {
      subs.get(ws).delete(msg[1]);
    }
  });
});
console.log(`relay on ws://localhost:${port}`);
