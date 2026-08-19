/**
 * I campi della scheda immersione: condizioni, bombole, zavorra.
 *
 * Sono tre pezzi che sembrano banali e non lo sono, ciascuno per una ragione
 * diversa. Le condizioni devono continuare a leggersi anche dalle immersioni
 * salvate col formato vecchio, senza migrazioni. La sigla di una bombola è un
 * nome commerciale che MENTE sul volume, e sbagliare i litri sbaglia ogni
 * consumo calcolato della stessa percentuale, per sempre. La zavorra e la
 * piastra sono due campi che vanno sommati, e il difetto naturale di due campi
 * separati è dimenticarsi di sommarli.
 */

import { describe, expect, it } from 'vitest';
import {
  conditionsOf,
  condizioniTesto,
  perStatoDelMare,
  perVisibilita,
  quanteConCondizioni,
  raggruppaPerCondizione,
  tagsSenzaCondizioni,
  visibilitaTesto,
} from '../src/core/conditions';
import { parseCylinderSpec } from '../src/core/cylinders';
import { equipmentUsage, weightingBySuit, zavorraTotaleKg } from '../src/core/analysis/gear';
import type { Equipment } from '../src/core/analysis/gear';
import type { Dive } from '../src/core/model';
import { mergeDive } from '../src/core/dedupe';
import { logbookHtml } from '../src/core/export/logbookPrint';
import { exportUddf } from '../src/core/export/uddf';

describe('condizioni', () => {
  it('legge il campo nuovo quando c’è', () => {
    const d = { conditions: { weather: 'rainy' as const, waves: 'rough' as const }, tags: ['sole'] };
    expect(conditionsOf(d)).toEqual({ weather: 'rainy', waves: 'rough' });
    expect(condizioniTesto(d)).toBe('pioggia · mare agitato');
  });

  it('legge le etichette vecchie dai tag, senza bisogno di migrare l’archivio', () => {
    /*
     * È il punto di tutto il file `conditions.ts`. Un passaggio di migrazione
     * su tutto l'archivio gira una volta sola, non si riesce a provare due
     * volte, e se sbaglia sbaglia su tutto insieme. Leggere due forme costa
     * una funzione invece di un rischio.
     */
    expect(conditionsOf({ tags: ['sole', 'mare mosso', 'notturna'] })).toEqual({
      weather: 'sunny',
      waves: 'moderate',
    });
    // Anche i codici grezzi che LogTRAK produceva prima della traduzione.
    expect(conditionsOf({ tags: ['overcast', 'moderately'] })).toEqual({
      weather: 'overcast',
      waves: 'moderate',
    });
  });

  it('un campo nuovo VUOTO vince sui tag vecchi', () => {
    // Se qualcuno ha aperto la scheda e ha tolto il meteo, quel vuoto è una
    // scelta: riempirlo da un tag rimasto indietro sarebbe rimettere a mano
    // quello che è stato appena cancellato.
    expect(conditionsOf({ conditions: {}, tags: ['sole'] })).toEqual({});
  });

  it('i tag delle condizioni si tolgono quando si passa alla forma nuova', () => {
    expect(tagsSenzaCondizioni(['sole', 'notturna', 'mare calmo', 'relitto'])).toEqual([
      'notturna',
      'relitto',
    ]);
  });

  it('la visibilità si legge come fascia o come numero', () => {
    expect(visibilitaTesto({ visibilityM: 5, visibilityMaxM: 10 })).toBe('da 5 a 10 m');
    expect(visibilitaTesto({ visibilityM: 12 })).toBe('12 m');
    expect(visibilitaTesto({})).toBe('—');
    // Massimo uguale al minimo: è un numero, non una fascia da zero larghezza.
    expect(visibilitaTesto({ visibilityM: 8, visibilityMaxM: 8 })).toBe('8 m');
  });
});

