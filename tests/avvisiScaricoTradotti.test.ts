/**
 * GLI AVVISI CHE IL NUCLEO DELLO SCARICO COMPONE, NELLA LINGUA DI CHI LEGGE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO. ◄ Finito uno scarico, sotto la riga verde con il riepilogo,
 * `BleDownload` disegna un elenco di avvisi:
 *
 *     {stato.avvisi.map((a, i) => <li key={i}>{a}</li>)}
 *
 * Così com'erano. Le frasi però nascono in `core` — i motivi di scarto di
 * `ble/esterni.ts`, gli avvisi di `ble/download.ts` e dei driver — e in `core`
 * la lingua non si sa: **con l'applicazione in inglese comparivano in italiano**.
 *
 * Non è un elenco qualsiasi: è *la spiegazione del perché mancano delle
 * immersioni*. Chi ha appena aspettato tre minuti di trasferimento conta quello
 * che è entrato, e se il conto non torna queste righe sono l'unica cosa che
 * glielo dice.
 *
 * ► LE DUE METÀ DELLA CURA. ◄
 *
 *  1. Le frasi con un NUMERO dentro si compongono in `download.ts`, che riceve
 *     `t`: un numero entrato nella frase prima del dizionario farebbe una chiave
 *     nuova a ogni scarico. Il modello resta uno solo e `chiaviDi` lo vede.
 *     **È questa metà che si prova qui.**
 *  2. Tutte le altre — motivi di scarto, frasi dei driver — si traducono dove si
 *     disegnano, con `frase(t, a)`: lo prova `avvisiScaricoDisegnati.test.tsx`,
 *     che monta la schermata.
 */

import { describe, expect, it } from 'vitest';

import { FakeTransport, fakeDevice, type FakeResponder } from '../src/core/ble/fake';
import { downloadFromComputer } from '../src/core/ble/download';
import { nameStartsWith } from '../src/core/ble/registry';
import { INGLESE as EN } from '../src/ui/traduzioni';
import type { Dive } from '../src/core/model';
import type { DiveComputerDriver, DownloadedRecord } from '../src/core/ble/types';

const inglese = (s: string) => EN[s] ?? s;
const bytes = (...n: number[]) => new Uint8Array(n);

// ---------------------------------------------------------------------------
// 1. Il nucleo compone le frasi col numero dentro, nella lingua che gli si dà
// ---------------------------------------------------------------------------

/** Tre immersioni: `0x10` dice quante sono, `0x20 n` dà la n-esima. */
const rispondiTre: FakeResponder = (cmd) => {
  if (cmd[0] === 0x10) return bytes(0x10, 3);
  if (cmd[0] === 0x20) return bytes(20 + cmd[1]!, 0, 0, 0);
  return undefined;
};

function driverFinto(over: Partial<DiveComputerDriver> = {}): DiveComputerDriver {
  return {
    id: 'finto',
    label: 'Computer finto',
    profile: {
      service: 'aaaa',
      writeCharacteristic: 'bbbb',
      notifyCharacteristic: 'cccc',
      writeType: 'withoutResponse',
    },
    matches: nameStartsWith('peregrine'),
    async download(link, { emit, signal }) {
      emit({ kind: 'identified', model: 'Finto 1', serial: 'SN-1' });
      await link.write(bytes(0x10));
      const testa = await link.read(2, 300);
      const totale = testa[1]!;
      emit({ kind: 'counted', total: totale });
      const out: DownloadedRecord[] = [];
      for (let i = 0; i < totale; i++) {
        if (signal.aborted) break;
        await link.write(bytes(0x20, i));
        const corpo = await link.read(4, 300);
        const record = { key: `d${i}`, bytes: corpo };
        out.push(record);
        emit({ kind: 'record', done: i + 1, total: totale, record });
      }
      return out;
    },
    decode(records) {
      return {
        dives: records.map(
          (r) =>
            ({
              id: r.key,
              startTime: '2026-06-01T09:00:00Z',
              durationS: 1800,
              maxDepth: r.bytes[0],
              mode: 'oc',
              cylinders: [],
              tags: [],
              source: { format: 'manual', file: 'bluetooth', importedAt: 'x' },
            }) as unknown as Dive,
        ),
        warnings: [],
      };
    },
    ...over,
  };
}

const trasporto = (responder: FakeResponder) =>
  new FakeTransport([{ device: fakeDevice(), responder, quirks: {} }]);

describe('gli avvisi che il nucleo compone', () => {
  it('«tre immersioni non si sono potute decodificare» esce in inglese, col numero al suo posto', async () => {
    const out = await downloadFromComputer(
      trasporto(rispondiTre),
      fakeDevice(),
      driverFinto({
        decode() {
          throw new Error('formato non riconosciuto');
        },
      }),
      { t: inglese },
    );
    const testo = out.warnings.join(' ');
    expect(testo).toContain('The 3 dives were downloaded but could not be decoded');
    expect(testo).toContain('formato non riconosciuto');
    // Il difetto era proprio questo: una frase italiana sotto un riepilogo inglese.
    expect(testo).not.toMatch(/immersioni sono state scaricate/);
    // E il segnaposto deve essere stato riempito, non lasciato lì.
    expect(testo).not.toContain('{0}');
  });

  it('e senza traduzione resta italiano, che è la chiave', () => {
    // La proprietà su cui è costruito il dizionario: una frase non tradotta è
    // una frase corretta in italiano, mai una frase mutilata.
    return downloadFromComputer(
      trasporto(rispondiTre),
      fakeDevice(),
      driverFinto({
        decode() {
          throw new Error('formato non riconosciuto');
        },
      }),
    ).then((out) => {
      expect(out.warnings.join(' ')).toMatch(/Le 3 immersioni sono state scaricate/);
    });
  });

  it('un’immersione saltata dal driver la racconta al singolare, senza «1 immersioni»', async () => {
    const out = await downloadFromComputer(
      trasporto(rispondiTre),
      fakeDevice(),
      driverFinto({
        async download(link, { emit }) {
          await link.write(bytes(0x10));
          await link.read(2);
          emit({ kind: 'skipped', key: 'd0', reason: 'record troncato in memoria' });
          await link.write(bytes(0x20, 1));
          const corpo = await link.read(4);
          const record = { key: 'd1', bytes: corpo };
          emit({ kind: 'record', done: 1, record });
          return [record];
        },
      }),
      { t: inglese },
    );
    const testo = out.warnings.join(' ');
    expect(testo).toContain('One dive could not be read');
    expect(testo).not.toMatch(/\b1 dives\b/);
    expect(testo).not.toMatch(/immersione non si è potuta leggere/);
  });
});
