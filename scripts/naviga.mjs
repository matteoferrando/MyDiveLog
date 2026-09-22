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

/**
 * PORTARE IN CIMA ALLA FINESTRA IL TITOLO CHE DÀ IL NOME A UNA SCHERMATA.
 *
 * Serve alle fotografie dei negozi: **la prima schermata di una scheda non deve
 * essere l'intestazione**. Senza, la fotografia del Logbook mostrava due
 * riquadri di benvenuto e tre tendine di filtro, e l'elenco delle immersioni —
 * cioè la cosa che il programma fa — restava sotto il bordo. Una fotografia che
 * non mostra il contenuto non è sbagliata: è inutile, che è peggio, perché non
 * se ne accorge nessuno.
 *
 * ► PERCHÉ STA QUI, dal 22 settembre 2026. ◄ Era scritta dentro
 * `immagini-play.mjs`, e le schermate per l'App Store ne avevano bisogno
 * identica. Una seconda copia della stessa funzione è il primo passo della
 * storia raccontata in cima a questo file.
 *
 * ► E PERCHÉ ADESSO ROMPE. ◄ La copia di Play, se il titolo non c'era, tornava
 * senza dire niente: la fotografia successiva usciva uguale a quella di prima,
 * e nella scheda del negozio finivano due schermate identiche con due nomi
 * diversi. È la lezione di `vaiA` applicata a uno scorrimento invece che a un
 * clic — *un titolo che non si trova deve rompere, non tacere*. Il testo si
 * confronta intero: in inglese si passa la traduzione, non l'italiano.
 *
 * ► E IL PRIMO GIRO HA ROTTO, sul primo telefono. ◄ Sotto i 700 px le carte
 * della scheda che si aprono e si chiudono (`CartaApribile`) non hanno un
 * `h2`: il titolo è il testo del pulsante, `.apri-sezione-titolo`. La copia
 * vecchia cercava solo `h1, h2, h3`, sul telefono «Profilo» non lo trovava, e
 * tornava zitta: **le due schermate di Play `telefono-2-immersione.png` e
 * `telefono-3-profilo.png` del 21 settembre erano identiche byte per byte**
 * (stesso MD5), pronte per essere caricate. Adesso il titolo si cerca anche lì,
 * e in quel caso si porta in cima la carta intera, bordo compreso, invece del
 * testo del pulsante.
 *
 * @param page     la pagina Playwright
 * @param testo    il testo esatto del titolo dentro `.main` — `h1`, `h2`, `h3` o il
 *                 titolo di una carta apribile
 * @param margine  quanti px lasciare sopra il titolo
 */
export async function portaInCima(page, testo, margine = 14) {
  const esito = await page.evaluate(
    ({ testo, margine }) => {
      const m = document.querySelector('.main');
      if (!m) return null;
      const titolo = [...m.querySelectorAll('h1, h2, h3, .apri-sezione-titolo')].find(
        (h) => h.textContent.trim() === testo,
      );
      if (!titolo) return null;
      const bersaglio = titolo.closest('.carta-apribile') ?? titolo;
      const distanza = () => bersaglio.getBoundingClientRect().top - m.getBoundingClientRect().top;
      m.scrollTop += distanza() - margine;
      return {
        dopo: distanza(),
        // In fondo alla pagina il titolo può restare più in basso del margine,
        // e va bene: più su di così non sale.
        inFondo: m.scrollTop + m.clientHeight >= m.scrollHeight - 1,
      };
    },
    { testo, margine },
  );
  if (!esito)
    throw new Error(`nessun titolo «${testo}» dentro .main: la schermata non è quella che si crede`);
  // E si rimisura dove è arrivato: se `.main` non fosse lui a scorrere, lo
  // `scrollTop` cadrebbe nel vuoto e la fotografia uscirebbe uguale a prima.
  if (Math.abs(esito.dopo - margine) > 2 && !esito.inFondo)
    throw new Error(`«${testo}» è rimasto a ${Math.round(esito.dopo)} px dalla cima invece di ${margine}`);
  await page.waitForTimeout(350);
}

/**
 * IL FUSO ORARIO DELLE FOTOGRAFIE: UTC, DICHIARATO.
 *
 * ► PERCHÉ, misurato il 22 settembre 2026. ◄ La scheda di un'immersione scrive
 * accanto all'ora «(UTC+0, ora locale del sito)» quando il fuso registrato nel
 * file è diverso da quello dell'apparecchio (`tzLabel` in `src/ui/format.ts`).
 * L'archivio dimostrativo registra i suoi siti a UTC+0. Fotografata nel
 * contenitore, che vive in UTC, la scheda non aveva la nota; fotografata sul
 * Mac, che a settembre è a UTC+2, la stessa scheda la aveva — **lo stesso
 * comando dava immagini diverse secondo la macchina su cui girava**, e quelle
 * del Mac mostravano un sito italiano «a UTC+0» nella seconda schermata di un
 * negozio.
 *
 * Il fuso si dichiara al contesto del browser come la lingua e il tema, e vale
 * per tutti e tre i fotografi — sito, Play, App Store — da qui, una volta sola.
 * Non cambia i dati: l'ora scritta resta quella del sito.
 */
export const FUSO_DELLE_FOTOGRAFIE = 'UTC';
