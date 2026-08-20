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

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        segreti::segreto_leggi,
        segreti::segreto_scrivi,
        segreti::segreto_cancella
    ]);

    // Su iOS c'è un comando in più: l'esportazione di un file, che qui non può
    // passare dal download del browser.
    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        segreti::segreto_leggi,
        segreti::segreto_scrivi,
        segreti::segreto_cancella,
        esporta_nei_documenti
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione Tauri");
}
