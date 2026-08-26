/**
 * Un numero scritto in lettere, da zero a novantanove.
 *
 * ► PERCHÉ SERVE IN UN FILE DI PROVA. ◄ I commenti di questo progetto scrivono
 * i numeri in lettere — «dieci brevetti su quarantaquattro» — perché è prosa e
 * non una tabella. Un commento che porta un numero è però un'affermazione come
 * un'altra, e questa qui è già stata falsa una volta: diceva trentacinque
 * quando erano quarantaquattro, perché l'elenco era cresciuto e il commento no.
 * Per controllarla bisogna sapere come si scrive quel numero, e quindi saperlo
 * scrivere.
 *
 * Le elisioni ci sono tutte perché sono esattamente il punto in cui un
 * controllo del genere fallisce per niente: «ventiuno» e «ventitre» non li
 * scrive nessuno, si scrive «ventuno» e «ventitré», e una guardia che si
 * accende su una forma che nessuno userebbe insegna a spegnerla.
 */
export function inLettere(n: number): string {
  const UNITA = [
    'zero',
    'uno',
    'due',
    'tre',
    'quattro',
    'cinque',
    'sei',
    'sette',
    'otto',
    'nove',
    'dieci',
    'undici',
    'dodici',
    'tredici',
    'quattordici',
    'quindici',
    'sedici',
    'diciassette',
    'diciotto',
    'diciannove',
  ];
  const DECINE = [
    '',
    '',
    'venti',
    'trenta',
    'quaranta',
    'cinquanta',
    'sessanta',
    'settanta',
    'ottanta',
    'novanta',
  ];
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`inLettere sa contare da zero a novantanove, non ${n}`);
  }
  if (n < 20) return UNITA[n];
  const d = DECINE[Math.floor(n / 10)];
  const u = n % 10;
  if (u === 0) return d;
  // «ventuno», non «ventiuno»: davanti a uno e otto la decina perde la vocale.
  if (u === 1 || u === 8) return d.slice(0, -1) + UNITA[u];
  // «ventitré», con l'accento: è l'unico caso in cui il tre lo prende.
  if (u === 3) return d + 'tré';
  return d + UNITA[u];
}