describe('sigle delle bombole', () => {
  it('la S80 vale 11.1 L, non il numero che ha nel nome', () => {
    /*
     * «80» sono i piedi cubi di GAS erogati, non i litri d'acqua — e il nome
     * mente anche su quelli: la Luxfer chiamata 80 ne dà 77,4. Applicando la
     * formula al nome verrebbero 10,95 L: un errore dell'1,4% su ogni consumo
     * calcolato, sempre nella stessa direzione.
     */
    const s80 = parseCylinderSpec('S80');
    expect(s80?.sizeL).toBe(11.1);
    expect(s80?.material).toBe('alu');
    expect(s80?.workPressureBar).toBe(207);
    expect(s80?.from).toBe('tabella');

    expect(parseCylinderSpec('s40')?.sizeL).toBe(5.7);
    expect(parseCylinderSpec('AL 80')?.sizeL).toBe(11.1);
  });

  it('una sigla fuori tabella NON si stima: il campo resta vuoto', () => {
    /*
     * È la trappola peggiore del modulo, trovata provandola. «S12» stimato con
     * la formula dà 1.6 L — la taglia di una vera bombolina di scorta, quindi un
     * numero che nessuno mette in dubbio — e il consumo di quella immersione
     * diventa 2 L/min invece di 15.
     *
     * E chi scrive «S12» in Italia intende quasi certamente una dodici litri
     * d'acciaio: la sigla `S<n>` è americana e lì `n` sono i piedi cubi. La
     * stessa stringa vuol dire due cose a seconda di chi la scrive, e non c'è
     * modo di sapere quale. Un campo vuoto si nota, un numero sbagliato no.
     */
    expect(parseCylinderSpec('S12')).toBeUndefined();
    expect(parseCylinderSpec('S77')).toBeUndefined();
    expect(parseCylinderSpec('S9999')).toBeUndefined();
    // Ma i piedi cubi dichiarati per esteso non sono ambigui, e si convertono.
    expect(parseCylinderSpec('80 cuft')?.from).toBe('formula');
  });

  it('uno zero non entra: non è un buco, è un valore che blocca il volume vero', () => {
    /*
     * La fusione fra due import riempie solo i campi indefiniti. Uno zero
     * arrivato per sbaglio impedisce per sempre al volume vero — quello che
     * arriverebbe dal file successivo — di entrare.
     */
    expect(parseCylinderSpec('S0')).toBeUndefined();
    expect(parseCylinderSpec('0.0001')).toBeUndefined();
    expect(parseCylinderSpec('d999')).toBeUndefined();
    expect(parseCylinderSpec('100000 cuft')).toBeUndefined();
  });

  it('i litri scritti direttamente restano quelli', () => {
    expect(parseCylinderSpec('12')?.sizeL).toBe(12);
    expect(parseCylinderSpec('11,1 L')?.sizeL).toBe(11.1);
    expect(parseCylinderSpec('15 litri')?.sizeL).toBe(15);
  });

  it('un bibombola non si raddoppia né si dimezza in silenzio', () => {
    /*
     * `Cylinder.sizeL` è il volume di UNA bombola e il resto del programma
     * conta le bombole dall'elenco: indovinare qui significa raddoppiare due
     * volte o non raddoppiare affatto, e in tutti e due i casi senza che si
     * veda.
     */
    const d12 = parseCylinderSpec('D12');
    expect(d12?.sizeL).toBe(12);
    expect(d12?.note).toMatch(/24 L/);
    expect(parseCylinderSpec('2x12')?.sizeL).toBe(12);
  });

  it('quello che non si capisce resta vuoto, non diventa un numero inventato', () => {
    expect(parseCylinderSpec('')).toBeUndefined();
    expect(parseCylinderSpec('quella grigia')).toBeUndefined();
    expect(parseCylinderSpec('0')).toBeUndefined();
    expect(parseCylinderSpec('-5')).toBeUndefined();
    // Un numero assurdo è più probabilmente un errore di battitura che una
    // bombola: 200 litri non esistono, e accettarlo falserebbe tutto.
    expect(parseCylinderSpec('200')).toBeUndefined();
  });
});

describe('zavorra e piastra', () => {
  const base = (over: Partial<Dive>): Dive =>
    ({
      id: 'x',
      startTime: '2026-01-01T10:00:00Z',
      durationS: 2400,
      maxDepth: 20,
      mode: 'oc',
      cylinders: [],
      source: { format: 'manual', file: '', importedAt: '' },
      tags: [],
      ...over,
    }) as Dive;

  it('si sommano: è il peso che ti tira giù davvero', () => {
    expect(zavorraTotaleKg(base({ weightKg: 2, gear: { backplateKg: 3 } }))).toBe(5);
    expect(zavorraTotaleKg(base({ weightKg: 6 }))).toBe(6);
    expect(zavorraTotaleKg(base({}))).toBe(0);
  });

  it('la tabella per muta conta il totale, non la sola zavorra', () => {
    /*
     * Chi ha una piastra d'acciaio da 3 kg e scrive «2 kg di zavorra» ne porta
     * cinque: una statistica che legge solo `weightKg` racconta il contrario
     * di quello che succede in acqua.
     */
    const righe = weightingBySuit([
      base({ suit: 'stagna', weightKg: 2, gear: { backplateKg: 3 } }),
      base({ suit: 'stagna', weightKg: 2, gear: { backplateKg: 3 } }),
    ]);
    expect(righe[0].medianKg).toBe(5);
    expect(righe[0].withBackplate).toBe(2);
  });
});

