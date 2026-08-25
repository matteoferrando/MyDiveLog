/**
 * L'inglese, una frase per riga.
 *
 * La chiave è la frase ITALIANA così com'è scritta nell'interfaccia — vedi
 * `lingua.tsx` per il perché. Una frase che manca da qui esce in italiano:
 * l'applicazione resta usabile anche a dizionario incompleto, e la traduzione
 * si può fare un pezzo alla volta invece che tutta insieme.
 *
 * QUESTO FILE NON ENTRA NEL PRIMO AVVIO. `lingua.tsx` lo importa in modo pigro
 * e solo per chi sceglie l'inglese: chi usa l'applicazione in italiano non ha
 * nessun motivo di scaricare trentamila caratteri di traduzioni, e il pezzo di
 * codice del primo avvio ha un budget che questo file, da solo, sforerebbe.
 *
 * REGOLE PER CHI AGGIUNGE:
 *  - la chiave si copia INTERA dalla frase italiana, spazi, apostrofi
 *    tipografici e punteggiatura compresi. Un carattere di differenza e la
 *    traduzione non viene trovata — e il difetto è silenzioso: esce l'italiano;
 *  - l'inglese sia corto almeno quanto l'italiano. Se in inglese viene più
 *    lungo, di solito vuol dire che l'italiano si poteva accorciare;
 *  - i termini subacquei restano quelli che usa chi si immerge in inglese:
 *    *dive*, *logbook*, *gradient factor*, *deco stop*, *surface interval*,
 *    *RMV*, *no-deco limit*, *cylinder*, *buddy*. Non si traducono in inglese
 *    scolastico;
 *  - le voci sono raggruppate per scheda dell'applicazione, non in ordine
 *    alfabetico: chi traduce lavora su una schermata alla volta.
 */
