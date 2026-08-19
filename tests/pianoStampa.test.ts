/**
 * Il foglio del piano da stampare.
 *
 * Si prova come stringa, che è tutto il motivo per cui `pianoHtml` è una
 * funzione pura: l'impaginazione vera la decide il sistema al momento della
 * stampa, e non si può verificare da qui. Quello che si può verificare — e che
 * conta — è che il documento contenga i numeri giusti, che le soste
 * obbligatorie siano marcate, e che niente di quello che l'utente ha scritto
 * possa uscire dal testo ed essere eseguito dalla finestra che apriamo.
 */

import { describe, expect, it } from 'vitest';
import { pianoHtml, type FoglioPiano } from '../src/core/export/planPrint';

const base: FoglioPiano = {
  titolo: 'Piano 30 m · 25 min di fondo · EAN32',
  sottotitolo: 'Ricreativo, Bühlmann ZH-L16C GF 40/85.',
  now: '2026-08-19T10:00:00Z',
  sezioni: [
    {
      titolo: 'Il piano',
      righe: [
        ['Profondità massima', '30 m'],
        ['Tempo di fondo', '25 min'],
      ],
    },
    {
      titolo: 'Run time schedule',
      colonne: ['Min', 'Quota', 'Azione', 'Durata'],
      numeriche: [0, 3],
      righe: [
        ['25', '30 m', 'fondo', '25 min'],
        ['28', '30 → 6 m', 'risalita', '2.4 min'],
        ['34', '6 m', 'SOSTA', '6 min'],
      ],
      forti: [2],
    },
  ],
};

describe('foglio del piano', () => {
  it('contiene i numeri e le intestazioni', () => {
    const html = pianoHtml(base);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Piano 30 m');
    expect(html).toContain('Run time schedule');
    expect(html).toContain('>25 min<');
    expect(html).toContain('SOSTA');
  });

  it('marca le soste obbligatorie, perché su carta la differenza deve vedersi', () => {
    /*
     * Non è una scelta grafica: fra «sosta di sicurezza» e «obbligo
     * decompressivo» passa la differenza fra una cosa che puoi saltare e una
     * che non puoi. In barca, con le mani bagnate, quella differenza va vista
     * senza doverla leggere.
     */
    const html = pianoHtml(base);
    expect(html).toMatch(/<tr class="forte">.*SOSTA/s);
    // E il fondo delle righe forti deve sopravvivere alla stampa: i browser
    // tolgono gli sfondi «per risparmiare inchiostro» se non glielo si vieta.
    expect(html).toContain('print-color-adjust: exact');
  });

  it('le colonne numeriche vanno a destra, in entrambe le righe e le intestazioni', () => {
    const html = pianoHtml(base);
    expect(html).toContain('<th class="num">Min</th>');
    expect(html).toContain('<td class="num">25</td>');
  });

  it('le sezioni vuote non lasciano un titolo senza tabella', () => {
    const html = pianoHtml({ ...base, sezioni: [...base.sezioni, { titolo: 'Vuota', righe: [] }] });
    expect(html).not.toContain('Vuota');
  });

  it('il testo scritto a mano viene STAMPATO, non eseguito', () => {
    /*
     * Le note di un piano sono testo libero, e un piano può arrivare da un
     * archivio importato da qualcun altro. La finestra che apriamo esegue il
     * documento che le passiamo: qui dentro non deve poterci entrare niente
     * che non sia testo.
     */
    const html = pianoHtml({
      ...base,
      titolo: '<script>alert(1)</script>',
      note: 'occhio alla corrente <img src=x onerror=alert(1)>',
      avvisi: [{ livello: 'critical', testo: '</li><script>alert(2)</script>' }],
    });
    expect(html).not.toContain('<script>alert');
    // Il tag è diventato testo: resta leggibile e non è più un tag.
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('la data di generazione si vede a schermo e sparisce in stampa', () => {
    const html = pianoHtml(base);
    expect(html).toContain('nostampa');
    expect(html.slice(html.indexOf('@media print'))).toContain('.nostampa { display: none');
  });

  it('senza data non si inventa un orologio', () => {
    // La funzione è pura: se chi chiama non passa l'istante, il foglio non lo
    // dichiara. Una data sbagliata su un piano stampato è peggio di nessuna data.
    const html = pianoHtml({ ...base, now: undefined });
    expect(html).not.toContain('Generato il');
  });
});
