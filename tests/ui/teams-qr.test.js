// The QR code: an SVG with exactly the module count of the vendor library's matrix, built with createElementNS (never innerHTML).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { boot, APP_DIR } from './harness.js';
import { qrSvg } from '../../app/js/qr.js';
import qrcode from '../../app/js/vendor/qrcode.js';

const darkOf = (text, level) => {
  const q = qrcode(0, level);
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const dark = new Set();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) dark.add(r + ',' + c);
  return { n, dark };
};
/** The modules an svg path draws, from its "M x yh len v1 h-len z" runs (4 modules of quiet border). */
const drawn = (svg) => {
  const d = svg.querySelector('path').getAttribute('d');
  const out = new Set();
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g))
    for (let i = 0; i < +m[3]; i++) out.add(+m[2] - 4 + ',' + (+m[1] - 4 + i));
  return out;
};

test('the QR svg draws exactly the library’s dark modules, with a 4-module quiet border, black on white', async () => {
  const page = await boot();
  try {
    const text = 'https://tipmynet.com/#join=' + 'AbCd-_12'.repeat(30);
    const svg = qrSvg(text, 'QR code for the test');
    const { n, dark } = darkOf(text, 'M');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(svg.getAttribute('data-modules'), String(n));
    assert.equal(svg.getAttribute('viewBox'), '0 0 ' + (n + 8) + ' ' + (n + 8));
    assert.equal(svg.getAttribute('role'), 'img');
    assert.equal(svg.getAttribute('aria-label'), 'QR code for the test');
    assert.deepEqual(drawn(svg), dark, 'every dark module, and only those');
    assert.equal(svg.querySelector('rect').getAttribute('fill'), '#ffffff');
    assert.equal(svg.querySelector('path').getAttribute('fill'), '#000000');
    assert.ok(n >= 41, 'a long link makes a bigger code (' + n + ' modules)');
    // a short text is the smallest code
    assert.equal(qrSvg('hi').getAttribute('data-modules'), '21');
  } finally {
    await page.close();
  }
});

test('the QR svg is built without innerHTML (the setter throws here, and nothing in the Teams code uses it)', async () => {
  const page = await boot();
  try {
    const proto = page.win.Element.prototype;
    const real = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    Object.defineProperty(proto, 'innerHTML', {
      configurable: true,
      get: real && real.get,
      set() {
        throw new Error('innerHTML used');
      },
    });
    try {
      const svg = qrSvg('https://example.com/#sheet=abc');
      assert.ok(svg.querySelector('path').getAttribute('d').length > 100);
      assert.equal(svg.children.length, 2);
    } finally {
      if (real) Object.defineProperty(proto, 'innerHTML', real);
    }
  } finally {
    await page.close();
  }
  for (const f of [
    'qr.js',
    'codec.js',
    'venue.js',
    'pool.js',
    'sheet.js',
    'entitlements.js',
    'ui/team.js',
    'ui/join.js',
  ]) {
    const src = readFileSync(path.join(APP_DIR, 'js', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // comments may say what is not used
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/innerHTML|outerHTML|insertAdjacentHTML|createSvgTag|document\.write|\beval\(|new Function/.test(src),
      f,
    );
  }
});

test('a text too long for any QR code gives no code (the screens then say to share the link)', () => {
  assert.equal(qrSvg('x'.repeat(4000)), null);
});

test('the library is the vendored qrcode-generator, kept out of lint and format', () => {
  const lib = readFileSync(path.join(APP_DIR, 'js/vendor/qrcode.js'), 'utf8');
  assert.match(lib, /Kazuhiko Arase/);
  assert.match(lib, /MIT license/);
  const root = path.resolve(APP_DIR, '..');
  assert.match(readFileSync(path.join(root, 'eslint.config.js'), 'utf8'), /app\/js\/vendor/);
  assert.match(readFileSync(path.join(root, '.prettierignore'), 'utf8'), /app\/js\/vendor/);
});
