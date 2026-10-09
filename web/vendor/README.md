# vendored

- `browser-host.mjs` — copied unmodified from
  [kotoba-lang/amu](https://github.com/kotoba-lang/amu) `runtime/browser-host.mjs`
  at `059ed5d32c81c7b9365e6ff95f28410178846388` (Apache-2.0). tsudoi uses only
  `reconcileUiDocument`: the deny-by-default renderer from a Kotoba UI
  `:document` to DOM (no `innerHTML`, no `style`, no `on*`, safe URLs only).
- `nostr.mjs` — `npm run vendor` bundle of `web/vendor-src/nostr.mjs` with
  @noble/curves 1.9.2, @noble/hashes 1.8.0 and @scure/base 1.2.6.
