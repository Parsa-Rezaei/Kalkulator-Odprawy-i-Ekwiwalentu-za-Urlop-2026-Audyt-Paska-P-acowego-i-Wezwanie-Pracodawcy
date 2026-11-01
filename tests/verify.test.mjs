// Testy funkcji weryfikującej płatność (functions/api/verify.js) z atrapą API Stripe.
// Uruchom: node tests/verify.test.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../functions/api/verify.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const { onRequest, evaluateSession, isConfigured } = mod;

let failures = 0;
const check = (name, cond, extra) => { if (cond) console.log('  PASS', name); else { failures++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const NOW = Math.floor(Date.now() / 1000);
const REF = 'w0123456789abcdef0123456789abcdef';
const ENV = { STRIPE_SECRET_KEY: 'rk_live_abc123', PAYMENT_LINK_ID: 'plink_1TestLink', EXPECTED_AMOUNT: '1499' };
const good = () => ({
  id: 'cs_live_a1B2c3D4e5F6g7', object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid',
  currency: 'pln', amount_subtotal: 1499, amount_total: 1499, payment_link: 'plink_1TestLink', client_reference_id: REF,
  livemode: true, created: NOW - 60
});

let stripeCalls = [];
function mockStripe(session, status = 200) {
  globalThis.fetch = async (url, init) => {
    stripeCalls.push({ url, auth: init && init.headers && init.headers.Authorization });
    return { ok: status >= 200 && status < 300, status, json: async () => session };
  };
}
async function call(query, env = ENV, method = 'GET') {
  const res = await onRequest({ request: new Request('https://odprawa.example/api/verify' + query, { method }), env });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

console.log('isConfigured');
check('restricted live key + payment link → ready', isConfigured(ENV));
check('FULL secret key sk_ is refused', !isConfigured({ ...ENV, STRIPE_SECRET_KEY: 'sk_live_abc123' }));
check('missing PAYMENT_LINK_ID → not ready', !isConfigured({ STRIPE_SECRET_KEY: 'rk_live_abc123' }));
check('empty env → not ready', !isConfigured({}));

console.log('evaluateSession');
check('valid paid session', evaluateSession(good(), REF, ENV, NOW).paid === true);
const bad = (patch, name) => check(name, evaluateSession({ ...good(), ...patch }, REF, ENV, NOW).paid === false, patch);
bad({ payment_status: 'unpaid' }, 'unpaid rejected');
bad({ payment_status: 'no_payment_required' }, '100% discount (no payment) rejected');
bad({ status: 'open' }, 'open session rejected');
bad({ status: 'expired' }, 'expired session rejected');
bad({ currency: 'eur' }, 'wrong currency rejected');
bad({ amount_subtotal: 100 }, 'wrong price rejected');
bad({ amount_total: 0 }, 'zero total rejected');
bad({ payment_link: 'plink_OTHER' }, 'session from another product/link rejected');
bad({ client_reference_id: 'wSOMEONEELSE0000000000000000000000' }, 'ref mismatch (shared link) rejected');
bad({ client_reference_id: null }, 'payment made outside the site (no ref) rejected');
bad({ livemode: false }, 'test-mode payment rejected in production');
bad({ object: 'payment_intent' }, 'wrong object rejected');
bad({ mode: 'subscription' }, 'wrong mode rejected');
check('test-mode accepted only with ALLOW_TEST_MODE=true', evaluateSession({ ...good(), livemode: false }, REF, { ...ENV, ALLOW_TEST_MODE: 'true' }, NOW).paid === true);
const old = evaluateSession({ ...good(), created: NOW - 31 * 86400 }, REF, ENV, NOW);
check('older than 30 days → expired', old.paid === false && old.error === 'expired', old);
check('garbage input', evaluateSession(null, REF, ENV, NOW).paid === false && evaluateSession('x', REF, ENV, NOW).paid === false);

console.log('HTTP handler');
mockStripe(good());
let r = await call('?ping=1');
check('ping ready', r.status === 200 && r.body.ready === true, r);
r = await call('?ping=1', { STRIPE_SECRET_KEY: 'sk_live_x', PAYMENT_LINK_ID: 'plink_1' });
check('ping with sk_ key → not ready', r.body.ready === false, r);
stripeCalls = [];
r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`);
check('paid → 200 {paid:true}', r.status === 200 && r.body.paid === true, r);
check('Stripe called once with Bearer restricted key', stripeCalls.length === 1 && stripeCalls[0].auth === 'Bearer rk_live_abc123' && stripeCalls[0].url === 'https://api.stripe.com/v1/checkout/sessions/cs_live_a1B2c3D4e5F6g7', stripeCalls);
check('no-store + nosniff headers', r.headers.get('cache-control') === 'no-store' && r.headers.get('x-content-type-options') === 'nosniff');
check('response leaks no session data', JSON.stringify(r.body) === '{"paid":true}', r.body);
stripeCalls = [];
r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=wWRONGWRONGWRONGWRONG`);
check('wrong ref → paid:false', r.body.paid === false, r);
stripeCalls = [];
r = await call(`?session_id=../../v1/customers&ref=${REF}`);
check('path traversal in session_id → 400, Stripe not called', r.status === 400 && stripeCalls.length === 0, r);
r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${encodeURIComponent('<script>')}`);
check('malformed ref → 400', r.status === 400, r);
r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7`);
check('missing ref → 400', r.status === 400, r);
r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`, { STRIPE_SECRET_KEY: 'sk_live_full', PAYMENT_LINK_ID: 'plink_1TestLink' });
check('sk_ key configured → 503, refuses to work', r.status === 503 && r.body.paid === false, r);
r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`, ENV, 'POST');
check('POST → 405', r.status === 405, r);
mockStripe({ error: { message: 'No such checkout.session' } }, 404);
r = await call(`?session_id=cs_live_zzzzzzzzzzzz&ref=${REF}`);
check('unknown session → 200 paid:false (no detail leaked)', r.status === 200 && JSON.stringify(r.body) === '{"paid":false}', r);
mockStripe({}, 500);
r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`);
check('Stripe error → 502 paid:false', r.status === 502 && r.body.paid === false, r);
globalThis.fetch = async () => { throw new Error('network'); };
r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`);
check('network failure → 502 paid:false', r.status === 502 && r.body.paid === false, r);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL VERIFY TESTS PASSED');
process.exit(failures ? 1 : 0);
