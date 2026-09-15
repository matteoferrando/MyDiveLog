/**
 * ANDARE A UNA SCHEDA, QUALUNQUE SIA LA LARGHEZZA DELLA FINESTRA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE QUESTO FILE, dal 15 settembre 2026. ◄
 *
 * La stessa funzione stava scritta CINQUE volte — in `screenshot.mjs`,
 * `misura-scroll.mjs`, `misura-larghezza.mjs`, `immagini-play.mjs` e
 * `schermate-bluetooth.mjs` — e in tre di quelle copie il commento diceva
 * «copiata da screenshot.mjs». Finché la navigazione del telefono è stata un
 * hamburger è andata bene. Il giorno in cui è diventata una barra in basso, le
 * cinque copie sono diventate cinque script rotti, ognuno da trovare e da
 * correggere a mano: *cinque copie della stessa regola sono una regola e
 * quattro sue versioni vecchie.*
 *
 * ► LA LEZIONE CHE QUESTA FUNZIONE PORTA CON SÉ, e che non va persa. ◄
 *
 * **Un clic che non trova il pulsante deve ROMPERE, non tacere.** I cicli che
 * facevano `click('button:has-text("Statistiche")')` con un `.catch(() => {})`
 * in coda continuavano a girare misurando sempre la stessa pagina, e
 * dichiaravano otto schede pulite dopo averne guardata una. Qui non c'è nessun
 * `catch` attorno ai clic: se la destinazione non c'è, lo script muore, ed è
 * l'unico esito onesto.
 *
 * ► LE TRE STRADE. ◄ Sopra i 700 px c'è la striscia in alto e si clicca lì.
 * Sotto, c'è la barra in basso: quattro destinazioni ci stanno dentro, le altre
 * vivono nel foglio «Altro», che va aperto. Quale scheda stia dove non è scritto
 * qui — si guarda la barra e si vede: così questo file non ha una seconda copia
 * di `BARRA` da tenere allineata, che sarebbe lo stesso difetto di prima
 * spostato di un metro.
 */

/**
 * @param page      la pagina Playwright
 * @param tab       l'etichetta della scheda, come si legge a schermo
 * @param attesa    millisecondi da aspettare dopo l'arrivo (le pagine pigre
 *                  arrivano in tempi diversi; chi misura ha bisogno di più
 *                  respiro di chi fotografa)
 */
export async function vaiA(page, tab, attesa = 500) {
  const barra = page.locator('.barra-basso');
  if (await barra.isVisible().catch(() => false)) {
    const inBarra = barra.locator(`.voce:has-text("${tab}")`).first();
    if (await inBarra.count()) {
      await inBarra.click();
    } else {
      await page.locator('.voce-altro').click();
      await page.waitForTimeout(250);
      await page.locator(`.foglio-gruppo button:has-text("${tab}")`).first().click();
    }
  } else {
    await page.locator(`.nav button:has-text("${tab}")`).first().click();
  }
  await page.waitForTimeout(attesa);
}

/**
 * LE ETICHETTE DI TUTTE LE SCHEDE, lette dall'applicazione invece che copiate.
 *
 * ► PERCHÉ. ◄ `misura-scroll.mjs` e `misura-larghezza.mjs` avevano ciascuno il
 * suo elenco scritto a mano, e il 15 settembre 2026 si è visto perché è una
 * cattiva idea: nata «Il tuo profilo», i due elenchi sono rimasti a otto voci e
 * la pagina nuova **non è stata misurata da nessuno dei due**. Non un errore,
 * non una riga rossa: semplicemente una pagina che non compariva nel resoconto,
 * e un resoconto che sembrava completo.
 *
 * La striscia in alto è nel DOM a qualunque larghezza — sotto i 700 px il CSS
 * la nasconde, non la toglie — quindi è la copia viva della tabella delle
 * schede, e si può leggere da lì anche misurando un telefono.
 *
 * Se un giorno il selettore non trova più niente, questa funzione ROMPE: un
 * elenco vuoto farebbe girare i cicli a zero giri e stampare un resoconto senza
 * nemmeno una riga di errore, che è il modo peggiore di sbagliare.
 */
export async function schede(page) {
  const voci = await page.evaluate(() =>
    [...document.querySelectorAll('.nav button')].map((b) => b.textContent.trim()),
  );
  if (voci.length < 5) {
    throw new Error(`la striscia di navigazione ha ${voci.length} voci: il DOM è cambiato`);
  }
  return voci;
}
