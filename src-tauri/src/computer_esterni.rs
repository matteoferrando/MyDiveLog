//! I computer subacquei che non abbiamo scritto noi: libdivecomputer.
//!
//! DA DUE A TRECENTOCINQUANTASEI. L'applicazione ha due driver scritti a mano —
//! Shearwater e Scubapro/Uwatec — verificati sul campo su computer veri, e
//! coprono per intero l'attrezzatura di chi l'ha scritta. Nel momento in cui la
//! deve usare qualcun altro, due modelli non sono un prodotto: sono una
//! dimostrazione. libdivecomputer 0.9.0 ne conosce **356**, di cui **110**
//! parlano Bluetooth LE — che è l'unico trasporto praticabile su un telefono.
//!
//! COSA NON SOSTITUISCE. Non il nostro Bluetooth, che resta
//! `tauri-plugin-blec`: libdivecomputer accetta un flusso di byte fornito da
//! chi la chiama (`dc_custom_open`), quindi trova il dispositivo e apre il
//! collegamento chi lo fa già bene, e lei ci parla sopra i protocolli. E non
//! `src/core`, che continua a ricevere il modello canonico: questa diventa una
//! **sorgente in più**, accanto ai parser e ai due driver, non al posto loro.
//!
//! NIENTE BINDGEN. Le dichiarazioni sono scritte a mano, venti righe, invece di
//! generarle: bindgen vorrebbe libclang installato su ogni macchina che compila
//! e produrrebbe diecimila righe di cui ne servono venti. È la stessa ragione
//! per cui in questo progetto gzip e il lettore SQLite sono scritti a mano.
//!
//! COSA C'È QUI, e dove sta il resto. Qui c'è **solo l'elenco** dei modelli che
//! la libreria riconosce — che è anche la prova che si compila, si collega e
//! risponde. Il ponte sul Bluetooth sta in `ponte_blec.rs`, lo scarico e la
//! conversione nel modello canonico in `trasporto_ldc.rs`, e la traduzione nel
//! modello del logbook in `src/core/ble/esterni.ts`.
//!
//! ► L'ELENCO VUOTO È UNA RISPOSTA, NON UN ERRORE. ◄ Compilata senza
//! `computer-esterni`, questa funzione restituisce zero modelli, e
//! l'interfaccia lo usa proprio per sapere com'è stata compilata la copia che
//! sta girando: `computer-esterni` è una funzionalità di compilazione, quindi
//! la stessa `src/` produce due binari diversi e leggere il codice non basta a
//! dire quale dei due si ha in mano.
//!
//! COSA MANCA DAVVERO, al 25 agosto 2026: **la prova con un computer vero.**
//! Tutta la catena si compila e si prova a pezzi — il trasporto contro un
//! flusso finto, la traduzione contro immersioni sintetiche — ma nessun
//! apparecchio di terzi è mai stato collegato. Finché non succede, il selettore
//! lo dichiara sotto ogni modello: «mai provato su questo modello».

use serde::Serialize;

/// Un modello riconosciuto, come lo mostrerebbe l'interfaccia.
#[derive(Serialize, Clone, Debug)]
pub struct ComputerSupportato {
    pub marca: String,
    pub modello: String,
    /// `serial`, `usb`, `usbhid`, `irda`, `bluetooth`, `ble`.
    pub trasporti: Vec<String>,
}

#[cfg(feature = "computer-esterni")]
mod ponte {
    use super::ComputerSupportato;
    use std::ffi::{c_char, c_int, c_uint, CStr};

    // Le sole dichiarazioni che servono, copiate dalle intestazioni pubbliche
    // di libdivecomputer. I tipi opachi restano opachi: non ne leggiamo mai
    // dentro, li passiamo e basta.
    #[repr(C)]
    struct DcIterator {
        _vuoto: [u8; 0],
    }
    #[repr(C)]
    struct DcDescriptor {
        _vuoto: [u8; 0],
    }

    extern "C" {
        fn dc_descriptor_iterator(iterator: *mut *mut DcIterator) -> c_int;
        fn dc_iterator_next(iterator: *mut DcIterator, item: *mut *mut DcDescriptor) -> c_int;
        fn dc_iterator_free(iterator: *mut DcIterator) -> c_int;
        fn dc_descriptor_get_vendor(descriptor: *mut DcDescriptor) -> *const c_char;
        fn dc_descriptor_get_product(descriptor: *mut DcDescriptor) -> *const c_char;
        fn dc_descriptor_get_transports(descriptor: *mut DcDescriptor) -> c_uint;
        fn dc_descriptor_free(descriptor: *mut DcDescriptor) -> c_int;
    }

    const DC_STATUS_SUCCESS: c_int = 0;

    /// I bit del trasporto, nell'ordine in cui `common.h` li dichiara.
    const TRASPORTI: [(c_uint, &str); 6] = [
        (1 << 0, "serial"),
        (1 << 1, "usb"),
        (1 << 2, "usbhid"),
        (1 << 3, "irda"),
        (1 << 4, "bluetooth"),
        (1 << 5, "ble"),
    ];

