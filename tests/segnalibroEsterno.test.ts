/**
 * IL SEGNALIBRO NON SI SALVA SU UN'IMMERSIONE CHE NON È ENTRATA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE, ED È IL DIFETTO PEGGIORE CHE UN LOGBOOK POSSA AVERE. ◄
 *
 * `immersioneDaLdc` scarta due specie di record: quelli a cui il computer non ha
 * dato una data, e quelli senza né profondità né durata. `ContestoEsterno` ha un
 * `onScarto` fatto apposta per dirlo — e **non lo passava nessuno**: due sole
 * occorrenze in tutto il sorgente, tutte e due dentro `esterni.ts`.
 *
 * Il guaio non è l'immersione persa. È che il Rust ha già emesso il suo `Record`
 * per quel record, quindi l'interfaccia ha già in mano l'impronta della **più
 * recente**. Se la più recente è proprio quella scartata, lo scarico finisce
 * «senza errori», il segnalibro si salva su di lei, e al giro successivo
 * `dc_device_set_fingerprint` ferma il backend lì: quell'immersione **e tutte
 * quelle più vecchie** non vengono più offerte. Mai più, senza un avviso.
 *
 * *Non perde dati che hai: perde dati che non sai di non avere.* La frase è
 * scritta da mesi in `BleDownload.tsx` accanto al segnalibro, per l'interruzione
 * a metà. Questa era la stessa cosa da un'altra porta.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { immersioniDaLdc, immersioniDaLdcConScarti, type ImmersioneLdc } from '../src/core/ble/esterni';

const CTX = { marca: 'Shearwater', modello: 'Perdix', importedAt: '2026-09-14T20:00:00.000Z' };

const buona = (giorno: number): ImmersioneLdc => ({
  startMs: Date.parse(`2026-09-${giorno}T10:00:00.000Z`),
  durationS: 2400,
  maxDepth: 25,
  gas: [{ o2: 0.21, he: 0 }],
  samples: [
    { t: 0, depth: 0 },
    { t: 1200, depth: 25 },
    { t: 2400, depth: 0 },
  ],
});

describe('i record che non diventano immersioni', () => {
  it('quello senza data viene scartato E dichiarato', () => {
    const { dives, scartate } = immersioniDaLdcConScarti(
      [{ ...buona(13), senzaData: true }, buona(12), buona(11)],
      CTX,
    );
    expect(dives).toHaveLength(2);
    expect(scartate).toHaveLength(1);
    expect(scartate[0]).toContain('data');
  });

  it('quello senza profondità né durata pure, e prima era MUTO', () => {
    /*
     * ► LA RIGA CHE MANCAVA. ◄ Quell'uscita restituiva `undefined` e basta,
     * venti righe sotto un commento che dice «si scarta DICENDOLO, mai in
     * silenzio». Un record troncato nella memoria circolare — il caso che tutto
     * il resto del file difende — spariva portandosi via il segnalibro.
     */
    const vuoto: ImmersioneLdc = {
      startMs: Date.parse('2026-09-13T10:00:00.000Z'),
      durationS: 0,
      maxDepth: 0,
      gas: [],
      samples: [],
    };
    const { dives, scartate } = immersioniDaLdcConScarti([vuoto, buona(12)], CTX);
    expect(dives).toHaveLength(1);
    expect(scartate).toHaveLength(1);
    expect(scartate[0]).toMatch(/profondità|durata/);
  });

  it('e quando entrano tutte, non c’è niente da dichiarare', () => {
    /*
     * Il rovescio, e non è pignoleria: se questa riga cadesse, il segnalibro
     * non si salverebbe **mai più** e ogni scarico ripartirebbe da capo — un
     * rimedio che costa più del difetto.
     */
    const { dives, scartate } = immersioniDaLdcConScarti([buona(13), buona(12)], CTX);
    expect(dives).toHaveLength(2);
    expect(scartate).toEqual([]);
  });

  it('la funzione senza scarti resta quella di prima, per chi non li guarda', () => {
    const dives = immersioniDaLdc([{ ...buona(13), senzaData: true }, buona(12)], CTX);
    expect(dives).toHaveLength(1);
  });
});

describe('► la guardia che lega gli scarti al segnalibro ◄', () => {
  it('l’interfaccia pretende «nessuno scartato» prima di conservarlo', () => {
    /*
     * La condizione vive dentro duemila righe di componente e non si può
     * montare senza Tauri sotto. Si controlla sul sorgente, come fa
     * `avanzamentoTradotto.test.ts` con le etichette del ponte Rust: è l'unico
     * modo di legare due pezzi che non si possono far girare insieme qui.
     */
    const sorgente = readFileSync('src/ui/components/BleDownload.tsx', 'utf8');
    expect(sorgente).toContain('if (!grezzo && tutteTradotte && metodoHaFunzionato && piuRecente)');
    expect(sorgente, 'lo scarto deve mettere a falso la bandiera').toMatch(
      /scartate\.length > 0\) \{[\s\S]{0,40}tutteTradotte = false;/,
    );
  });

  it('e il chiamante del ponte passa davvero la versione che li raccoglie', () => {
    const sorgente = readFileSync('src/storage/computerEsterni.ts', 'utf8');
    expect(sorgente).toContain('immersioniDaLdcConScarti');
    expect(sorgente, 'gli scarti devono uscire dalla funzione').toContain('scartate: tradotte.scartate');
  });
});
