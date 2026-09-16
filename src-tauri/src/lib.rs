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

/// L'esportazione di un file dai due telefoni, dove `<a download>` non fa niente.
///
/// IL PROBLEMA, che è peggio di quanto sembri. Sul desktop tutte le
/// esportazioni — backup JSON, UDDF, byte grezzi del computer subacqueo, foglio
/// del piano — passano da un `<a download>` con un URL `blob:`. Dentro la
/// WebView dei telefoni quel click non scarica niente E NON LANCIA NESSUN
/// ERRORE: il lato TypeScript non ha modo di accorgersene, quindi finiva per
/// scrivere «Backup scritto» quando non era stato scritto niente. Su una
/// funzione che esiste per rimettere in piedi l'archivio dopo un disastro, una
/// falsa conferma è il difetto peggiore possibile.
///
/// LA CURA È DIVERSA SUI DUE TELEFONI, e non per capriccio: è che i due sistemi
/// rispondono in modo diverso alla domanda «dov'è il file adesso».
///
///  · **iPhone** — si scrive nella cartella Documenti dell'applicazione. Con
///    `UIFileSharingEnabled` e `LSSupportsOpeningDocumentsInPlace` — già in
///    `Info.ios.plist` — quella cartella compare nell'app File sotto «Sul mio
///    iPhone → MyDiveLog», da dove il file si sposta, si condivide e si manda
///    dove si vuole. La destinazione ha un nome che una persona può seguire.
///
///  · **Android** — si CHIEDE dove, con il selettore di sistema. Vedi il
///    blocco qui sotto: è la correzione del 16 settembre 2026 e ha una storia.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► LA CARTELLA DOVE IL FILE C'ERA E NESSUNO POTEVA VEDERLO. ◄
///
/// Il 15 settembre 2026 una segnalazione da un Samsung: *«premendo "Esporta
/// PDF" compare "PDF salvato dove il sistema mette i download", ma il file non
/// compare né in Download né in Recenti né cercando tutti i PDF.»* La causa era
/// quella raccontata qui sopra — il ramo nativo esisteva **solo per iOS** — e il
/// 15 sera è stata chiusa: Android passa da qui, il file si scrive davvero, e
/// il messaggio mostra il percorso.
///
/// Il giorno dopo la stessa persona ha riprovato con la versione nuova:
///
///   *«Purtroppo il pdf non si genera ancora anche se è cambiato il messaggio.
///    Forse perché si genera in una cartella che non risulta visibile se non da
///    pc.»*
///
/// Aveva ragione, e la seconda frase è la diagnosi esatta. Su Android
/// `document_dir()` di Tauri non è una cartella dell'utente: è
/// `getExternalFilesDir(DIRECTORY_DOCUMENTS)`, cioè
/// `/storage/emulated/0/Android/data/<pacchetto>/files/Documents`. Da Android 11
/// **nessun gestore di file può entrare in `Android/data`** — la vede solo un PC
/// collegato via USB — e alla disinstallazione dell'applicazione quella cartella
/// viene cancellata insieme a tutto quello che contiene.
///
/// Quindi la correzione del 15 aveva smesso di mentire ma non aveva ancora
/// consegnato niente: *il file c'era, e non era raggiungibile*. Un backup che si
/// può leggere solo attaccando il telefono a un computer non è un backup, è un
/// promemoria di dove sarebbe potuto essere.
///
/// ► LA STRADA GIUSTA SU ANDROID È CHIEDERE. ◄ `ACTION_CREATE_DOCUMENT` —
/// lo Storage Access Framework, quello che il selettore di sistema apre — è
/// l'unico modo con cui un'applicazione senza permessi speciali scrive in una
/// cartella dell'utente. Costa un tocco in più e restituisce tre cose che qui
/// dentro non si potevano avere: una cartella VERA (Download, Drive, la scheda
/// SD), un file che sopravvive alla disinstallazione, e — non ultimo — la
/// certezza che chi ha premuto sa dov'è finito, perché l'ha scelto lui.
///
/// E se chiude il selettore senza scegliere, **non si scrive niente e lo si
/// dice**. È la stessa regola di sempre, applicata al caso nuovo: non si
/// annuncia un file che non c'è, nemmeno quando la ragione per cui non c'è è
/// che l'utente ha cambiato idea.
///
/// Compilato sui due TELEFONI, e non sui computer. Su macOS `document_dir()` è
/// `~/Documents`, cioè una cartella dell'utente in cui un'applicazione non deve
/// scrivere senza che nessuno gliel'abbia chiesto: là il download del browser è
/// la strada giusta e funziona.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► E QUESTO `#[cfg]` DICEVA SOLO `ios` MENTRE IL GESTORE DI ANDROID LA
///   REGISTRAVA GIÀ. ◄
///
/// Il 16 settembre 2026, al primo giro utile, la compilazione per Android è
/// morta con *«cannot find macro `__tauri_command_name_esporta_nei_documenti`
/// in this scope»*. **Registrare un comando non lo compila**: sono due gesti, e
/// io ne avevo fatto uno solo.
///
/// Nessuna prova di questo progetto poteva vederlo.
/// `tests/gestoriPerPiattaforma.test.ts` legge l'ELENCO dei gestori, non per
/// quali bersagli la funzione esiste; e `cargo check` sul Mac non compila mai
/// il bersaglio Android. L'ha trovato la CI, che è il posto giusto perché è
/// l'unico che compila davvero per quel bersaglio — ed è il motivo per cui il
/// workflow delle altre piattaforme esiste.
///
/// *Adesso la prova c'è: un comando registrato per una piattaforma deve avere
/// un `#[cfg]` che quella piattaforma la comprende.*
#[cfg(any(target_os = "ios", target_os = "android"))]
#[tauri::command]
async fn esporta_nei_documenti(
    app: tauri::AppHandle,
    nome: String,
    tipo: String,
    contenuto: String,
) -> Result<Esportato, String> {
    /*
     * ► ASINCRONA, E NON PER FARE BELLA FIGURA. ◄
     *
     * Su Android questa funzione aspetta la risposta di un'ACTIVITY di sistema:
     * il selettore si apre, l'utente sceglie, e il risultato torna sul thread
     * principale. Un comando SINCRONO di Tauri può essere eseguito proprio lì,
     * e un'attesa bloccante sul thread principale mentre il risultato deve
     * arrivare sullo stesso thread è la definizione di stallo: l'applicazione
     * si pianterebbe con il selettore aperto e nessuno potrebbe più toccarla.
     *
     * Dichiarandola `async` gira sul runtime asincrono, e l'attesa vera sta
     * dentro `spawn_blocking`, cioè su un thread che può permettersi di
     * fermarsi.
     */
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
    scrivi_fuori(&app, pulito, tipo, contenuto).await
}

