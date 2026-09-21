/**
 * Quello che togli resta tolto, anche con la sincronizzazione accesa.
 *
 * ► IL DIFETTO, MISURATO. ◄ Due dispositivi hanno la stessa immersione con una
 * nota, un compagno e un voto. Sul Mac si cancellano tutti e tre e si salva —
 * quindi il Mac è il lato che ha scritto per ultimo, cioè il vincitore. Si
 * sincronizza, e i tre valori **tornano** dalla copia dell'altro: `takeIfEmpty`
 * non sapeva distinguere «svuotato apposta» da «buco da riempire». Peggio: il
 * risultato veniva riscritto anche sul remoto, quindi la cancellazione era persa
 * su tutti i dispositivi e al giro dopo tornava di nuovo. *Togliere una nota
 * sbagliata, con la sincronizzazione accesa, era impossibile.*
 *
 * Lo stesso valeva per le etichette, unite additivamente, e per `mode` e
 * `salinity`, dove il «ripiego che cede» riportava indietro una scelta appena
 * fatta.
 *
 * ► PERCHÉ LA REGOLA NON È UN ELENCO A SENTIMENTO. ◄ Il confine è **chi scrive
 * il campo**: una macchina non cancella niente, una persona sì. L'ultima prova
 * di questo file non guarda un elenco scritto a mano: legge dal modulo di
 * modifica quali campi una persona può davvero toccare, e pretende che stiano
 * tutti dalla parte giusta. È la differenza fra chiudere un caso e chiudere una
 * classe.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CAMPI_MISURATI, CAMPI_SCRITTI_A_MANO, mergeDive } from '../src/core/dedupe';
import type { Dive } from '../src/core/model';

/** Un profilo minimo: `mergeDive` ricalcola le metriche, e quelle vogliono i campioni. */
const PROFILO = Array.from({ length: 60 }, (_, i) => ({ t: i * 40, depth: 20, tempC: 18 }));

const immersione = (extra: Partial<Dive> = {}): Dive => ({
  id: 'a',
  startTime: '2026-05-01T09:00:00Z',
  durationS: 2400,
  maxDepth: 28,
  mode: 'oc',
  salinity: 'salt',
  cylinders: [{ mix: { o2: 0.21, he: 0 } }],
  source: { format: 'logtrak', file: 'a.logtrak', importedAt: '2026-05-01T20:00:00Z' },
  samples: PROFILO,
  tags: [],
  ...extra,
});

/** Il lato che ha scritto per ultimo, cioè il vincitore, è sempre `base`. */
const fondiComeSincronizza = (vincitore: Dive, perdente: Dive) =>
  mergeDive(vincitore, perdente, undefined, true);

/** Fra fonti diverse, invece, il quarto argomento è falso. */
const fondiComeImporta = (base: Dive, altro: Dive) => mergeDive(base, altro, undefined, false);

describe('un campo svuotato da una persona', () => {
  it('non torna indietro fondendo la stessa scheda da due dispositivi', () => {
    // Svuotare un campo nella scheda di modifica lascia il suo gesto scritto:
    // è l'unica cosa che distingue «l'ho tolto» da «non ce l'ho mai avuto».
    const svuotata = immersione({
      notes: undefined,
      buddy: undefined,
      rating: undefined,
      svuotatiIl: {
        notes: '2026-06-01T12:00:00Z',
        buddy: '2026-06-01T12:00:00Z',
        rating: '2026-06-01T12:00:00Z',
      },
    });
    const vecchia = immersione({ notes: 'nota sbagliata', buddy: 'Marta', rating: 5 });
    const fusa = fondiComeSincronizza(svuotata, vecchia);
    expect(fusa.notes).toBeUndefined();
    expect(fusa.buddy).toBeUndefined();
    expect(fusa.rating).toBeUndefined();
  });

  it('e nemmeno al giro dopo, perché il risultato non riporta niente su', () => {
    // Il difetto vero non era perdere il dato una volta: era riscriverlo sul
    // remoto, così che tornasse per sempre. Si rifà la fusione sul risultato.
    const svuotata = immersione({
      notes: undefined,
      svuotatiIl: { notes: '2026-06-01T12:00:00Z' },
    });
    const vecchia = immersione({ notes: 'nota sbagliata' });
    let fusa = fondiComeSincronizza(svuotata, vecchia);
    for (let giro = 0; giro < 3; giro++) fusa = fondiComeSincronizza(fusa, vecchia);
    expect(fusa.notes).toBeUndefined();
  });

  it('ma fra due FONTI diverse il buco si riempie ancora, che è tutto il punto', () => {
    const daComputer = immersione({ notes: undefined, buddy: undefined });
    const daCsv = immersione({ notes: 'portata dal CSV', buddy: 'Marta' });
    const fusa = fondiComeImporta(daComputer, daCsv);
    expect(fusa.notes).toBe('portata dal CSV');
    expect(fusa.buddy).toBe('Marta');
  });

  it('un campo misurato invece si completa anche fra dispositivi: una macchina non cancella', () => {
    const senzaTemperatura = immersione({ minTempC: undefined, avgDepth: undefined });
    const conTemperatura = immersione({ minTempC: 14.2, avgDepth: 18.5 });
    const fusa = fondiComeSincronizza(senzaTemperatura, conTemperatura);
    expect(fusa.minTempC).toBe(14.2);
    expect(fusa.avgDepth).toBe(18.5);
  });
});

