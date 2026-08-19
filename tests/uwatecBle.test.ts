/**
 * Il protocollo Uwatec Smart via Bluetooth, provato contro un finto Aladin.
 *
 * Come per Shearwater, il finto non è un mock: è il protocollo scritto
 * dall'altra parte, guardando `uwatec_smart.c` e non il nostro TypeScript.
 * Riceve i pacchetti `[lunghezza+1, comando, ...dati]`, risponde a notifiche
 * di venti byte mettendo in testa a ognuna il byte di sequenza che il firmware
 * vero ci mette, e filtra la memoria sull'impronta come fa il computer.
 *
 * I DUE ERRORI CHE QUESTO TEST ESISTE PER PRENDERE.
 *
 * Il primo è il byte di sequenza. Tenerlo dentro non dà nessun errore: dà un
 * blocco disallineato di un byte ogni diciannove, in cui i marcatori
 * `A5 A5 5A 5A` non si trovano più. Il sintomo sarebbe «trasferimento riuscito,
 * zero immersioni» — cioè la cosa più difficile da interpretare che ci sia.
 *
 * Il secondo è l'ordine. Il primo record dell'elenco diventa il SEGNALIBRO: se
 * non è davvero il più recente, tutto quello che sta dopo di lui non verrà
 * scaricato mai più, in silenzio. Qui la memoria del finto è deliberatamente
 * disordinata, perché ordinare per posizione invece che per orario è la scelta
 * comoda che libdivecomputer fa e che su una memoria circolare sbaglia.
 *
 * COSA QUESTO TEST NON PROVA: che abbia capito bene libdivecomputer. Il finto
 * l'ho scritto io leggendo lo stesso C, quindi condivide i miei eventuali
 * fraintendimenti. Per quello serve l'Aladin vero, e il diario tecnico.
 */

import { describe, expect, it } from 'vitest';
import { downloadFromComputer } from '../src/core/ble/download';
import { FakeTransport, fakeDevice, type FakeResponder } from '../src/core/ble/fake';
import { exactName } from '../src/core/ble/registry';
import type { DownloadEvent } from '../src/core/ble/types';
import {
  chiaveUwatec,
  identitaDaChiave,
  orarioDaChiave,
  pacchettoUwatec,
  parametriUwatec,
  tagliaRecord,
  uwatecDriver,
} from '../src/core/ble/drivers/uwatec';
import { encodeUwatecSmart } from './fixtures';

// --------------------------------------------------------------- il finto Aladin

const MODELLO = 0x17; // Aladin Sport Matrix
const HARDWARE = 0x05;
const SOFTWARE = 0x21; // BCD: firmware 21
const SERIALE = 123_456_789;

/** Modello e seriale come il driver li mette nelle chiavi. */
const IDENT = { modello: MODELLO, seriale: SERIALE };

/** Millisecondi fra l'epoca Uwatec (2000-01-01 UTC) e quella Unix. */
const EPOCA = 946_684_800_000;

/** L'orario di un record com'è scritto dentro di lui: mezzi secondi dal 2000. */
const orarioDi = (record: Uint8Array) =>
  new DataView(record.buffer, record.byteOffset, record.byteLength).getUint32(8, true);

const le32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
};

/**
 * I byte di sequenza che il firmware mette in testa a ogni notifica.
 *
 * Il commento in `uwatec_smart_usbhid_receive` li elenca: crescono di 19 e
 * ricominciano. Non sono dati e non vanno interpretati — il finto li mette
 * proprio perché il driver deve buttarli via senza guardarli.
 */
const SEQUENZA = [0xf7, 0x14, 0x27, 0x3a, 0x4d, 0x60, 0x73, 0x86, 0x99, 0xac, 0xbf, 0xd2, 0xe5];

/** Spezza una risposta in notifiche da venti byte: uno di sequenza, diciannove di dati. */
function notifiche(dati: Uint8Array | number[], da = 0): Uint8Array[] {
  const b = dati instanceof Uint8Array ? dati : Uint8Array.from(dati);
  const out: Uint8Array[] = [];
  for (let at = 0, n = 0; at < b.length || at === 0; at += 19, n++) {
    const pezzo = b.subarray(at, at + 19);
    out.push(Uint8Array.from([SEQUENZA[(da + n) % SEQUENZA.length], ...pezzo]));
    if (at + 19 >= b.length) break;
  }
  return out;
}