/// Dove è finito il file — o il fatto che non ci sia finito.
///
/// ► PERCHÉ NON BASTA PIÙ UNA STRINGA. ◄ Prima questa funzione restituiva il
/// percorso, e «percorso» voleva dire «scritto». Con il selettore di Android
/// esiste un terzo esito che non è né un percorso né un errore: l'utente ha
/// chiuso il selettore. Non è un guasto — non c'è niente da riprovare e niente
/// da controllare — ma non è nemmeno un successo, e riportarlo come una delle
/// due cose sarebbe la solita bugia in una forma nuova.
///
/// Tre campi, e il lato TypeScript li legge tutti e tre.
#[cfg(any(target_os = "ios", target_os = "android"))]
#[derive(serde::Serialize)]
struct Esportato {
    /// Il percorso sul disco, quando ce n'è uno da mostrare. Su Android la
    /// destinazione è un `content://…` che non significa niente per nessuno:
    /// là resta vuoto, e la frase dice «dove l'hai scelto tu».
    percorso: Option<String>,
    /// Il nome con cui il file è stato salvato.
    nome: Option<String>,
    /// Vero quando il selettore si è chiuso senza una destinazione. **Niente è
    /// stato scritto**, e non è un errore.
    annullato: bool,
}

/// iPhone: la cartella Documenti dell'applicazione, che l'app File mostra.
#[cfg(target_os = "ios")]
async fn scrivi_fuori(
    app: &tauri::AppHandle,
    pulito: String,
    _tipo: String,
    contenuto: String,
) -> Result<Esportato, String> {
    use tauri::Manager;

    let cartella = app
        .path()
        .document_dir()
        .map_err(|e| format!("cartella Documenti non raggiungibile: {e}"))?;
    std::fs::create_dir_all(&cartella).map_err(|e| e.to_string())?;
    let destinazione = cartella.join(&pulito);
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► SI SCRIVE ACCANTO E POI SI RINOMINA, MAI SOPRA. ◄
     *
     * IL DIFETTO CHIUSO IL 15 SETTEMBRE 2026. `std::fs::write` apre con
     * `O_TRUNC`: **azzera il file prima di scrivere il nuovo contenuto**. E il
     * nome del backup dipende solo dalla data — `mydivelog-backup-AAAA-MM-GG.json`
     * — quindi il secondo backup della giornata colpisce il primo.
     *
     * Su un iPhone, che chiude le applicazioni quando la memoria scarseggia,
     * basta che il processo muoia a metà scrittura: il backup precedente non
     * c'è più e quello nuovo è troncato. L'unica copia della giornata resta
     * mezza, e nessuno lo sa.
     *
     * La docstring del comando dice che «una falsa conferma è il difetto
     * peggiore che ci possa essere». Un backup troncato al posto di uno intero
     * è la stessa cosa scritta sul disco.
     *
     * Si scrive in un file temporaneo nella STESSA cartella e si rinomina: la
     * rinomina è atomica sullo stesso filesystem, quindi in ogni istante sul
     * nome definitivo c'è o il backup vecchio intero o quello nuovo intero.
     */
    let temporaneo = cartella.join(format!(".{pulito}.parziale"));
    {
        use std::io::Write;
        let mut file =
            std::fs::File::create(&temporaneo).map_err(|e| format!("scrittura fallita: {e}"))?;
        file.write_all(contenuto.as_bytes()).map_err(|e| format!("scrittura fallita: {e}"))?;
        /*
         * `sync_all` PRIMA della rinomina, e non è pedanteria: senza, i byte
         * possono essere ancora nella cache del sistema quando il nome cambia,
         * e un telefono che si spegne in quel momento lascia un file dal nome
         * giusto e dal contenuto vuoto — che è peggio di non averlo affatto,
         * perché sembra un backup.
         */
        file.sync_all().map_err(|e| format!("scrittura fallita: {e}"))?;
    }
    std::fs::rename(&temporaneo, &destinazione).map_err(|e| {
        // Il temporaneo non deve restare in giro: è nascosto (comincia per
        // punto) ma occuperebbe spazio a ogni tentativo fallito.
        let _ = std::fs::remove_file(&temporaneo);
        format!("scrittura fallita: {e}")
    })?;
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► SI RILEGGE PRIMA DI DIRE CHE C'È. ◄
     *
     * Questa funzione esiste per non dare una falsa conferma — c'è scritto
     * nella docstring del comando. Fino a qui però aveva **dedotto** il successo:
     * nessuna chiamata era fallita, quindi il file c'è. È il ragionamento che il
     * progetto rifiuta ovunque: *un esito zero dice che il comando non è morto,
     * non che abbia fatto quello che doveva.*
     *
     * Un `metadata` costa una syscall e trasforma «ho scritto» in «c'è, e pesa
     * quanto deve». Il caso che prende è reale: una quota che si esaurisce fra
     * la scrittura e la rinomina, o un filesystem montato in sola lettura che
     * accetta la `create` e perde il contenuto.
     */
    let scritti = std::fs::metadata(&destinazione)
        .map_err(|e| format!("scritto ma non rileggibile: {e}"))?
        .len();
    verifica_misura(scritti, &contenuto)?;
    Ok(Esportato {
        percorso: Some(destinazione.to_string_lossy().into_owned()),
        nome: Some(pulito),
        annullato: false,
    })
}

