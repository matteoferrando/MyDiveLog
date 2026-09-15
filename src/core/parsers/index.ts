/**
 * Rilevamento del formato e dispatch verso il parser giusto.
 *
 * L'ordine di rilevamento conta: Shearwater XML e UDDF hanno entrambi
 * estensione `.xml`, quindi il riconoscimento è sul CONTENUTO (la radice
 * `<uddf>` o `<diveLog>`), non sul nome del file. Il CSV è per ultimo perché
 * è il più permissivo e va provato solo se nient'altro corrisponde.
 */

import { csvParser } from './csv';
import { garminFitParser, parseFit } from './garminFit';
import { logtrakParser } from './logtrak';
import { shearwaterParser } from './shearwater';
import { shearwaterCloudParser } from './shearwaterCloud';
import { subsurfaceParser } from './subsurface';
import { uddfParser } from './uddf';
import { comeSta, type Traduci } from '../traduci';
import { ParseError, type DiveParser, type ParseInput, type ParseResult } from './types';

export const PARSERS: DiveParser[] = [
  uddfParser,
  subsurfaceParser,
  shearwaterParser,
  garminFitParser,
  shearwaterCloudParser,
  logtrakParser,
  csvParser,
];

export { ParseError };
export type { DiveParser, ParseInput, ParseResult };
export type { Traduci };

/** Estensioni accettate dal selettore di file. */
export const ACCEPTED_EXTENSIONS = [...new Set(PARSERS.flatMap((p) => p.extensions))].sort();

export function detectParser(input: ParseInput): DiveParser | undefined {
  return PARSERS.find((p) => {
    try {
      return p.detect(input);
    } catch {
      return false;
    }
  });
}

/**
 * Legge un file e restituisce le immersioni nel modello canonico.
 *
 * LA TRADUZIONE È L'ULTIMO PARAMETRO, OPZIONALE. Le alternative erano metterla
 * dentro `ParseInput` o farne un oggetto di opzioni nuovo: la prima mescola il
 * contenuto del file con il modo di raccontarlo (vedi `types.ts`), la seconda
 * costringe a toccare ogni chiamata esistente. Così non se ne rompe nessuna —
 * `parseFile(input)` continua a compilare e risponde in italiano, che è la
 * chiave del dizionario — e chi la traduzione ce l'ha la passa in coda.
 */
export async function parseFile(input: ParseInput, t: Traduci = comeSta): Promise<ParseResult> {
  const parser = detectParser(input);
  if (!parser) {
    throw new ParseError(
      `${t('Formato non riconosciuto. Formati supportati:')} ${PARSERS.map((p) => p.label).join(', ')}.`,
      input.fileName,
    );
  }
  if (parser.format === 'garmin-fit') return parseFit(input, t);
  return parser.parse(input, t);
}

/** Legge un `File` del browser, scegliendo testo o binario in base al formato. */
export async function parseBrowserFile(file: File, t: Traduci = comeSta): Promise<ParseResult> {
  const name = file.name;
  const lower = name.toLowerCase();
  const isBinary =
    lower.endsWith('.fit') ||
    lower.endsWith('.db') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.sqlite3');

  if (isBinary) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return parseFile({ fileName: name, bytes }, t);
  }

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ► LE FIRME BINARIE SI GUARDANO SUI BYTE, NON SUL TESTO. ◄
   *
   * Qui c'era `text.slice(8, 12) === '.FIT'` — cioè la firma cercata dentro
   * una stringa ottenuta decodificando byte binari come UTF-8. Gli indici di
   * CARATTERE non corrispondono agli indici di BYTE: basta che nei primi otto
   * byte ci sia una coppia che in UTF-8 vale un carattere solo, e la firma si
   * sposta.
   *
   * Misurato il 15 settembre 2026 su un FIT il cui campo `dataSize` (byte 4..7)
   * conteneva `C3 A9`, che in UTF-8 sono un carattere: i byte 8..11 erano
   * `.FIT`, ma `testo.slice(8,12)` dava `FIT͞` e `slice(7,11)` dava `.FIT`. Lo
   * stesso file, rinominato `.fit`, si leggeva senza problemi; senza
   * estensione, «formato non riconosciuto». Il controllo funzionava solo finché
   * i primi otto byte erano UTF-8 «neutri», cioè per caso.
   */
  const testa = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const firma = (da: number, a: number) =>
    String.fromCharCode(...testa.subarray(da, a));
  if (firma(8, 12) === '.FIT' || firma(0, 15) === 'SQLite format 3') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return parseFile({ fileName: name, bytes }, t);
  }
  const text = await file.text();
  return parseFile({ fileName: name, text }, t);
}
