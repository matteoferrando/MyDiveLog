/**
 * Il catalogo delle didattiche.
 *
 * ► PERCHÉ QUESTO FILE È LUNGO. ◄ Un catalogo di centoventi voci scritte a mano
 * è un posto dove gli errori entrano in silenzio: un doppione non dà fastidio a
 * nessuno finché non fa sparire una voce dalla tendina, e un numero sbagliato
 * non dà errore MAI — dà un'autorizzazione. In un logbook subacqueo «40 m»
 * scritto sotto un brevetto che ne autorizza 30 non è un difetto d'interfaccia:
 * è una frase falsa su cosa una persona sia addestrata a fare.
 *
 * Quindi qui ci sono due famiglie di controlli.
 *
 * La prima è strutturale e vale per ogni voce: niente id ripetuti, niente nomi
 * ripetuti dentro la stessa didattica, niente alias che si sovrappongono, e la
 * coerenza fra il nostro scalino e i metri dichiarati — un `base` che dichiara
 * 40 metri è un errore di battitura che nessun compilatore vede.
 *
 * La seconda inchioda i FATTI che la ricerca ha trovato e che il senso comune
 * sbaglia. Sono i casi in cui qualcuno, un domani, «correggerà» un numero giusto
 * perché in rete ne circola un altro. Ogni controllo porta scritto perché.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inLettere } from './inLettere';
import {
  DIDATTICHE,
  DIDATTICA_ALTRO,
  brevettoPerNome,
  didatticaPerId,
  didatticaPerSigla,
} from '../src/core/analysis/didattiche';
import {
  CERT_LEVEL_LABEL,
  RUOLO_LABEL,
  etichettaBrevetto,
  haDecompressione,
  profonditaDichiarata,
  ruoloPiuAlto,
  type CertLevel,
  type Certification,
} from '../src/core/analysis/gear';

const brevetti = DIDATTICHE.flatMap((d) => d.brevetti.map((b) => ({ d, b })));

describe('il catalogo tiene', () => {
  it('ha le didattiche che servono, ricreative e tecniche', () => {
    expect(DIDATTICHE.filter((d) => d.tipo === 'ricreativa').length).toBeGreaterThanOrEqual(7);
    expect(DIDATTICHE.filter((d) => d.tipo === 'tecnica').length).toBeGreaterThanOrEqual(4);
    // Le tre che un subacqueo italiano incontra per prime devono esserci.
    for (const sigla of ['PADI', 'SSI', 'CMAS', 'FIPSAS']) {
      expect(didatticaPerSigla(sigla), sigla).toBeDefined();
    }
  });

  it('nessun id e nessuna sigla ripetuti', () => {
    const id = DIDATTICHE.map((d) => d.id);
    const sigle = DIDATTICHE.map((d) => d.sigla);
    expect(new Set(id).size).toBe(id.length);
    expect(new Set(sigle).size).toBe(sigle.length);
  });

  it('«altro» non è l’id di nessuna didattica vera', () => {
    // Se lo fosse, sceglierla dalla tendina aprirebbe i campi liberi.
    expect(didatticaPerId(DIDATTICA_ALTRO)).toBeUndefined();
  });

  it('dentro una didattica non ci sono nomi né alias ripetuti', () => {
    for (const d of DIDATTICHE) {
      const chiavi = d.brevetti.flatMap((b) => [b.nome, ...(b.alias ?? [])]).map((x) => x.toLowerCase());
      const doppi = chiavi.filter((x, i) => chiavi.indexOf(x) !== i);
      // Un doppione non dà errore: fa sparire una voce dalla tendina, perché
      // `brevettoPerNome` restituisce sempre la prima che trova.
      expect(doppi, `${d.sigla}: ${doppi.join(', ')}`).toEqual([]);
    }
  });

  it('ogni voce ha un nome vero e un livello che esiste', () => {
    for (const { d, b } of brevetti) {
      expect(b.nome.trim(), d.sigla).not.toBe('');
      // La sigla NON va nel nome: si aggiunge al disegno, o si legge «PADI PADI
      // Deep Diver» sul libretto.
      expect(b.nome.startsWith(`${d.sigla} `), `${d.sigla} ${b.nome}`).toBe(false);
      expect(CERT_LEVEL_LABEL[b.livello], `${d.sigla} ${b.nome}`).toBeDefined();
      if (b.ruolo) expect(RUOLO_LABEL[b.ruolo], `${d.sigla} ${b.nome}`).toBeDefined();
    }
  });

  /*
   * ► IL CONTROLLO CHE VALE PIÙ DI TUTTI. ◄
   *
   * Il livello e i metri sono due campi, e devono raccontare la stessa storia.
   * Un `base` che dichiara 40 m, o un `deep` che ne dichiara 18, è quasi sempre
   * una riga copiata dal brevetto sopra e non ricorretta — e nessun compilatore
   * lo vede, perché sono due campi indipendenti e tutti e due validi.
   *
   * Gli intervalli sono larghi apposta: le didattiche non concordano. Il primo
   * livello va da 18 (PADI, SSI, FIPSAS) a 20 (CMAS); il profondo da 39 (SNSI,
   * che converte 130 piedi) a 42 (FIPSAS). Larghi, ma non infiniti.
   */
  it('i metri dichiarati stanno d’accordo con il livello', () => {
    const limiti: Partial<Record<CertLevel, [number, number]>> = {
      intro: [5, 12],
      base: [15, 22],
      advanced: [25, 36],
      deep: [36, 45],
      nitrox: [20, 45],
      tech: [30, 150],
    };
    for (const { d, b } of brevetti) {
      if (b.profonditaM === undefined) continue;
      const [min, max] = limiti[b.livello]!;
      expect(b.profonditaM, `${d.sigla} ${b.nome} (${b.livello})`).toBeGreaterThanOrEqual(min);
      expect(b.profonditaM, `${d.sigla} ${b.nome} (${b.livello})`).toBeLessThanOrEqual(max);
    }
  });

  it('la decompressione compare solo dove ha senso', () => {
    for (const { d, b } of brevetti) {
      if (!b.decompressione) continue;
      // Un brevetto introduttivo o di primo livello che prevede tappe
      // obbligatorie non esiste in nessuna didattica.
      expect(['tech', 'deep'], `${d.sigla} ${b.nome}`).toContain(b.livello);
    }
  });

  it('si ritrova un brevetto per nome, per alias e senza badare alle maiuscole', () => {
    const raid = didatticaPerSigla('RAID')!;
    expect(brevettoPerNome(raid, 'Open Water')?.nome).toBe('Open Water');
    expect(brevettoPerNome(raid, 'open water 20')?.nome).toBe('Open Water');
    expect(brevettoPerNome(raid, '  DEEP 40 ')?.nome).toBe('Deep 40');
    expect(brevettoPerNome(raid, 'Roba che non esiste')).toBeUndefined();
    expect(brevettoPerNome(undefined, 'Open Water')).toBeUndefined();
  });
});

