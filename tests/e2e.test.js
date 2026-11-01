// Testy end-to-end (Playwright + Chromium + pdftotext): kalkulator, PDF i bezpieczeństwo płatności.
// Uruchom: node tests/e2e.test.js   (wymaga: playwright z przeglądarką Chromium, poppler-utils)
// /api/verify jest atrapą (page.route) – prawdziwą funkcję testuje tests/verify.test.mjs.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Przeglądarka testowa łączy się tylko z lokalnym serwerem – bez serwera proxy ze zmiennych środowiska.
for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

const REPO = path.resolve(__dirname, '..');
const SITE = path.join(REPO, 'public'); // katalog publikowany (Cloudflare Pages: output directory = public)
const OUT = path.join(REPO, 'test-output');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); }
}

/* ---------- nagłówki z pliku _headers (blok "/*") ---------- */
const HEADERS = {};
{
  let inBlock = false;
  for (const line of fs.readFileSync(path.join(SITE, '_headers'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) inBlock = line.trim() === '/*';
    else if (inBlock && line.includes(':')) { const i = line.indexOf(':'); HEADERS[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
}

// Testowy serwer działa po HTTP, a produkcja po HTTPS: dyrektywa upgrade-insecure-requests przekierowałaby
// zasoby na nieistniejący https://, więc tylko w teście jest usuwana (reszta CSP bez zmian).
const noUpgrade = (csp) => csp.replace(/;\s*upgrade-insecure-requests/, '');
HEADERS['Content-Security-Policy'] = noUpgrade(HEADERS['Content-Security-Policy']);
const MODE = { paymentUrl: '' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html');
  const p = path.join(SITE, rel);
  if (!p.startsWith(SITE + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(p);
  if (rel === '/index.html') body = Buffer.from(body.toString('utf8').replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)/, (m, a, c) => a + noUpgrade(c)));
  if (rel === '/assets/config.js' && MODE.paymentUrl) body = Buffer.from(body.toString('utf8').replace("paymentUrl: '',", `paymentUrl: '${MODE.paymentUrl}',`));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', ...HEADERS });
  res.end(body);
});

async function newPage(browser, opts = {}) {
  const context = await browser.newContext({ locale: 'pl-PL', acceptDownloads: true, viewport: { width: 1280, height: 900 }, ...opts });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Cross-Origin-Opener-Policy|upgrade-insecure-requests/.test(m.text())) page.errors.push(m.text()); });
  return { context, page };
}
/* Atrapa /api/verify: płatność „opłacona” tylko dla pary (session_id, ref) wydanej przez atrapę Stripe. */
function mockVerify(page, state) {
  return page.route('**/api/verify?**', (route) => {
    const u = new URL(route.request().url());
    state.calls.push(u.search);
    let body;
    if (u.searchParams.has('ping')) body = { ready: state.ready !== false };
    else body = { paid: !!state.sid && u.searchParams.get('session_id') === state.sid && u.searchParams.get('ref') === state.ref };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
async function pdfText(download, name) {
  const f = path.join(OUT, name);
  await download.saveAs(f);
  return execFileSync('pdftotext', ['-layout', f, '-']).toString();
}
const IBAN = 'PL61 1090 1014 0000 0712 1981 2874';
async function fillLetter(page) {
  for (const [s, v] of [['#empName', 'Łukasz Żółkiewski'], ['#empStreet', 'ul. Źródlana 5/12'], ['#empCity', '90-001 Łódź'], ['#erName', 'Przędzalnia Ślęża Sp. z o.o.'], ['#erCity', '50-001 Wrocław'], ['#iban', IBAN], ['#place', 'Łódź']]) await page.fill(s, v);
  await page.waitForTimeout(300);
}
const isLocked = (page) => page.$eval('#letterPreview', (e) => e.innerHTML.includes('locked-blur') && !e.textContent.includes('Uzasadnienie') && !e.textContent.includes('Działając we własnym imieniu'));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const LOCAL = `http://127.0.0.1:${port}`;
  // „Prawdziwa” (nie-lokalna) nazwa hosta – tryb demo musi być wyłączony.
  const PROD = `http://odprawa.test:${port}`;
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP odprawa.test 127.0.0.1', '--no-proxy-server'] });

  /* ======================= 1. Kalkulator + tryb demo (lokalnie) ======================= */
  console.log('CALCULATOR + LOCAL DEMO');
  let { context, page } = await newPage(browser);
  await page.goto(LOCAL + '/');
  await page.waitForTimeout(300);
  const base = await page.textContent('#baseMini');
  check('calculator: example base 6000 + 1000 + 200 = 7 200,00 zł', /7\s200,00\szł/.test(base), base);
  check('calculator: audit shows shortfall', /Razem/.test(await page.textContent('#auditTable')) && /niedopłaty/i.test(await page.textContent('#summary')));
  await page.fill('#fixedSalary', '9000');
  await page.waitForTimeout(300);
  check('calculator: recalculates on input (10 200,00 zł)', /10\s200,00\szł/.test(await page.textContent('#baseMini')));
  await page.fill('#fixedSalary', '6000');
  await fillLetter(page);
  check('demo: full preview visible locally', !(await isLocked(page)));
  await page.click('#btnPdf');
  check('demo: checkout dialog with demo note', await page.$eval('#dlgCheckout', (d) => d.open) && await page.$eval('#coDemo', (e) => !e.hidden));
  await page.click('#coPay');
  check('consents required', await page.$eval('#coError', (e) => !e.hidden && e.textContent.includes('zgody')));
  await page.check('#coTerms'); await page.check('#coWithdraw');
  let [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#coPay')]);
  let txt = await pdfText(dl, 'demo.pdf');
  check('demo PDF: Polish diacritics', txt.includes('Łukasz Żółkiewski') && txt.includes('Źródlana') && txt.includes('PRZEDSĄDOWE WEZWANIE DO ZAPŁATY') && txt.includes('Przędzalnia Ślęża'), txt.slice(0, 400));
  check('SECURITY: zero CSP violations (demo)', (await page.evaluate(() => window.__csp)).length === 0, await page.evaluate(() => window.__csp));
  check('no JS errors (demo)', page.errors.length === 0, page.errors);
  await context.close();

  /* ======================= 2. Produkcja bez linku płatności ======================= */
  console.log('PRODUCTION – payments not configured');
  MODE.paymentUrl = '';
  ({ context, page } = await newPage(browser));
  let st = { calls: [], ref: '', sid: '' };
  await mockVerify(page, st);
  await page.goto(PROD + '/');
  await fillLetter(page);
  check('locked on real domain (no free demo)', await isLocked(page));
  await page.click('#btnPdf');
  check('"Sprzedaż chwilowo niedostępna" shown, pay disabled', await page.$eval('#coUnavailable', (e) => !e.hidden && e.textContent.includes('nie pobraliśmy')) && await page.$eval('#coPay', (b) => b.disabled));
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.check('#coTerms'); await page.check('#coWithdraw');
  await page.click('#coPay', { force: true }).catch(() => {});
  await page.waitForTimeout(500);
  check('no PDF without payment', !downloaded);
  await context.close();

  /* ======================= 3. Produkcja: przepływ płatności ======================= */
  console.log('PRODUCTION – payment flow');
  MODE.paymentUrl = 'https://buy.stripe.com/test_e2e';
  ({ context, page } = await newPage(browser));
  st = { calls: [], ref: '', sid: '' };
  await mockVerify(page, st);
  const captured = [];
  await context.route('https://buy.stripe.com/**', (route) => {
    const u = new URL(route.request().url());
    captured.push(u.href);
    st.ref = u.searchParams.get('client_reference_id');
    st.sid = 'cs_live_' + crypto.randomBytes(12).toString('hex');
    route.fulfill({ status: 302, headers: { location: `${PROD}/?platnosc=sukces&session_id=${st.sid}` } });
  });
  await page.goto(PROD + '/');
  await fillLetter(page);
  check('locked preview: grey bars, no letter text in DOM', await isLocked(page));
  check('button shows price', (await page.textContent('#btnPdf')).includes('14,99 zł'));

  // Próba 1: samo ?platnosc=sukces w adresie
  downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.goto(PROD + '/?platnosc=sukces&session_id=cs_live_fakefakefake12345');
  await page.waitForTimeout(800);
  check('SECURITY: ?platnosc=sukces alone does not unlock', await isLocked(page) && !downloaded);
  check('URL cleaned', !page.url().includes('platnosc'));

  // Próba 2: podrobiony localStorage
  await page.evaluate(() => {
    localStorage.setItem('sprawdzodprawe.pay.v1', JSON.stringify({ ref: 'w' + 'a'.repeat(32), sid: 'cs_live_forgedforged1234', ts: Date.now() }));
    localStorage.setItem('paid', 'true'); localStorage.setItem('unlocked', '1');
  });
  await page.reload();
  await fillLetter(page);
  await page.waitForTimeout(500);
  check('SECURITY: forged localStorage does not unlock', await isLocked(page) && !downloaded);
  check('SECURITY: forged payment record removed after server rejects it', await page.evaluate(() => localStorage.getItem('sprawdzodprawe.pay.v1') === null));

  // Prawdziwa (atrapa) płatność – formularz musi przetrwać przekierowanie do Stripe i powrót
  await page.fill('#empContact', 'łucja@example.com');
  await page.waitForTimeout(200);
  await page.click('#btnPdf');
  await page.check('#coTerms'); await page.check('#coWithdraw');
  const dlP = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#coPay');
  const d2 = await dlP;
  txt = await pdfText(d2, 'paid.pdf');
  check('redirect carries random client_reference_id', captured.length === 1 && /client_reference_id=w[0-9a-f]{32}/.test(captured[0]), captured);
  check('verify called with matching session_id + ref', st.calls.some((c) => c.includes(st.sid) && c.includes(st.ref)), st.calls);
  check('paid PDF downloaded automatically, form survived round-trip', txt.includes('Łukasz Żółkiewski') && txt.includes('Przędzalnia Ślęża') && txt.replace(/\s+/g, '').includes(IBAN.replace(/\s+/g, '')) && txt.includes('łucja@example.com'), txt.slice(0, 400));
  check('paid PDF: Polish diacritics (ąćęłńóśźż)', ['ą', 'ć', 'ę', 'ł', 'ń', 'ó', 'ś', 'ź', 'ż'].every((c) => txt.toLowerCase().includes(c)));
  check('after verified payment: preview unlocked', !(await isLocked(page)));
  await page.reload();
  await page.waitForTimeout(1000);
  check('reload keeps access (server re-verifies)', !(await isLocked(page)) && (await page.textContent('#btnPdf')).includes('opłacone'));
  check('SECURITY: zero CSP violations (payment flow)', (await page.evaluate(() => window.__csp)).length === 0, await page.evaluate(() => window.__csp));
  check('no JS errors (payment flow)', page.errors.length === 0, page.errors);
  const paidSid = st.sid;
  await context.close();

  // Próba 3: udostępniony link z opłaconym session_id w innej przeglądarce
  ({ context, page } = await newPage(browser));
  await mockVerify(page, st);
  await page.goto(`${PROD}/?platnosc=sukces&session_id=${paidSid}`);
  await fillLetter(page);
  await page.waitForTimeout(500);
  check('SECURITY: shared paid link does not unlock another browser', await isLocked(page));
  await context.close();

  /* ======================= 4. Serwer weryfikacji niedostępny ======================= */
  console.log('PRODUCTION – verifier not ready');
  ({ context, page } = await newPage(browser));
  const st2 = { calls: [], ready: false };
  await mockVerify(page, st2);
  const captured2 = [];
  await context.route('https://buy.stripe.com/**', (route) => { captured2.push(route.request().url()); route.abort(); });
  await page.goto(PROD + '/');
  await fillLetter(page);
  await page.click('#btnPdf');
  await page.check('#coTerms'); await page.check('#coWithdraw');
  await page.click('#coPay');
  await page.waitForTimeout(800);
  check('BUYER PROTECTION: not ready → no redirect, "nie pobraliśmy żadnych środków"', captured2.length === 0 && await page.$eval('#coError', (e) => !e.hidden && e.textContent.includes('Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków')), captured2);
  check('partner slot is neutral (no invented business)', await page.$eval('#partnerSlot', (e) => !e.hidden && e.textContent.includes('Miejsce dla partnera')));
  await context.close();

  /* ======================= 5. Telefon ======================= */
  console.log('MOBILE');
  MODE.paymentUrl = '';
  ({ context, page } = await newPage(browser, { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }));
  await page.goto(LOCAL + '/');
  await page.waitForTimeout(300);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  check('mobile: no horizontal page scroll', ov.sw <= ov.w, ov);
  check('no JS errors (mobile)', page.errors.length === 0, page.errors);
  await context.close();

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL E2E TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