describe('immersioni per attrezzo', () => {
  const imm = (id: string, quando: string, gear: Dive['gear']): Dive =>
    ({
      id,
      startTime: quando,
      durationS: 2400,
      maxDepth: 20,
      mode: 'oc',
      cylinders: [],
      source: { format: 'manual', file: '', importedAt: '' },
      tags: [],
      gear,
    }) as Dive;

  const erogatore: Equipment = {
    id: 'e1',
    kind: 'regulator',
    name: 'Apeks XTX50',
    service: 'overhaul',
    lastServiceOn: '2026-03-01',
  };
  const gav: Equipment = { id: 'b1', kind: 'bcd', name: 'Sacco', service: 'none' };

  it('conta le immersioni e quelle dopo l’ultima manutenzione', () => {
    /*
     * È la domanda per cui l'inventario esiste: la norma conta i mesi, l'usura
     * conta le immersioni, e la data da sola non distingue un erogatore fermo
     * in cantina da uno che ha fatto tre viaggi.
     */
    const u = equipmentUsage(
      [
        imm('a', '2026-01-10T10:00:00Z', { regulators: [{ id: 'e1', name: 'Apeks XTX50' }] }),
        imm('b', '2026-04-10T10:00:00Z', { regulators: [{ id: 'e1', name: 'Apeks XTX50' }] }),
        imm('c', '2026-05-10T10:00:00Z', {
          regulators: [{ id: 'e1', name: 'Apeks XTX50' }],
          bcd: { id: 'b1', name: 'Sacco' },
        }),
      ],
      [erogatore, gav],
    );
    expect(u.get('e1')).toMatchObject({ dives: 3, divesSinceService: 2 });
    expect(u.get('e1')?.lastUsedOn).toBe('2026-05-10T10:00:00Z');
    // Senza manutenzione registrata il campo resta indefinito: «0 dall’ultima»
    // direbbe che una revisione c’è stata.
    expect(u.get('b1')).toMatchObject({ dives: 1 });
    expect(u.get('b1')?.divesSinceService).toBeUndefined();
  });

  it('lo stesso attrezzo messo due volte nella stessa immersione conta una volta', () => {
    // Un erogatore finito per sbaglio in entrambi i campi raddoppierebbe il
    // conto, e quel numero deve poter essere creduto.
    const u = equipmentUsage(
      [
        imm('a', '2026-04-10T10:00:00Z', {
          regulators: [
            { id: 'e1', name: 'Apeks XTX50' },
            { id: 'e1', name: 'Apeks XTX50' },
          ],
        }),
      ],
      [erogatore],
    );
    expect(u.get('e1')?.dives).toBe(1);
  });

  it('un attrezzo scritto a mano e non agganciato non conta, e non vale zero', () => {
    // Senza identificativo non c'è aggancio: «0 immersioni» sarebbe falso,
    // perché il dato non c'è. La colonna mostra un trattino.
    const u = equipmentUsage(
      [imm('a', '2026-04-10T10:00:00Z', { regulators: [{ name: 'Apeks XTX50' }] })],
      [erogatore],
    );
    expect(u.get('e1')?.dives).toBe(0);
  });
});