/// Android: si chiede dove, e si scrive lì.
///
/// Tre passaggi, e il secondo è l'unico che non si poteva fare prima:
///
///  1. si apre il selettore di sistema (`ACTION_CREATE_DOCUMENT`) con il nome
///     già proposto e il tipo del file, così l'elenco parte dalla cartella
///     giusta;
///  2. quello che torna è un `content://…`, non un percorso: per scriverci
///     serve un descrittore dal ContentResolver, ed è quello che
///     `tauri_plugin_fs` sa chiedere ad Android. È l'unico motivo per cui quel
///     plugin è fra le dipendenze — dal lato interfaccia non è raggiungibile,
///     perché nessuna capacità gli dà il permesso;
///  3. si scrive, si forza sul disco, e **si rilegge la misura** dal descrittore
///     stesso: `fstat` sul file aperto, che è l'unica verifica possibile quando
///     non c'è un percorso da riaprire.
#[cfg(target_os = "android")]
async fn scrivi_fuori(
    app: &tauri::AppHandle,
    pulito: String,
    tipo: String,
    contenuto: String,
) -> Result<Esportato, String> {
    use std::io::Write;
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    /*
     * Il tipo arriva dal chiamante («application/pdf», «application/json», …).
     * Il parametro va tolto: `application/xml;charset=utf-8` in un Intent non
     * corrisponde a nessun filtro e il selettore si apre su un elenco vuoto.
     * `parseFiltersOption` del plugin accetta sia un'estensione sia un tipo
     * MIME intero — si passa il tipo, che è quello che sappiamo per certo.
     */
    let tipo = tipo.split(';').next().unwrap_or("").trim().to_owned();
    let tipo = if tipo.contains('/') { tipo } else { "application/octet-stream".to_owned() };

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_file_name(&pulito)
        .add_filter("MyDiveLog", &[tipo.as_str()])
        .save_file(move |scelto| {
            // Il plugin chiama questa chiusura da un thread suo. Se il canale è
            // già chiuso non c'è niente da fare e niente da dire: vuol dire che
            // dall'altra parte non aspetta più nessuno.
            let _ = tx.send(scelto);
        });

    let scelto = tauri::async_runtime::spawn_blocking(move || rx.recv().ok())
        .await
        .map_err(|e| format!("il selettore non ha risposto: {e}"))?
        .flatten();

    /*
     * ► NIENTE SCELTO = NIENTE SCRITTO, E LO SI DICE. ◄
     *
     * Il plugin riduce a `None` sia «l'utente ha chiuso il selettore» sia «il
     * selettore non è partito»: la sua implementazione per Android non
     * distingue i due casi. Per fortuna la frase che serve è vera in tutti e
     * due — *non hai scelto dove salvare, quindi non è stato scritto niente* —
     * e non pretende di sapere perché.
     *
     * Quello che NON si fa: ripiegare sulla cartella privata dell'applicazione.
     * Sarebbe scrivere dove l'utente non guarda dopo che ha detto di no, cioè
     * il difetto di partenza rimesso in piedi con un'altra scusa.
     */
    let Some(destinazione) = scelto else {
        return Ok(Esportato { percorso: None, nome: None, annullato: true });
    };

    let mut opzioni = OpenOptions::new();
    opzioni.write(true).create(true).truncate(true);
    let mut file = app
        .fs()
        .open(destinazione, opzioni)
        .map_err(|e| format!("scrittura fallita: {e}"))?;
    file.write_all(contenuto.as_bytes()).map_err(|e| format!("scrittura fallita: {e}"))?;
    file.flush().map_err(|e| format!("scrittura fallita: {e}"))?;
    /*
     * `sync_all` sul descrittore del ContentResolver: gli stessi byte in cache
     * e lo stesso telefono che può spegnersi, con l'aggravante che qui il file
     * lo sta scrivendo un'altra applicazione per conto nostro. Se il sistema
     * rifiuta la sincronizzazione — succede su alcuni fornitori di documenti —
     * non è un motivo per dichiarare fallita una scrittura riuscita: la misura
     * qui sotto è la verifica che conta.
     */
    let _ = file.sync_all();
    /*
     * ► SI RILEGGE LA MISURA DAL DESCRITTORE, QUANDO C'È UNA MISURA DA
     *   LEGGERE. ◄
     *
     * Non c'è un percorso da riaprire — la destinazione è un `content://…` — ma
     * `fstat` sul file aperto dà la stessa risposta: quanti byte ci sono
     * davvero. È la verifica che trasforma «ho scritto» in «c'è, e pesa quanto
     * deve», la stessa dell'altro telefono.
     *
     * ► E L'`if`, CHE NON È UNA SCAPPATOIA. ◄ Non tutti i fornitori di
     * documenti di Android restituiscono un file: Drive, per esempio,
     * restituisce una PIPE, perché i byte li sta mandando in rete mentre
     * arrivano. Su una pipe `fstat` risponde zero — non perché la scrittura sia
     * fallita, ma perché la domanda non ha senso — e pretendere la misura
     * dichiarerebbe fallita ogni esportazione verso il cloud. *Un controllo che
     * non si può fare non va simulato: va dichiarato dove si può fare.* Su una
     * pipe restano `write_all` e `flush`, che sono andati a buon fine e che
     * significano «consegnati al fornitore»; su un file vero c'è la misura.
     */
    let stato = file.metadata().map_err(|e| format!("scritto ma non rileggibile: {e}"))?;
    if stato.is_file() {
        verifica_misura(stato.len(), &contenuto)?;
    }
    Ok(Esportato { percorso: None, nome: Some(pulito), annullato: false })
}

