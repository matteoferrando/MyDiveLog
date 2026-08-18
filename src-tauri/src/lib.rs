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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_sql::Builder::default().build());

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        segreti::segreto_leggi,
        segreti::segreto_scrivi,
        segreti::segreto_cancella
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione Tauri");
}
