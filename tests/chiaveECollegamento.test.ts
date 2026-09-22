/**
 * LA CHIAVE DI ACCOPPIAMENTO: QUANDO SI TIENE, E QUANDO SI BUTTA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA STORIA IN DUE DATE. ◄
 *
 * 16 settembre 2026, dal diario di un Aqualung i330R: il collegamento non si
 * era nemmeno aperto — «Timeout during execution of Connect» — e la riga dopo
 * diceva «chiave dimenticata». La chiave non era mai stata presentata. Si
 * aggiunse un'eccezione per quel testo.
 *
 * 22 settembre 2026, rileggendo il ramo per l'aggiornamento di libdivecomputer:
 * da quando uno scarico fallito **non lancia più** (la 1.8.20, per non perdere
 * le immersioni già arrivate), il ramo `catch` che buttava la chiave scattava
 * SOLO per i guasti di prima dello scarico — cioè proprio quelli in cui la
 * chiave non c'entra — e mai per un computer che la rifiutava. *Buttava la
 * chiave quando non c'entrava, e la teneva quando c'entrava*, e l'eccezione del
 * 16 settembre curava un caso di un ramo che non poteva curare niente.
 *
 * ► LA REGOLA DI ADESSO. ◄ Il guscio Rust sa quello che l'interfaccia poteva
 * solo indovinare dal testo di un errore — la chiave è stata presentata? il
 * computer ne ha data una nuova? si è aperto? — e lo dice con
 * `chiaveNonAccettata`. La chiave si butta alla seconda volta di fila;
 * un'apertura riuscita o una chiave nuova azzerano il conto.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  azzeraRifiutiDellaChiave,
  codiceAccoppiamento,
  contaRifiutoDellaChiave,
  dimenticaAccoppiamento,
  RIFIUTI_PER_DIMENTICARE,
  salvaCodiceAccoppiamento,
} from '../src/core/accoppiamento';

/** Un archivio in memoria, come quello del browser ma senza il browser. */
function archivio(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

const CHIAVE = '0123456789abcdef0123456789abcdef';

describe('il conto dei rifiuti della chiave', () => {
  it('conta di fila, e una chiave nuova ricomincia da zero', () => {
    const dove = archivio();
    salvaCodiceAccoppiamento('dev-1', CHIAVE, dove);
    expect(contaRifiutoDellaChiave('dev-1', dove)).toBe(1);
    expect(contaRifiutoDellaChiave('dev-1', dove)).toBe(2);
    // Il computer ne rilascia una nuova: i rifiuti erano della vecchia.
    salvaCodiceAccoppiamento('dev-1', 'aa'.repeat(16), dove);
    expect(contaRifiutoDellaChiave('dev-1', dove)).toBe(1);
  });

  it('un’apertura riuscita azzera, e dimenticare la chiave dimentica anche il conto', () => {
    const dove = archivio();
    salvaCodiceAccoppiamento('dev-1', CHIAVE, dove);
    contaRifiutoDellaChiave('dev-1', dove);
    azzeraRifiutiDellaChiave('dev-1', dove);
    expect(contaRifiutoDellaChiave('dev-1', dove)).toBe(1);
    dimenticaAccoppiamento('dev-1', dove);
    expect(codiceAccoppiamento('dev-1', dove)).toBeUndefined();
    expect(contaRifiutoDellaChiave('dev-1', dove)).toBe(1);
  });

  it('un dispositivo non si porta dietro i rifiuti di un altro', () => {
    const dove = archivio();
    contaRifiutoDellaChiave('dev-1', dove);
    contaRifiutoDellaChiave('dev-1', dove);
    expect(contaRifiutoDellaChiave('dev-2', dove)).toBe(1);
  });

  it('si butta alla seconda, non alla prima', () => {
    // Il numero è una scelta, e il perché sta in `contaRifiutoDellaChiave`:
    // alla prima si perderebbero sei cifre a ogni collegamento che perde colpi.
    expect(RIFIUTI_PER_DIMENTICARE).toBe(2);
  });

  it('un valore storto nell’archivio vale zero, non un numero inventato', () => {
    const dove = archivio();
    dove.setItem('mydivelog.accoppiamento-rifiuti.dev-1', 'tanti');
    expect(contaRifiutoDellaChiave('dev-1', dove)).toBe(1);
  });
});

describe('dove si decide, nell’interfaccia', () => {
  const tsx = readFileSync('src/ui/components/BleDownload.tsx', 'utf8');

  it('la chiave si butta solo guardando `chiaveNonAccettata`, dentro il `try`', () => {
    const punto = tsx.indexOf('dimenticaAccoppiamento(device.id)');
    expect(punto, 'la chiave non si butta più da nessuna parte?').toBeGreaterThan(-1);
    // Un solo punto in cui si butta: due punti sono due regole.
    expect(tsx.indexOf('dimenticaAccoppiamento(device.id)', punto + 1)).toBe(-1);
    const prima = tsx.slice(Math.max(0, punto - 600), punto);
    expect(prima).toContain('esito.chiaveNonAccettata');
    expect(prima).toContain('RIFIUTI_PER_DIMENTICARE');
  });

  it('il ramo `catch` non tocca la chiave: lì non era mai stata presentata', () => {
    const inizio = tsx.indexOf('} catch (e) {\n        guasto = e;');
    expect(inizio, 'il ramo del guasto di prima dello scarico non si trova').toBeGreaterThan(-1);
    const ramo = tsx.slice(inizio, tsx.indexOf('} finally {', inizio));
    expect(ramo).not.toContain('dimenticaAccoppiamento');
  });
});

describe('il segnale viene dal guscio Rust, che è l’unico a vedere le tre cose', () => {
  const rust = readFileSync('src-tauri/src/ponte_blec.rs', 'utf8');

  it('presentata, non sostituita, computer chiuso', () => {
    const da = rust.indexOf('pub fn chiave_non_accettata(');
    expect(da).toBeGreaterThan(-1);
    const corpo = rust.slice(da, rust.indexOf('\n    }\n', da));
    expect(corpo).toContain('non_aperto');
    expect(corpo).toContain('esito.presentata.load');
    expect(corpo).toContain('!esito.rinnovata.load');
  });

  it('e attraversa il confine col nome che l’interfaccia legge', () => {
    // `rename_all = "camelCase"` su `EsitoEsterno`: il campo Rust
    // `chiave_non_accettata` arriva come `chiaveNonAccettata`.
    expect(rust).toContain('pub chiave_non_accettata: bool,');
    const ts = readFileSync('src/storage/computerEsterni.ts', 'utf8');
    expect(ts).toContain('chiaveNonAccettata?: boolean;');
  });
});