describe('statistiche sulle condizioni', () => {
  const imm = (over: Partial<Dive>, rmv?: number): Dive =>
    ({
      id: Math.random().toString(36),
      startTime: '2026-01-01T10:00:00Z',
      durationS: 2400,
      maxDepth: 20,
      mode: 'oc',
      cylinders: [],
      source: { format: 'manual', file: '', importedAt: '' },
      tags: [],
      metrics: rmv === undefined ? undefined : ({ rmvLpm: rmv } as Dive['metrics']),
      ...over,
    }) as Dive;

  it('mediane per gruppo, ciascuna col proprio denominatore', () => {
    /*
     * Il denominatore per gruppo non è un dettaglio: «17 L/min» su due
     * immersioni delle dieci del gruppo è un'altra affermazione rispetto a «17
     * su dieci», e senza il numero piccolo le due si leggono uguali.
     */
    const dives = [
      imm({ conditions: { waves: 'calm' } }, 16),
      imm({ conditions: { waves: 'calm' } }, 18),
      imm({ conditions: { waves: 'calm' } }), // senza consumo
      imm({ conditions: { waves: 'rough' } }, 22),
      imm({ conditions: { waves: 'rough' } }, 24),
      imm({ conditions: { waves: 'rough' } }, 26),
    ];
    const g = perStatoDelMare(dives);
    expect(g.map((x) => x.chiave)).toEqual(['calm', 'rough']);
    expect(g[0]).toMatchObject({ dives: 3, medianRmvLpm: 17, rmvBasis: 2 });
    expect(g[1]).toMatchObject({ dives: 3, medianRmvLpm: 24, rmvBasis: 3 });
  });

  it('l’ordine del mare è la scala, non la frequenza', () => {
    // Ordinando per frequenza si nasconde l'unica cosa che la tabella deve far
    // vedere: se una misura peggiora quando il mare peggiora.
    const dives = [
      ...Array.from({ length: 5 }, () => imm({ conditions: { waves: 'rough' } }, 20)),
      ...Array.from({ length: 3 }, () => imm({ conditions: { waves: 'calm' } }, 20)),
    ];
    expect(perStatoDelMare(dives).map((x) => x.chiave)).toEqual(['calm', 'rough']);
  });

  it('un gruppo con meno di tre immersioni non entra in tabella', () => {
    // Una mediana su due immersioni è un numero, non una misura: accanto a una
    // calcolata su quaranta le fa sembrare confrontabili.
    const dives = [
      imm({ conditions: { waves: 'calm' } }, 16),
      imm({ conditions: { waves: 'calm' } }, 18),
      imm({ conditions: { waves: 'rough' } }, 30),
      imm({ conditions: { waves: 'rough' } }, 30),
      imm({ conditions: { waves: 'rough' } }, 30),
    ];
    expect(perStatoDelMare(dives).map((x) => x.chiave)).toEqual(['rough']);
  });

  it('legge anche le condizioni salvate nel formato vecchio, dai tag', () => {
    const dives = Array.from({ length: 3 }, () => imm({ tags: ['mare mosso'] }, 20));
    expect(perStatoDelMare(dives)[0]).toMatchObject({ chiave: 'moderate', dives: 3 });
  });

  it('la visibilità si raggruppa per fascia, e le fasce restano in ordine', () => {
    const dives = [
      ...Array.from({ length: 3 }, () => imm({ visibilityM: 30 }, 20)),
      ...Array.from({ length: 3 }, () => imm({ visibilityM: 4 }, 20)),
    ];
    const g = perVisibilita(dives);
    expect(g).toHaveLength(2);
    expect(g[0].etichetta).toContain('da 3 a 5');
    expect(g[1].etichetta).toContain('da 25 a 40');
  });

  it('i denominatori contano le immersioni col dato, non quelle in tabella', () => {
    const dives = [
      imm({ conditions: { waves: 'calm' } }),
      imm({ conditions: { waves: 'rough' } }),
      imm({ visibilityM: 10 }),
      imm({}),
    ];
    expect(quanteConCondizioni(dives)).toEqual({ mare: 2, meteo: 0, visibilita: 1 });
  });

  it('le immersioni senza il dato non finiscono in un gruppo «ignoto»', () => {
    // Un gruppo «non registrato» accanto agli altri si legge come una condizione
    // meteorologica, e la sua mediana come se descrivesse qualcosa.
    const dives = Array.from({ length: 5 }, () => imm({}, 20));
    expect(
      raggruppaPerCondizione(
        dives,
        (d) => conditionsOf(d).waves,
        (k) => k,
      ),
    ).toEqual([]);
  });
});