interface Quirk {
  /** Manda la dichiarazione di `CMD_DATA` incollata ai primi byte del blocco. */
  incollata?: boolean;
  /** Dichiara un totale sbagliato: il driver deve accorgersene. */
  totaleFasullo?: number;
  /** Manda solo i primi N byte del blocco e poi tace: la disconnessione a metà. */
  troncaDopo?: number;
  /** L'orologio del computer, in millisecondi. Per difetto quello di sistema. */
  orologioMs?: number;
}

/** Quello che il finto ha ricevuto, per poterci asserire sopra. */
interface Traccia {
  comandi: number[];
  improntaChiesta?: number;
}

function fintoAladin(memoria: Uint8Array[], traccia: Traccia, quirk: Quirk = {}): FakeResponder {
  /** Il filtro che fa il COMPUTER: solo quello che è più recente dell'impronta. */
  const filtra = (impronta: number) => {
    const scelti = memoria.filter((r) => orarioDi(r) > impronta);
    const totale = scelti.reduce((n, r) => n + r.length, 0);
    const out = new Uint8Array(totale);
    let at = 0;
    for (const r of scelti) {
      out.set(r, at);
      at += r.length;
    }
    return out;
  };

  return (comando) => {
    // Il pacchetto è `[lunghezza+1, comando, ...dati]`, e la lunghezza conta il
    // comando: un firmware vero scarta quello che non torna.
    const dichiarata = comando[0];
    const codice = comando[1];
    const dati = comando.subarray(2);
    if (dichiarata !== dati.length + 1) {
      throw new Error(`lunghezza dichiarata ${dichiarata} ma il pacchetto ne porta ${dati.length + 1}`);
    }
    traccia.comandi.push(codice);

    switch (codice) {
      case 0x10:
        return notifiche([MODELLO]);
      case 0x11:
        return notifiche([HARDWARE]);
      case 0x13:
        return notifiche([SOFTWARE]);
      case 0x14:
        return notifiche(le32(SERIALE));
      case 0x1a: {
        const ms = quirk.orologioMs ?? Date.now();
        return notifiche(le32(Math.round(((ms - EPOCA) / 1000) * 2)));
      }
      case 0xc6: {
        const impronta = new DataView(dati.buffer, dati.byteOffset, dati.byteLength).getUint32(0, true);
        traccia.improntaChiesta = impronta;
        return notifiche(le32(filtra(impronta).length));
      }
      case 0xc4: {
        const impronta = new DataView(dati.buffer, dati.byteOffset, dati.byteLength).getUint32(0, true);
        const blocco = filtra(impronta);
        const testa = le32(quirk.totaleFasullo ?? blocco.length + 4);
        const corpo = quirk.troncaDopo === undefined ? blocco : blocco.subarray(0, quirk.troncaDopo);
        if (quirk.incollata) {
          // Il caso cattivo: dichiarazione e dati nella stessa notifica.
          const tutto = new Uint8Array(testa.length + corpo.length);
          tutto.set(testa);
          tutto.set(corpo, 4);
          return notifiche(tutto);
        }
        return [...notifiche(testa), ...notifiche(corpo, 1)];
      }
      default:
        return undefined;
    }
  };
}

// ------------------------------------------------------------------ la memoria

const PROFILO = [0, 6, 14, 22, 28, 30, 29, 28, 26, 18, 10, 6, 5, 5, 3, 1, 0];
const TEMPERATURE = PROFILO.map((d) => 24 - d * 0.2);

function immersione(quando: string) {
  return encodeUwatecSmart({
    startTime: new Date(quando),
    utcOffsetMinutes: 120,
    depths: PROFILO,
    temps: TEMPERATURE,
    o2: 0.21,
    startBar: 220,
    endBar: 70,
  });
}

const VECCHIA = immersione('2026-05-02T09:15:00Z');
const MEDIA = immersione('2026-06-14T10:30:00Z');
const NUOVA = immersione('2026-07-11T08:00:00Z');

