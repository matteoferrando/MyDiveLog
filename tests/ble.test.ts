/**
 * Il trasporto Bluetooth, provato senza Bluetooth.
 *
 * È l'unica ragione per cui questo strato esiste separato dal plugin: un
 * protocollo di computer subacqueo non è documentato da nessun costruttore, va
 * ricostruito, e la prima versione di una cosa ricostruita è sbagliata in
 * qualche punto. Se per scoprire quale punto serve il computer acceso, un Mac e
 * una build, si scopre una cosa al giorno.
 *
 * Quello che si prova qui non è «funziona»: è che i modi in cui questa cosa
 * fallisce davvero — pacchetti spezzati, risposte incollate, silenzio,
 * disconnessione a metà, residui di una sessione precedente — producono un
 * errore leggibile e non un blocco o un numero sbagliato.
 */

import { describe, expect, it, vi } from 'vitest';
import { BleClosedError, BleTimeoutError, ByteStream, chunkForMtu } from '../src/core/ble/stream';
import { FakeTransport, fakeDevice, type FakeResponder } from '../src/core/ble/fake';
import { downloadFromComputer } from '../src/core/ble/download';
import { advertisesService, either, nameStartsWith, recognise } from '../src/core/ble/registry';
import type { Dive } from '../src/core/model';
import type { BleFoundDevice, DiveComputerDriver, DownloadedRecord } from '../src/core/ble/types';

const bytes = (...n: number[]) => new Uint8Array(n);

// ---------------------------------------------------------------- il flusso

