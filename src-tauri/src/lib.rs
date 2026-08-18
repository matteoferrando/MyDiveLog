//! Guscio nativo di MyDiveLog.
//!
//! Volutamente sottile: tutta la logica (parser, metriche, coach) vive nel core
//! TypeScript, così è identica su desktop, iOS e web. Qui dentro c'è solo ciò
//! che il web non può fare — in questa versione, aprire un vero file SQLite.
//!
//! Il punto d'ingresso è `run()` e non `main()` perché su iOS Tauri compila
//! questo crate come libreria statica e la chiama dal progetto Xcode.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione Tauri");
}
