# tsudoi (集い)

A Reddit-style forum — subs, posts, threaded comments, up/down votes, hot/new/top —
whose application is written in [Kotoba](https://kotoba-lang.org) and which has
**no server**.

- **Data**: every post, comment and vote is a signed [Nostr](https://nostr.com)
  event, broadcast to several independent relays you choose. Nobody owns the
  database, and nobody can refuse your post for everyone.
- **Code**: the site is a static bundle on IPFS, addressed by its content hash.
  A GitHub Pages mirror serves the same bytes.
- **Identity**: a key pair generated in your browser (or your NIP-07 extension,
  or your own `nsec`). It never leaves the browser.

Why: Reddit declined a post about vibe coding. So the forum is now something
nobody in particular can decline.

## Open it

- IPFS (v0.1.0): `ipfs://bafybeifkijv4c4tj6lbcvby43tc7nt2eea6nln7d5w4rxsu2dykvjv5gfy`
  — in a browser: <https://bafybeifkijv4c4tj6lbcvby43tc7nt2eea6nln7d5w4rxsu2dykvjv5gfy.ipfs.inbrowser.link/>
  (verifies every block in a service worker), or any gateway / your own node.
  Newer CIDs are in the [release notes](https://github.com/kotoba-lang/tsudoi/releases).
- Mirror of the same `web/` bytes: <https://kotoba-lang.github.io/tsudoi/>
- Pinned on Filecoin: the site's CID is stored with a Filecoin Onchain Cloud
  provider ([filecoin-pin](https://github.com/filecoin-project/filecoin-pin),
  `scripts/pin-filecoin.sh`), which announces it to IPNI and serves it over
  the IPFS trustless gateway protocol — retrievable without any machine of
  ours online. A second archival copy of the CAR is on
  [Fil One](https://fil.one) (`scripts/archive-filone.sh`).

## How it is built

```
src/tsudoi.kotoba   the application (pure Kotoba, granted nothing)
   │  amu compile --target js-browser
   ▼
web/gen/tsudoi.mjs  restricted ESM + manifest + provenance
web/host.mjs        the host: relays, key, cache, clock, DOM listeners
web/vendor/         amu's deny-by-default DOM reconciler; noble crypto
```

The Kotoba module is the whole application. It exports five pure functions:

| export   | from → to                          | what it decides |
|----------|------------------------------------|-----------------|
| `init`   | → state                            | initial state, default relays |
| `ingest` | state, host input → state          | which network events are posts / comments, threading (NIP-10), vote tallies, ranking window |
| `step`   | state, UI event → state            | forms, validation, what to publish (into `:outbox`) |
| `wants`  | state → filters                    | which Nostr filters the page needs, and on which relays |
| `view`   | state → UI document                | the whole page |

It compiles with an **empty** capability set: it cannot open a socket, read a
key, see the clock or touch the DOM. `web/host.mjs` holds those, and is
mechanism only — it verifies signatures (BIP-340), matches events against the
filters the guest asked for, replays its cache like a local relay, keeps vote
registers (last writer wins per voter and target), signs whatever the guest
puts in its outbox, and renders the guest's UI document through the
reconciler (no `innerHTML`, no `style`, no event handlers, safe URLs only).

### On the wire (interoperable with other Nostr clients)

| thing   | event |
|---------|-------|
| post    | kind 1, `content` = `title\n\nbody`, tags `["t","tsudoi"]`, `["t","tsudoi-<sub>"]`, `["subject",title]` |
| comment | kind 1, NIP-10 `["e",root,"","root"]`, `["e",parent,"","reply"]`, `["p",author]` |
| vote    | kind 7 (NIP-25), `+` / `-`, `["e",target]`, `["p",author]`, `["k","1"]` |

A sub is a hashtag, so `#tsudoi-vibecoding` shows up in any Nostr client.

## Develop

```sh
./build.sh                 # needs amu (kotoba-lang/amu): AMU=/path/to/bin/amu ./build.sh
npm install && npm test    # drives the compiled guest in Node
node test/relay.mjs 7447   # an in-memory relay for local work
python3 test/serve.py      # http://localhost:8787, add ws://localhost:7447 in settings
```

## Honest limits

- **Windows, not tables.** A Kotoba `:document` vector holds at most 32 items
  and nests at most 8 levels. The feed keeps the 25 best-ranked posts it has
  seen; a thread shows 30 comments (the rest are counted, not shown); comment
  nesting is drawn with indentation, not DOM nesting. The host cache keeps
  everything verified, and a post re-enters the window when it ranks.
- **No un-vote.** Nostr has no un-react short of a deletion request; voting the
  other way replaces your vote.
- **No moderation layer yet.** Relays apply their own policies; tsudoi adds
  none. Mute lists (NIP-51) would be the natural next step.
- **Classical signatures.** Nostr uses BIP-340 Schnorr over secp256k1. Kotoba
  requires post-quantum material for *new Kotoba* cryptographic boundaries;
  this app speaks an existing external protocol, so it uses that protocol's
  scheme and makes no PQ claim.
- **Plain text.** Bodies are rendered as text, never as HTML or Markdown.

License: Apache-2.0.
