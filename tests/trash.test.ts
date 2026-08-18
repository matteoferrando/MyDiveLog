/**
 * Il cestino, e la sola cosa che conta davvero: che la lapide NON nasca troppo
 * presto.
 *
 * Le lapidi della sincronizzazione sono irrevocabili per costruzione — una volta
 * che l'altro dispositivo ha applicato la cancellazione, non c'è modo onesto di
 * tornare indietro. Tutto il cestino esiste per rimandare quel momento, quindi il
 * test che vale è quello che verifica che fra «premo elimina» e «nasce la lapide»
 * ci siano trenta giorni o una decisione esplicita.
 */

import { describe, expect, it } from 'vitest';
import type { Dive } from '../src/core/model';
import {
  TRASH_DAYS,
  daysLeft,
  expired,
  partitionTrash,
  sortTrash,
  trashedIds,
  type TrashedDive,
} from '../src/storage/trash';

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-18T12:00:00Z');

const dive = (id: string): Dive => ({
  id,
  startTime: '2026-06-01T09:00:00Z',
  durationS: 2400,
  maxDepth: 30,
  cylinders: [{ mix: { o2: 0.21, he: 0 } }],
  source: { format: 'uddf', file: 't', importedAt: '2026-06-01T09:00:00Z' },
  mode: 'oc',
  tags: [],
});

const trashed = (id: string, daysAgo: number): TrashedDive => ({
  dive: dive(id),
  at: new Date(NOW - daysAgo * DAY).toISOString(),
});

describe('scadenza del cestino', () => {
  it('appena cancellata restano tutti i giorni', () => {
    expect(daysLeft(trashed('a', 0), NOW)).toBe(TRASH_DAYS);
    expect(expired(trashed('a', 0), NOW)).toBe(false);
  });

  it('il giorno prima della scadenza è ancora recuperabile', () => {
    expect(expired(trashed('a', TRASH_DAYS - 1), NOW)).toBe(false);
    expect(daysLeft(trashed('a', TRASH_DAYS - 1), NOW)).toBe(1);
  });

  it('al trentesimo giorno diventa definitiva, non prima', () => {
    expect(expired(trashed('a', TRASH_DAYS), NOW)).toBe(true);
    expect(daysLeft(trashed('a', TRASH_DAYS + 5), NOW)).toBe(0);
  });

  it('separa quello che resta da quello che scade', () => {
    const { keep, purge } = partitionTrash(
      [trashed('recente', 2), trashed('vecchia', 40), trashed('appena', 0)],
      NOW,
    );
    expect(keep.map((t) => t.dive.id).sort()).toEqual(['appena', 'recente']);
    expect(purge.map((t) => t.dive.id)).toEqual(['vecchia']);
  });
});

describe('il cestino e la sincronizzazione', () => {
  it('gli identificativi nel cestino sono quelli da saltare in entrambi i versi', () => {
    // Se la sincronizzazione li saltasse solo in caricamento, il giorno dopo
    // l'immersione tornerebbe indietro dal remoto e il cestino sarebbe una finzione.
    const ids = trashedIds([trashed('a', 1), trashed('b', 2)]);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(false);
  });
});

describe('ordine', () => {
  it('il più recente per primo: nel cestino si cerca quello appena buttato', () => {
    const list = sortTrash([trashed('vecchia', 10), trashed('nuova', 1), trashed('media', 5)]);
    expect(list.map((t) => t.dive.id)).toEqual(['nuova', 'media', 'vecchia']);
  });
});
