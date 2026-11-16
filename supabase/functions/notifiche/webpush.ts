// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) solo con WebCrypto: niente librerie esterne.
const te = new TextEncoder();
export const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const ub64 = (s: string) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
/* cifra il messaggio per un abbonamento (endpoint + chiavi p256dh/auth del browser) */
export async function cifra(payload: Uint8Array, p256dh: string, auth: string) {
  const uaPub = ub64(p256dh), authS = ub64(auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authS, shared, cat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, cat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
/* intestazione VAPID: JWT ES256 firmato con la chiave privata del server */
export async function vapid(endpoint: string, pubB64u: string, privB64u: string, sub: string) {
  const pub = ub64(pubB64u);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privB64u, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const aud = new URL(endpoint).origin;
  const h = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(h + "." + p)));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${pubB64u}`;
}
export async function invia(s: { endpoint: string; p256dh: string; auth: string }, msg: unknown, V: { pub: string; priv: string; sub: string }) {
  const body = await cifra(te.encode(JSON.stringify(msg)), s.p256dh, s.auth);
  return await fetch(s.endpoint, { method: "POST", headers: { Authorization: await vapid(s.endpoint, V.pub, V.priv, V.sub), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal" }, body });
}
