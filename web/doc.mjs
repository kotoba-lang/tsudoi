// Mechanical conversion between JSON-shaped values and Kotoba :document
// values (tagged arrays). Integers become i64, strings strings, arrays
// vectors, plain objects maps with keyword keys. Nothing here interprets
// what a value means.

export function toDoc(x) {
  if (x === null || x === undefined) return ["null"];
  if (typeof x === "boolean") return ["bool", x];
  if (typeof x === "bigint") return ["i64", x];
  if (typeof x === "number") {
    if (!Number.isSafeInteger(x)) throw new Error("toDoc: only safe integers cross");
    return ["i64", BigInt(x)];
  }
  if (typeof x === "string") return ["string", x];
  if (Array.isArray(x)) return ["vector", x.map(toDoc)];
  if (typeof x === "object")
    // A map is canonical only with its keys in ascending order.
    return ["map", Object.keys(x).filter(k => x[k] !== undefined)
      .map(k => ":" + k).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map(k => [["keyword", k], toDoc(x[k.slice(1)])])];
  throw new Error("toDoc: unsupported value");
}

export function fromDoc(d) {
  switch (d[0]) {
    case "null": return null;
    case "bool": case "string": case "f64": return d[1];
    case "keyword": return d[1].replace(/^:/, "");
    case "i64": return Number(d[1]);
    case "vector": case "list": case "set": return d[1].map(fromDoc);
    case "map": {
      const o = {};
      for (const [k, v] of d[1]) o[(Array.isArray(k) ? k[1] : k).replace(/^:/, "")] = fromDoc(v);
      return o;
    }
    default: throw new Error("fromDoc: unknown tag " + d[0]);
  }
}
