/**
 * La guardia sulle firme dell'aggiornatore, vista rossa.
 *
 * ► PERCHÉ NON BASTA AVERLA VISTA VERDE SUL RILASCIO VERO. ◄ Lanciata sulla
 * 1.8.20 pubblicata, `npm run aggiornamento:verifica` ha detto di sì. Una
 * guardia che dice di sì non ha ancora dimostrato niente: *dice di sì anche una
 * funzione che torna `true` e basta.* Quello che va dimostrato è che dice di NO
 * nei modi in cui si sbaglia davvero — e quei modi qui si costruiscono uno per
 * uno, con una coppia di chiavi fabbricata sul momento, senza che la chiave
 * privata vera entri mai in una prova.
 *
 * I quattro modi, tutti visti accadere in progetti che firmano i propri
 * aggiornamenti:
 *
 * 1. **il pacchetto è cambiato dopo la firma** — ricostruito, ricompresso,
 *    ricaricato: un byte diverso e la firma non vale più;
 * 2. **è stata usata un'altra chiave** — quella di prova invece di quella di
 *    rilascio, ed è l'errore che passa più facilmente inosservato perché il file
 *    di firma è formalmente perfetto;
 * 3. **il commento fidato è stato riscritto** — è testo, chiunque può toccarlo,
 *    ed è coperto dalla firma globale proprio per questo;
 * 4. **la firma è di un altro file** — crittograficamente ineccepibile, e
 *    sbagliata lo stesso: la prende il confronto fra il nome dentro il commento
 *    e quello nell'indirizzo del manifesto.
 */

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { fileNelCommento, leggiFirma, verificaFirma } from '../scripts/lib/minisign';

/** Otto byte qualunque: nel formato sono l'identificativo della chiave. */
const IDENTIFICATIVO = Buffer.from('0102030405060708', 'hex');

/** Fabbrica una coppia di chiavi e i due file nel formato di minisign. */
function coppia(identificativo: Buffer = IDENTIFICATIVO) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const grezza = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  const fileChiave = [
    'untrusted comment: minisign public key: PROVA',
    Buffer.concat([Buffer.from('Ed'), identificativo, grezza]).toString('base64'),
    '',
  ].join('\n');
  return { privateKey, identificativo, pubkey: Buffer.from(fileChiave).toString('base64') };
}

/**
 * Firma `contenuto` e ne scrive il file di firma. `sigla` sceglie la modalità:
 * `ED` firma il BLAKE2b-512 del contenuto (quella di Tauri), `Ed` il contenuto.
 */
function firma(
  chiavi: ReturnType<typeof coppia>,
  contenuto: Buffer,
  commentoFidato = 'timestamp:1789430143\tfile:MyDiveLog.app.tar.gz',
  sigla: 'ED' | 'Ed' = 'ED',
) {
  const messaggio = sigla === 'ED' ? createHash('blake2b512').update(contenuto).digest() : contenuto;
  const f = sign(null, messaggio, chiavi.privateKey);
  const globale = sign(null, Buffer.concat([f, Buffer.from(commentoFidato, 'utf8')]), chiavi.privateKey);
  const file = [
    'untrusted comment: signature from tauri secret key',
    Buffer.concat([Buffer.from(sigla), chiavi.identificativo, f]).toString('base64'),
    `trusted comment: ${commentoFidato}`,
    globale.toString('base64'),
    '',
  ].join('\n');
  return Buffer.from(file).toString('base64');
}

const PACCHETTO = Buffer.from('un pacchetto di aggiornamento, per finta ma lungo abbastanza');

