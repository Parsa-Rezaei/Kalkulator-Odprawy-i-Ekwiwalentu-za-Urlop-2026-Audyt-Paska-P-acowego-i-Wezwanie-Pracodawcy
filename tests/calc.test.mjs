// Testy silnika obliczeń: npm test (Node 18+)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../assets/calc.js', import.meta.url), 'utf8');
const sandbox = {};
vm.runInNewContext(code, sandbox);
const C = sandbox.OdprawaCalc;
const d = C.parseDate;
// obiekty z innego kontekstu vm porównujemy jako zwykłe dane
const plain = (x) => JSON.parse(JSON.stringify(x));

function state(over = {}) {
  return {
    start: d('2018-07-01'), end: d('2026-09-30'), notice: d('2026-06-15'), extraY: 0, extraM: 0, extraD: 0,
    etat: 1, norma: 8, employer20: true, reason: 'wypowiedzenie', retire: false, under26: false,
    fixed: 6000, fixedOther: 0, v: [1000, 1100, 900], topUp: false, dw: [0, 0, 0], dn: [0, 0, 0], long12: 2400,
    leaveMode: 'days', leaveDays: 10, leaveHours: 0, payDay: 10, payMode: 'next',
    pitRate: 12, pit2: false, kup: 0, paidEkw: 2868, paidOdp: 18000, paidEmer: null, empBase: 6000,
    dueEkwOv: null, dueOdpOv: null, calcDate: d('2026-10-24'), rate: 9.25, ...over
  };
}

test('współczynnik ekwiwalentowy 2022–2027', () => {
  const c = (s) => C.coefficientFor(d(s));
  assert.equal(c('2022-06-30').coef, 20.92);
  assert.equal(c('2023-06-30').coef, 20.83);
  assert.equal(c('2024-06-30').coef, 20.92);
  assert.equal(c('2025-01-31').coef, 20.83);
  assert.equal(c('2025-06-30').coef, 20.75);
  assert.equal(c('2026-06-30').coef, 20.92);
  assert.equal(c('2026-06-30').workingDays, 251);
  assert.equal(c('2027-03-31').coef, 20.92);
  assert.equal(c('2027-03-31').workingDays, 251);
});

test('płaca minimalna i limit odprawy', () => {
  assert.equal(C.minWageOn(d('2026-12-31')).value, 4806);
  assert.equal(C.minWageOn(d('2027-01-01')).value, 4950);
  assert.equal(C.minWageOn(d('2024-07-01')).value, 4300);
  assert.equal(C.minWageOn(d('2028-01-01')).known, false);
});

test('progi stażu 2 i 8 lat (z okresem wypowiedzenia)', () => {
  const m = (start, end, over = {}) => C.compute(state({ start: d(start), end: d(end), ...over })).odp;
  assert.equal(m('2018-11-01', '2026-10-31').mult, 2);
  assert.equal(m('2018-11-01', '2026-10-31').daysToOver8, 1);
  assert.equal(m('2018-11-01', '2026-11-01').mult, 3);
  assert.equal(m('2024-11-01', '2026-10-30').mult, 1);
  assert.equal(m('2024-11-01', '2026-10-31').mult, 2);
  assert.equal(m('2019-11-01', '2026-10-31', { extraY: 1, extraD: 1 }).mult, 3);
});

test('przykład B: zaniżona odprawa i ekwiwalent', () => {
  const R = C.compute(state());
  assert.equal(R.base.B, 7200);
  assert.equal(R.ekw.daily, 344.17);
  assert.equal(R.ekw.hourly, 43.02);
  assert.equal(R.ekw.gross, 3441.6);
  assert.equal(R.odp.gross, 21600);
  assert.equal(R.audit.totalShort, 4173.6);
  assert.deepEqual(plain(R.audit.rows.map((r) => [r.key, r.shortfall, r.days, r.interest])), [['ekw', 573.6, 14, 2.04], ['odp', 3600, 24, 21.9]]);
  assert.deepEqual([R.tax.zus, R.tax.health, R.tax.taxEkw, R.tax.taxOdp], [471.84, 267.28, 356, 2592]);
  assert.deepEqual([R.sim.B, R.sim.ekw, R.sim.odp], [6000, 2868, 18000]);
});

test('przykład A: limit 2027 i świadczenia jeszcze niewymagalne', () => {
  const R = C.compute(state({ start: d('2018-10-15'), notice: d('2026-10-20'), end: d('2027-01-31'), fixed: 21000, v: [3400, 3600, 3500], long12: 6000, leaveDays: 11, paidEkw: null, paidOdp: null, empBase: null }));
  assert.equal(R.base.B, 25000);
  assert.equal(R.odp.cap, 74250);
  assert.equal(R.odp.gross, 74250);
  assert.equal(R.audit.allPending, true);
  assert.ok(R.alerts.some((a) => a.title.includes('74 250')));
});

test('termin wypłaty ekwiwalentu (art. 171 § 4–5)', () => {
  const t = (end, day, mode) => { const r = C.ekwDue(d(end), day, mode); return [r.rule, C.isoDate(r.date)]; };
  assert.deepEqual(t('2026-09-30', 10, 'next'), ['payday', '2026-10-10']);
  assert.deepEqual(t('2026-03-31', 26, 'same'), ['10days', '2026-04-10']);
  assert.deepEqual(t('2025-12-31', 10, 'next'), ['old', '2025-12-31']);
  assert.deepEqual(t('2026-02-28', 28, 'same'), ['payday', '2026-02-28']);
});

test('kwota słownie i IBAN', () => {
  assert.equal(C.amountInWords(4173.6), 'cztery tysiące sto siedemdziesiąt trzy złote 60/100');
  assert.equal(C.amountInWords(21600), 'dwadzieścia jeden tysięcy sześćset złotych 00/100');
  assert.equal(C.amountInWords(1002.05), 'tysiąc dwa złote 05/100');
  assert.equal(C.amountInWords(2000000000), 'dwa miliardy złotych 00/100');
  assert.equal(C.ibanValid(C.normIban('PL61 1090 1014 0000 0712 1981 2874')), true);
  assert.equal(C.ibanValid(C.normIban('PL61 1090 1014 0000 0712 1981 2875')), false);
  assert.equal(C.ibanValid(C.normIban('61109010140000071219812874')), true);
});

test('odporność na złośliwe i błędne dane wejściowe', () => {
  assert.equal(C.parseDate('2026-02-31'), null);
  assert.equal(C.parseDate('9999-01-01'), null);
  assert.equal(C.parseDate('<script>'), null);
  assert.equal(C.parseNum('1e400'), 0);
  assert.equal(C.parseNum('abc'), 0);
  assert.equal(C.clamp(NaN, 0, 10), 0);
  assert.equal(C.clamp(Infinity, 0, 10), 0);
  const bad = C.compute(state({ start: null }));
  assert.equal(bad.ok, false);
  const etat = C.compute(state({ etat: 5 }));
  assert.equal(etat.ok, false);
  // Tekst z formularza trafia do pisma jako zwykły tekst – escapowanie robi warstwa HTML
  const R = C.compute(state());
  const W = C.buildLetter(state(), R, { gender: 'm', erName: '<img src=x onerror=alert(1)>', empName: 'A', iban: '', payDays: 7, reasonText: 'x', letterDate: d('2026-10-24') });
  assert.ok(W.intro.includes('<img src=x onerror=alert(1)>'));
});

test('obiekt API jest zamrożony', () => {
  assert.ok(Object.isFrozen(C));
  assert.ok(Object.isFrozen(C.LAW));
  assert.ok(Object.isFrozen(C.LAW.minWage));
});
