// @vitest-environment jsdom
/**
 * DUE PROFONDITÀ DIVERSE SULLA STESSA RIGA SI LEGGONO COME UN ERRORE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO, visto il 16 settembre 2026 aggiungendo la FIAS. ◄
 *
 * La scheda che compare sotto la tendina dei brevetti diceva:
 *
 *     Primo livello (fino a 18 m) · 20 m
 *     Profondità dichiarata da FIAS.
 *
 * Sono due fatti veri: 18 m è il tipico dello scalino «primo livello», 20 è
 * quello che FIAS dichiara per il suo corso Base. Messi uno accanto all'altro
 * senza spiegazione sembrano però una contraddizione dell'applicazione, e chi
 * legge non sa a quale dei due credere — che è peggio di non vederne nessuno.
 *
 * Non riguardava solo la FIAS: CMAS One Star dichiara 20 sotto un «fino a 18»,
 * FIPSAS 3° Grado dichiara 42 sotto un «fino a 40». Era lì da sempre, e si è
 * visto solo mettendo una didattica nuova davanti agli occhi.
 *
 * ► LA PROPRIETÀ, e perché vale per tutto il catalogo. ◄ Quando la didattica
 * dichiara la profondità, quella riga deve contenere **un numero di metri
 * solo**: il suo. Quando non la dichiara, il tipico dello scalino resta l'unica
 * indicazione che c'è e va lasciato. Questa prova non guarda la FIAS: le
 * attraversa tutte, perché la prossima didattica che qualcuno aggiunge non
 * avrà nessuno che guardi la sua scheda.
 */

import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { DIDATTICHE, didatticaPerSigla, brevettoPerNome } from '../src/core/analysis/didattiche';
import { FattiDelBrevetto } from '../src/ui/components/Brevetti';

function testo(nodo: React.ReactNode): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const radice = createRoot(host);
  act(() => radice.render(nodo));
  const letto = host.textContent ?? '';
  act(() => radice.unmount());
  host.remove();
  return letto;
}

/**
 * Quante volte compare «<numero> m» in una riga.
 *
 * Niente `\b` dopo la «m»: il testo di due nodi vicini arriva incollato —
 * «12 mProfondità dichiarata da PADI» — e il confine di parola lì non c'è.
 * Serve invece escludere le lettere minuscole, per non contare «45 min».
 */
function quantiMetri(riga: string): string[] {
  return [...riga.matchAll(/\d+\s*m(?![a-zà-ù])/g)].map((m) => m[0].trim());
}

describe('la scheda dei fatti di un brevetto', () => {
  it('con la profondità dichiarata mostra QUELLA, e nessun’altra', () => {
    const fias = didatticaPerSigla('FIAS')!;
    const base = brevettoPerNome(fias, 'Base')!;
    const riga = testo(<FattiDelBrevetto voce={base} didattica={fias} />);

    expect(riga).toContain('20 m');
    expect(riga, 'il tipico dello scalino non deve contraddire la didattica').not.toContain('18 m');
    expect(riga, 'lo scalino si legge ancora, senza il suo numero').toContain('Primo livello');
    expect(riga).toContain('FIAS');
  });

  it('senza profondità dichiarata resta il tipico dello scalino, che è l’unica indicazione', () => {
    const padi = didatticaPerSigla('PADI')!;
    const nitrox = brevettoPerNome(padi, 'Enriched Air Diver')!;
    const riga = testo(<FattiDelBrevetto voce={nitrox} didattica={padi} />);
    expect(riga).toContain('Nitrox');
    expect(riga, 'e la scheda dice che il silenzio è della didattica, non un difetto').toContain(
      'non dichiara una profondità',
    );
  });

  it('e in tutto il catalogo nessuna scheda mostra due profondità diverse', () => {
    let guardate = 0;
    for (const d of DIDATTICHE) {
      for (const b of d.brevetti) {
        const riga = testo(<FattiDelBrevetto voce={b} didattica={d} />);
        const metri = quantiMetri(riga);
        guardate += 1;
        if (b.profonditaM === undefined) {
          // Qui il tipico dello scalino è ammesso: è tutto quello che si ha.
          continue;
        }
        expect(metri, `${d.sigla} ${b.nome}: «${riga.trim().slice(0, 80)}»`).toEqual([`${b.profonditaM} m`]);
      }
    }
    // Una prova che non guarda niente è verde per sempre.
    expect(guardate, 'il catalogo è vuoto: qualcosa si è rotto nell’import').toBeGreaterThan(150);
  });
});