/// I byte sul disco devono essere quelli che dovevano andarci.
///
/// Una riga sola, in comune fra i due telefoni, perché *due copie della stessa
/// regola sono una regola e la sua versione vecchia*.
#[cfg(any(target_os = "ios", target_os = "android"))]
fn verifica_misura(scritti: u64, contenuto: &str) -> Result<(), String> {
    let attesi = contenuto.as_bytes().len() as u64;
    if scritti != attesi {
        return Err(format!(
            "scrittura incompleta: sul disco ci sono {scritti} byte invece di {attesi}"
        ));
    }
    Ok(())
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
 * ► «TUTTE O NESSUNA» ERA SCRITTO E NON ERA VERO. ◄
 *
 * `storage/sqlite.ts` mandava `BEGIN`, gli inserimenti e `COMMIT` come chiamate
 * separate, e `tauri-plugin-sql` non tiene una connessione: tiene un POOL. Una
 * verifica esterna l'ha riprodotto il 16 settembre 2026 — tre risposte «Ok» e la
 * riga resta dopo il `ROLLBACK`.
 *
 * Una transazione vera si può scrivere solo da questa parte, perché solo da
 * questa parte si può tenere la connessione. Il modulo non sa niente di
 * immersioni: sa solo eseguire un elenco di istruzioni tutte insieme o per
 * niente. Su TUTTE le piattaforme, perché l'archivio SQLite c'è su tutte.
 */
mod archivio;

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
/// Tenere acceso lo schermo mentre uno scarico è in corso. Vedi `schermo.rs`:
/// la strada del web non funziona dentro una WKWebView, e quella nativa sì.
mod schermo;

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
/// ► E ANDROID? CI STA DENTRO, ED È LA RAGIONE PER CUI LÌ SI ENTRA. ◄
///
/// Questo modulo era `#[cfg(desktop)]`, cioè fuori da Android, e la conseguenza
/// era che su Android non si poteva accedere affatto. La strada che sembrava
/// obbligata era quella dell'iPhone — uno schema URL — e costava: un filtro
/// d'intenti dentro un manifesto GENERATO, quindi uno script che lo rimetta a
/// ogni build, e per l'accesso con Google la registrazione di un client Android
/// su Google Cloud, che pretende l'impronta del certificato di firma. La chiave
/// con cui firmiamo l'APK si rigenera a ogni build: quell'impronta non esiste.
///
/// Il loopback invece **su Android c'è**, ed è lo stesso identico codice del
/// desktop: `127.0.0.1` non passa dalla rete, non chiede permessi che l'app non
/// abbia già, e non lascia in giro nessuna associazione permanente. L'unico
/// dubbio ragionevole era se Android tenga vivo l'ascoltatore mentre il browser
/// è in primo piano: un processo appena passato in secondo piano non viene
/// ucciso subito, e i trecento secondi di attesa qui sotto sono molto più di
/// quanto duri un accesso.
///
/// Se un giorno si scoprisse che su qualche telefono non regge, la strada dello
/// schema URL resta lì, col suo costo, come ripiego — non come prima scelta.
#[cfg(any(desktop, target_os = "android"))]
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
     * ► SU ANDROID DUE PLUGIN IN PIÙ, E SERVONO A UNA COSA SOLA. ◄
     *
     * Il selettore di sistema che chiede dove salvare un file
     * (`ACTION_CREATE_DOCUMENT`), e il descrittore per scrivere sul
     * `content://…` che quel selettore restituisce. Sono le due metà della
     * correzione raccontata sopra `esporta_nei_documenti`: senza la prima non
     * si può scegliere una cartella vera, senza la seconda non si può scriverci.
     *
     * ► NON APRONO NIENTE VERSO L'INTERFACCIA. ◄ Tutt'e due si usano dal lato
     * Rust, dentro `scrivi_fuori`, e nessuna capacità in `capabilities/` dà
     * alla WebView il permesso di chiamarne i comandi: il sistema dei permessi
     * di Tauri non li concede per il fatto che il plugin ci sia. In particolare
     * `tauri_plugin_fs` — che se raggiungibile sarebbe un accesso al filesystem
     * aperto dalla pagina — resta muto a qualunque richiesta arrivi da lì.
     *
     * Solo su Android: sui due computer il download del browser funziona e su
     * iPhone la cartella Documenti è già visibile nell'app File. Dichiararli per
     * bersaglio significa che altrove questi crate non vengono nemmeno
     * compilati.
     */
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_fs::init()).plugin(tauri_plugin_dialog::init());

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
    /*
      ► NEL PACCHETTO DEL MAC APP STORE QUESTO PLUGIN NON C'È. ◄

      `senza-aggiornamenti` lo toglie dalla compilazione, non lo disattiva:
      dentro il negozio aggiorna Apple, e un programma che si sostituisce da sé
      viene rifiutato. Togliere il codice invece di spegnerlo evita anche che nel
      binario restino le stringhe di un aggiornatore che non aggiorna — che è
      esattamente la cosa su cui una revisione fa domande.

      `tauri_plugin_process` invece resta: serve al riavvio, che l'aggiornamento
      usa ma non è solo suo.
    */
    #[cfg(all(desktop, not(feature = "senza-aggiornamenti")))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_process::init());

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        archivio::tutte_o_nessuna,
        segreti::segreto_leggi,
        segreti::segreto_scrivi,
        segreti::segreto_cancella,
        ritorno_accesso::apri_ritorno_accesso,
        computer_esterni::elenca_computer_supportati,
        computer_esterni::riconosci_computer_esterno,
        ponte_blec::scarica_da_computer_esterno,
        ponte_blec::rispondi_codice_pin,
        schermo::tieni_acceso_lo_schermo
    ]);

    // Su iOS due differenze: l'esportazione di un file, che qui non può passare
    // dal download del browser, e nessun ascoltatore locale — il ritorno
    // dall'accesso arriva dallo schema URL.
    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        archivio::tutte_o_nessuna,
        segreti::segreto_leggi,
        segreti::segreto_scrivi,
        segreti::segreto_cancella,
        esporta_nei_documenti,
        computer_esterni::elenca_computer_supportati,
        computer_esterni::riconosci_computer_esterno,
        ponte_blec::scarica_da_computer_esterno,
        ponte_blec::rispondi_codice_pin,
        schermo::tieni_acceso_lo_schermo
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
     * `ritorno_accesso` **c'è anche su Android**, e questo commento diceva il
     * contrario — «c'è su Windows e NON su Android» — mentre la riga sotto lo
     * registrava. *Un commento che descrive un caso e un corpo che ne descrive
     * un altro è la stessa trappola descritta in `piattaforma.ts` a proposito
     * di `suMac`.* Corretto il 16 settembre 2026, leggendo questo blocco per
     * un'altra ragione.
     *
     * Quello che invece **non c'è** su Android è `segreti`: il portachiavi è di
     * Apple, e `keyring` è una dipendenza dichiarata solo per macOS e iOS. Il
     * lato TypeScript se lo aspetta e ripiega sull'archivio locale dicendolo.
     */
    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        archivio::tutte_o_nessuna,
        ritorno_accesso::apri_ritorno_accesso,
        computer_esterni::elenca_computer_supportati,
        computer_esterni::riconosci_computer_esterno,
        ponte_blec::scarica_da_computer_esterno,
        ponte_blec::rispondi_codice_pin,
        schermo::tieni_acceso_lo_schermo
    ]);

    /*
     * ► E SU ANDROID `esporta_nei_documenti` NON C'ERA, ed è costato un PDF. ◄
     *
     * Segnalazione dal campo del 15 settembre 2026, Samsung Android:
     * *«premendo "Esporta PDF" compare "PDF salvato dove il sistema mette i
     * download", ma il file non compare né in Download né in Recenti né
     * cercando tutti i PDF.»*
     *
     * Il file non c'era. Dentro una WebView il click su `<a download>` non
     * scarica niente e non lancia nessun errore — è scritto in cima a
     * `ui/esporta.ts`, dove il difetto è raccontato al passato perché era stato
     * chiuso **su iOS soltanto**. Il ramo di questo comando faceva la stessa
     * cosa: `#[cfg(target_os = "ios")]` e nient'altro.
     *
     * Qui dentro non c'è una riga che sia di Apple: è `std::fs` più la cartella
     * che Tauri risolve per la piattaforma. Non c'era per omissione, non per
     * un motivo.
     */
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        archivio::tutte_o_nessuna,
        esporta_nei_documenti,
        ritorno_accesso::apri_ritorno_accesso,
        computer_esterni::elenca_computer_supportati,
        computer_esterni::riconosci_computer_esterno,
        ponte_blec::scarica_da_computer_esterno,
        ponte_blec::rispondi_codice_pin,
        schermo::tieni_acceso_lo_schermo
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione Tauri");
}
