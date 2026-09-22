/**
 * L'ELENCO DEI PELAGIC IN RUST DEVE ESSERE QUELLO DEL CATALOGO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Il 16 settembre 2026, da un Aqualung i330R: quaranta immersioni arrivate, poi
 *
 *     libdivecomputer, errore: Invalid packet length (96). [pelagic_i330r.c:214]
 *
 * Il pacchetto dichiarava 96 byte di carico — 101 in tutto — e la radio l'aveva
 * spezzato in due. La politica in uso consegnava una notifica per lettura, e
 * libdivecomputer ne ha visti 96.
 *
 * La cura è `Riassemblaggio::LunghezzaDichiarata`, che di quella famiglia legge
 * la lunghezza dal pacchetto invece di indovinarla. E la cura si applica a un
 * **elenco di nomi** in `ponte_blec.rs`, che è la parte che invecchia: il
 * catalogo è generato dai descrittori di libdivecomputer e cresce da sé, quella
 * costante no.
 *
 * *Un elenco scritto a mano accanto a uno generato diverge in silenzio.* Questa
 * prova li accosta.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODELLI_BLE } from '../src/core/ble/catalogoGenerato';

/** I nomi dentro `PELAGIC_LUNGHEZZA_DICHIARATA`, letti dal sorgente Rust. */
function elencoInRust(): string[] {
  const rust = readFileSync('src-tauri/src/ponte_blec.rs', 'utf8');
  const m = /const PELAGIC_LUNGHEZZA_DICHIARATA: \[&str; \d+\] =\s*\[([^\]]*)\]/.exec(rust);
  expect(m, 'la costante non si trova più: è stata rinominata?').not.toBeNull();
  return [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

describe('la famiglia Pelagic, in Rust e nel catalogo', () => {
  it('i modelli sono gli stessi, e sono tre', () => {
    const dalCatalogo = MODELLI_BLE.filter((c) => c.famiglia === 'pelagic_i330r').map((c) => c.modello);
    expect(dalCatalogo.length, 'il catalogo ne ha un numero diverso da prima').toBeGreaterThan(0);
    expect([...elencoInRust()].sort()).toEqual([...dalCatalogo].sort());
  });

  it('e le marche sono quelle che la funzione guarda', () => {
    /*
     * `famiglia_pelagic` controlla la marca oltre al modello — «Cressi DSX»
     * non è un Pelagic. Se un domani la famiglia arrivasse a una terza marca,
     * l'elenco dei nomi resterebbe giusto e la funzione smetterebbe di
     * riconoscerla: è il difetto che questa riga prende.
     *
     * ► DAL 22 SETTEMBRE 2026 LE DOMANDE SONO DUE, E LA RISPOSTA UNA. ◄ Come
     * rimettere insieme le notifiche (`riassemblaggio_per`) e se ascoltare il
     * silenzio prima del primo comando (`ascolta_prima_di_parlare`): tutte e
     * due chiedono «è un Pelagic?» a `famiglia_pelagic`. Se una delle due
     * tornasse a scriversi la domanda da sé, le marche invecchierebbero in un
     * posto solo — quindi si pretende anche che la chiamino.
     */
    const marche = new Set(MODELLI_BLE.filter((c) => c.famiglia === 'pelagic_i330r').map((c) => c.marca));
    const rust = readFileSync('src-tauri/src/ponte_blec.rs', 'utf8');
    const funzione = rust.slice(rust.indexOf('fn famiglia_pelagic'));
    for (const marca of marche) {
      expect(
        funzione.slice(0, 400),
        `«${marca}» ha un Pelagic in catalogo ma la funzione non la nomina`,
      ).toContain(`eq_ignore_ascii_case("${marca}")`);
    }
    for (const chi of ['pub fn riassemblaggio_per', 'pub fn ascolta_prima_di_parlare']) {
      const corpo = rust.slice(rust.indexOf(chi), rust.indexOf(chi) + 800);
      expect(corpo, `${chi} deve chiedere a famiglia_pelagic`).toContain('famiglia_pelagic(marca, prodotto)');
    }
  });
});
