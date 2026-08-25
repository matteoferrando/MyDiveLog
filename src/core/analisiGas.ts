/**
 * La bombola analizzata di persona, e cosa fare quando l'etichetta mente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERCHÉ QUESTO FILE ESISTE. Fra tutte le procedure dei manuali didattici, una
 * sola è imposta senza sfumature, senza «dipende» e senza rimandi ad altri
 * corsi:
 *
 *   «No diver should breathe any mixture they have not personally confirmed
 *    prior to the dive» — TDI *Advanced Nitrox* (2013), p. 73
 *
 * L'applicazione non aveva un posto dove registrarla. Si poteva scrivere che
 * la bombola conteneva EAN32 — che è quello che c'è scritto sull'adesivo — e
 * nient'altro. Un logbook che non registra l'unica verifica obbligatoria della
 * didattica che cita è un logbook a cui manca un pezzo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IL VALORE NON È ARCHIVIARE IL NUMERO: È IL CONFRONTO.
 *
 * Registrare «ho analizzato 32%» accanto a «l'etichetta dice 32%» non serve a
 * molto. Serve quando i due numeri NON coincidono, perché in quel caso tutto
 * ciò che l'applicazione ha calcolato è appoggiato al numero sbagliato:
 *
 *   - la **MOD** è più profonda di quella vera, ed è il pericolo diretto;
 *   - la **PPO2** lungo il profilo è sottostimata;
 *   - l'**esposizione all'ossigeno** (CNS, OTU) è più bassa del reale;
 *   - l'**END** e il calcolo dei gas cambiano di conseguenza.
 *
 * Un analizzatore di ossigeno ha una precisione dichiarata attorno all'1%
 * assoluto, e va tarato in aria prima di ogni uso. Sotto quella soglia la
 * differenza è strumento, non gas: segnalarla produrrebbe un avviso a ogni
 * immersione e in due settimane nessuno lo leggerebbe più. Sopra, è un fatto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUELLO CHE QUESTO MODULO NON FA, ed è deliberato: **non corregge `mix`**.
 * Il valore analizzato non sovrascrive quello dichiarato, perché sovrascriverlo
 * cancellerebbe l'unica informazione che conta — che i due non coincidevano. Si
 * dice, e decide chi era lì con l'analizzatore in mano.
 */

import type { AnalisiGas, Cylinder, GasMix } from './model';
import { mod } from './units';
import { comeSta, type Traduci } from './traduci';

/**
 * Quanto può discordare l'analizzatore prima che sia il GAS a essere diverso.
 *
 * Un punto percentuale è la precisione tipica di una cella all'ossigeno tarata
 * in aria poco prima. È la soglia sotto la quale un avviso direbbe soltanto
 * «il tuo strumento è uno strumento».
 */
export const TOLLERANZA_ANALISI = 0.01;

/** Uno scarto fra quello che c'è scritto e quello che hai misurato. */
export interface ScartoAnalisi {
  /** Indice della bombola nell'immersione, per poterla nominare. */
  bombola: number;
  /** Frazione dichiarata e frazione misurata dell'ossigeno. */
  o2Dichiarato: number;
  o2Analizzato: number;
  /** La MOD a 1.4 bar con l'uno e con l'altro, in metri. */
  modDichiarata: number;
  modAnalizzata: number;
}

/** Vero se questa analisi discorda dall'etichetta più di quanto sbagli lo strumento. */
export function discorda(mix: GasMix, analisi: AnalisiGas): boolean {
  if (Math.abs(analisi.o2 - mix.o2) > TOLLERANZA_ANALISI) return true;
  const heDichiarato = mix.he ?? 0;
  const heAnalizzato = analisi.he;
  if (heAnalizzato === undefined) return false;
  return Math.abs(heAnalizzato - heDichiarato) > TOLLERANZA_ANALISI;
}

/**
 * Le bombole in cui l'etichetta e l'analizzatore non vanno d'accordo.
 *
 * Restituisce anche le due MOD, perché è quello il numero che una persona
 * guarda per decidere se importa: «due punti percentuali» non dice niente,
 * «quaranta metri invece di trentasette» dice tutto.
 */
export function scartiDiAnalisi(cylinders: readonly Cylinder[] | undefined): ScartoAnalisi[] {
  const out: ScartoAnalisi[] = [];
  (cylinders ?? []).forEach((c, i) => {
    if (!c.analisi || !c.mix) return;
    if (!discorda(c.mix, c.analisi)) return;
    out.push({
      bombola: i,
      o2Dichiarato: c.mix.o2,
      o2Analizzato: c.analisi.o2,
      modDichiarata: mod(c.mix),
      modAnalizzata: mod({ o2: c.analisi.o2, he: c.analisi.he ?? c.mix.he ?? 0 }),
    });
  });
  return out;
}

/**
 * Lo scarto, detto in una frase.
 *
 * ► QUALE DEI DUE CASI È QUELLO PERICOLOSO, perché è controintuitivo e me lo
 * sono sbagliato scrivendolo la prima volta. ◄
 *
 * Più ossigeno c'è, più la MOD è BASSA. Quindi:
 *
 *  - analizzato **più** ossigeno del dichiarato → la MOD vera è più bassa di
 *    quella mostrata → l'applicazione ha lasciato credere a un limite più
 *    profondo del reale. **È questo il caso che fa male**, e sembra il
 *    contrario perché «più ossigeno» suona come «più sicuro».
 *  - analizzato **meno** ossigeno del dichiarato → la MOD vera è più profonda
 *    → i conti fatti finora erano prudenti. Resta da dire, perché cambia
 *    l'esposizione all'ossigeno nella direzione opposta, ma non è un pericolo
 *    immediato.
 *
 * La frase nomina la MOD prima della percentuale: è il numero con cui si
 * prendono decisioni, e «due punti percentuali» non dice a nessuno quanto
 * sarebbe stato profondo l'errore.
 */
export function descriviScarto(s: ScartoAnalisi, t: Traduci = comeSta): string {
  const dichiarato = Math.round(s.o2Dichiarato * 100);
  const analizzato = Math.round(s.o2Analizzato * 100);
  const limiteEraTroppoProfondo = s.modAnalizzata < s.modDichiarata;
  /*
   * Le chiavi del dizionario sono frasi intere e non parole sciolte. Una chiave
   * come `non` o `contro` si traduce male e si riusa peggio: in un dizionario
   * dove la chiave È la frase italiana, le parole singole sono la strada per
   * ritrovarsi un «not» dentro una frase che voleva dire un'altra cosa.
   */
  return (
    `${t('Analizzato')} ${analizzato}%, ${t('dichiarato')} ${dichiarato}%. ` +
    `${t('La MOD a 1.4 bar è')} ${s.modAnalizzata.toFixed(1)} m ` +
    `${t('invece di')} ${s.modDichiarata.toFixed(1)} m: ` +
    (limiteEraTroppoProfondo
      ? t('il limite mostrato finora era più profondo di quello vero.')
      : t('i conti fatti finora erano prudenti.'))
  );
}

/** L'analisi, detta in breve: «32% · 11/07/2026 · Luca». */
export function descriviAnalisi(a: AnalisiGas): string {
  const pezzi = [`${Math.round(a.o2 * 100)}%`];
  if (a.he !== undefined && a.he > 0) pezzi[0] = `${Math.round(a.o2 * 100)}/${Math.round(a.he * 100)}`;
  if (a.quando) pezzi.push(a.quando.slice(0, 10).split('-').reverse().join('/'));
  if (a.chi) pezzi.push(a.chi);
  return pezzi.join(' · ');
}
