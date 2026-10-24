'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pages = [
  ['index.html', 'dashboard'],
  ['smart-farming.html', 'smart-farming'],
  ['wpml-editor.html', 'wpml-editor'],
  ['wpml-route-library.html', 'routes'],
  ['wpml-survey-preview.html', 'survey'],
  ['pilot-login.html', 'pilot']
];
const root = path.resolve(__dirname, '../../frontend/public');
const html = name => fs.readFileSync(path.join(root, name), 'utf8');

test('shared light stylesheet defines accessible UI tokens and is syntactically balanced', () => {
  const css = fs.readFileSync(path.join(root, 'skyhub-light.css'), 'utf8');
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /--sky-bg:\s*#f3f6fb/);
  assert.match(css, /--sky-primary:\s*#2458d3/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
  assert.doesNotMatch(css, /color-scheme:\s*dark/);
});

for (const [filename, page] of pages) {
  test(`${filename} loads the shared light theme last and retains its safety contract`, () => {
    const source = html(filename);
    assert.match(source, new RegExp(`<body data-skyhub-page="${page}"`));
    assert.equal((source.match(/href="\/skyhub-light\.css"/g) || []).length, 1);
    assert.ok(source.indexOf('href="/skyhub-light.css"') > source.indexOf('</style>'));
    assert.doesNotMatch(source, /color-scheme:\s*dark/);
    assert.match(source, /<script\b/);
  });
}
const globalLinks = ['/', '/wpml-editor.html', '/wpml-route-library.html',
  '/wpml-survey-preview.html', '/smart-farming.html'];
for (const [filename] of pages.filter(([, page]) => page !== 'pilot')) {
  test(`${filename} has shared navigation to the five operator modules`, () => {
    const source = html(filename);
    assert.match(source, /<nav class="skyhub-global-nav" aria-label="SkyHub-Bereiche">/);
    for (const href of globalLinks)
      assert.ok(source.includes(`href="${href}"`), `${filename} missing ${href}`);
    assert.equal((source.match(/aria-current="page"/g) || []).length, 1);
  });
}
test('pairing UI stays compact without introducing additional navigation', () => {
  assert.doesNotMatch(html('pilot-login.html'), /skyhub-global-nav/);
});
test('live dashboard keeps read-only, operational and TAK contract identifiers', () => {
  const source = html('index.html');
  for (const id of ['token', 'connect', 'map', 'tabOperations', 'tabTak',
    'operationsPanel', 'takPanel', 'devices', 'showTrack']) {
    assert.ok(source.includes(`id="${id}"`), `missing ${id}`);
  }
  assert.match(source, /keine Flugsteuerung/);
  assert.match(source, /TAK-Backend nicht integriert/);
});
test('experimental Smart Farming and offline WPML disclaimers remain visible', () => {
  assert.match(html('smart-farming.html'), /Keine kalibrierte Vegetationskarte/);
  assert.match(html('wpml-editor.html'), /Keine Flugfreigabe|Keine Flugauftrag|keine Flugfreigabe/i);
  assert.match(html('wpml-route-library.html'), /lokalen Browser-Speicher im Klartext/);
  assert.match(html('wpml-survey-preview.html'), /Keine Flugplanung/);
});

test('light-theme semantic text colors meet WCAG AA contrast on white', () => {
  const css = fs.readFileSync(path.join(root, 'skyhub-light.css'), 'utf8');
  function hexToken(name) {
    const match = css.match(new RegExp('--sky-' + name + ':\\s*(#[0-9a-fA-F]{6})'));
    assert.ok(match, 'missing --sky-' + name);
    return match[1];
  }
  function luminance(hex) {
    const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2), 16) / 255);
    const linear = rgb.map(value => value <= 0.04045 ?
      value/12.92 : ((value+0.055)/1.055)**2.4);
    return 0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2];
  }
  const white = luminance(hexToken('white'));
  for (const token of ['ink','muted','primary','primary-hover',
    'teal','success','warning','danger']) {
    const dark = luminance(hexToken(token));
    assert.ok((white+0.05)/(dark+0.05)>=4.5, token+' must meet 4.5:1');
  }
});

test('each operator page marks only its own module as active', () => {
  const expected = new Map([
    ['index.html','/'], ['smart-farming.html','/smart-farming.html'],
    ['wpml-editor.html','/wpml-editor.html'],
    ['wpml-route-library.html','/wpml-route-library.html'],
    ['wpml-survey-preview.html','/wpml-survey-preview.html']
  ]);
  for (const [name,active] of expected) {
    const nav = html(name).match(/<nav class="skyhub-global-nav"[^>]*>(.*?)<\/nav>/s);
    assert.ok(nav, name);
    const links = [...nav[1].matchAll(/<a href="([^"]+)"([^>]*)>/g)];
    assert.deepEqual(links.map(link=>link[1]),globalLinks, name);
    assert.deepEqual(links.filter(link=>/aria-current="page"/.test(link[2]))
      .map(link=>link[1]),[active],name);
  }
});

