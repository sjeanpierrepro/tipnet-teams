// A QR code as an SVG element, built with createElementNS (no innerHTML, so the strict CSP and the no-innerHTML rule hold).
// The code is always black on white, whatever the theme, so every phone camera can read it.
import qrcode from './vendor/qrcode.js';

const NS = 'http://www.w3.org/2000/svg';
const QUIET = 4; // the blank border a QR code needs, in modules

/** The QR matrix for text, trying the sturdier level first; null when the text is too long for any QR code. */
function makeQr(text) {
  for (const level of ['M', 'L']) {
    try {
      const q = qrcode(0, level);
      q.addData(text);
      q.make();
      return q;
    } catch (e) {
      /* does not fit at this level: try the next */
    }
  }
  return null;
}

/**
 * The QR code for text as an <svg> (null when it is too long for a QR code). One path draws every dark module (a run of
 * dark modules in a row is one rectangle). data-modules holds the number of modules along one side.
 */
export function qrSvg(text, label = 'QR code') {
  const q = makeQr(String(text));
  if (!q) return null;
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      let len = 1;
      while (c + len < n && q.isDark(r, c + len)) len++;
      d += 'M' + (c + QUIET) + ' ' + (r + QUIET) + 'h' + len + 'v1h-' + len + 'z';
      c += len - 1;
    }
  }
  const size = n + QUIET * 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('class', 'qr');
  svg.setAttribute('data-modules', String(n));
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#ffffff');
  const dark = document.createElementNS(NS, 'path');
  dark.setAttribute('d', d);
  dark.setAttribute('fill', '#000000');
  svg.append(bg, dark);
  return svg;
}
