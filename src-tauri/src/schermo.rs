//! Tenere acceso lo schermo mentre il computer subacqueo parla.
//!
//! ════════════════════════════════════════════════════════════════════════════
//! ► PERCHÉ QUESTO FILE ESISTE IN RUST E NON IN TYPESCRIPT. ◄
//!
//! Perché in TypeScript era già stato scritto, l'11 settembre 2026, e **non
//! funziona**. `navigator.wakeLock` è la strada del web ed è in Safari dalla
//! 16.4, ma MyDiveLog su iOS e su macOS non gira in Safari: gira dentro una
//! **WKWebView**, dove quella funzione non c'è. Il registro di compatibilità
//! delle WebView del W3C la dà come non disponibile in WKWebView (iOS e macOS),
//! Android WebView e WebView2, e il difetto 254545 di WebKit spiega il perché:
//! l'implementazione appoggia su `UIApplication.idleTimerDisabled`, cioè
//! esattamente la cosa che da qui si può chiamare e da lì no.
//!
//! *Il rimedio scritto la mattina si è scoperto inerte la sera, e a scoprirlo è
//! stata la misura che gli era stata messa accanto per dubitarne.* Da qui la
//! regola che vale oltre questo file: **la strada del web si tiene come
//! ripiego, non come prima scelta**, su tutto ciò che riguarda l'hardware.
//!
//! ► PERCHÉ CONTA DAVVERO, E NON È UNA COMODITÀ. ◄ La documentazione di Apple
//! su Core Bluetooth è esplicita: un'applicazione senza il permesso di lavorare
//! in secondo piano passa allo stato **sospeso** poco dopo, e da sospesa «is
//! unable to perform Bluetooth-related tasks, nor is it aware of any
//! Bluetooth-related events». Gli eventi restano in coda e arrivano solo al
//! ritorno in primo piano. Per libdivecomputer, che sta aspettando una risposta,
//! quello è un computer che ha smesso di parlare: la lettura scade, il backend
//! ritenta, e su Mares — che non ha né checksum né numeri di sequenza — un
//! ritentativo fuori tempo è il modo documentato di desincronizzare il
//! protocollo senza potersene accorgere.
//!
//! E lo scarico di un archivio pieno dura **minuti**: il blocco automatico di
//! iPhone, che si può impostare al minimo su trenta secondi, scatta di sicuro.
//!
//! ► COSA NON FA. ◄ Non impedisce il passaggio in secondo piano. Se chi guarda
//! cambia applicazione, iOS sospende comunque, e nessuna riga di questo file lo
//! evita: servirebbe il permesso `bluetooth-central`, che è un'altra faccenda e
//! un'altra revisione di Apple. Per quello c'è la misura nel diario, che conta
//! le sparizioni, e la riga a schermo che chiede di non farlo.

/// Chiede al sistema di non spegnere lo schermo da solo (o di lasciarlo
/// spegnere di nuovo).
///
/// Risponde **quello che è successo davvero**, non quello che si voleva fare:
/// `false` vuol dire «su questa piattaforma non lo so fare», e chi chiama lo
/// scrive nel diario e lo dice a chi guarda. *Un comando che risponde sempre
/// «fatto» trasformerebbe una mancanza in una bugia, che è esattamente
/// l'errore che questo file esiste per riparare.*
#[tauri::command]
pub fn tieni_acceso_lo_schermo(
    #[allow(unused_variables)] app: tauri::AppHandle,
    #[allow(unused_variables)] acceso: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        /*
         * ► SUL THREAD PRINCIPALE, E NON È UNA FORMALITÀ. ◄ `UIApplication` è
         * UIKit, e UIKit da un altro thread non è «meno affidabile»: è
         * comportamento indefinito. Lo scarico gira su un thread suo — deve,
         * perché blocca dentro la libreria — quindi questa chiamata arriva
         * quasi sempre da fuori dal thread principale.
         *
         * `run_on_main_thread` accoda e torna subito: non si aspetta la
         * risposta, perché aspettare un thread che potrebbe essere occupato a
         * disegnare, da dentro uno scarico, è un modo di bloccare tutto per una
         * comodità.
         */
        let esito = app.run_on_main_thread(move || {
            // SICUREZZA: `sharedApplication` esiste sempre in un'app iOS viva, e
            // `setIdleTimerDisabled:` è una proprietà di `UIApplication` da
            // iOS 2.0. Il messaggio non ha valore di ritorno.
            unsafe {
                let classe = objc2::class!(UIApplication);
                let applicazione: *mut objc2::runtime::AnyObject =
                    objc2::msg_send![classe, sharedApplication];
                if !applicazione.is_null() {
                    let _: () = objc2::msg_send![
                        applicazione,
                        setIdleTimerDisabled: objc2::runtime::Bool::new(acceso)
                    ];
                }
            }
        });
        return match esito {
            Ok(()) => Ok(true),
            // Il thread principale non c'è più: l'applicazione si sta
            // chiudendo. Non è un guasto da raccontare, è una corsa persa.
            Err(_) => Ok(false),
        };
    }

    /*
     * ► SU TUTTO IL RESTO SI DICE DI NO, E SI DICE PERCHÉ. ◄
     *
     * **macOS**: lo schermo che si spegne non sospende l'applicazione — il
     * processo continua a girare e il Bluetooth continua a consegnare. Il caso
     * che farebbe danno è la macchina intera che va in sospensione, ed è un
     * altro meccanismo (`IOPMAssertion`), che qui non serve per il guasto che
     * stiamo inseguendo.
     *
     * **Android**: servirebbe `FLAG_KEEP_SCREEN_ON` sull'attività, cioè del
     * codice Kotlin nel guscio. Non c'è nessun apparecchio Android su cui
     * provarlo, e scriverlo alla cieca vorrebbe dire aggiungere una riga che
     * dice «fatto» senza sapere se lo fa — che è il difetto che questa versione
     * sta correggendo. Resta scritto come cosa da fare, non come cosa fatta.
     *
     * **Windows e Linux**: gli scarichi sono a filo o su un Bluetooth che non
     * sospende il processo.
     */
    #[cfg(not(target_os = "ios"))]
    Ok(false)
}
