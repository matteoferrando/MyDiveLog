/**
 * ► LE IMMERSIONI SI LEGGONO COL DISPOSITIVO APERTO, COME IN SUBSURFACE. ◄
 *
 * Fino al 22 settembre 2026 lo scarico via libdivecomputer costruiva il
 * lettore di ogni immersione con `dc_parser_new2`, cioè sul modello SCELTO —
 * dall'elenco, o proposto dal nome Bluetooth. Per molte famiglie il modello
 * decide come si leggono i byte, e il modello scelto può non essere quello
 * vero: un lettore sbagliato non dà errore, dà un profilo plausibile e falso.
 *
 * Adesso si legge con `dc_parser_new`, sul dispositivo ancora aperto: il
 * modello è quello che il computer ha dichiarato. È una decisione di forma —
 * DOVE avviene la lettura — e una forma si rompe spostando due righe, senza
 * che niente fallisca: basta leggere dopo `dc_device_close`, o tornare a
 * chiamare `traduci` dal ponte. Queste prove leggono il sorgente Rust, come
 * fanno le sorelle in `esterniLdc.test.ts`, perché da qui quel codice non si
 * può eseguire.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const TRASPORTO = readFileSync('src-tauri/src/trasporto_ldc.rs', 'utf8');
const PONTE = readFileSync('src-tauri/src/ponte_blec.rs', 'utf8');

/** Il corpo di una funzione Rust, dalla firma alla prima riga che chiude a quattro spazi. */
function corpo(sorgente: string, firma: string): string {
  const da = sorgente.indexOf(firma);
  expect(da, `«${firma}» non c’è più`).toBeGreaterThanOrEqual(0);
  const a = sorgente.indexOf('\n    }\n', da);
  expect(a, `la fine di «${firma}» non si trova`).toBeGreaterThan(da);
  return sorgente.slice(da, a);
}

describe('la lettura delle immersioni scaricate', () => {
  it('avviene dentro lo scarico, PRIMA di chiudere il dispositivo', () => {
    const scarico = corpo(TRASPORTO, 'pub fn scarica_tutto(');
    const lettura = scarico.indexOf('leggi_dal_dispositivo(dispositivo');
    const chiusura = scarico.lastIndexOf('dc_device_close(dispositivo)');
    expect(lettura, 'lo scarico non legge più col dispositivo').toBeGreaterThan(-1);
    expect(chiusura).toBeGreaterThan(-1);
    expect(
      lettura,
      'la lettura deve stare prima della chiusura: dopo, il dispositivo non c’è più',
    ).toBeLessThan(chiusura);
  });

  it('usa il lettore del dispositivo, non quello del descrittore', () => {
    const funzione = TRASPORTO.slice(
      TRASPORTO.indexOf('fn leggi_dal_dispositivo('),
      TRASPORTO.indexOf('fn leggi_col_lettore('),
    );
    expect(funzione).toContain('dc_parser_new(&mut parser, dispositivo');
    expect(funzione).not.toContain('dc_parser_new2');
  });

  it('il ponte consegna le letture dello scarico e non ne rifà una sua', () => {
    // Una seconda lettura nel ponte, col descrittore, rimetterebbe in piedi
    // esattamente la strada che questa correzione ha tolto.
    expect(PONTE).not.toMatch(/\btraduci\(/);
    expect(PONTE).toContain('esito_scarico.tradotte');
  });

  it('si iscrive anche a DC_EVENT_DEVINFO: senza, il modello dichiarato non arriva al diario', () => {
    const scarico = corpo(TRASPORTO, 'pub fn scarica_tutto(');
    expect(scarico).toMatch(/DC_EVENT_PROGRESS \| DC_EVENT_DEVINFO/);
  });
});
