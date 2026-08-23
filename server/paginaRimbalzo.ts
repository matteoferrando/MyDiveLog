/**
 * La paginetta che riporta il browser dentro l'applicazione, su iPhone.
 *
 * PERCHÉ ESISTE, e non è un vezzo. Dopo la POST di Apple il Worker sa dove
 * mandare il browser: sul Mac è una porta su `127.0.0.1`, che è un indirizzo web
 * come un altro, e per quella basta un 303. Su iPhone la destinazione è
 * `mydivelog://accesso`, cioè uno **schema non-web**, e lì il 303 non arriva da
 * nessuna parte: i browser di iOS non seguono un rimando AUTOMATICO verso uno
 * schema che non sia http o https. Non è una svista di qualcuno, è una difesa —
 * senza, qualunque pagina potrebbe aprire qualunque applicazione installata
 * senza che chi guarda tocchi niente.
 *
 * Il sintomo, quando manca questa pagina, è il peggiore che ci sia: **niente**.
 * Nessun errore nel browser, nessuna riga nel registro del Worker, nessun
 * messaggio nell'app. La pagina resta bianca «che non carica» e l'accesso muore
 * lì. È esattamente com'è stato visto il 23 agosto 2026 su Chrome, che è il
 * browser predefinito di quel telefono ed è più severo di Safari.
 *
 * COSA SBLOCCA IL PASSAGGIO: un tocco. Un collegamento premuto da una persona
 * verso `mydivelog://` iOS lo apre senza discutere, perché a quel punto la
 * volontà c'è ed è dimostrata. Quindi qui si smette di rimbalzare di nascosto e
 * si mette un pulsante.
 *
 * Il tentativo automatico c'è lo stesso, in tre righe di script: su Safari e sui
 * browser che lo permettono la pagina passa senza che nessuno tocchi niente, e
 * il pulsante resta lì per il caso in cui non succeda. Nell'ordine giusto —
 * prima si prova, poi si offre — chi ha un browser tollerante non vede questa
 * pagina per più di un istante.
 *
 * ► TUTTO QUELLO CHE FINISCE NELL'HTML ARRIVA DA FUORI. ◄ La destinazione l'ha
 * scritta il browser di chi accede (dentro lo `state`), il codice e il campo
 * `user` li ha scritti Apple. Il Worker ha già rifiutato le destinazioni che non
 * sono nostre — `destinazionePermessa` in `appleScambio.ts` — ma il contenuto
 * dei parametri no, quello passa. Quindi l'indirizzo si scrive nella pagina in
 * due forme diverse e nessuna delle due è la stringa nuda: `perHtml` per
 * l'attributo, `perScript` per la stringa JavaScript. E sopra a tutto c'è una
 * CSP con un nonce, che è la rete sotto il trapezio: se un giorno una di queste
 * due funzioni avesse una crepa, uno script iniettato non verrebbe comunque
 * eseguito.
 */

/** Il minimo indispensabile perché una stringa non esca dal suo attributo. */
function perHtml(testo: string): string {
  return testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * La stessa stringa, ma dentro uno script.
 *
 * `JSON.stringify` basta per il JavaScript ma NON per l'HTML che lo contiene: la
 * sequenza `</script` dentro una stringa chiude il blocco comunque, e da lì in
 * poi il browser legge markup invece di codice. Per questo ogni `<` diventa
 * `<`, che per JavaScript è lo stesso identico carattere e per l'analizzatore
 * HTML non apre niente.
 */
function perScript(testo: string): string {
  return JSON.stringify(testo).replace(/</g, '\\u003c');
}

/** Un nonce per la CSP: nuovo a ogni risposta, altrimenti non serve a niente. */
function nonce(): string {
  const byte = crypto.getRandomValues(new Uint8Array(16));
  let grezzo = '';
  for (const n of byte) grezzo += String.fromCharCode(n);
  return btoa(grezzo).replace(/=+$/, '');
}

/**
 * Italiano o inglese, deciso dal browser.
 *
 * L'app sa in che lingua sta lavorando, ma questa pagina non la disegna l'app:
 * la disegna il Worker, in mezzo a un giro che passa da Apple, e l'unica cosa
 * che arriva fin qui è l'intestazione del browser. Si guarda solo l'inizio e si
 * sceglie fra due: è una pagina di sei parole, non vale il prezzo di una
 * negoziazione vera.
 */
function lingua(richiesta: Request): 'it' | 'en' {
  const dichiarata = (richiesta.headers.get('Accept-Language') ?? '').toLowerCase();
  return dichiarata.startsWith('it') ? 'it' : 'en';
}

const TESTI = {
  it: {
    titolo: 'Torna a MyDiveLog',
    frase: 'Accesso completato.',
    pulsante: 'Apri MyDiveLog',
    coda: 'Se non si apre da solo, tocca il pulsante.',
  },
  en: {
    titolo: 'Back to MyDiveLog',
    frase: 'Sign-in complete.',
    pulsante: 'Open MyDiveLog',
    coda: 'If it does not open by itself, tap the button.',
  },
} as const;

/**
 * La risposta completa: pagina, CSP, e niente in cache.
 *
 * `no-store` non è prudenza generica. In coda a quell'indirizzo c'è un codice di
 * autorizzazione a uso singolo: una copia in cache — del browser, di un proxy, di
 * chiunque — è una copia di quel codice, e non ha nessuna ragione di esistere
 * dopo il primo tocco.
 */
export function paginaRimbalzo(verso: string, richiesta: Request): Response {
  const lin = lingua(richiesta);
  const t = TESTI[lin];
  const n = nonce();

  const html = `<!doctype html>
<html lang="${lin}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${perHtml(t.titolo)}</title>
<style nonce="${n}">
  :root { color-scheme: light dark; }
  body {
    font: 17px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    margin: 0; min-height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 18px; padding: 24px; text-align: center;
    background: Canvas; color: CanvasText;
  }
  p { margin: 0; }
  .coda { font-size: 14px; opacity: 0.65; }
  a.pulsante {
    display: inline-block; padding: 14px 26px; border-radius: 12px;
    background: #0b6ea8; color: #fff; text-decoration: none; font-weight: 600;
    /* 44 px è il bersaglio minimo che Apple indica per un tocco: sotto quella
       misura si manca, e qui mancare vuol dire non entrare. */
    min-width: 44px; min-height: 44px;
  }
</style>
</head>
<body>
<p>${perHtml(t.frase)}</p>
<a class="pulsante" href="${perHtml(verso)}">${perHtml(t.pulsante)}</a>
<p class="coda">${perHtml(t.coda)}</p>
<script nonce="${n}">
  /* Il tentativo automatico, per i browser che lo permettono. Si usa
     location.replace e non location.href: così questa pagina non resta nella
     cronologia, e il tasto indietro non ci riporta sopra con il codice ancora
     in coda. (Niente apici inversi qui dentro: questo script vive dentro un
     template letterale, e un apice inverso lo chiuderebbe a metà.) */
  try { location.replace(${perScript(verso)}); } catch (e) {}
</script>
</body>
</html>
`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}'`,
      'Referrer-Policy': 'no-referrer',
    },
  });
}