/*
 * ══════════════════════════════════════════════════════════════════════════
 * I fatti che il senso comune sbaglia.
 *
 * Ognuno di questi è un numero che in rete si trova diverso da com'è oggi. Se
 * qualcuno un domani li «corregge» guardando un forum, questi controlli si
 * accendono e gli dicono perché no.
 * ══════════════════════════════════════════════════════════════════════════
 */
describe('i numeri che tutti sbagliano', () => {
  const voce = (sigla: string, nome: string) => {
    const d = didatticaPerSigla(sigla)!;
    const b = brevettoPerNome(d, nome);
    expect(b, `${sigla} ${nome}`).toBeDefined();
    return b!;
  };

  it('CMAS Two Star dichiara 30 metri, non 40', () => {
    // Lo standard 2024 (BOD 233) dice 30 m raccomandati; i 40 m vengono dallo
    // standard 2013 e circolano ancora ovunque.
    expect(voce('CMAS', 'Two Star Diver').profonditaM).toBe(30);
  });

  it('CMAS Three Star dichiara 40 metri e NON è una guida', () => {
    // Lo standard 2023 (BOD 208) dice 40 m — non più 56 — e in una riga
    // esplicita che il Three Star «is not qualified to lead divers».
    const b = voce('CMAS', 'Three Star Diver');
    expect(b.profonditaM).toBe(40);
    expect(b.ruolo).toBeUndefined();
    // La guida, in CMAS, è un brevetto separato.
    expect(voce('CMAS', 'Divemaster').ruolo).toBe('guida');
  });

  it('FIPSAS non è CMAS: i metri sono diversi', () => {
    // Brevetti equipollenti, numeri no. Sono due voci separate apposta.
    expect(voce('FIPSAS', '1° Grado AR').profonditaM).toBe(18);
    expect(voce('CMAS', 'One Star Diver').profonditaM).toBe(20);
    expect(voce('FIPSAS', '3° Grado AR').profonditaM).toBe(42);
    expect(voce('CMAS', 'Three Star Diver').profonditaM).toBe(40);
  });

  it('RAID Open Water è 18 metri, e «Open Water 20» è solo il vecchio nome', () => {
    // Il numero nel nome storico diceva 20. La pagina attuale dice 18: tenere
    // il vecchio nome con i vecchi metri sarebbe un dato di sicurezza sbagliato.
    const b = voce('RAID', 'Open Water');
    expect(b.profonditaM).toBe(18);
    expect(b.alias).toContain('Open Water 20');
  });

  it('i brevetti che non parlano di profondità non ne dichiarano una', () => {
    // Il limite di un Enriched Air lo dà la miscela, non il brevetto; un Rescue
    // non autorizza a scendere più giù di prima. Scriverci 40 perché è il tetto
    // ricreativo vorrebbe dire inventare un'autorizzazione.
    expect(voce('PADI', 'Enriched Air Diver').profonditaM).toBeUndefined();
    expect(voce('PADI', 'Rescue Diver').profonditaM).toBeUndefined();
    expect(voce('PADI', 'Divemaster').profonditaM).toBeUndefined();
    expect(voce('SSI', 'Diver Stress & Rescue').profonditaM).toBeUndefined();
  });

  it('GUE Cave 2 non è più profondo di Cave 1', () => {
    // Aggiunge stage, decompressione e complessità: non metri. È l'errore più
    // comune nel mappare i livelli GUE.
    expect(voce('GUE', 'Cave Diver Level 1').profonditaM).toBe(30);
    expect(voce('GUE', 'Cave Diver Level 2').profonditaM).toBe(30);
    expect(voce('GUE', 'Cave Diver Level 2').decompressione).toBe(true);
  });

  it('SNSI dichiara 39 metri, che è la conversione di 130 piedi', () => {
    // Non è un arrotondamento nostro: è il numero che scrive SNSI.
    expect(voce('SNSI', 'Advanced Open Water Diver').profonditaM).toBe(39);
  });

  it('il Rescue è un ruolo, non un gradino di profondità', () => {
    // Come il Nitrox: sta su un altro asse, e non deve scavalcare niente.
    const b = voce('PADI', 'Rescue Diver');
    expect(b.ruolo).toBe('soccorso');
    expect(b.livello).toBe('base');
  });

  it('NADD: le tre grafie di «Advanced» portano tutte allo stesso brevetto', () => {
    // Il sito ufficiale ne usa tre in tre pagine diverse — «Advanced Open Water
    // Diver», «Advanced Diver», «Advanced Scuba Diver». Chi ne aveva scritta a
    // mano una qualunque deve ritrovarsi, non vedersi degradare a «scritto a mano».
    const d = didatticaPerSigla('NADD')!;
    const canonico = brevettoPerNome(d, 'Advanced Open Water Diver');
    expect(canonico?.profonditaM).toBe(30);
    for (const grafia of ['Advanced Diver', 'Advanced Scuba Diver', 'advanced diver']) {
      expect(brevettoPerNome(d, grafia), grafia).toBe(canonico);
    }
  });

  it('NADD: il Light Deco dichiara 42 metri, non i 45 del titolo', () => {
    // Il titolo della sezione dice 45, ma copre DUE corsi insieme e i 45 sono
    // del secondo. Il corpo del testo assegna 42 al Light Deco. È esattamente
    // il genere di numero che qualcuno «correggerà» leggendo solo il titolo.
    expect(voce('NADD', 'Light Deco Diver').profonditaM).toBe(42);
    expect(voce('NADD', 'Decompression Procedures').profonditaM).toBe(45);
  });

  it('NADD: nessun brevetto rebreather, perché NADD non ne pubblica il nome', () => {
    /*
      La pagina dei corsi tecnici dice che NADD ha «sviluppato specifici corsi»
      per il circuito chiuso, e poi si ferma: nessun nome, nessuna sigla,
      nessun metro. Tutte le altre didattiche tecniche di questo file hanno una
      scala CCR, ed è precisamente per questo che qualcuno un giorno sarà
      tentato di inventarne una qui per simmetria. Questa riga glielo impedisce.
    */
    const d = didatticaPerSigla('NADD')!;
    const sospetti = d.brevetti.filter((b) => /ccr|rebreather|circuito chiuso/i.test(b.nome));
    expect(sospetti).toEqual([]);
  });

  it('NADD: le specialità non dichiarano metri, e la scala professionale nemmeno', () => {
    // Nessuna delle due cose sta sul sito. I 40 m che hanno i divemaster di
    // un'altra didattica, copiati qui, sarebbero un'autorizzazione inventata.
    for (const nome of ['Nitrox Diver', 'Wreck Diver', 'Side Mount', 'Rescue Diver']) {
      expect(voce('NADD', nome).profonditaM, nome).toBeUndefined();
    }
    for (const nome of ['Divemaster', 'Open Water Instructor', 'Instructor Trainer']) {
      expect(voce('NADD', nome).profonditaM, nome).toBeUndefined();
    }
    expect(voce('NADD', 'Divemaster').ruolo).toBe('guida');
  });

  it('NADD: niente apnea in una scala che misura le bombole', () => {
    /*
      NADD insegna anche apnea, e il sito dichiara i metri: 5, 10, 18, 25. Sono
      numeri veri, e messi su `CertLevel` direbbero una cosa falsa — quella
      scala risponde a «fin dove scendi con le bombole». Finché non esiste una
      scala per l'apnea, quei brevetti stanno fuori: meglio assenti che
      travestiti.
    */
    const d = didatticaPerSigla('NADD')!;
    const apnea = d.brevetti.filter((b) => /apnea|mermaid|monopinna|snorkel/i.test(b.nome));
    expect(apnea).toEqual([]);
  });

  it('NADD: il commento in testa dice il numero vero di brevetti', () => {
    /*
      ► UN NUMERO SBAGLIATO IN UN COMMENTO È UNA BUGIA CHE NESSUNO VEDE. ◄

      Il commento sopra NADD diceva «dieci brevetti su trentacinque» quando
      erano quarantaquattro: il conto era stato scritto su una versione
      dell'elenco più corta, e l'elenco è cresciuto senza che il commento se ne
      accorgesse. Nessun compilatore guarda dentro un commento, e chi legge un
      catalogo si fida di quello che c'è scritto in testa proprio perché non ha
      voglia di contare quarantaquattro righe.

      È la stessa regola dei metri, applicata alla prosa: qui non si scrivono
      numeri che nessuno controlla.
    */
    const testa = readFileSync(
      fileURLToPath(new URL('../src/core/analysis/didattiche.ts', import.meta.url)),
      'utf8',
    );
    const d = didatticaPerSigla('NADD')!;
    const conProfondita = d.brevetti.filter((b) => b.profonditaM !== undefined).length;
    const scritto = testa.slice(testa.indexOf('► I NUMERI. ◄'), testa.indexOf('const NADD: Didattica'));
    expect(scritto, 'il commento di NADD non nomina più i numeri').not.toBe('');
    expect(scritto, `brevetti nell'elenco: ${d.brevetti.length}`).toContain(inLettere(d.brevetti.length));
    expect(scritto, `con profondità dichiarata: ${conProfondita}`).toContain(inLettere(conProfondita));
  });
});

