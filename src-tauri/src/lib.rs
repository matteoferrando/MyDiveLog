//! Guscio nativo di MyDiveLog.
//!
//! Volutamente sottile: tutta la logica (parser, metriche, coach) vive nel core
//! TypeScript, così è identica su desktop, iOS e web. Qui dentro c'è solo ciò
//! che il web non può fare — aprire un vero file SQLite, e mettere le credenziali
//! nel portachiavi di sistema invece che in chiaro dentro l'archivio.
//!
//! Il punto d'ingresso è `run()` e non `main()` perché su iOS Tauri compila
//! questo crate come libreria statica e la chiama dal progetto Xcode.

/// Le credenziali nel portachiavi di sistema.
///
/// PERCHÉ ESISTE. Il token di sincronizzazione e la chiave dell'API stavano nella
/// tabella delle impostazioni dell'archivio, in chiaro. Sono l'unica cosa in
/// tutta l'applicazione che, se letta da qualcun altro, fa danno FUORI
/// dall'applicazione: il token apre il database remoto, la chiave API si spende.
/// Un archivio SQLite è un file copiabile, e finisce nei backup di sistema, nelle
/// copie su disco esterno, nelle cartelle sincronizzate.
///
/// Il portachiavi di macOS li tiene cifrati con le chiavi dell'utente e li
/// rilascia solo a questa applicazione. Non è inviolabile — niente lo è quando
/// chi attacca ha già la tua sessione aperta — ma sposta il segreto da «un file
/// che chiunque legge» a «un archivio che il sistema protegge», e costa tre
/// comandi.
///
/// Compilato solo su Apple: altrove il comando non esiste, la chiamata dal lato
/// TypeScript fallisce, e l'interfaccia lo dice invece di far finta.
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod segreti {
    /// Il nome sotto cui le voci compaiono in Accesso Portachiavi.
    const SERVIZIO: &str = "MyDiveLog";

    #[tauri::command]
    pub fn segreto_leggi(chiave: String) -> Result<Option<String>, String> {
        let voce = keyring::Entry::new(SERVIZIO, &chiave).map_err(|e| e.to_string())?;
        match voce.get_password() {
            Ok(v) => Ok(Some(v)),
            // Una voce che non c'è NON è un errore: è la risposta «non l'hai
            // ancora salvata». Trattarla come errore farebbe comparire un
            // messaggio rosso al primo avvio di un'installazione pulita.
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    #[tauri::command]
    pub fn segreto_scrivi(chiave: String, valore: String) -> Result<(), String> {
        let voce = keyring::Entry::new(SERVIZIO, &chiave).map_err(|e| e.to_string())?;
        voce.set_password(&valore).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn segreto_cancella(chiave: String) -> Result<(), String> {
        let voce = keyring::Entry::new(SERVIZIO, &chiave).map_err(|e| e.to_string())?;
        match voce.delete_credential() {
            // Cancellare qualcosa che non c'è è già il risultato voluto.
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// L'esportazione di un file su iOS, dove `<a download>` non fa niente.
///
/// IL PROBLEMA, che è peggio di quanto sembri. Sul desktop tutte le
/// esportazioni — backup JSON, UDDF, byte grezzi del computer subacqueo, foglio
/// del piano — passano da un `<a download>` con un URL `blob:`. Dentro la
/// WKWebView di iOS quel click non scarica niente E NON LANCIA NESSUN ERRORE:
/// il lato TypeScript non ha modo di accorgersene, quindi finiva per scrivere
/// «Backup scritto» quando non era stato scritto niente. Su una funzione che
/// esiste per rimettere in piedi l'archivio dopo un disastro, una falsa
/// conferma è il difetto peggiore possibile.
///
/// LA CURA. Si scrive nella cartella Documenti dell'applicazione. Con
/// `UIFileSharingEnabled` e `LSSupportsOpeningDocumentsInPlace` — già in
/// `Info.ios.plist` — quella cartella compare nell'app File sotto «Sul mio
/// iPhone → MyDiveLog», da dove il file si sposta, si condivide e si manda dove
/// si vuole. E soprattutto: questa funzione o scrive o restituisce un errore,
/// quindi l'interfaccia può dichiarare il successo solo quando c'è stato.
///
/// Compilato SOLO su iOS. Su macOS `document_dir()` è `~/Documents`, cioè una
/// cartella dell'utente in cui un'applicazione non deve scrivere senza che
/// nessuno gliel'abbia chiesto: là il download del browser è la strada giusta e
/// funziona.
#[cfg(target_os = "ios")]
#[tauri::command]
fn esporta_nei_documenti(app: tauri::AppHandle, nome: String, contenuto: String) -> Result<String, String> {
    use tauri::Manager;

    // Il nome arriva dal lato TypeScript: prima di usarlo come percorso si
    // riduce a un nome di file e basta. Non è difesa da un attacco — il
    // chiamante siamo noi — è difesa da un nome che contiene una data scritta
    // con le barre.
    let pulito: String = nome
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '-' })
        .collect();
    if pulito.is_empty() {
        return Err("nome del file vuoto".into());
    }

    let cartella = app
        .path()
        .document_dir()
        .map_err(|e| format!("cartella Documenti non raggiungibile: {e}"))?;
    std::fs::create_dir_all(&cartella).map_err(|e| e.to_string())?;
    let destinazione = cartella.join(&pulito);
    std::fs::write(&destinazione, contenuto.as_bytes())
        .map_err(|e| format!("scrittura fallita: {e}"))?;
    Ok(destinazione.to_string_lossy().into_owned())
}

/*
 * I computer subacquei riconosciuti da libdivecomputer.
 *
 * Il modulo c'è sempre; quello che cambia è cosa risponde. Senza la
 * funzionalità `computer-esterni` restituisce un elenco vuoto, che è la
 * risposta vera: quella copia dell'applicazione non riconosce nessun modello in
 * più rispetto ai due driver scritti in casa.
 *
 * STA QUI, IN CIMA, E NON PIÙ IN BASSO. Prima questa dichiarazione era finita
 * **fra un `#[cfg(desktop)]` e il modulo a cui quell'attributo si riferiva**, e
 * un commento in mezzo non spezza quel legame: l'attributo si è attaccato a lei.
 * Risultato, il modulo spariva dalla compilazione per iPhone e la build falliva
 * con «cannot find module» su una riga che non lo nominava. Sul Mac non si
 * vedeva, perché lì `desktop` è vero.
 */
mod computer_esterni;

/*
 * Il ponte fra libdivecomputer e il nostro Bluetooth. Esiste solo quando la
 * funzionalità è accesa: senza, non c'è niente a cui fare da ponte.
 */
#[cfg(feature = "computer-esterni")]
mod trasporto_ldc;

/*
 * La colla fra quel trasporto e `tauri-plugin-blec`, più il comando che
 * l'interfaccia chiama per scaricare.
 *
 * Il modulo c'è SEMPRE, come `computer_esterni`, e per la stessa ragione: senza
 * la funzionalità il comando esiste e risponde «questa copia non sa farlo»,
 * invece di sparire e far fallire l'interfaccia con «comando sconosciuto» —
 * che è un messaggio che non spiega niente a nessuno. Il ponte vero, dentro,
 * è compilato solo con `computer-esterni`.
 */
mod ponte_blec;

/// Il ritorno dell'accesso sul desktop: un ascoltatore su 127.0.0.1.
///
/// COME TORNA INDIETRO UN ACCESSO. Il giro OAuth si svolge nel browser di
/// sistema — l'unico posto dove chi accede può vedere il dominio vero e il
/// lucchetto — e alla fine Google rimanda a un indirizzo che dobbiamo saper
/// ricevere noi. Su iPhone quell'indirizzo è uno schema URL dell'applicazione;
/// sul Mac è una porta locale, che è la strada che Google raccomanda per le
/// applicazioni desktop.
///
/// PERCHÉ IL LOOPBACK È MEGLIO DI UNO SCHEMA URL, su un computer. Uno schema si
/// registra nel sistema, e QUALUNQUE altro programma può rivendicare lo stesso:
/// chi arriva dopo può intercettare il ritorno. Una porta su `127.0.0.1` la
/// tiene aperta questo processo e nessun altro, per il tempo di un accesso.
///
/// TRE PRECAUZIONI, e ognuna toglie un modo di sbagliare:
///
/// - si ascolta su `127.0.0.1` e non su `0.0.0.0`: la porta non esiste per il
///   resto della rete, solo per questa macchina;
/// - si accetta **una** richiesta e si chiude. Il browser ne manda spesso una
///   seconda per l'icona del sito, quindi si scartano quelle che non sono il
///   nostro percorso invece di consumare l'unico colpo a disposizione;
/// - c'è una scadenza. Un accesso abbandonato — la finestra chiusa, il computer
///   che si addormenta — non deve lasciare un ascoltatore vivo per sempre.
///
/// Il controllo che conta però non è qui: è lo `state` confrontato dal lato
/// TypeScript. Questa porta è aperta, e chiunque sulla macchina può bussarci;
/// quello che arriva senza uno `state` che combacia non viene guardato.
#[cfg(desktop)]
mod ritorno_accesso {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    /// Quanto si resta in ascolto prima di rinunciare.
    const SCADENZA: Duration = Duration::from_secs(300);

    /// La pagina che chi accede vede nel browser quando ha finito.
    const PAGINA: &str = "<!doctype html><html lang=\"it\"><head><meta charset=\"utf-8\">\
<title>MyDiveLog</title><style>body{font-family:system-ui,-apple-system,sans-serif;\
display:grid;place-items:center;height:100vh;margin:0;background:#0d0d0d;color:#fff}\
div{text-align:center;max-width:22rem;padding:2rem}p{color:#a0a0a0;line-height:1.5}\
</style></head><body><div><h1>Accesso completato</h1>\
<p>Puoi chiudere questa scheda e tornare a MyDiveLog.</p></div></body></html>";

    #[tauri::command]
    pub fn apri_ritorno_accesso(app: AppHandle) -> Result<u16, String> {
        let ascolto = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let porta = ascolto.local_addr().map_err(|e| e.to_string())?.port();
        ascolto
            .set_nonblocking(true)
            .map_err(|e| e.to_string())?;

        std::thread::spawn(move || {
            let scade = Instant::now() + SCADENZA;
            while Instant::now() < scade {
                match ascolto.accept() {
                    Ok((flusso, _)) => {
                        if let Some(percorso) = serviamo(flusso) {
                            // Solo il nostro percorso conta: le richieste per
                            // l'icona del sito si scartano senza consumare il
                            // giro.
                            if percorso.starts_with("/accesso") {
                                let _ = app.emit(
                                    "accesso-ritorno",
                                    format!("http://127.0.0.1:{porta}{percorso}"),
                                );
                                return;
                            }
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(120));
                    }
                    Err(_) => return,
                }
            }
            // Scaduto senza che nessuno sia tornato: si dichiara, invece di
            // lasciare l'interfaccia ad aspettare un evento che non arriverà.
            let _ = app.emit("accesso-ritorno", String::new());
        });

        Ok(porta)
    }

    /// Legge la riga di richiesta, risponde con la pagina, restituisce il percorso.
    fn serviamo(flusso: std::net::TcpStream) -> Option<String> {
        let mut lettore = BufReader::new(flusso.try_clone().ok()?);
        let mut riga = String::new();
        lettore.read_line(&mut riga).ok()?;
        // «GET /accesso?code=…&state=… HTTP/1.1»
        let percorso = riga.split_whitespace().nth(1)?.to_string();

        let mut scrittura = flusso;
        let risposta = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{}",
            PAGINA.len(),
            PAGINA
        );
        let _ = scrittura.write_all(risposta.as_bytes());
        let _ = scrittura.flush();
        Some(percorso)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_sql::Builder::default().build());

    /*
     * Il Bluetooth, che può non esserci senza che l'app muoia.
     *
     * `try_init` e non `init`: l'inizializzazione tocca lo stack Bluetooth del
     * sistema, e fallisce per ragioni che non sono colpa nostra — adattatore
     * assente su una macchina virtuale, servizio di sistema non partito, sandbox
     * senza il permesso. Con `init()` un fallimento diventa un panic all'avvio,
     * cioè l'applicazione non si apre e l'utente non può nemmeno leggere il
     * proprio logbook: un guasto in una funzione accessoria spegnerebbe quella
     * principale.
     *
     * Così invece il plugin semplicemente non c'è, i comandi dal lato
     * TypeScript falliscono, e `TauriBleTransport.available()` risponde
     * «Bluetooth non disponibile in questa versione» con il motivo. Tutto il
     * resto funziona.
     */
    let builder = match tauri_plugin_blec::try_init() {
        Ok(plugin) => builder.plugin(plugin),
        Err(e) => {
            eprintln!("Bluetooth non inizializzato: {e:?}");
            builder
        }
    };

    /*
     * Aprire un indirizzo nel browser di sistema.
     *
     * Serve all'accesso: la pagina di Google deve stare nel browser vero, dove
     * chi la guarda vede il dominio e il lucchetto, e non in una finestra
     * nostra che sarebbe indistinguibile da una finta.
     */
    let builder = builder.plugin(tauri_plugin_opener::init());

    /*
     * Su iOS il ritorno dall'accesso passa da uno schema URL, perché una porta
     * locale lì non si può aprire. Lo schema è dichiarato in `Info.ios.plist` e
     * corrisponde al client id di Google letto al contrario.
     */
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_deep_link::init());

    /*
     * L'aggiornamento automatico, e il riavvio che lo conclude. SUI COMPUTER.
     *
     * Sui telefoni no, e per due ragioni diverse: su iPhone gli aggiornamenti li
     * distribuisce l'App Store — un'applicazione che se li scaricasse per conto
     * suo verrebbe rifiutata alla revisione — e su Android un APK non si
     * installa da sé senza un permesso che spaventa. Là i due crate non vengono
     * nemmeno compilati.
     *
     * `desktop` e non `macos`: quella condizione risaliva a quando il Mac era
     * l'unico computer su cui girassimo, ed è rimasta com'era quando è arrivato
     * Windows. Chi avesse installato l'applicazione su un PC non avrebbe mai
     * saputo che ne era uscita una nuova.
     *
     * Il plugin non fa niente da solo: espone il comando che l'interfaccia
     * chiama quando vuole sapere se c'è una versione nuova. La decisione di
     * scaricarla resta di chi usa il programma — come per la sincronizzazione,
     * niente parte da sé.
     */
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        segreti::segreto_leggi,
        segreti::segreto_scrivi,
        segreti::segreto_cancella,
        ritorno_accesso::apri_ritorno_accesso,
        computer_esterni::elenca_computer_supportati,
        ponte_blec::scarica_da_computer_esterno
    ]);

    // Su iOS due differenze: l'esportazione di un file, che qui non può passare
    // dal download del browser, e nessun ascoltatore locale — il ritorno
    // dall'accesso arriva dallo schema URL.
    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        segreti::segreto_leggi,
        segreti::segreto_scrivi,
        segreti::segreto_cancella,
        esporta_nei_documenti,
        computer_esterni::elenca_computer_supportati,
        ponte_blec::scarica_da_computer_esterno
    ]);

    /*
     * ► WINDOWS E ANDROID, E PERCHÉ QUESTI DUE RAMI ESISTONO. ◄
     *
     * Prima c'erano solo i due rami di sopra, macOS e iOS. Su qualunque altra
     * piattaforma il costruttore arrivava a `run()` **senza nessun
     * `invoke_handler`**, e il risultato non era «qualche funzione in meno»: era
     * che OGNI comando Rust rispondeva «comando sconosciuto». Non dava errore in
     * compilazione, non dava errore all'avvio, e si vedeva solo toccando la cosa
     * giusta sull'apparecchio giusto — che qui non c'è.
     *
     * Le differenze rispetto ad Apple non sono arbitrarie: sono esattamente i
     * moduli che su queste piattaforme non vengono compilati.
     *
     * `segreti` non c'è: il portachiavi è di Apple, e `keyring` è una dipendenza
     * dichiarata solo per macOS e iOS. Il lato TypeScript se lo aspetta e ripiega
     * sull'archivio locale dicendolo.
     *
     * `ritorno_accesso` c'è su Windows, che è `desktop`, e NON su Android, che
     * non lo è. Conseguenza da dire e non da nascondere: **su Android l'accesso
     * con Google e con Apple non torna indietro**, perché non c'è né la porta
     * locale del desktop né lo schema URL di iOS. Il logbook funziona lo stesso,
     * senza account, che è come lo usa la maggioranza.
     */
    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        ritorno_accesso::apri_ritorno_accesso,
        computer_esterni::elenca_computer_supportati,
        ponte_blec::scarica_da_computer_esterno
    ]);

    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        computer_esterni::elenca_computer_supportati,
        ponte_blec::scarica_da_computer_esterno
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione Tauri");
}
