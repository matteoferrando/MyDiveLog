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

  const text = await file.text();
  // Un file rinominato può nascondere un binario: controlliamo le firme comunque.
  if (text.slice(8, 12) === '.FIT' || text.startsWith('SQLite format 3')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return parseFile({ fileName: name, bytes }, t);
  }
  return parseFile({ fileName: name, text }, t);
}
