/**
 * Una frase con dei numeri dentro, che si traduce PRIMA di riempirla.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL PROBLEMA CHE RISOLVE. ◄
 *
 * In questa applicazione la chiave del dizionario è **la frase italiana intera**
 * (vedi `ui/lingua.tsx`). Funziona benissimo per le frasi fisse. Non funziona
 * per quelle che contengono un numero: se il testo si compone prima, con
 *
 *     `Consumo medio ${rmv.toFixed(1)} L/min su ${n} immersioni.`
 *
 * la chiave da cercare cambia a ogni immersione — «Consumo medio 17.3 L/min su
 * 42 immersioni.» — e nel dizionario non ci sarà mai. È il motivo per cui
 * novantuno frasi del piano di miglioramento sono rimaste in italiano anche con
 * l'applicazione in inglese: non erano state dimenticate, non c'era modo di
 * tradurle.
 *
 * L'alternativa che si prova per prima è spezzare la frase in pezzi traducibili
 * e ricucirli intorno ai numeri. Va bene per due parole — `${t('fra')} 3
 * ${t('mesi')}` — e diventa insopportabile per un paragrafo: l'inglese ha un
 * altro ordine delle parole, e una frase composta a pezzi in ordine italiano
 * esce sgrammaticata.
 *
 * ► LA SOLUZIONE. ◄ La chiave resta la frase intera, con i numeri sostituiti da
 * segnaposti numerati:
 *
 *     frase(t, 'Consumo medio {0} L/min su {1} immersioni.', rmv.toFixed(1), n)
 *
 * Si traduce PRIMA e si riempie DOPO. Chi traduce vede la frase completa, con i
 * segnaposti dove andranno i numeri, e **può spostarli**: in inglese
 * «{1} dives at {0} L/min» è legittimo quanto l'ordine italiano. È la stessa
 * idea di `printf` e di ICU MessageFormat, ridotta all'osso perché qui serve
 * solo questo.
 *
 * ► PERCHÉ I SEGNAPOSTI SONO NUMERATI E NON NOMINATI. ◄ `{profondita}` si legge
 * meglio di `{0}`, ma raddoppia il lavoro di chi traduce — deve copiare i nomi
 * esatti — e un nome sbagliato lascia un buco nella frase senza dire niente.
 * Con gli indici, chi traduce copia la frase e sposta i pezzi; e il test del
 * dizionario controlla che l'italiano e l'inglese abbiano **gli stessi
 * segnaposti**, che è un controllo che con i nomi non si potrebbe fare senza
 * conoscere il significato.
 *
 * ► COSA SUCCEDE SE MANCA LA TRADUZIONE. ◄ Niente di male: `t()` restituisce la
 * chiave, cioè l'italiano, e i numeri entrano lo stesso. Una frase non tradotta
 * resta una frase corretta in italiano, mai una frase mutilata — che è la
 * proprietà su cui è costruito tutto il dizionario di questo progetto.
 */

import type { Traduci } from './traduci';

/** Il segnaposto: `{0}`, `{1}`, … Fuori dalla funzione per non ricompilarlo a ogni chiamata. */
const SEGNAPOSTO = /\{(\d+)\}/g;

/**
 * Traduce `modello` e ci mette dentro i `valori`, in ordine.
 *
 * @param t        chi traduce. Senza, resta italiano — che è la chiave.
 * @param modello  la frase italiana con `{0}`, `{1}`… al posto dei numeri.
 * @param valori   i valori, nell'ordine degli indici.
 */
export function frase(t: Traduci, modello: string, ...valori: (string | number)[]): string {
  return t(modello).replace(SEGNAPOSTO, (intero, indice: string) => {
    const v = valori[Number(indice)];
    /*
     * Un segnaposto senza valore resta com'è, invece di diventare vuoto.
     *
     * Sembra brutto ed è voluto: `{3}` a schermo è un difetto che si nota e si
     * segnala, uno spazio bianco in mezzo a una frase no. Se un giorno una
     * traduzione inglese inventa un `{3}` che l'italiano non ha, deve essere
     * evidente — e il test del dizionario lo prende prima, ma la rete serve.
     */
    return v === undefined ? intero : String(v);
  });
}

/**
 * Gli indici dei segnaposti presenti in una frase, ordinati e senza doppioni.
 *
 * Serve al test del dizionario: una traduzione è utilizzabile solo se usa
 * esattamente gli stessi segnaposti dell'originale. Se l'inglese ne perde uno,
 * quel numero sparisce dalla frase — e sparisce in silenzio, perché il testo
 * resta grammaticalmente sensato. È il genere di difetto che non si trova mai
 * leggendo, e che una riga di test prende sempre.
 */
export function segnapostiDi(modello: string): number[] {
  const trovati = new Set<number>();
  for (const m of modello.matchAll(SEGNAPOSTO)) trovati.add(Number(m[1]));
  return [...trovati].sort((a, b) => a - b);
}
