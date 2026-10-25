/*
 * Interfejs kalkulatora: formularz, wyniki, podgląd wezwania, PDF, okno płatności.
 * Cały kod działa w przeglądarce; nic nie jest wysyłane na serwer.
 */
(function () {
  'use strict';

  /* Ochrona przed osadzaniem strony w cudzej ramce (clickjacking). */
  if (window.top !== window.self) {
    document.body.textContent = '';
    const p = document.createElement('p');
    p.style.cssText = 'font:16px system-ui,sans-serif;padding:24px';
    const a = document.createElement('a');
    a.href = window.location.href; a.target = '_top'; a.rel = 'noopener';
    a.textContent = 'Otwórz kalkulator w nowym oknie';
    p.append('Ta strona nie może być wyświetlana w ramce. ', a);
    document.body.append(p);
    return;
  }

  const C = window.OdprawaCalc;
  const { r2, r0, clamp, parseNum, parseFrac, fmtN, fmtZl, fmtEtat, fmtYMD, plural, parseDate, isoDate, fmtDate, todayUTC, monthOffset, normIban, ibanValid, MONTHS, MAX_MONEY, LAW, DAY } = C;

  /* Pliki pdfmake są hostowane lokalnie (vendor/) i sprawdzane sumą SRI. */
  const PDFMAKE = { src: 'vendor/pdfmake/pdfmake.min.js', integrity: 'sha384-8Fgcdr1c4x0qG8ByTWhXwvf1iBa6tQReFeLNBSkvCN9F+/RZuP1ha8RUydfLSGeG' };
  const VFS = { src: 'vendor/pdfmake/vfs_fonts.js', integrity: 'sha384-ZiMMZvHUP692kyJimOQHoH2VdTrbcEwHaQfitnsxsR8tY0ntoRbPxIA6p+9yNNbz' };

  /* Dozwolone domeny linków płatności (porównanie dokładne lub subdomena). */
  const PAYMENT_HOSTS = ['buycoffee.to', 'stripe.com', 'tpay.com', 'przelewy24.pl', 'paypal.com', 'paypal.me'];
  const STORE_KEY = 'sprawdzodprawe.v2';

  /* ======================================================================
     KONFIGURACJA – walidacja wartości z config.js
     ====================================================================== */
  const RAW = window.SITE_CONFIG || {};
  function safeUrl(u, hosts) {
    if (typeof u !== 'string' || !u) return '';
    let url;
    try { url = new URL(u); } catch (e) { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (hosts && !hosts.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return '';
    return url.href;
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const emailOk = (v) => /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}$/i.test(v);
  const phoneOk = (v) => /^\+?[\d\s()-]{6,20}$/.test(v);
  const law = RAW.lawFirm || {};
  const CONFIG = Object.freeze({
    siteName: str(RAW.siteName, 60) || 'SprawdźOdprawę.pl',
    contactEmail: emailOk(str(RAW.contactEmail, 100)) ? str(RAW.contactEmail, 100) : '',
    pdfPrice: str(RAW.pdfPrice, 20) || '14,99 zł',
    buyCoffeeUrl: safeUrl(RAW.buyCoffeeUrl, ['buycoffee.to']),
    paymentLinkUrl: safeUrl(RAW.paymentLinkUrl, PAYMENT_HOSTS),
    blikPhone: phoneOk(str(RAW.blikPhone, 20)) ? str(RAW.blikPhone, 20) : '',
    paywallMode: ['honor', 'code', 'free'].includes(RAW.paywallMode) ? RAW.paywallMode : 'honor',
    unlockCodeHashes: Object.freeze((Array.isArray(RAW.unlockCodeHashes) ? RAW.unlockCodeHashes : [])
      .map((h) => String(h).toLowerCase()).filter((h) => /^[0-9a-f]{64}$/.test(h))),
    pdfBranding: RAW.pdfBranding !== false,
    lawFirm: Object.freeze({
      name: str(law.name, 100),
      url: safeUrl(law.url),
      email: emailOk(str(law.email, 100)) ? str(law.email, 100) : '',
      phone: phoneOk(str(law.phone, 20)) ? str(law.phone, 20) : ''
    })
  });
  ['buyCoffeeUrl', 'paymentLinkUrl'].forEach((k) => {
    if (RAW[k] && !CONFIG[k]) console.warn(`config.js: ${k} odrzucony – wymagany adres https:// z dozwolonej domeny.`);
  });

  /* ======================================================================
     NARZĘDZIA DOM
     ====================================================================== */
  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const val = (id) => ($(id) ? String($(id).value) : '');
  const chk = (id) => !!($(id) && $(id).checked);
  const money = (id) => clamp(parseNum(val(id)), 0, MAX_MONEY);
  const optMoney = (id) => (val(id).trim() === '' ? null : money(id));
  const intIn = (id, min, max, dflt) => { const n = Math.floor(parseNum(val(id))); return val(id).trim() === '' ? dflt : clamp(n, min, max); };
  const radio = (name) => { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };
  const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);

  /* ======================================================================
     ODCZYT FORMULARZA (wszystkie liczby ograniczone do bezpiecznych zakresów)
     ====================================================================== */
  function readState() {
    const under26 = chk('under26');
    const etatSel = val('etat');
    const etat = etatSel === 'custom' ? parseFrac(val('etatCustom')) : parseFloat(oneOf(etatSel, ['1', '0.75', '0.5', '0.25'], '1'));
    const rateRaw = val('rate').trim();
    return {
      start: parseDate(val('startDate')),
      end: parseDate(val('endDate')),
      notice: parseDate(val('noticeDate')),
      extraY: intIn('extraY', 0, 60, 0),
      extraM: intIn('extraM', 0, 720, 0),
      extraD: intIn('extraD', 0, 36500, 0),
      etat,
      norma: parseFloat(oneOf(val('norma'), ['8', '7'], '8')),
      employer20: chk('employer20'),
      reason: oneOf(val('reason'), ['wypowiedzenie', 'porozumienie', 'inne'], 'wypowiedzenie'),
      retire: chk('retire'),
      under26,
      fixed: money('fixedSalary'),
      fixedOther: money('fixedOther'),
      v: [money('var1'), money('var2'), money('var3')],
      topUp: chk('topUp'),
      dw: [1, 2, 3].map((i) => clamp(parseNum(val('dw' + i)), 0, 31)),
      dn: [1, 2, 3].map((i) => clamp(parseNum(val('dn' + i)), 0, 31)),
      long12: money('long12'),
      leaveMode: oneOf(radio('leaveMode'), ['days', 'hours'], 'days'),
      leaveDays: clamp(parseNum(val('leaveDays')), 0, 1000),
      leaveHours: clamp(parseNum(val('leaveHours')), 0, 8000),
      payDay: intIn('payDay', 1, 31, 10),
      payMode: oneOf(val('payMode'), ['next', 'same'], 'next'),
      pitRate: under26 ? 0 : parseFloat(oneOf(val('pitRate'), ['12', '32'], '12')),
      pit2: chk('pit2'),
      kup: parseFloat(oneOf(val('kup'), ['0', '250', '300'], '0')),
      paidEkw: optMoney('paidEkw'),
      paidOdp: optMoney('paidOdp'),
      paidEmer: optMoney('paidEmer'),
      empBase: optMoney('empBase'),
      dueEkwOv: parseDate(val('dueEkw')),
      dueOdpOv: parseDate(val('dueOdp')),
      calcDate: parseDate(val('calcDate')) || todayUTC(),
      rate: rateRaw === '' ? LAW.interestDefault : clamp(parseNum(rateRaw), 0, 100)
    };
  }

  /* ======================================================================
     RENDEROWANIE (każda wartość tekstowa przechodzi przez esc())
     ====================================================================== */
  const mLabel = (o) => `${MONTHS[o.m]} ${o.y}`;
  function rowsTable(head, rows, totalIdx) {
    return `<table class="calc"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) =>
      `<tr class="${i === totalIdx ? 'total' : ''}">${r.map((c, j) => `<td class="${j === r.length - 1 ? 'v' : (j === 1 && r.length === 3 ? 'f' : '')}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  const TONES = {
    amber: 'bg-amber-50 ring-amber-200 text-amber-900',
    emerald: 'bg-emerald-50 ring-emerald-200 text-emerald-900',
    sky: 'bg-sky-50 ring-sky-200 text-sky-900',
    slate: 'bg-slate-100 ring-slate-200 text-slate-800',
    rose: 'bg-rose-50 ring-rose-200 text-rose-900'
  };
  function renderAlerts(R) {
    const list = R.ok ? R.alerts : R.errors.map((t) => ({ tone: 'rose', title: t, text: '' }));
    $('alerts').innerHTML = list.map((a) => `<div class="rounded-xl ring-1 p-4 ${TONES[a.tone] || TONES.slate}"><p class="font-semibold text-sm">${esc(a.title)}</p>${a.text ? `<p class="text-sm mt-1 opacity-90">${esc(a.text)}</p>` : ''}</div>`).join('');
  }

  function render(S, R) {
    renderAlerts(R);
    if (S.end) {
      const d = new Date(S.end);
      [-3, -2, -1].map((k) => monthOffset(d.getUTCFullYear(), d.getUTCMonth(), k)).forEach((o, i) => {
        $('lblVar' + (i + 1)).textContent = `${mLabel(o)} – zmienne`;
        $('lblTop' + (i + 1)).textContent = mLabel(o);
      });
    }
    $('topUpBox').hidden = !S.topUp;
    $('etatCustom').hidden = val('etat') !== 'custom';
    $('leaveDaysBox').hidden = S.leaveMode !== 'days';
    $('leaveHoursBox').hidden = S.leaveMode !== 'hours';
    $('leaveDaysHint').textContent = `1 dzień urlopu = ${S.norma} godzin.`;
    $('paidEmerBox').hidden = !S.retire;
    $('pitRate').disabled = S.under26;
    $('pitHint').textContent = S.under26 ? 'Ulga dla młodych – zastosowano 0% PIT.' : '';
    renderLeaveHelper(S);

    const empty = '<p class="text-sm text-slate-500">Uzupełnij dane powyżej.</p>';
    if (!R.ok) {
      ['ekwTable', 'ekwNetTable', 'odpTable', 'emerTable', 'totalNetTable', 'auditTable', 'summary', 'letterPreview'].forEach((id) => { $(id).innerHTML = empty; });
      $('baseMini').textContent = '';
      $('coefBadge').textContent = '';
      return;
    }
    const P = C.proofRows(S, R);
    const T = R.tax;

    $('baseMini').innerHTML = `<p class="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Podstawa wymiaru</p><p class="text-2xl font-extrabold text-emerald-900 num">${esc(fmtZl(R.base.B))}</p><p class="text-xs text-emerald-800 mt-1 num">${esc(`${fmtN(R.base.fixedTotal)} stałe + ${fmtN(R.base.varAvg)} zmienne + ${fmtN(R.base.longAvg)} kwartalne/roczne`)}</p>`;
    $('coefBadge').textContent = `Współczynnik ${R.ekw.C.year}: ${fmtN(R.ekw.C.coef)} (${R.ekw.C.workingDays} dni pracy)`;

    $('ekwTable').innerHTML = '<p class="text-sm font-semibold mb-2">Podstawa wymiaru</p>' + rowsTable(['Pozycja', 'Wyliczenie', 'Wynik'], P.base, 3) +
      '<p class="text-sm font-semibold mt-5 mb-2">Ekwiwalent – krok po kroku</p>' + rowsTable(['Krok', 'Wyliczenie', 'Wynik'], P.ekw, 4);
    $('ekwNetTable').innerHTML = '<p class="text-sm font-semibold mb-2">Ekwiwalent netto</p>' + rowsTable(['Pozycja', 'Wyliczenie', 'Kwota'], [
      ['Ekwiwalent brutto', '', fmtZl(R.ekw.gross)],
      ['Składki ZUS pracownika (13,71%)', `${fmtN(T.zE)} + ${fmtN(T.zR)} + ${fmtN(T.zC)}`, '−' + fmtZl(T.zus)],
      ['Składka zdrowotna (9%)', `9% × (${fmtN(R.ekw.gross)} − ${fmtN(T.zus)})`, '−' + fmtZl(T.health)],
      [`Zaliczka PIT (${T.rate}%)`, `${T.rate}% × ${fmtN(r0(R.ekw.gross - T.zus), 0)} zł`, '−' + fmtZl(T.taxEkw)],
      ['Ekwiwalent netto', '', fmtZl(T.ekwNet)]
    ], 4);

    const o = R.odp;
    if (o.eligible) {
      $('odpTable').innerHTML = '<p class="text-sm font-semibold mb-2">Odprawa z art. 8 ustawy – krok po kroku</p>' + rowsTable(['Krok', 'Wyliczenie', 'Wynik'], P.odp, 4) +
        '<p class="text-sm font-semibold mt-5 mb-2">Odprawa netto</p>' + rowsTable(['Pozycja', 'Wyliczenie', 'Kwota'], [
          ['Odprawa brutto', '', fmtZl(o.gross)],
          ['Składki ZUS i zdrowotna', 'zwolniona (§ 2 ust. 1 pkt 3 rozp. składkowego)', fmtZl(0)],
          [`Zaliczka PIT (${T.rate}%)`, `${T.rate}% × ${fmtN(r0(o.gross), 0)} zł`, '−' + fmtZl(T.taxOdp)],
          ['Odprawa netto', '', fmtZl(T.odpNet)]
        ], 3);
    } else {
      $('odpTable').innerHTML = `<div class="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4 text-sm text-slate-700">Ustawowa odprawa z art. 8 nie przysługuje przy wybranych warunkach (wymagane: pracodawca zatrudniający co najmniej 20 osób i rozwiązanie umowy wyłącznie z przyczyn niedotyczących pracownika). Staż u pracodawcy: <b>${esc(fmtYMD(o.tenure))}</b>.</div>`;
    }
    $('emerTable').innerHTML = S.retire ? '<p class="text-sm font-semibold mb-2">Odprawa emerytalno-rentowa</p>' + rowsTable(['Pozycja', 'Wyliczenie', 'Wynik'], [
      ...P.emer,
      ['Składki ZUS i zdrowotna', 'zwolniona (§ 2 ust. 1 pkt 2 rozp. składkowego)', fmtZl(0)],
      [`Zaliczka PIT (${T.rate}%)`, `${T.rate}% × ${fmtN(r0(R.emer.gross), 0)} zł`, '−' + fmtZl(T.taxEmer)],
      ['Odprawa emerytalno-rentowa netto', '', fmtZl(T.emerNet)]
    ], 3) + '<p class="hint">Układ zbiorowy, regulamin lub przepisy szczególne mogą przewidywać wyższą odprawę. Kwestia jednoczesnego nabycia odprawy emerytalnej i odprawy z art. 8 wymaga indywidualnej analizy.</p>' : '';

    const totalRows = [
      ['Razem brutto', '', fmtZl(T.grossTotal)],
      ['Składki ZUS i zdrowotna (tylko od ekwiwalentu)', '', '−' + fmtZl(r2(T.zus + T.health))],
      ['PIT od poszczególnych świadczeń', '', '−' + fmtZl(T.taxEkw + T.taxOdp + T.taxEmer)]
    ];
    if (T.taxCorr !== 0) {
      const parts = [T.kup ? `KUP ${T.kup} zł` : '', T.pit2 ? 'PIT-2 300 zł' : '', 'zaokrąglenia'].filter(Boolean).join(', ');
      totalRows.push([`Korekta PIT (${parts})`, '', (T.taxCorr > 0 ? '−' : '+') + fmtZl(Math.abs(T.taxCorr))]);
    }
    totalRows.push(['Razem do wypłaty netto', '', fmtZl(T.netTotal)]);
    $('totalNetTable').innerHTML = '<p class="text-sm font-semibold mb-2">Łącznie (ekwiwalent + odprawy)</p>' + rowsTable(['Pozycja', '', 'Kwota'], totalRows, totalRows.length - 1);

    renderAudit(S, R);
    renderSummary(S, R);
    renderLetterPreview(S, R);
  }

  function renderAudit(S, R) {
    const A = R.audit;
    const due = R.ekw.due;
    $('dueEkwHint').textContent = due.rule === 'payday' ? `Automatycznie: ${fmtDate(due.date)} – termin wypłaty pensji (art. 171 § 4 K.p.).`
      : due.rule === '10days' ? `Automatycznie: ${fmtDate(due.date)} – 10 dni od rozwiązania, bo pensja płatna ${fmtDate(due.payday)} (art. 171 § 5 K.p.).`
        : `Automatycznie: ${fmtDate(due.date)} – dzień rozwiązania umowy.`;
    $('paidOdpBox').hidden = !R.odp.eligible;
    if (!A.rows.length) { $('auditTable').innerHTML = '<p class="text-sm text-slate-500">Brak świadczeń do audytu.</p>'; return; }
    const body = A.rows.map((r) => {
      const status = r.pending ? `${esc(fmtZl(r.shortfall))}<br><span class="text-xs font-normal">jeszcze niewymagalne</span>`
        : r.shortfall > 0 ? esc(fmtZl(r.shortfall)) : (r.overpaid > 0 ? esc('nadpłata ' + fmtZl(r.overpaid)) : 'OK');
      const cls = r.pending ? 'text-slate-500' : (r.shortfall > 0 ? 'text-rose-700' : 'text-emerald-700');
      return `<tr><td>${esc(r.label)}</td><td class="v">${esc(fmtZl(r.correct))}</td>
        <td class="v">${r.paid == null ? '<span class="text-slate-400 font-normal">nie wypłacono</span>' : esc(fmtZl(r.paid))}</td>
        <td class="v ${cls}">${status}</td><td class="v font-normal">${esc(fmtDate(r.due))}</td>
        <td class="v font-normal">${esc(r.days)}</td><td class="v">${esc(fmtZl(r.interest))}</td></tr>`;
    }).join('');
    const empNote = S.empBase != null && S.empBase < R.base.B ? ` Pracodawca przyjął podstawę ${fmtZl(S.empBase)}, czyli o ${fmtZl(r2(R.base.B - S.empBase))} niższą od prawidłowej.` : '';
    $('auditTable').innerHTML = `<table class="calc"><thead><tr><th>Świadczenie</th><th class="r">Należne</th><th class="r">Wypłacone</th><th class="r">Niedopłata</th><th class="r">Wymagalne</th><th class="r">Dni opóźn.</th><th class="r">Odsetki</th></tr></thead>
      <tbody>${body}<tr class="total"><td>Razem</td><td></td><td></td><td class="v text-rose-700">${esc(fmtZl(A.totalShort))}</td><td></td><td></td><td class="v">${esc(fmtZl(A.totalInterest))}</td></tr></tbody></table>
      <p class="hint">${esc(`Odsetki ustawowe za opóźnienie ${fmtN(A.rate)}% w skali roku, liczone od dnia następującego po dniu wymagalności do ${fmtDate(A.calcDate)} (365 dni w roku). Przy opóźnieniach sprzed 5.03.2026 r. stawka była wyższa – wyliczenie jest ostrożne.${empNote}`)}</p>`;
  }

  function renderSummary(S, R) {
    const T = R.tax, A = R.audit;
    const line = (label, value, cls = '') => `<div class="flex justify-between gap-3 py-1.5 border-b border-slate-100"><span class="text-slate-600">${esc(label)}</span><span class="num font-semibold ${cls}">${esc(value)}</span></div>`;
    let h = line('Podstawa wymiaru', fmtZl(R.base.B)) + line('Ekwiwalent brutto', fmtZl(R.ekw.gross)) + line('Ekwiwalent netto', fmtZl(T.ekwNet));
    if (R.odp.eligible) h += line(`Odprawa ${R.odp.mult}× brutto`, fmtZl(R.odp.gross)) + line('Odprawa netto', fmtZl(T.odpNet));
    if (S.retire) h += line('Odprawa emeryt.-rentowa brutto', fmtZl(R.emer.gross));
    h += `<div class="flex justify-between gap-3 py-2.5"><span class="font-bold">Razem netto</span><span class="num text-xl font-extrabold text-emerald-800">${esc(fmtZl(T.netTotal))}</span></div>`;
    if (A.allPending && A.totalShort > 0) {
      h += `<div class="mt-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3"><p class="text-xs uppercase tracking-wide font-semibold text-slate-600">Pracodawca powinien wypłacić (brutto)</p><p class="num text-2xl font-extrabold text-slate-800">${esc(fmtZl(A.totalShort))}</p><p class="text-xs text-slate-600">Po upływie terminu wymagalności wpisz w kroku 5 faktycznie wypłacone kwoty.</p></div>`;
    } else if (A.rows.some((r) => r.paid != null) || A.totalShort > 0) {
      const bad = A.totalShort > 0;
      h += `<div class="mt-2 rounded-xl ${bad ? 'bg-rose-50 ring-rose-200' : 'bg-emerald-50 ring-emerald-200'} ring-1 p-3">
        <p class="text-xs uppercase tracking-wide font-semibold ${bad ? 'text-rose-700' : 'text-emerald-700'}">${bad ? 'Kwota niedopłaty pracodawcy' : 'Wypłata zgodna z wyliczeniem'}</p>
        <p class="num text-2xl font-extrabold ${bad ? 'text-rose-800' : 'text-emerald-800'}">${esc(fmtZl(A.totalShort))}</p>
        ${bad ? `<p class="text-xs text-rose-800 num">${esc(`+ odsetki na ${fmtDate(A.calcDate)}: ${fmtZl(A.totalInterest)}`)}</p>` : ''}</div>`;
    }
    h += `<p class="hint mt-3">Termin wypłaty ekwiwalentu: <b>${esc(fmtDate(R.ekw.due.date))}</b>${R.odp.eligible ? ` · limit odprawy: <b>${esc(fmtZl(R.odp.cap))}</b>` : ''}</p>`;
    $('summary').innerHTML = h;
  }

  function leaveHelper(S) {
    return C.leaveHelperCalc(S, parseFloat(oneOf(val('lvAnnual'), ['26', '20'], '26')), clamp(parseNum(val('lvCarry')), 0, 500), clamp(parseNum(val('lvUsed')), 0, 500));
  }
  function renderLeaveHelper(S) {
    const H = leaveHelper(S);
    $('leaveHelperOut').textContent = H ? `Urlop proporcjonalny za ${H.ey} r.: ${H.months} ${plural(H.months, 'miesiąc', 'miesiące', 'miesięcy')} pracy → ${H.annualEtat} × ${H.months}/12 = ${fmtN(H.annualEtat * H.months / 12)} → po zaokrągleniu w górę ${H.prop} dni. Do ekwiwalentu: ${fmtN(H.carry, 0)} zaległe + ${H.prop} − ${fmtN(H.used, 0)} wykorzystane = ${fmtN(H.days, H.days % 1 ? 2 : 0)} dni. (Niepełny miesiąc i niepełny dzień urlopu zaokrągla się w górę; jeśli wykorzystano więcej niż urlop proporcjonalny, nadwyżki się nie zwraca.)` : 'Podaj daty zatrudnienia i rozwiązania umowy.';
  }

  /* ======================================================================
     WEZWANIE – dane i podgląd
     ====================================================================== */
  const txt = (id, max) => val(id).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  function readLetter() {
    return {
      empName: txt('empName', 100), empStreet: txt('empStreet', 120), empCity: txt('empCity', 80), empContact: txt('empContact', 100),
      gender: oneOf(val('gender'), ['m', 'f'], 'm'),
      erName: txt('erName', 160), erStreet: txt('erStreet', 120), erCity: txt('erCity', 80), erNip: txt('erNip', 40),
      reasonText: txt('reasonText', 160) || 'likwidacja stanowiska pracy',
      iban: normIban(val('iban')), place: txt('place', 60), letterDate: parseDate(val('letterDate')) || todayUTC(),
      payDays: intIn('payDays', 1, 90, 7)
    };
  }
  function renderLetterPreview(S, R) {
    const box = $('letterPreview');
    if (!R.audit.rows.length || R.audit.totalShort <= 0) {
      box.innerHTML = '<p class="text-slate-500">Brak niedopłaty do dochodzenia. Wpisz w kroku 5 kwoty faktycznie wypłacone przez pracodawcę – podgląd wezwania pojawi się automatycznie.</p>';
      return;
    }
    const L = readLetter();
    const W = C.buildLetter(S, R, L);
    box.innerHTML = `
      <div class="flex justify-between gap-4 text-sm"><div>${esc(L.empName || '[imię i nazwisko]')}<br>${esc(L.empStreet || '[adres]')}<br>${esc(L.empCity)}</div><div class="text-right">${esc(L.place || '[miejscowość]')}, ${esc(fmtDate(L.letterDate))}</div></div>
      <div class="mt-4 ml-auto w-fit text-sm text-left">${esc(L.erName || '[pracodawca]')}<br>${esc(L.erStreet)}<br>${esc(L.erCity)}</div>
      <p class="mt-5 text-center font-bold tracking-wide">PRZEDSĄDOWE WEZWANIE DO ZAPŁATY</p>
      <p class="text-center text-sm">${esc(W.subtitle)}</p>
      <p class="mt-4">${esc(W.intro)}</p>
      <ol class="list-decimal pl-6 mt-2 space-y-1">${W.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      <p class="mt-2">${esc(W.deadline)}</p>
      <p class="mt-4 text-center font-bold">Uzasadnienie</p>
      ${W.just.map((x) => `<p class="mt-2 text-justify">${esc(x)}</p>`).join('')}
      <p class="mt-6">Z poważaniem</p><p class="mt-6">……………………………………<br><span class="text-xs">(podpis)</span></p>
      <p class="mt-4 text-xs text-slate-500">Załącznik: wyliczenie krok po kroku (tabele podstawy, ekwiwalentu, odprawy, niedopłaty i odsetek) – dołączane w PDF.</p>`;
  }

  /* ======================================================================
     PDF (pdfmake z lokalnego katalogu vendor/, ładowany po kliknięciu)
     ====================================================================== */
  function loadScript({ src, integrity }) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      if (/^sha384-/.test(integrity)) s.integrity = integrity;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Nie udało się wczytać ' + src));
      document.head.appendChild(s);
    });
  }
  let pdfReady = null;
  function ensurePdfMake() {
    // vfs_fonts.js rejestruje czcionkę Roboto (z polskimi znakami) przez pdfMake.addVirtualFileSystem
    if (!pdfReady) pdfReady = loadScript(PDFMAKE).then(() => loadScript(VFS)).catch((e) => { pdfReady = null; throw e; });
    return pdfReady;
  }
  function pdfTable(head, rows, widths, totalIdx) {
    return {
      table: {
        headerRows: 1, widths,
        body: [head.map((h) => ({ text: h, style: 'th' })), ...rows.map((r, i) => r.map((c, j) => ({ text: String(c).replace(/−/g, '-'), alignment: j === r.length - 1 ? 'right' : 'left', bold: i === totalIdx, fontSize: j === 1 && r.length === 3 ? 8 : 9 })))]
      },
      layout: 'lightHorizontalLines', margin: [0, 2, 0, 10]
    };
  }
  function buildPdfDoc(S, R, L) {
    const W = C.buildLetter(S, R, L);
    const P = C.proofRows(S, R);
    const sender = [L.empName, L.empStreet, L.empCity, L.empContact].filter(Boolean).join('\n');
    const recipient = [L.erName, L.erStreet, L.erCity, L.erNip ? 'NIP/KRS: ' + L.erNip : ''].filter(Boolean).join('\n');
    const auditRows = R.audit.rows.map((r) => [r.label, fmtZl(r.correct), r.paid == null ? fmtZl(0) : fmtZl(r.paid), fmtZl(r.shortfall), fmtDate(r.due), String(r.days), fmtZl(r.interest)]);
    auditRows.push(['Razem', '', '', fmtZl(R.audit.totalShort), '', '', fmtZl(R.audit.totalInterest)]);

    const annex = [
      { text: 'Załącznik nr 1 – Wyliczenie krok po kroku', style: 'h2', pageBreak: 'before' },
      { text: `Stan prawny na dzień sporządzenia pisma. Zaokrąglenia do pełnych groszy na każdym etapie. Wymiar etatu: ${fmtEtat(S.etat)}, dobowa norma czasu pracy: ${S.norma} h.`, style: 'small', margin: [0, 0, 0, 8] },
      { text: 'Tabela 1. Podstawa wymiaru (miesięczna)', style: 'h3' },
      pdfTable(['Składnik', 'Wyliczenie', 'Kwota'], P.base, ['*', '*', 'auto'], 3)
    ];
    const kinds = R.audit.rows.map((r) => r.key);
    if (kinds.includes('ekw')) annex.push({ text: 'Tabela 2. Ekwiwalent za niewykorzystany urlop (art. 171 K.p.)', style: 'h3' }, pdfTable(['Krok', 'Wyliczenie', 'Wynik'], P.ekw, ['*', '*', 'auto'], 4));
    if (kinds.includes('odp')) annex.push({ text: 'Tabela 3. Odprawa pieniężna (art. 8 ustawy z 13.03.2003 r.)', style: 'h3' }, pdfTable(['Krok', 'Wyliczenie', 'Wynik'], P.odp, ['*', '*', 'auto'], 4));
    if (kinds.includes('emer')) annex.push({ text: 'Tabela 4. Odprawa emerytalno-rentowa (art. 92¹ K.p.)', style: 'h3' }, pdfTable(['Pozycja', 'Wyliczenie', 'Wynik'], P.emer, ['*', '*', 'auto'], 0));
    annex.push(
      { text: 'Zestawienie niedopłaty i odsetek ustawowych za opóźnienie', style: 'h3' },
      pdfTable(['Świadczenie', 'Należne', 'Wypłacone', 'Niedopłata', 'Wymagalne', 'Dni', 'Odsetki'], auditRows, ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], auditRows.length - 1),
      { text: `Odsetki: ${fmtN(R.audit.rate)}% w skali roku (art. 481 § 2 K.c.), od dnia następującego po dniu wymagalności do ${fmtDate(R.audit.calcDate)}; wzór: niedopłata × ${fmtN(R.audit.rate)}% × dni ÷ 365. Odsetki biegną dalej do dnia zapłaty.`, style: 'small' }
    );

    return {
      pageSize: 'A4',
      pageMargins: [56, 48, 56, 56],
      info: { title: 'Przedsądowe wezwanie do zapłaty', author: L.empName || '', subject: W.subtitle, creator: CONFIG.siteName, producer: CONFIG.siteName },
      defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25 },
      styles: {
        title: { fontSize: 14, bold: true, alignment: 'center', margin: [0, 18, 0, 2] },
        subtitle: { fontSize: 10, alignment: 'center', margin: [0, 0, 0, 14] },
        h2: { fontSize: 12, bold: true, margin: [0, 0, 0, 6] },
        h3: { fontSize: 10, bold: true, margin: [0, 6, 0, 3] },
        th: { bold: true, fontSize: 8, color: '#334155', fillColor: '#f1f5f9' },
        small: { fontSize: 8, color: '#475569' },
        just: { alignment: 'justify', margin: [0, 0, 0, 6] }
      },
      footer: (page, pages) => ({
        columns: [
          { text: CONFIG.pdfBranding ? `Wyliczenie: ${CONFIG.siteName} · stan prawny 24.10.2026` : '', fontSize: 7, color: '#94a3b8' },
          { text: `Strona ${page} z ${pages}`, alignment: 'right', fontSize: 7, color: '#94a3b8' }
        ],
        margin: [56, 20, 56, 0]
      }),
      content: [
        { columns: [{ text: sender || ' ', width: '*' }, { text: `${L.place || ''}${L.place ? ', ' : ''}dnia ${fmtDate(L.letterDate)}`, alignment: 'right', width: 'auto' }] },
        { text: recipient || ' ', margin: [260, 18, 0, 0], bold: true },
        { text: 'PRZEDSĄDOWE WEZWANIE DO ZAPŁATY', style: 'title' },
        { text: W.subtitle, style: 'subtitle' },
        { text: W.intro, style: 'just' },
        { ol: W.list, margin: [10, 0, 0, 6] },
        { text: W.deadline, style: 'just' },
        { text: 'Uzasadnienie', bold: true, alignment: 'center', margin: [0, 8, 0, 6] },
        ...W.just.map((t) => ({ text: t, style: 'just' })),
        { text: 'Z poważaniem', margin: [0, 14, 0, 30] },
        { text: '……………………………………' },
        { text: '(podpis)', fontSize: 8, margin: [30, 0, 0, 14] },
        { text: 'Załączniki:', bold: true, fontSize: 9 },
        { ol: ['Wyliczenie krok po kroku (załącznik nr 1).'], fontSize: 9 },
        ...annex
      ]
    };
  }
  async function generatePdf() {
    const S = readState(), R = C.compute(S), L = readLetter();
    await ensurePdfMake();
    window.pdfMake.createPdf(buildPdfDoc(S, R, L)).download(`wezwanie-do-zaplaty-${isoDate(L.letterDate)}.pdf`);
  }

  /* ======================================================================
     WALIDACJA WEZWANIA + OKNO PŁATNOŚCI
     ====================================================================== */
  function validateLetter() {
    const S = readState(), R = C.compute(S), L = readLetter();
    const errs = [];
    if (!R.ok) errs.push(...R.errors);
    else if (R.audit.totalShort <= 0) errs.push('Brak niedopłaty – uzupełnij w kroku 5 kwoty wypłacone przez pracodawcę.');
    else if (R.audit.allPending) errs.push(`Świadczenia nie są jeszcze wymagalne (najbliższy termin: ${fmtDate(Math.min(...R.audit.rows.map((r) => r.due)))}). Wezwanie wyślij po tym terminie albo wpisz kwotę wypłaconą / zaoferowaną przez pracodawcę.`);
    if (!L.empName) errs.push('Podaj imię i nazwisko.');
    if (!L.erName) errs.push('Podaj nazwę pracodawcy.');
    if (!L.iban || !ibanValid(L.iban)) errs.push('Podaj poprawny numer rachunku IBAN.');
    return { errs, S, R };
  }

  function paymentButtonsHtml() {
    const out = [];
    if (CONFIG.buyCoffeeUrl) out.push(`<a href="${esc(CONFIG.buyCoffeeUrl)}" target="_blank" rel="noopener noreferrer" class="block text-center rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold px-4 py-3">Zapłać ${esc(CONFIG.pdfPrice)} – BLIK / karta (BuyCoffee.to)</a>`);
    if (CONFIG.paymentLinkUrl) out.push(`<a href="${esc(CONFIG.paymentLinkUrl)}" target="_blank" rel="noopener noreferrer" class="block text-center rounded-xl bg-slate-900 hover:bg-black text-white font-bold px-4 py-3">Zapłać ${esc(CONFIG.pdfPrice)} – BLIK / karta</a>`);
    return out;
  }
  function openPaywall(S, R) {
    $('pwPrice').textContent = CONFIG.pdfPrice;
    $('pwAmount').textContent = fmtZl(R.audit.totalShort);
    const pays = paymentButtonsHtml();
    $('pwPayButtons').innerHTML = pays.join('');
    $('pwBlik').textContent = CONFIG.blikPhone ? `Możesz też wysłać przelew BLIK na telefon: ${CONFIG.blikPhone} (tytuł: „Wezwanie PDF”).` : '';
    let mode = (pays.length || CONFIG.blikPhone) ? CONFIG.paywallMode : 'free';
    if (mode === 'code' && !CONFIG.unlockCodeHashes.length) mode = 'honor';
    let unlock = '';
    if (mode === 'code') {
      unlock = `<label class="lbl" for="pwCode">Kod odblokowujący (otrzymasz go po płatności)</label>
        <div class="flex gap-2"><input class="inp" id="pwCode" autocomplete="off" maxlength="64" spellcheck="false"><button type="button" id="pwCheck" class="rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold px-4">Sprawdź</button></div>
        <p class="text-sm text-rose-700 mt-1" id="pwCodeErr" role="alert"></p>`;
    } else if (mode === 'honor') {
      unlock = `<label class="flex gap-2.5 items-start text-sm"><input type="checkbox" class="chk" id="pwConfirm"> <span>Potwierdzam, że ${esc(CONFIG.pdfPrice)} zostało opłacone.</span></label>`;
    }
    unlock += `<button type="button" id="pwDownload" class="mt-3 w-full rounded-xl bg-rose-700 hover:bg-rose-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold px-4 py-3" ${mode === 'free' ? '' : 'disabled'}>Pobierz PDF</button><p class="text-sm text-rose-700 mt-1" id="pwErr" role="alert"></p>`;
    $('pwUnlock').innerHTML = unlock;
    $('pwLead').innerHTML = lawLeadHtml(true, S, R);

    const dl = $('pwDownload');
    if (mode === 'honor') $('pwConfirm').addEventListener('change', (e) => { dl.disabled = !e.target.checked; });
    if (mode === 'code') {
      let attempts = 0;
      $('pwCheck').addEventListener('click', async () => {
        if (++attempts > 10) { $('pwCodeErr').textContent = 'Zbyt wiele prób. Odśwież stronę.'; return; }
        const ok = await checkCode($('pwCode').value);
        $('pwCodeErr').textContent = ok ? '' : 'Nieprawidłowy kod.';
        dl.disabled = !ok;
      });
    }
    dl.addEventListener('click', async () => {
      dl.disabled = true; const label = dl.textContent; dl.textContent = 'Generuję PDF…';
      try { await generatePdf(); $('pwErr').textContent = ''; }
      catch (err) { $('pwErr').textContent = 'Nie udało się wygenerować PDF. Odśwież stronę i spróbuj ponownie.'; console.error(err); }
      dl.textContent = label; dl.disabled = false;
    });
    $('paywall').hidden = false;
    document.body.style.overflow = 'hidden';
    $('pwClose').focus();
  }
  function closePaywall() { $('paywall').hidden = true; document.body.style.overflow = ''; $('btnPdf').focus(); }
  async function checkCode(code) {
    const c = String(code || '').trim().toUpperCase().slice(0, 64);
    if (!c || !window.crypto || !crypto.subtle) return false;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c));
    const hex = Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
    return CONFIG.unlockCodeHashes.includes(hex);
  }

  /* Kancelaria partnerska */
  function lawLeadHtml(compact, S, R) {
    const F = CONFIG.lawFirm;
    const summary = R && R.ok ? `Podstawa: ${fmtZl(R.base.B)}; ekwiwalent: ${fmtZl(R.ekw.gross)}; odprawa: ${fmtZl(R.odp.gross)}; niedopłata: ${fmtZl(R.audit.totalShort)}; staż: ${fmtYMD(R.odp.tenure)}; rozwiązanie umowy: ${S.end ? fmtDate(S.end) : '-'}.` : '';
    const btn = 'inline-block rounded-lg font-semibold px-4 py-2 ';
    const primary = compact ? 'bg-slate-800 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-900';
    const secondary = compact ? 'bg-white ring-1 ring-slate-300 text-slate-800' : 'bg-white/10 ring-1 ring-white/30 text-white hover:bg-white/20';
    const ctas = [];
    if (F.url) ctas.push(`<a class="${btn}${primary}" href="${esc(F.url)}" target="_blank" rel="noopener noreferrer">Umów konsultację</a>`);
    if (F.email) ctas.push(`<a class="${btn}${secondary}" href="mailto:${esc(encodeURIComponent(F.email).replace(/%40/g, '@'))}?subject=${encodeURIComponent('Konsultacja – odprawa / ekwiwalent za urlop')}&amp;body=${encodeURIComponent('Dzień dobry,\nproszę o analizę mojego rozliczenia z pracodawcą.\n\n' + summary + '\n\n')}">Napisz do kancelarii</a>`);
    if (F.phone) ctas.push(`<a class="${btn}${secondary}" href="tel:${esc(F.phone.replace(/[^\d+]/g, ''))}">${esc(F.phone)}</a>`);
    if (!ctas.length) {
      const pip = `<a class="${btn}${secondary}" href="https://www.pip.gov.pl" target="_blank" rel="noopener noreferrer">Bezpłatne porady prawne PIP</a>`;
      const partner = CONFIG.contactEmail ? `<a class="${btn}${primary}" href="mailto:${esc(encodeURIComponent(CONFIG.contactEmail).replace(/%40/g, '@'))}?subject=${encodeURIComponent('Współpraca – kancelaria partnerska')}">Jesteś kancelarią? Zostań partnerem</a>` : '';
      return compact ? `<p class="font-semibold text-slate-700">Spór jest bardziej złożony?</p><p class="mt-1">Skorzystaj z bezpłatnych porad prawnych Państwowej Inspekcji Pracy.</p><div class="mt-2 flex flex-wrap gap-2">${pip}${partner}</div>` : pip + partner;
    }
    return compact ? `<p class="font-semibold text-slate-700">${esc(F.name || 'Kancelaria Prawa Pracy')} – analiza wypowiedzenia i spory z pracodawcą</p><p class="mt-1">Sprawa jest złożona albo pracodawca odmawia zapłaty? Skonsultuj się z prawnikiem.</p><div class="mt-2 flex flex-wrap gap-2">${ctas.join('')}</div>` : ctas.join('');
  }
  function renderLawCard(S, R) {
    if (CONFIG.lawFirm.name) $('lawTitle').textContent = `${CONFIG.lawFirm.name} – Analiza Wypowiedzenia i Spory z Pracodawcą`;
    $('lawCtas').innerHTML = lawLeadHtml(false, S, R);
  }

  /* ======================================================================
     PRZYKŁADY I PAMIĘĆ PRZEGLĄDARKI (tylko za zgodą, bez numeru konta)
     ====================================================================== */
  const FIELD_IDS = ['startDate', 'noticeDate', 'endDate', 'etat', 'etatCustom', 'norma', 'reason', 'employer20', 'under26', 'retire', 'extraY', 'extraM', 'extraD',
    'fixedSalary', 'fixedOther', 'var1', 'var2', 'var3', 'topUp', 'dw1', 'dw2', 'dw3', 'dn1', 'dn2', 'dn3', 'long12',
    'leaveDays', 'leaveHours', 'payDay', 'payMode', 'lvAnnual', 'lvCarry', 'lvUsed', 'pitRate', 'kup', 'pit2',
    'paidEkw', 'paidOdp', 'paidEmer', 'empBase', 'calcDate', 'rate', 'dueEkw', 'dueOdp',
    'empName', 'empStreet', 'empCity', 'empContact', 'gender', 'erName', 'erStreet', 'erCity', 'erNip', 'reasonText', 'place', 'letterDate', 'payDays'];
  // Pole 'iban' celowo nie jest zapisywane.

  const EXAMPLES = {
    B: { startDate: '2018-07-01', noticeDate: '2026-06-15', endDate: '2026-09-30', etat: '1', norma: '8', reason: 'wypowiedzenie', employer20: true, under26: false, retire: false,
      fixedSalary: '6000', fixedOther: '', var1: '1000', var2: '1100', var3: '900', topUp: false, long12: '2400', leaveMode: 'days', leaveDays: '10', payDay: '10', payMode: 'next',
      pitRate: '12', kup: '0', pit2: false, paidEkw: '2868', paidOdp: '18000', paidEmer: '', empBase: '6000', rate: '9,25', reasonText: 'likwidacja stanowiska pracy', payDays: '7' },
    A: { startDate: '2018-10-15', noticeDate: '2026-10-20', endDate: '2027-01-31', etat: '1', norma: '8', reason: 'wypowiedzenie', employer20: true, under26: false, retire: false,
      fixedSalary: '21000', fixedOther: '', var1: '3400', var2: '3600', var3: '3500', topUp: false, long12: '6000', leaveMode: 'days', leaveDays: '11', payDay: '10', payMode: 'next',
      pitRate: '32', kup: '0', pit2: false, paidEkw: '', paidOdp: '', paidEmer: '', empBase: '', rate: '9,25', reasonText: 'redukcja etatów', payDays: '7', lvAnnual: '26', lvCarry: '8', lvUsed: '0' }
  };

  function setField(id, v) {
    const el = $(id); if (!el) return;
    if (el.type === 'checkbox') { el.checked = !!v; return; }
    const s = v == null ? '' : String(v);
    if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === s)) return; // tylko znane wartości
    el.value = el.maxLength > 0 ? s.slice(0, el.maxLength) : s;
  }
  function setLeaveMode(v) { const r = document.querySelector(`input[name="leaveMode"][value="${v === 'hours' ? 'hours' : 'days'}"]`); if (r) r.checked = true; }
  function loadExample(key) {
    const ex = EXAMPLES[key];
    if (!ex) return;
    ['extraY', 'extraM', 'extraD', 'dueEkw', 'dueOdp', 'etatCustom', 'leaveHours', 'dw1', 'dw2', 'dw3', 'dn1', 'dn2', 'dn3', 'lvCarry', 'lvUsed'].forEach((id) => setField(id, ''));
    Object.entries(ex).forEach(([k, v]) => { if (k === 'leaveMode') setLeaveMode(v); else setField(k, v); });
    setField('calcDate', isoDate(todayUTC()));
    setField('letterDate', isoDate(todayUTC()));
    update();
  }
  function storage() { try { return window.localStorage; } catch (e) { return null; } }
  function saveState() {
    const ls = storage(); if (!ls) return;
    try {
      if (!chk('remember')) { ls.removeItem(STORE_KEY); return; }
      const data = { remember: true, leaveMode: radio('leaveMode') };
      FIELD_IDS.forEach((id) => { const el = $(id); if (el) data[id] = el.type === 'checkbox' ? el.checked : String(el.value).slice(0, 200); });
      ls.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* pamięć niedostępna */ }
  }
  function restoreState() {
    const ls = storage(); if (!ls) return false;
    try {
      ls.removeItem('sprawdzodprawe.v1'); // starsza wersja zapisywała także numer konta
      const raw = ls.getItem(STORE_KEY);
      if (!raw || raw.length > 20000) return false;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || data.remember !== true) return false;
      FIELD_IDS.forEach((id) => { if (Object.prototype.hasOwnProperty.call(data, id)) setField(id, typeof data[id] === 'boolean' ? data[id] : String(data[id])); });
      setLeaveMode(data.leaveMode);
      setField('remember', true);
      return true;
    } catch (e) { return false; }
  }
  function clearAll() {
    const ls = storage();
    try { if (ls) { ls.removeItem(STORE_KEY); ls.removeItem('sprawdzodprawe.v1'); } } catch (e) { /* brak dostępu */ }
    [...FIELD_IDS, 'iban', 'remember'].forEach((id) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') el.checked = false; else if (el.tagName === 'SELECT') el.selectedIndex = 0; else el.value = ''; });
    setLeaveMode('days');
    setField('employer20', true);
    setField('calcDate', isoDate(todayUTC()));
    setField('letterDate', isoDate(todayUTC()));
    update();
  }

  /* ======================================================================
     AKTUALIZACJA I ZDARZENIA
     ====================================================================== */
  function update() {
    const S = readState();
    const R = C.compute(S);
    render(S, R);
    renderLawCard(S, R);
    const ib = normIban(val('iban'));
    $('iban').classList.toggle('bad', !!ib && !ibanValid(ib));
    $('ibanHint').textContent = ib ? (ibanValid(ib) ? '✓ Numer rachunku poprawny (nie jest zapisywany)' : 'Sprawdź numer – suma kontrolna IBAN się nie zgadza.') : '';
    saveState();
  }
  let timer = null;
  const scheduleUpdate = () => { clearTimeout(timer); timer = setTimeout(update, 120); };

  document.addEventListener('input', scheduleUpdate);
  document.addEventListener('change', scheduleUpdate);
  document.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => loadExample(b.dataset.example)));
  $('btnClear').addEventListener('click', () => { if (window.confirm('Usunąć wszystkie wpisane dane z formularza i z pamięci tej przeglądarki?')) clearAll(); });
  document.querySelectorAll('[data-notice]').forEach((b) => b.addEventListener('click', () => {
    const n = parseDate(val('noticeDate'));
    if (!n) { window.alert('Najpierw podaj datę doręczenia wypowiedzenia.'); return; }
    const d = new Date(n);
    const k = b.dataset.notice === '3' ? 3 : 1;
    // okres wypowiedzenia liczony w miesiącach kończy się w ostatnim dniu miesiąca (art. 30 § 2¹ K.p.)
    setField('endDate', isoDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k + 1, 0)));
    update();
  }));
  $('btnLeaveApply').addEventListener('click', () => {
    const H = leaveHelper(readState());
    if (!H) return;
    setLeaveMode('days');
    setField('leaveDays', String(H.days).replace('.', ','));
    update();
  });
  $('btnSimulate').addEventListener('click', () => {
    const R = C.compute(readState());
    if (!R.ok) return;
    const put = (id, x) => setField(id, String(x).replace('.', ','));
    put('empBase', R.sim.B);
    put('paidEkw', R.sim.ekw);
    if (R.odp.eligible) put('paidOdp', R.sim.odp);
    if (R.emer.gross) put('paidEmer', R.sim.emer);
    update();
  });
  $('btnPdf').addEventListener('click', () => {
    const { errs, S, R } = validateLetter();
    $('pdfError').textContent = errs.join(' ');
    if (!errs.length) openPaywall(S, R);
  });
  $('pwClose').addEventListener('click', closePaywall);
  $('paywall').addEventListener('click', (e) => { if (e.target.id === 'paywall') closePaywall(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('paywall').hidden) closePaywall(); });

  /* Start */
  document.querySelectorAll('[data-site-name]').forEach((el) => { el.textContent = CONFIG.siteName; });
  $('year').textContent = String(new Date().getFullYear());
  if (CONFIG.contactEmail) {
    const a = document.createElement('a');
    a.className = 'underline'; a.href = 'mailto:' + CONFIG.contactEmail; a.textContent = CONFIG.contactEmail;
    $('contactLine').append('· Kontakt: ', a);
  }
  if (!restoreState()) loadExample('B');
  if (!val('calcDate')) setField('calcDate', isoDate(todayUTC()));
  if (!val('letterDate')) setField('letterDate', isoDate(todayUTC()));
  update();
})();