describe('la firma dell’aggiornatore', () => {
  it('dice di sì quando la firma è quella del file, in modalità ED come Tauri', () => {
    const c = coppia();
    const esito = verificaFirma({ pubkey: c.pubkey, firma: firma(c, PACCHETTO), contenuto: PACCHETTO });
    expect(esito.valido).toBe(true);
    expect(esito.sigla).toBe('ED');
  });

  it('dice di sì anche in modalità Ed, che è l’altra che il formato prevede', () => {
    const c = coppia();
    const f = firma(c, PACCHETTO, 'timestamp:1\tfile:x.tar.gz', 'Ed');
    expect(verificaFirma({ pubkey: c.pubkey, firma: f, contenuto: PACCHETTO }).valido).toBe(true);
  });

  it('dice di no se il pacchetto è cambiato di un byte dopo la firma', () => {
    const c = coppia();
    const f = firma(c, PACCHETTO);
    const rifatto = Buffer.from(PACCHETTO);
    rifatto[3] = (rifatto[3] ?? 0) ^ 1;
    const esito = verificaFirma({ pubkey: c.pubkey, firma: f, contenuto: rifatto });
    expect(esito.valido).toBe(false);
    expect(esito.motivo).toContain('non corrisponde al contenuto');
  });

  it('dice di no, e dice quale, se la firma viene da un’altra chiave', () => {
    const rilascio = coppia();
    const prova = coppia(Buffer.from('aabbccddeeff0011', 'hex'));
    const esito = verificaFirma({
      pubkey: rilascio.pubkey,
      firma: firma(prova, PACCHETTO),
      contenuto: PACCHETTO,
    });
    expect(esito.valido).toBe(false);
    expect(esito.motivo).toContain('aabbccddeeff0011');
    expect(esito.motivo).toContain('0102030405060708');
  });

  it('dice di no se il commento fidato è stato riscritto dopo la firma', () => {
    const c = coppia();
    const originale = Buffer.from(firma(c, PACCHETTO), 'base64').toString('utf8');
    const manomesso = originale.replace('MyDiveLog.app.tar.gz', 'MyDiveLog-altro.tar.gz');
    expect(manomesso).not.toBe(originale);
    const esito = verificaFirma({
      pubkey: c.pubkey,
      firma: Buffer.from(manomesso).toString('base64'),
      contenuto: PACCHETTO,
    });
    expect(esito.valido).toBe(false);
    expect(esito.motivo).toContain('firma globale');
  });

  it('dà da confrontare il nome del file firmato, che è l’unico modo di prendere la firma giusta del pacchetto sbagliato', () => {
    const c = coppia();
    const f = firma(c, PACCHETTO, 'timestamp:1789430143\tfile:MyDiveLog-Windows-setup.nsis.zip');
    const esito = verificaFirma({ pubkey: c.pubkey, firma: f, contenuto: PACCHETTO });
    expect(esito.valido).toBe(true);
    expect(fileNelCommento(esito.commentoFidato)).toBe('MyDiveLog-Windows-setup.nsis.zip');
    // È questo confronto che lo script fa contro il nome nell'indirizzo.
    expect(fileNelCommento(esito.commentoFidato)).not.toBe('MyDiveLog.app.tar.gz');
  });

  it('rifiuta una sigla di algoritmo che non conosce invece di fidarsi', () => {
    const c = coppia();
    const originale = Buffer.from(firma(c, PACCHETTO), 'base64').toString('utf8').split('\n');
    const blob = Buffer.from(originale[1] ?? '', 'base64');
    Buffer.from('ZZ').copy(blob, 0);
    originale[1] = blob.toString('base64');
    const esito = verificaFirma({
      pubkey: c.pubkey,
      firma: Buffer.from(originale.join('\n')).toString('base64'),
      contenuto: PACCHETTO,
    });
    expect(esito.valido).toBe(false);
    expect(esito.motivo).toContain('sconosciuta');
  });

  it('non prova nemmeno a leggere una firma della lunghezza sbagliata', () => {
    const corta = Buffer.from(
      ['untrusted comment: x', Buffer.alloc(20).toString('base64'), ''].join('\n'),
    ).toString('base64');
    expect(() => leggiFirma(corta)).toThrow(/20 byte/);
  });
});
