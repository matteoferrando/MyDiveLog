/**
 * Ritaglia UN lavoro dal workflow, e si ferma al lavoro dopo.
 *
 * ► PERCHÉ ESISTE, E PERCHÉ È UN FILE A PARTE. ◄ Questo ritaglio è stato
 * sbagliato **tre volte in due giorni**, ogni volta in modo diverso e ogni volta
 * con lo stesso effetto: una prova che gira su un pezzo di YAML che non è quello
 * che credeva.
 *
 * 1. Cercando `- name: Raccogli` nel file intero si trovava quello di
 *    **Windows**, che sta prima: la prova sull'`.aab` girava su un lavoro che
 *    con Android non c'entra niente, ed era verde per il motivo sbagliato.
 * 2. Corretto ritagliando da `\n  android:\n` **fino a fine file** — che è
 *    andato bene finché Android era l'ultimo lavoro. Il giorno che è entrato
 *    `linux` in coda, il ritaglio se l'è portato dentro e la conta dei passi
 *    «Raccogli» è passata da due a tre. **Rosso in CI, ed è il modo giusto di
 *    scoprirlo.**
 * 3. Da qui in poi il ritaglio finisce al lavoro successivo, e la funzione sta
 *    in un posto solo: *una regola scritta due volte è una regola che diverge
 *    alla prima correzione.*
 *
 * Un lavoro comincia con due spazi, il nome, i due punti e un a capo. Il
 * successivo si riconosce allo stesso modo — ed è la sola cosa stabile in un
 * file YAML pieno di blocchi indentati in ogni modo.
 */

/**
 * ► IL RITAGLIO ARRIVA ALLA RIGA DEL LAVORO DOPO, COMMENTO COMPRESO. ◄
 *
 * In YAML i commenti che introducono un lavoro stanno **prima** della sua riga
 * `nome:`, quindi finiscono nel ritaglio di quello precedente. Non è un difetto
 * ed è inutile provare a rimediarlo — un commento non ha un proprietario — ma va
 * saputo: **una prova non deve cercare parole che possono comparire in un
 * commento**. Per dire «il ritaglio si è fermato dove doveva» si guarda la riga
 * del lavoro successivo, che è l'unica cosa che il ritaglio non può contenere.
 *
 * Il testo del solo lavoro `nome`, dalla sua riga fino a quella del lavoro dopo.
 */
export function lavoro(workflow: string, nome: string): string {
  const inizio = workflow.indexOf(`\n  ${nome}:\n`);
  if (inizio < 0) throw new Error(`il lavoro \`${nome}:\` non c’è nel workflow`);
  const dopo = workflow.slice(inizio + 1);
  // Il prossimo lavoro: due spazi, un nome, i due punti, a capo. Il `m` serve
  // perché si cerca a inizio riga, e il `^` senza di lui varrebbe solo per la
  // prima del testo.
  const prossimo = /^ {2}[a-z][a-z0-9_-]*:\n/m.exec(dopo.slice(1));
  return prossimo ? dopo.slice(0, prossimo.index + 1) : dopo;
}