describe('da notifiche a byte', () => {
  it('ricompone un campo spezzato fra due notifiche', async () => {
    // È il caso normale, non l'eccezione: l'MTU è 20 byte e nessun protocollo
    // ha campi allineati a 20.
    const s = new ByteStream();
    const attesa = s.read(6);
    s.push(bytes(1, 2, 3));
    s.push(bytes(4, 5, 6, 7));
    expect([...(await attesa)]).toEqual([1, 2, 3, 4, 5, 6]);
    // Il settimo byte resta in coda: appartiene alla risposta dopo.
    expect(s.available).toBe(1);
  });

  it('serve una lettura già soddisfatta senza aspettare', async () => {
    const s = new ByteStream();
    s.push(bytes(9, 8, 7));
    expect([...(await s.read(2))]).toEqual([9, 8]);
  });

  it('due risposte incollate nella stessa notifica restano due letture', async () => {
    // Succede appena il firmware è più veloce dello stack BLE. Un driver che
    // assume «una notifica = un messaggio» qui legge la seconda risposta come
    // continuazione della prima.
    const s = new ByteStream();
    s.push(bytes(0xa1, 0x01, 0xa2, 0x02));
    expect([...(await s.read(2))]).toEqual([0xa1, 0x01]);
    expect([...(await s.read(2))]).toEqual([0xa2, 0x02]);
  });

  it('il silenzio diventa una scadenza leggibile, non un blocco', async () => {
    vi.useFakeTimers();
    try {
      const s = new ByteStream();
      const p = s.read(4, 1000);
      s.push(bytes(1, 2));
      vi.advanceTimersByTime(1000);
      await expect(p).rejects.toBeInstanceOf(BleTimeoutError);
      // E il messaggio dice quanti ne mancavano: è quello che serve per capire
      // se il protocollo è sbagliato o se il computer è andato in sospensione.
      await p.catch((e: BleTimeoutError) => {
        expect(e.wanted).toBe(4);
        expect(e.got).toBe(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('la disconnessione sveglia subito chi stava aspettando', async () => {
    // Senza questo, una lettura in corso alla disconnessione resterebbe appesa
    // fino alla scadenza: quattro secondi di interfaccia ferma su un evento
    // che è già noto.
    const s = new ByteStream();
    const p = s.read(10);
    s.close('il dispositivo si è allontanato');
    await expect(p).rejects.toBeInstanceOf(BleClosedError);
  });

  it('una lettura su un flusso già chiuso fallisce invece di aspettare', async () => {
    const s = new ByteStream();
    s.close('via');
    await expect(s.read(1)).rejects.toBeInstanceOf(BleClosedError);
  });

  it('quello che è già arrivato si legge anche dopo la chiusura', async () => {
    // Quaranta immersioni arrivate e poi il collegamento caduto valgono
    // quaranta immersioni.
    const s = new ByteStream();
    s.push(bytes(1, 2, 3));
    s.close('via');
    expect([...(await s.read(3))]).toEqual([1, 2, 3]);
  });

  it('due letture insieme sono un errore del driver, e lo dice', async () => {
    const s = new ByteStream();
    void s.read(4).catch(() => {});
    await expect(s.read(1)).rejects.toThrow(/driver/i);
  });

  it('azzerare butta i residui di una risposta scaduta', () => {
    /*
     * È il difetto più insidioso di tutti: una risposta arrivata DOPO la sua
     * scadenza resta in coda, e la risposta al comando successivo viene letta a
     * partire da quei byte. Il risultato non è un errore — è un valore
     * plausibile e sbagliato, cioè un'immersione con la profondità di un'altra.
     */
    const s = new ByteStream();
    s.push(bytes(0xde, 0xad));
    s.reset();
    expect(s.available).toBe(0);
  });
});

describe('spezzare le scritture', () => {
  it('sotto l’MTU non tocca niente', () => {
    expect(chunkForMtu(bytes(1, 2, 3), 20)).toHaveLength(1);
  });

  it('sopra l’MTU divide senza perdere né duplicare byte', () => {
    const dati = new Uint8Array(45).map((_, i) => i);
    const pezzi = chunkForMtu(dati, 20);
    expect(pezzi.map((p) => p.length)).toEqual([20, 20, 5]);
    expect([...pezzi.flatMap((p) => [...p])]).toEqual([...dati]);
  });

  it('un MTU assurdo non produce un ciclo infinito', () => {
    expect(chunkForMtu(bytes(1, 2, 3), 0)).toHaveLength(3);
  });
});

// ------------------------------------------------------------ il riconoscere

describe('riconoscere un computer dall’annuncio', () => {
  const dev = (name: string, over: Partial<BleFoundDevice> = {}) => fakeDevice({ name, ...over });

  it('il prefisso è ancorato all’inizio, non cercato dentro', () => {
    // «Perdix Pro Buds» non è un Perdix, e connettersi al dispositivo di
    // qualcun altro per mandargli comandi è il danno peggiore che questa
    // funzione possa fare.
    const test = nameStartsWith('perdix', 'peregrine');
    expect(test(dev('Peregrine'))).toBe(true);
    expect(test(dev('PEREGRINE 1234'))).toBe(true);
    expect(test(dev('Perdix Pro Buds'))).toBe(true);
    expect(test(dev('Cuffie Perdix Pro'))).toBe(false);
  });

  it('un nome vuoto non riconosce niente', () => {
    // Un dispositivo senza nome annunciato è comunissimo, e un prefisso vuoto
    // che combacia con tutto trasformerebbe l'elenco in un campo minato.
    expect(nameStartsWith('peregrine')(dev(''))).toBe(false);
    expect(nameStartsWith('')(dev('qualsiasi cosa'))).toBe(false);
  });

  it('il servizio annunciato funziona anche senza nome', () => {
    const test = advertisesService('FE25C237-0ECE-443C-B0AA-E02033E7029D');
    expect(test(dev('', { serviceUuids: ['fe25c237-0ece-443c-b0aa-e02033e7029d'] }))).toBe(true);
    expect(test(dev('', { serviceUuids: ['0000180f-0000-1000-8000-00805f9b34fb'] }))).toBe(false);
  });

  it('nome o servizio: basta uno dei due', () => {
    const test = either(nameStartsWith('peregrine'), advertisesService('abcd'));
    expect(test(dev('', { serviceUuids: ['abcd'] }))).toBe(true);
    expect(test(dev('Peregrine'))).toBe(true);
    expect(test(dev('Frigorifero'))).toBe(false);
  });

  it('i dispositivi non riconosciuti restano nell’elenco, in fondo', () => {
    /*
     * Nasconderli sarebbe peggio: chi ha un computer che non supportiamo deve
     * poter vedere che l'app lo TROVA e non lo sa leggere. È un'informazione
     * diversa da «non lo trova», e porta a una segnalazione utile invece che a
     * un'ora persa dietro al Bluetooth del Mac.
     */
    const driver = {
      id: 'x',
      label: 'Finto',
      matches: nameStartsWith('peregrine'),
    } as unknown as DiveComputerDriver;
    const out = recognise(
      [dev('Cuffie', { id: 'a', rssi: -40 }), dev('Peregrine', { id: 'b', rssi: -80 })],
      [driver],
    );
    expect(out.map((r) => r.device.id)).toEqual(['b', 'a']);
    expect(out[0].driver).toBe(driver);
    expect(out[1].driver).toBeUndefined();
  });

  it('un driver che esplode nel riconoscimento non fa sparire gli altri', () => {
    const rotto = {
      id: 'rotto',
      matches: () => {
        throw new Error('bum');
      },
    } as unknown as DiveComputerDriver;
    const buono = { id: 'buono', matches: nameStartsWith('peregrine') } as unknown as DiveComputerDriver;
    expect(recognise([dev('Peregrine')], [rotto, buono])[0].driver).toBe(buono);
  });
});

// ---------------------------------------------------------------- lo scarico

/**
 * Un protocollo finto ma della forma giusta: un byte di comando, una risposta
 * a lunghezza fissa. Basta a provare l'orchestrazione, che è quello che ci
 * interessa qui — i protocolli veri hanno i loro test.
 */
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
      const totale = testa[1];
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

/** Tre immersioni: `0x10` dice quante ce ne sono, `0x20 n` dà la n-esima. */
const rispondiTre: FakeResponder = (cmd) => {
  if (cmd[0] === 0x10) return bytes(0x10, 3);
  if (cmd[0] === 0x20) return bytes(20 + cmd[1], 0, 0, 0);
  return undefined;
};

const trasporto = (responder: FakeResponder, quirks = {}) =>
  new FakeTransport([{ device: fakeDevice(), responder, quirks }]);

describe('lo scarico dall’inizio alla fine', () => {
  it('scarica tutto e riporta modello, totale e immersioni', async () => {
    const t = trasporto(rispondiTre);
    const eventi: string[] = [];
    const out = await downloadFromComputer(t, fakeDevice(), driverFinto(), {
      onEvent: (e) => eventi.push(e.kind),
    });
    expect(out.status).toBe('complete');
    expect(out.model).toBe('Finto 1');
    expect(out.serial).toBe('SN-1');
    expect(out.total).toBe(3);
    expect(out.dives.map((d) => d.maxDepth)).toEqual([20, 21, 22]);
    expect(eventi).toEqual(['connecting', 'identified', 'counted', 'record', 'record', 'record']);
  });

  it('regge l’MTU corta: le risposte arrivano a pezzi', async () => {
    // Con un MTU di 2 byte, la risposta da 4 byte arriva in due notifiche. Il
    // risultato deve essere identico — è tutto il punto di `ByteStream`.
    const t = trasporto(rispondiTre, { mtu: 2 });
    const out = await downloadFromComputer(t, fakeDevice(), driverFinto());
    expect(out.dives.map((d) => d.maxDepth)).toEqual([20, 21, 22]);
  });

  it('una disconnessione a metà TIENE quello che era arrivato', async () => {
    /*
     * È la regola per cui esiste tutta questa impalcatura. Sono minuti di
     * trasferimento: un errore che azzera il lavoro fatto è il motivo per cui
     * la gente rinuncia e ricopia a mano dal computer.
     */
    const t = trasporto(rispondiTre, { dropAfterCommands: 3 });
    const out = await downloadFromComputer(t, fakeDevice(), driverFinto());
    expect(out.status).toBe('partial');
    expect(out.error).toBeTruthy();
    // Un comando per il conteggio, due immersioni lette, poi il buio.
    expect(out.dives).toHaveLength(2);
    expect(out.total).toBe(3);
  });

  it('il silenzio del computer diventa un errore, non un’attesa infinita', async () => {
    const t = trasporto(() => undefined, { mtu: 20 });
    const out = await downloadFromComputer(t, fakeDevice(), driverFinto());
    expect(out.status).toBe('partial');
    expect(out.error).toMatch(/non ha risposto/i);
    expect(out.dives).toHaveLength(0);
  });

  it('il Bluetooth spento si spiega invece di fallire e basta', async () => {
    const t = new FakeTransport([], {
      reason: 'off',
      detail: 'Il Bluetooth di questo Mac è spento.',
    });
    const out = await downloadFromComputer(t, fakeDevice(), driverFinto());
    expect(out.status).toBe('partial');
    expect(out.error).toMatch(/spento/i);
  });

  it('annullare interrompe e restituisce quello che c’è', async () => {
    const t = trasporto(rispondiTre);
    const ctl = new AbortController();
    const out = await downloadFromComputer(t, fakeDevice(), driverFinto(), {
      onEvent: (e) => {
        if (e.kind === 'record' && e.done === 1) ctl.abort();
      },
      signal: ctl.signal,
    });
    expect(out.dives).toHaveLength(1);
  });

  it('chiude il collegamento anche quando lo scarico esplode', async () => {
    /*
     * Un collegamento BLE lasciato aperto tiene il computer sveglio finché la
     * batteria non finisce, e su alcuni modelli impedisce all'app del
     * costruttore di connettersi finché non lo si spegne a mano. Deve chiudersi
     * sul percorso d'errore, che è quello che nessuno prova.
     */
    const t = trasporto(rispondiTre);
    await downloadFromComputer(
      t,
      fakeDevice(),
      driverFinto({
        download() {
          throw new Error('protocollo sbagliato');
        },
      }),
    );
    const link = t.lastLink!;
    await expect(link.read(1)).rejects.toBeInstanceOf(BleClosedError);
  });

  it('una decodifica che fallisce non nasconde che i dati erano arrivati', async () => {
    const t = trasporto(rispondiTre);
    const out = await downloadFromComputer(
      t,
      fakeDevice(),
      driverFinto({
        decode() {
          throw new Error('formato non riconosciuto');
        },
      }),
    );
    expect(out.dives).toHaveLength(0);
    expect(out.warnings.join(' ')).toMatch(/3 immersioni sono state scaricate/i);
  });

  it('un’immersione illeggibile non ferma le altre', async () => {
    const t = trasporto(rispondiTre);
    const out = await downloadFromComputer(
      t,
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
    );
    expect(out.status).toBe('complete');
    expect(out.dives).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/d0.*troncato/i);
  });

  it('i residui di una sessione precedente non entrano nella prima risposta', async () => {
    /*
     * Il finto dispositivo mette in coda due byte prima ancora del primo
     * comando, come fa un computer che aveva una sessione aperta. Un driver che
     * non azzera il flusso legge quei byte come intestazione e sbaglia tutto
     * il resto in modo plausibile.
     */
    const t = new FakeTransport([
      {
        device: fakeDevice(),
        responder: rispondiTre,
        quirks: { garbageOnOpen: bytes(0xde, 0xad) },
      },
    ]);
    const out = await downloadFromComputer(
      t,
      fakeDevice(),
      driverFinto({
        async download(link, { emit }) {
          // Questa riga è la differenza fra un driver giusto e uno sbagliato.
          link.drain();
          await link.write(bytes(0x10));
          const testa = await link.read(2);
          emit({ kind: 'counted', total: testa[1] });
          return [];
        },
      }),
    );
    expect(out.total).toBe(3);
  });
});
