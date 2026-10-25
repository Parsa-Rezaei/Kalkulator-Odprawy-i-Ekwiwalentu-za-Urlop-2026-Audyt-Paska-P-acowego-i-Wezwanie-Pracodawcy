# Kalkulator Odprawy i Ekwiwalentu za Urlop 2026/2027 – Audyt Rozliczenia + Wezwanie do Zapłaty

[Polski](#polski) · [English](#english)

---

## Polski

Darmowa strona statyczna (bez serwera i bazy danych) dla pracowników zwalnianych z pracy w Polsce (likwidacja stanowiska, redukcja etatów, zwolnienia grupowe). Liczy **ekwiwalent za niewykorzystany urlop** i **odprawę pieniężną** według przepisów obowiązujących w 2026 i 2027 r., sprawdza, czy pracodawca nie zaniżył wypłaty, liczy **odsetki ustawowe za opóźnienie** i generuje **przedsądowe wezwanie do zapłaty w PDF**.

Wszystkie obliczenia i PDF powstają w przeglądarce użytkownika – żadne dane nie są wysyłane na serwer, strona nie ładuje nic z zewnętrznych serwerów.

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
| Monetyzacja | okno płatności (BuyCoffee.to / link BLIK / przelew na telefon) przed pobraniem PDF, miejsce na kancelarię partnerską |
| SEO | meta tagi, `SoftwareApplication` i `FAQPage` (JSON-LD), sekcje z wzorami i FAQ |

### Struktura plików

| Plik | Rola |
|---|---|
| `index.html` | treść strony, polityka bezpieczeństwa (CSP), dane strukturalne SEO |
| `config.js` | **ustawienia właściciela** – linki płatności, cena, kancelaria (jedyny plik do edycji) |
| `assets/calc.js` | silnik obliczeń (przepisy, daty, kwoty, treść wezwania) |
| `assets/app.js` | interfejs, PDF, okno płatności |
| `assets/app.css` | gotowy arkusz stylów (Tailwind CSS 4.3.3, zbudowany z `src/input.css`) |
| `vendor/pdfmake/` | biblioteka pdfmake 0.2.23 z czcionką Roboto (hostowana lokalnie) |
| `_headers` | nagłówki bezpieczeństwa dla Cloudflare Pages / Netlify |
| `tests/` | testy silnika obliczeń (`npm test`) |

### Uruchomienie lokalne

```bash
python3 -m http.server 8000
# otwórz http://localhost:8000
```

### Konfiguracja (`config.js`)

| Pole | Opis |
|---|---|
| `siteName` | nazwa serwisu w nagłówku, stopce i PDF |
| `contactEmail` | firmowy e-mail w stopce i w przycisku „Zostań partnerem” |
| `pdfPrice` | cena wyświetlana w oknie płatności |
| `buyCoffeeUrl` | link `https://buycoffee.to/...` |
| `paymentLinkUrl` | opcjonalny link `https://` do Stripe, Tpay, Przelewy24 lub PayPal |
| `blikPhone` | opcjonalny numer telefonu do przelewu BLIK na telefon |
| `paywallMode` | `'honor'` (użytkownik potwierdza płatność), `'code'` (kod odblokowujący), `'free'` |
| `unlockCodeHashes` | tryb `'code'`: skróty SHA-256 kodów (kod jest zamieniany na WIELKIE LITERY) |
| `lawFirm` | kancelaria partnerska: `name`, `url` (https), `email`, `phone` |

Jeśli żaden sposób płatności nie jest poprawnie skonfigurowany, PDF pobiera się bez opłaty. Linki spoza dozwolonych domen (lista `PAYMENT_HOSTS` w `assets/app.js`) są odrzucane.

Skrót kodu odblokowującego (użyj losowego kodu, min. 12 znaków, zmieniaj co miesiąc):

```bash
printf '%s' 'K7Q2-M9XW-4TRP' | sha256sum
```

### Bezpieczeństwo

Zastosowane zabezpieczenia:

- **Brak zewnętrznych skryptów i stylów** – Tailwind jest prekompilowany, pdfmake hostowany lokalnie (kod identyczny z wydaniem npm, sumy w `vendor/pdfmake/SHA384SUMS`), ładowany z kontrolą integralności (SRI). Przejęcie CDN lub cudzego serwera nie może zmienić strony ani podmienić linku płatności.
- **Content Security Policy** – `script-src 'self'`, `style-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` (w `index.html`; pełny zestaw nagłówków z `frame-ancestors 'none'`, HSTS, `X-Frame-Options` w `_headers`).
- **Ochrona przed XSS** – każda wartość wpisana przez użytkownika lub z konfiguracji jest escapowana przed wstawieniem do HTML; PDF otrzymuje wyłącznie zwykły tekst.
- **Walidacja konfiguracji** – linki płatności tylko `https://` z listy dozwolonych domen, e-mail i telefon sprawdzane wzorcem, `javascript:` i inne schematy odrzucane.
- **Ograniczenie danych wejściowych** – limity długości pól, zakresy liczb (np. kwoty do 100 mln zł, daty 1950–2100), odporność na `NaN`/`Infinity`.
- **Prywatność** – brak cookies i analityki; zapamiętywanie danych w przeglądarce tylko po zaznaczeniu zgody; numer konta nigdy nie jest zapisywany.
- **Ochrona przed clickjackingiem** – strona nie działa w cudzej ramce (`frame-ancestors 'none'` + zabezpieczenie w skrypcie).
- **Brak sekretów w repozytorium** – nie ma kluczy API ani haseł; `.gitignore` wyklucza pliki `.env`.

Ograniczenie, o którym trzeba wiedzieć: bramka płatności działa w przeglądarce, więc osoba znająca narzędzia programistyczne może ją obejść. Nie da się tego naprawić bez serwera, który generowałby PDF po zweryfikowaniu płatności (wtedy dane użytkownika trafiałyby na serwer). Twoje pieniądze z płatności są bezpieczne – trafiają bezpośrednio do operatora (BuyCoffee/Stripe), strona ich nie dotyka.

Zalecenia dla właściciela:

1. Włącz uwierzytelnianie dwuskładnikowe (2FA) na GitHubie, u rejestratora domeny, w Cloudflare, BuyCoffee/Stripe i na skrzynce e-mail.
2. Na GitHubie: Settings → Branches → reguła ochrony gałęzi `main` (wymagany pull request); Settings → Pages → zweryfikuj własną domenę (chroni przed przejęciem domeny).
3. U rejestratora: automatyczne odnawianie domeny i blokada transferu.
4. Przed każdą zmianą `config.js` sprawdź, czy linki płatności prowadzą do Twojego konta.

### Wdrożenie

**Cloudflare Pages (zalecane – obsługuje nagłówki bezpieczeństwa z `_headers`):** Workers & Pages → Create → Pages → Connect to Git → wybierz repozytorium → Framework preset: *None*, Build command: puste, Build output directory: `/` → Deploy.

**GitHub Pages:** Settings → Pages → Source: *Deploy from a branch* → gałąź `main`, folder `/ (root)` → Save. GitHub Pages nie obsługuje własnych nagłówków – działa wtedy polityka CSP z `index.html`.

### Zmiana wyglądu (dla programisty)

Po zmianie klas Tailwind w `index.html` lub `assets/app.js`:

```bash
npm install
npm run build:css
npm test
```

### Coroczna aktualizacja przepisów

W `assets/calc.js` (obiekt `LAW`) zaktualizuj: `minWage` (nowa płaca minimalna – rozporządzenie publikowane do 15 września), `minWageKnownUntil`, `interestDefault` (stopa referencyjna NBP + 5,5 p.p.). Współczynnik ekwiwalentowy liczy się automatycznie. Zaktualizuj teksty w sekcjach „Wzory”, FAQ i JSON-LD w `index.html`.

### Licencje zewnętrzne

pdfmake – licencja MIT; czcionka Roboto – Apache License 2.0; Tailwind CSS – licencja MIT. Teksty w `vendor/pdfmake/`.

### Zastrzeżenie

Narzędzie ma charakter informacyjny i nie stanowi porady prawnej ani podatkowej. Stan prawny: 24 października 2026 r.

---

## English

A free static website (no server, no database, Polish UI) for employees being laid off in Poland. It calculates **holiday leave equivalence** (*ekwiwalent za urlop*, Art. 171 of the Labour Code) and **statutory severance pay** (*odprawa*, Art. 8 of the Act of 13 March 2003 on group layoffs) under 2026/2027 rules, audits the employer's final payslip, computes **statutory late-payment interest** and generates a **pre-litigation demand letter (PDF)**. Everything runs client-side; nothing is loaded from third-party servers.

### Key rules implemented

- Monthly base = fixed pay in the termination month + 3-month average of monthly variable pay (with absence top-up) + 12-month average of quarterly/annual bonuses.
- Leave-equivalence coefficient derived from the Polish holiday calendar (2026: 20.92 full-time; part-time scaled), stepwise rounding to grosz, 8 h (or 7 h) daily norm.
- Payout deadline for leave equivalence from 27 Jan 2026: employer's payday, or 10 days after termination if payday precedes termination (Art. 171 §4–5).
- Severance 1×/2×/3× base by tenure (<2 y / 2–8 y / >8 y), tenure counted to the termination date, capped at 15× the minimum wage on the termination date: PLN 72,090 (2026) and PLN 74,250 (2027).
- Severance exempt from social and health contributions; PIT 12%/32% or 0% (youth relief under 26).
- Late interest default 9.25% p.a. (NBP reference rate 3.75% + 5.5 pp, since 5 Mar 2026).

### Security

Self-hosted dependencies (no CDN), strict Content Security Policy, HTML escaping of all user and config values, allow-listed HTTPS payment links, input length/range limits, opt-in local storage that never stores the IBAN, anti-framing, security headers for Cloudflare Pages/Netlify in `_headers`. The client-side paywall can be bypassed by technical users; enforcing it would require a server that generates the PDF after verified payment.

### Run, configure, deploy

- Run: `python3 -m http.server 8000`.
- Configure: edit `config.js`; yearly, update `LAW` in `assets/calc.js`.
- Deploy: Cloudflare Pages (recommended, applies `_headers`) or GitHub Pages (root folder, no build step).
- Develop: `npm install && npm run build:css && npm test`.

### Disclaimer

Informational tool only; not legal or tax advice. Legal status as of 24 October 2026.
