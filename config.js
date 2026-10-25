/*
 * USTAWIENIA WŁAŚCICIELA STRONY – zwykle jedyny plik, który trzeba edytować.
 *
 * Bezpieczeństwo:
 *  - Linki płatności muszą zaczynać się od https:// i prowadzić do domeny z listy
 *    PAYMENT_HOSTS w assets/app.js (BuyCoffee.to, Stripe, Tpay, Przelewy24, PayPal).
 *    Inne adresy są ignorowane – chroni to przed podmianą linku na obcy.
 *  - Nie wpisuj tu haseł, kluczy API ani danych prywatnych – plik jest publiczny.
 *  - Kody odblokowujące (tryb 'code') wpisuj wyłącznie jako skróty SHA-256,
 *    nigdy jako zwykły tekst. Używaj losowych kodów (min. 12 znaków).
 */
window.SITE_CONFIG = Object.freeze({
  siteName: 'SprawdźOdprawę.pl',      // nazwa w nagłówku, stopce i PDF
  contactEmail: '',                     // firmowy e-mail kontaktowy (nie prywatny)
  pdfPrice: '14,99 zł',                 // cena wyświetlana w oknie płatności
  buyCoffeeUrl: '',                     // np. 'https://buycoffee.to/twoja-nazwa'
  paymentLinkUrl: '',                   // opcjonalnie: np. 'https://buy.stripe.com/...'
  blikPhone: '',                        // opcjonalnie: numer do przelewu BLIK na telefon
  paywallMode: 'honor',                 // 'honor' | 'code' | 'free'
  unlockCodeHashes: Object.freeze([]),  // tryb 'code': skróty SHA-256 (64 znaki hex)
  pdfBranding: true,                    // dopisek z nazwą serwisu w stopce PDF
  lawFirm: Object.freeze({              // kancelaria partnerska (lead)
    name: '',                           // np. 'Kancelaria Radcy Prawnego Jan Nowak'
    url: '',                            // https://… strona lub formularz rezerwacji
    email: '',                          // e-mail do zapytań
    phone: ''                           // telefon, np. '+48 600 000 000'
  })
});