// ---------------------------------------------------------------------------

describe('cosa dicono i brevetti messi insieme', () => {
  const dal = (
    didatticaId: string,
    agency: string,
    name: string,
    extra: Partial<Certification> = {},
  ): Certification => ({
    id: `${agency}${name}`,
    agency,
    didatticaId,
    name,
    level: 'base',
    ...extra,
  });

  it('l’etichetta usa il nome vero quando viene dal catalogo', () => {
    expect(etichettaBrevetto(dal('padi', 'PADI', 'Deep Diver', { level: 'deep' }))).toBe('PADI Deep Diver');
    expect(etichettaBrevetto(dal('fipsas', 'FIPSAS', '3° Grado AR', { level: 'deep' }))).toBe(
      'FIPSAS 3° Grado AR',
    );
  });

  it('e torna al livello quando il nome è scritto a mano', () => {
    // Senza `didatticaId` il nome non è verificato: sul primo archivio vero
    // quattro brevetti diversi avevano tutti e quattro il nome del subacqueo.
    const scrittoAMano: Certification = {
      id: 'x',
      agency: 'PADI',
      name: 'Matteo Ferrando',
      level: 'deep',
    };
    expect(etichettaBrevetto(scrittoAMano)).toBe('PADI Profondo (fino a 40 m)');
  });

  it('la qualifica più alta è un’altra domanda dalla profondità', () => {
    const suoi = [
      dal('padi', 'PADI', 'Open Water Diver'),
      dal('padi', 'PADI', 'Rescue Diver', { ruolo: 'soccorso' }),
      dal('padi', 'PADI', 'Divemaster', { level: 'advanced', ruolo: 'guida' }),
    ];
    expect(ruoloPiuAlto(suoi)).toBe('guida');
    // Un istruttore che non ha il Profondo resta un istruttore senza il Profondo.
    expect(ruoloPiuAlto([dal('padi', 'PADI', 'Open Water Diver')])).toBeUndefined();
  });

  it('la profondità dichiarata è il massimo dichiarato, e può non esserci', () => {
    expect(
      profonditaDichiarata([
        dal('padi', 'PADI', 'Open Water Diver', { profonditaM: 18 }),
        dal('padi', 'PADI', 'Deep Diver', { level: 'deep', profonditaM: 40 }),
        dal('padi', 'PADI', 'Enriched Air Diver', { level: 'nitrox' }),
      ]),
    ).toBe(40);
    // Chi ha solo brevetti scritti a mano non ha nessun numero, e non se ne
    // inventa uno partendo dal livello.
    expect(profonditaDichiarata([{ id: 'x', agency: 'PADI', name: 'boh', level: 'deep' }])).toBeUndefined();
    expect(profonditaDichiarata([])).toBeUndefined();
  });

  it('la decompressione si dice solo se qualcuno la prevede', () => {
    expect(haDecompressione([dal('padi', 'PADI', 'Deep Diver', { level: 'deep' })])).toBe(false);
    expect(haDecompressione([dal('padi', 'PADI', 'Tec 45', { level: 'tech', decompressione: true })])).toBe(
      true,
    );
  });
});