describe('un’etichetta tolta', () => {
  it('resta tolta fra due dispositivi', () => {
    const senza = immersione({ tags: ['notte'] });
    const con = immersione({ tags: ['notte', 'pioggia'] });
    expect(fondiComeSincronizza(senza, con).tags).toEqual(['notte']);
  });

  it('e non ricompare nemmeno dopo tre giri', () => {
    const con = immersione({ tags: ['notte', 'pioggia'] });
    let fusa = immersione({ tags: ['notte'] });
    for (let giro = 0; giro < 3; giro++) fusa = fondiComeSincronizza(fusa, con);
    expect(fusa.tags).toEqual(['notte']);
  });

  it('mentre fra due letture della stessa immersione le etichette si sommano ancora', () => {
    const unLettore = immersione({ tags: ['notte'] });
    const unAltro = immersione({ tags: ['grotta'] });
    expect(fondiComeImporta(unLettore, unAltro).tags?.sort()).toEqual(['grotta', 'notte']);
  });
});

describe('una scelta appena fatta', () => {
  it('non viene riportata al ripiego dall’altro dispositivo', () => {
    // Si riporta un'immersione da rebreather a circuito aperto, e si sceglie
    // acqua dolce. Il ripiego è proprio `oc` e `salt`: senza la condizione, la
    // copia vecchia li avrebbe rimessi come «chi sa che vince su chi non sa».
    const corretta = immersione({ mode: 'oc', salinity: 'fresh' });
    const vecchia = immersione({ mode: 'ccr', salinity: 'salt' });
    const fusa = fondiComeSincronizza(corretta, vecchia);
    expect(fusa.mode).toBe('oc');
    expect(fusa.salinity).toBe('fresh');
  });

  it('mentre in importazione il ripiego cede ancora a chi sa', () => {
    const chiNonSa = immersione({ mode: 'oc', salinity: 'salt' });
    const chiSa = immersione({ mode: 'ccr', salinity: 'fresh' });
    const fusa = fondiComeImporta(chiNonSa, chiSa);
    expect(fusa.mode).toBe('ccr');
    expect(fusa.salinity).toBe('fresh');
  });
});

describe('il confine fra i due elenchi', () => {
  it('non lascia fuori nessun campo che il modulo di modifica sappia scrivere', () => {
    /*
     * Si legge dal sorgente della scheda di modifica quali campi passano da
     * `tocca({...})`, che è l'unico modo in cui quel modulo scrive
     * nell'immersione. Ogni campo così scritto, se è uno di quelli che
     * `takeIfEmpty` completa, deve stare fra quelli scritti a mano — altrimenti
     * svuotarlo non si propaga, ed è il difetto da cui nasce questo file.
     */
    const sorgente = readFileSync('src/ui/components/ModificaImmersione.tsx', 'utf8');
    const scrivibili = new Set([...sorgente.matchAll(/tocca\(\{\s*([A-Za-z]+)/g)].map((m) => m[1]!));
    expect(scrivibili.size, 'nessun `tocca({...})` trovato: la scheda è cambiata').toBeGreaterThan(8);
    const misurati = new Set<string>(CAMPI_MISURATI);
    const aMano = new Set<string>(CAMPI_SCRITTI_A_MANO);
    const dallaParteSbagliata = [...scrivibili].filter((c) => misurati.has(c) && c !== 'salinity');
    expect(
      dallaParteSbagliata,
      `la scheda di modifica li scrive, ma sono fra i misurati: ${dallaParteSbagliata.join(', ')}`,
    ).toEqual([]);
    // E almeno metà dei campi scrivibili devono essere riconosciuti come tali,
    // o questa prova starebbe guardando un elenco che non c'entra più niente.
    const riconosciuti = [...scrivibili].filter((c) => aMano.has(c));
    expect(riconosciuti.length).toBeGreaterThanOrEqual(6);
  });

  it('e i due elenchi non si sovrappongono', () => {
    const doppi = (CAMPI_MISURATI as readonly string[]).filter((c) =>
      (CAMPI_SCRITTI_A_MANO as readonly string[]).includes(c),
    );
    expect(doppi).toEqual([]);
  });
});

describe('il gesto si registra dove si compie', () => {
  /*
   * La fusione sa distinguere «l'ho tolto» da «non ce l'ho» solo se qualcuno
   * glielo scrive, e l'unico posto che lo sa è la scheda di modifica: più a
   * valle c'è un `undefined` uguale a tutti gli altri. Se questa parte non c'è,
   * tutte le prove qui sopra restano verdi e il difetto torna intero.
   */
  const sorgente = readFileSync('src/ui/components/ModificaImmersione.tsx', 'utf8');

  it('la scheda di modifica scrive il registro degli svuotamenti quando salva', () => {
    const dentroSalva = sorgente.slice(
      sorgente.indexOf('const salva = ()'),
      sorgente.indexOf('void onSave('),
    );
    expect(dentroSalva).toContain('svuotatiIl:');
  });

  it('e lo calcola sui campi scritti a mano, non su un elenco suo', () => {
    expect(sorgente).toContain('CAMPI_SCRITTI_A_MANO');
  });
});