test('survey optics dropdown uses the common light skin rather than hard-coded dark styles', () => {
  const control = html('wpml-survey-preview.html')
    .match(/<select\s+id="camera-mode"([^>]*)>/);
  assert.ok(control);
  assert.doesNotMatch(control[1],/background:|color:/i);
});

test('accessible placeholder and focus colors remain legible in light mode', () => {
  const css = fs.readFileSync(path.join(root, 'skyhub-light.css'), 'utf8');
  assert.match(css, /outline: 3px solid var\(--sky-primary\)/);
  assert.match(css, /input::placeholder, textarea::placeholder \{ color: #586b84/);
  function luminance(hex) {
    const channels=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      .map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  }
  const background=luminance('#ffffff');
  for(const [label,color,minimum] of [
    ['focus','#2458d3',3],['placeholder','#586b84',4.5]
  ])assert.ok((background+0.05)/(luminance(color)+0.05)>=minimum,label);
});

test('dynamically rendered WPML notices use the shared readable light tokens', () => {
  const editors = [
    'wpml-editor.js','wpml-route-library.js','wpml-survey-preview.js'
  ];
  for (const name of editors) {
    const source=html(name);
    assert.match(source, /var\(--sky-warning\)/, name);
    assert.match(source, /var\(--sky-ink\)/, name);
    assert.doesNotMatch(source, /#(?:ccebf7|c4e8fa|e5f7ff|ffdda6|ffcb7d|ffca8c)/i, name);
  }
  const dashboard=html('index.html').split('</style>')[1];
  assert.ok(dashboard,'dashboard body exists');
  assert.doesNotMatch(dashboard, /#47c3e7|#ff6b5b|#f0b84a/i);
});

test('mobile operator navigation wraps rather than hiding the active section', () => {
  const css = fs.readFileSync(path.join(root, 'skyhub-light.css'), 'utf8');
  const mobile = css.split('@media (max-width: 660px) {')[1]?.split('@media (prefers-reduced-motion: reduce)')[0];
  assert.ok(mobile, '660px breakpoint must exist');
  assert.match(mobile, /\.skyhub-global-nav\s*\{\s*flex-wrap:\s*wrap;/);
  assert.match(mobile, /overflow-x:\s*visible;/);
});

test('six delivered views support keyboard bypass to a single focusable main landmark', () => {
  const css = fs.readFileSync(path.join(root, 'skyhub-light.css'), 'utf8');
  assert.match(css, /\.skyhub-skip-link:focus[^\{]*\{\s*transform: translateY\(0\)/);
  for (const [name] of pages) {
    const source = html(name);
    assert.equal((source.match(/class="skyhub-skip-link"/g) || []).length, 1, name);
    assert.equal((source.match(/href="#skyhubMain"/g) || []).length, 1, name);
    assert.equal((source.match(/<main\b/g) || []).length, 1, name);
    assert.match(source, /<main id="skyhubMain" tabindex="-1">/, name);
    const skipAt = source.indexOf('class="skyhub-skip-link"');
    const mainAt = source.indexOf('<main id="skyhubMain"');
    assert.ok(skipAt >= 0 && mainAt > skipAt, name + ' skip target must follow link');
  }
});

test('system high-contrast and reduced-motion modes use visible nonchromatic states', () => {
  const css = fs.readFileSync(path.join(root, 'skyhub-light.css'), 'utf8');
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /--sky-bg:\s*Canvas;/);
  assert.match(css, /--sky-ink:\s*CanvasText;/);
  assert.match(css, /--sky-primary:\s*LinkText;/);
  assert.match(css, /\.skyhub-global-nav a\[aria-current="page"\]/);
  assert.match(css, /outline:\s*2px solid Highlight;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transition:\s*none !important;/);
  const pilot=html('pilot-login.html');
  assert.match(pilot, /class="pilot-brand-accent"/);
  assert.doesNotMatch(pilot, /style="color:#38bdf8"/);
});

test('native form errors use interaction-aware styling without initial required-field warning', () => {
  const css = fs.readFileSync(path.join(root, 'skyhub-light.css'), 'utf8');
  assert.match(css, /:user-invalid/);
  assert.match(css, /\[aria-invalid="true"\]/);
  assert.match(css, /border: 2px solid var\(--sky-danger\)/);
  assert.match(css, /box-shadow: inset 3px 0 0 var\(--sky-danger\)/);
  assert.doesNotMatch(css, /(^|,)\s*input:invalid\b/m);
});

test('all operator modules expose the same navigation destinations for real click smoke', () => {
  const paths = ['/', '/wpml-editor.html', '/wpml-route-library.html',
    '/wpml-survey-preview.html', '/smart-farming.html'];
  for (const [fileName, page] of pages) {
    if (page === 'pilot') continue;
    const source = html(fileName);
    const nav = source.match(/<nav class="skyhub-global-nav"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(nav, fileName + ': missing operator navigation');
    const destinations = [...nav[1].matchAll(/<a href="([^"]+)"/g)].map(x => x[1]);
    assert.deepEqual(destinations, paths, fileName + ': navigation order or target drift');
  }
});
