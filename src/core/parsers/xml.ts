/**
 * Utilità comuni ai parser XML (UDDF, Subsurface, Shearwater).
 *
 * fast-xml-parser restituisce un oggetto in cui un elemento singolo è un
 * oggetto e lo stesso elemento ripetuto è un array. Ogni accesso richiederebbe
 * un controllo: `asArray` lo centralizza.
 */

import { XMLParser } from 'fast-xml-parser';

export const ATTR = '@_';

export function parseXml(text: string): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR,
    parseTagValue: false, // manteniamo le stringhe: "18.3 m" va interpretato, non troncato
    parseAttributeValue: false,
    trimValues: true,
    textNodeName: '#text',
    // I nomi dei tag UDDF sono minuscoli, quelli Shearwater camelCase: non normalizziamo.
  });
  return parser.parse(text) as Record<string, unknown>;
}

/** Un elemento che può essere assente, singolo o ripetuto → sempre array. */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Un nodo dell'albero è `unknown` per scelta: fast-xml-parser restituisce
 * stringhe, numeri, oggetti o array a seconda del documento, e fingere di
 * saperlo in anticipo porterebbe a un `as` a ogni accesso. Il restringimento
 * avviene qui dentro, una volta, nelle funzioni di lettura.
 */
export type XmlNode = unknown;

/** Testo di un nodo, sia che sia una stringa sia che sia `{ '#text': ... }`. */
export function text(node: XmlNode): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (typeof node === 'number') return String(node);
  const t = (node as Record<string, unknown>)['#text'];
  if (typeof t === 'string') return t.trim() || undefined;
  if (typeof t === 'number') return String(t);
  return undefined;
}

/** Numero da un nodo, tollerante a notazione scientifica ("1.4e5"). */
export function num(node: XmlNode): number | undefined {
  const t = text(node);
  if (t === undefined) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/** Attributo come stringa. */
export function attr(node: XmlNode, name: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const v = (node as Record<string, unknown>)[ATTR + name];
  if (v === undefined || v === null) return undefined;
  return String(v).trim() || undefined;
}

/** Attributo come numero. */
export function attrNum(node: XmlNode, name: string): number | undefined {
  const v = attr(node, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Primo attributo presente fra quelli elencati. */
export function attrAny(node: XmlNode, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = attr(node, n);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function attrNumAny(node: XmlNode, ...names: string[]): number | undefined {
  for (const n of names) {
    const v = attrNum(node, n);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Figlio di un nodo, indipendentemente da quanti se ne trovino. */
export function child(node: XmlNode, name: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  return (node as Record<string, unknown>)[name];
}

export function children<T = Record<string, unknown>>(node: XmlNode, name: string): T[] {
  return asArray(child(node, name) as T | T[] | undefined);
}

// ---------------------------------------------------------------------------
// Valori "numero + unità" nello stile Subsurface: "18.3 m", "200 bar", "9.0 C"
// ---------------------------------------------------------------------------

/**
 * Estrae il numero da una stringa con unità e lo converte se serve.
 * Subsurface scrive sempre in metrico, ma la stringa contiene l'unità: la
 * leggiamo comunque per non fidarci di quell'invariante.
 */
export function valueWithUnit(raw: string | undefined): { value: number; unit?: string } | undefined {
  if (!raw) return undefined;
  const m = /^\s*(-?[\d.]+(?:[eE][-+]?\d+)?)\s*([^\s\d]*)/.exec(raw);
  if (!m) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return undefined;
  return { value, unit: m[2] || undefined };
}

/** "18.3 m" → 18.3 · "60 ft" → 18.29 */
export function depthValue(raw: string | undefined): number | undefined {
  const v = valueWithUnit(raw);
  if (!v) return undefined;
  return v.unit === 'ft' ? v.value * 0.3048 : v.value;
}

/** "200 bar" → 200 · "3000 psi" → 206.8 */
export function pressureValue(raw: string | undefined): number | undefined {
  const v = valueWithUnit(raw);
  if (!v) return undefined;
  return v.unit === 'psi' ? v.value / 14.5037738007 : v.value;
}

/** "9.0 C" → 9 · "48 F" → 8.9 */
export function tempValue(raw: string | undefined): number | undefined {
  const v = valueWithUnit(raw);
  if (!v) return undefined;
  if (v.unit === 'F') return ((v.value - 32) * 5) / 9;
  if (v.unit === 'K') return v.value - 273.15;
  return v.value;
}

/**
 * Durate Subsurface: "14:30 min" (minuti:secondi), "45 min", "1:02:30".
 * Restituisce secondi.
 */
export function durationValue(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const clean = raw.replace(/\s*min\s*$/i, '').trim();
  const parts = clean.split(':');
  if (parts.length === 1) {
    const v = Number(parts[0]);
    // Senza due punti, "45 min" sono minuti; "45" nudo lo trattiamo come minuti.
    return Number.isFinite(v) ? Math.round(v * 60) : undefined;
  }
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}