describe('i campi nuovi sopravvivono alla fusione e alla stampa', () => {
  const piena = (over: Partial<Dive> = {}): Dive =>
    ({
      id: 'x',
      startTime: '2026-06-14T10:30:00Z',
      durationS: 2700,
      maxDepth: 28,
      mode: 'oc',
      cylinders: [{ mix: { o2: 0.32, he: 0 }, sizeL: 12, startBar: 220, endBar: 70 }],
      source: { format: 'manual', file: '', importedAt: '' },
      tags: [],
      title: 'notturna al relitto',
      guide: 'Marco',
      conditions: { weather: 'rainy', waves: 'rough' },
      gear: { regulators: [{ id: 'e1', name: 'Apeks XTX50' }], backplateKg: 3, suit: { name: 'stagna' } },
      visibilityM: 5,
      visibilityMaxM: 10,
      weightKg: 2,
      suit: 'stagna',
      ...over,
    }) as Dive;

  it('la fusione NON butta via quello che hai appena scritto', () => {
    /*
     * Il difetto peggiore trovato dalla revisione: `mergeDive` conosceva un
     * elenco di campi, e i cinque nuovi non c'erano. Il modulo «Aggiungi a
     * mano» costruisce l'identificativo con orario, profondità e durata proprio
     * per riconoscere l'immersione già scaricata dal computer — e quando la
     * riconosceva FONDEVA, buttando via titolo, guida, condizioni e
     * attrezzatura appena digitati mentre a schermo compariva «arricchita».
     */
    const povera = piena({
      title: undefined,
      guide: undefined,
      conditions: undefined,
      gear: undefined,
      visibilityM: undefined,
      visibilityMaxM: undefined,
    });
    const dive = mergeDive(povera, piena());
    expect(dive.title).toBe('notturna al relitto');
    expect(dive.guide).toBe('Marco');
    expect(dive.conditions).toEqual({ weather: 'rainy', waves: 'rough' });
    expect(dive.gear?.backplateKg).toBe(3);
    expect(dive.gear?.regulators?.[0].name).toBe('Apeks XTX50');
    // La fascia resta una fascia: senza `visibilityMaxM` «da 5 a 10 m» sarebbe
    // diventata «5 m», cioè una stima trasformata in misura.
    expect(dive.visibilityMaxM).toBe(10);
  });

  it('condizioni e attrezzatura si fondono CAMPO per campo', () => {
    // Il meteo arriva da LogTRAK, il mare lo scrivi dopo a mano: prendere il
    // blocco intero solo quando manca del tutto lascerebbe fuori il secondo.
    const soloMeteo = piena({ conditions: { weather: 'sunny' }, gear: { backplateKg: 3 } });
    const soloMare = piena({ conditions: { waves: 'calm' }, gear: { bcd: { name: 'sacco' } } });
    const dive = mergeDive(soloMeteo, soloMare);
    expect(dive.conditions).toEqual({ weather: 'sunny', waves: 'calm' });
    expect(dive.gear?.backplateKg).toBe(3);
    expect(dive.gear?.bcd?.name).toBe('sacco');
  });

  it('il logbook da stampare legge le condizioni nella forma nuova, e somma la piastra', () => {
    /*
     * La pagina con lo spazio per la firma leggeva ancora `dive.tags`. Da quando
     * la scheda salva nel campo nuovo e toglie i tag corrispondenti, aprire
     * un'immersione e premere Salva senza toccare niente svuotava la riga
     * «Condizioni» del foglio da far controfirmare.
     */
    const html = logbookHtml([piena()], new Map());
    expect(html).toContain('pioggia');
    expect(html).toContain('mare agitato');
    // 2 kg di zavorra più 3 di piastra fanno cinque, ed è quello che si porta.
    expect(html).toMatch(/Zavorra[\s\S]{0,80}5[.,]0 kg/);
    expect(html).toContain('da 5 a 10 m');
    expect(html).toContain('Apeks XTX50');
  });

  it('l’export UDDF DICHIARA quello che non sa portarsi dietro', () => {
    // Il modulo promette di dichiarare le perdite, e l'elenco non era stato
    // aggiornato: un elenco incompleto è peggio di nessun elenco, perché fa
    // credere di sapere cosa si sta perdendo.
    const { omitted } = exportUddf([piena()]);
    const testo = omitted.join(' · ');
    expect(testo).toMatch(/titolo/);
    expect(testo).toMatch(/guida/);
    expect(testo).toMatch(/meteo/);
    expect(testo).toMatch(/attrezzatura/);
  });
});
