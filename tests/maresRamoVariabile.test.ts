/**
 * I Mares che leggono il pacchetto intero in una volta sola, contati dalla
 * libreria e non a memoria.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE QUESTA PROVA PROTEGGE, E CHE È COSTATO UN COMPUTER VERO. ◄
 *
 * Il 7 settembre 2026 un Mares Quad Ci prestato da un centro sub ha scaricato
 * per un pezzo e poi si è fermato con «errore di protocollo», ritentando
 * quattro volte, con una risposta che arrivava a ogni tentativo.
 *
 * La causa è una riga di `mares_iconhd.c`: per i modelli dentro la macro
 * `ISSIRIUS` — e **solo** per quelli — libdivecomputer NON apre
 * `dc_packet_open`, cioè il livello che rimette insieme i pezzi di un
 * messaggio BLE. Legge con una `dc_iostream_read` e si aspetta il pacchetto
 * intero, dal `AA` iniziale al `EA` finale. Il nostro trasporto consegna una
 * notifica per lettura — perché per gli Uwatec è un obbligo, vedi
 * `Riassemblaggio` — quindi se l'MTU non fa stare il pacchetto in una
 * notifica sola, quel pacchetto è rifiutato.
 *
 * Il ponte Rust tiene un elenco di cinque nomi. Un elenco scritto a mano
 * contro una macro C è **esattamente** la specie di trascrizione che questo
 * progetto ha già pagato più volte: nessun compilatore la controlla, e
 * sbagliarla non dà un errore — dà un computer che non scarica, in mano a
 * qualcun altro.
 *
 * Quindi qui l'elenco si RICOSTRUISCE: si legge `ISSIRIUS` dal sorgente della
 * libreria, si risolvono i numeri di modello dai `#define`, si cercano quei
 * numeri fra i descrittori, e si confrontano i nomi con quelli del Rust.
 *
 * SI LEGGE DAL TARBALL versionato, non dalla copia scompattata dalla build:
 * quella è un artefatto e su un'altra macchina può non esserci. È la stessa
 * regola di `costantiLibdivecomputer.test.ts`.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const VERSIONE = '0.9.0';
const TARBALL = `src-tauri/vendor/libdivecomputer-${VERSIONE}.tar.gz`;

let iconhd = '';
let descrittori = '';
let rust = '';

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'ldc-mares-'));
  execSync(`tar xzf ${TARBALL} -C ${tmp}`);
  const dentro = join(tmp, `libdivecomputer-${VERSIONE}`, 'src');
  iconhd = readFileSync(join(dentro, 'mares_iconhd.c'), 'utf8');
  descrittori = readFileSync(join(dentro, 'descriptor.c'), 'utf8');
  rust = readFileSync('src-tauri/src/ponte_blec.rs', 'utf8');
});

/** I nomi dei modelli dentro `ISSIRIUS`, nell'ordine in cui sono scritti. */
function modelliDiIssirius(): string[] {
  const m = iconhd.match(/#define ISSIRIUS\(model\)([\s\S]*?)\n\n/);
  expect(m, 'la macro ISSIRIUS non c’è più in mares_iconhd.c').not.toBeNull();
  return [...m![1].matchAll(/\(model\)\s*==\s*(\w+)/g)].map((x) => x[1]);
}

/** Il valore di un `#define NOME 0xNN` in `mares_iconhd.c`. */
function numeroDiModello(nome: string): number {
  const m = iconhd.match(new RegExp(`#define ${nome}\\s+(0x[0-9A-Fa-f]+)`));
  expect(m, `il modello ${nome} non ha più un numero`).not.toBeNull();
  return Number(m![1]);
}

/** I prodotti Mares con quel numero di modello, dai descrittori. */
function prodottiConNumero(numero: number): string[] {
  const righe = [...descrittori.matchAll(/\{"Mares",\s*"([^"]+)",\s*DC_FAMILY_MARES_ICONHD\s*,\s*(0x[0-9A-Fa-f]+)/g)];
  return righe.filter((r) => Number(r[2]) === numero).map((r) => r[1]);
}

/** L'elenco che il ponte Rust tiene scritto a mano. */
function elencoDelRust(): string[] {
  const m = rust.match(/const MARES_PACCHETTO_INTERO: \[&str; \d+\] =\s*\[([^\]]*)\]/);
  expect(m, 'l’elenco MARES_PACCHETTO_INTERO non c’è più nel ponte').not.toBeNull();
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe('l’elenco dei Mares a pacchetto intero', () => {
  it('è esattamente quello che libdivecomputer chiama ISSIRIUS', () => {
    const numeri = modelliDiIssirius().map(numeroDiModello);
    expect(numeri.length, 'ISSIRIUS deve avere dei modelli dentro').toBeGreaterThan(0);
    const attesi = numeri.flatMap(prodottiConNumero);
    // Ordinati per confrontarli: l'ordine dentro l'elenco non conta, il
    // contenuto sì.
    expect([...elencoDelRust()].sort()).toEqual([...attesi].sort());
  });

  it('e il Quad Ci ci sta dentro, che è quello da cui è cominciato tutto', () => {
    expect(elencoDelRust()).toContain('Quad Ci');
    expect(modelliDiIssirius()).toContain('QUADCI');
  });

  /*
   * ► LA RAGIONE PER CUI L'ELENCO ESISTE, RILETTA DAL SORGENTE. ◄
   *
   * Se un domani libdivecomputer aprisse `dc_packet_open` anche per questi
   * modelli, il riassemblaggio nostro diventerebbe inutile — e peggio,
   * lavorerebbe sotto a un livello che fa la stessa cosa. Questa riga si
   * accende in quel giorno, ed è il momento in cui qualcuno deve guardare.
   */
  it('per questi modelli la libreria non apre il livello che rimette insieme i pacchetti', () => {
    expect(iconhd).toContain('device->ble = ISSIRIUS(model) ? VARIABLE : FIXED;');
    const apertura = iconhd.match(
      /if \(transport == DC_TRANSPORT_BLE && device->ble == FIXED\) \{\s*status = dc_packet_open/,
    );
    expect(apertura, 'dc_packet_open deve restare riservato ai modelli FIXED').not.toBeNull();
  });

  /*
   * E la lettura unica: è il punto esatto in cui un pacchetto spezzato viene
   * rifiutato. Se questa forma cambiasse, la nostra correzione andrebbe
   * ripensata invece che mantenuta.
   */
  it('il ramo a lunghezza variabile legge il pacchetto con una lettura sola', () => {
    const ramo = iconhd.slice(
      iconhd.indexOf('mares_iconhd_packet_variable (mares_iconhd_device_t *device,'),
      iconhd.indexOf('mares_iconhd_packet (mares_iconhd_device_t *device,'),
    );
    expect(ramo).toContain('dc_iostream_read (device->iostream, packet, sizeof (packet), &length)');
    expect(ramo).toContain('Unexpected packet trailer byte');
    // E quattro ritentativi, che sono i quattro visti sul computer vero.
    expect(iconhd).toContain('#define MAXRETRIES 4');
  });
});
