/**
 * Il protocollo Shearwater, provato contro un finto Peregrine.
 *
 * Il finto non è un mock: è un'implementazione del protocollo scritta
 * dall'altra parte. Riceve notifiche da venti byte con la loro intestazione,
 * riassembla lo SLIP, legge il pacchetto di trasporto, risponde con manifesto e
 * immersioni compresse con lo stesso RLE a nove bit e lo stesso XOR a blocchi
 * di trentadue. Se le due implementazioni non combaciano, il test fallisce qui
 * invece che in barca.
 *
 * PERCHÉ È IL TEST GIUSTO E PERCHÉ NON BASTA. È il test giusto perché gli
 * errori che questo protocollo produce sono errori di CONTEGGIO — un byte di
 * intestazione dimenticato, un blocco numerato da zero invece che da uno, un
 * XOR applicato al pezzo invece che al flusso — e sono tutti riproducibili
 * senza hardware. Non basta perché un finto Peregrine scritto da chi ha scritto
 * il driver condivide le sue idee sbagliate: se ho frainteso libdivecomputer,
 * l'ho frainteso da tutte e due le parti. Per quello serve il computer vero, e
 * il commento in cima al driver lo dice.
 *
 * Per limitare il rischio, il finto è scritto guardando il C e non il nostro
 * TypeScript, e usa i propri codificatori invece di riusare i nostri: un test
 * che chiama `slipFrames` per costruire la risposta che `SlipDecoder` dovrà
 * leggere non prova niente.
 */

import { describe, expect, it } from 'vitest';
import { downloadFromComputer } from '../src/core/ble/download';
import { FakeTransport, fakeDevice } from '../src/core/ble/fake';
import {
  SlipDecoder,
  decompressLre,
  decompressXor,
  logbookBase,
  parseManifest,
  shearwaterDriver,
  slipFrames,
} from '../src/core/ble/drivers/shearwater';
import { decodePnf } from '../src/core/parsers/shearwaterPnf';

const END = 0xc0;
const ESC = 0xdb;

// ------------------------------------------------------------------- SLIP

describe('inquadramento SLIP', () => {
  it('un pacchetto corto sta in una notifica sola, e dichiara «una»', () => {
    const f = slipFrames(Uint8Array.from([1, 2, 3]));
    expect(f).toHaveLength(1);
    expect([...f[0]]).toEqual([1, 0, 1, 2, 3, END]);
  });

  it('i byte speciali si raddoppiano PRIMA di contare le notifiche', () => {
    /*
     * È l'errore che questo inquadramento invita a fare. Il primo byte di ogni
     * notifica dice di quante notifiche è fatto il messaggio, e l'escaping
     * cambia la lunghezza: contando prima di escapare, un pacchetto al limite
     * dichiara una notifica in meno di quelle che manda, e il firmware smette
     * di ascoltare a metà.
     */
    const f = slipFrames(Uint8Array.from([END, ESC]));
    expect([...f[0]]).toEqual([1, 0, ESC, 0xdc, ESC, 0xdd, END]);
  });

  it('sopra i diciotto byte utili passa a due notifiche, numerate da zero', () => {
    const f = slipFrames(new Uint8Array(20));
    expect(f).toHaveLength(2);
    expect(f[0][0]).toBe(2);
    expect(f[0][1]).toBe(0);
    expect(f[1][1]).toBe(1);
    // Nessun byte perso: 20 di carico + il separatore = 21 utili in due notifiche.
    expect(f[0].length - 2 + (f[1].length - 2)).toBe(21);
  });

  it('il decodificatore ricompone un pacchetto sparso su più notifiche', () => {
    const d = new SlipDecoder();
    for (const f of slipFrames(Uint8Array.from([...new Array(30).keys()]))) d.push(f);
    expect([...d.next()!]).toEqual([...new Array(30).keys()]);
    expect(d.next()).toBeUndefined();
  });

  it('scarta i pacchetti vuoti invece di consegnarli', () => {
    // Il firmware manda separatori ripetuti per accorgersi del rumore. Se
    // arrivassero come pacchetti, ogni comando ne troverebbe uno prima della
    // risposta vera e leggerebbe l'intestazione sbagliata.
    const d = new SlipDecoder();
    d.push(Uint8Array.from([1, 0, END, END, 7, 8, END, END]));
    expect([...d.next()!]).toEqual([7, 8]);
    expect(d.next()).toBeUndefined();
  });

  it('una notifica senza intestazione è un errore, non due byte di dati', () => {
    const d = new SlipDecoder();
    expect(() => d.push(Uint8Array.from([0xc0]))).toThrow(/intestazione/i);
  });
});

