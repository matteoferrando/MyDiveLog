/**
 * LE QUATTRO CONDIZIONI DEL SEGNALIBRO, UNA PER UNA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE ESISTE, E PERCHÉ LA PROVA CHE C'ERA NON BASTAVA. ◄
 *
 * In `tests/shearwaterBle.test.ts` c'è una prova intitolata «uno scarico
 * interrotto NON deve poter spostare il segnalibro». Il titolo parla del
 * segnalibro; l'unica asserzione dentro guarda `status === 'partial'`.
 *
 * Cioè: quella prova verifica che il DRIVER dica «mi sono fermato a metà». Non
 * verifica che qualcuno se ne accorga. Togliendo dalla schermata l'`if` che
 * legge lo stato, la prova resta verde e le immersioni si perdono lo stesso.
 * *Una guardia mai vista rossa non è una guardia*, e questa era rossa solo per
 * una mutazione dentro il driver — mai per una mutazione dove vive la decisione.
 *
 * Da qui la scelta di spostare la decisione in `segnalibroDaSalvare`, che è
 * codice puro, e di provarla qui: ogni condizione ha la sua riga, e togliendo
 * una qualunque delle quattro dalla funzione questo file diventa rosso.
 *
 * Provate a mutazione il 15 settembre 2026, una per volta, sostituendo la
 * condizione con `true` dentro `segnalibroDaSalvare`:
 *
 *   `Boolean(e.impronta)` → true   ⇒ 1 rossa
 *   `e.completo`          → true   ⇒ 1 rossa
 *   `e.salvate`           → true   ⇒ 1 rossa
 *   `e.tutteTradotte`     → true   ⇒ 1 rossa
 */

import { describe, expect, it } from 'vitest';
import {
  perchéNonSiSalva,
  segnalibroDaSalvare,
  type EsitoPerSegnalibro,
} from '../src/core/ble/segnalibroDaSalvare';

/** Lo scarico andato bene: tutte e quattro le condizioni vere. Da qui si toglie una cosa per volta. */
const PERFETTO: EsitoPerSegnalibro = {
  impronta: '00000001',
  completo: true,
  salvate: true,
  tutteTradotte: true,
};

describe('quando il segnalibro si può spostare', () => {
  it('lo scarico perfetto lo salva — altrimenti non salverebbe mai niente', () => {
    /*
     * Questa riga non è cerimonia: senza, tutte le altre passerebbero anche con
     * `segnalibroDaSalvare` che restituisce sempre `false`, e un segnalibro che
     * non si sposta mai vuol dire rileggere l'intera memoria del computer a
     * ogni scarico. La prova che serve al caso buono protegge dalla correzione
     * pigra al caso cattivo.
     */
    expect(segnalibroDaSalvare(PERFETTO)).toBe(true);
    expect(perchéNonSiSalva(PERFETTO)).toBe('');
  });

  it('senza impronta non si salva: non c’è niente su cui fermarsi', () => {
    expect(segnalibroDaSalvare({ ...PERFETTO, impronta: undefined })).toBe(false);
    // La stringa vuota è un'impronta assente travestita: `Boolean('')` è falso
    // apposta, perché `since: () => ''` fermerebbe il manifesto alla prima.
    expect(segnalibroDaSalvare({ ...PERFETTO, impronta: '' })).toBe(false);
  });

  it('uno scarico interrotto non lo sposta, ed è il caso che perde tutto', () => {
    /*
     * Quaranta immersioni su cento in mano, le sessanta in fondo mai viste.
     * Salvare qui direbbe al prossimo scarico «da qui in giù ce l'ho»: quelle
     * sessanta non verrebbero offerte mai più, e il protocollo non permette di
     * ripartire da metà lista.
     */
    const interrotto = { ...PERFETTO, completo: false };
    expect(segnalibroDaSalvare(interrotto)).toBe(false);
    expect(perchéNonSiSalva(interrotto)).toContain('non è arrivato in fondo');
  });

  it('se l’archivio non ha confermato la scrittura non si sposta', () => {
    /*
     * ► IL DIFETTO DEL 15 SETTEMBRE 2026. ◄
     *
     * Disco pieno: le immersioni arrivano dal computer, `importDives` fallisce,
     * la schermata lo dice — e il segnalibro si spostava lo stesso, perché sulla
     * strada di libdivecomputer nessuno chiedeva com'era andata la scrittura.
     * Risultato: l'utente libera spazio, riscarica, e il computer risponde
     * «niente di nuovo». Per sempre.
     *
     * «Arrivate» e «salvate» sono due cose diverse. Questa riga è la differenza.
     */
    const nonSalvate = { ...PERFETTO, salvate: false };
    expect(segnalibroDaSalvare(nonSalvate)).toBe(false);
    expect(perchéNonSiSalva(nonSalvate)).toContain("l'archivio non ha confermato");
  });

  it('se un record non è diventato immersione non si sposta', () => {
    /*
     * libdivecomputer emette il suo record anche per un'immersione che il
     * traduttore poi scarta (niente data, o né profondità né durata). L'impronta
     * della più recente può essere proprio quella: fermarsi lì salterebbe lei e
     * tutte quelle sotto. È lo stesso danno da un'altra porta, e ha già un file
     * suo: `tests/segnalibroEsterno.test.ts`.
     */
    const conScarti = { ...PERFETTO, tutteTradotte: false };
    expect(segnalibroDaSalvare(conScarti)).toBe(false);
    expect(perchéNonSiSalva(conScarti)).toContain('non è diventato');
  });

  it('due condizioni false insieme restano false, e il motivo è il più grave', () => {
    // Nessuna condizione «compensa» un'altra: sono tutte necessarie, e il
    // motivo mostrato è quello che viene prima nella lista, cioè il più vicino
    // alla perdita di dati.
    expect(segnalibroDaSalvare({ impronta: undefined, completo: false, salvate: false, tutteTradotte: false })).toBe(
      false,
    );
    expect(perchéNonSiSalva({ ...PERFETTO, completo: false, salvate: false })).toContain(
      'non è arrivato in fondo',
    );
  });
});