/**
 * La memoria è DISORDINATA di proposito.
 *
 * Su un computer con memoria circolare che ha già girato, l'ordine degli
 * indirizzi non è quello cronologico. Un driver che si fida della posizione
 * sceglie il segnalibro sbagliato, e quello che sta dopo non torna più.
 */
const MEMORIA = [MEDIA, NUOVA, VECCHIA];

const dispositivo = fakeDevice({ id: 'aladin-1', name: 'Aladin' });

function trasporto(memoria = MEMORIA, quirk: Quirk = {}) {
  const traccia: Traccia = { comandi: [] };
  const t = new FakeTransport([
    { device: dispositivo, responder: fintoAladin(memoria, traccia, quirk), quirks: { mtu: 20 } },
  ]);
  return { t, traccia };
}

// ------------------------------------------------------------------- i pezzi

describe('inquadramento Uwatec', () => {
  it('la lunghezza conta il comando e non se stessa', () => {
    expect([...pacchettoUwatec(0x10)]).toEqual([1, 0x10]);
    expect([...pacchettoUwatec(0xc6, Uint8Array.from([1, 2, 3]))]).toEqual([4, 0xc6, 1, 2, 3]);
  });

  it('i parametri portano l’impronta little endian e i quattro byte fissi', () => {
    expect([...parametriUwatec(0)]).toEqual([0, 0, 0, 0, 0x10, 0x27, 0, 0]);
    expect([...parametriUwatec(0x11223344)]).toEqual([0x44, 0x33, 0x22, 0x11, 0x10, 0x27, 0, 0]);
  });
});

describe('la chiave di un’immersione', () => {
  it('porta con sé il modello, perché `decode` non lo saprebbe da nessun’altra parte', () => {
    expect(chiaveUwatec({ modello: 0x17, seriale: 42 }, 0xdeadbeef)).toBe('17:42:deadbeef');
    expect(orarioDaChiave('17:42:deadbeef')).toBe(0xdeadbeef);
    expect(identitaDaChiave('17:42:deadbeef')).toEqual({ modello: 0x17, seriale: '42' });
  });

  it('un segnalibro che non è nostro non diventa un’impronta a caso', () => {
    // Rileggere tutta la memoria è lento; ripartire da un numero inventato
    // salterebbe immersioni per sempre. Fra i due, si rilegge.
    expect(orarioDaChiave('qualcosa-di-altro')).toBeUndefined();
    expect(orarioDaChiave(undefined)).toBeUndefined();
    expect(orarioDaChiave('')).toBeUndefined();
    // I formati più vecchi restano leggibili come segnalibro: l'orario è
    // sempre l'ultimo campo, e un segnalibro che smette di funzionare a un
    // aggiornamento significa una rilettura completa a sorpresa.
    expect(orarioDaChiave('deadbeef')).toBe(0xdeadbeef);
    expect(orarioDaChiave('17:deadbeef')).toBe(0xdeadbeef);
  });
});

describe('riconoscimento per nome esatto', () => {
  const riconosce = exactName('G2', 'Aladin', 'A1', 'A2');

  it('accetta il nome preciso, senza guardare le maiuscole', () => {
    expect(riconosce(fakeDevice({ name: 'Aladin' }))).toBe(true);
    expect(riconosce(fakeDevice({ name: ' aladin ' }))).toBe(true);
    expect(riconosce(fakeDevice({ name: 'A1' }))).toBe(true);
  });

  it('NON accetta chi comincia uguale', () => {
    /*
     * È il motivo per cui esiste `exactName`. «A1» come prefisso riconoscerebbe
     * un paio di auricolari, e riconoscerlo significa connettersi e mandargli i
     * byte di un comando Uwatec.
     */
    expect(riconosce(fakeDevice({ name: 'A1 Pro' }))).toBe(false);
    expect(riconosce(fakeDevice({ name: 'Aladin Sport Matrix' }))).toBe(false);
    expect(riconosce(fakeDevice({ name: 'G2 Buds' }))).toBe(false);
    expect(riconosce(fakeDevice({ name: '' }))).toBe(false);
  });

  it('il driver riconosce l’Aladin come si annuncia davvero', () => {
    expect(uwatecDriver.matches(fakeDevice({ name: 'Aladin' }))).toBe(true);
    expect(uwatecDriver.matches(fakeDevice({ name: 'Peregrine' }))).toBe(false);
  });
});