// ---------------------------------------------------------- decompressione

describe('decompressione', () => {
  /** Il codificatore RLE a nove bit, scritto qui dalla descrizione del formato. */
  function comprimiLre(bytes: number[], finale = true): Uint8Array {
    const bits: number[] = [];
    const spingi = (v: number) => {
      for (let i = 8; i >= 0; i--) bits.push((v >> i) & 1);
    };
    let i = 0;
    while (i < bytes.length) {
      if (bytes[i] === 0) {
        let run = 0;
        while (i < bytes.length && bytes[i] === 0 && run < 255) {
          run++;
          i++;
        }
        spingi(run); // bit alto spento: è una sequenza di zeri
      } else {
        spingi(0x100 | bytes[i]);
        i++;
      }
    }
    if (finale) spingi(0);
    // Il flusso deve essere un multiplo di nove bit, quindi di nove byte:
    // si completa con gruppi «fine flusso», che il lettore ignora.
    while (bits.length % 72 !== 0) spingi(0);
    const out = new Uint8Array(bits.length / 8);
    bits.forEach((b, k) => {
      if (b) out[k >> 3] |= 0x80 >> (k & 7);
    });
    return out;
  }

  it('il giro completo restituisce i byte di partenza', () => {
    const originale = [1, 2, 3, 0, 0, 0, 0, 9, 8, 0, 7];
    const out: number[] = [];
    const { final } = decompressLre(comprimiLre(originale), out);
    expect(final).toBe(true);
    expect(out).toEqual(originale);
  });

  it('un blocco di lunghezza non multipla di nove bit è un errore dichiarato', () => {
    // Non è pignoleria: un blocco così significa che si sta leggendo qualcosa
    // che non è questo flusso, e proseguire produrrebbe byte plausibili.
    expect(() => decompressLre(new Uint8Array(10), [])).toThrow(/nove bit/i);
  });

  it('lo XOR si disfa da sé, e tocca solo dal trentatreesimo byte', () => {
    /*
     * Il verso conta. Il disfacimento è ascendente e usa il blocco PRECEDENTE
     * GIÀ DISFATTO, quindi la cifratura corrispondente è discendente e usa il
     * blocco originale. Scrivendo il codificatore nello stesso verso del
     * decodificatore il giro non torna — ed è il primo modo in cui si sbaglia
     * questa funzione, perché sembra simmetrica e non lo è.
     */
    const originale = new Uint8Array(80).map((_, i) => (i * 7) & 0xff);
    const cifrato = originale.slice();
    for (let i = cifrato.length - 1; i >= 32; i--) cifrato[i] ^= cifrato[i - 32];
    expect([...decompressXor(cifrato)]).toEqual([...originale]);
  });

  it('sotto i trentadue byte lo XOR non cambia niente', () => {
    const d = Uint8Array.from([1, 2, 3]);
    expect([...decompressXor(d)]).toEqual([1, 2, 3]);
  });
});

// -------------------------------------------------------------- manifesto

