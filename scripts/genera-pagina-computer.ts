/**
 * Genera le due pagine dei computer supportati, dal catalogo vero.
 *
 *   npm run sito:computer
 *
 * ► PERCHÉ GENERATA E NON SCRITTA A MANO. ◄ Questa pagina risponde a una
 * domanda sola — «il mio computer si scarica?» — e la risposta la sa una parte
 * sola del progetto: `src/core/ble/`. Scritta a mano, direbbe il vero il giorno
 * che la si scrive e comincerebbe a mentire alla prima voce aggiunta al
 * catalogo, senza che nessun comando lo dica. È lo stesso ragionamento della
 * cask di Homebrew e del PKGBUILD: *un file che dichiara dei fatti non si
 * scrive a mano.*
 *
 * Qui però la posta è più alta. Una cask sbagliata dà «checksum mismatch» e
 * qualcuno se ne accorge; una pagina che promette un computer che non si
 * scarica manda una persona a comprare un apparecchio, o a rinunciare a
 * MyDiveLog dopo averci provato — e non se ne accorge nessuno.
 *
 * ► DA DOVE VENGONO I FATTI. ◄ Nessun elenco è ricopiato: le marche arrivano da
 * `marchePerDiffusione()`, i modelli da `MODELLI_BLE` e `MODELLI_SENZA_BLE`, e
 * l'esito di ciascuno da `esitoPer()` — la stessa funzione che l'applicazione
 * chiama per scrivere quella riga sotto il nome nel selettore. Se la pagina e
 * l'app dicessero cose diverse sarebbe perché qualcuno ha cambiato `esitoPer`,
 * e allora cambiano tutte e due insieme.
 *
 * ► E `conLibdivecomputer` È ACCESO, COME NEI PACCHETTI. ◄ `esitoPer` prende un
 * secondo argomento che dice se la libreria è compilata dentro. Nei pacchetti
 * pubblicati lo è — `default = ["computer-esterni"]` in `Cargo.toml` — quindi
 * la pagina deve raccontare *quei* pacchetti, non una compilazione di comodo.
 * Passare `false` qui produrrebbe una pagina più modesta del vero, che è un
 * errore meno appariscente e non meno errore.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MODELLI_SENZA_BLE, marchePerDiffusione } from '../src/core/ble/catalogo';
import { esitoPer } from '../src/core/ble/scelta';
import type { VoceCatalogo } from '../src/core/ble/catalogo';

const RADICE = fileURLToPath(new URL('..', import.meta.url));

/** `<`, `&` e le virgolette non entrano mai nudi in una pagina. */
const testo = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Lingua = 'it' | 'en';

/**
 * Le due risposte, nelle due lingue.
 *
 * ► DUE, NON QUATTRO. ◄ Decisione del proprietario, 3 settembre 2026: *«non
 * parlare di driver nostro, testato eccetera — diamo per buono che tutto
 * funzioni e non importa di chi è il driver»*.
 *
 * Le quattro risposte che `esitoPer` distingue servono all'APPLICAZIONE, dove
 * chi sta per collegare un apparecchio ha diritto di sapere se quel modello
 * l'ha mai letto qualcuno. **Quella distinzione resta lì**, sotto il nome, nel
 * momento in cui conta. Qui la domanda è un'altra e più semplice — «funziona
 * col mio computer?» — e ha due risposte: si collega via Bluetooth, oppure ci
 * si passa da un file.
 *
 * Chi legge non deve sapere quale libreria c'è sotto: è un dettaglio di come è
 * fatto il programma, non di cosa fa per lui.
 */
const ESITI = {
  'si-scarica': {
    it: { etichetta: 'Via Bluetooth', nota: 'si collega e scarica, senza passare da un file' },
    en: { etichetta: 'Over Bluetooth', nota: 'connects and downloads, no file needed' },
    classe: 'bluetooth',
  },
  'si-scarica-ldc': {
    it: { etichetta: 'Via Bluetooth', nota: 'si collega e scarica, senza passare da un file' },
    en: { etichetta: 'Over Bluetooth', nota: 'connects and downloads, no file needed' },
    classe: 'bluetooth',
  },
  'non-ancora': {
    it: { etichetta: 'Solo dal file', nota: 'si esporta dal suo programma e si importa qui' },
    en: { etichetta: 'File only', nota: 'export from its own software, then import here' },
    classe: 'dal-file',
  },
  'mai-via-radio': {
    it: { etichetta: 'Solo dal file', nota: 'si esporta dal suo programma e si importa qui' },
    en: { etichetta: 'File only', nota: 'export from its own software, then import here' },
    classe: 'dal-file',
  },
} as const;