describe('taglio del blocco', () => {
  it('restituisce le immersioni dalla più recente, qualunque sia l’ordine in memoria', () => {
    const blocco = new Uint8Array(MEMORIA.reduce((n, r) => n + r.length, 0));
    let at = 0;
    for (const r of MEMORIA) {
      blocco.set(r, at);
      at += r.length;
    }
    const record = tagliaRecord(blocco, IDENT);
    expect(record.map((r) => r.key)).toEqual([
      chiaveUwatec(IDENT, orarioDi(NUOVA)),
      chiaveUwatec(IDENT, orarioDi(MEDIA)),
      chiaveUwatec(IDENT, orarioDi(VECCHIA)),
    ]);
  });

  it('un blocco vuoto non è un errore: è una memoria vuota', () => {
    expect(tagliaRecord(new Uint8Array(0), IDENT)).toEqual([]);
  });
});

// ------------------------------------------------------------------- lo scarico

describe('scarico completo', () => {
  it('legge modello, seriale e firmware, e porta a casa tutte le immersioni', async () => {
    const { t, traccia } = trasporto();
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);

    expect(esito.status).toBe('complete');
    expect(esito.error).toBeUndefined();
    expect(esito.model).toBe('Scubapro Aladin Sport Matrix');
    expect(esito.serial).toBe(String(SERIALE));
    expect(esito.firmware).toContain('21');

    // Nessuna stretta di mano: i comandi 0x1B e 0x1C non devono partire.
    expect(traccia.comandi).not.toContain(0x1b);
    expect(traccia.comandi).not.toContain(0x1c);
    // Senza segnalibro si chiede tutto, cioè impronta zero.
    expect(traccia.improntaChiesta).toBe(0);

    expect(esito.dives).toHaveLength(3);
    expect(esito.total).toBe(3);
    // La più recente per prima: è quella che diventerà il segnalibro.
    expect(esito.newestKey).toBe(chiaveUwatec(IDENT, orarioDi(NUOVA)));

    const date = esito.dives.map((d) => d.startTime.slice(0, 10)).sort();
    expect(date).toEqual(['2026-05-02', '2026-06-14', '2026-07-11']);
    for (const d of esito.dives) {
      expect(d.source.format).toBe('uwatec-ble');
      expect(d.computer?.model).toBe('Scubapro Aladin Sport Matrix');
      // Il profilo c'è davvero, e la profondità non è lo zero del record troncato.
      expect(d.maxDepth).toBeGreaterThan(29);
      expect(d.samples?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('funziona anche se il computer incolla la dichiarazione ai dati', async () => {
    /*
     * `CMD_DATA` dichiara `lunghezza + 4`, contando cioè i byte con cui lo
     * dice: un firmware che li conta insieme può mandarli insieme, nella stessa
     * notifica dei primi quindici byte di dati. libdivecomputer li perderebbe;
     * il riassemblatore li tiene da parte.
     */
    const { t } = trasporto(MEMORIA, { incollata: true });
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);
    expect(esito.status).toBe('complete');
    expect(esito.dives).toHaveLength(3);
  });

  it('dice quanti byte sono arrivati, mentre arrivano', async () => {
    const eventi: DownloadEvent[] = [];
    const { t } = trasporto();
    await downloadFromComputer(t, dispositivo, uwatecDriver, { onEvent: (e) => eventi.push(e) });
    const avanzamenti = eventi.filter((e) => e.kind === 'progress');
    expect(avanzamenti.length).toBeGreaterThan(0);
    const ultimo = avanzamenti[avanzamenti.length - 1];
    expect(ultimo.done).toBe(ultimo.total);
  });

  it('la spazzatura di una sessione precedente non fa fallire il primo comando', async () => {
    const traccia: Traccia = { comandi: [] };
    const t = new FakeTransport([
      {
        device: dispositivo,
        responder: fintoAladin(MEMORIA, traccia),
        quirks: { mtu: 20, garbageOnOpen: Uint8Array.from([9, 9, 9, 9, 9]) },
      },
    ]);
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);
    expect(esito.status).toBe('complete');
    expect(esito.dives).toHaveLength(3);
  });
});

describe('scarico incrementale', () => {
  it('manda l’impronta al computer, e riceve solo quello che è venuto dopo', async () => {
    const { t, traccia } = trasporto();
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver, {
      since: () => chiaveUwatec(IDENT, orarioDi(MEDIA)),
    });

    // Il filtro l'ha fatto il COMPUTER: qui non si è scartato niente a mano.
    expect(traccia.improntaChiesta).toBe(orarioDi(MEDIA));
    expect(esito.dives).toHaveLength(1);
    expect(esito.dives[0].startTime.slice(0, 10)).toBe('2026-07-11');
  });

  it('con niente di nuovo si chiude subito, e non è un errore', async () => {
    const eventi: DownloadEvent[] = [];
    const { t } = trasporto();
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver, {
      onEvent: (e) => eventi.push(e),
      since: () => chiaveUwatec(IDENT, orarioDi(NUOVA)),
    });
    expect(esito.status).toBe('complete');
    expect(esito.dives).toEqual([]);
    expect(esito.total).toBe(0);
    // Il segnalibro non si sposta su un vuoto.
    expect(esito.newestKey).toBeUndefined();
    // E soprattutto: non si è nemmeno cominciato a trasferire.
    expect(eventi.some((e) => e.kind === 'progress')).toBe(false);
  });

  it('un segnalibro illeggibile fa rileggere tutto, non ripartire da un numero a caso', async () => {
    const { t, traccia } = trasporto();
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver, {
      since: () => 'segnalibro-di-un’altra-epoca',
    });
    expect(traccia.improntaChiesta).toBe(0);
    expect(esito.dives).toHaveLength(3);
  });
});

