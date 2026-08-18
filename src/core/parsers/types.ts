import type { Dive, SourceFormat } from '../model';

export interface ParseInput {
  /** Nome del file, usato per tracciabilità e per il rilevamento formato. */
  fileName: string;
  /** Contenuto testuale, per i formati testuali. */
  text?: string;
  /** Contenuto binario, per FIT. */
  bytes?: Uint8Array;
}

export interface ParseResult {
  format: SourceFormat;
  dives: Dive[];
  /** Problemi non fatali: campi mancanti, immersioni scartate, unità ambigue. */
  warnings: string[];
}

export interface DiveParser {
  format: SourceFormat;
  /** Nome mostrato nella UI. */
  label: string;
  /** Estensioni tipiche, minuscole, con il punto. */
  extensions: string[];
  /** Vero se questo parser riconosce il contenuto. */
  detect(input: ParseInput): boolean;
  parse(input: ParseInput): ParseResult;
}

export class ParseError extends Error {
  constructor(message: string, readonly fileName?: string) {
    super(message);
    this.name = 'ParseError';
  }
}