describe('manifesto', () => {
  const voce = (addr: number, fp: number[], header = 0xa5c4) => {
    const r = new Uint8Array(32);
    r[0] = header >> 8;
    r[1] = header & 0xff;
    r.set(fp, 4);
    r[20] = (addr >>> 24) & 0xff;
    r[21] = (addr >>> 16) & 0xff;
    r[22] = (addr >>> 8) & 0xff;
    r[23] = addr & 0xff;
    return r;
  };
  const pagina = (voci: Uint8Array[]) => {
    const p = new Uint8Array(0x600);
    voci.forEach((v, i) => p.set(v, i * 32));
    return p;
  };

  it('legge indirizzo e impronta', () => {
    const m = parseManifest(pagina([voce(0x1234, [1, 2, 3, 4])]));
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].address).toBe(0x1234);
    expect([...m.entries[0].fingerprint]).toEqual([1, 2, 3, 4]);
  });

  it('le cancellate si saltano ma si CONTANO', () => {
    /*
     * Il criterio per chiedere un'altra pagina è «questa era piena», e una
     * pagina piena di immersioni cancellate è comunque piena. Non contarle
     * farebbe smettere di leggere il manifesto alla prima pagina con qualche
     * cancellazione: le immersioni più vecchie sparirebbero dallo scarico
     * senza nessun errore.
     */
    const m = parseManifest(pagina([voce(1, [0, 0, 0, 1], 0x5a23), voce(2, [0, 0, 0, 2])]));
    expect(m.entries).toHaveLength(1);
    expect(m.deleted).toBe(1);
  });

  it('una pagina piena si dichiara piena', () => {
    const tutte = Array.from({ length: 48 }, (_, i) => voce(i, [0, 0, 0, i]));
    expect(parseManifest(pagina(tutte)).full).toBe(true);
    expect(parseManifest(pagina(tutte.slice(0, 3))).full).toBe(false);
  });

  it('un’intestazione sconosciuta chiude la pagina', () => {
    const m = parseManifest(pagina([voce(1, [0, 0, 0, 1]), voce(2, [0, 0, 0, 2], 0x0000)]));
    expect(m.entries).toHaveLength(1);
  });
});

describe('base del logbook', () => {
  const rsp = (addr: number) =>
    Uint8Array.from([0, (addr >>> 24) & 0xff, (addr >>> 16) & 0xff, (addr >>> 8) & 0xff, addr & 0xff]);

  it('i tre valori del formato vecchio puntano tutti allo stesso indirizzo', () => {
    for (const a of [0xdd000000, 0xc0000000, 0x90000000]) expect(logbookBase(rsp(a))).toBe(0xc0000000);
  });

  it('il formato nuovo tiene il suo', () => {
    expect(logbookBase(rsp(0x80000000))).toBe(0x80000000);
  });

  it('uno sconosciuto si rifiuta invece di indovinare', () => {
    // Indovinare qui significa leggere memoria a un indirizzo a caso e
    // interpretarne il contenuto come immersioni.
    expect(() => logbookBase(rsp(0x11223344))).toThrow(/sconosciuto/i);
  });
});

// ---------------------------------------------------- il finto Peregrine

/**
 * Un Peregrine che non esiste, scritto dall'altra parte del protocollo.
 *
 * Riceve notifiche, riassembla lo SLIP con un decodificatore proprio, e
 * risponde. Il carico delle immersioni è un log PNF sintetico, così il giro
 * arriva fino a `decodePnf` e non si ferma ai byte.
 */