function riga(voce: VoceCatalogo, lingua: Lingua): string {
  const esito = ESITI[esitoPer(voce, true).tipo];
  const { etichetta, nota } = esito[lingua];
  return `            <li class="computer" data-cerca="${testo((voce.marca + ' ' + voce.modello).toLowerCase())}">
              <span class="computer-nome">${testo(voce.modello)}</span>
              <span class="esito esito-${esito.classe}">${testo(etichetta)}</span>
              <span class="computer-nota">${testo(nota)}</span>
            </li>`;
}

function elenco(lingua: Lingua): string {
  const gruppi = marchePerDiffusione().map((m) => ({
    marca: m.marca,
    modelli: [...m.modelli] as VoceCatalogo[],
  }));
  // Garmin non è nel catalogo di libdivecomputer e va messa dov'è la sua
  // diffusione, non in fondo: è la quarta marca al mondo, e chi la cerca la
  // cerca fra le prime.
  const senzaBle = new Map<string, VoceCatalogo[]>();
  for (const v of MODELLI_SENZA_BLE) senzaBle.set(v.marca, [...(senzaBle.get(v.marca) ?? []), v]);
  for (const [marca, voci] of senzaBle) {
    const gia = gruppi.find((g) => g.marca === marca);
    if (gia) gia.modelli.push(...voci);
    else gruppi.splice(3, 0, { marca, modelli: voci });
  }

  return gruppi
    .map(
      (g) => `        <section class="marca" data-marca="${testo(g.marca.toLowerCase())}">
          <h3>${testo(g.marca)} <span class="quanti">${g.modelli.length}</span></h3>
          <ul class="computer-elenco">
${g.modelli.map((m) => riga(m, lingua)).join('\n')}
          </ul>
        </section>`,
    )
    .join('\n');
}

