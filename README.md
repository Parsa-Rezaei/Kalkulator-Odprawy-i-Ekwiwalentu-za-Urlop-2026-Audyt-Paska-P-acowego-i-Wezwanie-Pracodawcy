# Kalkulator Odprawy i Ekwiwalentu za Urlop 2026/2027 – Audyt Rozliczenia + Wezwanie do Zapłaty

[Polski](#polski) · [English](#english)

---

## Polski

Darmowa, jednoplikowa aplikacja (`index.html`) dla pracowników zwalnianych z pracy w Polsce (likwidacja stanowiska, redukcja etatów, zwolnienia grupowe). Liczy **ekwiwalent za niewykorzystany urlop** i **odprawę pieniężną** według przepisów obowiązujących w 2026 i 2027 r., sprawdza, czy pracodawca nie zaniżył wypłaty, liczy **odsetki ustawowe za opóźnienie** i generuje **przedsądowe wezwanie do zapłaty w PDF**.

Wszystkie obliczenia i PDF powstają w przeglądarce użytkownika – żadne dane nie są wysyłane na serwer.

### Funkcje

| Moduł | Co liczy |
|---|---|
| Podstawa wymiaru | składniki stałe z miesiąca rozwiązania umowy + średnia składników zmiennych z 3 miesięcy (z dopełnieniem przy nieobecności) + średnia premii kwartalnych/rocznych z 12 miesięcy |
| A. Ekwiwalent za urlop (art. 171 K.p.) | współczynnik wyliczany z kalendarza (2026: **20,92**; 3/4 etatu 15,69; 1/2 – 10,46; 1/4 – 5,23; 2025: 20,83 / 20,75), zaokrąglanie krok po kroku, norma 8 h lub 7 h, termin wypłaty wg art. 171 § 4–5 K.p. (od 27.01.2026), netto (ZUS 13,71%, zdrowotna 9%, PIT 12/32/0%) |
| B. Odprawa (art. 8 ustawy z 13.03.2003 r.) | staż liczony do dnia rozwiązania umowy (z okresem wypowiedzenia), 1×/2×/3× podstawy, limit 15× płacy minimalnej z dnia rozwiązania: **72 090 zł (2026)** i **74 250 zł (2027)**, ostrzeżenia o progu 8 lat i „przeskoku” limitu na 2027 r., netto bez ZUS |
| Odprawa emerytalno-rentowa (art. 92¹ K.p.) | 1× podstawy, bez ZUS, z PIT |
| Urlop proporcjonalny | pomocnik: wymiar 20/26 dni, część etatu, miesiące pracy w roku rozwiązania, zaokrąglenia w górę |
| Audyt | kwota należna vs wypłacona, niedopłata, odsetki 9,25% (od 5.03.2026), symulacja typowego błędu pracodawcy |
| Wezwanie PDF (A4) | pismo + załącznik z tabelami wyliczeń, kwota słownie, IBAN z walidacją, 7 dni na zapłatę, uprzedzenie o Sądzie Pracy i PIP |
| Monetyzacja | okno płatności (BuyCoffee.to / link BLIK / przelew na telefon) przed pobraniem PDF, miejsce na kancelarię partnerską |
| SEO | meta tagi, `SoftwareApplication` i `FAQPage` (JSON-LD), sekcje z wzorami i FAQ |

### Uruchomienie lokalne

Otwórz `index.html` w przeglądarce albo uruchom prosty serwer:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Biblioteki ładowane z CDN (jsDelivr): Tailwind CSS `@tailwindcss/browser@4.3.3` oraz `pdfmake@0.2.23` (wczytywany dopiero po kliknięciu „Pobierz PDF”).

### Konfiguracja (obiekt `CONFIG` na początku skryptu w `index.html`)

| Pole | Opis |
|---|---|
| `siteName` | nazwa serwisu w nagłówku, stopce i PDF |
| `contactEmail` | e-mail w stopce i w przycisku „Jesteś kancelarią? Zostań partnerem” |
| `pdfPrice` | cena wyświetlana w oknie płatności (np. `'14,99 zł'`) |
| `buyCoffeeUrl` | link do Twojej strony BuyCoffee.to |
| `paymentLinkUrl` | opcjonalny link płatności (np. Stripe Payment Link, Tpay, Przelewy24) |
| `blikPhone` | opcjonalny numer telefonu do przelewu BLIK na telefon |
| `paywallMode` | `'honor'` (użytkownik potwierdza płatność), `'code'` (kod odblokowujący), `'free'` (bez płatności) |
| `unlockCodeHashes` | dla trybu `'code'`: lista skrótów SHA-256 kodów (kod jest zamieniany na WIELKIE LITERY przed sprawdzeniem) |
| `lawFirm` | dane kancelarii partnerskiej: `name`, `url`, `email`, `phone` |

Jeśli żaden sposób płatności nie jest skonfigurowany, PDF pobiera się bez opłaty.

Generowanie skrótu kodu (np. `ODPRAWA-LISTOPAD`):

```bash
printf '%s' 'ODPRAWA-LISTOPAD' | sha256sum
```

> Tryby `honor` i `code` działają po stronie przeglądarki – to „miękka” bramka, którą da się obejść. Pełna weryfikacja płatności wymaga backendu (np. funkcji serverless sprawdzającej płatność u operatora).

### Wdrożenie

**GitHub Pages:** Settings → Pages → Source: *Deploy from a branch* → wybierz gałąź z plikiem `index.html` i folder `/ (root)` → Save. Strona będzie dostępna pod `https://<użytkownik>.github.io/<repozytorium>/`. Własna domena: Settings → Pages → *Custom domain* + rekord DNS `CNAME` u rejestratora.

**Cloudflare Pages / Netlify:** podłącz repozytorium, bez komendy budowania, katalog wyjściowy `/`.

### Coroczna aktualizacja przepisów

W obiekcie `LAW` zaktualizuj: `minWage` (nowa płaca minimalna – rozporządzenie publikowane do 15 września), `minWageKnownUntil`, `interestDefault` (po zmianie stopy referencyjnej NBP: stopa + 5,5 p.p.). Współczynnik ekwiwalentowy liczy się automatycznie z kalendarza świąt. Zaktualizuj też teksty w sekcjach „Wzory”, FAQ i JSON-LD.

### Zastrzeżenie

Narzędzie ma charakter informacyjny i nie stanowi porady prawnej ani podatkowej. Stan prawny: 24 października 2026 r.

---

## English

A free single-file web app (`index.html`, Polish UI) for employees being laid off in Poland. It calculates **holiday leave equivalence** (*ekwiwalent za urlop*, Art. 171 of the Labour Code) and **statutory severance pay** (*odprawa*, Art. 8 of the Act of 13 March 2003 on group layoffs) under 2026/2027 rules, audits the employer's final payslip, computes **statutory late-payment interest** and generates a **pre-litigation demand letter (PDF)**.

All calculations and the PDF are produced client-side; no data leaves the browser.

### Key rules implemented

- Monthly base = fixed pay in the termination month + 3-month average of monthly variable pay (with absence top-up) + 12-month average of quarterly/annual bonuses.
- Leave-equivalence coefficient derived from the Polish holiday calendar (2026: 20.92 full-time; part-time scaled), stepwise rounding to grosz, 8 h (or 7 h) daily norm.
- Payout deadline for leave equivalence from 27 Jan 2026: employer's payday, or 10 days after termination if payday precedes termination (Art. 171 §4–5).
- Severance 1×/2×/3× base by tenure (<2 y / 2–8 y / >8 y), tenure counted to the termination date, capped at 15× the minimum wage on the termination date: PLN 72,090 (2026) and PLN 74,250 (2027, minimum wage PLN 4,950 per the Regulation of 14 Sep 2026).
- Severance exempt from social and health contributions; PIT 12%/32% or 0% (youth relief under 26).
- Late interest default 9.25% p.a. (NBP reference rate 3.75% + 5.5 pp, since 5 Mar 2026).

### Run, configure, deploy

- Run: open `index.html` or `python3 -m http.server 8000`.
- Configure: edit the `CONFIG` object (site name, payment links, paywall mode, partner law firm) and, yearly, the `LAW` object (minimum wage, interest rate).
- Deploy: GitHub Pages (Settings → Pages → deploy from branch, root folder), Cloudflare Pages or Netlify (no build step).

### Disclaimer

Informational tool only; not legal or tax advice. Legal status as of 24 October 2026.
