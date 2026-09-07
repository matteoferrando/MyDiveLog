/**
 * Confronto fra numeri di versione, per le guardie sui pacchetti generati.
 *
 * La cask di Homebrew e il PKGBUILD descrivono l'ULTIMA RELEASE PUBBLICATA,
 * non il repository: la loro impronta è quella di un file che GitHub serve, e
 * quel file esiste solo dopo la release. Fra il momento in cui `package.json`
 * sale e quello in cui la release esiste, restano indietro per forza. Quello
 * che non può succedere mai è il contrario — un pacchetto generato più avanti
 * del progetto punta a una release che non può esistere.
 */

/** `a` non è più avanti di `b`, confrontando numero per numero e non come testo. */
export function nonPiuAvanti(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const na = a.split('.').map(Number);
  const nb = b.split('.').map(Number);
  if (na.length !== 3 || nb.length !== 3 || [...na, ...nb].some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if (na[i] < nb[i]) return true;
    if (na[i] > nb[i]) return false;
  }
  return true;
}