describe('i difetti trovati provandolo contro sé stesso', () => {
  it('un pezzo di memoria troppo corto non fa saltare le immersioni buone', async () => {
    /*
     * La memoria di questi computer è circolare: può contenere un record
     * troncato, o una firma `A5 A5 5A 5A` capitata per caso dentro dei
     * campioni. Leggere l'orario a offset 8 su un pezzo da nove byte solleva
     * un RangeError — e siccome il taglio avviene PRIMA di consegnare
     * qualunque immersione, quell'eccezione butterebbe via tutto lo scarico:
     * minuti di trasferimento riusciti, zero immersioni, e a schermo un
     * messaggio sui limiti di una DataView.
     */
    // Firma buona, lunghezza dichiarata di nove byte: il taglio produce un
    // pezzo troppo corto perché ci si possa leggere l'orario a offset 8.
    const spurio = new Uint8Array(12);
    spurio.set([0xa5, 0xa5, 0x5a, 0x5a, 9, 0, 0, 0]);
    new DataView(spurio.buffer).setUint32(8, 700_000_000, true);
    const { t } = trasporto([MEDIA, spurio, NUOVA, VECCHIA]);
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);
    expect(esito.status).toBe('complete');
    expect(esito.dives).toHaveLength(3);
  });

  it('il segnalibro non scavalca l’immersione che non si è saputa leggere', async () => {
    /*
     * È il difetto che perde dati IN SILENZIO, ed è il peggiore di tutti: se la
     * più recente non si decodifica, spostare il segnalibro sul suo orario
     * significa che il computer non la offrirà mai più — al giro dopo risponde
     * «niente di nuovo» e l'immersione non esiste più da nessuna parte.
     */
    const rotta = NUOVA.slice();
    // Si sporca il corpo del record lasciando intatti firma, lunghezza e orario:
    // arriva, si taglia, e non si decodifica.
    rotta.fill(0xff, 84, rotta.length);
    const { t } = trasporto([MEDIA, rotta, VECCHIA]);
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);

    expect(esito.dives.length).toBeLessThan(3);
    expect(esito.newestKey).toBeUndefined();
    expect(esito.warnings.join(' ')).toMatch(/non viene spostato/);
  });

  it('un record senza profondità né durata non entra in archivio a zero metri', () => {
    /*
     * `?? 0` non intercetta lo zero, e una riga a zero metri e zero secondi non
     * si fonde con niente — `likelySame` rifiuta le durate nulle — quindi
     * resterebbe in archivio per sempre a sporcare le statistiche. Il lettore
     * di LogTRAK scarta lo stesso record: devono concordare.
     */
    const vuoto = new Uint8Array(84);
    vuoto.set([0xa5, 0xa5, 0x5a, 0x5a, 84, 0, 0, 0]);
    new DataView(vuoto.buffer).setUint32(8, 800_000_000, true);
    const { dives, warnings } = uwatecDriver.decode([
      { key: chiaveUwatec(IDENT, 800_000_000), bytes: vuoto },
    ]);
    expect(dives).toEqual([]);
    expect(warnings.join(' ')).toMatch(/non decodificabile/);
  });

  it('le immersioni scaricate portano il seriale del computer', async () => {
    /*
     * `decode` riceve solo i record, quindi il seriale — letto con CMD_SERIAL —
     * ci arriva dentro la chiave. Senza, l'immersione entrerebbe in archivio
     * senza sapere da che computer viene, e `mergeDive` tratta il blocco
     * `computer` come un tutto unico: importando poi lo stesso periodo da
     * LogTRAK, il seriale non tornerebbe più.
     */
    const { t } = trasporto();
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);
    for (const d of esito.dives) {
      expect(d.computer?.serial).toBe(String(SERIALE));
      expect(d.computer?.deviceId).toBe(String(SERIALE));
    }
  });

  it('un dispositivo che manda notifiche senza dati dà un errore, non un blocco', async () => {
    /*
     * `readFrame` su una notifica già in coda si risolve subito, senza toccare
     * la coda dei macrotask: un dispositivo che consegna solo byte di sequenza
     * fa girare il ciclo di lettura su microtask all'infinito, e in quello
     * stato NON scatta né la scadenza né l'annullamento. Dentro la webview di
     * Tauri quello è il thread dell'interfaccia: l'app si pianta e resta solo
     * da ucciderla.
     */
    const traccia: Traccia = { comandi: [] };
    const vero = fintoAladin(MEMORIA, traccia);
    const t = new FakeTransport([
      {
        device: dispositivo,
        // Al comando dei dati risponde per sempre con notifiche di un byte solo.
        responder: (c, i) =>
          c[1] === 0xc4 ? Array.from({ length: 500 }, () => Uint8Array.of(0xf7)) : vero(c, i),
        quirks: { mtu: 20 },
      },
    ]);
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);
    expect(esito.status).toBe('partial');
    expect(esito.error).toMatch(/notifiche senza dati|non ha risposto/);
  }, 20_000);
});