const CONTENUTO: Record<Lingua, (elenco: string, quanti: number, marche: number) => string> = {
  it: (voci, quanti, marche) => `<main class="documento">
        <h1>I computer che si scaricano</h1>
        <p class="data">${quanti} modelli, ${marche} marche — e cosa succede davvero con ciascuno</p>

        <div class="evidenza">
          <p>
            <strong>Questa pagina è generata dal catalogo dell’applicazione</strong>, non scritta a mano: dice
            esattamente quello che l’app risponderà quando cercherai il tuo modello. Se qui c’è, lì c’è.
          </p>
        </div>

        <p>
          Il collegamento è <b>Bluetooth</b>, dal computer o dal telefono, senza passare dall’app del
          costruttore.
          Le immersioni già presenti vengono arricchite, non duplicate. E se il tuo computer non è in elenco,
          quasi sempre <a href="#file">si passa da un file</a>.
        </p>

        <div class="cerca-computer">
          <label for="cerca">Cerca marca o modello</label>
          <input id="cerca" type="search" placeholder="Peregrine, Puck, i330R…" autocomplete="off" />
          <p class="niente-trovato" hidden>
            Nessun modello con questo nome. Prova con la sola marca — e se non c’è nemmeno quella,
            <a href="/#segnala">scrivicelo</a>: il catalogo cresce così.
          </p>
        </div>

${voci}

        <h2>Le due risposte</h2>
        <p>
          <b>Via Bluetooth</b>: accendi il computer in modalità collegamento, premi «Cerca il computer» e le
          immersioni entrano. Nessun cavo, nessun file, nessun programma del costruttore di mezzo. Quelle che
          hai già vengono arricchite, non duplicate.
        </p>
        <p>
          <b>Solo dal file</b>: i dati non escono via Bluetooth verso un’applicazione che non sia quella del
          costruttore. Vale per i <b>Garmin Descent</b>, che mandano tutto a Garmin Connect: da lì si esporta
          e si importa qui, e il risultato è lo stesso.
        </p>
        <p>
          Se qualcosa non va come dice questa pagina, <a href="/#segnala">scrivicelo</a>: è il modo in cui si
          corregge.
        </p>

        <h2 id="file">Se il tuo computer non c’è: i file</h2>
        <p>
          MyDiveLog riconosce sette formati <b>dal contenuto e non dall’estensione</b>, quindi non devi
          sapere che cos’è quel file: lo trascini dentro e basta.
        </p>
        <ul>
          <li><b>UDDF</b> — il formato universale di scambio dei logbook. Lo esportano quasi tutti.</li>
          <li><b>Subsurface</b> (<code>.ssrf</code>, <code>.xml</code>) — anche il file nativo, senza conversioni.</li>
          <li><b>Shearwater Cloud</b> — esportazione XML, e il log nativo dell’apparecchio.</li>
          <li><b>Garmin FIT</b> — quello che esce da Garmin Connect.</li>
          <li><b>Scubapro LogTRAK</b> (<code>.logtrak</code>).</li>
          <li><b>CSV o TSV</b> — qualunque foglio di calcolo con una riga per immersione.</li>
          <li><b>Backup JSON</b> di MyDiveLog, per portare tutto da un dispositivo all’altro.</li>
        </ul>
        <p>
          <b>Hai un Mares, un Suunto o un Oceanic e il tuo software non esporta UDDF?</b> Passa da
          <a href="https://subsurface-divelog.org" target="_blank" rel="noopener">Subsurface</a>: legge quasi
          tutto e salva in un formato che leggiamo nativamente.
        </p>
      </main>`,
  en: (voci, quanti, marche) => `<main class="documento">
        <h1>Dive computers that download</h1>
        <p class="data">${quanti} models, ${marche} brands — and what actually happens with each</p>

        <div class="evidenza">
          <p>
            <strong>This page is generated from the app’s own catalogue</strong>, not written by hand: it says
            exactly what the app will answer when you search for your model. If it is here, it is there.
          </p>
        </div>

        <p>
          The connection is <b>Bluetooth</b>, from your computer or your phone, without going through the
          manufacturer’s app. Dives you already have are enriched, not duplicated. And if your computer is not
          listed, there is almost always <a href="#file">a file route</a>.
        </p>

        <div class="cerca-computer">
          <label for="cerca">Search brand or model</label>
          <input id="cerca" type="search" placeholder="Peregrine, Puck, i330R…" autocomplete="off" />
          <p class="niente-trovato" hidden>
            No model by that name. Try the brand on its own — and if that is missing too,
            <a href="/en/#segnala">tell us</a>: that is how the catalogue grows.
          </p>
        </div>

${voci}

        <h2>The two answers</h2>
        <p>
          <b>Over Bluetooth</b>: put the computer in pairing mode, tap “Search for the computer”, and the
          dives come in. No cable, no file, no manufacturer software in the way. Dives you already have are
          enriched, not duplicated.
        </p>
        <p>
          <b>File only</b>: the data does not leave over Bluetooth to anything but the manufacturer’s own app.
          This is the case for <b>Garmin Descent</b> watches, which send everything to Garmin Connect: export
          from there and import here, and the result is the same.
        </p>
        <p>
          If something does not work the way this page says, <a href="/en/#segnala">tell us</a>: that is how
          it gets fixed.
        </p>

        <h2 id="file">If your computer is not listed: files</h2>
        <p>
          MyDiveLog recognises seven formats <b>by content, not by extension</b>, so you do not need to know
          what that file is: drag it in and that is all.
        </p>
        <ul>
          <li><b>UDDF</b> — the universal logbook exchange format. Almost everything exports it.</li>
          <li><b>Subsurface</b> (<code>.ssrf</code>, <code>.xml</code>) — the native file too, no conversion.</li>
          <li><b>Shearwater Cloud</b> — XML export, and the device’s native log.</li>
          <li><b>Garmin FIT</b> — what comes out of Garmin Connect.</li>
          <li><b>Scubapro LogTRAK</b> (<code>.logtrak</code>).</li>
          <li><b>CSV or TSV</b> — any spreadsheet with one row per dive.</li>
          <li><b>MyDiveLog JSON backup</b>, to carry everything from one device to another.</li>
        </ul>
        <p>
          <b>Got a Mares, a Suunto or an Oceanic whose software does not export UDDF?</b> Go through
          <a href="https://subsurface-divelog.org" target="_blank" rel="noopener">Subsurface</a>: it reads
          almost everything and saves in a format we read natively.
        </p>
      </main>`,
};

/**
 * La ricerca, senza librerie e senza framework.
 *
 * Nasconde le voci che non combaciano e le marche rimaste vuote. Se non resta
 * niente lo dice — *«nessun modello con questo nome» è la risposta più inutile
 * possibile se si ferma lì*, quindi accanto c'è cosa fare.
 *
 * Senza JavaScript la pagina resta l'elenco completo, che è la cosa giusta: il
 * campo di ricerca comodo, l'elenco necessario.
 */
