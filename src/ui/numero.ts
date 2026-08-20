/**
 * La lettura di un numero digitato a mano, in un posto solo.
 *
 * PERCHÉ NON `type="number"`. Un campo numerico HTML accetta come separatore
 * decimale SOLO quello della lingua della webview, e su un sistema in inglese —
 * o su una WKWebView che non ha ereditato la lingua di sistema — la virgola non
 * è un carattere valido. Il browser non segnala niente: `e.target.value` arriva
 * vuoto o troncato, quindi chi scrive «6,5» salva 65. È già successo due volte
 * in questo progetto: la prima nel modulo di inserimento a mano, la seconda —
 * trovata da una revisione con l'app in mano — nella scheda di modifica di
 * un'immersione e nella scheda dell'attrezzatura, che erano rimaste indietro.
 * Da qui in poi la conversione sta qui, e i campi sono di testo.
 *
 * Accetta entrambi i separatori e restituisce `undefined` per il campo vuoto o
 * illeggibile — non zero: zero è un'affermazione, e riempirebbe con un dato
 * falso una casella che l'utente ha lasciato in bianco.
 */
export function numeroDaTesto(v: string): number | undefined {
  const t = v.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Il numero riportato dentro i suoi limiti, quando ci sono. */
export function entroLimiti(n: number, min?: number, max?: number): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));
}