    /// Da un puntatore a `char` del C a una stringa nostra, senza fidarsi.
    ///
    /// libdivecomputer restituisce `NULL` per i campi che un modello non
    /// dichiara — succede sul nome del prodotto di qualche famiglia generica — e
    /// un `CStr::from_ptr(NULL)` non è un errore da gestire, è un crollo.
    fn testo(puntatore: *const c_char) -> String {
        if puntatore.is_null() {
            return String::new();
        }
        // SICUREZZA: il puntatore arriva da libdivecomputer, punta a una
        // stringa statica che vive quanto la libreria, e la copiamo subito.
        unsafe { CStr::from_ptr(puntatore) }.to_string_lossy().into_owned()
    }

    /// Tutti i modelli che la libreria conosce.
    ///
    /// L'iteratore e ogni descrittore vanno liberati, anche quando si esce a
    /// metà: sono allocazioni del C, e qui non c'è nessun `Drop` che se ne
    /// occupi al posto nostro.
    pub fn elenco() -> Result<Vec<ComputerSupportato>, String> {
        let mut iteratore: *mut DcIterator = std::ptr::null_mut();
        // SICUREZZA: passiamo l'indirizzo di un puntatore nullo, che è
        // esattamente quello che la funzione si aspetta di riempire.
        if unsafe { dc_descriptor_iterator(&mut iteratore) } != DC_STATUS_SUCCESS {
            return Err("libdivecomputer non ha restituito l’elenco dei modelli".into());
        }

        let mut trovati = Vec::new();
        loop {
            let mut descrittore: *mut DcDescriptor = std::ptr::null_mut();
            // SICUREZZA: l'iteratore è valido finché non lo liberiamo, sotto.
            if unsafe { dc_iterator_next(iteratore, &mut descrittore) } != DC_STATUS_SUCCESS {
                break;
            }
            let bit = unsafe { dc_descriptor_get_transports(descrittore) };
            trovati.push(ComputerSupportato {
                marca: testo(unsafe { dc_descriptor_get_vendor(descrittore) }),
                modello: testo(unsafe { dc_descriptor_get_product(descrittore) }),
                trasporti: TRASPORTI
                    .iter()
                    .filter(|(maschera, _)| bit & maschera != 0)
                    .map(|(_, nome)| (*nome).to_string())
                    .collect(),
            });
            unsafe { dc_descriptor_free(descrittore) };
        }
        unsafe { dc_iterator_free(iteratore) };
        Ok(trovati)
    }
}

/// L'elenco dei computer riconosciuti, o un elenco vuoto.
///
/// VUOTO E NON UN ERRORE quando la funzionalità non è compilata. Chi chiama —
/// l'interfaccia — deve poter dire «questa versione riconosce N modelli» senza
/// sapere com'è stata compilata, e zero è una risposta vera: questa copia
/// dell'applicazione non ne riconosce nessuno *in più* rispetto ai due driver
/// scritti in casa, che vivono altrove e non passano di qui.
#[tauri::command]
pub fn elenca_computer_supportati() -> Result<Vec<ComputerSupportato>, String> {
    #[cfg(feature = "computer-esterni")]
    {
        ponte::elenco()
    }
    #[cfg(not(feature = "computer-esterni"))]
    {
        Ok(Vec::new())
    }
}

#[cfg(all(test, feature = "computer-esterni"))]
mod prove {
    use super::*;

    #[test]
    fn la_libreria_risponde_e_conosce_molti_modelli() {
        // Il numero esatto cambia a ogni versione di libdivecomputer, quindi si
        // controlla l'ordine di grandezza: se un giorno tornassero due modelli,
        // vorrebbe dire che il collegamento c'è ma la libreria è quella
        // sbagliata — un guasto che passerebbe inosservato con un `> 0`.
        let elenco = elenca_computer_supportati().expect("l’elenco deve arrivare");
        assert!(elenco.len() > 200, "modelli trovati: {}", elenco.len());
    }

    #[test]
    fn ci_sono_modelli_con_bluetooth_le() {
        // È l'unico trasporto praticabile su un telefono: se questo numero
        // fosse zero, tutta l'integrazione servirebbe solo al Mac.
        let quanti = elenca_computer_supportati()
            .unwrap()
            .iter()
            .filter(|c| c.trasporti.iter().any(|t| t == "ble"))
            .count();
        assert!(quanti > 50, "modelli BLE: {quanti}");
    }

    #[test]
    fn marca_e_modello_non_sono_vuoti_per_i_computer_che_conosciamo() {
        let elenco = elenca_computer_supportati().unwrap();
        for atteso in ["Shearwater", "Scubapro", "Suunto", "Mares"] {
            assert!(
                elenco.iter().any(|c| c.marca == atteso),
                "manca la marca {atteso}"
            );
        }
    }
}
