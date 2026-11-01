# Kalkulator Odprawy i Ekwiwalentu za Urlop 2026/2027 – Audyt Rozliczenia + Wezwanie do Zapłaty

[Polski](#polski) · [English](#english)

---

## Polski

Strona statyczna (bez bazy danych; jedyny element serwerowy to funkcja weryfikująca płatność) dla pracowników zwalnianych z pracy w Polsce (likwidacja stanowiska, redukcja etatów, zwolnienia grupowe). Liczy **ekwiwalent za niewykorzystany urlop** i **odprawę pieniężną** według przepisów obowiązujących w 2026 i 2027 r., sprawdza, czy pracodawca nie zaniżył wypłaty, liczy **odsetki ustawowe za opóźnienie** i generuje **przedsądowe wezwanie do zapłaty w PDF**.

Wszystkie obliczenia i PDF powstają w przeglądarce użytkownika – dane z formularza nie są wysyłane na serwer, strona nie ładuje nic z zewnętrznych serwerów. Kalkulator, audyt i podgląd są bezpłatne; płatny (14,99 zł, BLIK przez Stripe) jest wyłącznie plik PDF wezwania.

### Funkcje

| Moduł | Co liczy |
|---|---|
| Podstawa wymiaru | składniki stałe z miesiąca rozwiązania umowy + średnia składników zmiennych z 3 miesięcy (z dopełnieniem przy nieobecności) + średnia premii kwartalnych/rocznych z 12 miesięcy |
| A. Ekwiwalent za urlop (art. 171 K.p.) | współczynnik wyliczany z kalendarza (2026: **20,92**; 3/4 etatu 15,69; 1/2 – 10,46; 1/4 – 5,23; 2025: 20,83 / 20,75), zaokrąglanie krok po kroku, norma 8 h lub 7 h, termin wypłaty wg art. 171 § 4–5 K.p. (od 27.01.2026), netto (ZUS 13,71%, zdrowotna 9%, PIT 12/32/0%) |
| B. Odprawa (art. 8 ustawy z 13.03.2003 r.) | staż liczony do dnia rozwiązania umowy (z okresem wypowiedzenia), 1×/2×/3× podstawy, limit 15× płacy minimalnej z dnia rozwiązania: **72 090 zł (2026)** i **74 250 zł (2027)**, ostrzeżenia o progu 8 lat i „przeskoku” limitu na 2027 r., netto bez ZUS |
| Odprawa emerytalno-rentowa (art. 92¹ K.p.) | 1× podstawy, bez ZUS, z PIT |
| Urlop proporcjonalny | wymiar 20/26 dni, część etatu, miesiące pracy w roku rozwiązania, zaokrąglenia w górę |
| Audyt | kwota należna vs wypłacona, niedopłata, odsetki 9,25% (od 5.03.2026), symulacja typowego błędu pracodawcy |
| Wezwanie PDF (A4) | pismo + załącznik z tabelami wyliczeń, kwota słownie, IBAN z walidacją, 7 dni na zapłatę, uprzedzenie o Sądzie Pracy i PIP |
| Monetyzacja | PDF za 14,99 zł: Stripe Payment Link (BLIK) + weryfikacja płatności na serwerze (`functions/api/verify.js`), miejsce na kancelarię partnerską |
| SEO | meta tagi, `SoftwareApplication` i `FAQPage` (JSON-LD), sekcje z wzorami i FAQ |

### Struktura plików

Publikowany jest **tylko katalog `public/`** – źródła, testy i konfiguracja narzędzi nie trafiają na stronę.

| Plik | Rola |
|---|---|
| `public/index.html` | treść strony, okno płatności, Regulamin i Polityka prywatności, CSP, dane strukturalne SEO |
| `public/assets/config.js` | **ustawienia właściciela** – link płatności, cena, dane sprzedawcy, kancelaria (bez kluczy!) |
| `public/assets/calc.js` | silnik obliczeń (przepisy, daty, kwoty, treść wezwania) |
| `public/assets/app.js` | interfejs, PDF, płatność i jej weryfikacja |
| `public/assets/app.css` | gotowy arkusz stylów (Tailwind CSS 4.3.3, zbudowany z `src/input.css`) |
| `public/vendor/pdfmake/` | biblioteka pdfmake 0.2.23 z czcionką Roboto (hostowana lokalnie) |
| `public/_headers` | nagłówki bezpieczeństwa dla Cloudflare Pages |
| `functions/api/verify.js` | Cloudflare Pages Function – sprawdza płatność bezpośrednio w Stripe |
| `tests/` | `calc.test.mjs` (silnik), `verify.test.mjs` (weryfikacja płatności), `e2e.test.js` (Playwright) |

### Uruchomienie lokalne

```bash
cd public && python3 -m http.server 8000
# otwórz http://localhost:8000
```

Na `localhost` / `127.0.0.1` przy pustym `paymentUrl` działa **tryb demonstracyjny** (PDF bez opłaty). Na każdej innej domenie jest wyłączony.

### Konfiguracja (`public/assets/config.js`)

| Pole | Opis |
|---|---|
| `siteName`, `siteUrl` | nazwa i adres serwisu (nagłówek, stopka, PDF, regulamin) |
| `price` | cena PDF w zł (14.99) – musi być równa cenie w Stripe i `EXPECTED_AMOUNT` |
| `paymentUrl` | link Stripe Payment Link `https://buy.stripe.com/…`; pusty = sprzedaż wyłączona |
| `verifyEndpoint` | `/api/verify` |
| `seller` | `name`, `address`, `email`, `nip` – dane sprzedawcy do regulaminu, polityki i stopki |
| `lawFirm` | kancelaria partnerska: `name`, `url` (https), `email`, `phone`; puste = neutralne „Miejsce dla partnera – kontakt” |

**Nigdy nie wpisuj kluczy Stripe do `config.js`** – plik jest publiczny.

### Wdrożenie i uruchomienie sprzedaży (Cloudflare Pages)

1. **Cloudflare:** Workers & Pages → Create → Pages → Connect to Git → repozytorium → Framework preset: *None*, Build command: **puste**, Build output directory: **`public`** → Deploy. Katalog `functions/` jest wykrywany automatycznie (endpoint `/api/verify`).
2. **Stripe – produkt i link:** Product catalog → produkt „Wezwanie do zapłaty PDF”, cena **14,99 PLN** (jednorazowa) → Payment Links → nowy link: metody płatności **tylko BLIK**, „After payment” → *Don't show confirmation page* → redirect na
   `https://DOMENA/?platnosc=sukces&session_id={CHECKOUT_SESSION_ID}`.
   Skopiuj adres linku (`https://buy.stripe.com/…`) do `paymentUrl` w `config.js`, a jego identyfikator `plink_…` zapisz.
3. **Stripe – klucz ograniczony:** Developers → API keys → *Create restricted key* → tylko **Checkout Sessions: Read** → klucz `rk_live_…`. Pełny klucz `sk_…` jest odrzucany przez funkcję.
4. **Cloudflare → Settings → Variables and Secrets** (typ *Secret*, środowisko Production):
   - `STRIPE_SECRET_KEY` = `rk_live_…`
   - `PAYMENT_LINK_ID` = `plink_…`
   - `EXPECTED_AMOUNT` = `1499` (grosze)
   - opcjonalnie `MAX_AGE_DAYS` (domyślnie 30); `ALLOW_TEST_MODE=true` tylko na czas testów w trybie testowym Stripe.
5. Uzupełnij `seller` w `config.js`, przejrzyj Regulamin i Politykę prywatności (`index.html`) i wdroż ponownie.

Jak działa płatność: „Pobierz PDF” → okno z dwiema obowiązkowymi zgodami (Regulamin + art. 38 pkt 13 ustawy o prawach konsumenta) → strona sprawdza `/api/verify?ping=1`; jeśli serwer nie jest gotowy, klient widzi „Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków” → zapis formularza w `sessionStorage` (ta karta) i losowego identyfikatora zamówienia w `localStorage` → przekierowanie do Stripe z `client_reference_id` → po powrocie serwer sprawdza w Stripe sesję (opłacona, PLN, kwota, właściwy link, ten sam identyfikator zamówienia, tryb live, nie starsza niż 30 dni; do 3 ponowień co 2 s) → PDF pobiera się automatycznie. Podgląd przed płatnością nie zawiera treści pisma (szare paski).

GitHub Pages nie obsługuje funkcji serwerowych – sprzedaż tam nie zadziała (strona pokaże „Sprzedaż chwilowo niedostępna”).

### Bezpieczeństwo

- **Weryfikacja płatności na serwerze** – dostęp do PDF daje wyłącznie odpowiedź `/api/verify`, która pyta Stripe; dopisanie `?platnosc=sukces` do adresu ani podrobienie `localStorage` nic nie daje; link z `session_id` nie działa w innej przeglądarce (inny `client_reference_id`).
- **Brak zewnętrznych skryptów i stylów** – Tailwind prekompilowany, pdfmake hostowany lokalnie z kontrolą integralności (SRI).
- **Content Security Policy** – `default-src 'none'`, `script-src 'self'`, `connect-src 'self'`, `form-action 'none'`, `frame-ancestors 'none'` (w `_headers`; wersja bez `frame-ancestors` także w `index.html`). Przekierowanie do Stripe to nawigacja strony, nie wymaga zmian CSP.
- **Ochrona przed XSS** – każda wartość z formularza i konfiguracji jest escapowana; PDF dostaje zwykły tekst.
- **Prywatność** – brak cookies i analityki; trwałe zapamiętywanie formularza tylko po zaznaczeniu zgody i bez numeru konta; na czas płatności formularz (z IBAN) tylko w `sessionStorage` bieżącej karty.
- **Brak sekretów w repozytorium** – klucz Stripe wyłącznie jako *Secret* w Cloudflare.

Ograniczenie: PDF jest generowany w przeglądarce, a silnik (`calc.js`) jest publiczny, więc osoba z wiedzą programistyczną może złożyć treść pisma samodzielnie. Bramka chroni przed zwykłym obejściem (adres, localStorage, udostępniony link), a dane użytkownika nie opuszczają jego urządzenia.

Zalecenia: 2FA na GitHubie, w Cloudflare, Stripe, u rejestratora domeny i na skrzynce e-mail; ochrona gałęzi `main`; przed każdą zmianą `config.js` sprawdź, czy `paymentUrl` prowadzi do Twojego konta Stripe.

### Zmiana wyglądu (dla programisty)

Po zmianie klas Tailwind w `public/index.html` lub `public/assets/app.js`:

```bash
npm install
npm run build:css
npm test        # calc + verify + e2e (Playwright z Chromium, pdftotext)
```

### Coroczna aktualizacja przepisów

W `public/assets/calc.js` (obiekt `LAW`) zaktualizuj: `minWage` (nowa płaca minimalna – rozporządzenie publikowane do 15 września), `minWageKnownUntil`, `interestDefault` (stopa referencyjna NBP + 5,5 p.p.). Współczynnik ekwiwalentowy liczy się automatycznie. Zaktualizuj teksty w sekcjach „Wzory”, FAQ i JSON-LD w `public/index.html`.

### Licencje zewnętrzne

pdfmake – licencja MIT; czcionka Roboto – Apache License 2.0; Tailwind CSS – licencja MIT. Teksty w `public/vendor/pdfmake/`.

### Zastrzeżenie

Narzędzie ma charakter informacyjny i nie stanowi porady prawnej ani podatkowej. Stan prawny: 24 października 2026 r.

---

## English

A static website (no database; the only server part is a Stripe payment-verification function; Polish UI) for employees being laid off in Poland. It calculates **holiday leave equivalence** (*ekwiwalent za urlop*, Art. 171 of the Labour Code) and **statutory severance pay** (*odprawa*, Art. 8 of the Act of 13 March 2003 on group layoffs) under 2026/2027 rules, audits the employer's final payslip, computes **statutory late-payment interest** and generates a **pre-litigation demand letter (PDF)**. Everything runs client-side; nothing is loaded from third-party servers.

### Key rules implemented

- Monthly base = fixed pay in the termination month + 3-month average of monthly variable pay (with absence top-up) + 12-month average of quarterly/annual bonuses.
- Leave-equivalence coefficient derived from the Polish holiday calendar (2026: 20.92 full-time; part-time scaled), stepwise rounding to grosz, 8 h (or 7 h) daily norm.
- Payout deadline for leave equivalence from 27 Jan 2026: employer's payday, or 10 days after termination if payday precedes termination (Art. 171 §4–5).
- Severance 1×/2×/3× base by tenure (<2 y / 2–8 y / >8 y), tenure counted to the termination date, capped at 15× the minimum wage on the termination date: PLN 72,090 (2026) and PLN 74,250 (2027).
- Severance exempt from social and health contributions; PIT 12%/32% or 0% (youth relief under 26).
- Late interest default 9.25% p.a. (NBP reference rate 3.75% + 5.5 pp, since 5 Mar 2026).

### Security

The calculator is free; only the demand-letter PDF is paid (PLN 14.99, BLIK via a Stripe Payment Link). Access is granted only after `functions/api/verify.js` (Cloudflare Pages Function, restricted `rk_` key) confirms in Stripe that the checkout session is paid, in PLN, for the expected amount and payment link, with the browser's random `client_reference_id`. Self-hosted dependencies, strict CSP, HTML escaping, no secrets in the repo. The calculation engine is public, so a technical user could still assemble the letter text themselves.

### Run, configure, deploy

- Run: `cd public && python3 -m http.server 8000` (free demo mode only on localhost with empty `paymentUrl`).
- Configure: edit `public/assets/config.js` (`paymentUrl`, `seller`, `lawFirm`); yearly, update `LAW` in `public/assets/calc.js`.
- Deploy: Cloudflare Pages, build command empty, output directory `public`; secrets `STRIPE_SECRET_KEY=rk_live_…`, `PAYMENT_LINK_ID=plink_…`, `EXPECTED_AMOUNT=1499`. Stripe Payment Link: BLIK only, redirect `https://DOMAIN/?platnosc=sukces&session_id={CHECKOUT_SESSION_ID}`.
- Develop: `npm install && npm run build:css && npm test`.

### Disclaimer

Informational tool only; not legal or tax advice. Legal status as of 24 October 2026.