describe('quando va storto', () => {
  it('il trasferimento interrotto a metà non butta via quello che era già arrivato', async () => {
    /*
     * Sono i minuti in cui il computer è a due metri dal telefono e il
     * collegamento si affloscia. Il blocco arrivato contiene comunque le
     * immersioni INTERE che stanno prima del taglio, e quelle valgono: sono
     * minuti di trasferimento, e buttarle costringerebbe a rifarli tutti.
     *
     * Il finto manda le prime due immersioni e poi tace, che è come si
     * presenta davvero — non con un errore, con il silenzio. La scadenza
     * scatta dopo cinque secondi, ed è il motivo per cui questo test è lento.
     */
    const quante = MEDIA.length + NUOVA.length;
    const { t } = trasporto(MEMORIA, { troncaDopo: quante });
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);

    expect(esito.status).toBe('partial');
    expect(esito.error).toMatch(/non ha risposto/);
    expect(esito.dives).toHaveLength(2);
    expect(esito.dives.map((d) => d.startTime.slice(0, 10)).sort()).toEqual(['2026-06-14', '2026-07-11']);
  }, 20_000);

  it('se il computer annuncia un totale che non torna, ci si ferma', async () => {
    const { t } = trasporto(MEMORIA, { totaleFasullo: 7 });
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);
    expect(esito.status).toBe('partial');
    expect(esito.error).toMatch(/manderà 7 byte/);
    expect(esito.dives).toEqual([]);
  });

  it('un computer che tace produce una scadenza leggibile, non un blocco', async () => {
    const t = new FakeTransport([{ device: dispositivo, responder: () => undefined, quirks: { mtu: 20 } }]);
    const esito = await downloadFromComputer(t, dispositivo, uwatecDriver);
    expect(esito.status).toBe('partial');
    expect(esito.error).toMatch(/non ha risposto/);
  }, 20_000);
});
