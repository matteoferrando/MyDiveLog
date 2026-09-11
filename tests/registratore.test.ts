import { describe, expect, it } from 'vitest';

import { conRegistrazione } from '../src/core/ble/registratore';
import type { BleLink } from '../src/core/ble/types';

/**
 * Un collegamento finto che non fa niente e ricorda cosa gli è stato chiesto.
 *
 * Serve a provare l'involucro **da solo**: le prove sull'Aladin, che è il
 * cliente vero, sono troppo generiche per sorvegliare il contenuto delle righe
 * — e due mutazioni l'hanno dimostrato restando verdi. *Una prova
 * d'integrazione dice che i fili sono attaccati; solo una mirata dice che
 * quello che passa nei fili è giusto.*
 */
function fintoCollegamento(risposte: Uint8Array[]): BleLink & { scritte: Uint8Array[] } {
  const scritte: Uint8Array[] = [];
  const coda = [...risposte];
  return {
    mtu: 20,
    mtuMisurato: true,
    scritte,
    async write(d) {
      scritte.push(d);
    },
    async writeFrame(d) {
      scritte.push(d);
    },
    async read() {
      return coda.shift() ?? new Uint8Array();
    },
    async readFrame() {
      return coda.shift() ?? new Uint8Array();
    },
    drain() {
      return coda.shift() ?? new Uint8Array();
    },
    describe: () => 'finto',
    async close() {},
  };
}

describe('► il registratore dello scambio ◄', () => {
  it('scrive TUTTI i byte, non un’anteprima', async () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * LA RIGA CHE VALE L'INTERO FILE.
     *
     * Il diario tecnico tronca apposta — lo incolla una persona dentro una
     * segnalazione. Questa registrazione no: serve a ricostruire un protocollo,
     * e un protocollo con i byte centrali mancanti non si ricostruisce.
     *
     * *Un'anteprima qui non darebbe nessun errore: darebbe un file che sembra
     * giusto e che si scopre inutile il giorno in cui l'apparecchio non c'è
     * più.* Per questo la prova guarda il primo byte, uno in mezzo e l'ultimo.
     */
    const righe: string[] = [];
    const finto = fintoCollegamento([]);
    const link = conRegistrazione(finto, righe);

    const comando = new Uint8Array(Array.from({ length: 40 }, (_, i) => i));
    await link.write(comando);

    expect(righe).toHaveLength(1);
    const riga = righe[0];
    expect(riga).toContain('40 byte');
    expect(riga, 'il primo').toContain('00 01 02');
    expect(riga, 'uno in mezzo').toContain('13 14 15');
    expect(riga, 'e soprattutto l’ULTIMO').toContain('25 26 27');
    // E il byte scritto davvero è passato intero al collegamento sotto: un
    // involucro che registra bene e scrive male sarebbe il peggiore dei due.
    expect([...finto.scritte[0]]).toEqual([...comando]);
  });

  it('registra tutte e due le strade di lettura, non solo una', async () => {
    /*
     * ► LA PROVA NATA DA UNA MUTAZIONE CHE NON MUTAVA. ◄ Togliendo la
     * registrazione da `read` le prove restavano verdi, perché il driver
     * dell'Aladin usa `readFrame`: la mutazione toccava una strada che quella
     * prova non percorreva. *Una mutazione che non muta è il modo più economico
     * di credere di avere una guardia.*
     */
    const righe: string[] = [];
    const link = conRegistrazione(
      fintoCollegamento([new Uint8Array([0xaa, 0xbb]), new Uint8Array([0xcc])]),
      righe,
    );
    await link.read(2);
    await link.readFrame();

    expect(righe).toHaveLength(2);
    expect(righe[0]).toContain('aa bb');
    expect(righe[1]).toContain('cc');
    expect(righe[1], 'e si distingue una lettura a pacchetti da una a byte').toContain('pacchetto intero');
  });

  it('i tempi ci sono, e crescono', async () => {
    // Metà del valore della registrazione: il sospettato numero uno, nel guasto
    // del Mares, è il RITMO con cui si parla al computer, non i byte.
    const righe: string[] = [];
    const link = conRegistrazione(fintoCollegamento([]), righe);
    await link.write(new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 12));
    await link.write(new Uint8Array([2]));

    const tempi = righe.map((r) => Number.parseFloat(r.trim().split(' ')[0]));
    expect(tempi).toHaveLength(2);
    expect(tempi[1], 'il secondo comando è dopo il primo').toBeGreaterThan(tempi[0]);
  });

  it('uno svuotamento a vuoto non sporca il file', async () => {
    // `drain` viene chiamato a raffica da alcuni driver: una riga «0 byte» per
    // ogni giro seppellirebbe la registrazione sotto il rumore, ed è il tipo di
    // rumore che fa smettere di leggere un file.
    const righe: string[] = [];
    const link = conRegistrazione(fintoCollegamento([]), righe);
    link.drain();
    link.drain();
    expect(righe).toEqual([]);
  });

  it('non cambia il comportamento del collegamento che avvolge', async () => {
    // Un involucro che registrasse bene e consegnasse male sarebbe peggio di
    // nessun involucro: il banco di prova deve osservare, non partecipare.
    const righe: string[] = [];
    const finto = fintoCollegamento([new Uint8Array([7, 8])]);
    const link = conRegistrazione(finto, righe);
    expect(link.mtu).toBe(finto.mtu);
    expect(link.mtuMisurato).toBe(finto.mtuMisurato);
    expect(link.describe?.()).toBe('finto');
    expect([...(await link.readFrame())]).toEqual([7, 8]);
  });
});
