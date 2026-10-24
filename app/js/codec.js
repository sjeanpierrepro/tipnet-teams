// Share codes for TipNet Teams: compact JSON as UTF-8, then base64url, kept in the URL fragment (#join=..., #sheet=...).
// The fragment never reaches a server. Everything read back is untrusted text, so reading is strict and bounded.
// Pure helpers (no DOM) except takeFragment, which reads and clears the page address.

/** Keys that could reach an object's prototype. A code that has one anywhere is refused whole. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 5;
const MAX_NODES = 600;

/** base64url of bytes (no padding). */
export function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** base64url of the UTF-8 bytes of str (no padding). */
export const b64urlEncode = (str) => bytesToB64url(new TextEncoder().encode(str));

/**
 * The text a base64url string stands for, or null: wrong characters (padding and plain base64 included), a length no
 * base64 text has, more than maxBytes once decoded, or bytes that are not UTF-8.
 */
export function b64urlDecode(data, maxBytes) {
  if (typeof data !== 'string' || !/^[A-Za-z0-9_-]+$/.test(data) || data.length % 4 === 1) return null;
  if (data.length > Math.ceil((maxBytes * 4) / 3) + 4) return null; // too big: not even decoded
  try {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (data.length % 4)) % 4));
    if (bin.length > maxBytes) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    return null;
  }
}

/** True when value (parsed JSON) is small, shallow and has no prototype-reaching key anywhere. */
function plainTree(value) {
  let nodes = 0;
  const walk = (v, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (v === null || typeof v !== 'object') return true;
    if (Array.isArray(v)) return v.every((x) => walk(x, depth + 1));
    return Object.keys(v).every((k) => !FORBIDDEN.has(k) && walk(v[k], depth + 1));
  };
  return walk(value, 0);
}

/** The JSON a code holds, or null for anything that is not a small plain JSON object. */
export function readCode(data, maxBytes) {
  const text = b64urlDecode(data, maxBytes);
  if (text === null) return null;
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) && plainTree(v) ? v : null;
  } catch (e) {
    return null;
  }
}

/* ---------- strict field checks (each returns the clean value, or undefined when it is not allowed) ---------- */
/** An integer in lo..hi, as a real number (a string or a float is refused). */
export const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
// control characters and the characters that flip text direction or hide (they could make a name read as something else)
const badChar = (ch) => {
  const n = ch.codePointAt(0);
  return (
    n < 32 ||
    (n >= 127 && n <= 159) ||
    (n >= 0x200b && n <= 0x200f) ||
    (n >= 0x2028 && n <= 0x202e) ||
    (n >= 0x2066 && n <= 0x2069) ||
    n === 0xfeff
  );
};
// A zero-width joiner is allowed only inside an emoji sequence (between a pictograph, or its skin tone or emoji
// presentation mark, and another pictograph), as in "👩‍🍳". Anywhere else it is invisible text and refused.
const PICTO = /\p{Extended_Pictographic}/u;
/** A pictograph, a skin tone modifier or the emoji presentation mark (what can come just before a joiner in an emoji). */
const pictoEnd = (ch) => {
  const n = ch.codePointAt(0);
  return PICTO.test(ch) || n === 0xfe0f || (n >= 0x1f3fb && n <= 0x1f3ff);
};
const emojiJoiner = (cps, i) =>
  cps[i] === '\u200d' && i > 0 && i < cps.length - 1 && pictoEnd(cps[i - 1]) && PICTO.test(cps[i + 1]);
/** The characters of text TipNet can't use in a name (control, invisible and direction characters). */
export const badChars = (text) => {
  const cps = Array.from(String(text));
  return cps.filter((ch, i) => badChar(ch) && !emojiJoiner(cps, i));
};
/**
 * A name: a string of 1..max characters (counted as code points), trimmed, no control, invisible or direction
 * characters (a zero-width joiner inside an emoji is fine).
 */
export function nameIn(v, max) {
  if (typeof v !== 'string' || v.length > max * 4) return undefined;
  const t = v.trim();
  const len = Array.from(t).length;
  return len >= 1 && len <= max && !badChars(t).length ? t : undefined;
}
/** An ISO date (a real calendar day) in the years 2000..2100. */
export function dateIn(v, parse) {
  return typeof v === 'string' && Number.isFinite(parse(v)) && v >= '2000-01-01' && v <= '2100-12-31'
    ? v
    : undefined;
}

/**
 * Reads a share link's fragment (#join=... or #sheet=...) and takes it out of the address at once (history.replaceState),
 * so a reload, a bookmark or a screenshot of the address bar no longer carries it. Returns {kind, data} or null.
 * Any other fragment is left alone.
 */
export function takeFragment(win = globalThis.window) {
  try {
    const m = /^#(join|sheet)=(.*)$/s.exec(win.location.hash || '');
    if (!m) return null;
    win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
    return { kind: m[1], data: m[2] };
  } catch (e) {
    return null;
  }
}
