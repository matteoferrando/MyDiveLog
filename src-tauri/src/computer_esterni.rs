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
        fn dc_descriptor_filter(
            descriptor: *mut DcDescriptor,
            transport: c_uint,
            userdata: *const std::ffi::c_void,
        ) -> c_int;
        fn dc_descriptor_free(descriptor: *mut DcDescriptor) -> c_int;
    }

    const DC_STATUS_SUCCESS: c_int = 0;
    const DC_TRANSPORT_BLE: c_uint = 1 << 5;

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

    /// I modelli che libdivecomputer associa a un nome Bluetooth.
    ///
    /// ► SONO I FILTRI DI LIBDIVECOMPUTER, NON UNA TABELLA NOSTRA. ◄
    /// `dc_descriptor_filter` sa che «Quad Ci» e «Mares bluelink pro» sono
    /// Mares, «OSTC» un Heinrichs Weikamp, «EON Steel» un Suunto, «FQ001124» un
    /// Oceanic/Aqualung — sono gli stessi filtri con cui Subsurface propone il
    /// modello da sé. Sono per COSTRUTTORE: per «Quad Ci» tornano tutti i Mares
    /// con il Bluetooth, e a stringere sul modello ci pensa chi chiama, che
    /// conosce il catalogo.
    ///
    /// LA TRAPPOLA, E DOVE STA LA GUARDIA. Un descrittore SENZA filtro risponde
    /// «sì» a qualunque nome (`descriptor.c`: `if (descriptor->filter == NULL)
    /// return 1`): preso alla lettera, un paio di cuffie verrebbe riconosciuto
    /// come ognuno dei modelli senza filtro. Nella 0.9.0 nessun descrittore con
    /// il Bluetooth è senza filtro, quindi qui non c'è un controllo — sarebbe
    /// una guardia che nessuna prova può far diventare rossa. La guardia sta
    /// nella prova `ogni_modello_bluetooth_ha_un_filtro_che_distingue`, che
    /// diventa rossa il giorno in cui un aggiornamento della libreria porta un
    /// descrittore senza filtro: quel giorno il controllo va scritto qui.
    pub fn riconosci(nome: &str) -> Result<Vec<ComputerSupportato>, String> {
        let nome = nome.trim();
        if nome.is_empty() {
            return Ok(Vec::new());
        }
        let vero = std::ffi::CString::new(nome).map_err(|_| "nome con un byte nullo dentro")?;

        let mut iteratore: *mut DcIterator = std::ptr::null_mut();
        if unsafe { dc_descriptor_iterator(&mut iteratore) } != DC_STATUS_SUCCESS {
            return Err("libdivecomputer non ha restituito l’elenco dei modelli".into());
        }
        let mut trovati = Vec::new();
        loop {
            let mut descrittore: *mut DcDescriptor = std::ptr::null_mut();
            if unsafe { dc_iterator_next(iteratore, &mut descrittore) } != DC_STATUS_SUCCESS {
                break;
            }
            let ble = unsafe { dc_descriptor_get_transports(descrittore) } & DC_TRANSPORT_BLE != 0;
            let dice_si = unsafe {
                dc_descriptor_filter(descrittore, DC_TRANSPORT_BLE, vero.as_ptr() as *const _) != 0
            };
            if ble && dice_si {
                trovati.push(ComputerSupportato {
                    marca: testo(unsafe { dc_descriptor_get_vendor(descrittore) }),
                    modello: testo(unsafe { dc_descriptor_get_product(descrittore) }),
                    trasporti: vec!["ble".to_string()],
                });
            }
            unsafe { dc_descriptor_free(descrittore) };
        }
        unsafe { dc_iterator_free(iteratore) };
        Ok(trovati)
    }
}

/// I modelli che libdivecomputer riconosce da un nome Bluetooth: vedi
/// `ponte::riconosci`. Vuoto quando non riconosce niente, e vuoto in una copia
/// compilata senza la libreria — che è la verità: quella copia non riconosce
/// nessun computer in più rispetto ai driver di casa.
#[tauri::command]
pub fn riconosci_computer_esterno(nome: String) -> Result<Vec<ComputerSupportato>, String> {
    #[cfg(feature = "computer-esterni")]
    {
        ponte::riconosci(&nome)
    }
    #[cfg(not(feature = "computer-esterni"))]
    {
        let _ = nome;
        Ok(Vec::new())
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
    fn il_nome_bluetooth_di_un_mares_porta_ai_mares_e_solo_a_loro() {
        // «Quad Ci» è uno dei prefissi del filtro Mares: tornano tutti i Mares
        // con il Bluetooth (a stringere sul modello ci pensa chi chiama), e
        // nessun'altra marca.
        let trovati = riconosci_computer_esterno("Quad Ci".into()).unwrap();
        assert!(trovati.iter().any(|c| c.modello == "Quad Ci"), "{trovati:?}");
        assert!(trovati.len() > 5, "{trovati:?}");
        assert!(trovati.iter().all(|c| c.marca == "Mares"), "{trovati:?}");
        // Il prefisso vale anche con il numero di serie in coda e le maiuscole
        // diverse.
        let trovati = riconosci_computer_esterno("quad ci 1234".into()).unwrap();
        assert!(trovati.iter().any(|c| c.modello == "Quad Ci"), "{trovati:?}");
    }

    #[test]
    fn un_nome_che_non_e_un_computer_subacqueo_non_porta_a_nessun_modello() {
        for nome in ["Cuffie JBL", "iPhone di Matteo", "", "   "] {
            let trovati = riconosci_computer_esterno(nome.into()).unwrap();
            assert!(trovati.is_empty(), "«{nome}» → {trovati:?}");
        }
    }

    #[test]
    fn ogni_modello_bluetooth_ha_un_filtro_che_distingue() {
        /*
         * La premessa su cui `riconosci` si regge: nessun descrittore con il
         * Bluetooth risponde «sì» a un nome che nessun apparecchio può avere.
         * In `descriptor.c` un filtro nullo risponde sì a tutto, e allora un
         * paio di cuffie verrebbe riconosciuto come quel modello. Se questa
         * prova diventa rossa dopo un aggiornamento della libreria, in
         * `riconosci` va aggiunto il secondo passaggio con il nome
         * impossibile — non prima, perché sarebbe una guardia mai vista rossa.
         */
        let trovati = ponte::riconosci("\u{1}nessun-apparecchio\u{2}").unwrap();
        assert!(trovati.is_empty(), "descrittori senza filtro: {trovati:?}");
    }

    #[test]
    fn i_nomi_delle_altre_famiglie_arrivano_alla_famiglia_giusta() {
        // OSTC → Heinrichs Weikamp, EON Steel → Suunto, FQ001124 → la
        // famiglia Oceanic/Aqualung (che nel nome porta il modello come due
        // lettere: FQ = i770R).
        let hw = riconosci_computer_esterno("OSTC+ 12345".into()).unwrap();
        assert!(!hw.is_empty() && hw.iter().all(|c| c.marca == "Heinrichs Weikamp"), "{hw:?}");
        let suunto = riconosci_computer_esterno("EON Steel".into()).unwrap();
        assert!(suunto.iter().any(|c| c.marca == "Suunto" && c.modello == "EON Steel"), "{suunto:?}");
        let oceanic = riconosci_computer_esterno("FQ001124".into()).unwrap();
        assert!(oceanic.iter().any(|c| c.modello == "i770R"), "{oceanic:?}");
        assert!(oceanic.iter().all(|c| c.trasporti == vec!["ble".to_string()]), "{oceanic:?}");
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
