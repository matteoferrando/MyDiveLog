import type { Dive, SourceFormat } from '../model';
import type { Traduci } from '../traduci';

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
  /**
   * LA TRADUZIONE È UN PARAMETRO IN CODA, NON UN CAMPO DI `ParseInput`.
   *
   * `ParseInput` descrive il FILE: come si chiama e che byte contiene. È quello
   * che i test costruiscono a mano — ce ne sono decine — ed è l'oggetto che
   * viaggia dentro `detect`, dove una funzione di traduzione non ha niente da
   * fare. Metterla lì avrebbe voluto dire mescolare il contenuto con il modo di
   * raccontarlo, in una struttura che passa per il rilevamento del formato.
   *
   * In coda e opzionale non rompe nessun chiamante: `parse(input)` continua a
   * compilare e a rispondere in italiano, che è la chiave del dizionario.
   */
  parse(input: ParseInput, t?: Traduci): ParseResult;
}

export class ParseError extends Error {
  constructor(
    message: string,
    readonly fileName?: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}
