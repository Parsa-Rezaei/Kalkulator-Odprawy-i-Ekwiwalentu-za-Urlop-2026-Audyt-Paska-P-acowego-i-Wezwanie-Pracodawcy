/*
 * Silnik obliczeń: przepisy 2026/2027, daty, kwoty, treść wezwania.
 * Czyste funkcje bez dostępu do DOM – testowane w tests/calc.test.mjs.
 */
(function (root) {
  'use strict';

  /* ======================================================================
     STAŁE PRAWNE (stan na 24.10.2026) – aktualizuj raz w roku
     ====================================================================== */
  const LAW = Object.freeze({
    minWage: Object.freeze([
      Object.freeze({ from: '2024-01-01', value: 4242 }),
      Object.freeze({ from: '2024-07-01', value: 4300 }),
      Object.freeze({ from: '2025-01-01', value: 4666 }),
      Object.freeze({ from: '2026-01-01', value: 4806 }),
      Object.freeze({ from: '2027-01-01', value: 4950 }) // rozporządzenie RM z 14.09.2026
    ]),
    minWageKnownUntil: '2027-12-31',
    capMultiplier: 15,
    zus: Object.freeze({ emerytalna: 0.0976, rentowa: 0.015, chorobowa: 0.0245 }),
    health: 0.09,
    pit2Monthly: 300,
    youthLimit: 85528,
    ekwReformFrom: '2026-01-27', // art. 171 § 4–5 K.p.
    wigiliaFrom: '2025-02-01',   // 24 grudnia dniem wolnym od pracy
    interestDefault: 9.25        // od 5.03.2026: 3,75% + 5,5 p.p.
  });

  const DAY = 86400000;
  const MAX_MONEY = 100000000; // 100 mln zł – górny limit każdej kwoty

  /* ======================================================================
     LICZBY I FORMATOWANIE
     ====================================================================== */
  const r2 = (x) => Math.round(Number((x * 100).toPrecision(15))) / 100;
  const r0 = (x) => Math.round(Number(Number(x).toPrecision(15)));
  const clamp = (x, min, max) => (Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : min);

  function parseNum(v) {
    if (v == null) return 0;
    const s = String(v).slice(0, 40).replace(/[\s ]/g, '').replace(/zł/gi, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }
  function parseFrac(v) {
    const s = String(v || '').slice(0, 20).trim().replace(/,/g, '.');
    const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) { const b = parseFloat(m[2]); return b ? parseFloat(m[1]) / b : 0; }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }
  function groupInt(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function fmtN(x, dec = 2) {
    if (!Number.isFinite(x)) x = 0;
    const neg = x < 0;
    const [i, f] = Math.abs(x).toFixed(dec).split('.');
    return (neg ? '−' : '') + groupInt(i) + (dec ? ',' + f : '');
  }
  const fmtZl = (x) => fmtN(x) + ' zł';
  const fmtFrac = (e) => fmtN(e, 4).replace(/0+$/, '').replace(/,$/, '');
  function fmtEtat(e) {
    const known = { 1: 'pełny etat', 0.75: '3/4 etatu', 0.5: '1/2 etatu', 0.25: '1/4 etatu' };
    return known[e] || (fmtFrac(e) + ' etatu');
  }
  function plural(n, one, few, many) {
    if (n === 1) return one;
    const n10 = n % 10, n100 = n % 100;
    return (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) ? few : many;
  }

  /* ======================================================================
     DATY (UTC, bez stref czasowych)
     ====================================================================== */
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (y < 1950 || y > 2100 || mo > 11 || d < 1) return null;
    const t = Date.UTC(y, mo, d);
    return new Date(t).getUTCDate() === d ? t : null; // odrzuca np. 2026-02-31
  }
  const pad = (n) => String(n).padStart(2, '0');
  function isoDate(t) { const d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function fmtDate(t) { const d = new Date(t); return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear(); }
  function todayUTC() { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function dim(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function addYMD(t, y, mo, d) {
    const x = new Date(t);
    let Y = x.getUTCFullYear() + y, M = x.getUTCMonth() + mo;
    Y += Math.floor(M / 12); M = ((M % 12) + 12) % 12;
    return Date.UTC(Y, M, Math.min(x.getUTCDate(), dim(Y, M))) + d * DAY;
  }
  // Różnica w latach/miesiącach/dniach między a (włącznie) i bExcl (wyłącznie)
  function diffYMD(a, bExcl) {
    const A = new Date(a), B = new Date(bExcl);
    let y = B.getUTCFullYear() - A.getUTCFullYear();
    let m = B.getUTCMonth() - A.getUTCMonth();
    let d = B.getUTCDate() - A.getUTCDate();
    if (d < 0) { m--; d += new Date(Date.UTC(B.getUTCFullYear(), B.getUTCMonth(), 0)).getUTCDate(); }
    if (m < 0) { y--; m += 12; }
    return { y, m, d };
  }
  function fmtYMD(o) {
    return `${o.y} ${plural(o.y, 'rok', 'lata', 'lat')}, ${o.m} ${plural(o.m, 'miesiąc', 'miesiące', 'miesięcy')} i ${o.d} ${plural(o.d, 'dzień', 'dni', 'dni')}`;
  }
  function fmtYMDShort(o) { return `${o.y} ${plural(o.y, 'rok', 'lata', 'lat')} ${o.m} mies. ${o.d} ${plural(o.d, 'dzień', 'dni', 'dni')}`; }
  const MONTHS = Object.freeze(['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']);
  const MONTHS_SHORT = Object.freeze(['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']);
  function monthOffset(y, m, k) { const d = new Date(Date.UTC(y, m + k, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; }

  /* ======================================================================
     KWOTA SŁOWNIE, IBAN
     ====================================================================== */
  function wordsPL(n) {
    const U = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
    const T = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
    const D = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
    const H = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
    const G = [null, ['tysiąc', 'tysiące', 'tysięcy'], ['milion', 'miliony', 'milionów'], ['miliard', 'miliardy', 'miliardów']];
    const tri = (x) => {
      const h = Math.floor(x / 100), t = Math.floor((x % 100) / 10), u = x % 10, out = [];
      if (h) out.push(H[h]);
      if (t === 1) out.push(T[u]); else { if (t) out.push(D[t]); if (u) out.push(U[u]); }
      return out.join(' ');
    };
    n = Math.floor(clamp(n, 0, 999999999999));
    if (n === 0) return 'zero';
    const parts = [];
    let g = 0;
    while (n > 0) {
      const x = n % 1000;
      if (x) {
        if (g === 0) parts.unshift(tri(x));
        else if (x === 1) parts.unshift(G[g][0]);
        else parts.unshift(tri(x) + ' ' + plural(x, G[g][0], G[g][1], G[g][2]));
      }
      n = Math.floor(n / 1000); g++;
    }
    return parts.join(' ');
  }
  function amountInWords(x) {
    const zl = Math.floor(r2(x));
    const gr = Math.round(r2(x - zl) * 100);
    return `${wordsPL(zl)} ${plural(zl, 'złoty', 'złote', 'złotych')} ${pad(gr)}/100`;
  }
  function normIban(s) {
    let v = String(s || '').slice(0, 64).replace(/[\s-]/g, '').toUpperCase();
    if (/^\d{26}$/.test(v)) v = 'PL' + v;
    return v;
  }
  function ibanValid(v) {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
    if (v.startsWith('PL') && v.length !== 28) return false;
    const r = v.slice(4) + v.slice(0, 4);
    let mod = 0;
    for (const ch of r) {
      const code = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const c of code) mod = (mod * 10 + Number(c)) % 97;
    }
    return mod === 1;
  }
  const fmtIban = (v) => v.replace(/(.{4})/g, '$1 ').trim();

  /* ======================================================================
     ŚWIĘTA, WSPÓŁCZYNNIK, PŁACA MINIMALNA, TERMINY
     ====================================================================== */
  function easterSunday(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(y, month - 1, day);
  }
  function holidays(y, withWigilia) {
    const E = easterSunday(y);
    const list = [[0, 1], [0, 6], [4, 1], [4, 3], [7, 15], [10, 1], [10, 11], [11, 25], [11, 26]].map(([m, d]) => Date.UTC(y, m, d));
    list.push(E, E + DAY, E + 49 * DAY, E + 60 * DAY); // Wielkanoc, Poniedziałek Wielkanocny, Zielone Świątki, Boże Ciało
    if (withWigilia) list.push(Date.UTC(y, 11, 24));
    return new Set(list);
  }
  // Dni pracy w roku = dni pon.–pt. bez świąt, minus święta przypadające w sobotę
  function workingDays(y, withWigilia) {
    const hs = holidays(y, withWigilia);
    let work = 0, satHol = 0;
    for (let t = Date.UTC(y, 0, 1); t <= Date.UTC(y, 11, 31); t += DAY) {
      const dow = new Date(t).getUTCDay();
      if (dow >= 1 && dow <= 5 && !hs.has(t)) work++;
      if (dow === 6 && hs.has(t)) satHol++;
    }
    return work - satHol;
  }
  function coefficientFor(end) {
    const y = new Date(end).getUTCFullYear();
    const withW = end >= parseDate(LAW.wigiliaFrom);
    const wd = workingDays(y, withW);
    return { year: y, workingDays: wd, coef: r2(wd / 12), wigilia: withW };
  }
  function minWageOn(t) {
    let found = null;
    for (const row of LAW.minWage) if (t >= parseDate(row.from)) found = row;
    const row = found || LAW.minWage[0];
    return { value: row.value, from: row.from, known: !!found && t <= parseDate(LAW.minWageKnownUntil) };
  }
  function ekwDue(end, payDay, payMode) {
    if (end < parseDate(LAW.ekwReformFrom)) return { date: end, rule: 'old' };
    const d = new Date(end);
    let y = d.getUTCFullYear(), m = d.getUTCMonth();
    if (payMode === 'next') { m++; if (m > 11) { m = 0; y++; } }
    const payday = Date.UTC(y, m, Math.min(payDay, dim(y, m)));
    if (payday < end) return { date: end + 10 * DAY, rule: '10days', payday };
    return { date: payday, rule: 'payday', payday };
  }

  /* ======================================================================
     OBLICZENIA GŁÓWNE
     ====================================================================== */
  function compute(S) {
    const R = { ok: false, errors: [], alerts: [] };
    if (!S.start || !S.end) { R.errors.push('Podaj datę rozpoczęcia pracy i datę rozwiązania umowy (lata 1950–2100).'); return R; }
    if (S.end < S.start) { R.errors.push('Data rozwiązania umowy nie może być wcześniejsza niż data rozpoczęcia pracy.'); return R; }
    if (!(S.etat > 0 && S.etat <= 1)) { R.errors.push('Wymiar etatu musi być większy od 0 i nie większy niż 1 (np. 3/5 lub 0,6).'); return R; }

    const endD = new Date(S.end), ey = endD.getUTCFullYear(), em = endD.getUTCMonth();

    // --- Podstawa wymiaru ---
    const months3 = [-3, -2, -1].map((k) => monthOffset(ey, em, k));
    const m12a = monthOffset(ey, em, -12), m12b = monthOffset(ey, em, -1);
    const fixedTotal = r2(S.fixed + S.fixedOther);
    const varSum = r2(S.v[0] + S.v[1] + S.v[2]);
    const dwSum = S.dw.reduce((a, b) => a + b, 0), dnSum = S.dn.reduce((a, b) => a + b, 0);
    let varBase = varSum, topUpUsed = false;
    if (S.topUp && varSum > 0 && dwSum > 0 && dnSum > dwSum) { varBase = r2(varSum / dwSum * dnSum); topUpUsed = true; }
    const varAvg = r2(varBase / 3);
    const longAvg = r2(S.long12 / 12);
    const B = r2(fixedTotal + varAvg + longAvg);
    R.base = { months3, m12a, m12b, fixedTotal, varSum, varBase, varAvg, longAvg, B, topUpUsed, dwSum, dnSum };

    // --- Moduł A: ekwiwalent ---
    const C = coefficientFor(S.end);
    const coefEtat = r2(C.coef * S.etat);
    const hours = S.leaveMode === 'hours' ? r2(S.leaveHours) : r2(S.leaveDays * S.norma);
    const daily = coefEtat > 0 ? r2(B / coefEtat) : 0;
    const hourly = r2(daily / S.norma);
    const ekwGross = r2(hourly * hours);
    const due = ekwDue(S.end, S.payDay, S.payMode);
    R.ekw = { C, coefEtat, hours, daily, hourly, gross: ekwGross, due };

    // --- Moduł B: staż i odprawa ---
    const effStart = addYMD(S.start, -S.extraY, -S.extraM, -S.extraD);
    const endExcl = S.end + DAY;
    const tenure = diffYMD(effStart, endExcl);
    const t2 = addYMD(effStart, 2, 0, 0), t8 = addYMD(effStart, 8, 0, 0);
    const mult = endExcl < t2 ? 1 : (endExcl <= t8 ? 2 : 3);
    const daysTo2 = Math.round((t2 - endExcl) / DAY);           // > 0: brakuje dni do pełnych 2 lat
    const daysToOver8 = Math.round((t8 + DAY - endExcl) / DAY); // > 0: brakuje dni do „ponad 8 lat”
    const daysOver8 = Math.round((endExcl - t8) / DAY);         // > 0: o tyle dni przekroczono 8 lat
    const eligible = S.employer20 && (S.reason === 'wypowiedzenie' || S.reason === 'porozumienie');
    const mw = minWageOn(S.end);
    const cap = r2(LAW.capMultiplier * mw.value);
    const raw = r2(mult * B);
    const odpGross = eligible ? Math.min(raw, cap) : 0;
    R.odp = { effStart, tenure, mult, daysTo2, daysToOver8, daysOver8, eligible, mw, cap, raw, gross: odpGross, capped: eligible && raw > cap };
    R.emer = { gross: S.retire ? B : 0 };

    // --- Podatki i składki ---
    const zE = r2(ekwGross * LAW.zus.emerytalna), zR = r2(ekwGross * LAW.zus.rentowa), zC = r2(ekwGross * LAW.zus.chorobowa);
    const zus = r2(zE + zR + zC);
    const health = r2((ekwGross - zus) * LAW.health);
    const rate = S.pitRate / 100;
    const ekwTaxBase = r2(ekwGross - zus);
    const taxEkw = r0(r0(ekwTaxBase) * rate);
    const taxOdp = r0(r0(odpGross) * rate);
    const taxEmer = r0(r0(R.emer.gross) * rate);
    const sumBase = ekwTaxBase + odpGross + R.emer.gross;
    const pit2 = S.pit2 && S.pitRate === 12 ? LAW.pit2Monthly : 0;
    const totalTax = sumBase > 0 ? Math.max(0, r0(r0(Math.max(0, sumBase - S.kup)) * rate - pit2)) : 0;
    const taxCorr = totalTax - (taxEkw + taxOdp + taxEmer);
    R.tax = {
      zE, zR, zC, zus, health, rate: S.pitRate, taxEkw, taxOdp, taxEmer, totalTax, taxCorr, pit2, kup: S.kup,
      ekwNet: r2(ekwGross - zus - health - taxEkw),
      odpNet: r2(odpGross - taxOdp),
      emerNet: r2(R.emer.gross - taxEmer),
      grossTotal: r2(ekwGross + odpGross + R.emer.gross),
      netTotal: r2(ekwGross + odpGross + R.emer.gross - zus - health - totalTax)
    };

    // --- Audyt i odsetki ---
    const rows = [];
    const addRow = (key, label, title, correct, paid, dueDate, dueNote) => {
      const paidV = paid == null ? 0 : paid;
      const shortfall = Math.max(0, r2(correct - paidV));
      const days = Math.max(0, Math.round((S.calcDate - dueDate) / DAY));
      const interest = r2(shortfall * S.rate / 100 * days / 365);
      const pending = paid == null && S.calcDate <= dueDate; // nic nie wypłacono, ale termin jeszcze nie minął
      rows.push({ key, label, title, correct, paid, paidV, shortfall, overpaid: r2(paidV - correct) > 0 ? r2(paidV - correct) : 0, due: dueDate, dueNote, days, interest, pending });
    };
    if (ekwGross > 0 || S.paidEkw != null) {
      addRow('ekw', 'Ekwiwalent za urlop', 'ekwiwalentu pieniężnego za niewykorzystany urlop wypoczynkowy', ekwGross, S.paidEkw, S.dueEkwOv || due.date, S.dueEkwOv ? 'data wskazana' : due.rule);
    }
    if (eligible) addRow('odp', 'Odprawa pieniężna', 'odprawy pieniężnej z tytułu rozwiązania stosunku pracy z przyczyn niedotyczących pracownika', odpGross, S.paidOdp, S.dueOdpOv || S.end, S.dueOdpOv ? 'data wskazana' : 'end');
    if (S.retire) addRow('emer', 'Odprawa emerytalno-rentowa', 'odprawy emerytalno-rentowej', R.emer.gross, S.paidEmer, S.end, 'end');
    const totalShort = r2(rows.reduce((a, r) => a + r.shortfall, 0));
    const totalInterest = r2(rows.reduce((a, r) => a + r.interest, 0));
    const allPending = rows.length > 0 && rows.every((r) => r.pending || r.shortfall === 0);
    R.audit = { rows, totalShort, totalInterest, rate: S.rate, calcDate: S.calcDate, allPending };

    // Symulacja błędu pracodawcy (tylko składniki stałe)
    const eB = fixedTotal;
    const eDaily = coefEtat > 0 ? r2(eB / coefEtat) : 0;
    R.sim = { B: eB, ekw: r2(r2(eDaily / S.norma) * hours), odp: eligible ? Math.min(r2(mult * eB), cap) : 0, emer: S.retire ? eB : 0 };

    // --- Ostrzeżenia i podpowiedzi ---
    const A = R.alerts;
    if (eligible && mult === 2 && daysToOver8 > 0 && daysToOver8 <= 120) {
      A.push({ tone: 'amber', title: `Do przekroczenia 8 lat stażu brakuje ${daysToOver8} ${plural(daysToOver8, 'dnia', 'dni', 'dni')}`, text: `Przy stażu ponad 8 lat (już 8 lat i 1 dzień) odprawa rośnie z 2× do 3× podstawy – w Twoim przypadku o ${fmtZl(Math.min(r2(3 * B), cap) - odpGross)}. Sprawdź, czy do stażu nie należy doliczyć wcześniejszych okresów zatrudnienia u tego pracodawcy lub okresu objętego odszkodowaniem za skrócone wypowiedzenie.` });
    }
    if (eligible && mult === 3 && daysOver8 > 0 && daysOver8 <= 120) {
      A.push({ tone: 'emerald', title: `Przekraczasz próg 8 lat o ${daysOver8} ${plural(daysOver8, 'dzień', 'dni', 'dni')} – należy się odprawa trzymiesięczna`, text: 'Staż liczy się do ostatniego dnia okresu wypowiedzenia. Jeśli pracodawca policzył 2× podstawę, bo liczył staż do dnia wręczenia wypowiedzenia – to błąd.' });
    }
    if (eligible && mult === 1 && daysTo2 > 0 && daysTo2 <= 90) {
      A.push({ tone: 'amber', title: `Do 2 lat stażu brakuje ${daysTo2} ${plural(daysTo2, 'dnia', 'dni', 'dni')}`, text: `Przy stażu co najmniej 2 lat odprawa wynosi 2× podstawę (różnica: ${fmtZl(Math.min(r2(2 * B), cap) - odpGross)}).` });
    }
    if (eligible && S.notice && new Date(S.notice).getUTCFullYear() === 2026 && ey === 2027) {
      const gain = r2(Math.min(raw, cap) - Math.min(raw, r2(LAW.capMultiplier * minWageOn(Date.UTC(2026, 11, 31)).value)));
      A.push({ tone: 'emerald', title: 'Wypowiedzenie w 2026 r., rozwiązanie umowy w 2027 r. – obowiązuje wyższy limit 74 250 zł', text: `Limit odprawy ustala się według płacy minimalnej z dnia rozwiązania stosunku pracy (art. 8 ust. 4 ustawy), a nie z dnia wręczenia wypowiedzenia. ${gain > 0 ? `W Twoim przypadku to o ${fmtZl(gain)} więcej niż przy limicie 2026 r. (72 090 zł).` : 'W Twoim przypadku odprawa mieści się poniżej obu limitów.'}` });
    }
    if (eligible && ey === 2026 && raw > cap) {
      A.push({ tone: 'sky', title: 'Odprawa ograniczona limitem 2026 r. (72 090 zł)', text: `Bez limitu wynosiłaby ${fmtZl(raw)}. Dla umów rozwiązanych w 2027 r. limit wynosi 74 250 zł (15 × 4950 zł).` });
    }
    if (!mw.known) A.push({ tone: 'amber', title: 'Brak potwierdzonej płacy minimalnej dla tej daty', text: `Przyjęto ${fmtZl(mw.value)} (najbliższa znana wartość). Zweryfikuj limit odprawy w aktualnym rozporządzeniu.` });
    if (!S.employer20 && (S.reason === 'wypowiedzenie' || S.reason === 'porozumienie')) A.push({ tone: 'slate', title: 'Ustawowa odprawa nie przysługuje – pracodawca zatrudnia mniej niż 20 osób', text: 'Sprawdź jednak regulamin wynagradzania, układ zbiorowy lub umowę – mogą przewidywać odprawę.' });
    if (S.reason === 'inne') A.push({ tone: 'slate', title: 'Ustawowa odprawa z art. 8 nie przysługuje przy tej przyczynie rozwiązania umowy', text: 'Odprawa przysługuje, gdy umowę rozwiązano wyłącznie z przyczyn niedotyczących pracownika – wypowiedzeniem pracodawcy lub porozumieniem stron. Ekwiwalent za urlop należy się niezależnie od przyczyny.' });
    if (due.rule === 'old') A.push({ tone: 'slate', title: 'Rozwiązanie umowy przed 27.01.2026 r.', text: 'Dla umów rozwiązanych przed nowelizacją ekwiwalent był co do zasady wymagalny w dniu rozwiązania stosunku pracy.' });
    if (S.under26) A.push({ tone: 'slate', title: 'Ulga dla młodych: 0% PIT', text: `Zwolnienie obejmuje przychody ze stosunku pracy do ${fmtZl(LAW.youthLimit)} w roku podatkowym. Nadwyżka jest opodatkowana według skali.` });
    if (S.etat === 1 && B > 0 && B < mw.value) A.push({ tone: 'amber', title: 'Podstawa niższa niż płaca minimalna', text: 'Sprawdź wpisane kwoty – przy pełnym etacie wynagrodzenie zasadnicze z reguły nie jest niższe niż płaca minimalna.' });

    R.ok = true;
    return R;
  }

  /* Urlop proporcjonalny w roku rozwiązania umowy */
  function leaveHelperCalc(S, annual, carry, used) {
    if (!S.start || !S.end || !(S.etat > 0 && S.etat <= 1)) return null;
    const ey = new Date(S.end).getUTCFullYear();
    const from = Math.max(S.start, Date.UTC(ey, 0, 1));
    const months = new Date(S.end).getUTCMonth() - new Date(from).getUTCMonth() + 1;
    const annualEtat = Math.ceil(r2(annual * S.etat));
    const prop = Math.min(annualEtat, Math.ceil(r2(annualEtat * months / 12)));
    const days = r2(carry + Math.max(0, prop - used));
    return { annual, annualEtat, months, prop, carry, used, days, ey };
  }

  /* Wiersze dowodu matematycznego (wspólne dla strony i PDF): [opis, wzór, wynik] */
  function proofRows(S, R) {
    const b = R.base, e = R.ekw, o = R.odp;
    const base = [
      ['Składniki stałe (miesiąc rozwiązania umowy)', `${fmtN(S.fixed)} + ${fmtN(S.fixedOther)}`, fmtZl(b.fixedTotal)],
      [`Składniki zmienne – średnia z 3 mies. (${b.months3.map((x) => MONTHS_SHORT[x.m] + ' ' + x.y).join(', ')})`,
        b.topUpUsed ? `(${fmtN(b.varSum)} ÷ ${fmtN(b.dwSum, 0)} dni × ${fmtN(b.dnSum, 0)} dni) ÷ 3` : `(${S.v.map((x) => fmtN(x)).join(' + ')}) ÷ 3`, fmtZl(b.varAvg)],
      [`Składniki za okresy > 1 mies. – średnia z 12 mies. (${MONTHS_SHORT[b.m12a.m]} ${b.m12a.y} – ${MONTHS_SHORT[b.m12b.m]} ${b.m12b.y})`, `${fmtN(S.long12)} ÷ 12`, fmtZl(b.longAvg)],
      ['Podstawa wymiaru (miesięczna)', 'suma składników', fmtZl(b.B)]
    ];
    const dueTxt = e.due.rule === 'payday' ? 'termin wypłaty wynagrodzenia (art. 171 § 4 K.p.)'
      : e.due.rule === '10days' ? `10 dni od rozwiązania – pensja płatna ${fmtDate(e.due.payday)} (art. 171 § 5 K.p.)`
        : 'dzień rozwiązania stosunku pracy (przed 27.01.2026)';
    const hrs = fmtN(e.hours, e.hours % 1 ? 2 : 0);
    const ekw = [
      [`Współczynnik ekwiwalentowy (rok ${e.C.year}, ${fmtEtat(S.etat)})`, `${e.C.workingDays} dni pracy ÷ 12 = ${fmtN(e.C.coef)}${S.etat !== 1 ? ` × ${fmtFrac(S.etat)}` : ''}`, fmtN(e.coefEtat)],
      ['Stawka dzienna', `zaokr.(${fmtN(b.B)} ÷ ${fmtN(e.coefEtat)}; 2)`, fmtZl(e.daily)],
      ['Stawka godzinowa', `zaokr.(${fmtN(e.daily)} ÷ ${S.norma} h; 2)`, fmtZl(e.hourly)],
      ['Godziny niewykorzystanego urlopu', S.leaveMode === 'hours' ? 'podane w godzinach' : `${fmtN(S.leaveDays, S.leaveDays % 1 ? 2 : 0)} dni × ${S.norma} h`, `${hrs} h`],
      ['Ekwiwalent brutto', `${fmtN(e.hourly)} × ${hrs} h`, fmtZl(e.gross)],
      ['Termin wypłaty', dueTxt, fmtDate(e.due.date)]
    ];
    const multTxt = { 1: 'staż krótszy niż 2 lata: 1×', 2: 'staż od 2 do 8 lat: 2×', 3: 'staż ponad 8 lat: 3×' }[o.mult];
    const extra = S.extraY || S.extraM || S.extraD ? ` (w tym dodatkowo ${S.extraY} l. ${S.extraM} mies. ${S.extraD} dni)` : '';
    const odp = [
      ['Staż u pracodawcy (wraz z okresem wypowiedzenia)', `${fmtDate(S.start)} – ${fmtDate(S.end)}${extra}`, fmtYMDShort(o.tenure)],
      ['Mnożnik odprawy', multTxt, `${o.mult}×`],
      ['Odprawa przed limitem', `${o.mult} × ${fmtN(b.B)}`, fmtZl(o.raw)],
      [`Limit: 15 × płaca minimalna z dnia rozwiązania (${fmtDate(S.end)})`, `15 × ${fmtN(o.mw.value)}`, fmtZl(o.cap)],
      ['Odprawa należna (brutto)', `min(${fmtN(o.raw)}; ${fmtN(o.cap)})`, fmtZl(o.gross)]
    ];
    const emer = [['Odprawa emerytalno-rentowa (art. 92¹ K.p.)', `1 × ${fmtN(b.B)}`, fmtZl(R.emer.gross)]];
    return { base, ekw, odp, emer };
  }

  /* Treść wezwania do zapłaty (wspólna dla podglądu i PDF). Zwraca wyłącznie tekst – bez HTML. */
  function buildLetter(S, R, L) {
    const f = L.gender === 'f';
    const g = (m, w) => (f ? w : m);
    const er = L.erName || '[nazwa pracodawcy]';
    const items = R.audit.rows.filter((r) => r.shortfall > 0);
    const total = R.audit.totalShort;
    const anyPaid = items.some((r) => r.paid != null && r.paid > 0);
    const kinds = items.map((r) => r.key);
    const subjParts = [];
    if (kinds.includes('odp')) subjParts.push('odprawy pieniężnej');
    if (kinds.includes('emer')) subjParts.push('odprawy emerytalno-rentowej');
    if (kinds.includes('ekw')) subjParts.push('ekwiwalentu pieniężnego za niewykorzystany urlop wypoczynkowy');
    const subtitle = (anyPaid ? 'o zapłatę wyrównania ' : 'o zapłatę ') + subjParts.join(' oraz ');
    const iban = L.iban ? fmtIban(L.iban) : '[numer rachunku]';

    const intro = `Działając we własnym imieniu, wzywam Pracodawcę – ${er} (dalej: „Pracodawca”) – do zapłaty na moją rzecz łącznej kwoty ${fmtZl(total)} brutto (słownie: ${amountInWords(total)}) tytułem:`;
    const list = items.map((r, i) => `${r.paid != null && r.paid > 0 ? 'wyrównania ' : ''}${r.title} – ${fmtZl(r.shortfall)} brutto, wraz z odsetkami ustawowymi za opóźnienie od dnia ${fmtDate(r.due + DAY)} do dnia zapłaty${i < items.length - 1 ? ';' : ''}`);
    const deadline = `– w terminie ${L.payDays} ${plural(L.payDays, 'dnia', 'dni', 'dni')} od dnia doręczenia niniejszego wezwania, przelewem na rachunek bankowy nr ${iban}${L.empName ? ' (posiadacz: ' + L.empName + ')' : ''}.`;

    const just = [];
    const how = S.reason === 'wypowiedzenie' ? 'w wyniku wypowiedzenia dokonanego przez Pracodawcę' : S.reason === 'porozumienie' ? 'na mocy porozumienia stron' : '';
    just.push(`W okresie od ${fmtDate(S.start)} do ${fmtDate(S.end)} ${g('byłem zatrudniony', 'byłam zatrudniona')} u Pracodawcy na podstawie umowy o pracę${S.etat !== 1 ? ' w wymiarze ' + fmtEtat(S.etat) : ''}. Stosunek pracy uległ rozwiązaniu z dniem ${fmtDate(S.end)}${how ? ' ' + how : ''}${S.notice ? ` (oświadczenie doręczone ${fmtDate(S.notice)})` : ''}${S.reason !== 'inne' ? `, wyłącznie z przyczyn niedotyczących pracownika (${L.reasonText})` : ''}.`);
    const b = R.base;
    let baseTxt = `Podstawę wymiaru ekwiwalentu i odprawy ustala się według rozporządzenia Ministra Pracy i Polityki Socjalnej z dnia 8 stycznia 1997 r. w sprawie szczegółowych zasad udzielania urlopu wypoczynkowego, ustalania i wypłacania wynagrodzenia za czas urlopu oraz ekwiwalentu pieniężnego za urlop. Obejmuje ona składniki stałe w wysokości należnej w miesiącu rozwiązania stosunku pracy, składniki zmienne przysługujące za okresy nie dłuższe niż miesiąc (premie regulaminowe, prowizje, wynagrodzenie za pracę w godzinach nadliczbowych) – w średniej wysokości z 3 miesięcy poprzedzających miesiąc rozwiązania stosunku pracy – oraz składniki przysługujące za okresy dłuższe niż miesiąc – w średniej wysokości z 12 miesięcy. Prawidłowa podstawa wynosi ${fmtZl(b.B)} (składniki stałe ${fmtZl(b.fixedTotal)}, średnia składników zmiennych ${fmtZl(b.varAvg)}, średnia składników za okresy dłuższe niż miesiąc ${fmtZl(b.longAvg)}).`;
    if (S.empBase != null && S.empBase < b.B) baseTxt += ` Pracodawca przyjął do obliczeń podstawę ${fmtZl(S.empBase)}, pomijając część składników wynagrodzenia, co jest niezgodne z powołanymi przepisami.`;
    just.push(baseTxt);

    for (const r of items) {
      const paidTxt = r.paid != null && r.paid > 0 ? `Pracodawca wypłacił z tego tytułu ${fmtZl(r.paid)} brutto.` : null;
      if (r.key === 'ekw') {
        const dueRule = R.ekw.due.rule === 'payday' && r.dueNote !== 'data wskazana' ? `w terminie wypłaty wynagrodzenia, tj. ${fmtDate(r.due)} (art. 171 § 4 Kodeksu pracy)`
          : R.ekw.due.rule === '10days' && r.dueNote !== 'data wskazana' ? `w terminie 10 dni od dnia rozwiązania stosunku pracy, tj. do ${fmtDate(r.due)} (art. 171 § 5 Kodeksu pracy)`
            : `w dniu ${fmtDate(r.due)}`;
        just.push(`Zgodnie z art. 171 § 1 Kodeksu pracy przysługuje mi ekwiwalent pieniężny za niewykorzystany urlop wypoczynkowy w wymiarze ${fmtN(R.ekw.hours, R.ekw.hours % 1 ? 2 : 0)} godz. Przy zastosowaniu współczynnika ${fmtN(R.ekw.coefEtat)} (§ 19 ww. rozporządzenia; rok ${R.ekw.C.year}, ${fmtEtat(S.etat)}) stawka za jeden dzień urlopu wynosi ${fmtZl(R.ekw.daily)}, za jedną godzinę – ${fmtZl(R.ekw.hourly)}, a należny ekwiwalent – ${fmtZl(R.ekw.gross)} brutto. ${paidTxt || 'Pracodawca nie wypłacił ekwiwalentu.'} Ekwiwalent należało wypłacić ${dueRule}.`);
      }
      if (r.key === 'odp') {
        const multW = { 1: 'jednomiesięcznego', 2: 'dwumiesięcznego', 3: 'trzymiesięcznego' }[R.odp.mult];
        const threshold = { 1: 'krótszy niż 2 lata', 2: 'od 2 do 8 lat', 3: 'ponad 8 lat' }[R.odp.mult];
        just.push(`Pracodawca zatrudnia co najmniej 20 pracowników, a przyczyny niedotyczące pracowników stanowiły wyłączny powód rozwiązania ze mną stosunku pracy. Przysługuje mi zatem odprawa pieniężna na podstawie art. 8 ust. 1 ustawy z dnia 13 marca 2003 r. o szczególnych zasadach rozwiązywania z pracownikami stosunków pracy z przyczyn niedotyczących pracowników (w przypadku zwolnienia indywidualnego – w zw. z art. 10 ust. 1 tej ustawy). Mój okres zatrudnienia u Pracodawcy, liczony do dnia rozwiązania stosunku pracy, wyniósł ${fmtYMD(R.odp.tenure)}, a więc ${threshold}, wobec czego odprawa wynosi równowartość ${multW} wynagrodzenia obliczanego jak ekwiwalent za urlop: ${R.odp.mult} × ${fmtZl(b.B)} = ${fmtZl(R.odp.raw)}${R.odp.capped ? `, ograniczoną do limitu 15-krotności minimalnego wynagrodzenia obowiązującego w dniu rozwiązania stosunku pracy, tj. ${fmtZl(R.odp.cap)} (art. 8 ust. 4 ustawy)` : `. Kwota ta nie przekracza limitu 15-krotności minimalnego wynagrodzenia obowiązującego w dniu rozwiązania stosunku pracy (${fmtZl(R.odp.cap)}; art. 8 ust. 4 ustawy)`}. ${paidTxt || 'Pracodawca nie wypłacił odprawy.'} Odprawa stała się wymagalna z dniem ${fmtDate(r.due)}.`);
      }
      if (r.key === 'emer') {
        just.push(`Na podstawie art. 92¹ Kodeksu pracy, w związku z ustaniem stosunku pracy w związku z przejściem na emeryturę lub rentę, przysługuje mi odprawa pieniężna w wysokości jednomiesięcznego wynagrodzenia, tj. ${fmtZl(R.emer.gross)} brutto. ${paidTxt || 'Pracodawca nie wypłacił odprawy.'}`);
      }
    }
    just.push(`Łączna kwota niedopłaty wynosi ${fmtZl(total)} brutto. Szczegółowe wyliczenie krok po kroku zawiera załącznik do niniejszego wezwania.`);
    just.push(`Na podstawie art. 481 § 1 i 2 Kodeksu cywilnego w zw. z art. 300 Kodeksu pracy od kwot niedopłaty należą się odsetki ustawowe za opóźnienie (${fmtN(R.audit.rate)}% w skali roku), które na dzień ${fmtDate(R.audit.calcDate)} wynoszą łącznie ${fmtZl(R.audit.totalInterest)} i są naliczane do dnia zapłaty.`);
    just.push('W przypadku bezskutecznego upływu wyznaczonego terminu skieruję sprawę do właściwego Sądu Rejonowego – Sądu Pracy bez ponownego wezwania, co narazi Pracodawcę na obowiązek zwrotu kosztów postępowania, oraz złożę skargę do Państwowej Inspekcji Pracy. Przypominam, że niewypłacenie w ustalonym terminie wynagrodzenia za pracę lub innego świadczenia przysługującego pracownikowi stanowi wykroczenie przeciwko prawom pracownika (art. 282 § 1 pkt 1 Kodeksu pracy).');

    return { subtitle, intro, list, deadline, just, total, items };
  }

  root.OdprawaCalc = Object.freeze({
    LAW, DAY, MAX_MONEY, MONTHS, MONTHS_SHORT,
    r2, r0, clamp, parseNum, parseFrac, fmtN, fmtZl, fmtFrac, fmtEtat, plural,
    parseDate, isoDate, fmtDate, todayUTC, dim, addYMD, diffYMD, fmtYMD, fmtYMDShort, monthOffset,
    wordsPL, amountInWords, normIban, ibanValid, fmtIban,
    easterSunday, holidays, workingDays, coefficientFor, minWageOn, ekwDue,
    compute, leaveHelperCalc, proofRows, buildLetter
  });
})(typeof window !== 'undefined' ? window : globalThis);
