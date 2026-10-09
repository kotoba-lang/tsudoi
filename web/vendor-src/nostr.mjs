// The only cryptography in tsudoi: BIP-340 Schnorr over secp256k1 (Nostr's
// signature scheme) and SHA-256, from the audited noble libraries, plus
// bech32 for npub/nsec. Bundled once into web/vendor/nostr.mjs so the site
// loads nothing from a CDN.
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { bech32 } from "@scure/base";

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export const newSecret = () => bytesToHex(schnorr.utils.randomPrivateKey());
export const publicOf = secretHex => bytesToHex(schnorr.getPublicKey(hexToBytes(secretHex)));

export function eventId(e) {
  const canonical = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

export function signEvent(template, secretHex) {
  const e = {
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags,
    content: template.content,
    pubkey: publicOf(secretHex)
  };
  e.id = eventId(e);
  e.sig = bytesToHex(schnorr.sign(hexToBytes(e.id), hexToBytes(secretHex)));
  return e;
}

/** Shape check, id check, signature check. Anything else is the guest's call. */
export function verifyEvent(e) {
  try {
    if (!e || typeof e !== "object") return false;
    if (!HEX64.test(e.id) || !HEX64.test(e.pubkey) || !HEX128.test(e.sig)) return false;
    if (!Number.isSafeInteger(e.kind) || !Number.isSafeInteger(e.created_at)) return false;
    if (typeof e.content !== "string" || !Array.isArray(e.tags)) return false;
    if (!e.tags.every(t => Array.isArray(t) && t.every(x => typeof x === "string"))) return false;
    if (eventId(e) !== e.id) return false;
    return schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey));
  } catch {
    return false;
  }
}

const enc = (prefix, hex) => bech32.encode(prefix, bech32.toWords(hexToBytes(hex)), 1000);
export const npub = hex => enc("npub", hex);
export const nsec = hex => enc("nsec", hex);
export function decodeNsec(text) {
  const { prefix, words } = bech32.decode(text.trim(), 1000);
  if (prefix !== "nsec") throw new Error("not an nsec");
  const hex = bytesToHex(bech32.fromWords(words));
  if (!HEX64.test(hex)) throw new Error("bad key length");
  return hex;
}