function fintoPeregrine(logs: Uint8Array[]) {
  let inArrivo: number[] = [];
  let escaped = false;
  const daMandare: Uint8Array[] = [];

  /** L'inverso di quello che fa il driver, scritto a parte apposta. */
  const incapsula = (payload: number[]) => {
    const pacchetto = [0x01, 0xff, payload.length + 1, 0x00, ...payload];
    const esc: number[] = [];
    for (const c of pacchetto) {
      if (c === END) esc.push(ESC, 0xdc);
      else if (c === ESC) esc.push(ESC, 0xdd);
      else esc.push(c);
    }
    esc.push(END);
    const n = Math.ceil(esc.length / 18);
    for (let i = 0; i < n; i++) {
      daMandare.push(Uint8Array.from([n, i, ...esc.slice(i * 18, (i + 1) * 18)]));
    }
  };

  const comprimi = (bytes: Uint8Array) => {
    // XOR prima (è il rovescio del disfacimento), poi RLE.
    const x = bytes.slice();
    for (let i = x.length - 1; i >= 32; i--) x[i] ^= x[i - 32];
    const bits: number[] = [];
    const spingi = (v: number) => {
      for (let i = 8; i >= 0; i--) bits.push((v >> i) & 1);
    };
    let i = 0;
    while (i < x.length) {
      if (x[i] === 0) {
        let run = 0;
        while (i < x.length && x[i] === 0 && run < 255) {
          run++;
          i++;
        }
        spingi(run);
      } else {
        spingi(0x100 | x[i]);
        i++;
      }
    }
    spingi(0);
    while (bits.length % 72 !== 0) spingi(0);
    const out = new Uint8Array(bits.length / 8);
    bits.forEach((b, k) => {
      if (b) out[k >> 3] |= 0x80 >> (k & 7);
    });
    return out;
  };

  const manifesto = () => {
    const p = new Uint8Array(0x600);
    logs.forEach((_, i) => {
      const o = i * 32;
      p[o] = 0xa5;
      p[o + 1] = 0xc4;
      p.set([0, 0, 0, i + 1], o + 4);
      p[o + 23] = (i + 1) * 0x40;
    });
    return p;
  };

  /** Il trasferimento in corso: cosa si sta mandando e a che blocco si è. */
  let corrente: Uint8Array | null = null;
  let compresso = false;

  const rispondi = (payload: number[]) => {
    const cmd = payload[0];

    if (cmd === 0x22) {
      const id = (payload[1] << 8) | payload[2];
      const dati =
        id === 0x8010
          ? // Il seriale è TESTO: otto caratteri ASCII col seriale scritto in
            // esadecimale, come risponde un Peregrine vero (verificato sul
            // diario di uno scarico reale). Il finto lo imita, perché un finto
            // che risponde con quattro byte binari avrebbe lasciato passare
            // l'errore di lettura che c'era.
            [...new TextEncoder().encode('988B023F')]
          : id === 0x8011
            ? [...new TextEncoder().encode('V93')]
            : id === 0x8060
              ? [9] // Peregrine
              : id === 0x8021
                ? [0, 0x80, 0x00, 0x00, 0x00] // formato nuovo
                : null;
      if (!dati) return incapsula([0x7f, 0x22, 0x31]);
      return incapsula([0x62, payload[1], payload[2], ...dati]);
    }

    if (cmd === 0x35) {
      compresso = (payload[1] & 0x10) !== 0;
      const addr = ((payload[3] << 24) >>> 0) + (payload[4] << 16) + (payload[5] << 8) + payload[6];
      if (addr === 0xe0000000) corrente = manifesto();
      else {
        const i = (addr - 0x80000000) / 0x40 - 1;
        corrente = comprimi(logs[i]);
      }
      return incapsula([0x75, 0x10, 0x00, 0x02]);
    }

    if (cmd === 0x36) {
      const block = payload[1];
      if (!corrente) return incapsula([0x7f, 0x36, 0x22]);
      // Blocchi da 60 byte: piccoli apposta, così ogni risposta attraversa più
      // notifiche e il riassemblaggio viene esercitato davvero.
      const start = (block - 1) * 60;
      const pezzo = corrente.subarray(start, start + 60);
      if (pezzo.length === 0 && !compresso) return incapsula([0x76, block]);
      return incapsula([0x76, block, ...pezzo]);
    }

    if (cmd === 0x37) {
      corrente = null;
      return incapsula([0x77, 0x00]);
    }

    return incapsula([0x7f, cmd, 0x11]);
  };

  return (frame: Uint8Array): Uint8Array[] | undefined => {
    for (let i = 2; i < frame.length; i++) {
      const c = frame[i];
      if (c === END) {
        if (inArrivo.length) {
          const p = inArrivo;
          inArrivo = [];
          // `FF 01 len 00 payload`
          rispondi(p.slice(4));
        }
        continue;
      }
      if (c === ESC) {
        escaped = true;
        continue;
      }
      if (escaped) {
        escaped = false;
        inArrivo.push(c === 0xdc ? END : c === 0xdd ? ESC : c);
        continue;
      }
      inArrivo.push(c);
    }
    /*
     * Le notifiche di risposta escono TUTTE INSIEME, già inquadrate.
     *
     * È come si comporta un collegamento vero: il firmware risponde a un
     * comando completo mandando la sua raffica di notifiche, non una a ogni
     * scrittura ricevuta. E vanno consegnate così come sono, senza farle
     * rispezzare dall'MTU: i due byte di intestazione contano le notifiche, e
     * ritagliarle a venti byte sposterebbe i confini rendendo i contatori falsi.
     *
     * Una scrittura intermedia — quelle che compongono un comando lungo — non
     * produce niente, ed è giusto: il finto restituisce un elenco vuoto e il
     * driver continua a scrivere.
     */
    if (!daMandare.length) return undefined;
    return daMandare.splice(0, daMandare.length);
  };
}

/**
 * Un log PNF minimo ma vero: apertura, un campione, chiusura, finale.
 *
 * Costruito con gli stessi offset che `decodePnf` legge, così il giro completo
 * arriva a un'immersione con una data e una profondità invece che a dei byte.
 */