const RICERCA = `
      <script>
        (function () {
          const campo = document.getElementById('cerca');
          if (!campo) return;
          const marche = [...document.querySelectorAll('.marca')];
          const niente = document.querySelector('.niente-trovato');
          campo.addEventListener('input', function () {
            const q = campo.value.trim().toLowerCase();
            let visti = 0;
            for (const sezione of marche) {
              let quante = 0;
              for (const voce of sezione.querySelectorAll('.computer')) {
                const ok = !q || voce.dataset.cerca.includes(q);
                voce.hidden = !ok;
                if (ok) quante++;
              }
              sezione.hidden = quante === 0;
              visti += quante;
            }
            niente.hidden = visti > 0;
          });
        })();
      </script>
`;

function pagina(lingua: Lingua): string {
  const modello = readFileSync(`${RADICE}sito/${lingua === 'it' ? 'aiuto.html' : 'en/help.html'}`, 'utf8');
  const marche = marchePerDiffusione();
  const quanti = marche.reduce((n, m) => n + m.modelli.length, 0) + MODELLI_SENZA_BLE.length;
  const quanteMarche = new Set([...marche.map((m) => m.marca), ...MODELLI_SENZA_BLE.map((m) => m.marca)])
    .size;

  const titolo = lingua === 'it' ? 'Computer supportati — MyDiveLog' : 'Supported dive computers — MyDiveLog';
  const descrizione =
    lingua === 'it'
      ? `I ${quanti} computer subacquei che MyDiveLog scarica via Bluetooth, e cosa succede davvero con ciascuno.`
      : `The ${quanti} dive computers MyDiveLog downloads over Bluetooth, and what actually happens with each.`;
  const qui = lingua === 'it' ? '/computer-supportati' : '/en/supported-computers';
  const gemella = lingua === 'it' ? '/en/supported-computers' : '/computer-supportati';

  let h = modello;
  // Testa: titolo, descrizione, canonico e alternative di lingua.
  h = h.replace(/<title>[^<]*<\/title>/, `<title>${titolo}</title>`);
  h = h.replace(/(name="description"\s*\n?\s*content=")[^"]*"/g, `$1${descrizione}"`);
  h = h.replace(/(property="og:title"\s*\n?\s*content=")[^"]*"/g, `$1${titolo}"`);
  h = h.replace(/(name="twitter:title"\s*\n?\s*content=")[^"]*"/g, `$1${titolo}"`);
  h = h.replace(/(property="og:description"\s*\n?\s*content=")[^"]*"/g, `$1${descrizione}"`);
  h = h.replace(/(name="twitter:description"\s*\n?\s*content=")[^"]*"/g, `$1${descrizione}"`);
  h = h.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${qui}" />`);
  h = h.replace(/(property="og:url"\s*\n?\s*content=")[^"]*"/g, `$1https://mydivelog.site${qui}"`);
  const it = lingua === 'it' ? qui : gemella;
  const en = lingua === 'it' ? gemella : qui;
  h = h.replace(/hreflang="it" href="[^"]*"/, `hreflang="it" href="https://mydivelog.site${it}"`);
  h = h.replace(/hreflang="en" href="[^"]*"/, `hreflang="en" href="https://mydivelog.site${en}"`);
  h = h.replace(
    /hreflang="x-default" href="[^"]*"/,
    `hreflang="x-default" href="https://mydivelog.site${it}"`,
  );
  // Lo scambio di lingua nel menu e nel piede punta alla gemella VERA.
  const file = lingua === 'it' ? 'en/supported-computers.html' : 'computer-supportati.html';
  h = h.replace(/href="\/(en\/)?(help|aiuto)\.html"(\s*)>(English|Italiano)</g, `href="/${file}"$3>$4<`);
  // Il «sei qui» del menu: nessuna voce corrisponde, quindi non lo porta nessuno.
  h = h.replace(/\s*aria-current="page"/, '');
  // Il corpo.
  h = h.replace(
    /<main class="documento">[\s\S]*?<\/main>/,
    CONTENUTO[lingua](elenco(lingua), quanti, quanteMarche),
  );
  // La ricerca, subito prima della chiusura del corpo.
  h = h.replace(/(\n\s*)<\/body>/, `${RICERCA}$1</body>`);
  return h;
}

for (const lingua of ['it', 'en'] as const) {
  const dove = `${RADICE}sito/${lingua === 'it' ? 'computer-supportati.html' : 'en/supported-computers.html'}`;
  writeFileSync(dove, pagina(lingua));
  console.log(`scritta ${dove}`);
}
