/* =====================================================================
   USTAWIENIA WŁAŚCICIELA STRONY – zwykle jedyny plik, który trzeba edytować.
   NIGDY nie wpisuj tutaj kluczy Stripe (sk_…, rk_…) ani haseł –
   ten plik jest publiczny. Klucze trzymasz wyłącznie w ustawieniach
   Cloudflare Pages (Variables and Secrets).
   ===================================================================== */
window.SITE_CONFIG = Object.freeze({
  siteName: 'SprawdźOdprawę.pl',        // nazwa w nagłówku, stopce i PDF
  siteUrl: 'https://TWOJA-DOMENA.pl/',  // adres serwisu (do regulaminu)

  // Cena PDF w zł – musi być równa cenie produktu w Stripe i zmiennej EXPECTED_AMOUNT (w groszach: 1499).
  price: 14.99,

  // Link płatności Stripe (Payment Link, tylko BLIK), np. 'https://buy.stripe.com/abc123'.
  // Pusty = sprzedaż wyłączona (na komputerze lokalnym działa tryb demonstracyjny).
  paymentUrl: '',

  // Weryfikacja płatności po stronie serwera (functions/api/verify.js na Cloudflare Pages).
  verifyEndpoint: '/api/verify',

  // Dane sprzedawcy do regulaminu, polityki prywatności i stopki.
  seller: Object.freeze({
    name: '[imię i nazwisko / firma]',
    address: '[adres]',
    email: '[e-mail kontaktowy]',
    nip: ''
  }),

  pdfBranding: true,                    // dopisek z nazwą serwisu w stopce PDF

  // Kancelaria partnerska (link partnerski / lead). Puste = neutralne miejsce „dla partnera”.
  lawFirm: Object.freeze({
    name: '',                           // np. 'Kancelaria Radcy Prawnego Jan Nowak'
    url: '',                            // https://… strona lub formularz rezerwacji
    email: '',                          // e-mail do zapytań
    phone: ''                           // telefon, np. '+48 600 000 000'
  })
});