function logSintetico(startTimeS: number, depthDm: number): Uint8Array {
  const R = 32;
  const rec: number[][] = [];
  const apertura = new Array(R).fill(0);
  apertura[0] = 0x10;
  apertura[4] = 40; // GF basso
  apertura[5] = 85; // GF alto
  apertura[8] = 0; // metrico
  apertura[12] = (startTimeS >>> 24) & 0xff;
  apertura[13] = (startTimeS >>> 16) & 0xff;
  apertura[14] = (startTimeS >>> 8) & 0xff;
  apertura[15] = startTimeS & 0xff;
  apertura[20] = 21; // prima miscela: aria
  rec.push(apertura);

  const campione = new Array(R).fill(0);
  campione[0] = 0x01;
  campione[1] = (depthDm >> 8) & 0xff;
  campione[2] = depthDm & 0xff;
  rec.push(campione);

  const chiusura = new Array(R).fill(0);
  chiusura[0] = 0x20;
  rec.push(chiusura);

  const finale = new Array(R).fill(0);
  finale[0] = 0xff;
  rec.push(finale);

  return Uint8Array.from(rec.flat());
}

describe('scarico completo dal finto Peregrine', () => {
  const trasporto = (logs: Uint8Array[]) =>
    new FakeTransport([
      {
        device: fakeDevice({ name: 'Peregrine' }),
        responder: fintoPeregrine(logs),
        quirks: { mtu: 20 },
      },
    ]);

  it('il log sintetico è davvero un log PNF leggibile', () => {
    // Se questo fallisce, tutto il resto del blocco proverebbe il protocollo
    // contro un carico che non è un log — cioè non proverebbe niente.
    const l = decodePnf(logSintetico(1_750_000_000, 234));
    expect(l.startTimeS).toBe(1_750_000_000);
  });

  it('si presenta, conta le immersioni e le scarica tutte', async () => {
    const t = trasporto([logSintetico(1_750_000_000, 200), logSintetico(1_750_100_000, 300)]);
    const eventi: string[] = [];
    const out = await downloadFromComputer(t, fakeDevice({ name: 'Peregrine' }), shearwaterDriver, {
      onEvent: (e) => eventi.push(e.kind),
    });
    expect(out.error).toBeUndefined();
    expect(out.model).toBe('Shearwater Peregrine');
    expect(out.serial).toBe('988B023F');
    expect(out.firmware).toBe('V93');
    expect(out.total).toBe(2);
    expect(out.dives).toHaveLength(2);
    expect(eventi.filter((e) => e === 'record')).toHaveLength(2);
  });

  it('le immersioni scaricate hanno data, profondità e provenienza giuste', async () => {
    const t = trasporto([logSintetico(1_750_000_000, 234)]);
    const out = await downloadFromComputer(t, fakeDevice({ name: 'Peregrine' }), shearwaterDriver);
    const d = out.dives[0];
    expect(d.startTime).toBe(new Date(1_750_000_000_000).toISOString());
    expect(d.maxDepth).toBeCloseTo(23.4, 1);
    expect(d.source.format).toBe('shearwater-ble');
    expect(d.computer?.gfLow).toBe(40);
    expect(d.computer?.gfHigh).toBe(85);
  });

  it('l’identificativo è quello degli import da file: si fonde, non si duplica', async () => {
    /*
     * È la proprietà che rende utile lo scarico su un archivio già pieno.
     * Se `diveIdFor` desse un identificativo diverso, scaricare dal computer
     * un'immersione già importata da Shearwater Cloud ne creerebbe una seconda,
     * e le note scritte a mano resterebbero sulla copia sbagliata.
     */
    const t = trasporto([logSintetico(1_750_000_000, 234)]);
    const a = await downloadFromComputer(t, fakeDevice({ name: 'Peregrine' }), shearwaterDriver);
    const t2 = trasporto([logSintetico(1_750_000_000, 234)]);
    const b = await downloadFromComputer(t2, fakeDevice({ name: 'Peregrine' }), shearwaterDriver);
    expect(a.dives[0].id).toBe(b.dives[0].id);
  });

  it('lo scarico completo restituisce il segnalibro della PIÙ RECENTE', async () => {
    /*
     * Il manifesto si legge dalla più nuova alla più vecchia, e l'unico punto
     * in cui il giro successivo può fermarsi è quello in cima: il segnalibro
     * deve quindi essere la prima immersione arrivata, non l'ultima. Con la
     * più vecchia, il prossimo scarico rileggerebbe tutto tranne una.
     */
    const t = trasporto([logSintetico(1_750_000_000, 200), logSintetico(1_750_100_000, 300)]);
    const out = await downloadFromComputer(t, fakeDevice({ name: 'Peregrine' }), shearwaterDriver);
    expect(out.status).toBe('complete');
    expect(out.newestKey).toBe('00000001');
  });

  it('uno scarico interrotto NON deve poter spostare il segnalibro', async () => {
    /*
     * È la proprietà che protegge dai dati persi per sempre. Con quaranta
     * immersioni su cento in mano, il segnalibro direbbe «ho tutto fino alla
     * più recente» e le sessanta in fondo non tornerebbero MAI più: il
     * protocollo non permette di ripartire da metà manifesto.
     *
     * Il segnalibro esiste comunque nel risultato — serve a chi lo vuole
     * mostrare — ma `status` dice `partial`, ed è quello il campo su cui
     * l'interfaccia decide se salvarlo.
     */
    const t = new FakeTransport([
      {
        device: fakeDevice({ name: 'Peregrine' }),
        responder: fintoPeregrine([logSintetico(1_750_000_000, 200), logSintetico(1_750_100_000, 300)]),
        // Cade dopo qualche comando: abbastanza per presentarsi e leggere il
        // manifesto, non abbastanza per finire.
        quirks: { mtu: 20, dropAfterCommands: 20 },
      },
    ]);
    const out = await downloadFromComputer(t, fakeDevice({ name: 'Peregrine' }), shearwaterDriver);
    expect(out.status).toBe('partial');
  });

  it('`since` ferma il manifesto e non riscarica niente', async () => {
    // Il secondo scarico deve durare secondi, non minuti: senza questo, ogni
    // volta si rilegge tutta la memoria del computer.
    const t = trasporto([logSintetico(1_750_000_000, 200), logSintetico(1_750_100_000, 300)]);
    const out = await downloadFromComputer(t, fakeDevice({ name: 'Peregrine' }), shearwaterDriver, {
      since: () => '00000001',
    });
    expect(out.total).toBe(0);
    expect(out.dives).toHaveLength(0);
  });

  it('un computer senza immersioni non è un errore', async () => {
    const out = await downloadFromComputer(
      trasporto([]),
      fakeDevice({ name: 'Peregrine' }),
      shearwaterDriver,
    );
    expect(out.error).toBeUndefined();
    expect(out.dives).toHaveLength(0);
  });

  it('gli avvisi ripetuti si riassumono in una riga sola', async () => {
    /*
     * Su trentanove immersioni vere il log produceva ottanta righe identiche
     * — «eventi non documentati: codici 11» — che seppellivano i tre avvisi
     * che contavano, fra cui lo sfasamento dell'orologio riconosciuto durante
     * la fusione. Il dato utile è QUALI codici si sono visti, non quante volte.
     */
    const conEventi = (t: number) => {
      const l = logSintetico(t, 200);
      // Un evento di tipo sconosciuto in coda al log, prima del record finale.
      const evento = new Uint8Array(32);
      evento[0] = 0x02;
      evento[1] = 11;
      const out = new Uint8Array(l.length + 32);
      out.set(l.subarray(0, 64));
      out.set(evento, 64);
      out.set(l.subarray(64), 96);
      return out;
    };
    const t = trasporto([conEventi(1_750_000_000), conEventi(1_750_100_000)]);
    const out = await downloadFromComputer(t, fakeDevice({ name: 'Peregrine' }), shearwaterDriver);
    const ripetuti = out.warnings.filter((w) => /non sappiamo interpretare|non documentati/i.test(w));
    expect(ripetuti.length).toBeLessThanOrEqual(1);
  });

  it('riconosce i modelli della famiglia e non le cuffie', () => {
    for (const n of ['Peregrine', 'Perdix AI', 'Petrel 2', 'Teric', 'TERN'])
      expect(shearwaterDriver.matches(fakeDevice({ name: n }))).toBe(true);
    for (const n of ['', 'AirPods di Matteo', 'Cuffie Perdix Pro', 'G2'])
      expect(shearwaterDriver.matches(fakeDevice({ name: n }))).toBe(false);
  });
});