export const INGLESE: Record<string, string> = {
  // --- il guscio: navigazione, avvii, errori, conteggi ---
  'Apertura dell’archivio…': 'Opening your logbook…',
  'Chiudi il menu': 'Close menu',
  di: 'of',
  immersione: 'dive',
  immersioni: 'dives',
  'Le altre schede funzionano. Se succede sempre qui, di solito è un dato d’archivio rovinato: da Impostazioni puoi ripristinare un backup.':
    'The other tabs still work. If it always happens here, it is usually a damaged record: you can restore a backup from Settings.',
  'Qualcosa si è rotto in questa pagina': 'Something broke on this page',
  Riprova: 'Try again',
  Sezioni: 'Sections',
  'tutte mostrate': 'all shown',

  // --- importazione da file e scarico via Bluetooth ---
  '(XML o UDDF): profilo, temperatura, tetto deco, PPO2. Nell’UDDF il gas può mancare: verificalo nella scheda.':
    '(XML or UDDF): profile, temperature, deco ceiling, PPO2. UDDF may lose the gas: check it on the dive.',
  ': leggibile ma povero. Gas e miscela vanno completati nella scheda.':
    ': readable but thin. Gas and mix must be filled in on the dive.',
  ': profilo e pressioni. Il volume della bombola non c’è nel formato: si inserisce una volta.':
    ': profile and pressures. Cylinder volume is not in the format: enter it once.',
  ': profilo, temperatura, bombola, zavorra, fuso, condizioni. Niente dati di deco: le soste le ricaviamo dal profilo.':
    ': profile, temperature, cylinder, weight, time zone, conditions. No deco data: stops are derived from the profile.',
  ': solo riepilogo, nessun profilo. Utile per recuperare uno storico da un foglio di calcolo.':
    ': summary only, no profile. Useful to recover history from a spreadsheet.',
  'Ancora niente.': 'Nothing yet.',
  'Archivio azzerato': 'Logbook erased',
  arricchite: 'enriched',
  Arricchite: 'Enriched',
  avvisi: 'warnings',
  avviso: 'warning',
  'Azzera l’archivio': 'Erase everything',
  'Cancella tutte le immersioni e i profili. Non si torna indietro, ma i file di origine restano e si può reimportare.':
    'Deletes every dive and profile. No undo — but your source files stay, so you can import again.',
  'Cancella tutto': 'Delete everything',
  'Cancellazione fallita': 'Delete failed',
  'Cancellazione in corso…': 'Deleting…',
  'Cerca il computer': 'Find my computer',
  'Come ottenerlo': 'How to get it',
  'Controlla: il computer è in modalità collegamento? È vicino? Il permesso Bluetooth è dato?':
    'Check: is the computer in pairing mode? Is it close? Is Bluetooth permission granted?',
  'Cosa porta ogni formato': 'What each format brings',
  Estensioni: 'Extensions',
  'Ferma la ricerca': 'Stop scanning',
  File: 'File',
  'file in lettura': 'files being read',
  'file letti': 'files read',
  'file non letti': 'files not read',
  'FIT dall’app Suunto': 'FIT from the Suunto app',
  'Formati supportati': 'Supported formats',
  Formato: 'Format',
  'Già presenti': 'Already there',
  'già presenti': 'already there',
  'Il Bluetooth funziona, ma i protocolli si aggiungono uno alla volta. Per ora: esporta dall’app del costruttore e importa il file qui sopra.':
    'Bluetooth works, but protocols are added one at a time. For now: export from the manufacturer app and import the file above.',
  'Il formato si riconosce dal contenuto, non dall’estensione: un .xml può essere UDDF, Subsurface o Shearwater.':
    'The format is detected from the file content, not the extension: an .xml can be UDDF, Subsurface or Shearwater.',
  'Import fallito': 'Import failed',
  'Import finito': 'Import finished',
  'Importa immersioni': 'Import dives',
  Interrompi: 'Stop',
  'L’archivio non è stato svuotato.': 'Nothing was deleted.',
  'motivo non riportato': 'no reason given',
  'Nessun computer è ancora supportato per lo scarico diretto.':
    'No dive computer is supported for direct download yet.',
  'Nessuna immersione nuova: c’era già tutto.': 'No new dives: everything was already there.',
  'Non passano dal cestino e non si recuperano. Si possono solo reimportare.':
    'They do not go to the trash and cannot be recovered. You can only import them again.',
  Nuove: 'New',
  nuove: 'new',
  'Puoi sceglierne più di uno: le immersioni doppie vengono unite.':
    'You can pick several: duplicate dives are merged.',
  'Scarica dal computer subacqueo': 'Download from your dive computer',
  'Sì, cancella': 'Yes, delete',
  Trovate: 'Found',
  trovate: 'found',
  'Un permesso negato non dà errore: la ricerca sembra solo non trovare niente.':
    'A denied permission raises no error: the scan simply seems to find nothing.',
  'Vai al logbook': 'Go to the logbook',
  'Via Bluetooth, senza l’app del costruttore. Le immersioni già presenti vengono arricchite, non duplicate.':
    'Over Bluetooth, without the manufacturer app. Dives you already have are enriched, not duplicated.',

  // --- elenco delle immersioni e modifica in blocco ---
  'Aggiungi etichetta': 'Add tag',
  'Applica a': 'Apply to',
  'Apri tutto': 'Show all',
  'azoto residuo': 'residual nitrogen',
  'Azzera i filtri': 'Clear filters',
  'Cerca fra le immersioni': 'Search your dives',
  'Cerca sito, compagno, note…': 'Search site, buddy, notes…',
  consumo: 'RMV',
  data: 'date',
  Deseleziona: 'Deselect',
  durata: 'duration',
  giorni: 'days',
  giorno: 'day',
  'I filtri le nascondono, ma verranno modificate anche loro.':
    'The filters hide them, but they will be changed too.',
  'Importa un file dal tuo computer subacqueo per iniziare. Puoi caricarne più di uno: le immersioni doppie vengono unite.':
    'Import a file from your dive computer to start. You can load several: duplicate dives are merged.',
  'in archivio. Prova ad allargare la ricerca.': 'in your logbook. Try widening the search.',
  'in più': 'more',
  'La zavorra deve essere un numero:': 'Weight must be a number:',
  le: 'the',
  'l’immersione': 'the dive',
  Media: 'Avg',
  Mostra: 'Show',
  'Muta, zavorra e attrezzatura non le registra nessun computer: compilale qui, in un colpo solo.':
    'No computer records suit, weight and gear: fill them in here, in one go.',
  'nel cestino?': 'to the trash?',
  'Nessuna immersione con questi filtri': 'No dives match these filters',
  'Nessuna immersione in archivio': 'No dives yet',
  'niente in scadenza, niente in circolo': 'nothing due, nothing on board',
  'non lo è.': 'is not.',
  'non toccare': 'leave as is',
  oggi: 'today',
  Oltre: 'Deeper than',
  'Ordina per': 'Sort by',
  'per svuotare un campo su tutte.': 'to clear a field on all of them.',
  'Prima della prossima': 'Before your next dive',
  'Prima della prossima immersione': 'Before your next dive',
  profondità: 'depth',
  'qualsiasi profondità': 'any depth',
  'Quello che scade, dal più urgente.': 'What is due, most urgent first.',
  'Restano recuperabili per 30 giorni, finché non svuoti il cestino.':
    'They stay recoverable for 30 days, until you empty the trash.',
  Riduci: 'Collapse',
  Scrivi: 'Type',
  'Scrivo…': 'Saving…',
  'Seleziona l’immersione del': 'Select the dive of',
  'Seleziona tutte le immersioni mostrate': 'Select every dive shown',
  'Si scrivono solo i campi che compili.': 'Only the fields you fill in are written.',
  Spostare: 'Move',
  svuota: 'clear',
  'Sì, sposta': 'Yes, move',
  'Tieni solo quelle visibili': 'Keep only the visible ones',
  tutti: 'all',
  'Ultima immersione': 'Last dive',

  // --- la scheda di una singola immersione ---
  'Annotazioni del logbook': 'Logbook notes',
  aria: 'air',
  'Bombole e miscele': 'Cylinders and mixes',
  'Cambi di gas sotto la MOD': 'Gas switches below MOD',
  'campioni, uno ogni': 'samples, one every',
  'Chiudi modifica': 'Close editing',
  'Ci sono modifiche non salvate: chiudendo vanno perse.': 'There are unsaved changes: closing loses them.',
  'CNS calcolato (NOAA)': 'CNS computed (NOAA)',
  'CNS del computer': 'CNS from the computer',
  'Come le hai scritte nel logbook di origine.': 'As you wrote them in the source logbook.',
  Computer: 'Computer',
  'con l’azoto residuo dell’immersione precedente. Tratteggiati, i numeri del tuo computer.':
    'with residual nitrogen from the previous dive. Dashed, your computer’s own numbers.',
  Conservatorismo: 'Conservatism',
  'Consumo di superficie': 'RMV',
  'Consumo dichiarato': 'RMV reported',
  'Cosa dice il profilo di questa immersione.': 'What this dive profile says.',
  'Curva e obbligo, minuto per minuto': 'NDL and deco, minute by minute',
  'dal carico che avevi in quel momento': 'from the load you had at that moment',
  'Densità impostata': 'Density set',
  Dettagli: 'Details',
  'di piastra': 'of backplate',
  'di quota tenuta': 'of held depth',
  'di ridiscese': 'of yo-yo',
  'di zavorra': 'of lead',
  discesa: 'descent',
  Erogatori: 'Regulators',
  'errore di procedura': 'procedure error',
  Etichette: 'Tags',
  Fasi: 'Phases',
  fonti: 'sources',
  'Forma del profilo': 'Profile shape',
  'Gradient factor impostati': 'Gradient factors set',
  'I minuti in curva partono': 'No-deco minutes start',
  'Il browser ha bloccato la finestra di stampa. Consentila per questo sito e riprova.':
    'The browser blocked the print window. Allow it for this site and try again.',
  'Il TTS suppone risalita a 9 m/min, soste di un minuto e': 'TTS assumes 9 m/min up, one-minute stops and',
  'il tuo computer': 'your computer',
  'Immersione non trovata': 'Dive not found',
  'Impostazioni del computer': 'Computer settings',
  'Integrazione aria': 'Air integration',
  'la distanza fra le due curve è quella differenza.': 'the gap between the two curves is that difference.',
  'Lette dal log del computer, non inserite a mano.': 'Read from the computer log, not typed in.',
  'Letto dal computer': 'From the computer',
  'Limite di PPO2 impostato': 'PPO2 limit set',
  Logbook: 'Logbook',
  'm più profonda della prima': 'm deeper than the first',
  'm più profonda, come si raccomanda': 'm deeper, as recommended',
  'media non disponibile': 'average not available',
  'Minuti residui in curva (NDL)': 'No-deco limit left (NDL)',
  'Minuti residui in curva': 'No-deco minutes left',
  'NDL minimo': 'Lowest NDL',
  'nessun cambio di gas': 'no gas switch',
  'Nessun campionamento nel file di origine.': 'No samples in the source file.',
  nessuna: 'none',
  nessuno: 'none',
  'non da tessuti puliti. Il limite è tagliato a 99 minuti.':
    'not from clean tissues. The limit is capped at 99 minutes.',
  'Numero di serie': 'Serial number',
  'Obbligo decompressivo': 'Deco obligation',
  'ora locale del sito': 'local time at the site',
  Origine: 'Source',
  'Orologio dell’ossigeno (CNS)': 'Oxygen clock (CNS)',
  'Oscillazione a quota tenuta': 'Depth wobble while holding',
  'Passo di campionamento': 'Sampling interval',
  'positiva in risalita': 'positive going up',
  'PDF salvato': 'PDF saved',
  'PPO2 di picco': 'Peak PPO2',
  'PPO2 minima': 'Min PPO2',
  'Pressione bombola': 'Cylinder pressure',
  'Pressione in superficie': 'Surface pressure',
  'prima metà': 'first half',
  Profilo: 'Profile',
  'profilo da qui': 'profile from this one',
  'Profilo principale': 'Main profile',
  'Profondità in metri, tempo in minuti.': 'Depth in metres, time in minutes.',
  'Quello che ha calcolato il computer durante l’immersione.':
    'What the computer worked out during the dive.',
  'Ricalcolati sul profilo con Bühlmann ZH-L16C e gradient factor':
    'Recomputed on the profile with Bühlmann ZH-L16C and gradient factors',
  risalita: 'ascent',
  'Risalita di picco': 'Peak ascent',
  'Se il tuo computer aveva gradient factor diversi da': 'If your computer used gradient factors other than',
  'secondo computer': 'second computer',
  'Secondo profilo': 'Second profile',
  'Senza i litri della bombola il consumo in L/min non si calcola.':
    'Without cylinder litres the L/min rate cannot be worked out.',
  'serve un profilo campionato': 'needs a sampled profile',
  'servono volume e pressione della bombola': 'needs cylinder volume and pressure',
  'sopra 1.4': 'above 1.4',
  'sopra i 10 m': 'above 10 m',
  'Sosta profonda': 'Deep stop',
  'sotto i 10 m': 'below 10 m',
  'Sovrasaturazione istantanea (GF99)': 'Instant supersaturation (GF99)',
  'Stampa questa immersione': 'Print this dive',
  'Su iPhone e iPad non si stampa. Il foglio si stampa dal Mac: i dati sono gli stessi.':
    'No printing on iPhone and iPad. Print from the Mac: the data is the same.',
  'Sì, butta via le modifiche': 'Yes, discard my changes',
  'Tempo di fondo residuo (RBT)': 'Remaining bottom time (RBT)',
  'Tempo di risalita (TTS) del computer': 'Time to surface (TTS) from the computer',
  'Tempo in deco': 'Time in deco',
  'Tempo per arrivare in superficie (TTS)': 'Time to surface (TTS)',
  'Tetto di decompressione: mai comparso': 'Deco ceiling: never appeared',
  'Torna al logbook': 'Back to the logbook',
  Usati: 'Used',
  'Velocità e assetto vengono dal profilo più fitto del secondo computer, a':
    'Rates and trim come from the denser profile of the second computer, at',
  'Velocità sull’ultimo tratto': 'Rate on the last leg',
  'Velocità verticale su': 'Vertical rate over',
  'Versione del log': 'Log version',
  'Versione hardware': 'Hardware version',

  // --- statistiche ---
  Al: 'To',
  'Ancora nessun dato da analizzare': 'No data to analyse yet',
  'Andamento di': 'Trend of',
  assetto: 'buoyancy',
  'Attività mese per mese': 'Month by month',
  'calcolata sul profilo con le tabelle NOAA': 'computed from the profile with NOAA tables',
  'calcolato dal profilo': 'computed from the profile',
  'cambiati nel periodo': 'changed during the period',
  'Caso peggiore': 'Worst case',
  'Clicca un punto per aprire l’immersione.': 'Click a point to open the dive.',
  'Clicca una bolla per aprire un’immersione fatta lì.': 'Click a bubble to open a dive done there.',
  'Come ti immergi, di solito': 'How you usually dive',
  'cominciate con azoto ancora in circolo': 'started with nitrogen still on board',
  'Composizione dell’archivio': 'What is in the logbook',
  'con il dato': 'with the data',
  'con il tetto registrato': 'with the ceiling recorded',
  'con l’attrezzatura registrata: troppo poche per un confronto. Compila muta, zavorra ed erogatori nella scheda dell’immersione.':
    'with gear recorded: too few to compare. Fill in wetsuit, weight and regulators on the dive page.',
  'Con obbligo decompressivo': 'With deco obligation',
  'con piastra su': 'with backplate on',
  'con pressione finale': 'with an end pressure',
  'con profilo': 'with profile',
  'Configurazione, miscele, esposizione.': 'Setup, mixes, exposure.',
  Consumo: 'RMV',
  'consumo di superficie': 'RMV',
  'Consumo di superficie (L/min)': 'RMV (L/min)',
  'Consumo in superficie': 'RMV',
  'Consumo per': 'RMV by',
  'Cosa dipende da cosa': 'What depends on what',
  'Costo mediano': 'Median cost',
  Dal: 'From',
  'di GF99 all’uscita, rispetto a partire da pulito': 'of GF99 on surfacing, versus starting clean',
  'di solito': 'usually',
  Disciplina: 'Discipline',
  Distribuzioni: 'Distributions',
  'Dolce e salata sono contate a parte. I chili sono il totale, piastra compresa.':
    'Fresh and salt are counted apart. Kilos are the total, backplate included.',
  'Dove passi il tempo.': 'Where you spend your time.',
  'Dove ti immergi': 'Where you dive',
  'Fasce di profondità': 'Depth bands',
  'fra due immersioni della stessa giornata': 'between two dives on the same day',
  'GF99 medio all’uscita': 'Average GF99 on surfacing',
  'Giornata peggiore, CNS': 'Worst day, CNS',
  'Giornata peggiore, OTU': 'Worst day, OTU',
  'giornate di immersione nel periodo': 'diving days in the period',
  'Giorni sopra 300 OTU': 'Days over 300 OTU',
  'Il CNS si dimezza ogni 90 minuti in superficie; le OTU non recuperano mai.':
    'CNS halves every 90 minutes on the surface; OTU never recover.',
  'Il GF99 all’uscita dipende da queste impostazioni: tienine conto quando confronti due periodi.':
    'GF99 on surfacing depends on these settings: keep that in mind when comparing periods.',
  'il massimo in un giorno': 'max in one day',
  'Il valore massimo di ciascuna immersione.': 'Each dive’s peak.',
  'Immersioni nel periodo': 'Dives in the period',
  'Immersioni per anno': 'Dives per year',
  'Importa le immersioni e le statistiche appaiono qui.': 'Import your dives and the statistics appear here.',
  impostati: 'set',
  'Impostazioni del computer nel tempo': 'Computer settings over time',
  'in cui eri vestito diversamente dal solito per quella temperatura':
    'where you were dressed differently than usual for that temperature',
  'in curva sopra i 10 m': 'no-deco, deeper than 10 m',
  'in miglioramento': 'improving',
  'in peggioramento': 'worsening',
  'In rebreather': 'On rebreather',
  'in tabella': 'in the table',
  'La più calda': 'Warmest',
  'La più fredda': 'Coldest',
  'Le condizioni sono registrate su poche immersioni: con un gruppo solo non c’è niente da confrontare. Compila mare, visibilità e meteo nella scheda dell’immersione.':
    'Conditions are recorded on few dives: with one group there is nothing to compare. Fill in sea, visibility and weather on the dive page.',
  'Le prime due colonne sono le uscite sotto la riserva.': 'The first two columns are exits below reserve.',
  'Le ripetitive': 'Repetitive dives',
  'Le tue mediane divise per mare, visibilità e meteo. Accanto al consumo trovi profondità e temperatura dello stesso gruppo: se salgono insieme, non sono state le onde. Solo i gruppi da tre immersioni in su.':
    'Your medians split by sea, visibility and weather. Next to RMV you get the group’s depth and temperature: if they rise together, it was not the waves. Only groups of three dives or more.',
  'l’ultima': 'the last one',
  'mediana dalla sosta alla superficie': 'median from the stop to the surface',
  'Mediane sul periodo. Ogni tessera dice su quante immersioni si basa.':
    'Medians over the period. Each tile says how many dives it rests on.',
  'Muta, temperatura e stagione': 'Wetsuit, temperature and season',
  'negli ultimi 90 giorni': 'in the last 90 days',
  'Nessuna di queste righe dice una causa: col mare agitato cambiano anche sito, profondità e temperatura.':
    'No row here states a cause: in rough seas the site, depth and temperature change too.',
  'nessuna immersione verificabile': 'no dive can be checked',
  'non indicata': 'not given',
  'Non è una mappa: sotto non c’è cartografia. È la disposizione dei siti, con la bolla grande quanto le immersioni fatte lì.':
    'Not a map: there is no cartography under it. It is how the sites sit relative to each other, bubble size by dives there.',
  'Ogni punto è un’immersione: cliccala per aprirla. La retta è la tendenza, r è la correlazione — 0 nessuna, ±1 perfetta. È una correlazione, non una causa.':
    'Each point is a dive: click to open it. The line is the trend, r is the correlation — 0 none, ±1 perfect. A correlation, not a cause.',
  'oltre i 20 m': 'deeper than 20 m',
  'Oltre i 30 m': 'Deeper than 30 m',
  'Oltre i 40 m': 'Deeper than 40 m',
  'oltre il limite': 'over the limit',
  'OTU per giornata di immersione': 'OTU per diving day',
  pausa: 'surface interval',
  'Pausa mediana': 'Median surface interval',
  'Per numero di immersioni.': 'By number of dives.',
  'Percentuali calcolate solo dove la verifica è possibile: il denominatore è accanto a ogni riga.':
    'Percentages only where the check is possible: the denominator sits next to each row.',
  'Più lunga': 'Longest',
  'Più profonda': 'Deepest',
  'Pressione all’uscita (bar)': 'Pressure on surfacing (bar)',
  'Prof. mediana': 'Median depth',
  'profili con più di una bombola': 'profiles with more than one cylinder',
  'Quante immersioni per intervallo. Le code sono i casi che una media nasconde.':
    'How many dives per band. The tails are what an average hides.',
  'Quanto contano le condizioni': 'How much conditions matter',
  'Quanto GF99 in più ti sei portato a casa rispetto a fare la stessa immersione da pulito.':
    'How much extra GF99 you came out with, versus the same dive on clean tissues.',
  'Quello che porti addosso incrociato con quello che il profilo misura. Un gruppo entra in tabella da tre immersioni in su.':
    'What you wear against what the profile measures. A group enters the table from three dives up.',
  'scarto dal computer': 'gap from the computer',
  'se ti immergi più giorni di fila': 'if you dive several days in a row',
  senza: 'without',
  'Serve il volume della bombola e le due pressioni.': 'Needs cylinder size and both pressures.',
  'Serve un profilo campionato.': 'Needs a recorded profile.',
  'siti con coordinate': 'sites with coordinates',
  'Siti più frequentati': 'Most dived sites',
  'Solo dove volume e pressioni sono noti.': 'Only where size and pressures are known.',
  sotto: 'below',
  'Sotto i 14 °C': 'Below 14 °C',
  'sott’acqua': 'underwater',
  Stagione: 'Season',
  Statistiche: 'Statistics',
  'T mediana': 'Median T',
  'T minima': 'Min T',
  'Temperatura minima media per mese: dice quando serve la muta più pesante.':
    'Average min temperature per month: says when you need the thicker suit.',
  'Temperatura per mese': 'Temperature by month',
  'Ultimi 12 mesi': 'Last 12 months',
  'Ultimi 24 mesi. I mesi vuoti restano visibili.': 'Last 24 months. Empty months stay visible.',
  'velocità di risalita': 'ascent rate',
  'Velocità di risalita': 'Ascent rate',
  'Velocità di risalita massima (m/min)': 'Peak ascent rate (m/min)',
  'Zavorra, per muta e per tipo d’acqua': 'Weight, by wetsuit and water type',

  // --- confronto fra due immersioni ---
  Confronta: 'Compare',
  Differenza: 'Difference',
  'Dove un valore manca da una parte sola, la riga lo dichiara.':
    'Where a value is missing on one side, the row says so.',
  'Due profili sullo stesso grafico, e le stesse misure affiancate.':
    'Two profiles on one chart, and the same numbers side by side.',
  'I due profili': 'The two profiles',
  'Le differenze': 'The differences',
  Misura: 'Measure',
  'Nessuna delle due ha un profilo campionato.': 'Neither has a recorded profile.',
  'Nessuno dei due è riscalato: se una dura meno, si vede.':
    'Neither is rescaled: if one is shorter, you see it.',
  'non confrontabile': 'not comparable',
  'Prima immersione': 'First dive',
  'Seconda immersione': 'Second dive',
  'Una delle due non ha un profilo: il grafico mostra solo l’altra.':
    'One has no profile: the chart shows only the other.',

  // --- piano di miglioramento ---
  'bastano per il consumo': 'are enough for RMV',
  'Calcolato su': 'Based on',
  'Come è costruito questo piano': 'How this plan is built',
  'Criteri di riferimento': 'Reference criteria',
  'criteri su': 'criteria out of',
  'del periodo': 'in the period',
  'Dopo, in ordine': 'Later, in order',
  'e ne servono almeno 3': 'and at least 3 are needed',
  Esercizi: 'Drills',
  esercizi: 'drills',
  esercizio: 'drill',
  'hanno il profilo': 'have a profile',
  'I numeri che vedi sono quelli che hanno generato il giudizio.':
    'The numbers you see are the ones behind the verdict.',
  'immersioni su': 'dives out of',
  'in tutto l’archivio': 'in the whole logbook',
  'non misurato': 'not measured',
  Obiettivo: 'Goal',
  'Piano di miglioramento': 'Improvement plan',
  'Piano non calcolabile': 'Plan not available',
  'Piano ricalcolato per l’obiettivo': 'Plan recalculated for goal',
  'priorità su cui lavorare adesso': 'priorities to work on now',
  prontezza: 'readiness',
  'punti di forza': 'strengths',
  'Punti di forza': 'Strengths',
  'punti dopo': 'points for later',
  'Quello che già funziona, con i numeri che lo dicono.': 'What already works, with the numbers behind it.',
  'Servono più immersioni': 'More dives needed',
  soddisfatti: 'met',
  'Sono riferimenti, non i requisiti di un corso: quelli chiedili all’istruttore.':
    'These are references, not course requirements: ask your instructor for those.',
  'Su cosa lavorare adesso': 'What to work on now',
  'Su cosa si basa': 'Based on',
  'Sulla sicurezza il piano dice cosa guardare, non sostituisce l’istruttore.':
    'On safety the plan says what to watch, it does not replace your instructor.',
  'Tre alla volta: fare tutto insieme non funziona.': 'Three at a time: all at once does not work.',
  'Una valutazione tace finché non ha almeno sei immersioni con il dato che le serve.':
    'A rule stays quiet until it has six dives with the data it needs.',
  'Vai a Importa': 'Go to Import',
  'Vai a Statistiche': 'Go to Statistics',

  // --- attrezzatura e brevetti ---
  Apri: 'Open',
  Assetto: 'Buoyancy',
  'Bombole, erogatori, sacco, computer, muta. L’intervallo di manutenzione lo decidi tu.':
    'Cylinders, regulators, BCD, computer, suit. You set the service interval.',
  Brevetti: 'Certifications',
  Brevetto: 'Certification',
  'Con zavorra': 'With weight',
  'Configurazione, contata sui log': 'Setup, counted from the logs',
  'dall’ultima': 'since service',
  Data: 'Date',
  'Altro (scrivo io)': 'Other (I’ll type it)',
  'Assistente istruttore': 'Assistant instructor',
  'come si chiama il corso': 'what the course is called',
  'con decompressione': 'with decompression',
  'Con brevetti che prevedono la decompressione.': 'Some certifications cover decompression.',
  'Con brevetto miscele.': 'Mixed-gas certified.',
  'Guida subacquea': 'Dive guide',
  'I tuoi brevetti': 'Your certifications',
  'Introduttivo (solo con guida)': 'Intro level (supervised only)',
  'La profondità più alta che le tue didattiche dichiarano è': 'The deepest limit your agencies state is',
  'Nome della didattica': 'Agency name',
  'Nome sul brevetto': 'Name on the certification',
  'Profondità dichiarata da': 'Depth stated by',
  'Qualifica più alta': 'Highest rating',
  'Questa didattica non dichiara una profondità per questo brevetto.':
    'This agency does not state a depth for this certification.',
  Ricreative: 'Recreational',
  'Scegli la didattica e il corso: il nome e i limiti arrivano da soli. Quelli che registri qui sono quelli che puoi mettere sul libretto.':
    'Pick the agency and the course: the name and the limits come with it. What you add here is what you can put on the logbook.',
  'Se non ti torna, scegli «Altro (scrivo io)» e compila a mano.':
    'If that looks wrong, pick “Other (I’ll type it)” and fill it in yourself.',
  Soccorso: 'Rescue',
  Tecniche: 'Technical',
  Didattica: 'Agency',
  Elimino: 'Delete',
  fa: 'ago',
  fra: 'in',
  Immersioni: 'Dives',
  indietro: 'overdue',
  Intervallo: 'Range',
  'La somma viene proposta come piastra sulle immersioni fatte con questo GAV.':
    'The total is suggested as plate weight on dives made with this BCD.',
  Livello: 'Level',
  'Livello più alto registrato': 'Highest level on record',
  Manutenzione: 'Service',
  Matricola: 'Serial',
  mese: 'month',
  mesi: 'months',
  'Mostra anche': 'Also show',
  'Nessun brevetto registrato. Servono ai': 'No certifications yet. They feed',
  'Nessuna immersione ha insieme muta e zavorra. Scrivile nella scheda dell’immersione: da due in poi questa tabella dice qualcosa.':
    'No dive has both suit and weight. Add them in the dive card: from two on, this table starts to say something.',
  'Niente ancora. Comincia dalla bombola: matricola e data del collaudo sono quelle che ti chiedono al centro ricarica.':
    'Nothing yet. Start with the cylinder: the fill station asks for its serial and hydro date.',
  No: 'No',
  'Non lo uso più (resta in archivio, fuori dall’elenco)': 'No longer in use (kept on file, out of the list)',
  'Non si compila: viene dalle immersioni, che portano già muta e chili.':
    'Nothing to fill in: it comes from the dives, which already carry suit and weight.',
  'Non si recupera.': 'No way back.',
  'Nuovo brevetto': 'New certification',
  'Nuovo pezzo': 'New item',
  ogni: 'every',
  'per dirti quanto manca al passo successivo.': 'so it can tell you how far the next step is.',
  'pezzi ritirati': 'retired items',
  Pezzo: 'Item',
  'pezzo ritirato': 'retired item',
  Prossima: 'Next',
  'Quello che porti in acqua': 'What you take in the water',
  'questo brevetto': 'this certification',
  'Questo GAV aggiunge': 'This BCD adds',
  'questo mese': 'this month',
  'questo pezzo': 'this item',
  'Ricavata dal numero di bombole registrate e dalla modalità.':
    'From the number of cylinders logged and the mode.',
  ritirato: 'retired',
  'sempre uguale': 'always the same',
  'senza nome': 'unnamed',
  'Serve un nome.': 'A name is required.',
  Suggerimenti: 'Coaching',
  'Sì, elimina': 'Yes, delete',
  Ultima: 'Last',
  'Un archivio, non un promemoria: nessun avviso, nessuna scadenza che lampeggia.':
    'A record, not a reminder: no alerts, no flashing due dates.',
  'Vengono proposti come piastra sulle immersioni in cui lo scegli, e li puoi cambiare lì.':
    'Suggested as plate weight on dives where you pick it, and you can change it there.',
  'Zavorra e configurazione': 'Weighting and setup',
  'Zavorra mediana': 'Median weight',

  // --- pianificatore di gas e di decompressione ---
  A: 'At',
  'a 1.4 bar': 'at 1.4 bar',
  'a 1.6 in deco': 'at 1.6 on deco',
  'A bordo': 'On board',
  'a bordo': 'on board',
  'a metà risalita': 'halfway up',
  'A quota': 'At',
  'accendi «calcola il gas minimo per l’emergenza» qui sopra.':
    'tick “compute the minimum gas for an emergency” above.',
  'accettabile fino a 5.21 ata': 'acceptable up to 5.21 ata',
  Acqua: 'Water',
  Aggiungi: 'Add',
  'Aggiungi gas di transito': 'Add travel gas',
  'Aggiungi livello': 'Add level',
  'Aggiungi ossigeno': 'Add oxygen',
  'aggiungi un gas di deco, più livelli e il bailout da ogni quota.':
    'mode you add a deco gas, more levels, and bailout from any depth.',
  'Al minuto': 'At minute',
  'alla sosta dei': 'at the stop at',
  'all’uscita, con GF': 'on surfacing, with GF',
  andata: 'out',
  'appena dentro': 'only just inside',
  Attenzione: 'Careful',
  'Azoto e narcosi': 'Nitrogen and narcosis',
  'bar a bordo': 'bar on board',
  'bar sulla bombola da': 'bar in the cylinder of',
  basta: 'enough',
  'Bilancio della bombola': 'Cylinder budget',
  'Bombola deco': 'Deco cylinder',
  'Bombola di decompressione separata': 'Separate deco cylinder',
  'bombola non dichiarata': 'cylinder not declared',
  'Bombola O₂': 'O₂ cylinder',
  'Bühlmann ZH-L16C con gradient factor 40/85, sul gas del fondo. Se il tuo computer è impostato diversamente i minuti cambiano, e ha ragione lui.':
    'Bühlmann ZH-L16C with gradient factors 40/85, on bottom gas. Set your computer differently and the minutes change — your computer wins.',
  'Bühlmann ZH-L16C con gradient factor, come il tuo computer. Restano un piano: in acqua ha ragione lui.':
    'Bühlmann ZH-L16C with gradient factors, like your computer. Still a plan: in the water your computer wins.',
  'Calcola il gas minimo per l’emergenza': 'Compute the minimum gas for an emergency',
  'Calcolato dalle tue pressioni, immersione per immersione. Dove mancano, il valore non c’è.':
    'Computed from your pressures, dive by dive. Where they are missing, there is no value.',
  'Cambia la pressione ambiente, e quindi i volumi.': 'Changes ambient pressure, and so every volume.',
  Cambio: 'Switch',
  'Capacità della bombola di': 'Cylinder size of',
  Carica: 'Load',
  'Che immersione stai pianificando': 'What are you planning',
  'Ci arrivi al minuto': 'You get there at minute',
  'Circuito chiuso (rebreather)': 'Closed circuit (rebreather)',
  'Come risali': 'How you ascend',
  'Come sono andate le tue immersioni a profondità simile (±5 m). Se il piano promette di più, è ottimista.':
    'How your dives at a similar depth (±5 m) actually went. If the plan promises more, it is optimistic.',
  'con gradient factor': 'with gradient factors',
  'Con la modalità': 'In',
  'Conservatorismo VPM': 'VPM conservatism',
  Consumati: 'Used',
  'Consumo al fondo': 'Bottom RMV',
  'Consumo del compagno': 'Buddy RMV',
  'Consumo in deco': 'Deco RMV',
  'Consumo in decompressione': 'Deco RMV',
  'Consumo in emergenza': 'Stressed RMV',
  'Consumo misurato su': 'RMV measured on',
  'Consumo O₂ al fondo': 'Bottom O₂ use',
  'Consumo O₂ in deco': 'Deco O₂ use',
  'contro i': 'against the',
  'Controllo incrociato: chi ha cosa, dove, e come si apre.':
    'Cross-check: who carries what, where, and how it opens.',
  Copia: 'Copy',
  Copiato: 'Copied',
  'Cosa cambia': 'What changes',
  'Cosa stai facendo': 'What you are doing',
  'Curva al primo livello': 'No-deco at first level',
  'Curva alla massima': 'No-deco at max depth',
  'Curva alla media': 'No-deco at average depth',
  'Curva di sicurezza': 'No-deco limit',
  'Da portare in acqua': 'To take in the water',
  'Da sapere': 'Worth knowing',
  'dalla fine del fondo alla superficie': 'from the end of the bottom to the surface',
  'Dall’ingresso all’inizio della risalita, discesa compresa: è come lo conta il computer.':
    'From splash to the start of the ascent, descent included: as your computer counts it.',
  'Dall’ingresso all’uscita. Quello che avanza dal fondo è la risalita.':
    'From splash to surface. What is left over from the bottom is the ascent.',
  'Decide gas d’emergenza, ppO2 e narcosi. La media segue in proporzione.':
    'Drives bailout gas, ppO2 and narcosis. Average depth follows in proportion.',
  Decompressione: 'Decompression',
  decompressione: 'deco',
  'del compagno': 'buddy’s',
  'della massima': 'of max depth',
  'di cui': 'of which',
  'di fondo': 'bottom',
  'di gas': 'of gas',
  'di media': 'average',
  'di partenza': 'you start with',
  'di questa immersione, sul limite del 100%': 'for this dive, against the 100% limit',
  'di questa sola immersione': 'this dive alone',
  'di risalita': 'ascent',
  'di riserva': 'of reserve',
  'Di solito (mediana)': 'Usually (median)',
  'di tetto': 'ceiling',
  Diluente: 'Diluent',
  Discesa: 'Descent',
  dolce: 'fresh',
  dopo: 'after',
  'dose giornaliera di riferimento': 'daily reference dose',
  'Dove sei, e cosa hai fatto prima': 'Where you are, and what you did before',
  'Dove si entra, dove si esce, che giro si fa e da che parte si torna.':
    'Where you get in, where you get out, the route, and the way back.',
  'Due scuole: il gas minimo calcolato (rock bottom), o la riserva fissa. Scegli tu.':
    'Two schools: computed rock bottom, or a fixed reserve. Your call.',
  'Due: tu e il compagno senza gas.': 'Two: you and an out-of-gas buddy.',
  Durata: 'Duration',
  'Durata della sosta': 'Stop length',
  'durata minima possibile': 'shortest possible runtime',
  'Durata tipica': 'Typical runtime',
  'Durata totale': 'Total runtime',
  'Durata totale dell’immersione': 'Total dive runtime',
  'e ai': 'and',
  'E se…': 'What if…',
  Elimina: 'Delete',
  'Elio di': 'Helium in',
  'Elio, percento': 'Helium, percent',
  era: 'was',
  'esce al': 'leaves at',
  'Esci con questa pressione, qualunque sia la profondità.':
    'You surface on this pressure, whatever the depth.',
  'Aggiunta come nuova un’immersione del': 'Added as new a dive from',
  'che somiglia a una già in archivio': 'that looks like one already in the logbook',
  'stessa profondità e stessa durata': 'same depth, same duration',
  'ma con': 'but with',
  'di scarto sull’orario': 'of difference in the time',
  'Se è la stessa immersione vista da due computer, uno dei due orologi è impostato male: unisci le due schede dal logbook.':
    'If this is the same dive seen by two computers, one of the two clocks is set wrong: merge the two entries from the logbook.',
  'Unisci le due': 'Merge the two',
  'Sì, uniscile': 'Yes, merge them',
  'Diventano una scheda sola: resta quella col profilo più ricco e l’altra va nel cestino, da dove si rimette a posto in un gesto.':
    'They become a single entry: the one with the richer profile stays, the other goes to the trash, from where one tap puts it back.',
  'Unite: la scheda assorbita è nel cestino.': 'Merged: the absorbed entry is in the trash.',
  'Una delle due immersioni non è più in archivio.': 'One of the two dives is no longer in the logbook.',
  'Sono la stessa immersione.': 'They are the same dive.',
  'Gas analizzato': 'Analysed gas',
  'O₂ analizzato': 'Analysed O₂',
  'He analizzato': 'Analysed He',
  'Analizzato il': 'Analysed on',
  'Analizzato da': 'Analysed by',
  Analizzato: 'Analysed',
  'io, il diving, il compagno': 'me, the dive centre, my buddy',
  'Non coincide con la miscela dichiarata qui sopra. Se l’analisi è quella giusta, correggi anche quella: MOD, PPO2 ed esposizione all’ossigeno sono calcolate su quel numero.':
    'This does not match the mix declared above. If the analysis is the right one, correct that too: MOD, PPO2 and oxygen exposure are all computed from that number.',
  dichiarato: 'declared',
  'La MOD a 1.4 bar è': 'The MOD at 1.4 bar is',
  'invece di': 'instead of',
  'il limite mostrato finora era più profondo di quello vero.':
    'the limit shown until now was deeper than the real one.',
  'i conti fatti finora erano prudenti.': 'the figures so far were on the safe side.',
  'Esporta PDF': 'Export PDF',
  'Esposizione all’ossigeno': 'Oxygen exposure',
  fase: 'phase',
  Fase: 'Phase',
  'Fermi si respira meno che sul fondo. Zero: come quello di fondo.':
    'Hanging you breathe less than working. Zero: same as bottom.',
  'fermo a': 'sitting at',
  'Fermo a sei metri si respira meno che nuotando a quaranta: per questo i due consumi sono separati.':
    'Hanging at six metres you breathe less than swimming at forty: that is why the two rates are separate.',
  'fine del fondo — il caso peggiore': 'end of the bottom — worst case',
  fondo: 'bottom',
  'Fondo consentito dal gas': 'Bottom time the gas allows',
  'Gas d’emergenza: non calcolato': 'Bailout gas: not computed',
  'gas minimo': 'minimum gas',
  'Gas minimo (rock bottom)': 'Minimum gas (rock bottom)',
  'Gas minimo per profondità': 'Minimum gas by depth',
  'Gas necessario': 'Gas needed',
  'Gestione del problema': 'Problem solving',
  'GF alto': 'GF high',
  'GF basso': 'GF low',
  'GF99 previsto': 'GF99 expected',
  'hai pianificato': 'you planned',
  'Hai scelto la riserva fissa di': 'You chose a fixed reserve of',
  'I due modelli a confronto': 'The two models side by side',
  'I livelli': 'The levels',
  'Il bailout non regge': 'The bailout does not hold',
  'Il browser ha bloccato la finestra di stampa. Consenti i popup per questo sito e riprova.':
    'The browser blocked the print window. Allow popups for this site and retry.',
  'Il circuito chiuso': 'Closed circuit',
  'Il circuito si chiude e si esce a circuito aperto. Dal fondo è il caso peggiore; se il gas non basta, prova quote diverse.':
    'The loop closes and you exit on open circuit. From the bottom is the worst case; if gas runs short, try other depths.',
  'Il controllo in cinque lettere, da fare in superficie insieme al compagno.':
    'The five-letter check, done on the surface with your buddy.',
  'Il fondo è disegnato alla sua profondità media. La riga tratteggiata è la massima.':
    'The bottom is drawn at its average depth. The dashed line is max depth.',
  'Il gas che serve': 'The gas you need',
  'Il gas di ogni fase è calcolato alla sua profondità media.':
    'Each phase burns gas at its own average depth.',
  'Il gas minimo': 'The minimum gas',
  'Il gas minimo, fase per fase': 'Minimum gas, phase by phase',
  'Il gas per riportare due persone in superficie dal punto più profondo, con una bombola sola.':
    'The gas to bring two divers up from the deepest point, sharing one cylinder.',
  'Il guasto avviene a': 'The failure happens at',
  'Il pallino rosso: quello scenario consuma la riserva.':
    'A red dot means that scenario eats into the reserve.',
  'Il peggiore visto': 'Worst seen',
  'Il piano contro la realtà': 'The plan against reality',
  'il piano dura': 'the plan runs',
  'Il piano esce con': 'The plan surfaces on',
  'Il piano non regge': 'This plan does not hold',
  'il piano prevede': 'the plan expects',
  'il piano resta in curva': 'the plan stays within no-deco',
  'Il piano resta in curva, ma il foglio serve lo stesso: gas, limiti e avvisi.':
    'The plan stays in no-deco, but the sheet still helps: gas, limits and warnings.',
  'Il piano su cui lavori si salva da sé. Qui metti quelli che vuoi ritrovare: il relitto, la parete, il corso.':
    'The plan you are on saves itself. Keep here the ones you want back: the wreck, the wall, the course.',
  'Il più lungo dei due, sosta per sosta': 'The longer of the two, stop by stop',
  'Il primo gas dell’elenco è il diluente. I gas di bailout non entrano nel piano ma nella risalita d’emergenza qui sotto.':
    'The first gas listed is the diluent. Bailout gases stay out of the plan and go into the emergency ascent below.',
  'Il profilo pianificato': 'The planned profile',
  'Il resto del fondo sta a': 'The rest of the bottom sits at',
  'Il tempo del primo livello comprende la discesa. Sui livelli successivi il transito è in più.':
    'The first level’s time includes the descent. On later levels travel is extra.',
  'Il tuo consumo': 'Your RMV',
  'Il tuo piano': 'Your plan',
  Immersione: 'Dive',
  'Immersione pianificata': 'Planned dive',
  'Immersione precedente': 'Previous dive',
  'Immersioni simili': 'Similar dives',
  'in archivio': 'in your logbook',
  'in curva': 'in no-deco',
  'in curva, più': 'no-deco, plus',
  'in lago': 'in fresh water',
  'In litri e, dove la bombola è nota, in bar. La riserva non è compresa.':
    'In litres and, where the cylinder is known, in bar. Reserve not included.',
  'in mare': 'in salt water',
  'in superficie da': 'to the surface from',
  'in totale': 'in total',
  'in tutto': 'in all',
  'In uso': 'In use',
  'Intervallo di superficie': 'Surface interval',
  'intorno ai': 'around',
  'invece di 1.013: respiri meno gas, e la curva si accorcia.':
    'instead of 1.013: you breathe less gas, and the no-deco limit shortens.',
  iterazioni: 'iterations',
  'L/min in superficie': 'L/min at the surface',
  'La colonna dei bar non fa parte della tabella di risalita che insegnano i corsi: è in più.':
    'The bar column is not part of the run-time table taught on courses: it is extra.',
  'la decompressione si allunga.': 'deco gets longer.',
  'La desaturazione comincia a': 'Off-gassing starts at',
  'la faccio': 'I do it',
  'La pressione che dovresti leggere sul manometro a ogni tappa. Serve ad accorgersi di uno scostamento':
    'What your SPG should read at each step. It catches a drift',
  'la profondità a cui stai davvero': 'the depth you are really at',
  'La profondità di cambio viene dalla MOD e si può correggere. In risalita il piano passa da solo al gas più ricco respirabile.':
    'Switch depth comes from the MOD and can be edited. On ascent the plan moves to the richest breathable gas by itself.',
  'La regola dei terzi vale se il ritorno è obbligato. Altrimenti conta il gas minimo.':
    'Thirds assume a forced return. Otherwise the number that counts is minimum gas.',
  'La risalita non si imposta: si ricava.': 'The ascent rate is not set: it comes out.',
  'La riserva': 'The reserve',
  'La seconda immersione della giornata': 'The second dive of the day',
  'la superficie è a': 'the surface is at',
  'La tabella': 'The table',
  Lago: 'Fresh',
  'Le 12, 18 o 24 ore dei corsi restano la regola. Questo numero dice solo quando il tetto scende sotto la quota di cabina.':
    'The 12, 18 or 24 hours taught on courses stay the rule. This number only says when the ceiling drops below cabin altitude.',
  'Le miscele': 'The mixes',
  'Le soste che questo piano impone': 'The stops this plan forces on you',
  'Le soste con il runtime, e il piano in testo semplice: si copia, si incolla, si stampa.':
    'The stops with their runtime, and the plan as plain text: copy, paste, print.',
  'Le soste le calcola.': 'It does compute the stops.',
  'Le soste si pagano con lei, alla sua profondità e col suo consumo. Margine del 50%.':
    'Stops are paid from it, at its depth and its RMV. 50% margin.',
  'Le soste sono calcolate sul fondo alla profondità media: un profilo più profondo ne chiede di più.':
    'Stops are computed on a bottom at average depth: a deeper profile will want more.',
  'Le soste, in tabella': 'The stops, as a table',
  'Le stesse righe del foglio, per leggerle sullo schermo.': 'The same rows as the sheet, to read on screen.',
  'Le tabelle escono dal 5 al 10 per cento più corte di V-Planner e MultiDeco: se vuoi allinearti, alza di un livello.':
    'Tables come out 5 to 10 per cent shorter than V-Planner and MultiDeco: to match them, go up one level.',
  'limite impostato': 'limit set to',
  litri: 'litres',
  Litri: 'Litres',
  'Lo stesso limite impostato sul computer.': 'The same limit set on your computer.',
  'Lo stesso piano con un parametro cambiato. «E se resto giù cinque minuti in più» va chiesto adesso, non a quaranta metri.':
    'The same plan with one thing changed. “What if I stay five more minutes” is a question for now, not for forty metres.',
  'La profondità narcotica equivalente (END) conta narcotico anche l’ossigeno: è la convenzione più prudente.':
    'Equivalent narcotic depth (END) counts oxygen as narcotic too: the more cautious convention.',
  'L’ossigeno metabolico non dipende dalla profondità; il diluente serve solo a riempire il circuito in discesa.':
    'Metabolic oxygen does not depend on depth; diluent only fills the loop on the way down.',
  'ma di solito esci con': 'but you usually surface on',
  'mai sopra 1.6': 'never above 1.6',
  'mai sotto i': 'never below',
  'Manca l’algoritmo ripetitivo, quindi sulla seconda immersione della giornata è ottimista.':
    'The repetitive algorithm is missing, so on the day’s second dive it is optimistic.',
  margine: 'spare',
  massima: 'max',
  'media dell’intera immersione': 'average for the whole dive',
  'mentre puoi ancora rimediare': 'while you can still fix it',
  metri: 'metres',
  'Metti da parte': 'Save plan',
  metà: 'half',
  'Metà all’andata, metà al ritorno.': 'Half out, half back.',
  'metà del gas utilizzabile': 'half the usable gas',
  'Metà — andata e ritorno': 'Halves — out and back',
  'min di decompressione': 'min of deco',
  'min di risalita': 'min of ascent',
  'min di sosta': 'min of stops',
  'min di sosta di sicurezza': 'min safety stop',
  'min di soste, prima a': 'min of stops, first at',
  Minuti: 'Minutes',
  'minuti di margine': 'minutes of margin',
  'minuti di sosta': 'min of stops',
  'Minuti di soste': 'Stop minutes',
  'minuti di superficie.': 'minutes on the surface.',
  'Minuti sul fondo prima di iniziare a risalire.': 'Minutes on the bottom before starting up.',
  Minuto: 'Minute',
  'minuto di margine': 'minute of margin',
  Miscela: 'Mix',
  'Miscela migliore per questa profondità': 'Best mix for this depth',
  Modello: 'Model',
  'modello a bolle': 'bubble model',
  'Modello decompressivo': 'Deco model',
  'Nessun modello la impone: la contiamo perché quasi tutti la fanno, e tre minuti sono tre minuti di gas.':
    'No model requires it: we count it because almost everyone does it, and three minutes are three minutes of gas.',
  'Nessuna immersione con i tessuti calcolati.': 'No dive with tissues calculated.',
  'Nessuna immersione con pressioni: scrivi il consumo a mano.':
    'No dive has cylinder pressures: enter the RMV by hand.',
  'Nessuna immersione del periodo ha bombola e pressioni. Scrivile in una scheda immersione, oppure tieni il valore predefinito qui sotto.':
    'No dive in this period has cylinder and pressures. Add them to a dive, or keep the default below.',
  'Nessuna immersione simile con la pressione d’uscita: niente da confrontare.':
    'No similar dive has an end pressure: nothing to compare.',
  'Nessuna pressione di rientro.': 'No turn pressure.',
  'nessuna sosta obbligatoria': 'no mandatory stop',
  'Nessuna — discesa lineare': 'None — one-way dive',
  'nessuna — parto da tessuti puliti': 'none — starting on clean tissues',
  Nome: 'Name',
  'non basta': 'not enough',
  'non la faccio': 'I skip it',
  'Non si aggiunge se il modello ha già una sosta a quella quota, né sotto i':
    'Not added if the model already stops at that depth, nor below',
  'Non si è potuto salvare': 'Could not save',
  'non usare la tabella.': 'do not use the table.',
  'non è disponibile: resta ferma se qualcosa va storto.':
    'is not available: it stays put in case something goes wrong.',
  'Non è obbligatoria, ma tre minuti non contati sono tre minuti di gas non contato.':
    'Not mandatory, but three minutes uncounted are three minutes of gas uncounted.',
  'Obbligo totale': 'Total deco',
  Ogni: 'Each',
  'Ore già passate in quota': 'Hours already at altitude',
  'ore in quota: non sei acclimatato, ed è nel conto.': 'hours at altitude: not acclimatised, and it counts.',
  'Orologio CNS': 'CNS clock',
  'Ossigeno di': 'Oxygen in',
  'Ossigeno e narcosi': 'Oxygen and narcosis',
  'Ossigeno e ritorno a casa': 'Oxygen and getting home',
  'Ossigeno metabolico': 'Metabolic oxygen',
  'Ossigeno, percento': 'Oxygen, percent',
  'O₂ di partenza': 'O₂ start pressure',
  'Passo fra le soste': 'Stop spacing',
  'per 1.4 bar a': 'for 1.4 bar at',
  'Per pianificare (75°)': 'For planning (75th)',
  'per riportare': 'to bring',
  'Per sapere se bastano a': 'To find out whether that is enough at',
  percento: 'percent',
  persona: 'diver',
  persone: 'divers',
  Persone: 'Divers',
  'Persone sulla bombola': 'Divers on the cylinder',
  'Piani messi da parte': 'Saved plans',
  pianificati: 'planned',
  'Pianificatore di gas': 'Gas planner',
  'Più alto del tuo: chi condivide gas respira male. La didattica dice 30.':
    'Higher than yours: sharing gas is bad breathing. Training says 30.',
  'più di quello che porti': 'more than you carry',
  'più in alto i tessuti che comandano scaricano invece di caricare.':
    'above that the leading tissues unload instead of loading.',
  'PPO2 al fondo': 'ppO2 at depth',
  'PPO2 massima': 'Max ppO2',
  'prendi un obbligo di decompressione. Accorcia il fondo, tira su la media, o passa alla modalità tecnica.':
    'you take on a deco obligation. Cut the bottom time, raise the average, or switch to technical mode.',
  'pressione attesa': 'expected pressure',
  'Pressione attesa': 'Expected pressure',
  'Pressione deco': 'Deco pressure',
  'pressione di partenza': 'start pressure',
  'Pressione di partenza': 'Start pressure',
  'Pressione di partenza di': 'Start pressure of',
  'Pressione di rientro': 'Turn pressure',
  'Pressione di rientro di ciascuno, detta ad alta voce. Qui non ne hai scelta una.':
    'Everyone’s turn pressure, said out loud. This plan has none.',
  'Pressione di rientro di ciascuno, detta ad alta voce: la tua è':
    'Everyone’s turn pressure, said out loud: yours is',
  'Pressione di superficie': 'Surface pressure',
  Prima: 'First',
  'Prima di scendere': 'Before you drop',
  'Prima di volare': 'Before flying',
  'Prima sosta': 'First stop',
  'prima sosta a': 'first stop at',
  'Prof. media': 'Avg depth',
  Profondità: 'Depth',
  'Profondità della sosta': 'Stop depth',
  'Profondità di cambio di': 'Switch depth of',
  'Profondità massima operativa': 'Maximum operating depth',
  'Prova a pianificare col consumo peggiore.': 'Try planning on your worst RMV.',
  'Prova dell’esaurimento gas e controllo bolle, erogatore di scorta in mano.':
    'Out-of-gas drill and bubble check, backup reg in hand.',
  'Quanti bar devi avere, e quando': 'How many bar you should have, and when',
  'Quanti bar restano bloccati per l’emergenza. Cresce più che linearmente: è quello che una riserva fissa non vede.':
    'How many bar stay locked for the emergency. It grows faster than linearly: a fixed reserve misses that.',
  'Quanto conta il tuo respiro': 'How much your breathing matters',
  'quanto puoi restare senza obblighi': 'how long you can stay with no obligation',
  'quanto saresti sovrasaturo all’uscita': 'how supersaturated you would surface',
  'Quattro fasi, ognuna con le sue ipotesi. Si parte dalla massima: in emergenza è da lì che si risale.':
    'Four phases, each with its own assumptions. It starts at max depth: that is where an emergency begins.',
  'Questo piano non è ricreativo.': 'This is not a recreational plan.',
  'Qui vengono sommate, non calcolate. Allungano la durata totale.':
    'Added here, not computed. They stretch the total runtime.',
  Quota: 'Depth',
  'Quota del sito': 'Site altitude',
  'Quota e immersione precedente cambiano la tabella prima dei livelli, e si sommano.':
    'Altitude and previous dive change the table before the levels do, and they add up.',
  raccomandati: 'recommended',
  'regola dei terzi sul gas utilizzabile': 'rule of thirds on usable gas',
  'Regola di rientro': 'Turn rule',
  'Relitto a 45 con Tx21/35': 'Wreck at 45 on Tx21/35',
  Ricreativa: 'Recreational',
  'Ricreativa: il piano resta in curva, e ti diciamo a che minuto ne esce.':
    'Recreational: the plan stays in no-deco, and we tell you when it leaves.',
  rientro: 'turn',
  'rientro a': 'turn at',
  'riferimento giornaliero': 'daily reference',
  'Riparti dai tessuti del': 'Starting from the tissues of',
  Risalita: 'Ascent',
  'risalita che ne risulta': 'resulting ascent rate',
  'Risalita d’emergenza': 'Emergency ascent',
  'Risalita, soste e limite di PPO2': 'Ascent, stops and ppO2 limit',
  riserva: 'reserve',
  'Riserva e regola di rientro': 'Reserve and turn rule',
  'riserva esclusa': 'reserve not counted',
  'Riserva fissa': 'Fixed reserve',
  'rispettando ogni sosta': 'if you hold every stop',
  ritorno: 'back',
  Ruolo: 'Role',
  'Ruolo di': 'Role of',
  salata: 'salt',
  Salvato: 'Saved',
  Scarica: 'Download',
  'scelta da te, indipendente dalla profondità': 'your choice, whatever the depth',
  Scenario: 'Scenario',
  'Se qualcosa cambia': 'If something changes',
  'Se scendi più giù': 'If you go deeper',
  'se tutto va come previsto': 'if all goes to plan',
  Seconda: 'Second',
  'secondo il modello, non secondo le didattiche': 'per the model, not per the agencies',
  'Sei sceso più giù, sei rimasto più a lungo, tutt’e due, o hai perso un gas. Il momento di sapere quanto costano è adesso.':
    'You went deeper, stayed longer, both, or lost a gas. Now is the time to know what they cost.',
  'senza sito': 'no dive site',
  Setpoint: 'Setpoint',
  'Si passa a': 'Switch to',
  'sicurezza, non obbligatoria': 'safety, not mandatory',
  Solo: 'Only',
  'Solo per il gas d’emergenza: quella pianificata la decide la durata totale.':
    'Bailout gas only: the planned rate comes from the total runtime.',
  'solo per riempire il circuito in discesa': 'only to fill the loop on descent',
  'sopra 1.6': 'above 1.6',
  Sosta: 'Stop',
  'Sosta di sicurezza': 'Safety stop',
  Soste: 'Stops',
  soste: 'stops',
  'soste comprese': 'stops included',
  'Soste deco pianificate': 'Planned deco stops',
  'sotto i': 'below',
  'Sposta l’intervallo di superficie e guarda cosa cambia: la prima immersione resta uguale, paga la seconda.':
    'Move the surface interval and watch: the first dive never changes, the second pays.',
  'Stampa il piano (PDF)': 'Print the plan (PDF)',
  'Stessa attrezzatura e stesse miscele. Se cambi anche quelle, meglio due piani separati.':
    'Same gear, same mixes. If those change too, make two separate plans.',
  'Stessi gradient factor della curva qui sopra': 'Same gradient factors as the no-deco limit above',
  'Stesso profilo, due teorie sulle bolle: VPM-B mette le soste più in profondità e ne toglie in superficie. Non c’è un vincitore.':
    'Same profile, two theories about bubbles: VPM-B puts stops deeper and takes them off shallow. There is no winner.',
  'Su iPhone e iPad la stampa non c’è. Stampa il piano dal Mac: i dati sono gli stessi.':
    'Printing is not available on iPhone or iPad. Print from the Mac: same data.',
  'Su questo profilo il calcolo non arriva a un risultato stabile':
    'On this profile the calculation does not settle',
  'su una bombola da': 'on a cylinder of',
  sui: 'of the',
  'sul gas del fondo. È il piano minimo: con un gas di deco dedicato sarebbero più corte.':
    'on bottom gas. This is the bare plan: a dedicated deco gas would shorten the stops.',
  'Sul nostro VPM-B': 'About our VPM-B',
  Tabella: 'Table',
  'Tabelle NOAA. Il CNS si dimezza ogni 90 minuti in superficie, gli OTU no.':
    'NOAA tables. CNS halves every 90 surface minutes, OTU does not.',
  Tecnica: 'Technical',
  'Tecnica: la deco è prevista, con la tabella delle soste e i gas che porti.':
    'Technical: deco is planned, with the stop table and the gases you carry.',
  'Tempo alla massima': 'Time at max depth',
  'Tempo di cambio gas': 'Gas switch time',
  'Tempo di fondo': 'Bottom time',
  'Tempo di fondo che il gas consente, al variare della profondità.':
    'Bottom time the gas allows, against depth.',
  'tempo di fondo consentito al variare del consumo.': 'bottom time allowed, against RMV.',
  'Tempo sopra 1.4 bar': 'Time above 1.4 bar',
  'Terzi — subacquea tecnica': 'Thirds — technical diving',
  terzo: 'third',
  'Ti serve': 'You need',
  Togli: 'Remove',
  Totale: 'Total',
  transito: 'travel',
  Tratto: 'Leg',
  'tre volte su quattro consumi meno di così': 'three dives out of four use less',
  'troppo poche per filtrare sulla durata': 'too few to filter on duration too',
  'Ultima sosta': 'Last stop',
  'Un terzo all’andata, uno al ritorno, uno di margine.': 'One third out, one back, one spare.',
  'Una riga per tratto, con il runtime a fine tratto: è il numero da scrivere sulla lavagnetta.':
    'One row per leg, with runtime at its end: that is the number for the slate.',
  'una sola immersione': 'a single dive',
  'Usa nel piano': 'Use in the plan',
  'usciresti con': 'you would surface on',
  'Uscita più bassa': 'Lowest end pressure',
  'uscita prevista': 'expected end',
  'Uscita prevista': 'Expected on surfacing',
  'Uscita tipica': 'Typical end pressure',
  Utilizzabile: 'Usable',
  utilizzabile: 'usable',
  vale: 'is worth',
  'Velocità di risalita in emergenza': 'Emergency ascent rate',
  'Volume del circuito': 'Loop volume',
  'Volume in litri': 'Volume in litres',
  'Zero se scendi da solo. Se è più alto del tuo, il piano usa il suo.':
    'Zero if you dive solo. If higher than yours, the plan uses theirs.',
  'Zero: il fondo vale tutto alla media.': 'Zero: the whole bottom counts at the average.',
  'È questa che consuma il gas del fondo, non la massima.':
    'This is what burns the bottom gas, not max depth.',
  'È questa che consuma il gas del fondo. Nelle tue immersioni sta al':
    'This is what burns the bottom gas. On your dives it sits at',

  // --- saturazione dei compartimenti ---
  '(quelli che avevi impostato)': '(the ones you had set)',
  'Azoto d’ingresso': 'Nitrogen on entry',
  'bar sopra l’equilibrio, dopo': 'bar above equilibrium, after',
  Carico: 'Load',
  Comanda: 'Leading',
  comanda: 'leading',
  compartimenti: 'compartments',
  compartimento: 'compartment',
  Compartimento: 'Compartment',
  'Compartimento che comanda': 'Leading compartment',
  Con: 'With',
  'da tessuti puliti saresti uscito al': 'from clean tissues you would have surfaced at',
  'del gradiente ammesso': 'of the allowed gradient',
  'di obbligo': 'of deco',
  'di pausa sono bastati': 'of surface interval were enough',
  'di superficie': 'of surface interval',
  'E se avessi usato altri gradient factor?': 'What if you had used other gradient factors?',
  'entrata con i tessuti a riposo': 'entered on rested tissues',
  Esito: 'Outcome',
  'fuori curva': 'into deco',
  'GF99 all’uscita': 'GF99 on surfacing',
  'GF99 massimo': 'Peak GF99',
  'Gradiente usato': 'Gradient used',
  'I sedici compartimenti all’uscita': 'The sixteen compartments on surfacing',
  'I sedici compartimenti di Bühlmann all’uscita': 'The sixteen Bühlmann compartments on surfacing',
  'il computer scrive': 'your computer says',
  'il picco, non solo l’uscita': 'the peak, not just the exit',
  'Il profilo riletto con Bühlmann ZH-L16C, contando l’azoto dell’immersione precedente.':
    'The profile replayed with Bühlmann ZH-L16C, counting nitrogen from the previous dive.',
  'Il residuo non ha inciso.': 'Residual nitrogen made no difference.',
  'il tuo computer non lo registra': 'your computer does not record it',
  Impostazione: 'Setting',
  'invece del': 'instead of',
  limite: 'limit',
  'Limite con GF': 'Limit with GF',
  'limite con GF': 'limit with GF',
  'L’intervallo di superficie è costato': 'The surface interval cost',
  'Manca anche la profondità media: qui è usato il 70% della massima. Scrivila nella scheda e la stima migliora.':
    'Average depth is missing too: 70% of max is used. Enter it on the dive and the estimate improves.',
  'Minuti in obbligo': 'Minutes in deco',
  'Nessun compartimento calcolato.': 'No compartment calculated.',
  'Nessun compartimento oltre il limite.': 'No compartment over its limit.',
  'nessuna pausa registrata': 'no surface interval recorded',
  'Niente profilo registrato: i numeri qui sotto vengono da un profilo ricostruito.':
    'No recorded profile: the numbers below come from a reconstructed one.',
  'non calcolato': 'not calculated',
  'Numeri stimati.': 'Estimated numbers.',
  'Ogni barra è un compartimento, dal più veloce al più lento: la tacca scura è il valore M, quella chiara il limite dei tuoi gradient factor. Comanda la barra più vicina alla sua tacca.':
    'Each bar is a compartment, fastest to slowest: the dark tick is the M-value, the light one your gradient factor limit. The bar closest to its tick leads.',
  'Oltre il limite': 'Over the limit',
  ora: 'hour',
  'Più carico': 'Most loaded',
  'pressione in superficie': 'surface pressure',
  punti: 'points',
  'saresti andato in deco': 'you would have gone into deco',
  'saresti rimasto': 'you would have stayed',
  Saturazione: 'Saturation',
  'Sei uscito al': 'You surfaced at',
  Semiperiodo: 'Half-time',
  'Senza campioni il carico si calcola su un profilo quadro, ricavato da durata e profondità media: più la tua immersione era multilivello, meno il numero è preciso.':
    'Without samples the load is computed on a square profile from duration and average depth: the more multilevel your dive was, the less exact the number.',
  'Sposta i cursori e guarda se l’immersione sarebbe rimasta in curva. I gradient factor spostano il tetto, non il GF99.':
    'Move the sliders and see if the dive would have stayed no-deco. Gradient factors move the ceiling, not GF99.',
  'tessuto lento: esposizione prolungata o più giorni di fila': 'slow tissue: long exposure or days in a row',
  'tessuto medio: immersione lunga, o ripetitiva': 'medium tissue: long dive, or repetitive',
  'tessuto veloce: il caso più comune in ricreativa': 'fast tissue: the usual recreational case',
  'tessuto velocissimo: immersione corta e profonda': 'very fast tissue: short and deep dive',
  'Valore M': 'M-value',
  'valore M': 'M-value',

  // --- grafici, e quello che ne sente chi non li vede ---
  a: 'at',
  'A zero': 'At zero',
  al: 'to',
  'al crescere di': 'as',
  'al minuto': 'at minute',
  'al variare di': 'against',
  'Andamento nel tempo': 'Trend over time',
  'Barre orizzontali': 'Horizontal bars',
  Bombola: 'Cylinder',
  Bussola: 'Heading',
  campioni: 'samples',
  Colonna: 'Column',
  con: 'on',
  Correlazione: 'Correlation',
  'Correlazione non calcolabile su così pochi punti.': 'Correlation not computable on so few points.',
  'cursore non posizionato, usa le frecce.': 'cursor not placed, use the arrow keys.',
  'Cursore non posizionato: usa le frecce.': 'Cursor not placed: use the arrow keys.',
  Curva: 'Curve',
  'curva piatta': 'flat curve',
  da: 'from',
  dal: 'since',
  'Dati insufficienti per disegnare la curva.': 'Not enough data to draw the curve.',
  debole: 'weak',
  Dispersione: 'Scatter',
  'distribuzione dei due assi': 'distribution of both axes',
  e: 'and',
  forte: 'strong',
  'Frecce per muovere il cursore, Maiusc per saltare di un minuto, Inizio e Fine agli estremi.':
    'Arrows move the cursor, Shift jumps a minute, Home and End to the ends.',
  'Frecce per muovere il cursore.': 'Arrows move the cursor.',
  'il più profondo': 'deepest',
  'Immersione senza profilo campionato.': 'Dive with no sampled profile.',
  in: 'in',
  'in aumento': 'rising',
  'in diminuzione': 'falling',
  'in funzione di': 'against',
  'In orizzontale': 'Horizontal',
  'In verticale': 'Vertical',
  'Istogramma a colonne': 'Column chart',
  Massima: 'Max',
  massimo: 'max',
  Massimo: 'Max',
  media: 'average',
  Mediana: 'Median',
  'metà dei punti fra': 'half the points between',
  Minimo: 'Minimum',
  minimo: 'min',
  minuti: 'minutes',
  'minuti su': 'minutes over',
  minuto: 'minute',
  moderata: 'moderate',
  'Mostrate le prime': 'Showing the first',
  'Nel punto marcato': 'At the marked point',
  'Nessun dato da mostrare.': 'No data to show.',
  'Nessun dato disponibile per questa serie.': 'No data for this series.',
  'Nessun obbligo di decompressione nel profilo.': 'No deco obligation in the profile.',
  'Nessun punto da confrontare.': 'No points to compare.',
  'nessun valore registrato.': 'no value recorded.',
  Periodo: 'Period',
  'Prima metà': 'First half',
  'Profilo di': 'Profile of',
  'Profilo di profondità': 'Depth profile',
  'Questa immersione non ha un profilo campionato.': 'This dive has no sampled profile.',
  riferimento: 'reference',
  rilevazione: 'reading',
  Rilevazioni: 'Readings',
  rilevazioni: 'readings',
  'seconda metà': 'second half',
  Segnalibri: 'Bookmarks',
  segnalibri: 'bookmarks',
  segnalibro: 'bookmark',
  'Servono almeno tre immersioni con entrambe le misure.': 'Three dives with both measures are needed.',
  'Si va da': 'Goes from',
  sopra: 'above',
  'sosta di sicurezza': 'safety stop',
  stabile: 'flat',
  su: 'of',
  'sul computer': 'on the computer',
  Tappa: 'Stop',
  Temperatura: 'Temperature',
  'Temperatura da': 'Temperature from',
  'tende a calare': 'tends to fall',
  'tende a crescere': 'tends to rise',
  tetto: 'ceiling',
  Tetto: 'Ceiling',
  'Tetto di decompressione': 'Deco ceiling',
  'Tetto di decompressione presente dal minuto': 'Deco ceiling from minute',
  totale: 'total',
  tratteggiato: 'dashed',
  'ultimo valore': 'last value',
  Valore: 'Value',
  valore: 'value',
  'Valore finale': 'Final value',
  'valori campionati': 'sampled values',
  'valori raggruppati per periodo': 'values grouped by period',
  Voce: 'Entry',
  'voci su': 'entries of',

  // --- moduli, conferme, scelte ---
  acciaio: 'steel',
  "Aggiungi un'immersione a mano": 'Add a dive by hand',
  'Aggiungi una bombola': 'Add a cylinder',
  'al modello': 'to model',
  alluminio: 'aluminium',
  Annulla: 'Cancel',
  apnea: 'freediving',
  Aprila: 'Open it',
  Attrezzatura: 'Gear',
  Bombole: 'Cylinders',
  "C'è già un'immersione con questo orario, profondità e durata. Salvando, i tuoi dati riempiono i campi vuoti di quella.":
    'There is already a dive with this time, depth and duration. Saving fills its empty fields with your data.',
  carbonio: 'carbon',
  'chi vi ha portati': 'who took you down',
  Chiudi: 'Close',
  'circuito aperto': 'open circuit',
  Compagno: 'Buddy',
  Condizioni: 'Conditions',
  'cosa hai visto, cosa è andato storto, cosa cambieresti':
    'what you saw, what went wrong, what you would change',
  'da dimenticare': 'forgettable',
  'dal file': 'from the file',
  'Data e ora del posto': 'Local date and time',
  'di quelle che si raccontano': 'one you tell stories about',
  'dolce (lago)': 'fresh (lake)',
  "Dove, con chi, com'è andata": 'Where, with whom, how it went',
  "e i litri d'acqua si compilano da soli.": 'and the water capacity fills itself in.',
  Elio: 'Helium',
  'Era già in archivio: i tuoi dati hanno riempito i campi vuoti di quella.':
    'It was already in the logbook: your data filled its empty fields.',
  'Erogatore principale': 'Primary regulator',
  Fine: 'End',
  'Gas e consumo': 'Gas and consumption',
  'GAV o sacco': 'BCD or wing',
  'Guida sub': 'Dive guide',
  'I primi tre campi bastano per salvare. Il resto migliora i calcoli.':
    'The first three fields are enough to save. The rest improves the numbers.',
  'il logbook le mostra comunque': 'the logbook still shows them all',
  'Immersione aggiunta.': 'Dive added.',
  Impostazioni: 'Settings',
  'in inventario': 'in your gear',
  Inizio: 'Start',
  "L'immersione": 'The dive',
  "L'immersione era in un altro fuso orario": 'The dive was in another time zone',
  "Litri d'acqua": 'Water capacity',
  Mare: 'Sea',
  Materiale: 'Material',
  matricola: 'serial',
  Meteo: 'Weather',
  'metti in attrezzatura': 'add to gear',
  Modalità: 'Mode',
  'Modifica dati': 'Edit dive',
  Muta: 'Wetsuit',
  'nel periodo': 'in the period',
  'non data': 'not rated',
  'non registrata': 'not recorded',
  'non registrato': 'not recorded',
  'non so': 'unknown',
  'non sovrascrive': 'does not overwrite',
  normale: 'ordinary',
  Note: 'Notes',
  'notturna al relitto': 'night dive on the wreck',
  'Nuova immersione': 'New dive',
  ore: 'hours',
  Ossigeno: 'Oxygen',
  parola: 'word',
  parole: 'words',
  'Per l’assetto zavorra e piastra contano insieme: l’app le somma.':
    'For trim they count together: the app adds them up.',
  'Per quelle senza file: computer a noleggio, batteria scarica, libretto di carta.':
    'For dives with no file: rental computer, flat battery, paper logbook.',
  'per trenta giorni. Dopo sparisce da tutti i dispositivi.':
    'for thirty days. After that it is gone from every device.',
  'Periodo considerato': 'Period covered',
  'Peso totale, zavorra più piastra:': 'Total weight, lead plus backplate:',
  'Piastra o schienalino': 'Backplate',
  'Piastra o schienalino (kg)': 'Backplate (kg)',
  'più vecchie, fuori dai conti': 'older, left out of the maths',
  'Poche immersioni: le medie sono fragili. Allarga la finestra.':
    'Few dives: the averages are fragile. Widen the window.',
  'Pressione finale': 'End pressure',
  'Pressione iniziale': 'Start pressure',
  profondimetro: 'gauge',
  'Profondità massima': 'Max depth',
  'Profondità media': 'Average depth',
  'Quando, quanto giù, quanto a lungo': 'When, how deep, how long',
  'Quello che hai scritto è ancora qui.': 'What you typed is still here.',
  'Quello che il computer non misura. Un import successivo':
    'What the computer does not measure. A later import',
  'questi campi.': 'these fields.',
  'Recuperabile dalle': 'Recoverable from',
  Rigenera: 'Regenerate',
  Rimuovi: 'Remove',
  Salva: 'Save',
  'Salva immersione': 'Save dive',
  'Salvataggio non riuscito:': 'Could not save:',
  'Salvato.': 'Saved.',
  'Salvo…': 'Saving…',
  'Scarto da UTC': 'UTC offset',
  'scegli o scrivi': 'pick or type',
  'scrivi il nome': 'type the name',
  'Scrivi una sigla —': 'Write a size —',
  'Se te la ricordi, scrivila: decide quanto azoto passa all’immersione dopo. Senza, si usa il 70% della massima.':
    'Write it if you remember it: it decides how much nitrogen carries over. Without it, 70% of max is assumed.',
  'Secondo erogatore': 'Second regulator',
  "Serve a mettere l'immersione nell'ora giusta del posto.": 'Puts the dive at the right local time.',
  'Si può salvare lo stesso, ma:': 'You can save anyway, but:',
  'Sigla o descrizione': 'Size or description',
  Sito: 'Site',
  'Sposta nel cestino': 'Move to trash',
  'Svuota il modulo': 'Clear the form',
  'Sì, sposta nel cestino': 'Yes, move to trash',
  'Temperatura minima': 'Min temperature',
  Titolo: 'Title',
  'Togli questa bombola': 'Remove this cylinder',
  'Unisci a quella esistente': 'Merge into the existing one',
  Valutazione: 'Rating',
  'verrà tolto da tutte le immersioni scelte': 'it will be removed from every selected dive',
  Visibilità: 'Visibility',
  'Volume bombola': 'Cylinder volume',
  'Volume e le due pressioni danno l’RMV, il consumo riportato alla superficie. Se ne manca uno, questa immersione resta fuori dalle statistiche sul consumo.':
    'Volume and both pressures give your RMV, consumption normalised to the surface. Miss one and this dive stays out of the consumption stats.',
  Voto: 'Rating',
  Zavorra: 'Weight',
  'Zavorra (kg)': 'Weight (kg)',

  // --- impostazioni: accesso, sincronizzazione, cestino, backup ---
  'Accedi con Google': 'Sign in with Google',
  'Accedi con Apple o con Google, oppure configura indirizzo e token del database.':
    'Sign in with Apple or Google, or set the database address and token.',
  'Accedi qui sopra e il pulsante si accende.': 'Sign in above and this button lights up.',
  Accesso: 'Sign in',
  'Accesso in corso…': 'Signing in…',
  'Aggiorna credenziali': 'Update credentials',
  aggiornate: 'updated',
  aggiunte: 'added',
  'Archivio locale, in chiaro.': 'Local storage, in the clear.',
  'arricchite, senza perdere quello che hai scritto tu': 'enriched, keeping what you wrote',
  'Attrezzatura, brevetti, piani e analisi si fondono; a parità di voce vince la più recente.':
    'Gear, certifications, plans and analyses merge; on the same entry the newest wins.',
  'Avanzate: collegare un database a mano': 'Advanced: connect a database by hand',
  'Backup completo e ripristino': 'Full backup and restore',
  'Backup del': 'Backup of',
  'Backup scritto': 'Backup written',
  'campioni conservati': 'samples kept',
  'Cancella il database remoto e le immersioni che contiene. Quelle su questo dispositivo restano.':
    'Deletes the remote database and the dives on it. The ones on this device stay.',
  'Cancella le': 'Deletes the',
  'Cancella l’account': 'Delete the account',
  'Cancellare definitivamente': 'Permanently delete',
  'Cancellare questa immersione su tutti i dispositivi? Non si torna indietro.':
    'Delete this dive on every device? There is no undo.',
  Cancellata: 'Deleted',
  caricate: 'pushed',
  Cestino: 'Trash',
  'che avevi solo qui sono rimaste dov’erano.': 'you only had here stayed where they were.',
  'che hai adesso,': 'you have now,',
  'che hai solo qui': 'you only have here',
  'col loro profilo. Finché sono qui, «Rimetti a posto» le riporta com’erano.':
    'with their profile. While they are here, “Put back” restores them as they were.',
  'Come ottenere le credenziali': 'How to get the credentials',
  'comprese quelle che il backup non contiene': 'including the ones the backup does not hold',
  'con i loro profili: svuotarlo libera spazio e rende definitive le cancellazioni.':
    'with their profiles: emptying it frees space and makes the deletions final.',
  'Con un account Apple o Google l’app crea un database tuo: gli altri dispositivi si allineano con lo stesso account.':
    'With a Google account the app makes a database of your own: other devices line up with the same account.',
  'Connessione riuscita.': 'Connected.',
  'Cosa fa e cosa non fa': 'What it does and what it doesn’t',
  'Definitiva fra': 'Final in',
  Dimentica: 'Forget',
  'Dopo la sincronizzazione ogni dispositivo ha tutti e due.': 'After a sync every device has both.',
  'e non si torna indietro.': 'and there is no undo.',
  Esci: 'Sign out',
  'Esporta l’archivio': 'Export your logbook',
  esportate: 'exported',
  'File di backup da ripristinare': 'Backup file to restore',
  'Finché un’immersione è nel cestino resta solo qui. Svuotandolo, sparisce ovunque.':
    'While a dive is in the trash it stays on this device. Empty the trash and it goes everywhere.',
  'Fondi con quello che c’è (consigliato)': 'Merge with what is here (recommended)',
  'giorni, poi la cancellazione diventa definitiva su tutti i dispositivi.':
    'days, then the deletion becomes final on every device.',
  'già presenti verranno': 'already here will be',
  'Il backup è una copia da tenere altrove.': 'The backup is a copy to keep somewhere else.',
  'Il cestino contiene': 'The trash holds',
  'Il file non è JSON valido': 'The file is not valid JSON',
  'il logbook funziona anche senza.': 'the logbook works without it.',
  'immersione cancellata': 'deleted dive',
  'immersioni cancellate': 'deleted dives',
  'immersioni verranno aggiunte': 'dives will be added',
  'immersioni, profili, attrezzatura, brevetti, piani e analisi. Le credenziali restano fuori.':
    'dives, profiles, gear, certifications, plans and analyses. Credentials stay out.',
  impostazioni: 'settings',
  'impostazioni riscritte': 'settings rewritten',
  'impostazioni verranno riscritte': 'settings will be rewritten',
  'in tutti e due i casi.': 'either way.',
  'incolla qui il token di Turso': 'paste your Turso token here',
  'Indirizzo del database': 'Database address',
  'La cancellazione si propaga a': 'The deletion spreads to',
  'La prima sincronizzazione carica l’archivio; sugli altri dispositivi lo scarica.':
    'The first sync uploads your logbook; on other devices it downloads it.',
  'La stessa immersione importata su due dispositivi resta una.':
    'The same dive imported on two devices stays one dive.',
  'Le cancellazioni viaggiano, il cestino no.': 'Deletions travel, the trash does not.',
  'Le credenziali no.': 'Credentials do not.',
  'Le immersioni sì. Riprova, e se l’errore torna segnalalo.':
    'Your dives did. Try again, and report it if the error comes back.',
  'Le legge solo questa app, e non finiscono nei backup.':
    'Only this app can read them, and they stay out of backups.',
  'L’archivio vive in': 'Your logbook lives in',
  'Nel browser non c’è un portachiavi. Sull’app desktop ci finiscono.':
    'A browser has no keychain. On the desktop app they go into one.',
  'Non duplica.': 'No duplicates.',
  'Non passano dal cestino e non si torna indietro.': 'They skip the trash and there is no undo.',
  'Non è obbligatorio': 'Not required',
  'Portachiavi di sistema.': 'System keychain.',
  'Preparazione…': 'Preparing…',
  'Prima scarica, poi carica. Niente viene cancellato.': 'Pulls first, then pushes. Nothing is deleted.',
  'Prova la connessione': 'Test the connection',
  'Queste impostazioni non si sono allineate.': 'These settings did not sync.',
  'Resta su questo dispositivo: va solo a Turso.': 'Stays on this device: it only goes to Turso.',
  restano: 'stay',
  'Restano fuori': 'Left out',
  'resteranno dove sono': 'will stay where they are',
  'Ricostruisci da zero': 'Rebuild from scratch',
  'Riepilogo e profilo viaggiano separati.': 'Summary and profile travel apart.',
  'Rimettere in archivio': 'Put back in the logbook',
  'Rimetti a posto': 'Put back',
  'Rimetti a posto tutte': 'Put them all back',
  Ripristina: 'Restore',
  'Ripristina da un file…': 'Restore from a file…',
  'Ripristino fatto': 'Restore done',
  'Ripristino…': 'Restoring…',
  'Salva credenziali': 'Save credentials',
  'Salva le credenziali prima di sincronizzare.': 'Save your credentials before syncing.',
  'Scarica il backup': 'Download the backup',
  'Scarica UDDF': 'Download UDDF',
  scaricate: 'pulled',
  'Se hai fatto l’accesso, lascia questi campi vuoti.': 'If you signed in, leave these fields empty.',
  'Se hai già scaricato un computer da un dispositivo, gli altri prendono solo le immersioni nuove.':
    'If you already downloaded a computer on one device, the others only take the new dives.',
  'Se è un UDDF, va nella scheda Importa.': 'If it is a UDDF, it goes in the Import tab.',
  'Sei entrato come': 'Signed in as',
  'Sei entrato. L’app sincronizza sul database del tuo account.':
    'Signed in. The app syncs to your account database.',
  'Sempre lì, «Create Token»: compare una volta sola, copialo e incollalo qui sopra.':
    'Same place, “Create Token”: it shows once, copy it and paste it above.',
  'senza profilo': 'no profile',
  'Si apre il browser di sistema: la password la scrivi al fornitore, non a noi.':
    'Your system browser opens: you type the password to the provider, not to us.',
  Sincronizza: 'Sync',
  'Sincronizza ora': 'Sync now',
  'Sincronizzare due volte di fila non fa niente la seconda volta.':
    'Syncing twice in a row does nothing the second time.',
  'Sincronizzazione in corso…': 'Syncing…',
  'Solo riepiloghi': 'Summaries only',
  'Solo se il database te lo sei creato tu su Turso.': 'Only if you made your own database on Turso.',
  'sostituite con la versione del file': 'replaced with the file version',
  'Su iPhone il file va nell’app File, in «Sul mio iPhone → MyDiveLog».':
    'On iPhone the file goes to the Files app, under “On My iPhone → MyDiveLog”.',
  'Su turso.tech apri il database e copia l’indirizzo':
    'On turso.tech open the database and copy the address',
  'Svuota il cestino': 'Empty the trash',
  'Sì, cancella il database remoto': 'Yes, delete the remote database',
  'Sì, ricostruisci da zero': 'Yes, rebuild from scratch',
  'Sì, rimetti': 'Yes, put back',
  'Token di accesso': 'Auth token',
  'Tornano com’erano, profilo compreso.': 'They come back as they were, profile included.',
  'tutti i dispositivi': 'every device',
  tutto: 'everything',
  'Un file JSON con': 'A JSON file with',
  'Uscire smette solo di sincronizzare. Le immersioni di questo dispositivo':
    'Signing out only stops syncing. The dives on this device',
  'Verifica…': 'Checking…',
  'verranno cancellate': 'will be deleted',
  'Viaggia anche fin dove sei arrivato con ogni computer.': 'So does how far each dive computer got.',
  'Viaggia anche quello che hai scritto a mano.': 'What you typed travels too.',
  'Vuoto. Quello che cancelli resta qui': 'Empty. What you delete stays here',

  /* --- chiavi che arrivano da tabelle di costanti
   *
   * Non compaiono in nessun `t('…')` scritto per esteso: sono etichette
   * definite in `src/core` o in una costante a modulo e passate a `t()` al
   * disegno. Cercarle con grep non le trova — sono qui apposta. */
  'da 1 a 3 m': '1 to 3 m',
  'da 10 a 15 m': '10 to 15 m',
  'da 15 a 25 m': '15 to 25 m',
  'da 25 a 40 m': '25 to 40 m',
  'da 3 a 5 m': '3 to 5 m',
  'da 5 a 10 m': '5 to 10 m',
  'meno di 1 m — non si vede niente': 'less than 1 m — nothing to see',
  'oltre 40 m — acqua tropicale': 'over 40 m — tropical water',
  '+3 metri sulla massima, con la media che segue': '+3 m on max depth, average follows',
  '+5 minuti sul fondo, tutto il resto uguale': '+5 min on the bottom, everything else the same',
  '3 metri più giù': '3 metres deeper',
  '5 minuti in più': '5 minutes longer',
  'A — Aria': 'A — Air',
  'acqua dolce': 'fresh water',
  'acqua salata': 'salt water',
  aggiunta: 'added',
  almeno: 'at least',
  Altro: 'Other',
  'Anche soste brevi e pianificate, sotto supervisione.': 'Short planned stops under supervision count too.',
  'Ancora niente da confrontare': 'Nothing to compare yet',
  Apnea: 'Freediving',
  Aria: 'Air',
  'Assetto e consumo': 'Buoyancy and RMV',
  'Assetto, consumo e ripetibilità, senza un traguardo specifico.':
    'Trim, gas use and consistency, with no specific target.',
  'Avanzato (fino a 30 m)': 'Advanced (to 30 m)',
  Batteria: 'Battery',
  Bene: 'Good',
  'Bombole non registrate': 'Cylinders not logged',
  'buon assetto': 'good buoyancy',
  'cambio gas': 'gas switch',
  Caricate: 'Pushed',
  'Ce n’è una sola. Il confronto mette due profili sullo stesso grafico.':
    'There is only one. Comparing puts two profiles on the same chart.',
  'Circuito aperto': 'Open circuit',
  'circuito aperto, ricreativo': 'open circuit, recreational',
  'circuito aperto, tecnico': 'open circuit, technical',
  'circuito chiuso': 'closed circuit',
  'CNS calcolato': 'CNS computed',
  'Collaudo idraulico': 'Hydro test',
  colonne: 'columns',
  'Comprato il': 'Bought on',
  comune: 'common',
  'Con una sosta profonda': 'With a deep stop',
  'Consolidare la fascia 30–40 m in curva, con margini di gas ampi.':
    'Settle into 30–40 m no-deco, with wide gas margins.',
  'consumo (L/min)': 'RMV (L/min)',
  'Consumo e profondità media': 'RMV and average depth',
  'Consumo e temperatura': 'RMV and temperature',
  'Consumo gas': 'Gas use',
  'Continuità: conta più del totale storico.': 'Currency: counts more than the lifetime total.',
  'Contropiastra o schienalino': 'Backplate or pad',
  coperto: 'overcast',
  Critico: 'Critical',
  'da fare': 'to do',
  'Da migliorare': 'To improve',
  Dolce: 'Fresh',
  'Due bombole': 'Two cylinders',
  'Due stagioni a confronto: utile per vedere se un cambiamento è durato.':
    'Two seasons side by side: shows whether a change stuck.',
  Erogatore: 'Regulator',
  'Esperienza e continuità': 'Experience and currency',
  Fondo: 'Bottom',
  'Fondo alla massima': 'Bottom at max depth',
  'Fondo più corto': 'Shorter bottom',
  'Fondo più lungo': 'Longer bottom',
  Gas: 'Gas',
  'Gas di decompressione perso': 'Deco gas lost',
  Gauge: 'Gauge',
  'Gestione del problema sul fondo': 'Problem solving on the bottom',
  'Già allineate': 'Already in sync',
  'i due insieme: è lo scenario peggiore che il manuale chiede di avere in tasca':
    'both at once: the worst case the manual wants you to carry',
  'I suggerimenti si basano su medie e tendenze: con poche immersioni sarebbero rumore. Importa lo storico e torna qui.':
    'Coaching is based on averages and trends: with only a few dives it would be noise. Import your history and come back.',
  'Il freddo alza il consumo: qui vedi di quanto.': 'Cold raises RMV: here you see by how much.',
  'Il freddo fa consumare di più, quindi la muta e la temperatura dicono in parte la stessa cosa: guarda le due colonne insieme.':
    'Cold raises consumption, so wetsuit and temperature partly say the same thing: read the two columns together.',
  'Il meglio dei tuoi computer, in un logbook solo.': 'The best of every dive computer, in one logbook.',
  'Il picco su finestra di 30 secondi.': 'The peak over a 30-second window.',
  Illuminazione: 'Lights',
  'immersione aggiornata': 'dive updated',
  'immersioni aggiornate': 'dives updated',
  'Immersioni con decompressione pianificata, configurazione hogarthiana, gestione di più miscele.':
    'Planned deco dives, Hogarthian setup, several mixes to handle.',
  'Immersioni con risalite fuori limite': 'Dives with ascents over the limit',
  'Immersioni con soste decompressive': 'Dives with deco stops',
  'Immersioni in archivio': 'Dives in the logbook',
  'Immersioni negli ultimi 12 mesi': 'Dives in the last 12 months',
  'Immersioni oltre i 24 m': 'Dives past 24 m',
  'Immersioni oltre i 30 m': 'Dives past 30 m',
  'Immersioni registrate': 'Dives logged',
  Importa: 'Import',
  'Importa le immersioni e qui metti due profili sullo stesso grafico.':
    'Import your dives and this page puts two profiles on one chart.',
  Importante: 'Serious',
  'Impostazioni condivise': 'Shared settings',
  'Impostazioni di Sistema → Privacy e sicurezza → Bluetooth.':
    'System Settings → Privacy & Security → Bluetooth.',
  'Impostazioni → MyDiveLog → Bluetooth.': 'Settings → MyDiveLog → Bluetooth.',
  'Inserita a mano': 'Entered by hand',
  Istruttore: 'Instructor',
  'Jacket o sacco': 'BCD or wing',
  'La decompressione rifatta con i gas che restano.': 'Deco redone with the gases left.',
  'La durata deve essere maggiore di zero.': 'Duration must be greater than zero.',
  'La miscela non torna: ossigeno ed elio insieme non possono superare il 100%.':
    'The mix does not add up: oxygen and helium together cannot exceed 100%.',
  'La pressione finale non può essere maggiore di quella iniziale.':
    'End pressure cannot be higher than start pressure.',
  'La profondità massima deve essere maggiore di zero.': 'Max depth must be greater than zero.',
  'La profondità media non può essere maggiore della massima.':
    'Average depth cannot be greater than max depth.',
  'La stagione in corso. Poche immersioni, quindi tendenze fragili.':
    'The season so far. Few dives, so fragile trends.',
  'Le due cose insieme: è il caso che costa di più.': 'Both together: the case that costs most.',
  'le soste tornano sul gas di fondo, con il tuo consumo normale':
    'stops fall back on bottom gas, at your normal RMV',
  'Lettura in corso…': 'Reading…',
  'Litri al minuto riportati alla superficie. Solo dove il volume della bombola è noto.':
    'Litres per minute at the surface. Only where cylinder size is known.',
  'Litri e materiale non cambiano quanto respiri, cambiano quanto ti dura: se il consumo differisce, differiscono le immersioni in cui la porti.':
    'Size and material do not change how much you breathe, only how long it lasts: if RMV differs, so do the dives.',
  'Marca e modello': 'Make and model',
  'mare agitato': 'rough sea',
  'mare calmo': 'calm sea',
  'mare molto agitato': 'very rough sea',
  'mare mosso': 'moderate sea',
  'margine sottile': 'thin margin',
  Menu: 'Menu',
  'Metri verticali al minuto nei tratti in cui tieni la quota. Sotto 2 m/min è tenuta bene.':
    'Vertical metres per minute while holding depth. Under 2 m/min is well held.',
  'Miglioramento generale': 'General improvement',
  'Muoversi in verticale costa gas: se salgono insieme, lavora sull’assetto.':
    'Moving vertically costs gas: if both rise, work on buoyancy.',
  nebbia: 'fog',
  'Nel periodo scelto ce ne sono poche: allarga la finestra da Statistiche.':
    'Too few in the selected period: widen the window from Statistics.',
  'Nessuna manutenzione periodica': 'No scheduled service',
  neve: 'snow',
  'Nitrox / miscele': 'Nitrox / mixes',
  'Nome sulla tessera': 'Name on the card',
  'non oltre': 'no more than',
  Numero: 'Number',
  nuvoloso: 'cloudy',
  obiettivo: 'target',
  'Ogni quanti mesi': 'Every how many months',
  ok: 'ok',
  'oscillazione (m/min)': 'wobble (m/min)',
  'oscillazione a quota tenuta (m/min)': 'wobble at held depth (m/min)',
  OTU: 'OTU',
  'Parte profonda per prima': 'Deepest part first',
  'Subacquea Tecnica': 'Technical Diving',
  Peggiore: 'Worst',
  permissivo: 'permissive',
  Piastra: 'Plate',
  pioggia: 'rain',
  'Più giù e più a lungo': 'Deeper and longer',
  'Più lungo e più profondo': 'Longer and deeper',
  'Più profondo': 'Deeper',
  'Preso il': 'Issued on',
  'Pressione di esercizio': 'Working pressure',
  'Primo livello (fino a 18 m)': 'Entry level (to 18 m)',
  'Primo quartile': 'First quartile',
  'Profili caricati': 'Profiles pushed',
  'Profili scaricati': 'Profiles pulled',
  'profondità media (m)': 'average depth (m)',
  'Profondo (fino a 40 m)': 'Deep (to 40 m)',
  'Avanzato Ricreativo': 'Advanced Recreational',
  prudente: 'conservative',
  'Qualità dei dati': 'Data quality',
  'Quanto eri sovrasaturo arrivando in superficie. Dipende dai gradient factor che hai impostato.':
    'How supersaturated you were on surfacing. Depends on the gradient factors you set.',
  'quota da migliorare': 'depth to improve',
  'quota tenuta bene': 'depth held well',
  'R — Rotta': 'R — Route',
  Rebreather: 'Rebreather',
  'Rebreather a circuito chiuso': 'Closed-circuit rebreather',
  'Rebreather semichiuso': 'Semi-closed rebreather',
  'Resto del fondo': 'Rest of the bottom',
  Revisione: 'Overhaul',
  'Rimasto al fondo più del previsto.': 'Longer on the bottom than planned.',
  'Risalita fino alla sosta': 'Ascent to the stop',
  'S — Drill': 'S — Drill',
  Salata: 'Salt',
  Scaricate: 'Pulled',
  'Scegli file': 'Choose files',
  'Scegli i file dall’app File': 'Pick files from the Files app',
  'Sceso più del previsto sul primo livello.': 'Deeper than planned on the first level.',
  Sconosciuto: 'Unknown',
  'Scubapro via Bluetooth': 'Scubapro over Bluetooth',
  'Se il consumo cresce con la profondità, di solito è affaticamento o assetto.':
    'If RMV rises with depth, it is usually effort or buoyancy.',
  selezionata: 'selected',
  'selezionata non è in elenco': 'selected dive is not listed',
  selezionate: 'selected',
  'selezionate non sono in elenco': 'selected dives are not listed',
  semichiuso: 'semi-closed',
  'Senza le due pressioni e il volume della bombola il consumo non si può calcolare, e questa immersione resterà fuori dalle statistiche sul consumo.':
    'Without both pressures and the cylinder volume there is no RMV, and this dive stays out of the consumption stats.',
  'Senza profondità media i tessuti verranno stimati su un profilo quadro al 70% della massima. Se te la ricordi, scrivila: è il numero che decide quanto azoto passa all’immersione successiva.':
    'Without an average depth, tissues are estimated on a square profile at 70% of max. Write it if you remember it: it decides how much nitrogen carries over to the next dive.',
  'Senza temperatura questa immersione non entra nelle correlazioni fra freddo e consumo.':
    'Without a temperature this dive is left out of the cold-versus-consumption figures.',
  'Serve un valore noto e stabile: la pianificazione del gas si basa su questo.':
    'Needs a known, steady value: gas planning rests on it.',
  'Serve una data e un’ora: senza, l’immersione non ha posto nella catena delle ripetitive.':
    'A date and time are needed: without them the dive has no place in the repetitive chain.',
  'Servono due immersioni': 'Two dives needed',
  'Shearwater via Bluetooth': 'Shearwater over Bluetooth',
  Sicurezza: 'Safety',
  sole: 'sun',
  'solo PPO2': 'PPO2 only',
  sosta: 'stop',
  'Sosta di sicurezza completata': 'Safety stop completed',
  'sosta profonda': 'deep stops',
  'Soste (sicurezza e deco)': 'Stops (safety and deco)',
  'Soste di sicurezza completate': 'Safety stops completed',
  'Stato del mare': 'Sea state',
  'T — Tabelle': 'T — Tables',
  'T — Team': 'T — Team',
  'Tecnico (decompressione)': 'Tech (decompression)',
  'temperatura minima (°C)': 'min temperature (°C)',
  'Terzo quartile': 'Third quartile',
  Tipo: 'Type',
  'Trascina qui i file, o scegli dal disco': 'Drop files here, or pick from disk',
  'Troppa zavorra è la prima causa di assetto instabile.':
    'Too much weight is the first cause of unstable buoyancy.',
  'Tutte le immersioni. Le medie mescolano periodi diversi della tua storia, quindi descrivono la storia e non il presente.':
    'Every dive. The averages mix different eras, so they describe your history, not today.',
  'Tutto l’archivio': 'Whole logbook',
  'Ultima fatta': 'Last done',
  'Ultimi 24 mesi': 'Last 24 months',
  'Ultimi 6 mesi': 'Last 6 months',
  'Ultimo tratto': 'Final ascent',
  'Ultimo tratto in superficie': 'Last leg to the surface',
  'Un anno completo: copre tutte le stagioni e descrive come ti immergi adesso.':
    'A full year: every season, and how you dive now.',
  'Un erogatore ben regolato si respira meglio, ma la differenza che vedi qui è quasi sempre dove e quando lo usi.':
    'A well-tuned regulator breathes better, but what you see here is almost always where and when you use it.',
  'Una bombola': 'One cylinder',
  'Una durata sopra le cinque ore è quasi sempre un errore di battitura: controlla.':
    'A duration over five hours is almost always a typo: check it.',
  'Una profondità sopra i 100 metri è quasi sempre un errore di battitura: controlla.':
    'A depth over 100 metres is almost always a typo: check it.',
  'Uscite sotto i 50 bar': 'Exits below 50 bar',
  'Velocità di risalita di picco': 'Peak ascent rate',
  vento: 'wind',
  'Violazioni del tetto': 'Ceiling violations',
  'Violazioni del tetto deco': 'Deco ceiling violations',
  voci: 'entries',
  Volume: 'Volume',
  'Zavorra e assetto': 'Weight and buoyancy',
  'zavorra totale, piastra compresa (kg)': 'total weight, backplate included (kg)',
  "−5 minuti: la via d'uscita se qualcosa non va": '−5 min: the way out if something is off',
  /* Dove vive l'archivio: la frase la scrive `src/storage`, la si traduce dove
     si mostra. */
  'Archivio del browser (IndexedDB)': 'Browser storage (IndexedDB)',
  'File SQLite nella cartella dati dell’app': 'SQLite file in the app data folder',
  'Non inizializzato': 'Not initialised',
  /* Il percentile: «75°» in italiano, «75th» in inglese. */
  '75°': '75th',
  'm slm': 'm asl',
  // --- esportazione in CSV e KML ---
  'Foglio di calcolo (CSV)': 'Spreadsheet (CSV)',
  'Siti su mappa (KML)': 'Sites on a map (KML)',
  'siti senza coordinate': 'sites with no coordinates',
  'Tre strade per portare fuori le tue': 'Three ways to take your',
  'UDDF per un altro programma di immersioni, CSV per un foglio di calcolo, KML per una mappa.':
    'UDDF for another dive program, CSV for a spreadsheet, KML for a map.',
  'Non sono un backup': 'Not a backup',
  'lasciano fuori parecchi campi. Per una copia completa usa il backup.':
    'they leave out several fields. For a full copy use the backup.',
  sito: 'site',
  siti: 'sites',
  esportati: 'exported',

  // --- avvisi dei parser, registro della sincronizzazione, errori dell'archivio ---
  /* Non stanno in `src/ui`: li scrivono `src/core`, `src/storage` e `src/sync`,
     che ricevono la traduzione come parametro (vedi `src/core/traduci.ts`). */
  'Accesso non riuscito:': 'Sign-in failed:',
  "Alcune bombole non hanno il collegamento alla miscela (limite noto dell'export UDDF di Shearwater): assegnata la prima miscela definita.":
    'Some cylinders have no link to a gas mix (a known limit of the Shearwater UDDF export): the first mix defined was assigned.',
  "anomalie; l'import continua sui dati validi.": 'anomalies; the import carries on with the valid data.',
  'byte dedotta dal contenuto.': 'bytes inferred from the content.',
  'byte su': 'bytes out of',
  'Cancellazioni…': 'Deletions…',
  'Caratteristiche viste:': 'Characteristics seen:',
  Caricati: 'Pushed',
  'Colonne ignorate perché non riconosciute:': 'Columns ignored because unrecognised:',
  corrispondenze: 'matches',
  'CSV senza righe di dati.': 'CSV with no data rows.',
  'da caricare,': 'to push,',
  'da scaricare,': 'to pull,',
  'Database non inizializzato.': 'Database not initialised.',
  'Database non leggibile:': 'Database not readable:',
  'Decodifica disallineata: consumati': 'Decoding out of step: consumed',
  'Di solito significa che non è il computer che pensavamo, o che è in modalità aggiornamento firmware invece che in modalità trasferimento.':
    'Usually this means it is not the computer we thought, or that it is in firmware update mode instead of transfer mode.',
  'dichiarati. Il profilo potrebbe essere incompleto.': 'declared. The profile may be incomplete.',
  'era stata cancellata definitivamente': 'had been permanently deleted',
  'erano state cancellate definitivamente': 'had been permanently deleted',
  'Eventi del log non documentati, letti e non interpretati: codici':
    'Undocumented log events, read but not interpreted: codes',
  'File FIT vuoto.': 'Empty FIT file.',
  'File scritto da': 'File written by',
  'File vuoto.': 'Empty file.',
  'Formato non riconosciuto. Formati supportati:': 'Unrecognised format. Supported formats:',
  "fra l'orologio del computer e quello delle immersioni già in archivio":
    'between the computer clock and that of the dives already in the logbook',
  "fra l'orologio di questo computer e quello delle immersioni già in archivio":
    'between this computer clock and that of the dives already in the logbook',
  'già allineate.': 'already in sync.',
  'Il Bluetooth di questo dispositivo è spento. Accendilo e riprova.':
    'Bluetooth is off on this device. Turn it on and try again.',
  'Il Bluetooth non è disponibile in questa versione dell’applicazione:':
    'Bluetooth is not available in this build of the app:',
  'Il decoder FIT ha segnalato': 'The FIT decoder reported',
  'Il dispositivo non espone il servizio': 'The device does not expose service',
  'il file non dichiara durata né profondità massima, ricavate dai campioni. Se il file è stato scaricato a metà, questi numeri descrivono solo la parte arrivata.':
    'the file declares neither duration nor max depth, so both come from the samples. If the file was downloaded half way, these numbers describe only the part that arrived.',
  'Il FIT non contiene il volume della bombola e non è deducibile da tank_summary: inserisci i litri nella scheda per avere il consumo in L/min.':
    'The FIT has no cylinder volume and it cannot be derived from tank_summary: enter the litres on the dive to get the RMV in L/min.',
  'Il permesso di usare il Bluetooth è stato negato. Si concede in Impostazioni di Sistema, alla voce Privacy e sicurezza → Bluetooth.':
    'Permission to use Bluetooth was denied. Grant it in System Settings, under Privacy & Security → Bluetooth.',
  'Il permesso di usare il Bluetooth è stato negato. Si concede in Impostazioni → MyDiveLog → Bluetooth.':
    'Permission to use Bluetooth was denied. Grant it in Settings → MyDiveLog → Bluetooth.',
  'Il servizio': 'Service',
  'Il servizio ha risposto in un modo che non conosciamo.': 'The service answered in a way we do not know.',
  illeggibile: 'unreadable',
  'Immersione con data non interpretabile scartata:': 'Dive with an unreadable date discarded:',
  'Immersione del': 'Dive on',
  'immersione non è stata reimportata': 'dive was not re-imported',
  'Immersione scartata: data': 'Dive discarded: date',
  'Immersione senza <datetime> scartata.': 'Dive with no <datetime> discarded.',
  'Immersione senza attributo date scartata.': 'Dive with no date attribute discarded.',
  'Immersione Shearwater del': 'Shearwater dive on',
  'Immersione Shearwater senza startDate scartata.': 'Shearwater dive with no startDate discarded.',
  'immersioni cancellate altrove.': 'dives deleted elsewhere.',
  'immersioni con il profilo completo letto dal log nativo del computer: tetto deco, TTS, NDL, CNS e impostazioni GF.':
    'dives with the full profile read from the computer native log: deco ceiling, TTS, NDL, CNS and GF settings.',
  'immersioni hanno il profilo dal log nativo del computer; per le altre restano i soli dati di riepilogo.':
    'dives have the profile from the computer native log; for the others only the summary data is left.',
  'immersioni importate senza profilo: statistiche di consumo e assetto non disponibili per queste.':
    'dives imported without a profile: RMV and trim stats are not available for them.',
  'immersioni non hanno il profilo nel file (LogTRAK non lo esporta per le immersioni inserite a mano): restano i dati di sintesi.':
    'dives have no profile in the file (LogTRAK does not export one for dives entered by hand): only the summary data is left.',
  'immersioni non sono state reimportate': 'dives were not re-imported',
  'in un formato che non so leggere.': 'in a format I cannot read.',
  'JSON non valido:': 'Invalid JSON:',
  'La sessione è scaduta: rifai l’accesso.': 'Your session has expired: sign in again.',
  'le immersioni sono state unite comunque.': 'the dives were merged anyway.',
  'Lo scarico dal computer subacqueo funziona solo nell’applicazione, non nel browser: Safari non ha il Bluetooth per le pagine web, e gli altri browser lo espongono in un modo che non permette di parlare con questi dispositivi.':
    'Downloading from the dive computer works only in the app, not in the browser: Safari has no Bluetooth for web pages, and the other browsers expose it in a way that cannot talk to these devices.',
  'log nativo del computer non decodificabile': 'computer native log could not be decoded',
  'L’accesso funziona solo nell’applicazione: nel browser non c’è modo di ricevere il ritorno dal fornitore.':
    'Signing in works only in the app: in the browser there is no way to receive the callback from Google.',
  'L’accesso non è stato completato. Riprova quando vuoi.':
    'Sign-in was not completed. Try again whenever you like.',
  'Modello del computer non indicato: intestazione da': 'Computer model not stated: header of',
  'Nessun <diveLog> valido trovato nel file Shearwater.': 'No valid <diveLog> found in the Shearwater file.',
  'Nessun array "dives" nel file.': 'No "dives" array in the file.',
  'Nessuna colonna di data riconosciuta.': 'No date column recognised.',
  'Nessuna immersione in dive_details.': 'No dive in dive_details.',
  'Nessuna immersione nel file FIT.': 'No dive in the FIT file.',
  'Nessuna immersione trovata nel file Subsurface.': 'No dive found in the Subsurface file.',
  'Nessuna immersione trovata nel file UDDF.': 'No dive found in the UDDF file.',
  'Nessuna immersione valida nel file LogTRAK.': 'No valid dive in the LogTRAK file.',
  'non ha': 'has no',
  'Non si è potuto leggere l’elenco dei servizi del dispositivo:':
    'Could not read the list of services on the device:',
  'Passo di campionamento Shearwater non riconosciuto: i tempi sono interpretati come secondi.':
    'Shearwater sample interval not recognised: times are read as seconds.',
  'Per riaverle, rimettile a posto dal cestino in Impostazioni.':
    'To get them back, restore them from the trash in Settings.',
  perché: 'because',
  'PPO2 Shearwater riscalata di 100: il campo non è documentato in unità.':
    'Shearwater PPO2 rescaled by 100: the field has no documented unit.',
  'Preparazione del database remoto…': 'Preparing the remote database…',
  'profili non decodificabili: le immersioni sono state importate senza profilo.':
    'profiles could not be decoded: those dives were imported without a profile.',
  'profili…': 'profiles…',
  'Profilo del': 'Profile of',
  'Radice <divelog> non trovata.': '<divelog> root not found.',
  'Restano i dati di riepilogo.': 'The summary data is left.',
  'Riconosciuto uno sfasamento di': 'Recognised a clock offset of',
  Riga: 'Row',
  'righe scartate: data o durata non interpretabili.': 'rows discarded: date or duration unreadable.',
  'scartata: data, durata o profondità non interpretabili.': 'discarded: date, duration or depth unreadable.',
  'scartata: durata o profondità mancanti.': 'discarded: duration or depth missing.',
  'senza profondità media: consumo non calcolabile.': 'has no average depth: RMV cannot be worked out.',
  'Servizi trovati:': 'Services found:',
  'Servizio di accesso non raggiungibile:': 'Sign-in service unreachable:',
  'Sessioni subacquee trovate ma senza profilo utilizzabile.':
    'Dive sessions found, but with no usable profile.',
  'sono nel cestino': 'are in the trash',
  'Store non inizializzato.': 'Storage not initialised.',
  'UDDF vuole ISO 8601 (2026-06-14T10:38:00); segnala il file, che il formato si aggiunge.':
    'UDDF wants ISO 8601 (2026-06-14T10:38:00); report the file and the format gets added.',
  'una caratteristica che notifichi': 'characteristic that notifies',
  'una caratteristica su cui scrivere': 'characteristic to write to',
  "Unità dichiarate nell'intestazione e applicate a tutta la colonna:":
    'Units declared in the header and applied to the whole column:',
  'è nel cestino': 'is in the trash',
  // --- scarico via Bluetooth ---
  /*
   * Tre voci qui dentro traducono in sé stesse, e non è una svista: le due
   * etichette dei driver sono elenchi di nomi di prodotto, e «computer» si
   * scrive uguale nelle due lingue. Stanno nel dizionario lo stesso perché
   * un'assenza è indistinguibile da una dimenticanza: chi verifica che ogni
   * stringa passata a `t()` abbia la sua voce le troverebbe mancanti e le
   * riaggiungerebbe, ogni volta.
   */
  'Accendi il computer e mettilo in modalità trasferimento o Bluetooth — quasi tutti annunciano solo per qualche minuto dopo che li hai toccati, e si riaddormentano da soli. La ricerca continua finché non la fermi.':
    'Turn the computer on and put it in transfer or Bluetooth mode — most only advertise for a few minutes after you touch them, then fall asleep again. The scan keeps going until you stop it.',
  'Al prossimo collegamento prendo solo quelle più recenti.': 'Next time I only take the newer ones.',
  'Chiedo quante immersioni ci sono…': 'Asking how many dives there are…',
  computer: 'computer',
  'Copia il diario': 'Copy the log',
  'Diario tecnico': 'Technical log',
  'già in archivio': 'already in the logbook',
  'Il computer non ha immersioni in memoria da scaricare.':
    'The computer has no dives in memory to download.',
  'Il trasferimento si è interrotto prima della fine': 'The transfer stopped before the end',
  'La ricerca non è partita': 'The scan did not start',
  'Leggo…': 'Reading…',
  'lette dal computer': 'read from the computer',
  'l’ultima volta': 'last time',
  'Mi collego…': 'Connecting…',
  'Niente di nuovo: il computer non ha immersioni più recenti di quelle che hai già.':
    'Nothing new: the computer has no dives newer than the ones you already have.',
  'non riconosciuto come computer subacqueo': 'not recognised as a dive computer',
  'Non è arrivata nessuna immersione': 'No dive came through',
  // --- il catalogo dei computer: marca, modello, e cosa succede davvero ---
  'Che computer è?': 'Which computer is it?',
  'Cerca la marca o il modello': 'Search by brand or model',
  'per esempio: perdix': 'for example: perdix',
  'di solito riconosciuto da solo': 'usually recognised on its own',
  'non ancora via Bluetooth': 'not over Bluetooth yet',
  'via libdivecomputer, mai provato su questo modello': 'via libdivecomputer, never tested on this model',
  'solo importando il file': 'file import only',
  'Ho capito': 'Got it',
  'Nessun modello con questo nome. Può darsi che si chiami in un altro modo, o che quel computer i dati via Bluetooth non li dia: in tutti e due i casi puoi esportare le immersioni dall’applicazione del costruttore e importare qui il file.':
    'No model by that name. It may be called something else, or that computer may not hand out its data over Bluetooth at all: either way you can export your dives from the maker’s app and import the file here.',
  'non manda le immersioni via Bluetooth a nessuna applicazione: le tiene per quella del costruttore. Esporta le immersioni da lì e importa qui il file — i dati sono gli stessi.':
    'does not send dives over Bluetooth to any app: it keeps them for the maker’s own. Export your dives there and import the file here — the data is the same.',
  'usa un protocollo che l’applicazione non legge ancora. Nel frattempo esporta le immersioni dall’applicazione del costruttore e importa qui il file: i formati accettati sono elencati qui sotto.':
    'uses a protocol this app cannot read yet. Meanwhile, export your dives from the maker’s app and import the file here: the formats we take are listed below.',
  'quello che è arrivato è salvato, il resto si riprende riscaricando.':
    'what arrived is saved, the rest resumes on the next download.',
  riga: 'line',
  righe: 'lines',
  'Rileggi tutta la memoria del computer, non solo le nuove':
    'Re-read the whole computer memory, not just the new dives',
  'Salva i dati grezzi': 'Save the raw data',
  'Scubapro / Uwatec (Aladin Matrix, A1, A2, G2, G3, Luna 2)':
    'Scubapro / Uwatec (Aladin Matrix, A1, A2, G2, G3, Luna 2)',
  'serve se hai cancellato qualcosa e la rivuoi indietro': 'needed if you deleted something and want it back',
  'serve solo se qualcosa non ha funzionato': 'only useful if something went wrong',
  'Shearwater (Peregrine, Perdix, Petrel, Teric, Tern)':
    'Shearwater (Peregrine, Perdix, Petrel, Teric, Tern)',
  'sono arrivate': 'I got',
  'sono arrivate ma non si sono potute salvare': 'came through but could not be saved',
  'Sto cercando…': 'Scanning…',
  Aggiornamenti: 'Updates',
  'L’app controlla se c’è una versione nuova. Scaricarla e installarla lo decidi tu.':
    'The app checks whether a new version exists. Downloading and installing it is your call.',
  'Controllo…': 'Checking…',
  'Sei alla versione più recente.': 'You are on the latest version.',
  'Controlla di nuovo': 'Check again',
  Controlla: 'Check',
  'C’è la versione': 'Version available:',
  'Installa e riavvia': 'Install and restart',
  'L’applicazione si chiude e si riapre da sola.': 'The application closes and reopens by itself.',
  'Scarico l’aggiornamento…': 'Downloading the update…',
  'Installato. L’applicazione si sta riavviando.': 'Installed. The application is restarting.',
  'Centro di immersione': 'Dive centre',
  'chi ha organizzato l’uscita': 'who organised the trip',
  'Profondità programmata': 'Planned depth',
  // --- riconoscimenti ---
  Riconoscimenti: 'Credits',
  'MyDiveLog legge i computer subacquei grazie al lavoro di chi ha decifrato i loro protocolli e lo ha reso pubblico.':
    'MyDiveLog reads dive computers thanks to the people who worked out their protocols and made that public.',
  'di Jef Driesen e collaboratori, licenza': 'by Jef Driesen and contributors, licensed under',
  'È inclusa in questa applicazione ed è quello che legge i computer subacquei che l’app non sa leggere da sé.':
    'It ships inside this app and is what reads the dive computers the app cannot read on its own.',
  'Il sorgente di MyDiveLog è pubblico sotto licenza MIT, e il sorgente esatto di libdivecomputer usato per compilare questa versione è dentro il repository: chiunque può ricostruire l’applicazione, libreria compresa.':
    'MyDiveLog’s source is public under the MIT licence, and the exact libdivecomputer source this build was compiled against is in the repository: anyone can rebuild the app, library included.',
  'Il token del database resta su ogni dispositivo.': 'The database token stays on each device.',
  'Dati per il LogBook': 'Logbook details',
  'Il brevetto scelto è scritto a mano e non è fra quelli registrati. Continua a valere sul libretto; se lo aggiungi qui sotto, resta legato al tuo elenco.':
    'The certification shown was typed by hand and is not one of the ones on file. It still prints on the logbook; add it below and it stays tied to your list.',
  'La tendina si riempie con i brevetti che registri qui sotto.':
    'The list fills up with the certifications you add below.',
  'nessun brevetto registrato': 'no certification on file',
  '— scegli —': '— pick one —',
  'Nome e brevetto finiscono sulla stampa del libretto, che è l’unico posto dove servono. Non sono obbligatori.':
    'Your name and certification appear on the printed logbook, which is the only place they are needed. Neither is required.',
  'Nome e cognome': 'Full name',
  'livello e organizzazione': 'level and agency',
  'Servono alle lettere a) e b) del libretto delle immersioni previsto dall’art. 12, comma 8 della legge 70/2026, che ammette espressamente il formato digitale.':
    'They fill letters a) and b) of the dive logbook required by art. 12(8) of Italian law 70/2026, which expressly allows the digital form.',
  'Firma della guida': 'Guide’s signature',
  'È la lettera o) del libretto: l’unica delle tredici che non è un dato ma un gesto.':
    'It is letter o) of the logbook: the only one of the thirteen that is a gesture, not a datum.',
  'Fai firmare': 'Get it signed',
  'Rifai la firma': 'Sign again',
  'La firma raccolta per questa immersione': 'The signature collected for this dive',
  'Riquadro per la firma: disegna col dito o con il puntatore':
    'Signature box: draw with your finger or pointer',
  'Chi firma': 'Who is signing',
  'nome e cognome della guida': 'the guide’s full name',
  'Salva la firma': 'Save the signature',
  Rifai: 'Clear',
  'Togli la firma': 'Remove the signature',
  'È il segno di una persona raccolto su questo dispositivo, con nome e data accanto: l’equivalente della penna sul foglio. Non è una firma elettronica qualificata.':
    'It is a person’s mark collected on this device, with a name and a date beside it: the equivalent of pen on paper. It is not a qualified electronic signature.',
  'firmato da': 'signed by',
  'firmato il': 'signed on',
  firmato: 'signed',
  il: 'on',

  // --- il piano di miglioramento ---
  /* Non stanno in `src/ui`: le scrivono `core/analysis/coaching.ts` e
     `core/analysis/nextDive.ts`, che ricevono la traduzione come parametro. Le
     frasi con dentro un numero arrivano da `frase()`: i segnaposti `{0}`, `{1}`
     devono esserci tutti anche in inglese, e possono cambiare posto. */
  'Consumo medio di superficie {0} L/min su {1} immersioni con pressione e volume bombola.':
    'Average RMV {0} L/min over {1} dives with cylinder pressure and volume.',
  'Ultime 10 immersioni: {0} L/min.': 'Last 10 dives: {0} L/min.',
  'Tendenza: {0} → {1} L/min fra prima e seconda metà dello storico.':
    'Trend: {0} → {1} L/min between the first and second half of the logbook.',
  'Consumo basso e utilizzabile per la pianificazione: {0} L/min':
    'RMV low and usable for planning: {0} L/min',
  'A questo livello il consumo è abbastanza stabile per essere usato nei calcoli di gas con un margine ragionevole. Continua a registrare pressione iniziale e finale a ogni immersione: un consumo affidabile vale più di uno basso.':
    'At this level your RMV is steady enough to plan gas with a sensible margin. Keep logging start and end pressure on every dive: a reliable RMV is worth more than a low one.',
  'Verifica il valore su miscele e profondità diverse prima di usarlo per pianificare.':
    'Check the figure on other mixes and depths before you plan with it.',
  "Consumo di superficie {0} L/min: c'è margine": 'RMV {0} L/min: there is room',
  "Sopra i 25 L/min il gas diventa il vincolo dominante dell'immersione e riduce i margini nella pianificazione tecnica. Nella maggior parte dei casi la causa non è polmonare: è assetto, pinneggiata e sovra-zavorra.":
    'Above 25 L/min gas becomes the dive’s dominant constraint and cuts your margins in technical planning. Most of the time the cause is not your lungs: it is buoyancy, finning and overweighting.',
  "Un consumo in questa fascia è normale ma comprimibile. Il guadagno più rapido viene dall'assetto, non dalla respirazione.":
    'An RMV in this range is normal but compressible. The quickest gain comes from buoyancy, not from breathing.',
  'Portare la media sotto {0} L/min nelle prossime 10 immersioni.':
    'Bring the average under {0} L/min over the next 10 dives.',
  'Prova di zavorra a fine immersione con 50 bar: devi restare fermo a 5 m con polmoni a metà. Togli piombo finché non ci riesci.':
    'Weight check at the end of a dive with 50 bar: you must hold 5 m with half-full lungs. Drop lead until you can.',
  'Sospensione statica: 5 minuti a 6 m senza toccare il jacket e senza usare le pinne. In piscina o su un fondale basso.':
    'Static hover: 5 minutes at 6 m without touching the BCD and without finning. In a pool or on a shallow bottom.',
  "Pinneggiata a rana per tutta la fase di fondo di un'immersione: riduce la spinta parassita e il consumo con essa.":
    'Frog kick for the whole bottom phase of a dive: it cuts parasitic thrust, and RMV with it.',
  'Ripeti lo stesso sito due volte a un mese di distanza e confronta il consumo: elimina la variabile "immersione diversa".':
    'Repeat the same site twice a month apart and compare RMV: it removes the "different dive" variable.',
  'Il consumo sta salendo nel tempo': 'Your RMV is creeping up over time',
  'La tendenza è in crescita. Prima di lavorare sulla tecnica, controlla le cause banali: cambio di muta o di zavorra, acqua più fredda, immersioni più profonde o più impegnative, erogatore da regolare.':
    'The trend is rising. Before working on technique, check the dull causes: a new suit or weighting, colder water, deeper or harder dives, a regulator due for a service.',
  'Da {0} a {1} L/min fra prima e seconda metà ({2} immersioni).':
    'From {0} to {1} L/min between the first and second half ({2} dives).',
  "Variazione stimata {0} L/min all'anno.": 'Estimated change {0} L/min a year.',
  'Riportare la media delle prossime 10 immersioni al livello della prima metà dello storico.':
    'Bring the next 10 dives back to the average of the first half of the logbook.',
  'Confronta il consumo su immersioni allo stesso sito e stagione: se il delta sparisce, è la condizione e non la tecnica.':
    'Compare RMV on dives at the same site and season: if the gap goes, it is conditions, not technique.',
  "Controlla la regolazione dell'erogatore: uno sforzo inspiratorio alto si paga in consumo.":
    'Check how your regulator breathes: a high inhalation effort is paid for in gas.',
  '{0} m verticali "sprecati" al minuto mentre tieni la quota, media su {1} immersioni.':
    '{0} m of vertical "wasted" per minute while holding depth, averaged over {1} dives.',
  'Tendenza: {0} → {1} m/min.': 'Trend: {0} → {1} m/min.',
  'Assetto solido: {0} m/min di oscillazione': 'Solid buoyancy: {0} m/min of drift',
  'Tieni la quota con precisione. È il prerequisito che rende possibile tutto il resto: soste di deco stabili, riprese fotografiche, lavoro in coppia.':
    'You hold depth precisely. It is the prerequisite for everything else: steady deco stops, photography, working as a buddy pair.',
  'Mantieni il livello aggiungendo un compito: bobina, dSMB, gestione stage.':
    'Hold the level while adding a task: reel, dSMB, stage handling.',
  'Oscillazione verticale di {0} m/min a quota tenuta': 'Vertical drift of {0} m/min while holding depth',
  'Nei tratti in cui dovresti tenere la quota, la profondità cambia più del necessario. È la prima causa di consumo elevato e, in immersione con decompressione, rende imprecise le soste. Le cause tipiche in ordine di frequenza: sovra-zavorra, assetto non orizzontale, uso del jacket al posto del respiro per le correzioni piccole.':
    'Where you should be holding depth, your depth moves more than it needs to. It is the first cause of high gas use and, on deco dives, it makes the stops imprecise. Typical causes in order: overweighting, trim off horizontal, using the BCD instead of the breath for small corrections.',
  'Scendere sotto {0} m/min di oscillazione media.': 'Get average drift under {0} m/min.',
  'Prova di zavorra corretta (fine immersione, 50 bar, fermo a 5 m). Quasi sempre si scopre di portare 2 kg di troppo.':
    'Proper weight check (end of dive, 50 bar, still at 5 m). You almost always find you carry 2 kg too much.',
  'Hover a testa in giù e poi orizzontale per 3 minuti ciascuno: rivela dove è concentrato il peso.':
    'Hover head down and then horizontal for 3 minutes each: it shows where the weight sits.',
  'Riposiziona la zavorra: se le gambe cadono, spostane una parte verso le spalle o usa una piastra più pesante.':
    'Move the lead: if your legs drop, shift some towards the shoulders or use a heavier backplate.',
  'Correzioni piccole col respiro, il jacket solo per i cambi di quota veri.':
    'Small corrections with the breath, the BCD only for real changes of depth.',
  "Passa un'immersione a seguire una parete a quota costante e guarda il profilo dopo: il grafico è il giudice.":
    'Spend a dive following a wall at constant depth and look at the profile after: the graph is the judge.',
  'Velocità di risalita sotto controllo': 'Ascent rate under control',
  'Le risalite rispettano i limiti in modo costante, anche nella fascia finale, che è quella che conta di più.':
    'Your ascents keep within the limits consistently, including the last stretch, which is the one that counts most.',
  '{0} immersioni su {1} con almeno 30 s fuori limite.':
    '{0} dives out of {1} with at least 30 s over the limit.',
  'Risalite oltre il limite nel {0} delle immersioni': 'Ascents over the limit on {0} of your dives',
  'Il limite di riferimento è {0} m/min sotto i 10 m e {1} m/min sopra.':
    'The reference limit is {0} m/min below 10 m and {1} m/min above.',
  "Le violazioni sono concentrate negli ultimi metri, dove l'espansione del gas è massima e il controllo è più difficile: è lì che serve rallentare, non sul fondo.":
    'The breaches cluster in the last few metres, where gas expansion is greatest and control is hardest: that is where you need to slow down, not on the bottom.',
  'Rallentare la risalita è il singolo intervento con il miglior rapporto fra sforzo e riduzione del rischio.':
    'Slowing the ascent is the single change with the best ratio of effort to risk cut.',
  '{0} immersioni su {1} con almeno 30 s sopra il limite.':
    '{0} dives out of {1} with at least 30 s above the limit.',
  'Di queste, {0} con violazioni sopra i 10 m.': 'Of those, {0} breached above 10 m.',
  'Picco registrato: {0} m/min.': 'Peak recorded: {0} m/min.',
  'Portare le immersioni con violazioni sotto il {0}.': 'Get the dives with breaches below {0}.',
  'Risali contando: 3 m ogni 20 secondi sotto i 10 m, 3 m ogni 30 secondi sopra. Cronometra, non stimare.':
    'Count your ascent: 3 m every 20 seconds below 10 m, 3 m every 30 seconds above. Time it, do not guess.',
  'Usa la cima o la parete come riferimento visivo: senza riferimenti la percezione della velocità è inaffidabile.':
    'Use the line or the wall as a visual reference: without one your sense of speed is unreliable.',
  'Guarda il grafico di profondità dopo ogni immersione: la pendenza della risalita è la verifica.':
    'Look at the depth graph after every dive: the slope of the ascent is the check.',
  'Se risali con dSMB, lancia la boa e poi risali sulla sagola: dà un riferimento e impone un ritmo.':
    'If you ascend on a dSMB, shoot the bag and go up the line: it gives a reference and sets a pace.',
  'Sosta di sicurezza sistematica': 'Safety stop every time',
  "La sosta di sicurezza è un'abitudine, non un'eccezione. È esattamente la disciplina che serve quando le soste diventano obbligatorie.":
    'The safety stop is a habit, not an exception. It is exactly the discipline you need when stops become mandatory.',
  'Completata nel {0} delle {1} immersioni in curva sopra i 10 m.':
    'Completed on {0} of the {1} no-deco dives past 10 m.',
  'Sosta di sicurezza completata nel {0} delle immersioni': 'Safety stop completed on {0} of your dives',
  'Consideriamo completata una sosta di almeno {0} minuti fra 3 e 6 m.':
    'We count a stop as complete from {0} minutes between 3 and 6 m.',
  'Al di là del beneficio decompressivo, è il momento in cui si allena il controllo di quota a bassa profondità: la stessa abilità che serve per una sosta di deco.':
    'Beyond the decompression benefit, it is where you train depth control in shallow water: the same skill a deco stop needs.',
  '{0} soste complete su {1} immersioni valutabili.': '{0} complete stops out of {1} dives we can judge.',
  'Valutate solo le immersioni in curva oltre i 10 m con profilo campionato.':
    'Only no-deco dives past 10 m with a sampled profile are counted.',
  'Superare il {0} nelle prossime 15 immersioni.': 'Get past {0} over the next 15 dives.',
  'Programma la sosta come parte del profilo, non come extra: pianifica il gas per 5 m/5 min.':
    'Plan the stop as part of the profile, not as an extra: plan gas for 5 m / 5 min.',
  'Se il problema è tenere la quota a 5 m con la bombola scarica, torna alla prova di zavorra: è quella la causa.':
    'If the trouble is holding 5 m with an empty cylinder, go back to the weight check: that is the cause.',
  "Un'immersione con violazione del tetto di decompressione": 'One dive that broke the deco ceiling',
  '{0} immersioni con violazione del tetto di decompressione': '{0} dives that broke the deco ceiling',
  "Il profilo è salito sopra il tetto imposto dal computer. È il tipo di errore che va chiuso prima di aggiungere complessità, e vale la pena rivederlo con l'istruttore guardando i profili insieme.":
    'The profile went above the ceiling the computer set. It is the kind of mistake to close before adding complexity, and it is worth going through the profiles with your instructor.',
  '{0}: {1} sopra il tetto (max {2} m).': '{0}: {1} above the ceiling (max {2} m).',
  'Zero violazioni. Non è un obiettivo da migliorare gradualmente.':
    'Zero breaches. Not a target to improve gradually.',
  "Rivedi i profili con l'istruttore: capire perché è successo conta più di sapere che è successo.":
    'Go through the profiles with your instructor: understanding why matters more than knowing it happened.',
  'Verifica di leggere il tetto e non la profondità della prossima tappa: sono due numeri diversi sullo stesso schermo.':
    'Check you are reading the ceiling and not the depth of the next stop: two different numbers on the same screen.',
  'Allena il mantenimento della quota a 6 e 3 m con un compito in mano.':
    'Practise holding depth at 6 and 3 m with a task in hand.',
  'Riserva di gas rispettata': 'Gas reserve respected',
  'Chiudi le immersioni con margine. È la premessa della pianificazione a regola dei terzi.':
    'You end dives with margin. It is the premise of planning by the rule of thirds.',
  "Solo il {0} delle {1} immersioni sotto i 50 bar all'uscita.":
    'Only {0} of the {1} dives ended below 50 bar.',
  'Uscita sotto i 50 bar nel {0} delle immersioni': 'Out of the water below 50 bar on {0} of your dives',
  'Una riserva sottile funziona finché tutto va secondo previsione. Nella Subacquea Tecnica la logica cambia: il gas di riserva non è "quello che resta" ma una quantità calcolata prima di entrare in acqua.':
    'A thin reserve works as long as everything goes to plan. In technical diving the logic changes: reserve gas is not "what is left" but an amount worked out before you get in the water.',
  '{0}: uscita a {1} bar da {2} m.': '{0}: out at {1} bar from {2} m.',
  "Nessuna immersione sotto i 50 bar; risalita iniziata alla pressione decisa prima dell'ingresso.":
    'No dive below 50 bar; ascent started at the pressure decided before the water.',
  'Fissa la pressione di risalita prima di entrare e comunicala al compagno. Poi rispettala anche se "c\'era ancora tempo".':
    'Set your turn pressure before you get in and tell your buddy. Then keep it even if "there was still time".',
  'Con il consumo che hai, calcola il gas necessario per risalire in due da profondità massima: è quella la riserva minima.':
    'With the RMV you have, work out the gas to bring two divers up from max depth: that is your minimum reserve.',
  'Passa alla regola dei terzi sulle immersioni in cui non puoi risalire in verticale.':
    'Move to the rule of thirds on dives where you cannot go straight up.',
  'negli ultimi 12 mesi': 'in the last 12 months',
  'negli ultimi {0} mesi': 'in the last {0} months',
  'Dopo una pausa lunga la manualità si degrada in modo prevedibile: assetto, gestione della zavorra, procedure di emergenza. La rientrata è più utile se è deliberata invece che "la prima immersione della stagione".':
    'After a long break your handling degrades predictably: buoyancy, weighting, emergency drills. Coming back is more use if it is deliberate rather than "the first dive of the season".',
  'Ultima immersione: {0}.': 'Last dive: {0}.',
  '{0} immersioni {1} ({2}/mese).': '{0} dives {1} ({2}/month).',
  'Una prima immersione di rientro bassa e semplice, con ripasso di assetto e procedure.':
    'A first dive back that is shallow and simple, with a buoyancy and drills refresher.',
  'Prima immersione di rientro entro i 18 m, su sito conosciuto, con prova di zavorra.':
    'First dive back within 18 m, on a site you know, with a weight check.',
  'Ripasso a secco: monta e smonta l’attrezzatura, e prova a raggiungere i rubinetti della bombola.':
    'Dry run: build and strip the kit, and practise reaching the cylinder valves.',
  'Una sessione in piscina prima del mare, se possibile.': 'A pool session before the sea, if you can.',
  '{0} immersioni al mese: poche per consolidare': '{0} dives a month: too few to consolidate',
  'A questa frequenza ogni immersione serve in parte a recuperare quello che si è perso dalla precedente, e i progressi si accumulano lentamente. Non è un problema di sicurezza: è un problema di velocità di apprendimento.':
    'At this rate each dive partly goes on recovering what you lost since the last one, and progress builds slowly. It is not a safety problem: it is a learning-speed problem.',
  '{0} immersioni {1}.': '{0} dives {1}.',
  '{0} negli ultimi 90 giorni.': '{0} in the last 90 days.',
  'Quattro immersioni al mese nella stagione, con un obiettivo dichiarato per ciascuna.':
    'Four dives a month in season, each with a stated goal.',
  'Un obiettivo per immersione, scritto prima: assetto, consumo, o una procedura.':
    'One goal per dive, written down first: buoyancy, gas, or a drill.',
  'Le uscite in lago valgono come allenamento anche fuori stagione: acqua fredda, visibilità corta, e nessuna scusa per non curare l’assetto.':
    'Lake dives count as training out of season too: cold water, short visibility, and no excuse for sloppy buoyancy.',
  'In allenamento: {0} immersioni al mese': 'In practice: {0} dives a month',
  'La frequenza è quella giusta per far attecchire i miglioramenti tecnici invece di ricominciare ogni volta.':
    'That is the rate that lets technical gains stick instead of starting over every time.',
  '{0} immersioni {1}, ultima {2} giorni fa.': '{0} dives {1}, the last one {2} days ago.',
  '{0} immersioni su {1} hanno un profilo campionato.': '{0} dives out of {1} have a sampled profile.',
  '{0} immersioni su {1} permettono di calcolare il consumo.':
    '{0} dives out of {1} allow RMV to be worked out.',
  '{0} immersioni hanno la pressione ma non il volume della bombola.':
    '{0} dives have the pressure but not the cylinder volume.',
  '{0} immersioni non hanno le pressioni.': '{0} dives have no pressures at all.',
  '{0} hanno pressioni e volume ma manca la profondità media, che serve al calcolo.':
    '{0} have pressures and volume but no average depth, which the sum needs.',
  "Una parte dell'analisi è bloccata da dati mancanti": 'Part of the analysis is blocked by missing data',
  "Manca soprattutto la profondità media: {0} immersioni hanno pressioni e volume ma nessun profilo da cui ricavarla, e senza quella il consumo in L/min non si può calcolare. Si può scriverla a mano nella scheda dell'immersione.":
    'What is mostly missing is average depth: {0} dives have pressures and volume but no profile to derive it from, and without that RMV in L/min cannot be worked out. You can type it in by hand on the dive.',
  'Manca soprattutto il volume delle bombole: {0} immersioni hanno le pressioni ma non il volume. È un campo che si compila una volta per configurazione, e su quelle sblocca il consumo in L/min — senza, il logbook può dire solo bar/min, che non è confrontabile fra bombole diverse.':
    'What is mostly missing is cylinder volume: {0} dives have the pressures but not the volume. It is a field you fill once per configuration, and on those it unlocks RMV in L/min — without it the logbook can only say bar/min, which does not compare between cylinders.',
  'Mancano soprattutto le pressioni: {0} immersioni su {1} non le hanno, e senza pressione iniziale e finale il consumo non esiste.':
    'What is mostly missing are the pressures: {0} dives out of {1} have none, and without start and end pressure there is no RMV.',
  "Compilare i volumi sbloccherebbe le {0} che le pressioni ce l'hanno già.":
    'Filling in the volumes would unlock the {0} that already have pressures.',
  'Volume bombola e pressione iniziale/finale su tutte le immersioni future.':
    'Cylinder volume and start/end pressure on every future dive.',
  'Compila il volume nella scheda bombola: si fa una volta per configurazione.':
    'Fill the volume in on the cylinder: once per configuration.',
  'Se il computer non registra la pressione, annota pressione iniziale e finale a fine immersione.':
    'If the computer does not log pressure, note start and end pressure after the dive.',
  'Se hai i file esportati dal programma che usavi prima, reimportali: spesso contengono più dati di quanti quel programma ne mostrasse.':
    'If you have files exported from the program you used before, import them again: they often hold more than that program showed.',
  '{0} immersioni con obbligo decompressivo, gestite senza violazioni':
    '{0} dives with a deco obligation, handled without breaches',
  "L'esposizione alla decompressione sta crescendo e i profili sono stati rispettati. Il passo successivo è rendere ripetibile la parte noiosa: soste stabili al metro, tempi rispettati anche quando fa freddo e il gas scarseggia.":
    'Your decompression exposure is growing and the profiles were respected. Next comes making the dull part repeatable: stops steady to the metre, times kept even when it is cold and gas is short.',
  '{0} di obbligo decompressivo cumulato su {1} immersioni.':
    '{0} of deco obligation in total over {1} dives.',
  'Obbligo massimo su una singola immersione: {0}.': 'Largest obligation on a single dive: {0}.',
  'Nessuna violazione del tetto registrata.': 'No ceiling breach on record.',
  'Soste con compito in mano: bobina, dSMB, cambio gas simulato.':
    'Stops with a task in hand: reel, dSMB, simulated gas switch.',
  "GF99 mediano all'uscita {0}%, massimo {1}%, su {2} immersioni.":
    'Median GF99 on surfacing {0}%, highest {1}%, over {2} dives.',
  "Un'immersione chiusa oltre l'85% del proprio gradient factor alto.":
    'One dive ended past 85% of its own high gradient factor.',
  "{0} immersioni chiuse oltre l'85% del proprio gradient factor alto.":
    '{0} dives ended past 85% of their own high gradient factor.',
  'Il gradient factor alto è quello registrato dal computer su tutte le immersioni.':
    'The high gradient factor is the one the computer logged, on every dive.',
  'Attenzione: il gradient factor alto è registrato solo su {0} immersioni su {1}; sulle altre è stato assunto {2}, che è il valore più diffuso ma non è il tuo dato.':
    'Careful: the high gradient factor is logged on only {0} dives out of {1}; on the others {2} was assumed, which is the most common value but is not your data.',
  'Calcolato dal profilo con Bühlmann ZH-L16C, carico residuo compreso: c’è su tutte le immersioni con profilo, anche quando il computer non lo registra.':
    'Worked out from the profile with Bühlmann ZH-L16C, residual load included: it is there on every dive with a profile, even when the computer does not log it.',
  'Di solito esci con margine, ma {0} {1} vicine al tuo limite':
    'You usually surface with margin, but {0} {1} close to your limit',
  "La mediana dice che il margine c'è quasi sempre; il caso isolato è quello da guardare, perché nasce da una circostanza specifica e non da un'abitudine.":
    'The median says the margin is nearly always there; the odd case is the one to look at, because it comes from a specific circumstance and not from a habit.',
  'Apri le immersioni vicine al limite e confronta la risalita con quella delle altre: di solito la differenza sta lì.':
    'Open the dives close to the limit and compare the ascent with the others: that is usually where the difference is.',
  "Riportare anche i casi isolati sotto l'85% del gradient factor impostato.":
    'Bring even the odd case under 85% of the gradient factor you set.',
  'Esci con margine: GF99 mediano {0}%': 'You surface with margin: median GF99 {0}%',
  "Il gradiente residuo all'uscita lascia spazio rispetto al limite impostato sul computer. È la condizione che rende ripetibili le immersioni multiple e le giornate consecutive.":
    'The residual gradient on surfacing leaves room against the limit set on your computer. It is what makes repetitive dives and consecutive days repeatable.',
  "GF99 mediano all'uscita {0}%: margine ridotto": 'Median GF99 on surfacing {0}%: little margin',
  "Esci con una sovrasaturazione vicina a quella che il tuo computer ammette. Non è una violazione — il computer te lo consente — ma significa usare quasi tutto il margine, e su immersioni ripetitive o giornate consecutive il margine è ciò che si accumula. Quanto sia accettabile dipende dai gradient factor che hai impostato: verifica quali sono e parlane con l'istruttore prima di cambiare qualcosa.":
    'You surface with a supersaturation close to what your computer allows. It is not a breach — the computer lets you — but it means using nearly all the margin, and on repetitive dives or consecutive days margin is what adds up. How acceptable that is depends on the gradient factors you set: check what they are and talk to your instructor before you change anything.',
  'Abbassare il GF99 mediano allungando la sosta negli ultimi metri, a impostazioni invariate.':
    'Lower the median GF99 by stretching the stop in the last metres, settings unchanged.',
  'Allunga la sosta fra 3 e 6 m: è la leva che abbassa il GF99 senza toccare le impostazioni.':
    'Stretch the stop between 3 and 6 m: it is the lever that lowers GF99 without touching the settings.',
  "Risali gli ultimi 6 metri in almeno un minuto: è il tratto dove l'espansione conta di più.":
    'Take at least a minute over the last 6 metres: that is where expansion counts most.',
  'Guarda il GF99 sul computer appena riemergi e annotalo: diventa un numero su cui lavorare.':
    'Look at GF99 on the computer as you surface and write it down: it becomes a number to work on.',
  'Verifica quali gradient factor hai impostato — molti non lo sanno, e senza quel dato il GF99 non si interpreta.':
    'Check which gradient factors you have set — many divers do not know, and without that GF99 cannot be read.',
  "Velocità mediana sull'ultimo tratto {0} m/min, su {1} immersioni.":
    'Median speed on the last stretch {0} m/min, over {1} dives.',
  '{0} immersioni sopra i {1} m/min raccomandati nei metri finali{2}.':
    '{0} dives above the {1} m/min recommended in the final metres{2}.',
  ', di cui {0} sopra i 60 m/min': ', of which {0} above 60 m/min',
  'Misurata dalla sosta alla superficie, punto per punto: è un tratto troppo breve perché la velocità media dell’immersione lo mostri.':
    'Measured from the stop to the surface, point by point: too short a stretch for the dive’s average ascent rate to show it.',
  'Ultimi metri controllati: {0} m/min di mediana': 'Last metres under control: {0} m/min median',
  'Il tratto fra la sosta e la superficie è quello dove si accelera senza accorgersene, ed è anche quello dove la sovrasaturazione è massima. Qui non succede.':
    'The stretch between the stop and the surface is where people speed up without noticing, and it is also where supersaturation is highest. Here it does not happen.',
  'Gli ultimi metri li fai a {0} m/min': 'You do the last metres at {0} m/min',
  'Dalla sosta di sicurezza alla superficie la velocità sale, perché il tratto è corto e sembra finito. È il punto in cui il gradiente fra tessuti e ambiente è più alto, quindi è il tratto in cui la velocità conta di più, non di meno.':
    'From the safety stop to the surface the speed rises, because the stretch is short and feels finished. It is where the gradient between tissues and ambient is highest, so it is where speed counts most, not least.',
  'Ultimi metri sotto i {0} m/min: dalla sosta alla superficie ci vuole quasi un minuto.':
    'Last metres under {0} m/min: from the stop to the surface should take almost a minute.',
  'Conta: da 5 metri alla superficie devono passare almeno 50 secondi.':
    'Count: from 5 metres to the surface at least 50 seconds must pass.',
  'Sgonfia il jacket PRIMA di lasciare la sosta: la maggior parte delle risalite veloci finali è aria che si espande, non pinneggiata.':
    'Dump the BCD BEFORE you leave the stop: most fast final ascents are expanding air, not finning.',
  "Guarda il computer nell'ultimo tratto, non la barca.":
    'Watch the computer on the last stretch, not the boat.',
  'Giornata peggiore per il CNS: {0}% il {1} su {2} immersioni, limite 100%.':
    'Worst day for CNS: {0}% on {1} over {2} dives, limit 100%.',
  'Giornata peggiore per le OTU: {0}, su una dose di riferimento di 300 al giorno quando si fanno più giorni di fila.':
    'Worst day for OTU: {0}, against a reference dose of 300 a day when diving several days running.',
  "Calcolato dall'app sul profilo con le tabelle NOAA, su {0} immersioni. Il computer usa un modello suo e può dare numeri diversi.":
    'Worked out by the app from the profile with the NOAA tables, over {0} dives. Your computer uses its own model and may give other figures.',
  "Esposizione all'ossigeno larga: {0}% di CNS nella giornata peggiore":
    'Oxygen exposure well inside the limits: {0}% CNS on the worst day',
  "C'è margine per aggiungere immersioni in giornata o giorni consecutivi senza avvicinarsi ai limiti di tossicità.":
    'There is room to add dives in a day, or consecutive days, without coming near the toxicity limits.',
  'Orologio CNS al {0}% in una giornata': 'CNS clock at {0}% in one day',
  '{0} OTU nella giornata peggiore': '{0} OTU on the worst day',
  "L'esposizione all'ossigeno si somma fra le immersioni della giornata: il CNS recupera a metà ogni novanta minuti in superficie, le OTU non recuperano affatto e si sommano anche da un giorno all'altro.":
    'Oxygen exposure adds up across the day’s dives: CNS halves every ninety minutes on the surface, OTU do not recover at all and carry over from one day to the next.',
  'CNS sotto il 100% nella giornata e OTU sotto le 300 quando si fanno più giorni di fila.':
    'CNS under 100% in a day and OTU under 300 when diving several days running.',
  "Allunga l'intervallo di superficie fra la prima e la seconda: novanta minuti dimezzano il CNS accumulato.":
    'Stretch the surface interval between the first and second dive: ninety minutes halve the CNS you built up.',
  'Su più giorni di fila guarda le OTU, non il CNS: sono loro a limitare.':
    'On consecutive days watch OTU, not CNS: they are what limits you.',
  'Se usi miscele ricche, la stessa immersione costa più ossigeno: controlla la PPO2 di fondo prima di scegliere il gas.':
    'On a rich mix the same dive costs more oxygen: check your bottom PPO2 before you pick the gas.',
  "Ridiscese dopo essere già risalito: {0} metri l'ora di mediana, {1} nel caso peggiore, su {2} immersioni.":
    'Going back down after already coming up: {0} metres an hour median, {1} at worst, over {2} dives.',
  'Parte profonda per prima in {0} immersioni su {1}{2}.': 'Deepest part first on {0} dives out of {1}{2}.',
  ', con la prima metà mediamente {0} m {1} della seconda':
    ', with the first half on average {0} m {1} than the second',
  'più profonda': 'deeper',
  'più alta': 'shallower',
  'Il tuo quarto peggiore comincia a {0} m/h{1}.': 'Your worst quarter starts at {0} m/h{1}.',
  ', e {0} immersioni stanno oltre il doppio di quella soglia':
    ', and {0} dives sit past twice that threshold',
  'Troppe poche immersioni per dire dove cade una rispetto alle altre.':
    'Too few dives to say where one falls against the others.',
  'La didattica sconsiglia i profili a dente di sega senza dare una soglia: questo indice va letto contro le tue immersioni, non contro un limite.':
    'The agencies advise against saw-tooth profiles without giving a threshold: read this index against your own dives, not against a limit.',
  'Profili regolari: parte profonda per prima, nessuno fuori scala':
    'Regular profiles: deepest part first, none off the scale',
  'È la forma che la didattica raccomanda, e quella su cui i modelli decompressivi sono tarati meglio. Nessuna delle tue immersioni si stacca dalle altre.':
    'It is the shape the agencies recommend, and the one decompression models are tuned for best. None of your dives stands out from the rest.',
  'La parte profonda non viene per prima in {0} immersioni su {1}':
    'The deepest part does not come first on {0} dives out of {1}',
  '{0} immersione si stacca dalle tue per ridiscese': '{0} dive stands out from yours for going back down',
  '{0} immersioni si staccano dalle tue per ridiscese': '{0} dives stand out from yours for going back down',
  'Risalire e riscendere carica e scarica i tessuti veloci più volte, e il modello decompressivo non lo gestisce come un profilo che scende una volta sola e poi risale. Andare prima sul punto più profondo e poi risalire progressivamente è la forma da cercare.':
    'Going up and back down loads and unloads the fast tissues several times, and the decompression model does not handle that like a profile that goes down once and then comes up. Deepest point first and then progressively up is the shape to look for.',
  "Un solo passaggio: giù al punto più profondo all'inizio, poi verso l'alto.":
    'One pass: down to the deepest point at the start, then upwards.',
  "Pianifica il giro in modo che il punto più profondo sia all'inizio, non a metà.":
    'Plan the route so the deepest point is at the start, not halfway.',
  'Quando risali per superare un ostacolo, resta alla quota nuova invece di riscendere.':
    'When you go up to clear an obstacle, stay at the new depth instead of dropping back.',
  '{0} cambi di gas fatti sotto la profondità operativa del gas':
    '{0} gas switches made below the gas’s operating depth',
  'Passare a una miscela più ricca prima di essere risaliti alla sua profondità operativa massima porta la pressione parziale di ossigeno oltre il limite: prima di cambiare erogatore va verificata la profondità.':
    'Switching to a richer mix before you are up at its maximum operating depth pushes the oxygen partial pressure past the limit: check the depth before you change regulator.',
  'Rilevati sui profili con più di una bombola, confrontando la profondità del cambio con la MOD a 1.6 bar del gas di destinazione.':
    'Found on profiles with more than one cylinder, comparing the switch depth with the target gas’s MOD at 1.6 bar.',
  'Zero. Non è un obiettivo da migliorare gradualmente.': 'Zero. Not a target to improve gradually.',
  'Quattro gesti nell’ordine, prima di ogni cambio gas: mostra la bombola al compagno, aprila, verifica la PROFONDITÀ, poi cambia erogatore.':
    'Four gestures in order, before every gas switch: show the cylinder to your buddy, open it, check the DEPTH, then change regulator.',
  'Etichetta le bombole con la MOD in numeri grandi, non con la percentuale.':
    'Label the cylinders with the MOD in big numbers, not with the percentage.',
  "{0} immersioni dell'archivio sono ripetitive: sono cominciate con dell'azoto ancora in circolo.":
    '{0} dives in the logbook are repetitive: they started with nitrogen still on board.',
  "Il carico residuo costa in mediana {0} punti di GF99 all'uscita.":
    'Residual load costs a median {0} GF99 points on surfacing.',
  'Il caso peggiore è {0}{1}: {2} punti in più di quanti ne avresti avuti partendo da tessuti puliti.':
    'The worst case is {0}{1}: {2} points more than you would have had from clean tissues.',
  ' dopo {0} minuti di superficie': ' after a {0} minute surface interval',
  'Intervallo di superficie mediano: {0} minuti.': 'Median surface interval: {0} minutes.',
  'Calcolato rigiocando la stessa immersione da tessuti puliti con Bühlmann ZH-L16C: è un confronto fra due esecuzioni dello stesso profilo, non una stima.':
    'Worked out by replaying the same dive from clean tissues with Bühlmann ZH-L16C: a comparison between two runs of one profile, not an estimate.',
  'Le tue ripetitive costano poco: {0} punti di GF99': 'Your repetitive dives cost little: {0} GF99 points',
  'Gli intervalli di superficie che tieni bastano a smaltire quasi tutto: la seconda immersione della giornata esce quasi come se fosse la prima.':
    'The surface intervals you take are enough to offgas nearly everything: the day’s second dive surfaces almost like the first.',
  'Le ripetitive escono {0} punti di GF99 più alte': 'Repetitive dives surface {0} GF99 points higher',
  'È il prezzo dell’azoto che ti porti dietro dalla prima immersione: la stessa identica seconda immersione, fatta da tessuti puliti, finirebbe più bassa di così. Le due leve sono l’intervallo di superficie e la forma della seconda immersione — una più bassa e più corta paga molto meno.':
    'It is the price of the nitrogen you carry over from the first dive: the very same second dive, done from clean tissues, would end lower. The two levers are the surface interval and the shape of the second dive — shallower and shorter pays far less.',
  'Sapere, prima di scendere la seconda volta, con quanto margine in meno stai partendo.':
    'Know, before you go down a second time, how much less margin you are starting with.',
  'Apri la seconda immersione di una giornata: la scheda dice quanti punti è costata la pausa.':
    'Open the second dive of a day: the card says how many points the break cost.',
  'Nel pianificatore, modalità tecnica, scegli l’immersione precedente e l’intervallo: la tabella cambia sotto gli occhi.':
    'In the planner, technical mode, pick the previous dive and the interval: the table changes as you watch.',
  "Tutti i criteri di riferimento sono soddisfatti. Il passo successivo è una verifica in acqua con l'istruttore, non un altro numero.":
    'Every reference criterion is met. The next step is a check in the water with your instructor, not another number.',
  'Manca un criterio: {0}.': 'One criterion missing: {0}.',
  'Mancano {0} criteri su {1}. I più vicini: {2}.': '{0} criteria missing out of {1}. Closest: {2}.',
  '{0} sopra il tetto di decompressione (max {1} m).': '{0} above the deco ceiling (max {1} m).',
  'Risalita oltre il limite per {0}, picco {1} m/min{2}.':
    'Ascent over the limit for {0}, peak {1} m/min{2}.',
  '(anche sopra i 10 m)': '(also above 10 m)',
  'Quota tenuta bene: {0} m/min di oscillazione.': 'Depth well held: {0} m/min of drift.',
  '{0} m/min di oscillazione a quota tenuta (obiettivo sotto {1}).':
    '{0} m/min of drift while holding depth (target under {1}).',
  'Sosta di sicurezza di {0}.': 'Safety stop of {0}.',
  'Sosta di sicurezza breve: {0} fra 3 e 6 m.': 'Short safety stop: {0} between 3 and 6 m.',
  'Nessuna sosta di sicurezza fra 3 e 6 m.': 'No safety stop between 3 and 6 m.',
  'Uscita a {0} bar, sotto la riserva di {1} bar.': 'Out at {0} bar, below the {1} bar reserve.',
  'Uscita a {0} bar.': 'Out at {0} bar.',
  'Consumo di superficie {0} L/min a {1} m di media.': 'RMV {0} L/min at {1} m average depth.',
  'Consumo di superficie {0} L/min.': 'RMV {0} L/min.',
  'PPO2 di picco {0} bar, oltre il limite di fondo di {1} bar.':
    'Peak PPO2 {0} bar, past the {1} bar bottom limit.',
  'Hai ancora {0} bar di azoto in più del normale': 'You still carry {0} bar of nitrogen above normal',
  'Sono passate {0} dall’ultima immersione. Se scendi adesso non riparti da zero: la stessa immersione ti farà uscire più carico, e il computer lo terrà in conto.':
    'It has been {0} since your last dive. If you go down now you do not start from zero: the same dive will leave you more loaded, and the computer will take it into account.',
  'Orologio CNS ancora al {0}%': 'CNS clock still at {0}%',
  'Si dimezza ogni novanta minuti in superficie. Conta se la prossima è una immersione con miscele ricche o profonda: parte da qui, non da zero.':
    'It halves every ninety minutes on the surface. It counts if the next one is deep or on a rich mix: it starts from here, not from zero.',
  'Archivio vuoto': 'Empty logbook',
  'Importa un export dal tuo computer o dal logbook che usavi prima: da lì in poi tutto il resto si calcola da solo.':
    'Import an export from your computer or from the logbook you used before: from there on everything else works itself out.',
  '{0} giorni dall’ultima immersione': '{0} days since your last dive',
  'Dopo una pausa lunga la didattica consiglia un ripasso: la prima uscita facile, poco profonda, con qualcuno che ti conosce. L’assetto è la prima cosa che si perde e la più visibile nei numeri.':
    'After a long break the agencies advise a refresher: an easy first dive, shallow, with someone who knows you. Buoyancy is the first thing to go and the most visible in the numbers.',
  'Non è una pausa lunga, ma la prima immersione dopo due mesi consuma sempre un po’ più del solito. Vale la pena saperlo prima di pianificare il gas al minuto.':
    'It is not a long break, but the first dive after two months always uses a little more gas than usual. Worth knowing before you plan gas to the minute.',
  'Su cosa lavorare: {0}': 'What to work on: {0}',
  'È la prima delle osservazioni sull’archivio. Una cosa sola per immersione: due non si tengono a mente sott’acqua.':
    'It is the first of the observations on your logbook. One thing per dive: two do not stay in mind underwater.',
  'Niente in circolo': 'Nothing on board',
  'Nessun azoto residuo dall’immersione precedente e nessuna nota da leggere. Resta solo da decidere dove andare.':
    'No residual nitrogen from the previous dive and nothing to read. All that is left is deciding where to go.',
  '{0} minuti': '{0} minutes',
  '{0} ore': '{0} hours',
  '{0} giorni': '{0} days',

  // --- le tredici voci del libretto di legge, e i tipi di autorespiratore ---
  'Autorespiratore a circuito aperto (ARA)': 'Open-circuit scuba (OC)',
  'Rebreather a circuito chiuso (CCR)': 'Closed-circuit rebreather (CCR)',
  'Rebreather a circuito semichiuso (SCR)': 'Semi-closed rebreather (SCR)',
  'Generalità del subacqueo': 'Diver’s details',
  'Brevetto posseduto': 'Certification held',
  'Data dell’immersione': 'Dive date',
  Località: 'Location',
  'Orario di inizio': 'Start time',
  'Orario di fine': 'End time',
  'Tipo di autorespiratore': 'Breathing apparatus type',
  'Miscela respiratoria': 'Breathing gas',
  'Profondità massima programmata': 'Planned maximum depth',
  'Profondità massima raggiunta': 'Maximum depth reached',
  'Istruttore o guida responsabile': 'Instructor or guide in charge',
  'Firma dell’istruttore o della guida': 'Instructor or guide signature',
  'Shearwater scrive «2026-06-14 10:38:00»; segnala il file, che il formato si aggiunge.':
    'Shearwater writes «2026-06-14 10:38:00»; report the file and the format gets added.',

  // --- lo scarico dal computer che si interrompe a metà ---
  'Lo scarico si è interrotto: {0}. Quello che era già arrivato è salvato in archivio: {1}.':
    'The download was interrupted: {0}. What had already arrived is saved in your logbook: {1}.',
  'Lo scarico si è interrotto: {0}. Non è stata salvata nessuna immersione.':
    'The download was interrupted: {0}. No dive was saved.',
};
