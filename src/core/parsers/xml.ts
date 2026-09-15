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

/** "6.0 kg" → 6 · "13 lbs" → 5.9 */
export function weightValue(raw: string | undefined): number | undefined {
  const v = valueWithUnit(raw);
  if (!v) return undefined;
  return v.unit === 'lbs' || v.unit === 'lb' ? v.value * 0.45359237 : v.value;
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

/**
 * LEGGE UN XML CHE POTREBBE ESSERE TRONCATO, E SALVA QUELLO CHE C'È.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE CHIUDE, misurato il 15 settembre 2026. ◄
 *
 * `parseXml` non era dentro nessun `try` in nessuno dei tre lettori XML. Un
 * file interrotto a metà — un download finito male, una chiavetta staccata
 * durante l'export, uno spazio esaurito — faceva due cose, tutte e due brutte.
 *
 * **Perdeva tutto.** Un UDDF Shearwater da 1.2 MB con diciotto immersioni,
 * tagliato al 60%, ne aveva diciassette leggibili per intero. Ne arrivavano
 * zero.
 *
 * **E lo diceva in inglese, con parole che non significano niente per chi
 * legge.** La stringa che finiva a schermo accanto al nome del file, misurata:
 * `readTagExp returned undefined at position 742510. Context: "<tankpressure>…`.
 * È esattamente il difetto che `core/ble/causaGuasto.ts` è nato per chiudere
 * sul Bluetooth, e che `shearwaterCloud.ts` evita correttamente con
 * `conDettaglio`: qui i tre lettori XML erano rimasti indietro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COME SALVA. Taglia al termine dell'ultimo elemento ripetuto chiuso bene — la
 * `</dive>` o la `</diveLog>` — e poi richiude a mano i tag rimasti aperti
 * sopra di lui. Quello che ne esce è un documento valido che contiene tutte le
 * immersioni complete e nessuna di quelle mozze: cioè esattamente il
 * sottoinsieme di cui ci si può fidare.
 *
 * Chi chiama riceve `tagliato: true` e deve dirlo: un import che perde tre
 * immersioni su venti senza avvisare è peggio di uno che ne perde venti,
 * perché non si nota.
 */
export function parseXmlSalvando(
  text: string,
  elementoRipetuto: string,
): { root: Record<string, unknown>; tagliato: boolean } {
  try {
    const root = parseXml(text);
    /*
     * ► UN XML CHE SI LEGGE NON È PER FORZA UN XML INTERO. ◄
     *
     * fast-xml-parser è tollerante: su un taglio che cade in un punto fortunato
     * — fra due elementi, invece che a metà di un tag — non si lamenta e
     * restituisce quello che ha letto. Misurato: lo stesso UDDF tagliato al 60%
     * lanciava un'eccezione, tagliato al 30% passava liscio consegnando sei
     * immersioni su diciotto **senza un avviso**.
     *
     * Il segno che resta è la fine del documento: un XML completo finisce con
     * la chiusura del suo elemento radice. Se non c'è, il file finisce prima di
     * finire, e chi importa deve saperlo — *un buco dichiarato è pur sempre un
     * buco, ma un buco taciuto non si può nemmeno cercare.*
     */
    return { root, tagliato: !chiudeLaRadice(text) };
  } catch (primo) {
    const salvato = tagliaAllUltimo(text, elementoRipetuto);
    if (salvato !== undefined) {
      try {
        return { root: parseXml(salvato), tagliato: true };
      } catch {
        /* il salvataggio non ha funzionato: si ricade sull'errore originale */
      }
    }
    throw primo;
  }
}

/**
 * Taglia il testo dopo l'ultima chiusura di `<elemento>` e richiude i tag
 * rimasti aperti sopra, dal più interno al più esterno.
 *
 * Restituisce `undefined` quando non c'è nemmeno un elemento chiuso bene: lì
 * non c'è niente da salvare e conviene dirlo invece di consegnare un documento
 * vuoto che sembra un archivio senza immersioni.
 */
function tagliaAllUltimo(text: string, elemento: string): string | undefined {
  const chiusura = new RegExp(`</\\s*${elemento}\\s*>`, 'gi');
  let fine = -1;
  for (let m = chiusura.exec(text); m; m = chiusura.exec(text)) fine = m.index + m[0].length;
  if (fine < 0) return undefined;
  const testa = text.slice(0, fine);

  /*
   * I tag ancora aperti, con una pila. Si saltano commenti, CDATA, istruzioni
   * di elaborazione e DOCTYPE: dentro un commento può esserci di tutto, e un
   * `<dive>` commentato non è un tag aperto.
   */
  const pila: string[] = [];
  const token =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?([A-Za-z_][\w.:-]*)([^>]*)>/g;
  for (let m = token.exec(testa); m; m = token.exec(testa)) {
    const nome = m[1];
    if (!nome) continue; // commento, CDATA, istruzione, DOCTYPE
    if (m[0].startsWith('</')) {
      // Chiude il corrispondente più vicino: un documento malformato in mezzo
      // non deve far esplodere il salvataggio.
      const i = pila.lastIndexOf(nome);
      if (i >= 0) pila.length = i;
    } else if (!m[2].trimEnd().endsWith('/')) {
      pila.push(nome);
    }
  }
  return (
    testa +
    pila
      .reverse()
      .map((n) => `</${n}>`)
      .join('')
  );
}

/** Il testo finisce con la chiusura del suo elemento radice? */
function chiudeLaRadice(text: string): boolean {
  const apertura = /<([A-Za-z_][\w.:-]*)/.exec(
    text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, ''),
  );
  if (!apertura) return false;
  return new RegExp(`</\\s*${apertura[1]}\\s*>\\s*$`).test(text.trimEnd());
}
