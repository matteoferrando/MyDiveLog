/**
 * LA CHIAVE BUTTATA PER UN GUASTO CHE NON LA RIGUARDA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Dal diario di un Aqualung i330R, 16 settembre 2026, secondo tentativo:
 *
 *     collegamento non riuscito dopo 3 tentativi:
 *     collegamento non riuscito: Timeout during execution of Connect
 *     …
 *     lo scarico è fallito con una chiave conservata: chiave dimenticata,
 *     la prossima volta si riparte dal PIN
 *
 * La chiave di accoppiamento **non era mai stata presentata**: si usa dopo il
 * collegamento, e il collegamento non si era aperto. Buttarla costa sei cifre da
 * ridigitare e non poteva servire a niente.
 *
 * *Una cura che non può curare questo guasto, applicata a questo guasto, non è
 * prudenza: è un fastidio.*
 *
 * ► E LA REGOLA CHE RESTA. ◄ Dopo uno scarico fallito la chiave si butta
 * davvero, ed è giusto: una chiave che non vale più — computer azzerato,
 * accoppiato con un altro telefono — bloccherebbe quel computer per sempre,
 * perché con una chiave in mano il driver salta del tutto il ramo del PIN. Le
 * due metà di questa prova sono quelle due situazioni.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COLLEGAMENTO_NON_APERTO, ilCollegamentoNonSiEAperto } from '../src/core/ble/causaGuasto';

describe('quando il collegamento non si apre, la chiave non c’entra', () => {
  it('riconosce il guasto del 16 settembre', () => {
    const vero =
      'collegamento non riuscito dopo 3 tentativi: collegamento non riuscito: Timeout during execution of Connect';
    expect(ilCollegamentoNonSiEAperto(new Error(vero))).toBe(true);
    expect(ilCollegamentoNonSiEAperto(vero)).toBe(true);
  });

  it('e NON si allarga a uno scarico fallito, che è il caso in cui la chiave si butta', () => {
    // La metà che impedisce di «semplificare» tenendo sempre la chiave: lì il
    // costo di tenerla è un computer che non si scarica mai più.
    for (const altro of [
      'errore — scarico non riuscito (stato -8, errore di protocollo)',
      'Invalid packet length (96).',
      'lo scarico si è rotto, ma 40 immersioni erano già arrivate',
      '',
    ]) {
      expect(ilCollegamentoNonSiEAperto(new Error(altro)), altro).toBe(false);
    }
    expect(ilCollegamentoNonSiEAperto(undefined)).toBe(false);
    expect(ilCollegamentoNonSiEAperto(null)).toBe(false);
  });
});

describe('la frase è un’interfaccia fra due metà dello stesso programma', () => {
  it('e il Rust la scrive ancora così', () => {
    /*
     * ► PERCHÉ QUESTA PROVA ESISTE. ◄ In testa a `causaGuasto.ts` c'è scritto
     * che classificare un errore dal testo è fragile. Qui il testo è NOSTRO — lo
     * scrive `ponte_blec.rs` — quindi la fragilità non è che qualcuno cambi una
     * parola a monte: è che la cambiamo noi, di là, senza guardare di qua.
     *
     * Il giorno che succede, questa diventa rossa invece di lasciare una chiave
     * buttata a ogni collegamento mancato.
     */
    const rust = readFileSync('src-tauri/src/ponte_blec.rs', 'utf8');
    expect(rust).toContain(COLLEGAMENTO_NON_APERTO);
  });

  it('e l’interfaccia la usa dove la chiave si decide', () => {
    // Grossolana, e prende l'unico errore che si fa: riscrivere quel ramo e
    // dimenticarsi la distinzione.
    const tsx = readFileSync('src/ui/components/BleDownload.tsx', 'utf8');
    const ramo = tsx.slice(tsx.indexOf('dimenticaAccoppiamento(device.id)') - 2000);
    expect(ramo.slice(0, 2100)).toContain('ilCollegamentoNonSiEAperto(');
  });
});
