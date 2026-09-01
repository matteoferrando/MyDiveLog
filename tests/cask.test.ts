/**
 * La cask di Homebrew: che dica il vero, e che dica gli stessi limiti del sito.
 *
 * ► COSA PUÒ ANDARE STORTO QUI, E COME SE NE ACCORGE CHI. ◄ Una cask dichiara
 * una versione e un `sha256`. Se il secondo non è l'impronta del file che la
 * prima indica, `brew install` si ferma con «checksum mismatch» — e lo scopre
 * **chi prova a installare**, non chi ha pubblicato. È lo stesso schema del
 * pacchetto Android che dichiarava di essere firmato e non lo era: nessun
 * comando falliva da questa parte.
 *
 * Il file è generato da `scripts/genera-cask.mjs`, che l'impronta la prende
 * dall'API di GitHub — cioè dal file che GitHub serve davvero — e, se gli si
 * passa il `.dmg` locale, pretende che le due combacino. Queste prove
 * difendono quello che resta: che il generato non sia stato ritoccato a mano,
 * che la versione sia quella del progetto, e che i limiti dichiarati siano gli
 * stessi che il sito scrive prima del pulsante.
 *
 * Perché non si controlla l'impronta contro la rete: una prova che chiama
 * GitHub fallisce in aereo e su una CI senza rete, e una prova che fallisce per
 * motivi suoi insegna a ignorare il rosso. Il confronto con la rete lo fa il
 * generatore, nel momento in cui la cask si scrive.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const CASK = readFileSync(`${RADICE}homebrew/mydivelog.rb`, 'utf8');
const PACCHETTO = JSON.parse(readFileSync(`${RADICE}package.json`, 'utf8'));
const SITO = readFileSync(`${RADICE}sito/index.html`, 'utf8');

const stanza = (nome: string) => new RegExp(`^\\s*${nome}\\s+"([^"]+)"`, 'm').exec(CASK)?.[1];

describe('la cask di Homebrew', () => {
  it('dichiara la versione del progetto', () => {
    // Il difetto classico: si alza la versione e si dimentica l'impronta, o
    // viceversa. Qui si inchioda almeno il primo dei due alla fonte vera.
    expect(stanza('version')).toBe(PACCHETTO.version);
  });

  it('l’impronta è un vero sha256, e non un segnaposto', () => {
    const sha = stanza('sha256');
    expect(sha, 'la cask non dichiara nessuna impronta').toBeDefined();
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    // `:no_check` esiste in Homebrew e serve ai download che cambiano a ogni
    // richiesta. Qui sarebbe una scorciatoia per far passare una cask che non
    // sa cosa sta scaricando.
    expect(CASK).not.toContain('sha256 :no_check');
  });

  it('l’indirizzo punta alla versione dichiarata, non a «latest»', () => {
    // `releases/latest/download/...` va benissimo per un pulsante su un sito e
    // non può stare in una cask: l'impronta è di UN file, e «latest» domani è un
    // altro file. La cask userebbe l'impronta vecchia sul pacchetto nuovo.
    const url = /^\s*url\s+"([^"]+)"/m.exec(CASK)?.[1];
    expect(url, 'la cask non ha un url').toBeDefined();
    expect(url, 'la cask scarica «latest»: l’impronta non potrà mai combaciare').not.toContain('/latest/');
    expect(url).toContain('/releases/download/v#{version}/');
    expect(url).toContain('MyDiveLog-macOS-arm64.dmg');
  });

  it('dichiara che l’applicazione si aggiorna da sola', () => {
    // Senza, brew crede di essere lui a gestire la versione: l'app si aggiorna
    // per conto suo e quello che brew dice di avere installato smette di essere
    // vero.
    expect(CASK).toMatch(/^\s*auto_updates true$/m);
  });

  it('dichiara gli stessi limiti che il sito scrive prima del pulsante', () => {
    // Il sito dice «serve un Mac Apple Silicon e macOS 12». Una cask che non lo
    // dicesse installerebbe su un Intel un'applicazione che non si apre — e la
    // riga sul sito nacque proprio da un pacchetto che dichiarava 10.15 mentre
    // il binario era solo arm64.
    // ► ANCORATE A INIZIO RIGA, E NON PER PIGNOLERIA. ◄ Scritte senza `^` e `$`,
    // queste due trovavano la riga anche COMMENTATA: `# depends_on arch: :arm64`
    // faceva passare la prova. Visto verde commentando la riga, che è
    // esattamente il modo in cui uno la disattiva quando gli dà fastidio.
    expect(CASK).toMatch(/^\s*depends_on arch: :arm64$/m);
    // La forma col simbolo nudo, non quella con la stringa: `">= :monterey"` è
    // deprecata e brew lo dice a ogni comando. L'ha trovata brew, non io — ed è
    // il motivo per cui una cask va fatta leggere a brew prima di pubblicarla.
    expect(CASK).toMatch(/^\s*depends_on macos: :monterey$/m);
    expect(CASK, 'è tornata la forma deprecata con la stringa').not.toMatch(/depends_on macos: "/);
    expect(SITO, 'il sito non parla più di Apple Silicon: i due limiti vanno riallineati').toContain(
      'Apple Silicon',
    );
    expect(SITO, 'il sito non parla più di macOS 12: i due limiti vanno riallineati').toContain('macOS 12');
  });

  it('lo `zap` nomina i posti veri, con l’identificatore vero', () => {
    const identificatore = JSON.parse(readFileSync(`${RADICE}src-tauri/tauri.conf.json`, 'utf8')).identifier;
    expect(identificatore).toBe('it.ferrando.mydivelog');
    // Un solo posto sbagliato e lo zap lascia in giro l'archivio credendo di
    // averlo tolto: peggio del non averlo scritto, perché sembra fatto.
    expect(CASK).toMatch(new RegExp(`^\\s*"~/Library/Application Support/${identificatore}",$`, 'm'));
    expect(CASK).toMatch(new RegExp(`^\\s*"~/Library/WebKit/${identificatore}",$`, 'm'));
    expect(CASK).toMatch(/^\s*app "MyDiveLog\.app"$/m);
  });

  it('resta un file generato, e lo dice a chi lo apre', () => {
    // È l'unica difesa contro la modifica a mano, che è il modo in cui la
    // versione e l'impronta si disallineano.
    expect(CASK).toContain('FILE GENERATO');
    expect(CASK).toContain('npm run cask');
    expect(PACCHETTO.scripts.cask).toBe('node scripts/genera-cask.mjs');
  });
});
