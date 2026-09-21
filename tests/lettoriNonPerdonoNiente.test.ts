/**
 * QUELLO CHE I LETTORI TROVAVANO NEL FILE E NON PORTAVANO IN ARCHIVIO.
 *
 * ► LA FAMIGLIA. ◄ Non sono errori di calcolo: sono campi che il file contiene,
 * che il modello ha, e che nessuno copiava da uno all'altro. Il più insidioso è
 * il cambio gas di Subsurface — senza, **tutta l'immersione veniva calcolata
 * sulla miscela di fondo** e l'esposizione all'ossigeno usciva dimezzata.
 */

import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/core/parsers';
import type { Dive } from '../src/core/model';

const leggi = async (nome: string, testo: string): Promise<Dive> =>
  (await parseFile({ fileName: nome, text: testo })).dives[0]!;

const SSRF = (dentro: string, campioni: string, eventi = '') => `<divelog program='subsurface' version='3'>
<settings/><divesites><site uuid='11' name='Punta Chiappa'/></divesites><dives>
<dive number='7' date='2026-09-13' time='09:51:00' duration='57:00 min' rating='5' visibility='4' divesiteid='11'>
  ${dentro}
  <cylinder size='15.0 l' workpressure='232.0 bar' description='EAN28' o2='28.0%' start='200.0 bar' end='80.0 bar'/>
  <cylinder size='7.0 l' workpressure='232.0 bar' description='EAN50' o2='50.0%' start='200.0 bar' end='150.0 bar'/>
  <divecomputer model='Shearwater Perdix' deviceid='6aa6722c'>
    ${eventi}
    ${campioni}
  </divecomputer>
</dive></dives></divelog>`;

const campioniA30 = Array.from({ length: 60 }, (_, i) => {
  const t = i * 60;
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  return `<sample time='${mm}:00 min' depth='30.0 m' temp='16.0 C'/>`;
}).join('');

describe('Subsurface: il cambio gas', () => {
  it('viene letto dagli eventi, dove Subsurface lo scrive', async () => {
    /*
     * ► SENZA, IL CAMBIO NON ESISTEVA. ◄ `gasIndex` non veniva mai assegnato,
     * quindi `analyseGasSwitches` usciva subito e `analyseOxygen` ripiegava
     * sulla miscela di fondo. Un cambio sull'EAN50 a trenta metri — PPO2 2.02
     * bar, cioè proprio quello che `badGasSwitches` esiste per contare — non
     * veniva contato **mai**, su nessun file Subsurface.
     */
    const con = await leggi(
      'a.ssrf',
      SSRF('', campioniA30, `<event time='25:00 min' name='gaschange' cylinder='1'/>`),
    );
    const indici = (con.samples ?? []).map((s) => s.gasIndex);
    expect(indici[0]).toBe(undefined);
    expect(indici[indici.length - 1], 'il cambio non è arrivato nei campioni').toBe(1);
    // E la conseguenza che conta: il cambio fuori limite viene contato.
    expect(con.metrics?.badGasSwitches ?? 0).toBeGreaterThan(0);
    expect(con.metrics?.maxPpo2 ?? 0).toBeGreaterThan(1.6);
  });

  it('e senza eventi l’immersione resta sulla prima bombola, come è giusto', async () => {
    const senza = await leggi('b.ssrf', SSRF('', campioniA30));
    expect((senza.samples ?? []).every((s) => s.gasIndex === undefined)).toBe(true);
    expect(senza.metrics?.badGasSwitches ?? 0).toBe(0);
  });
});

describe('Subsurface: i campi che non entravano', () => {
  const pieno = SSRF(
    `<divetemperature air='27.0 C' water='16.0 C'/><suit>Muta Semistagna 6,5mm</suit>
     <divemaster>Alessandro Boschi</divemaster>
     <weightsystem weight='3.0 kg' description='cintura'/><weightsystem weight='4.0 kg' description='piastra'/>`,
    campioniA30,
  );

  it('temperatura, muta, guida e zavorra', async () => {
    const d = await leggi('c.ssrf', pieno);
    expect(d.airTempC).toBeCloseTo(27, 1);
    expect(d.minTempC).toBeCloseTo(16, 1);
    expect(d.suit).toBe('Muta Semistagna 6,5mm');
    expect(d.guide).toBe('Alessandro Boschi');
    // La zavorra è il TOTALE: tre di cintura più quattro di piastra fanno sette.
    expect(d.weightKg).toBeCloseTo(7, 1);
  });

  it('e la visibilità a stelle non finisce nella casella dei metri', async () => {
    /*
     * In Subsurface `visibility` è la stessa valutazione a stelle di `rating`,
     * scritta identica accanto a lui. Finiva in `visibilityM`, e ogni
     * immersione importata entrava in archivio con una visibilità fra uno e
     * cinque **metri** — e la statistica sulla visibilità era costruita lì.
     */
    const d = await leggi('d.ssrf', pieno);
    expect(d.visibilityM, 'una stella non è un numero di metri').toBeUndefined();
    expect(d.visibilityRating).toBe(4);
    expect(d.rating).toBe(5);
  });
});

describe('CSV: zavorra e muta', () => {
  it('le colonne riconosciute finiscono davvero in archivio', async () => {
    /*
     * Gli alias c'erano fra le colonne e il modello ha i campi: mancava solo di
     * scriverli. E siccome le colonne erano **riconosciute**, non comparivano
     * nemmeno nell'avviso «colonne ignorate»: sparivano in silenzio.
     */
    const csv = ['Date,Time,Duration,Max Depth,Weight,Suit', '2026-09-13,09:51,57,30,7,Stagna 7mm'].join(
      '\n',
    );
    const d = await leggi('e.csv', csv);
    expect(d.weightKg).toBe(7);
    expect(d.suit).toBe('Stagna 7mm');
  });
});
