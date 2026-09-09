//! La colla fra `tauri-plugin-blec` e `FlussoBle`, e il comando che l'interfaccia chiama.
//!
//! COSA MANCAVA. `trasporto_ldc.rs` sa parlare con libdivecomputer attraverso un
//! flusso di byte, e `FlussoBle` è quel flusso: riceve le notifiche da un
//! `Receiver<Vec<u8>>` e scrive con una chiusura. Chi riempie quel canale e chi
//! esegue quella chiusura non era scritto da nessuna parte. È questo file.
//!
//! `FlussoBle` NON è stato toccato, ed è la cosa giusta: la sua ignoranza del
//! plugin è quello che rende provabile tutto il trasporto senza Bluetooth. Qui
//! sotto si ripete lo stesso trucco un piano più in su — il ponte non parla con
//! `tauri-plugin-blec` ma con un tratto, `AntennaBle`, di cui il plugin è una
//! implementazione e i test ne sono un'altra.
//!
//! ------------------------------------------------------------------------
//! IL PONTE FRA SINCRONO E ASINCRONO, che è il punto delicato.
//!
//! `dc_device_foreach` è bloccante: chiama la nostra lettura e la nostra
//! scrittura da un thread normale e ci resta dentro per minuti. Il plugin è
//! asincrono su tokio. Le due cose non si toccano mai direttamente:
//!
//!  - lo **scarico** gira su un `std::thread::spawn` suo. Può bloccarsi quanto
//!    vuole perché non è un thread del runtime;
//!  - le **notifiche** arrivano da una callback che il plugin esegue nel
//!    runtime; la callback non fa altro che versarle in un
//!    `std::sync::mpsc::Sender`, che è la coda da cui `FlussoBle` legge.
//!    Versare in un canale non blocca, quindi il runtime non si ferma mai;
//!  - le **scritture** fanno il viaggio inverso: la chiusura manda i byte a un
//!    compito asincrono su un canale di tokio e aspetta la conferma su un
//!    `sync_channel(1)`. Aspettare lì è legittimo: siamo sul thread dello
//!    scarico, non su un thread del runtime.
//!
//! **`block_on` non compare in questo file**, e non è una preferenza di stile:
//! chiamarlo da dentro un thread del runtime tokio va in panico («Cannot start a
//! runtime from within a runtime») o, nel caso peggiore, si impianta in silenzio
//! con il compito che deve consegnare i byte in coda dietro a chi li aspetta.
//! Per la stessa ragione `blocking_send` e `recv_timeout` si possono chiamare
//! SOLO dal thread dello scarico: se un giorno qualcuno spostasse la chiusura di
//! scrittura dentro un compito asincrono, il sintomo sarebbe un panico alla
//! prima scrittura.
//!
//! ------------------------------------------------------------------------
//! QUALE SERVIZIO BLE, che è il problema che libdivecomputer non risolve.
//!
//! libdivecomputer conosce i protocolli e non conosce il Bluetooth: a quale
//! servizio e a quali caratteristiche scrivere lo deve decidere chi la chiama, e
//! ogni costruttore ha il suo. Qui la risposta arriva da tre strade in fila —
//! una tabella dei profili che hanno bisogno di qualcosa in più dei byte (i
//! crediti del Terminal I/O di Heinrichs Weikamp), l'elenco dei servizi che
//! Subsurface riconosce, e un ripiego che guarda cosa il dispositivo annuncia.
//! In tutte e tre le caratteristiche si scoprono dalle PROPRIETÀ dichiarate,
//! non da tabelle per modello.
//!
//! ------------------------------------------------------------------------
//! ► NESSUNA RIGA PER MODELLO, ed è una scelta presa dopo una segnalazione. ◄
//!
//! Un centro immersioni con un Mares Quad Ci ha visto «stato -6» venti volte.
//! La prima idea era aggiungere una riga di profilo per Mares con la modalità
//! di scrittura «giusta»: una riga per marca, ognuna verificata da uno
//! sconosciuto con l'apparecchio in mano, e ogni marca mancante un altro «-6»
//! che non insegna niente. Subsurface scarica da tutte queste marche senza una
//! tabella per modello, con tre meccanismi generali, e sono quelli che stanno
//! qui: la modalità di scrittura si legge dalle proprietà e **si negozia** se
//! la prima scelta fallisce o resta muta; il controllo di flusso a crediti
//! del Terminal I/O è implementato come protocollo, non indovinato; e il
//! diario registra lo scambio — byte scritti, modalità, prima notifica,
//! chiamata fallita — così che la segnalazione dopo dica DOVE si rompe.
//! Quello che il diario non può dire lo dice il numero di libdivecomputer,
//! che ora arriva con il suo nome e con la causa annotata dal trasporto.

// ------------------------------------------------------------------ il ponte

#[cfg(feature = "computer-esterni")]
mod dentro {
    use std::collections::VecDeque;
    use std::future::Future;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, SyncSender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use crate::trasporto_ldc::{
        traduci, trova_descrittore, AccessoriBle, CollegamentoLdc, Contesto, FlussoBle,
        GuastoScrittura, ImmersioneLdc, Riassemblaggio, Ripiego,
    };

    // --------------------------------------------------- quel che il GATT dice

    /// Una caratteristica come il dispositivo la dichiara.
    ///
    /// Copia nostra e non il tipo del plugin, per una ragione sola ma decisiva:
    /// così la scelta del profilo — che è la parte in cui si sbaglia — si prova
    /// costruendo a mano un dispositivo finto, senza btleplug e senza un
    /// adattatore Bluetooth acceso.
    #[derive(Clone, Debug)]
    pub struct CaratteristicaVista {
        pub uuid: String,
        /// «write», cioè con conferma.
        pub scrivibile: bool,
        /// «write without response», cioè senza conferma.
        pub scrivibile_senza_risposta: bool,
        /// «notify» oppure «indicate»: da qui arrivano le risposte.
        pub notifica: bool,
    }

    #[derive(Clone, Debug)]
    pub struct ServizioVisto {
        pub uuid: String,
        pub caratteristiche: Vec<CaratteristicaVista>,
    }

    /// Con o senza conferma. Vedi `BleServiceProfile.writeType` in
    /// `src/core/ble/types.ts`: sbagliare qui dà un dispositivo che si collega e
    /// poi tace, che è il sintomo più difficile da leggere.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum ModoScrittura {
        ConRisposta,
        SenzaRisposta,
    }

    impl ModoScrittura {
        fn altro(self) -> Self {
            match self {
                Self::ConRisposta => Self::SenzaRisposta,
                Self::SenzaRisposta => Self::ConRisposta,
            }
        }
    }

    /// Cosa il profilo CHIEDE, prima di guardare il dispositivo.
    ///
    /// `Automatica` significa «senza conferma se la caratteristica lo permette,
    /// con conferma altrimenti» — la stessa regola di Subsurface (`qt-ble.cpp`,
    /// `BLEObject::write`) — ed è la scelta giusta quando nessuno ha guardato
    /// il dispositivo vero: le due modalità non sono intercambiabili a livello
    /// GATT, e scrivere «senza risposta» dove è dichiarato solo «write»
    /// fallisce alla PRIMA scrittura. Se la caratteristica le dichiara
    /// entrambe, la prima scelta resta un'ipotesi, ed è per questo che il ponte
    /// la NEGOZIA: vedi `Scambio`.
    // `ConRisposta` non è usata da nessuna voce, e resta: togliere una delle
    // tre possibilità perché al momento non serve significherebbe che chi
    // aggiunge il primo computer che la vuole deve prima rimetterla.
    #[allow(dead_code)]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Preferenza {
        ConRisposta,
        SenzaRisposta,
        Automatica,
    }

    /// Una voce della tabella dei profili noti.
    struct VoceProfilo {
        /// L'UUID del servizio. È la chiave: se il dispositivo lo annuncia, è lui.
        servizio: &'static str,
        /// La caratteristica su cui scrivere. `None` = si scopre dalle proprietà.
        scrittura: Option<&'static str>,
        /// La caratteristica da cui arrivano le risposte. `None` = si scopre.
        notifica: Option<&'static str>,
        preferenza: Preferenza,
        /// I crediti del Terminal I/O, per chi li vuole: (dove si concedono,
        /// da dove si ascoltano). Vedi `CreditiRisolti`.
        crediti: Option<(&'static str, &'static str)>,
        /// **Su quale computer questa voce è stata verificata davvero.**
        ///
        /// `None` non è un campo dimenticato: è una dichiarazione, e finisce
        /// nella riga di diario che l'interfaccia mostra. Una voce mai provata
        /// che si spaccia per provata è peggio di una voce assente, perché
        /// quando il computer tace nessuno sa se è colpa del profilo.
        verificato_su: Option<&'static str>,
    }

    /// I profili che hanno bisogno di qualcosa in più delle proprietà.
    ///
    /// ► NON È UNA TABELLA PER MODELLO, e non deve diventarlo. ◄ Ci sta un
    /// servizio solo se le proprietà GATT non bastano a farlo parlare: perché
    /// dentro ci sono più caratteristiche scrivibili e va detto quale è quella
    /// dei dati (Telit), o perché prima di leggere serve un protocollo in più
    /// (i crediti). Un servizio che è «una seriale su BLE» — una che si scrive,
    /// una che notifica — NON va aggiunto qui: lo trova `SERVIZI_RICONOSCIUTI`
    /// o il ripiego, e la modalità di scrittura la negozia il ponte.
    ///
    /// Le due voci Shearwater e Scubapro restano per la ragione opposta: sono
    /// state verificate con l'apparecchio in mano, e il diario lo dice.
    const PROFILI: &[VoceProfilo] = &[
        VoceProfilo {
            // La famiglia Peregrine/Perdix/Petrel/Teric/Tern. Il Perdix 3 usa un
            // altro servizio E un altro protocollo: sta in
            // `SERVIZI_RICONOSCIUTI`, non qui.
            servizio: "fe25c237-0ece-443c-b0aa-e02033e7029d",
            scrittura: None,
            notifica: None,
            // Verificata col computer in mano: il Peregrine vuole «senza
            // conferma», ed è quello che dichiara anche il driver in TypeScript.
            preferenza: Preferenza::SenzaRisposta,
            crediti: None,
            verificato_su: Some("Shearwater Peregrine"),
        },
        VoceProfilo {
            // La «seriale su BLE» di Scubapro/Uwatec: Aladin Matrix, A1, A2, G2,
            // G3, Luna 2.
            servizio: "fdcdeaaa-295d-470e-bf15-04217b7aa0a0",
            scrittura: None,
            notifica: None,
            // Automatica: il servizio è verificato sull'Aladin, la MODALITÀ DI
            // SCRITTURA no. Con la negoziazione del ponte non è più un rischio
            // muto: se la prima scelta sbaglia, si vede e si cambia.
            preferenza: Preferenza::Automatica,
            crediti: None,
            verificato_su: Some(
                "Scubapro Aladin Sport Matrix (servizio; la modalità di scrittura no)",
            ),
        },
        /*
         * HEINRICHS WEIKAMP, cioè tutta la famiglia OSTC, con il modulo
         * Bluetooth di Telit (ex Stollmann). Il servizio ha un UUID «standard»
         * — 0xFEFB, che Telit ha registrato presso il SIG — e QUATTRO
         * caratteristiche, due per i dati e due per i crediti:
         *
         *   00000001-… DATA_RX      si scrive (i nostri comandi)
         *   00000002-… DATA_TX      notifica (le risposte)
         *   00000003-… CREDITS_RX   si scrive, con conferma (i crediti che
         *                           concediamo al computer)
         *   00000004-… CREDITS_TX   indica (i crediti che lui concede a noi)
         *
         * Due scrivibili: le proprietà da sole non bastano, e senza i crediti
         * il computer non manda un byte. È il caso esatto per cui questa
         * tabella esiste. Fonte: la «TIO Implementation Guide» di Telit, come
         * implementata in `qt-ble.cpp` di Subsurface (`setupHwTerminalIo`).
         */
        VoceProfilo {
            servizio: "0000fefb-0000-1000-8000-00805f9b34fb",
            scrittura: Some("00000001-0000-1000-8000-008025000000"),
            notifica: Some("00000002-0000-1000-8000-008025000000"),
            preferenza: Preferenza::Automatica,
            crediti: Some((
                "00000003-0000-1000-8000-008025000000",
                "00000004-0000-1000-8000-008025000000",
            )),
            verificato_su: None,
        },
        /*
         * Lo stesso, con il modulo u-blox degli OSTC più recenti: DUE
         * caratteristiche, una che fa dati in entrambi i versi e una che fa
         * crediti in entrambi i versi. Stessa fonte.
         */
        VoceProfilo {
            servizio: "2456e1b9-26e2-8f83-e744-f34f01e9d701",
            scrittura: Some("2456e1b9-26e2-8f83-e744-f34f01e9d703"),
            notifica: Some("2456e1b9-26e2-8f83-e744-f34f01e9d703"),
            preferenza: Preferenza::Automatica,
            crediti: Some((
                "2456e1b9-26e2-8f83-e744-f34f01e9d704",
                "2456e1b9-26e2-8f83-e744-f34f01e9d704",
            )),
            verificato_su: None,
        },
    ];

    /// I servizi che Subsurface riconosce come «seriale su BLE», in ordine di
    /// precedenza. Copiati da `serial_service_uuids` in `qt-ble.cpp`.
    ///
    /// Servono a una cosa sola: quando il dispositivo espone più di un servizio
    /// plausibile, scegliere quello giusto invece di rifiutare. Le
    /// caratteristiche e la modalità di scrittura si scoprono comunque dalle
    /// proprietà — questo elenco non dice come parlare, dice solo a chi. Il
    /// nome accanto finisce nel diario, perché «servizio 544e326b-…» non dice
    /// niente a nessuno e «Mares BlueLink Pro» sì.
    const SERVIZI_RICONOSCIUTI: &[(&str, &str)] = &[
        ("544e326b-5b72-c6b0-1c46-41c1bc448118", "Mares BlueLink Pro"),
        ("98ae7120-e62e-11e3-badd-0002a5d5c51b", "Suunto (EON Steel/Core, D5)"),
        ("cb3c4555-d670-4670-bc20-b61dbc851e9a", "Pelagic (i770R, i200C, Pro Plus X, Geo 4.0)"),
        ("ca7b0001-f785-4c38-b599-c7c5fbadb034", "Pelagic (i330R, DSX)"),
        ("1aa44039-1667-4b29-87cc-dfecaaf31d97", "Shearwater (Perdix 3)"),
        ("0000fcef-0000-1000-8000-00805f9b34fb", "Divesoft"),
        // Cressi prima di Nordic: differiscono solo negli ultimi byte, e un
        // Goa espone entrambi.
        ("6e400001-b5a3-f393-e0a9-e50e24dc10b8", "Cressi"),
        ("6e400001-b5a3-f393-e0a9-e50e24dcca9e", "Nordic UART"),
        ("00000001-8c3b-4f2c-a59e-8c08224f3253", "Halcyon Symbios"),
        ("84968ffe-d26d-478a-b953-5010bcf58bca", "Seac"),
    ];

    /// Le caratteristiche da NON usare anche se le proprietà le renderebbero
    /// candidate. Da `skip_characteristics` in `qt-ble.cpp`: (uuid, non per
    /// scrivere, non per leggere).
    ///
    /// Il McLean Extreme ha un servizio solo con dentro sei caratteristiche
    /// scrivibili, e quelle giuste non si distinguono dalle proprietà; l'Halcyon
    /// Symbios ne ha una per verso che va evitata. Sono i due casi in cui
    /// «scoprire dalle proprietà» non regge, ed è meno male dirlo qui che
    /// rifiutare il dispositivo.
    const CARATTERISTICHE_DA_EVITARE: &[(&str, bool, bool)] = &[
        ("49535343-6daa-4d02-abf6-19569aca69fe", true, true),
        ("49535343-aca3-481c-91ec-d85e28a60318", true, true),
        ("49535343-026e-3a9b-954c-97daef17e26e", true, true),
        ("49535343-4c8a-39b3-2f49-511cff073b7e", true, true),
        ("00000101-8c3b-4f2c-a59e-8c08224f3253", false, true),
        ("00000201-8c3b-4f2c-a59e-8c08224f3253", true, false),
    ];

    /// I crediti del Terminal I/O, risolti sul dispositivo.
    ///
    /// COME FUNZIONA, in tre righe. Il computer non manda un pacchetto di dati
    /// finché non ha «crediti»: gliene concediamo 254 all'inizio scrivendo un
    /// byte — con conferma — sulla caratteristica di concessione; ogni
    /// notifica di dati ne consuma uno; quando ne restano 32 gliene
    /// concediamo altri 222. La caratteristica di ascolto va sottoscritta
    /// (indica i crediti che LUI concede a NOI) ma il suo contenuto non serve
    /// a niente, e Subsurface infatti lo ignora.
    #[derive(PartialEq, Eq, Clone, Debug)]
    pub struct CreditiRisolti {
        pub concessione: String,
        pub ascolto: String,
    }

    /// Quanti crediti si concedono all'inizio, e la soglia sotto cui si ricarica.
    /// Gli stessi numeri di Subsurface (`MAXIMAL_HW_CREDIT`, `MINIMAL_HW_CREDIT`).
    const CREDITI_INIZIALI: usize = 254;
    const CREDITI_MINIMI: usize = 32;

    /// Il profilo scelto, pronto da usare.
    #[derive(Clone, Debug)]
    pub struct ProfiloRisolto {
        pub servizio: String,
        pub scrittura: String,
        pub notifica: String,
        pub modo: ModoScrittura,
        /// L'altra modalità, se la caratteristica la dichiara anche: è quello
        /// che il ponte prova quando la prima fallisce o resta muta. `None`
        /// vuol dire che non c'è niente da negoziare.
        pub alternativa: Option<ModoScrittura>,
        pub crediti: Option<CreditiRisolti>,
        /// Una riga per il diario tecnico: da dove viene questa scelta.
        ///
        /// Quando un protocollo ricostruito non risponde, la prima domanda è
        /// sempre «stiamo scrivendo sulla caratteristica giusta?». Senza questa
        /// riga la risposta costa un altro giro di prove col computer in mano.
        pub descrizione: String,
    }

    /// Gli UUID si confrontano senza guardare le maiuscole: CoreBluetooth li dà
    /// in maiuscolo, btleplug in minuscolo, e la tabella è scritta a mano.
    fn uguale(a: &str, b: &str) -> bool {
        a.eq_ignore_ascii_case(b)
    }

    /// I servizi che non sono mai quello giusto, anche se avessero la forma.
    ///
    /// Sono i servizi di aggiornamento firmware — quello di Nordic e i due di
    /// Broadcom, da `upgrade_service_uuids` di Subsurface — che sono scrivibili
    /// e notificano e stanno addosso a mezzo mondo del BLE. Se finissero fra i
    /// candidati, la scelta diventerebbe ambigua e verrebbe rifiutata una
    /// situazione che ambigua non è.
    const SERVIZI_DI_AGGIORNAMENTO: &[&str] = &[
        "0000fe59-0000-1000-8000-00805f9b34fb",
        "00001530-1212-efde-1523-785feabcd123",
        "9e5d1e47-5c13-43a0-8635-82ad38a1386f",
        "a86abc2d-d44c-442e-99f7-80059a873e36",
    ];

    /// Un UUID «standard» del SIG: `0000xxxx-0000-1000-8000-00805f9b34fb`.
    ///
    /// Accesso generico, batteria, ora, informazioni sul dispositivo, HID… non
    /// sono mai una seriale, e Subsurface li ignora tutti in blocco a meno che
    /// non siano nell'elenco dei riconosciuti. La regola generale batte
    /// l'elenco a mano che c'era prima: copriva otto servizi e il nono
    /// avrebbe reso ambiguo un dispositivo che funziona.
    fn standard_del_sig(uuid: &str) -> bool {
        let u = uuid.to_ascii_lowercase();
        u.len() == 36 && u.starts_with("0000") && u.ends_with("-0000-1000-8000-00805f9b34fb")
    }

    /// I servizi che il RIPIEGO non deve considerare.
    ///
    /// Vale solo per il ripiego: i due standard che conosciamo (0xFEFB di
    /// Telit, 0xFCEF di Divesoft) vengono presi PRIMA, dalla tabella e
    /// dall'elenco, e qui non arrivano mai. Un'eccezione per loro sarebbe
    /// codice che nessuna prova può far diventare rosso.
    fn di_sistema(servizio: &str) -> bool {
        SERVIZI_DI_AGGIORNAMENTO.iter().any(|s| uguale(s, servizio)) || standard_del_sig(servizio)
    }

    fn da_evitare(uuid: &str, per_scrivere: bool) -> bool {
        CARATTERISTICHE_DA_EVITARE.iter().any(|(u, scrittura, lettura)| {
            uguale(u, uuid) && if per_scrivere { *scrittura } else { *lettura }
        })
    }

    /// Dentro un servizio, chi si scrive e chi risponde.
    ///
    /// Quando la tabella nomina gli UUID si usano quelli, e se non ci sono o non
    /// hanno le proprietà giuste è un errore: una voce sbagliata va corretta
    /// nella tabella, non aggirata in silenzio scegliendone un'altra.
    /// Cosa fare quando, dentro un servizio, le candidate restano più d'una.
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Ambiguita {
        /// Un servizio che nessuno conosce: meglio un messaggio che un comando
        /// scritto alla caratteristica sbagliata.
        Rifiuta,
        /// Un servizio dell'elenco di Subsurface, dove la regola «la prima
        /// scrivibile, la prima che notifica» (`BLEObject::write`,
        /// `is_notify_characteristic`) è quella con cui Subsurface scarica
        /// davvero da quei computer. Rifiutare lì significherebbe negare un
        /// dispositivo che funziona altrove per una prudenza che non abbiamo
        /// pagato con niente.
        PrimaDichiarata,
    }

    fn scegli(
        servizio: &ServizioVisto,
        scrittura: Option<&str>,
        notifica: Option<&str>,
        preferenza: Preferenza,
        ambiguita: Ambiguita,
    ) -> Result<(CaratteristicaVista, CaratteristicaVista, ModoScrittura, Option<ModoScrittura>), String>
    {
        let elenco = |c: &[CaratteristicaVista]| {
            c.iter().map(|c| c.uuid.clone()).collect::<Vec<_>>().join(", ")
        };

        let scrivibili: Vec<CaratteristicaVista> = match scrittura {
            Some(voluta) => servizio
                .caratteristiche
                .iter()
                .filter(|c| uguale(&c.uuid, voluta))
                .cloned()
                .collect(),
            None => servizio
                .caratteristiche
                .iter()
                .filter(|c| (c.scrivibile || c.scrivibile_senza_risposta) && !da_evitare(&c.uuid, true))
                .cloned()
                .collect(),
        };
        let notificanti: Vec<CaratteristicaVista> = match notifica {
            Some(voluta) => servizio
                .caratteristiche
                .iter()
                .filter(|c| uguale(&c.uuid, voluta))
                .cloned()
                .collect(),
            None => servizio
                .caratteristiche
                .iter()
                .filter(|c| c.notifica && !da_evitare(&c.uuid, false))
                .cloned()
                .collect(),
        };

        /*
         * Quando le candidate sono più d'una si prova a distinguerle: la
         * caratteristica «di scrittura» di una seriale su BLE non notifica, e
         * quella delle notifiche non si scrive. Molti moduli però ne espongono
         * una sola che fa entrambe le cose, quindi il filtro si applica solo se
         * lascia qualcosa.
         */
        let restringi = |v: Vec<CaratteristicaVista>, tieni: fn(&CaratteristicaVista) -> bool| {
            let stretto: Vec<CaratteristicaVista> = v.iter().filter(|c| tieni(c)).cloned().collect();
            if stretto.is_empty() {
                v
            } else {
                stretto
            }
        };
        let scrivibili = if scrittura.is_none() && scrivibili.len() > 1 {
            restringi(scrivibili, |c| !c.notifica)
        } else {
            scrivibili
        };
        let notificanti = if notifica.is_none() && notificanti.len() > 1 {
            restringi(notificanti, |c| !c.scrivibile && !c.scrivibile_senza_risposta)
        } else {
            notificanti
        };

        let da_scrivere = match scrivibili.as_slice() {
            [una] => una.clone(),
            [] => {
                return Err(format!(
                    "nel servizio {} non c’è nessuna caratteristica su cui scrivere",
                    servizio.uuid
                ))
            }
            [prima, ..] if ambiguita == Ambiguita::PrimaDichiarata => prima.clone(),
            molte => {
                return Err(format!(
                    "nel servizio {} ci sono {} caratteristiche scrivibili ({}): \
va scelta a mano nella tabella dei profili, invece di indovinare",
                    servizio.uuid,
                    molte.len(),
                    elenco(molte)
                ))
            }
        };
        let da_ascoltare = match notificanti.as_slice() {
            [una] => una.clone(),
            [] => {
                return Err(format!(
                    "nel servizio {} non c’è nessuna caratteristica che notifica: \
il computer non avrebbe modo di rispondere",
                    servizio.uuid
                ))
            }
            [prima, ..] if ambiguita == Ambiguita::PrimaDichiarata => prima.clone(),
            molte => {
                return Err(format!(
                    "nel servizio {} ci sono {} caratteristiche che notificano ({}): \
va scelta a mano nella tabella dei profili, invece di indovinare",
                    servizio.uuid,
                    molte.len(),
                    elenco(molte)
                ))
            }
        };
        // Una caratteristica NOMINATA dalla tabella deve avere le proprietà
        // che la tabella le attribuisce: una voce che punta a una
        // caratteristica su cui non si può scrivere è una voce sbagliata, e
        // va detto adesso, non dopo tre secondi di silenzio.
        if !da_scrivere.scrivibile && !da_scrivere.scrivibile_senza_risposta {
            return Err(format!(
                "la caratteristica {} indicata dalla tabella per scrivere non accetta scritture",
                da_scrivere.uuid
            ));
        }
        if !da_ascoltare.notifica {
            return Err(format!(
                "la caratteristica {} indicata dalla tabella per le risposte non notifica",
                da_ascoltare.uuid
            ));
        }

        let modo = match preferenza {
            Preferenza::ConRisposta => {
                if !da_scrivere.scrivibile {
                    return Err(format!(
                        "la caratteristica {} non accetta scritture con conferma, \
ma il profilo le chiede",
                        da_scrivere.uuid
                    ));
                }
                ModoScrittura::ConRisposta
            }
            Preferenza::SenzaRisposta => {
                if !da_scrivere.scrivibile_senza_risposta {
                    return Err(format!(
                        "la caratteristica {} non accetta scritture senza conferma, \
ma il profilo le chiede",
                        da_scrivere.uuid
                    ));
                }
                ModoScrittura::SenzaRisposta
            }
            Preferenza::Automatica => {
                if da_scrivere.scrivibile_senza_risposta {
                    ModoScrittura::SenzaRisposta
                } else {
                    ModoScrittura::ConRisposta
                }
            }
        };
        // L'altra modalità esiste solo se la caratteristica la dichiara: la
        // negoziazione prova quello che il GATT permette, non quello che
        // vorremmo.
        let alternativa = if da_scrivere.scrivibile && da_scrivere.scrivibile_senza_risposta {
            Some(modo.altro())
        } else {
            None
        };
        Ok((da_scrivere, da_ascoltare, modo, alternativa))
    }

    fn nome_modo(modo: ModoScrittura) -> &'static str {
        match modo {
            ModoScrittura::ConRisposta => "con conferma",
            ModoScrittura::SenzaRisposta => "senza conferma",
        }
    }

    /// La riga di diario che descrive una scelta, uguale per le tre strade.
    fn descrivi(
        provenienza: &str,
        servizio: &str,
        scrittura: &CaratteristicaVista,
        modo: ModoScrittura,
        alternativa: Option<ModoScrittura>,
        notifica: &CaratteristicaVista,
    ) -> String {
        let negoziabile = match alternativa {
            Some(_) => "; la caratteristica accetta entrambe le modalità, si negozia",
            None => "; la caratteristica accetta solo questa modalità",
        };
        format!(
            "{provenienza}; servizio {servizio}, scrittura {} ({}), notifiche {}{negoziabile}",
            scrittura.uuid,
            nome_modo(modo),
            notifica.uuid
        )
    }

    // ------------------------------------------------- il giro dei tentativi

    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► PERCHÉ ESISTE UN GIRO DI TENTATIVI, E PERCHÉ SOLO SU QUESTI CINQUE ASSI.
     *
     * Fino al 9 settembre 2026, quando uno scarico non riusciva l'applicazione
     * sapeva dire soltanto «non è riuscito». Eppure le scelte fatte per
     * arrivare a quel punto sono cinque, ognuna presa una volta sola e senza
     * appello: quale servizio, quale caratteristica si scrive, quale ascolta,
     * con o senza conferma, e se le notifiche vanno unite. Su un computer mai
     * visto, indovinarle tutte e cinque al primo colpo è fortuna.
     *
     * ► LA REGOLA CHE DECIDE COSA PUÒ ENTRARE NEL GIRO. ◄ **Solo le scelte che
     * cambiano SE i byte arrivano, mai quelle che cambiano COME vengono
     * letti.** Le cinque qui sopra sono tutte del primo tipo: sbagliarle
     * produce silenzio o un errore di protocollo, mai un'immersione con dentro
     * numeri sbagliati. Il MODELLO scelto dall'elenco è del secondo tipo — è
     * lui a decidere il parser — e per questo **non entra nel giro e resta una
     * scelta della persona**: uno scarico «riuscito» con il parser sbagliato è
     * il difetto peggiore che un logbook possa avere, e sarebbe silenzioso.
     *
     * ► L'ORDINE. ◄ Prima quello che non costa una riconnessione — la modalità
     * di scrittura e il riassemblaggio — poi quello che la costa: le altre
     * caratteristiche dentro lo stesso servizio, e infine gli altri servizi
     * plausibili. Non è un ordine di eleganza: è il costo per chi ha il
     * computer in mano e la batteria che cala.
     */

    /// Una combinazione completa di scelte con cui provare a parlare.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Tentativo {
        pub servizio: String,
        pub scrittura: String,
        pub notifica: String,
        pub modo: ModoScrittura,
        /// L'altra modalità, per il ripiego sul silenzio.
        ///
        /// ► C'È SOLO NEL PRIMO TENTATIVO, ED È VOLUTO. ◄ Il ripiego rimanda
        /// il primo comando nell'altra modalità quando non è mai arrivato
        /// niente: è comodo, e nel primo tentativo fa risparmiare un giro. Dal
        /// secondo in poi la modalità è una **scelta dichiarata** — è il giro
        /// stesso a variarla — e lasciare che il ripiego la ribalti da sé
        /// renderebbe impossibile dire quale combinazione ha vinto. E sapere
        /// quale ha vinto è metà del valore di tutto questo.
        pub alternativa: Option<ModoScrittura>,
        pub riassemblaggio: Riassemblaggio,
        pub crediti: Option<CreditiRisolti>,
        /// Come si chiama a schermo: «senza conferma, notifiche unite».
        pub nome: String,
        /// La riga per il diario: da dove viene questa combinazione.
        pub descrizione: String,
    }

    impl Tentativo {
        /// La forma con cui si conserva, per ritrovarla allo scarico dopo.
        ///
        /// Si conserva il CONTENUTO e non il numero d'ordine: l'elenco dei
        /// tentativi dipende da quali servizi il computer annuncia, e quelli
        /// possono cambiare con un aggiornamento del firmware. Un numero
        /// salvato ieri punterebbe a una combinazione diversa oggi, e nessuno
        /// se ne accorgerebbe.
        pub fn chiave(&self) -> String {
            format!(
                "{}|{}|{}|{}|{}",
                self.servizio.to_lowercase(),
                self.scrittura.to_lowercase(),
                self.notifica.to_lowercase(),
                match self.modo {
                    ModoScrittura::ConRisposta => "con",
                    ModoScrittura::SenzaRisposta => "senza",
                },
                match self.riassemblaggio {
                    Riassemblaggio::UnaNotifica => "singole",
                    Riassemblaggio::PacchettoIntero => "unite",
                }
            )
        }
    }

    /// Quale tentativo usare, e da dove viene la richiesta.
    ///
    /// Tre risposte possibili, in ordine di precedenza: il numero chiesto dal
    /// pulsante «riprova con un altro metodo»; la combinazione che ha
    /// funzionato l'ultima volta con QUESTO computer; il primo dell'elenco.
    #[derive(Clone, Debug, Default)]
    pub struct SceltaMetodo {
        pub marca: String,
        pub prodotto: String,
        /// «Prova il numero N», contando da zero.
        pub indice: Option<usize>,
        /// La chiave conservata dall'ultimo scarico riuscito.
        pub chiave: Option<String>,
    }

    /// Quale tentativo, e la riga di diario che dice perché quello.
    ///
    /// ► LA RIGA NON È DECORATIVA. ◄ Fra «l'ho scelto io perché ha funzionato
    /// il mese scorso» e «è il primo dell'elenco» c'è tutta la differenza
    /// quando si legge un diario tre settimane dopo. E un numero fuori
    /// dall'elenco — o una chiave conservata che non esiste più perché il
    /// firmware annuncia altri servizi — non è un errore da mostrare: si
    /// riparte dal primo, e si dice che è successo.
    pub fn scegli_tentativo(tentativi: &[Tentativo], scelta: &SceltaMetodo) -> (usize, String) {
        if let Some(n) = scelta.indice {
            if n < tentativi.len() {
                return (n, format!("metodo n. {} chiesto da chi riprova", n + 1));
            }
            return (
                0,
                format!(
                    "chiesto il metodo n. {} ma i metodi sono {}: si riparte dal primo",
                    n + 1,
                    tentativi.len()
                ),
            );
        }
        if let Some(chiave) = scelta.chiave.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            match tentativi.iter().position(|t| t.chiave() == chiave) {
                Some(n) => {
                    return (n, format!("metodo n. {} conservato dall'ultimo scarico riuscito", n + 1))
                }
                None => {
                    return (
                        0,
                        "il metodo conservato non è più fra quelli possibili: si riparte dal primo"
                            .to_string(),
                    )
                }
            }
        }
        (0, "primo metodo dell'elenco".to_string())
    }

    /// Quanti tentativi si elencano al massimo.
    ///
    /// Oltre una certa lunghezza un elenco non è più un ragionamento: è una
    /// persona che preme un pulsante finché non succede qualcosa. Otto sono
    /// abbastanza da coprire tutte le combinazioni delle due scelte che non
    /// costano niente, più le prime alternative di caratteristica e di
    /// servizio; e sono pochi abbastanza da restare leggibili nel diario.
    const MAX_TENTATIVI: usize = 8;

    fn nome_riassemblaggio(r: Riassemblaggio) -> &'static str {
        match r {
            Riassemblaggio::UnaNotifica => "notifiche una per volta",
            Riassemblaggio::PacchettoIntero => "notifiche unite",
        }
    }

    /// Le caratteristiche candidate dentro un servizio, scoperte dalle proprietà.
    ///
    /// Sono gli stessi filtri di `scegli` nel ramo in cui la tabella non nomina
    /// niente — quelle da evitare escluse, e la stessa distinzione fra chi
    /// scrive e chi notifica quando serve a restringere. Qui però non si sceglie:
    /// si ELENCA, perché la seconda candidata è precisamente quello che il giro
    /// dei tentativi ha da offrire.
    fn candidate(servizio: &ServizioVisto) -> (Vec<CaratteristicaVista>, Vec<CaratteristicaVista>) {
        let scrivibili: Vec<CaratteristicaVista> = servizio
            .caratteristiche
            .iter()
            .filter(|c| (c.scrivibile || c.scrivibile_senza_risposta) && !da_evitare(&c.uuid, true))
            .cloned()
            .collect();
        let notificanti: Vec<CaratteristicaVista> = servizio
            .caratteristiche
            .iter()
            .filter(|c| c.notifica && !da_evitare(&c.uuid, false))
            .cloned()
            .collect();
        (scrivibili, notificanti)
    }

    /// I modi di scrittura che questa caratteristica accetta davvero, a
    /// partire da quello preferito.
    ///
    /// Provare una modalità che il GATT non dichiara non è un tentativo: è una
    /// scrittura rifiutata dal plugin prima ancora di partire, cioè un giro
    /// buttato e una riga di diario che manda a cercare dalla parte sbagliata.
    fn modi_possibili(c: &CaratteristicaVista, preferito: ModoScrittura) -> Vec<ModoScrittura> {
        let accetta = |m: ModoScrittura| match m {
            ModoScrittura::ConRisposta => c.scrivibile,
            ModoScrittura::SenzaRisposta => c.scrivibile_senza_risposta,
        };
        [preferito, preferito.altro()].into_iter().filter(|m| accetta(*m)).collect()
    }

    /// L'elenco dei tentativi, dal più probabile in giù.
    ///
    /// Il primo è **esattamente** quello che l'applicazione faceva prima che
    /// questo giro esistesse: stesso profilo, stessa modalità, stesso
    /// riassemblaggio scelto per quel modello. Il giro non cambia il primo
    /// colpo — aggiunge quelli dopo.
    pub fn elenca_tentativi(
        servizi: &[ServizioVisto],
        marca: &str,
        prodotto: &str,
    ) -> Result<Vec<Tentativo>, String> {
        let riassemblaggio_noto = riassemblaggio_per(marca, prodotto);
        let mut fuori: Vec<Tentativo> = Vec::new();

        /*
         * Un servizio alla volta, e per ognuno tutte le combinazioni delle
         * scelte che non costano una riconnessione. `visto` impedisce i
         * doppioni: la coppia scelta dal profilo compare anche fra le
         * candidate scoperte, e proporla due volte vorrebbe dire far premere
         * due volte lo stesso pulsante per lo stesso tentativo.
         */
        let mut visto: Vec<String> = Vec::new();
        let mut aggiungi = |t: Tentativo, fuori: &mut Vec<Tentativo>| {
            let chiave = t.chiave();
            if !visto.contains(&chiave) {
                visto.push(chiave);
                fuori.push(t);
            }
        };

        // Il profilo noto, se c'è: è il primo tentativo, e resta il primo.
        let base = risolvi_profilo(servizi).ok();
        if let Some(p) = &base {
            aggiungi(
                Tentativo {
                    servizio: p.servizio.clone(),
                    scrittura: p.scrittura.clone(),
                    notifica: p.notifica.clone(),
                    modo: p.modo,
                    alternativa: p.alternativa,
                    riassemblaggio: riassemblaggio_noto,
                    crediti: p.crediti.clone(),
                    nome: format!("{}, {}", nome_modo(p.modo), nome_riassemblaggio(riassemblaggio_noto)),
                    descrizione: p.descrizione.clone(),
                },
                &mut fuori,
            );
        }

        /*
         * I servizi su cui vale la pena insistere, in ordine: quello del
         * profilo per primo, poi gli altri che hanno la forma di una seriale
         * su BLE. Gli altri sono un'ipotesi dichiarata, e stanno in fondo
         * apposta: scriverci sopra un comando che non conoscono non fa niente
         * — nessun comando riconosciuto, nessun effetto — ma è comunque un
         * giro speso, e va speso per ultimo.
         */
        let plausibili: Vec<&ServizioVisto> = servizi
            .iter()
            .filter(|s| !di_sistema(&s.uuid))
            .filter(|s| {
                s.caratteristiche.iter().any(|c| c.scrivibile || c.scrivibile_senza_risposta)
                    && s.caratteristiche.iter().any(|c| c.notifica)
            })
            .collect();
        /*
         * ► CONOSCIUTI PRIMA, IPOTESI DOPO. ◄ Un servizio che sta nella
         * tabella dei profili o nell'elenco di Subsurface è quello giusto
         * anche quando `risolvi_profilo` si è rifiutato di scegliere — e si
         * rifiuta ogni volta che dentro trova più di una candidata, che è
         * proprio il caso che questo giro esiste per sciogliere. Metterlo in
         * fondo insieme agli sconosciuti vorrebbe dire far provare prima le
         * ipotesi e poi la risposta.
         */
        let conosciuto = |uuid: &str| {
            PROFILI.iter().any(|v| uguale(v.servizio, uuid))
                || SERVIZI_RICONOSCIUTI.iter().any(|(u, _)| uguale(u, uuid))
        };
        let mut ordinati: Vec<&ServizioVisto> = Vec::new();
        if let Some(p) = &base {
            if let Some(s) = plausibili.iter().find(|s| uguale(&s.uuid, &p.servizio)) {
                ordinati.push(s);
            }
        }
        for s in plausibili.iter().filter(|s| conosciuto(&s.uuid)) {
            if !ordinati.iter().any(|g| uguale(&g.uuid, &s.uuid)) {
                ordinati.push(s);
            }
        }
        for s in &plausibili {
            if !ordinati.iter().any(|g| uguale(&g.uuid, &s.uuid)) {
                ordinati.push(s);
            }
        }

        for (indice_servizio, servizio) in ordinati.iter().enumerate() {
            let del_profilo = base.as_ref().is_some_and(|p| uguale(&p.servizio, &servizio.uuid));
            let (scrivibili, notificanti) = candidate(servizio);
            for (i, s) in scrivibili.iter().enumerate() {
                for (j, n) in notificanti.iter().enumerate() {
                    let preferito = match &base {
                        Some(p) if del_profilo => p.modo,
                        // Fuori dal profilo non c'è niente da preferire: si
                        // parte da «senza conferma», che è quello che usano
                        // quasi tutti i moduli seriali su BLE.
                        _ => ModoScrittura::SenzaRisposta,
                    };
                    for modo in modi_possibili(s, preferito) {
                        for riassemblaggio in
                            [riassemblaggio_noto, riassemblaggio_noto.altro()]
                        {
                            /*
                             * Tre provenienze diverse, e la differenza conta
                             * per chi legge il diario: «ho cambiato una
                             * manopola dentro il profilo giusto» non è la
                             * stessa cosa di «sto tirando a indovinare su un
                             * servizio che nessuno conosce».
                             */
                            let provenienza = if del_profilo && i == 0 && j == 0 {
                                "stesso profilo, altra combinazione".to_string()
                            } else if del_profilo || conosciuto(&servizio.uuid) {
                                format!(
                                    "servizio noto con più di una candidata: caratteristiche n. {} e n. {}",
                                    i + 1,
                                    j + 1
                                )
                            } else {
                                format!(
                                    "IPOTESI: servizio n. {} fra quelli plausibili, nessun profilo lo conosce",
                                    indice_servizio + 1
                                )
                            };
                            aggiungi(
                                Tentativo {
                                    servizio: servizio.uuid.clone(),
                                    scrittura: s.uuid.clone(),
                                    notifica: n.uuid.clone(),
                                    modo,
                                    // Vedi il commento del campo: dal secondo
                                    // tentativo in poi la modalità è dichiarata.
                                    alternativa: None,
                                    riassemblaggio,
                                    crediti: if del_profilo {
                                        base.as_ref().and_then(|p| p.crediti.clone())
                                    } else {
                                        None
                                    },
                                    nome: format!(
                                        "{}, {}",
                                        nome_modo(modo),
                                        nome_riassemblaggio(riassemblaggio)
                                    ),
                                    descrizione: descrivi(
                                        &provenienza,
                                        &servizio.uuid,
                                        s,
                                        modo,
                                        None,
                                        n,
                                    ),
                                },
                                &mut fuori,
                            );
                        }
                    }
                }
            }
        }

        fuori.truncate(MAX_TENTATIVI);
        if fuori.is_empty() {
            // Nessun servizio con la forma giusta: qui il messaggio di
            // `risolvi_profilo` è più utile di qualunque cosa possa dire il
            // giro, perché elenca quello che il dispositivo annuncia davvero.
            return Err(risolvi_profilo(servizi).err().unwrap_or_else(|| {
                "questo dispositivo non espone nessun servizio con cui parlare".to_string()
            }));
        }
        Ok(fuori)
    }

    /// A quale servizio parlare: la tabella, poi l'elenco, poi il ripiego.
    ///
    /// IL RIPIEGO È UN'EURISTICA, e va detto perché non è innocua. Si guardano i
    /// servizi che il dispositivo annuncia e si tiene quello che ha almeno una
    /// caratteristica scrivibile e almeno una che notifica — la forma di una
    /// «seriale su BLE», che è quello che quasi tutti i computer subacquei
    /// espongono. Se i candidati sono più d'uno o nessuno **si rifiuta**: fra
    /// tirare a indovinare e dire «non lo so» la seconda costa un messaggio e la
    /// prima costa un pomeriggio.
    ///
    /// QUANDO SBAGLIA lo sbaglio è silenzioso ma innocuo: si scrive su una
    /// caratteristica che il firmware non ascolta, non arriva nessuna risposta,
    /// e libdivecomputer si ferma dopo il suo timeout. **Non viene scritto
    /// niente sul computer subacqueo** — nessun comando riconosciuto significa
    /// nessun effetto — quindi il costo è un tentativo perso, non una memoria
    /// rovinata. Chi legge il diario tecnico vede quale servizio è stato scelto,
    /// e da lì si aggiunge il servizio all'elenco dei riconosciuti.
    pub fn risolvi_profilo(servizi: &[ServizioVisto]) -> Result<ProfiloRisolto, String> {
        for voce in PROFILI {
            let Some(servizio) = servizi.iter().find(|s| uguale(&s.uuid, voce.servizio)) else {
                continue;
            };
            let (scrittura, notifica, modo, alternativa) =
                scegli(servizio, voce.scrittura, voce.notifica, voce.preferenza, Ambiguita::Rifiuta)?;
            let crediti = match voce.crediti {
                Some((concessione, ascolto)) => {
                    let presente = |u: &str| servizio.caratteristiche.iter().any(|c| uguale(&c.uuid, u));
                    if !presente(concessione) || !presente(ascolto) {
                        return Err(format!(
                            "il servizio {} è quello del Terminal I/O ma non espone le \
caratteristiche dei crediti ({concessione}, {ascolto}): senza, il computer non manda niente",
                            servizio.uuid
                        ));
                    }
                    Some(CreditiRisolti {
                        concessione: concessione.to_string(),
                        ascolto: ascolto.to_string(),
                    })
                }
                None => None,
            };
            let provenienza = match (voce.verificato_su, &crediti) {
                (Some(su), _) => format!("profilo noto, verificato su {su}"),
                (None, Some(_)) => "profilo noto (Terminal I/O a crediti di Heinrichs Weikamp), \
MAI VERIFICATO SU NESSUN COMPUTER"
                    .to_string(),
                (None, None) => "profilo noto ma MAI VERIFICATO SU NESSUN COMPUTER".to_string(),
            };
            return Ok(ProfiloRisolto {
                descrizione: descrivi(&provenienza, &servizio.uuid, &scrittura, modo, alternativa, &notifica),
                servizio: servizio.uuid.clone(),
                scrittura: scrittura.uuid,
                notifica: notifica.uuid,
                modo,
                alternativa,
                crediti,
            });
        }

        for (uuid, nome) in SERVIZI_RICONOSCIUTI {
            let Some(servizio) = servizi.iter().find(|s| uguale(&s.uuid, uuid)) else {
                continue;
            };
            let (scrittura, notifica, modo, alternativa) =
                scegli(servizio, None, None, Preferenza::Automatica, Ambiguita::PrimaDichiarata)?;
            let provenienza = format!(
                "servizio riconosciuto dall'elenco di Subsurface («{nome}»), caratteristiche dalle proprietà \
(se più d'una, la prima come fa Subsurface)"
            );
            return Ok(ProfiloRisolto {
                descrizione: descrivi(&provenienza, &servizio.uuid, &scrittura, modo, alternativa, &notifica),
                servizio: servizio.uuid.clone(),
                scrittura: scrittura.uuid,
                notifica: notifica.uuid,
                modo,
                alternativa,
                crediti: None,
            });
        }

        let candidati: Vec<&ServizioVisto> = servizi
            .iter()
            .filter(|s| !di_sistema(&s.uuid))
            .filter(|s| {
                s.caratteristiche
                    .iter()
                    .any(|c| c.scrivibile || c.scrivibile_senza_risposta)
                    && s.caratteristiche.iter().any(|c| c.notifica)
            })
            .collect();

        let elenco_servizi = |v: &[&ServizioVisto]| {
            v.iter().map(|s| s.uuid.clone()).collect::<Vec<_>>().join(", ")
        };

        match candidati.as_slice() {
            [uno] => {
                let (scrittura, notifica, modo, alternativa) =
                    scegli(uno, None, None, Preferenza::Automatica, Ambiguita::Rifiuta)?;
                Ok(ProfiloRisolto {
                    descrizione: descrivi(
                        "RIPIEGO (euristica, nessun profilo noto): unico servizio con una \
caratteristica scrivibile e una che notifica",
                        &uno.uuid,
                        &scrittura,
                        modo,
                        alternativa,
                        &notifica,
                    ),
                    servizio: uno.uuid.clone(),
                    scrittura: scrittura.uuid,
                    notifica: notifica.uuid,
                    modo,
                    alternativa,
                    crediti: None,
                })
            }
            [] => Err(format!(
                "questo dispositivo non espone nessun profilo che conosciamo, e nessuno dei \
suoi {} servizi ha insieme una caratteristica scrivibile e una che notifica. \
Servizi visti: {}",
                servizi.len(),
                elenco_servizi(&servizi.iter().collect::<Vec<_>>())
            )),
            molti => Err(format!(
                "questo dispositivo non espone nessun profilo che conosciamo, e {} suoi servizi \
potrebbero esserlo ({}). Sceglierne uno a caso significherebbe scrivere comandi a un servizio \
sbagliato: va aggiunto il servizio giusto all'elenco dei riconosciuti.",
                molti.len(),
                elenco_servizi(molti)
            )),
        }
    }

    // ------------------------------------------------------------- l'antenna

    /// Il minimo del Bluetooth che serve al ponte.
    ///
    /// PERCHÉ UN TRATTO E NON `tauri_plugin_blec` DIRETTAMENTE. Per la stessa
    /// ragione per cui `FlussoBle` non lo conosce: con un tratto, il ponte —
    /// cioè la parte in cui sincrono e asincrono si toccano, che è dove si
    /// sbaglia — si prova contro un'antenna finta, senza adattatore Bluetooth,
    /// senza computer subacqueo e senza un'applicazione Tauri viva. Il giorno
    /// che il plugin cambia API cambia solo `AntennaBlec`, qui sotto.
    ///
    /// I metodi restituiscono `impl Future + Send` invece di essere `async fn`
    /// perché il futuro deve poter attraversare i thread del runtime: senza il
    /// `+ Send` esplicito i compiti spawnati non compilerebbero, e il messaggio
    /// del compilatore punterebbe altrove.
    pub trait AntennaBle: Clone + Send + Sync + 'static {
        /// Si collega. `caduta` viene chiamata se il collegamento cade da sé.
        fn collega(
            &self,
            dispositivo: String,
            caduta: Box<dyn FnOnce() + Send>,
        ) -> impl Future<Output = Result<(), String>> + Send;

        /// I servizi e le caratteristiche che il dispositivo dichiara.
        fn servizi(
            &self,
            dispositivo: String,
        ) -> impl Future<Output = Result<Vec<ServizioVisto>, String>> + Send;

        /// Il nome che il dispositivo annuncia. Serve a libdivecomputer per la
        /// famiglia Oceanic/Aqualung, che ci legge dentro il numero di serie.
        fn nome(&self, dispositivo: String) -> impl Future<Output = Result<String, String>> + Send;

        /// Si iscrive alle notifiche di UNA caratteristica. Ogni notifica va
        /// passata ad `arrivata` **intera**: i confini fra una notifica e
        /// l'altra sono dati, non rumore — vedi il commento di `FlussoBle::leggi`.
        fn iscrivi(
            &self,
            servizio: String,
            caratteristica: String,
            arrivata: Box<dyn Fn(Vec<u8>) + Send + Sync>,
        ) -> impl Future<Output = Result<(), String>> + Send;

        /// Scrive su una caratteristica, nel modo detto. Il modo è un
        /// parametro e non un campo del profilo perché il ponte lo cambia in
        /// corsa quando negozia.
        fn scrivi(
            &self,
            servizio: String,
            caratteristica: String,
            dati: Vec<u8>,
            modo: ModoScrittura,
        ) -> impl Future<Output = Result<(), String>> + Send;

        /// Legge il valore di una caratteristica, in qualunque servizio stia.
        fn leggi(&self, caratteristica: String) -> impl Future<Output = Result<Vec<u8>, String>> + Send;

        fn scollega(&self) -> impl Future<Output = Result<(), String>> + Send;
    }

    // --------------------------------------------------------------- il ponte

    /*
     * ► LE SCRITTURE NON SI SPEZZANO, ed è una scelta cambiata il 7 settembre. ◄
     *
     * Prima ogni scrittura veniva tagliata a venti byte — «il pavimento
     * dell'MTU» — con l'idea che spezzare fosse sempre sicuro. Non lo è: il
     * Pelagic i330R manda la richiesta d'accesso in UN pacchetto da 21 byte
     * (`pelagic_i330r.c`, `CMD_ACCESS_REQUEST` + 16 di codice), e il firmware
     * valida ogni scrittura ATT come un pacchetto intero; spezzata in 20+1
     * diventa due pacchetti malformati, e la famiglia i330R/DSX fallisce IN
     * SILENZIO, per costruzione. Il Divesoft (`MSG_CONNECT`, 27 byte con la
     * cornice HDLC) e in rari casi lo Shearwater (un pacchetto SLIP con tre
     * byte di escape) sono nella stessa situazione.
     *
     * Subsurface non spezza (`BLEObject::write` in `qt-ble.cpp`): consegna il
     * buffer intero e si affida all'MTU che il sistema ha negoziato — che su
     * Apple è automatico, su Android il plugin lo chiede a 517, su BlueZ e
     * Windows lo negozia lo stack. Dove libdivecomputer vuole pacchetti da
     * venti li fa lei (`dc_packet_open(…, 244, 20)` per Mares e OSTC, l'HDLC a
     * 20 per Suunto), e non c'è niente da aggiungere sotto. Se un sistema
     * rifiutasse una scrittura troppo lunga, il rifiuto arriva come errore
     * leggibile nel diario — meglio di un pacchetto spezzato che il computer
     * scarta senza dire niente.
     */

    /// Quanto si aspetta la conferma di UNA scrittura.
    ///
    /// Non è il timeout del protocollo — quello lo gestisce libdivecomputer — è
    /// solo la garanzia che il thread dello scarico non resti appeso per sempre
    /// se il compito asincrono muore senza dirlo.
    // Nelle prove è corta, perché una prova che aspetta dieci secondi per
    // vedere una conferma che non arriva insegna a non lanciare le prove. Il
    // valore non è la logica sotto esame: lo è cosa succede quando scade.
    const ATTESA_CONFERMA: Duration =
        if cfg!(test) { Duration::from_millis(300) } else { Duration::from_secs(10) };

    /// Quante scritture si raccontano una per una nel diario, MENTRE
    /// succedono. Le prime sono quelle che contano — il comando di
    /// identificazione, la stretta di mano — e le altre migliaia direbbero
    /// tutte la stessa cosa.
    const SCRITTURE_RACCONTATE: usize = 6;

    /// Quante scritture si conservano per raccontarle ALLA FINE.
    ///
    /// ► PERCHÉ LA TESTA DA SOLA NON BASTA, E LO SAPPIAMO DA UN CASO VERO. ◄
    /// Il 7 settembre 2026 un Mares Quad Ci del centro sub ha scaricato 349 KB
    /// e poi si è fermato con «errore di protocollo» dopo quattro tentativi.
    /// Del diario è arrivata solo la testa: le prime sei scritture, cioè
    /// esattamente la parte che aveva funzionato. Di che comando fosse la
    /// risposta rifiutata — l'unica domanda che conta — non c'era traccia,
    /// perché era la scrittura numero 1503.
    ///
    /// Le ultime non si possono raccontare mentre succedono: mentre
    /// succedono non si sa che sono le ultime. Quindi si tengono da parte,
    /// in una coda che scorre, e si scrivono nel riassunto — che esce
    /// **comunque vada**, anche quando lo scarico muore.
    const SCRITTURE_IN_CODA: usize = 8;

    /// Il cronista: chi riceve le righe del diario mentre succedono.
    pub type Cronista = Arc<dyn Fn(String) + Send + Sync>;

    /// Un comando in viaggio verso il runtime, con la busta per la risposta.
    enum Comando {
        Scrivi {
            caratteristica: String,
            dati: Vec<u8>,
            modo: ModoScrittura,
            conferma: std::sync::mpsc::SyncSender<Result<(), String>>,
        },
        Leggi {
            caratteristica: String,
            conferma: std::sync::mpsc::SyncSender<Result<Vec<u8>, String>>,
        },
    }

    /// La chiusura che `FlussoBle` usa per scrivere.
    ///
    /// Ha un nome suo solo per leggibilità: è la stessa forma che
    /// `FlussoBle::nuovo` si aspetta, e cambiarla qui vorrebbe dire cambiarla lì.
    pub type ChiusuraScrittura =
        Box<dyn FnMut(&[u8]) -> Result<(), crate::trasporto_ldc::GuastoScrittura> + Send>;

    /// Byte in esadecimale, per la chiave dell'immersione e per il diario.
    fn esadecimale(b: &[u8]) -> String {
        b.iter().map(|v| format!("{v:02x}")).collect::<Vec<_>>().join(" ")
    }

    /// I primi byte in esadecimale, con i puntini se ce ne sono altri.
    fn anteprima(b: &[u8]) -> String {
        const QUANTI: usize = 8;
        if b.len() <= QUANTI {
            esadecimale(b)
        } else {
            format!("{} …", esadecimale(&b[..QUANTI]))
        }
    }

    /// Lo stato dello scambio, condiviso fra chi scrive e chi legge.
    ///
    /// È il registro da cui nascono le righe del diario e le decisioni della
    /// negoziazione. Vive sotto un `Mutex` che prendono SOLO il thread dello
    /// scarico (scrittura e ripiego sul silenzio) e il riassunto finale: la
    /// callback delle notifiche, che gira nel runtime, tocca solo gli atomici
    /// qui accanto, così non aspetta mai nessuno.
    struct Scambio {
        modo: ModoScrittura,
        /// L'altra modalità, finché è ancora spendibile.
        alternativa: Option<ModoScrittura>,
        /// Se la modalità è già stata cambiata una volta per un errore: la
        /// seconda volta non si cambia più, si fallisce e si dice perché.
        cambiata_per_errore: bool,
        scritture: usize,
        byte_scritti: usize,
        /// Tutte le scritture fatte PRIMA della prima risposta, in ordine: è
        /// quello che il ripiego sul silenzio rimanda nell'altra modalità.
        /// Tutte e non l'ultima, perché il primo comando di alcuni protocolli
        /// è più chiamate di scrittura (Mares: intestazione di due byte e poi
        /// il resto; Suunto: l'HDLC spezza a venti), e rimandare solo l'ultima
        /// sarebbe rimandare un frammento. Si smette di accumulare alla prima
        /// notifica, che è anche il momento in cui il rinvio non è più lecito.
        prima_della_risposta: Vec<Vec<u8>>,
        prima_scrittura: Option<Instant>,
        /// Quante volte l'ultimo comando è stato rimandato dal ripiego sul
        /// silenzio: non sono scritture di libdivecomputer, e nel riassunto
        /// vanno contate a parte.
        rinvii: usize,
        /// Le ultime `SCRITTURE_IN_CODA` scritture, col loro numero e già in
        /// forma di riga di diario. Una coda che scorre: entra l'ultima, esce
        /// la più vecchia. Il numero serve al riassunto per non ripetere
        /// quelle che erano già uscite in diretta. Vedi `SCRITTURE_IN_CODA`.
        ultime: VecDeque<(usize, String)>,
    }

    /// Il canale verso il runtime, con le due operazioni bloccanti sopra.
    ///
    /// **I metodi bloccano il thread chiamante e vanno chiamati SOLO dal thread
    /// dello scarico.** È il motivo per cui il commento in cima al file
    /// insiste tanto: da dentro il runtime andrebbero in panico.
    struct Postino {
        comandi: tauri::async_runtime::Sender<Comando>,
    }

    /// Perché una scrittura non è andata. La distinzione conta per la
    /// negoziazione: solo un RIFIUTO del plugin dice qualcosa sulla modalità.
    /// Una conferma che non arriva in dieci secondi non dice niente sul GATT —
    /// la scrittura potrebbe essere ancora in corso — e cambiare modalità lì
    /// sopra farebbe arrivare al computer lo stesso comando due volte, in due
    /// modalità, se poi la prima riuscisse.
    enum Guasto {
        Rifiutata(String),
        Scaduta(String),
        Chiusa(String),
    }

    impl Guasto {
        fn testo(&self) -> &str {
            match self {
                Guasto::Rifiutata(t) | Guasto::Scaduta(t) | Guasto::Chiusa(t) => t,
            }
        }
        fn in_stringa(self) -> String {
            match self {
                Guasto::Rifiutata(t) | Guasto::Scaduta(t) | Guasto::Chiusa(t) => t,
            }
        }
    }

    impl Postino {
        fn scrivi(&self, caratteristica: &str, dati: &[u8], modo: ModoScrittura) -> Result<(), Guasto> {
            let (rispondi, risposta) = std::sync::mpsc::sync_channel(1);
            self.comandi
                .blocking_send(Comando::Scrivi {
                    caratteristica: caratteristica.to_string(),
                    dati: dati.to_vec(),
                    modo,
                    conferma: rispondi,
                })
                .map_err(|_| Guasto::Chiusa("il Bluetooth non accetta più scritture".into()))?;
            match risposta.recv_timeout(ATTESA_CONFERMA) {
                Ok(Ok(())) => Ok(()),
                Ok(Err(motivo)) => Err(Guasto::Rifiutata(motivo)),
                Err(RecvTimeoutError::Timeout) => Err(Guasto::Scaduta(
                    "la scrittura sul Bluetooth non è stata confermata entro dieci secondi".into(),
                )),
                Err(RecvTimeoutError::Disconnected) => Err(Guasto::Chiusa(
                    "il collegamento Bluetooth si è chiuso durante una scrittura".into(),
                )),
            }
        }

        fn leggi(&self, caratteristica: &str) -> Result<Vec<u8>, String> {
            let (rispondi, risposta) = std::sync::mpsc::sync_channel(1);
            self.comandi
                .blocking_send(Comando::Leggi { caratteristica: caratteristica.to_string(), conferma: rispondi })
                .map_err(|_| "il Bluetooth non accetta più richieste".to_string())?;
            match risposta.recv_timeout(ATTESA_CONFERMA) {
                Ok(esito) => esito,
                Err(RecvTimeoutError::Timeout) => {
                    Err("la lettura della caratteristica non è arrivata entro dieci secondi".into())
                }
                Err(RecvTimeoutError::Disconnected) => {
                    Err("il collegamento Bluetooth si è chiuso durante una lettura".into())
                }
            }
        }
    }

    /// I contatori che la callback delle notifiche tocca dal runtime.
    struct Contatori {
        notifiche: AtomicUsize,
        /// Quanti byte sono arrivati finora. Serve all'avanzamento: i
        /// protocolli tipo Uwatec chiedono al computer quanti byte ha e poi li
        /// ricevono tutti in un blocco solo, quindi per minuti non c'è nessun
        /// altro segno di vita da mostrare. È un `Arc` a parte perché il
        /// cronista dell'avanzamento vive più a lungo del ponte.
        ricevuti: Arc<AtomicUsize>,
        /// La notifica più grande e la più piccola viste, in byte.
        ///
        /// La più grande è la stima dell'MTU meno tre, cioè di quanto ci sta
        /// in un messaggio: è il numero che dice se il pacchetto di un Mares
        /// del ramo variabile arriva intero o spezzato. La più piccola dice se
        /// qualcosa è arrivato a pezzi, perché su BLE i frammenti di uno
        /// stesso messaggio sono tutti pieni tranne l'ultimo.
        notifica_piu_grande: AtomicUsize,
        /// Parte da `usize::MAX` e scende: senza notifiche resta lì, e il
        /// riassunto non ne parla.
        notifica_piu_piccola: AtomicUsize,
        /// Millisecondi fra la prima scrittura e la prima notifica;
        /// `u64::MAX` finché la prima notifica non arriva.
        prima_notifica_ms: AtomicU64,
        /// I crediti che il computer ha ancora, se il profilo li usa.
        crediti_rimasti: AtomicUsize,
        /// Se una ricarica di crediti non è riuscita: il computer resta senza,
        /// e il «tempo scaduto» che segue ha questa causa.
        ricarica_fallita: AtomicBool,
        /// Se il collegamento è caduto da sé.
        caduto: AtomicBool,
        /// Se siamo NOI a scollegarci, alla fine: la callback di caduta scatta
        /// anche allora, e senza questa bandierina scriverebbe nel diario
        /// «caduto da sé» per uno scollegamento voluto. È un `Arc` a parte
        /// perché la alza `scarica()`, che del ponte non ha più niente in mano.
        scollegamento_voluto: Arc<AtomicBool>,
    }

    /// Gli accessori del ponte, visti da `FlussoBle`.
    struct AccessoriDelPonte {
        nome: Option<String>,
        postino: Arc<Postino>,
    }

    impl AccessoriBle for AccessoriDelPonte {
        fn nome(&mut self) -> Option<String> {
            self.nome.clone()
        }

        fn leggi_caratteristica(&mut self, uuid: [u8; 16]) -> Result<Vec<u8>, String> {
            self.postino.leggi(&uuid::Uuid::from_bytes(uuid).to_string())
        }
    }

    /// Gli stessi accessori, più le tre cose che riguardano l'accoppiamento.
    ///
    /// ► PERCHÉ UN INVOLUCRO E NON TRE METODI IN PIÙ SU `AccessoriDelPonte`. ◄
    /// Perché `apri_ponte` non sa niente né dell'interfaccia né dell'archivio,
    /// e va tenuto così: apre un collegamento Bluetooth e sceglie un profilo.
    /// Chiedere sei cifre a una persona e conservare una chiave sono decisioni
    /// del comando, che ha in mano la finestra e il chiamante. Qui in mezzo
    /// c'è solo la traduzione, e si prova da sola — con un finto che dice di
    /// sì, uno che dice di no e uno che non risponde affatto.
    pub struct AccessoriConSegreti {
        dentro: Box<dyn AccessoriBle>,
        /// Chiede le sei cifre e ASPETTA. `None` = rinuncia.
        chiedi_pin: Box<dyn FnMut() -> Option<String> + Send>,
        /// Il codice conservato da uno scarico precedente, se c'è.
        codice: Option<Vec<u8>>,
        /// Dove va il codice appena rilasciato dal computer.
        conserva: Box<dyn FnMut(&[u8]) + Send>,
    }

    impl AccessoriConSegreti {
        pub fn nuovo(
            dentro: Box<dyn AccessoriBle>,
            chiedi_pin: Box<dyn FnMut() -> Option<String> + Send>,
            codice: Option<Vec<u8>>,
            conserva: Box<dyn FnMut(&[u8]) + Send>,
        ) -> Self {
            Self { dentro, chiedi_pin, codice, conserva }
        }
    }

    impl AccessoriBle for AccessoriConSegreti {
        fn nome(&mut self) -> Option<String> {
            self.dentro.nome()
        }

        fn leggi_caratteristica(&mut self, uuid: [u8; 16]) -> Result<Vec<u8>, String> {
            self.dentro.leggi_caratteristica(uuid)
        }

        fn codice_pin(&mut self) -> Option<String> {
            // Gli spazi si tolgono qui e non nell'interfaccia: chi digita sei
            // cifre su un telefono ne aggiunge uno alla fine più spesso di
            // quanto si creda, e `pelagic_i330r_init_passcode` rifiuta
            // qualunque carattere che non sia una cifra. Toglierli è la
            // riparazione onesta; toglierne altro sarebbe indovinare.
            (self.chiedi_pin)().map(|p| p.trim().to_string())
        }

        fn codice_accesso(&mut self) -> Option<Vec<u8>> {
            self.codice.clone()
        }

        fn salva_codice_accesso(&mut self, codice: &[u8]) {
            // Si conserva ANCHE in memoria, non solo fuori: dentro lo stesso
            // scarico libdivecomputer può richiedere il codice dopo averlo
            // scritto, e rispondere «non ce l'ho» a un codice appena ricevuto
            // rimanderebbe la persona al PIN per niente.
            self.codice = Some(codice.to_vec());
            (self.conserva)(codice);
        }
    }

    /// Tutto quello che serve a costruire un `FlussoBle`, più il contorno.
    /// Quanto è successo davvero sul filo, in numeri.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Misure {
        pub scritture: usize,
        pub notifiche: usize,
        pub byte_ricevuti: usize,
    }

    impl Misure {
        /// Se il computer ha dato un segno di vita.
        ///
        /// ════════════════════════════════════════════════════════════════════
        /// ► È LA DOMANDA CHE SEPARA DUE RIMEDI OPPOSTI. ◄
        ///
        /// Uno scarico fallito può voler dire due cose che non si somigliano
        /// per niente:
        ///
        /// - **niente è arrivato.** Il metodo è sbagliato: stiamo scrivendo
        ///   sulla caratteristica che non ascolta, o in una modalità che quel
        ///   GATT non gradisce. Insistere è inutile; va cambiato metodo.
        /// - **qualcosa è arrivato e poi si è rotto.** Il metodo è **giusto** —
        ///   l'ha dimostrato — e il collegamento ha perso colpi. Qui cambiare
        ///   metodo è il danno: si abbandona l'unica combinazione che si sa
        ///   funzionare per provarne una che non ha mai funzionato, e la volta
        ///   dopo si riparte da capo con quella sbagliata.
        ///
        /// Il diario del 9 settembre 2026 è il secondo caso in tutte e due le
        /// sue forme: **25 775 byte** ricevuti prima di un errore di
        /// protocollo, e **276 KB** prima di una conferma scaduta, dallo stesso
        /// telefono e dallo stesso Mares. *Un'interfaccia che avesse offerto
        /// «prova un altro modo» in quelle due occasioni avrebbe consigliato
        /// esattamente la cosa sbagliata.*
        pub fn qualcosa_e_arrivato(&self) -> bool {
            self.notifiche > 0
        }
    }

    pub struct PonteBle {
        /// Le notifiche, una per messaggio. Va dato a `FlussoBle::nuovo`.
        pub entrata: Receiver<Vec<u8>>,
        /// La scrittura. **Va chiamata solo dal thread dello scarico.**
        pub scrittura: ChiusuraScrittura,
        /// Gli accessori (nome, lettura di caratteristiche) e il ripiego sul
        /// silenzio. Vanno dati a `FlussoBle::con_accessori`.
        pub accessori: Box<dyn AccessoriBle>,
        pub su_silenzio: Box<dyn FnMut() -> Ripiego + Send>,
        /// Come è stato scelto il profilo: riga di diario tecnico.
        pub descrizione: String,
        /// Quanti byte sono arrivati finora, per l'avanzamento.
        pub ricevuti: Arc<AtomicUsize>,
        /// Il riassunto dello scambio, da leggere alla fine, comunque sia andata.
        pub riassunto: Box<dyn Fn() -> String + Send + Sync>,
        /// Le stesse cose del riassunto, ma in numeri invece che in prosa.
        ///
        /// ► SERVONO A DECIDERE, NON A RACCONTARE. ◄ Il riassunto lo legge una
        /// persona; questi tre numeri li legge l'interfaccia per rispondere a
        /// **una** domanda dopo un fallimento: *il computer ha risposto, sì o
        /// no?* Da quella risposta dipende se ha senso riprovare allo stesso
        /// modo o cambiare metodo, e sono due rimedi opposti. Vedi
        /// `Misure::qualcosa_e_arrivato`.
        pub misure: Box<dyn Fn() -> Misure + Send + Sync>,
        /// Da alzare PRIMA di scollegarsi di proposito, così la callback di
        /// caduta non racconta come «caduto da sé» uno scollegamento nostro.
        pub scollegamento_voluto: Arc<AtomicBool>,
        /// La combinazione con cui si sta provando, e quante ce ne sono.
        ///
        /// Serve a due cose che non si possono ricavare dopo: dire
        /// all'interfaccia **quale** metodo sta girando (e se ce n'è un altro
        /// da provare), e conservare la chiave del metodo che ha vinto.
        pub metodo: Tentativo,
        pub metodo_indice: usize,
        pub metodi_totali: usize,
    }

    impl PonteBle {
        /// Lo stesso ponte, che sa anche farsi dare un PIN e conservare una chiave.
        ///
        /// È un passo a parte e non un argomento di `apri_ponte` perché
        /// `apri_ponte` si prova contro un'antenna finta e non deve sapere né
        /// che esiste una finestra né che esiste un archivio. Qui si smonta e
        /// si rimonta: gli otto campi si scrivono per nome apposta, così il
        /// giorno che ne nasce un nono il compilatore obbliga a decidere da
        /// che parte va, invece di lasciarlo cadere.
        pub fn con_segreti(
            self,
            chiedi_pin: Box<dyn FnMut() -> Option<String> + Send>,
            codice: Option<Vec<u8>>,
            conserva: Box<dyn FnMut(&[u8]) + Send>,
        ) -> Self {
            let PonteBle {
                entrata,
                scrittura,
                accessori,
                su_silenzio,
                descrizione,
                ricevuti,
                riassunto,
                misure,
                scollegamento_voluto,
                metodo,
                metodo_indice,
                metodi_totali,
            } = self;
            PonteBle {
                entrata,
                scrittura,
                accessori: Box::new(AccessoriConSegreti::nuovo(accessori, chiedi_pin, codice, conserva)),
                su_silenzio,
                descrizione,
                ricevuti,
                riassunto,
                misure,
                scollegamento_voluto,
                metodo,
                metodo_indice,
                metodi_totali,
            }
        }
    }

    /// Da esadecimale a byte, per il codice di accesso conservato.
    ///
    /// Rifiuta tutto quello che non è una coppia di cifre esadecimali: un
    /// codice mezzo decodificato è peggio di nessun codice, perché il computer
    /// lo rifiuterebbe senza dire perché — mentre «non ce l'ho» fa ripartire
    /// dal PIN, che funziona sempre.
    pub fn da_esadecimale(testo: &str) -> Option<Vec<u8>> {
        // Si conta in CARATTERI dall'inizio alla fine, e non in byte: `len()`
        // su una `String` dà i byte, e su un testo con dentro qualunque cosa
        // che non sia ASCII i due numeri divergono. Oggi `to_digit(16)`
        // rifiuterebbe comunque quel carattere, ma un conto giusto per caso è
        // il genere di cosa che il primo riordino trasforma in un indice fuori
        // dai limiti.
        let cifre: Vec<char> = testo.chars().filter(|c| !c.is_whitespace()).collect();
        if cifre.is_empty() || cifre.len() % 2 != 0 {
            return None;
        }
        let mut byte = Vec::with_capacity(cifre.len() / 2);
        for coppia in cifre.chunks(2) {
            let alto = coppia[0].to_digit(16)?;
            let basso = coppia[1].to_digit(16)?;
            byte.push((alto * 16 + basso) as u8);
        }
        Some(byte)
    }

    /// Da byte a esadecimale compatto, minuscolo, senza separatori.
    pub fn in_esadecimale(byte: &[u8]) -> String {
        byte.iter().map(|v| format!("{v:02x}")).collect()
    }

    /// Apre il ponte: collega, sceglie il profilo, si iscrive, avvia lo scrittore.
    ///
    /// È `async` e gira nel runtime: qui dentro non si blocca niente. Il pezzo
    /// bloccante — lo scarico — è il chiamante, su un thread suo.
    pub async fn apri_ponte<A: AntennaBle>(
        antenna: A,
        dispositivo: &str,
        nome_visto: Option<&str>,
        cronista: Cronista,
        scelta: &SceltaMetodo,
    ) -> Result<PonteBle, String> {
        /*
         * IL MITTENTE STA DENTRO UN `Option` CONDIVISO, e non è un giro
         * inutile.
         *
         * `FlussoBle` distingue «non è ancora arrivato niente» da «il
         * collegamento se n'è andato» guardando se il canale è chiuso, e un
         * canale si chiude quando cade l'ULTIMO mittente. Se il mittente vivesse
         * solo dentro la callback delle notifiche, nessuno potrebbe farlo
         * cadere: il plugin tiene la callback finché è iscritto, e una
         * disconnessione a metà scarico diventerebbe un'attesa fino al timeout
         * seguita da «tempo scaduto» — cioè il messaggio sbagliato.
         *
         * Con l'`Option` condiviso, la callback di caduta lo svuota, il
         * mittente cade, e la lettura successiva dice «il collegamento
         * Bluetooth si è chiuso» subito.
         */
        let (verso_flusso, entrata) = std::sync::mpsc::channel::<Vec<u8>>();
        let mittente: Arc<Mutex<Option<Sender<Vec<u8>>>>> =
            Arc::new(Mutex::new(Some(verso_flusso)));

        let ricevuti = Arc::new(AtomicUsize::new(0));
        let scollegamento_voluto = Arc::new(AtomicBool::new(false));
        let contatori = Arc::new(Contatori {
            notifiche: AtomicUsize::new(0),
            notifica_piu_grande: AtomicUsize::new(0),
            notifica_piu_piccola: AtomicUsize::new(usize::MAX),
            ricevuti: ricevuti.clone(),
            prima_notifica_ms: AtomicU64::new(u64::MAX),
            crediti_rimasti: AtomicUsize::new(0),
            ricarica_fallita: AtomicBool::new(false),
            caduto: AtomicBool::new(false),
            scollegamento_voluto: scollegamento_voluto.clone(),
        });

        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL COLLEGAMENTO SI PROVA PIÙ DI UNA VOLTA, E FRA UNA E L'ALTRA SI
         *   SCOLLEGA DAVVERO. ◄
         *
         * Il 9 settembre 2026 un diario vero comincia così: *«collegamento non
         * riuscito: Timeout during execution of Connect»*, zero immersioni — e
         * il tentativo dopo, dalla stessa persona con lo stesso apparecchio, si
         * è collegato in 60 millisecondi. Cioè: **non era rotto niente**, era
         * andata male una volta. E l'applicazione si arrendeva alla prima.
         *
         * Su BLE un `connect` che scade lascia quasi sempre un collegamento a
         * metà: il sistema lo considera in corso, il computer si considera
         * occupato, e il tentativo successivo trova la porta presa. Per questo
         * il ritentativo non è solo «riprova»: **prima scollega**. È quella
         * riga a rendere il secondo tentativo diverso dal primo, e senza di lei
         * insistere sarebbe soltanto sbagliare più volte.
         *
         * `scollegamento_voluto` va alzata attorno a quella pulizia, o la
         * callback di caduta racconterebbe come «caduto da sé» un
         * scollegamento nostro — e il diario direbbe una cosa falsa proprio nel
         * momento in cui serve leggerlo.
         */
        let mut ultimo_guasto = String::new();
        let mut collegato = false;
        for numero in 0..TENTATIVI_COLLEGAMENTO {
            let alla_caduta = mittente.clone();
            let contatori_caduta = contatori.clone();
            let cronista_caduta = cronista.clone();
            let caduta = Box::new(move || {
                if !contatori_caduta.scollegamento_voluto.load(Ordering::SeqCst) {
                    contatori_caduta.caduto.store(true, Ordering::SeqCst);
                    cronista_caduta(format!(
                        "il collegamento è caduto da sé, dopo {} notifiche",
                        contatori_caduta.notifiche.load(Ordering::Relaxed)
                    ));
                }
                if let Ok(mut posto) = alla_caduta.lock() {
                    *posto = None;
                }
            });
            match antenna.collega(dispositivo.to_string(), caduta).await {
                Ok(()) => {
                    if numero > 0 {
                        cronista(format!(
                            "collegamento riuscito al tentativo n. {} (i primi {numero} no)",
                            numero + 1
                        ));
                    }
                    collegato = true;
                    break;
                }
                Err(motivo) => {
                    ultimo_guasto = motivo;
                    if numero + 1 >= TENTATIVI_COLLEGAMENTO {
                        break;
                    }
                    let attesa = ATTESA_FRA_COLLEGAMENTI
                        .get(numero)
                        .copied()
                        .unwrap_or(Duration::from_millis(1500));
                    cronista(format!(
                        "collegamento non riuscito al tentativo n. {}: {ultimo_guasto}; \
                         scollego e riprovo fra {} ms",
                        numero + 1,
                        attesa.as_millis()
                    ));
                    // La pulizia può benissimo fallire («No device connected»):
                    // è il caso normale quando il `connect` non è mai arrivato
                    // in fondo, e non è un guasto da raccontare.
                    contatori.scollegamento_voluto.store(true, Ordering::SeqCst);
                    let _ = antenna.scollega().await;
                    contatori.scollegamento_voluto.store(false, Ordering::SeqCst);
                    aspetta(attesa).await;
                }
            }
        }
        if !collegato {
            return Err(format!(
                "collegamento non riuscito dopo {TENTATIVI_COLLEGAMENTO} tentativi: {ultimo_guasto}"
            ));
        }

        /*
         * ► ANCHE L'ELENCO DEI SERVIZI SI RICHIEDE. ◄ Su iOS la scoperta dei
         * servizi può tornare vuota o fallire nei primi istanti dopo il
         * collegamento, perché il sistema la sta ancora facendo. Un elenco
         * vuoto qui non è «questo apparecchio non ha servizi»: è «non li ho
         * ancora». E `risolvi_profilo` su un elenco vuoto si rifiuta, con un
         * messaggio che manda a cercare il guasto dalla parte sbagliata.
         */
        let mut servizi = Vec::new();
        for numero in 0..TENTATIVI_SERVIZI {
            match antenna.servizi(dispositivo.to_string()).await {
                Ok(visti) if !visti.is_empty() => {
                    if numero > 0 {
                        cronista(format!("i servizi sono comparsi alla richiesta n. {}", numero + 1));
                    }
                    servizi = visti;
                    break;
                }
                Ok(_) => {
                    if numero + 1 >= TENTATIVI_SERVIZI {
                        break;
                    }
                    cronista("nessun servizio annunciato: richiedo l'elenco".to_string());
                    aspetta(ATTESA_FRA_SERVIZI).await;
                }
                Err(motivo) => {
                    if numero + 1 >= TENTATIVI_SERVIZI {
                        return Err(motivo);
                    }
                    cronista(format!("elenco dei servizi non riuscito: {motivo}; richiedo"));
                    aspetta(ATTESA_FRA_SERVIZI).await;
                }
            }
        }
        cronista(format!(
            "servizi annunciati: {}",
            servizi
                .iter()
                .map(|s| format!("{} ({} caratteristiche)", s.uuid, s.caratteristiche.len()))
                .collect::<Vec<_>>()
                .join(", ")
        ));
        /*
         * ► IL GIRO DEI TENTATIVI. ◄ Il primo dell'elenco è esattamente quello
         * che l'applicazione faceva prima che il giro esistesse; gli altri
         * sono le combinazioni che prima non venivano provate affatto. Vedi
         * `elenca_tentativi` per quali scelte possono entrarci e quali no.
         */
        let tentativi = elenca_tentativi(&servizi, &scelta.marca, &scelta.prodotto)?;
        let (indice, perche) = scegli_tentativo(&tentativi, scelta);
        let scelto = tentativi[indice].clone();
        cronista(format!(
            "metodo {} di {} ({}): {} — {}",
            indice + 1,
            tentativi.len(),
            perche,
            scelto.nome,
            scelto.descrizione
        ));
        let profilo = ProfiloRisolto {
            servizio: scelto.servizio.clone(),
            scrittura: scelto.scrittura.clone(),
            notifica: scelto.notifica.clone(),
            modo: scelto.modo,
            alternativa: scelto.alternativa,
            crediti: scelto.crediti.clone(),
            descrizione: scelto.descrizione.clone(),
        };

        // Il nome si chiede subito e si tiene: quando libdivecomputer lo
        // vorrà, sarà sul thread dello scarico, dove non si può aspettare il
        // plugin. PRIMA quello visto in scansione, che è il nome
        // pubblicitario — l'unico che Oceanic accetta, otto caratteri esatti
        // — e solo se manca quello che il plugin ha in mano, che su alcuni
        // sistemi è il nome GAP messo in cache. Se non c'è nessuno dei due
        // non è un errore: lo diventa solo per i backend che ne hanno
        // bisogno, e allora lo dicono loro.
        let nome = match nome_visto.map(str::trim).filter(|n| !n.is_empty()) {
            Some(n) => Some(n.to_string()),
            None => match antenna.nome(dispositivo.to_string()).await {
                Ok(n) if !n.trim().is_empty() => Some(n),
                Ok(_) => {
                    cronista("il dispositivo non annuncia un nome".into());
                    None
                }
                Err(motivo) => {
                    cronista(format!("il nome del dispositivo non si legge: {motivo}"));
                    None
                }
            },
        };

        let scambio = Arc::new(Mutex::new(Scambio {
            modo: profilo.modo,
            alternativa: profilo.alternativa,
            cambiata_per_errore: false,
            scritture: 0,
            byte_scritti: 0,
            prima_della_risposta: Vec::new(),
            prima_scrittura: None,
            rinvii: 0,
            ultime: VecDeque::new(),
        }));

        /*
         * Lo scrittore: un compito asincrono che prende i comandi dal thread
         * dello scarico e li esegue sul plugin.
         *
         * Il canale ha un fondo (32) invece di essere illimitato perché una coda
         * che cresce senza limiti nasconde il caso in cui il Bluetooth è più
         * lento del protocollo: meglio che il thread dello scarico aspetti — è
         * fatto per aspettare — che accumulare comandi che il computer riceverà
         * fuori tempo massimo.
         */
        let (comandi, mut in_arrivo) = tauri::async_runtime::channel::<Comando>(32);
        let postino = Arc::new(Postino { comandi });
        {
            let antenna = antenna.clone();
            let servizio = profilo.servizio.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(comando) = in_arrivo.recv().await {
                    match comando {
                        Comando::Scrivi { caratteristica, dati, modo, conferma } => {
                            let esito = antenna.scrivi(servizio.clone(), caratteristica, dati, modo).await;
                            // Se chi aspettava non c'è più (ha rinunciato per
                            // scadenza) non è un errore: il comando è
                            // comunque partito.
                            let _ = conferma.send(esito);
                        }
                        Comando::Leggi { caratteristica, conferma } => {
                            let esito = antenna.leggi(caratteristica).await;
                            let _ = conferma.send(esito);
                        }
                    }
                }
                // Il canale si chiude quando il postino cade, cioè quando
                // `FlussoBle` viene distrutto alla fine dello scarico: da lì
                // in poi questo compito non ha più niente da fare e finisce
                // da sé.
            });
        }

        /*
         * I CREDITI, prima di iscriversi ai dati: l'ordine è quello di
         * Subsurface (`setupHwTerminalIo`) — ci si iscrive alla caratteristica
         * dei crediti in arrivo, a quella dei dati, e poi si concede il primo
         * blocco di crediti CON conferma, aspettando che sia scritto. Senza
         * quella scrittura il computer non manda un byte, e lo scarico
         * finirebbe con «tempo scaduto» al primo comando.
         */
        if let Some(crediti) = &profilo.crediti {
            let cronista_crediti = cronista.clone();
            let primo = AtomicBool::new(true);
            antenna
                .iscrivi(
                    profilo.servizio.clone(),
                    crediti.ascolto.clone(),
                    Box::new(move |dati: Vec<u8>| {
                        // Il contenuto non serve — sono i crediti che il
                        // computer concede a noi — ma la prima volta va
                        // raccontata: è la prova che il Terminal I/O è vivo.
                        if primo.swap(false, Ordering::Relaxed) {
                            cronista_crediti(format!(
                                "il computer ci concede crediti: [{}]",
                                anteprima(&dati)
                            ));
                        }
                    }),
                )
                .await
                .map_err(|e| format!("l'ascolto dei crediti non si attiva: {e}"))?;
        }

        let contatori_notifica = contatori.clone();
        let scambio_notifica = scambio.clone();
        let alla_notifica = mittente.clone();
        let cronista_notifica = cronista.clone();
        let ricarica = profilo.crediti.as_ref().map(|c| {
            (antenna.clone(), profilo.servizio.clone(), c.concessione.clone())
        });
        antenna
            .iscrivi(
                profilo.servizio.clone(),
                profilo.notifica.clone(),
                Box::new(move |dati: Vec<u8>| {
                    let quante = contatori_notifica.notifiche.fetch_add(1, Ordering::Relaxed) + 1;
                    contatori_notifica.ricevuti.fetch_add(dati.len(), Ordering::Relaxed);
                    /*
                     * ► LA MISURA CHE MANCAVA. ◄ La dimensione delle notifiche
                     * è l'MTU negoziato meno tre, e non c'è modo portabile di
                     * chiederlo al plugin — ma non serve chiederlo: basta
                     * guardare quanto arriva. È il numero che decide se il
                     * pacchetto di un Mares del ramo variabile ci sta o si
                     * spezza, ed è il numero che il 7 settembre 2026 nessuno
                     * aveva sotto gli occhi mentre cercava di capire perché un
                     * Quad Ci si fermasse.
                     */
                    contatori_notifica
                        .notifica_piu_grande
                        .fetch_max(dati.len(), Ordering::Relaxed);
                    contatori_notifica
                        .notifica_piu_piccola
                        .fetch_min(dati.len(), Ordering::Relaxed);
                    if quante == 1 {
                        // Da quando è partita la prima scrittura: `try_lock`
                        // e non `lock`, perché questa callback non ha il
                        // diritto di aspettare nessuno. Se il thread dello
                        // scarico ha il registro in mano proprio adesso, si
                        // perde il ritardo e resta «sconosciuto»: meglio di
                        // una notifica consegnata in ritardo.
                        let ritardo = scambio_notifica
                            .try_lock()
                            .ok()
                            .and_then(|s| s.prima_scrittura)
                            .map(|inizio| inizio.elapsed().as_millis() as u64);
                        if let Some(ms) = ritardo {
                            contatori_notifica.prima_notifica_ms.store(ms, Ordering::Relaxed);
                        }
                        cronista_notifica(format!(
                            "prima notifica: {} byte [{}]{}",
                            dati.len(),
                            anteprima(&dati),
                            match ritardo {
                                Some(ms) => format!(", {ms} ms dopo la prima scrittura"),
                                None => String::new(),
                            }
                        ));
                    }
                    if let Some((antenna, servizio, concessione)) = &ricarica {
                        // Un credito consumato per notifica; alla soglia se ne
                        // concedono altri. Lo `spawn` è lecito qui — non
                        // aspetta — ed è l'unico modo di scrivere dal runtime
                        // senza bloccarlo.
                        // Decremento SATURANTE: un firmware che manda una
                        // notifica in più di quelle coperte porterebbe un
                        // `fetch_sub` sotto zero a `usize::MAX`, e da lì la
                        // soglia non si raggiungerebbe mai più.
                        let prima = contatori_notifica
                            .crediti_rimasti
                            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |c| Some(c.saturating_sub(1)))
                            .unwrap_or(0);
                        if prima.saturating_sub(1) == CREDITI_MINIMI {
                            let quanti = CREDITI_INIZIALI - CREDITI_MINIMI;
                            let antenna = antenna.clone();
                            let servizio = servizio.clone();
                            let concessione = concessione.clone();
                            let cronista = cronista_notifica.clone();
                            let contatori = contatori_notifica.clone();
                            tauri::async_runtime::spawn(async move {
                                // I crediti si contano SOLO dopo che la
                                // scrittura è riuscita: contarli prima
                                // direbbe 254 mentre il computer ne ha zero,
                                // e il «tempo scaduto» che seguirebbe non
                                // avrebbe una causa nel diario.
                                match antenna
                                    .scrivi(servizio, concessione, vec![quanti as u8], ModoScrittura::ConRisposta)
                                    .await
                                {
                                    Ok(()) => {
                                        contatori.crediti_rimasti.fetch_add(quanti, Ordering::SeqCst);
                                    }
                                    Err(motivo) => {
                                        contatori.ricarica_fallita.store(true, Ordering::SeqCst);
                                        cronista(format!(
                                            "la ricarica di {quanti} crediti non è riuscita: {motivo}; \
il computer resta senza crediti e smetterà di mandare dati"
                                        ));
                                    }
                                }
                            });
                        }
                    }
                    // Un `send` su un canale non bloccante non ferma il runtime,
                    // ed è tutto quello che questa callback ha il diritto di
                    // fare: qualunque attesa qui fermerebbe la consegna delle
                    // notifiche successive.
                    if let Ok(posto) = alla_notifica.lock() {
                        if let Some(mittente) = posto.as_ref() {
                            let _ = mittente.send(dati);
                        }
                    }
                }),
            )
            .await?;

        if let Some(crediti) = &profilo.crediti {
            antenna
                .scrivi(
                    profilo.servizio.clone(),
                    crediti.concessione.clone(),
                    vec![CREDITI_INIZIALI as u8],
                    ModoScrittura::ConRisposta,
                )
                .await
                .map_err(|e| format!("la concessione dei primi {CREDITI_INIZIALI} crediti non è riuscita: {e}"))?;
            contatori.crediti_rimasti.store(CREDITI_INIZIALI, Ordering::SeqCst);
            cronista(format!("concessi {CREDITI_INIZIALI} crediti al computer (Terminal I/O)"));
        }

        /*
         * LA SCRITTURA, con la negoziazione dentro.
         *
         * Il primo tentativo usa la modalità del profilo. Se il plugin la
         * rifiuta — cosa che su Android e Linux succede quando si scrive
         * «senza conferma» a una caratteristica che vuole la conferma — e la
         * caratteristica dichiara anche l'altra, si cambia UNA volta e si
         * riprova la stessa scrittura. Se fallisce anche così, o se la modalità
         * era già stata cambiata, si fallisce e il diario dice tutte e due le
         * cose. Il caso opposto — scrittura accettata ma computer muto — lo
         * gestisce `su_silenzio`, qui sotto, con lo stesso registro.
         */
        let postino_scrittura = postino.clone();
        let scambio_scrittura = scambio.clone();
        let contatori_scrittura = contatori.clone();
        let cronista_scrittura = cronista.clone();
        let caratteristica_scrittura = profilo.scrittura.clone();
        let scrittura = Box::new(move |dati: &[u8]| -> Result<(), GuastoScrittura> {
            let numero = {
                let mut s = scambio_scrittura.lock().map_err(|_| "registro dello scambio guasto")?;
                s.scritture += 1;
                s.byte_scritti += dati.len();
                if contatori_scrittura.notifiche.load(Ordering::Relaxed) == 0 {
                    s.prima_della_risposta.push(dati.to_vec());
                } else if !s.prima_della_risposta.is_empty() {
                    // Dopo la prima risposta non servono più: liberarli è
                    // anche il modo di non tenere in memoria uno scarico intero.
                    s.prima_della_risposta = Vec::new();
                }
                if s.prima_scrittura.is_none() {
                    s.prima_scrittura = Some(Instant::now());
                }
                s.scritture
            };
            // La modalità si legge UNA volta e si tiene: la riga di diario più
            // sotto deve raccontare quella con cui la scrittura è partita, non
            // quella che il registro ha adesso — che il ripiego può avere già
            // cambiato. Un rinvio nell'altra modalità ha una riga sua.
            let modo = scambio_scrittura.lock().map_err(|_| "registro dello scambio guasto")?.modo;
            {
                let pezzo = dati;
                if let Err(guasto) = postino_scrittura.scrivi(&caratteristica_scrittura, pezzo, modo) {
                    let altro = {
                        let mut s = scambio_scrittura.lock().map_err(|_| "registro dello scambio guasto")?;
                        // Si cambia solo se il plugin ha RIFIUTATO (non se la
                        // conferma è scaduta o il collegamento è caduto: lì
                        // la modalità non c'entra), e solo se non è ancora
                        // arrivato niente: dopo la prima risposta la modalità
                        // ha dimostrato di funzionare, e un errore a quel
                        // punto è un'altra cosa.
                        let mai_risposto = contatori_scrittura.notifiche.load(Ordering::Relaxed) == 0;
                        let rifiutata = matches!(guasto, Guasto::Rifiutata(_));
                        if s.cambiata_per_errore || !mai_risposto || !rifiutata {
                            None
                        } else {
                            s.alternativa.take().inspect(|a| {
                                s.cambiata_per_errore = true;
                                s.modo = *a;
                            })
                        }
                    };
                    // ► LA QUALIFICA SI PORTA FINO IN FONDO. ◄ Se qui si
                    // perdesse — se restasse una stringa come tutte le altre —
                    // `cb_write` non potrebbe distinguere «il Bluetooth ha
                    // detto di no» da «la conferma non è arrivata», e
                    // risponderebbe a libdivecomputer «errore di
                    // trasmissione» su tutti e due. Vedi `GuastoScrittura`:
                    // sul secondo caso quella risposta costa l'intero
                    // scarico, perché toglie al backend il diritto di
                    // riprovare.
                    let scaduta = matches!(guasto, Guasto::Scaduta(_));
                    let qualifica = |m: String| {
                        if scaduta {
                            GuastoScrittura::Scaduta(m)
                        } else {
                            GuastoScrittura::Rifiutata(m)
                        }
                    };
                    let motivo = guasto.in_stringa();
                    let Some(altro) = altro else {
                        // ► LA CODA DELLA RIGA È PER IL DIARIO DELLA PROSSIMA
                        // VOLTA. ◄ Da qui in avanti una conferma scaduta lascia
                        // ritentare, e chi legge il diario deve poter vedere la
                        // differenza fra «si è fermato qui» e «qui ha inciampato
                        // e ha ripreso»: se dopo questa riga lo scarico prosegue,
                        // il ritentativo ha funzionato; se il diario finisce
                        // qui, il computer non c'era più davvero. Senza questa
                        // coda le due cose sarebbero indistinguibili, ed è
                        // esattamente la domanda che il diario del 9 settembre
                        // 2026 ci ha lasciato senza risposta.
                        cronista_scrittura(format!(
                            "scrittura n. {numero} ({} byte [{}], {}) fallita: {motivo}{}",
                            dati.len(),
                            anteprima(dati),
                            nome_modo(modo),
                            if scaduta { "; si può ritentare" } else { "" }
                        ));
                        return Err(qualifica(format!(
                            "scrittura n. {numero} ({}): {motivo}",
                            nome_modo(modo)
                        )));
                    };
                    cronista_scrittura(format!(
                        "scrittura n. {numero} ({} byte [{}], {}) rifiutata: {motivo}; riprovo {}",
                        dati.len(),
                        anteprima(dati),
                        nome_modo(modo),
                        nome_modo(altro)
                    ));
                    postino_scrittura.scrivi(&caratteristica_scrittura, pezzo, altro).map_err(|seconda| {
                        // La qualifica che conta è quella del SECONDO guasto,
                        // non del primo: il primo è per forza un rifiuto — lo
                        // decide `altro` qui sopra — ma il rinvio nell'altra
                        // modalità può benissimo scadere, e se qui lo
                        // chiamassimo «rifiuto» rifaremmo, in piccolo, l'errore
                        // che tutto questo serve a togliere. Vedi
                        // `GuastoScrittura`.
                        let seconda_scaduta = matches!(seconda, Guasto::Scaduta(_));
                        let seconda = seconda.in_stringa();
                        cronista_scrittura(format!(
                            "scrittura n. {numero} fallita anche {}: {seconda}",
                            nome_modo(altro)
                        ));
                        let racconto = format!(
                            "scrittura n. {numero}: rifiutata {} ({motivo}) e anche {} ({seconda})",
                            nome_modo(modo),
                            nome_modo(altro)
                        );
                        if seconda_scaduta {
                            GuastoScrittura::Scaduta(racconto)
                        } else {
                            GuastoScrittura::Rifiutata(racconto)
                        }
                    })?;
                }
            }
            /*
             * La riga si compone SEMPRE, e poi si decide dove va: in diretta
             * se è fra le prime, e comunque in fondo alla coda che il
             * riassunto leggerà. Comporla sempre costa una stringa corta per
             * scrittura — su un trasferimento da millecinquecento è niente —
             * e comprarla dà la coda, che è la metà del diario che finora
             * mancava.
             */
            {
                let mut registro = scambio_scrittura.lock().map_err(|_| "registro dello scambio guasto")?;
                let riga = format!(
                    "scrittura n. {numero}: {} byte [{}], {}",
                    dati.len(),
                    anteprima(dati),
                    nome_modo(modo)
                );
                if registro.ultime.len() == SCRITTURE_IN_CODA {
                    registro.ultime.pop_front();
                }
                registro.ultime.push_back((numero, riga.clone()));
                // Il lucchetto si molla PRIMA di chiamare il cronista: quello
                // emette un evento verso l'interfaccia, e tenere un mutex
                // mentre si attraversa un confine è il modo in cui nascono i
                // blocchi che nessuno sa più spiegare.
                drop(registro);
                if numero <= SCRITTURE_RACCONTATE {
                    cronista_scrittura(riga);
                }
            }
            Ok(())
        });

        /*
         * IL RIPIEGO SUL SILENZIO. `FlussoBle` lo chiama una volta sola, quando
         * la prima lettura scade senza che sia MAI arrivata una notifica. Se
         * c'è un'altra modalità da provare, si rimanda l'ultimo comando per
         * intero in quella, e si dice di aspettare ancora. Rimandare un
         * comando è lecito solo qui — al primo scambio, che in tutti i
         * protocolli è un'identificazione — ed è per questo che il ripiego
         * non esiste dopo la prima notifica.
         */
        let postino_silenzio = postino.clone();
        let scambio_silenzio = scambio.clone();
        let contatori_silenzio = contatori.clone();
        let cronista_silenzio = cronista.clone();
        let caratteristica_silenzio = profilo.scrittura.clone();
        let su_silenzio = Box::new(move || -> Ripiego {
            if contatori_silenzio.notifiche.load(Ordering::Relaxed) > 0
                || contatori_silenzio.caduto.load(Ordering::Relaxed)
            {
                return Ripiego::Esaurito;
            }
            let (comando, da, a, numero, trascorso) = {
                let Ok(mut s) = scambio_silenzio.lock() else { return Ripiego::Esaurito };
                let trascorso = s.prima_scrittura.map(|i| i.elapsed().as_millis()).unwrap_or(0);
                // Senza una scrittura da rimandare non c'è niente da
                // negoziare: una lettura scaduta prima di qualunque comando
                // è un protocollo che aspetta un saluto spontaneo, non una
                // modalità sbagliata. Toccare lo stato qui brucerebbe
                // l'alternativa senza averla provata.
                if s.prima_della_risposta.is_empty() {
                    cronista_silenzio(format!(
                        "prima lettura scaduta ({trascorso} ms) senza che sia stato scritto niente: \
niente da rimandare"
                    ));
                    return Ripiego::NienteDaFare;
                }
                let Some(a) = s.alternativa.take() else {
                    let perche = if s.cambiata_per_errore {
                        "l'altra modalità è già stata provata ed è stata rifiutata".to_string()
                    } else {
                        format!("la caratteristica accetta solo la modalità {}", nome_modo(s.modo))
                    };
                    cronista_silenzio(format!(
                        "primo scambio muto: nessuna notifica {trascorso} ms dopo la prima scrittura, \
e {perche}: niente da ritentare"
                    ));
                    return Ripiego::Esaurito;
                };
                let da = s.modo;
                s.modo = a;
                s.rinvii += 1;
                (s.prima_della_risposta.clone(), da, a, s.scritture, trascorso)
            };
            let byte_totali: usize = comando.iter().map(Vec::len).sum();
            cronista_silenzio(format!(
                "primo scambio muto: nessuna notifica {trascorso} ms dopo la prima scrittura; \
rimando le {} scritture fatte finora (n. 1–{numero}, {byte_totali} byte, la prima [{}]) {} invece che {}",
                comando.len(),
                anteprima(comando.first().map(Vec::as_slice).unwrap_or(&[])),
                nome_modo(a),
                nome_modo(da)
            ));
            for pezzo in &comando {
                if let Err(guasto) = postino_silenzio.scrivi(&caratteristica_silenzio, pezzo, a) {
                    cronista_silenzio(format!(
                        "il rinvio {} non è riuscito: {}; si resta {}",
                        nome_modo(a),
                        guasto.testo(),
                        nome_modo(da)
                    ));
                    // La modalità nuova è stata rifiutata: si torna a quella
                    // di prima, che almeno le scritture le accettava, e
                    // l'alternativa resta consumata perché è stata provata.
                    if let Ok(mut s) = scambio_silenzio.lock() {
                        s.modo = da;
                    }
                    return Ripiego::Esaurito;
                }
            }
            Ripiego::Rimandato
        });

        let riassunto = {
            let scambio = scambio.clone();
            let contatori = contatori.clone();
            Box::new(move || -> String {
                let (scritture, byte_scritti, modo, rinvii, ultime) = match scambio.lock() {
                    Ok(s) => (
                        s.scritture,
                        s.byte_scritti,
                        nome_modo(s.modo),
                        s.rinvii,
                        // Solo quelle che NON sono già uscite in diretta: con
                        // dieci scritture in tutto, testa e coda si
                        // sovrappongono, e ripetere le stesse righe raddoppia
                        // il diario dei casi in cui si legge meglio.
                        s.ultime
                            .iter()
                            .filter(|(n, _)| *n > SCRITTURE_RACCONTATE)
                            .map(|(_, r)| r.clone())
                            .collect::<Vec<_>>(),
                    ),
                    Err(_) => (0, 0, "sconosciuto", 0, Vec::new()),
                };
                let rinvii = match rinvii {
                    0 => String::new(),
                    1 => "; 1 rinvio".to_string(),
                    n => format!("; {n} rinvii"),
                };
                let notifiche = contatori.notifiche.load(Ordering::Relaxed);
                let ricevuti = contatori.ricevuti.load(Ordering::Relaxed);
                let prima = contatori.prima_notifica_ms.load(Ordering::Relaxed);
                // Si decide sul CONTO delle notifiche, non sul ritardo: il
                // ritardo può mancare (il `try_lock` della callback può non
                // riuscire) anche quando le notifiche ci sono state, e un
                // riassunto che dice «3 notifiche, nessuna notifica ricevuta»
                // è la riga di diagnostica che si contraddice da sola.
                let prima = if notifiche == 0 {
                    "nessuna notifica ricevuta".to_string()
                } else if prima == u64::MAX {
                    "ritardo della prima notifica non misurato".to_string()
                } else {
                    format!("prima notifica dopo {prima} ms")
                };
                let caduto = if contatori.caduto.load(Ordering::Relaxed) {
                    "; il collegamento è caduto da sé"
                } else {
                    ""
                };
                let crediti = if contatori.ricarica_fallita.load(Ordering::Relaxed) {
                    "; una ricarica di crediti non è riuscita"
                } else {
                    ""
                };
                /*
                 * La dimensione delle notifiche, che è l'MTU meno tre visto da
                 * dove conta: da quello che è arrivato davvero. Se la più
                 * piccola è più corta della più grande, qualcosa è arrivato a
                 * pezzi — su BLE i frammenti di uno stesso messaggio sono
                 * tutti pieni tranne l'ultimo — e per i Mares del ramo
                 * variabile è la differenza fra scaricare e non scaricare.
                 */
                let grande = contatori.notifica_piu_grande.load(Ordering::Relaxed);
                let piccola = contatori.notifica_piu_piccola.load(Ordering::Relaxed);
                let misure = if notifiche == 0 {
                    String::new()
                } else if grande == piccola {
                    format!(", notifiche da {grande} byte")
                } else {
                    format!(", notifiche da {piccola} a {grande} byte")
                };
                /*
                 * ► LA CODA ESCE SOLO SE NON È GIÀ USCITA IN DIRETTA. ◄
                 * Con quattro scritture in tutto, testa e coda sono la stessa
                 * cosa, e ripeterle raddoppierebbe il diario dei casi più
                 * piccoli — che sono anche quelli in cui si legge meglio.
                 */
                let coda = if !ultime.is_empty() {
                    format!("\nultime scritture prima della fine:\n{}", ultime.join("\n"))
                } else {
                    String::new()
                };
                format!(
                    "scambio: {scritture} scritture ({byte_scritti} byte, {modo}{rinvii}), \
{notifiche} notifiche ({ricevuti} byte{misure}), {prima}{caduto}{crediti}{coda}"
                )
            })
        };

        let misure = {
            let scambio = scambio.clone();
            let contatori = contatori.clone();
            Box::new(move || -> Misure {
                Misure {
                    scritture: scambio.lock().map(|s| s.scritture).unwrap_or(0),
                    notifiche: contatori.notifiche.load(Ordering::Relaxed),
                    byte_ricevuti: contatori.ricevuti.load(Ordering::Relaxed),
                }
            })
        };

        Ok(PonteBle {
            entrata,
            scrittura,
            accessori: Box::new(AccessoriDelPonte { nome, postino: postino.clone() }),
            su_silenzio,
            descrizione: profilo.descrizione.clone(),
            ricevuti,
            riassunto,
            misure,
            scollegamento_voluto,
            metodo: scelto,
            metodo_indice: indice,
            metodi_totali: tentativi.len(),
        })
    }

    // ------------------------------------------------- l'antenna vera, il plugin

    /// `tauri-plugin-blec` visto attraverso il tratto.
    ///
    /// È l'UNICO punto del progetto che conosce le firme del plugin. Della
    /// versione 0.12 si usano: `get_handler`, `Handler::connect`,
    /// `Handler::discover_services`, `Handler::connected_device`,
    /// `Handler::subscribe`, `Handler::send_data`, `Handler::recv_data`,
    /// `Handler::disconnect`, più `OnDisconnectHandler::from_sync` e i tipi di
    /// `models`.
    ///
    /// UNA COSA CHE IL PLUGIN FA DA SÉ, e che cambia la lettura del diario: su
    /// Apple, btleplug trasforma una scrittura «senza conferma» in una «con
    /// conferma» se la caratteristica non dichiara la prima (vedi
    /// `corebluetooth/peripheral.rs`, `write`). Quindi su iPhone e Mac una
    /// modalità sbagliata NON produce un errore, e il ripiego per errore non
    /// scatta mai: lì lavora solo quello sul silenzio. Su Android e Linux la
    /// scrittura sbagliata viene rifiutata, e scatta il primo.
    #[derive(Clone, Copy, Default)]
    pub struct AntennaBlec;

    impl From<ModoScrittura> for tauri_plugin_blec::models::WriteType {
        fn from(modo: ModoScrittura) -> Self {
            match modo {
                ModoScrittura::ConRisposta => Self::WithResponse,
                ModoScrittura::SenzaRisposta => Self::WithoutResponse,
            }
        }
    }

    /// Da UUID scritto a UUID del plugin, dicendo chi è se non si legge.
    fn uuid(testo: &str, ruolo: &str) -> Result<uuid::Uuid, String> {
        uuid::Uuid::parse_str(testo)
            .map_err(|e| format!("l’UUID {ruolo} «{testo}» non si legge: {e}"))
    }

    fn maniglia() -> Result<&'static tauri_plugin_blec::Handler, String> {
        // Il plugin può non essersi inizializzato — adattatore assente, permesso
        // negato, macchina virtuale — e in quel caso `run()` lo ha detto sulla
        // console e ha proseguito senza. Qui l'unica cosa onesta è dirlo a chi
        // ha premuto il pulsante.
        tauri_plugin_blec::get_handler()
            .map_err(|e| format!("il Bluetooth non è disponibile in questa copia: {e}"))
    }

    impl AntennaBle for AntennaBlec {
        async fn collega(
            &self,
            dispositivo: String,
            caduta: Box<dyn FnOnce() + Send>,
        ) -> Result<(), String> {
            let handler = maniglia()?;
            handler
                .connect(
                    &dispositivo,
                    tauri_plugin_blec::OnDisconnectHandler::from_sync(caduta),
                    // Niente iBeacon: un computer subacqueo non lo è, e
                    // accettarli allargherebbe la ricerca a mezza barca.
                    false,
                )
                .await
                .map_err(|e| format!("collegamento non riuscito: {e}"))
        }

        async fn servizi(&self, dispositivo: String) -> Result<Vec<ServizioVisto>, String> {
            use tauri_plugin_blec::models::CharProps;
            let handler = maniglia()?;
            let servizi = handler
                .discover_services(&dispositivo)
                .await
                .map_err(|e| format!("i servizi del dispositivo non si leggono: {e}"))?;
            Ok(servizi
                .into_iter()
                .map(|s| ServizioVisto {
                    uuid: s.uuid.to_string(),
                    caratteristiche: s
                        .characteristics
                        .into_iter()
                        .map(|c| CaratteristicaVista {
                            uuid: c.uuid.to_string(),
                            scrivibile: c.properties.contains(CharProps::Write),
                            scrivibile_senza_risposta: c
                                .properties
                                .contains(CharProps::WriteWithoutResponse),
                            // «Indicate» è «notify» con una conferma in più:
                            // per chi legge i byte è la stessa cosa, e
                            // scartarla farebbe fallire il riconoscimento su
                            // un dispositivo che funziona.
                            notifica: c.properties.contains(CharProps::Notify)
                                || c.properties.contains(CharProps::Indicate),
                        })
                        .collect(),
                })
                .collect())
        }

        async fn nome(&self, _dispositivo: String) -> Result<String, String> {
            let handler = maniglia()?;
            handler
                .connected_device()
                .await
                .map(|d| d.name)
                .map_err(|e| format!("{e}"))
        }

        async fn iscrivi(
            &self,
            servizio: String,
            caratteristica: String,
            arrivata: Box<dyn Fn(Vec<u8>) + Send + Sync>,
        ) -> Result<(), String> {
            let handler = maniglia()?;
            let caratteristica = uuid(&caratteristica, "delle notifiche")?;
            let servizio = uuid(&servizio, "del servizio")?;
            handler
                .subscribe(caratteristica, Some(servizio), arrivata)
                .await
                .map_err(|e| format!("le notifiche non si attivano: {e}"))
        }

        async fn scrivi(
            &self,
            servizio: String,
            caratteristica: String,
            dati: Vec<u8>,
            modo: ModoScrittura,
        ) -> Result<(), String> {
            let handler = maniglia()?;
            let caratteristica = uuid(&caratteristica, "di scrittura")?;
            let servizio = uuid(&servizio, "del servizio")?;
            handler
                .send_data(caratteristica, Some(servizio), &dati, modo.into())
                .await
                .map_err(|e| format!("scrittura non riuscita: {e}"))
        }

        async fn leggi(&self, caratteristica: String) -> Result<Vec<u8>, String> {
            let handler = maniglia()?;
            let caratteristica = uuid(&caratteristica, "da leggere")?;
            handler
                .recv_data(caratteristica, None)
                .await
                .map_err(|e| format!("lettura non riuscita: {e}"))
        }

        async fn scollega(&self) -> Result<(), String> {
            let handler = maniglia()?;
            handler
                .disconnect()
                .await
                .map_err(|e| format!("scollegamento non riuscito: {e}"))
        }
    }

    // ------------------------------------------------------------- gli eventi

    /// Una immersione come la scrive il computer, prima di essere tradotta.
    /// Gli stessi campi di `DownloadedRecord` in `src/core/ble/types.ts`.
    #[derive(serde::Serialize, Clone)]
    pub struct RecordScaricato {
        pub key: String,
        pub bytes: Vec<u8>,
    }

    /// Che cosa sta succedendo, mentre succede.
    ///
    /// **Le parole sono quelle di `DownloadEvent` in `src/core/ble/types.ts`, e
    /// devono restarlo.** L'interfaccia ha già una scheda che mostra lo scarico
    /// dei due driver scritti in casa: se questa strada parlasse un secondo
    /// linguaggio, quella scheda andrebbe scritta due volte e le due copie
    /// divergerebbero al primo cambiamento. Da qui `serde` produce esattamente
    /// `{ kind: "record", done: 3, … }`.
    ///
    /// COSA NON SI EMETTE, e perché. `identified`, che nel vocabolario significa
    /// «il computer si è presentato». Per questa strada il modello lo sceglie la
    /// persona da un elenco e libdivecomputer non ce lo ripete indietro:
    /// emetterlo con il nome scelto sarebbe far dire al computer una cosa che
    /// non ha detto. Il modello scelto finisce in `trace`, che è quello che è.
    #[derive(serde::Serialize, Clone)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum EventoScarico {
        Connecting,
        Counted {
            #[serde(skip_serializing_if = "Option::is_none")]
            total: Option<usize>,
        },
        Record {
            done: usize,
            #[serde(skip_serializing_if = "Option::is_none")]
            total: Option<usize>,
            record: RecordScaricato,
        },
        Skipped {
            key: String,
            reason: String,
        },
        Progress {
            done: usize,
            #[serde(skip_serializing_if = "Option::is_none")]
            total: Option<usize>,
            label: String,
        },
        Trace {
            line: String,
        },
        /*
         * ► IL COMPUTER STA MOSTRANDO UN NUMERO, E ASPETTA. ◄
         *
         * L'Aqualung i330R (e il DSX, stessa famiglia) non si fa leggere da
         * un telefono che non conosce: al primo comando accende sul proprio
         * schermo un PIN di sei cifre e vuole che gli venga ripetuto. Questo
         * evento è il momento esatto in cui quel numero è comparso — non
         * prima, perché prima non c'è — e da qui il thread dello scarico
         * **è fermo** finché non arriva `rispondi_codice_pin`.
         *
         * Chi ascolta ha due doveri e non uno: mostrare la richiesta, e
         * rispondere SEMPRE, anche quando la persona rinuncia. Una finestra
         * chiusa senza risposta lascia lo scarico appeso fino alla scadenza,
         * e la scadenza è lunga apposta perché il numero va letto su uno
         * schermo piccolo, spesso al buio, spesso bagnato.
         */
        PinRequired,
        /*
         * Il codice di accesso che il computer ha rilasciato in cambio del PIN.
         *
         * Va conservato accanto al dispositivo: allo scarico successivo si
         * restituisce a libdivecomputer e il PIN non viene più chiesto. Non è
         * un segreto della persona — è una chiave di accoppiamento fra questa
         * installazione e quel computer, come un legame Bluetooth — ma non
         * finisce nel diario tecnico per la stessa ragione per cui non ci
         * finiscono i numeri di serie altrui: il diario si allega alle
         * segnalazioni.
         */
        AccessCode {
            /// I byte in esadecimale minuscolo, senza separatori.
            hex: String,
        },
        /*
         * ► CON QUALE METODO SI STA PROVANDO, E QUANTI CE NE SONO. ◄
         *
         * Esce subito dopo il collegamento, prima che parta il primo comando.
         * Serve a tre cose, e tutte e tre contano:
         *
         *  - dire a chi guarda **cosa** si sta provando, con parole sue
         *    («senza conferma, notifiche unite») e non con un UUID;
         *  - dire se **ce n'è un altro** da provare, che è la sola cosa che
         *    permette all'interfaccia di offrire «riprova con un altro metodo»
         *    invece di un vicolo cieco;
         *  - consegnare la **chiave** da conservare se questo scarico riesce,
         *    così la volta dopo si parte da quello che ha funzionato.
         */
        Method {
            /// Contando da uno, per chi legge.
            index: usize,
            total: usize,
            /// «senza conferma, notifiche unite».
            name: String,
            /// La forma con cui si conserva. Vedi `Tentativo::chiave`.
            key: String,
        },
        /*
         * ► QUANTO È SUCCESSO DAVVERO SUL FILO, IN NUMERI. ◄
         *
         * Esce alla fine di ogni tentativo, riuscito o no, e serve a chi
         * ascolta per decidere **come** insistere — non per raccontare, che è
         * il mestiere del riassunto.
         *
         * La domanda a cui risponde è una sola: *il computer ha risposto?* Se
         * sì, il metodo ha dimostrato di funzionare e un fallimento successivo
         * è del collegamento: si riprova **allo stesso modo**. Se no, il metodo
         * non ha dimostrato niente: si passa al prossimo. Vedi
         * `Misure::qualcosa_e_arrivato`, dove sta il perché per esteso.
         */
        Exchange {
            writes: usize,
            notifications: usize,
            bytes: usize,
        },
    }

    /// Quante volte si prova ad aprire il collegamento prima di arrendersi.
    ///
    /// Tre, e non di più: chi ha il computer in mano ha la batteria che cala e
    /// il dito sul pulsante. Un'insistenza che dura mezzo minuto senza dire
    /// niente somiglia a un blocco, e a quel punto la persona chiude l'app —
    /// che è il modo peggiore di finire un tentativo, perché non lascia
    /// nemmeno il diario.
    const TENTATIVI_COLLEGAMENTO: usize = 3;

    /// Le pause fra un tentativo di collegamento e il successivo.
    ///
    /// Crescono, perché le due cause tipiche hanno tempi diversi: un
    /// `connect` andato male si ripulisce in poche centinaia di millisecondi,
    /// mentre un computer che si è appena spento in stand-by ha bisogno di
    /// più tempo per tornare a farsi vedere.
    #[cfg(not(test))]
    const ATTESA_FRA_COLLEGAMENTI: [Duration; 2] =
        [Duration::from_millis(400), Duration::from_millis(1200)];
    #[cfg(test)]
    const ATTESA_FRA_COLLEGAMENTI: [Duration; 2] =
        [Duration::from_millis(5), Duration::from_millis(5)];

    /// Quante volte si richiede l'elenco dei servizi se torna vuoto.
    const TENTATIVI_SERVIZI: usize = 3;

    #[cfg(not(test))]
    const ATTESA_FRA_SERVIZI: Duration = Duration::from_millis(500);
    #[cfg(test)]
    const ATTESA_FRA_SERVIZI: Duration = Duration::from_millis(5);

    /// Un'attesa che non blocca il runtime.
    ///
    /// `std::thread::sleep` dentro un `async` fermerebbe il thread del runtime
    /// su cui girano anche le callback delle notifiche: dormire lì vorrebbe
    /// dire smettere di ascoltare il computer proprio mentre lo si aspetta.
    async fn aspetta(quanto: Duration) {
        let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(quanto)).await;
    }

    /// Com'è finito uno scarico: quello che è arrivato **e** come è andata.
    ///
    /// ════════════════════════════════════════════════════════════════════════
    /// ► PERCHÉ NON BASTA UN `Result`. ◄
    ///
    /// Un `Result` costringe a scegliere: o le immersioni o l'errore. Per uno
    /// scarico via Bluetooth quella scelta è falsa, e la falsità costa dati: i
    /// backend consegnano le immersioni **una alla volta, dalla più recente
    /// alla più vecchia**, quindi uno scarico che si rompe a metà ne ha in mano
    /// un pezzo buono.
    ///
    /// *Con il `Result`, il guscio Rust le raccoglieva e il lato TypeScript le
    /// buttava, perché la promessa veniva rifiutata: il diario diceva «N
    /// immersioni erano già arrivate e si tengono» e non era vero.* Una riga di
    /// diario che afferma una cosa che non succede è peggio di nessuna riga,
    /// perché chi ripara ci costruisce sopra.
    ///
    /// Chi riceve deve fare **due** cose distinte, e non in alternativa:
    /// prendersi le immersioni, e sapere che non è finita bene — perché da
    /// quella seconda dipende se conservare il segnalibro (mai, dopo
    /// un'interruzione) e se riprovare.
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EsitoEsterno {
        pub immersioni: Vec<ImmersioneLdc>,
        /// Assente se è filato tutto liscio.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub guasto: Option<String>,
    }

    /// Il nome dell'evento Tauri. Come `accesso-ritorno`: minuscolo, con trattino.
    pub const EVENTO: &str = "scarico-esterno";

    /// Ogni quanto si dice «sto ancora leggendo».
    const RITMO_AVANZAMENTO: Duration = Duration::from_millis(500);

    // ---------------------------------------------------------- lo scarico vero

    /// La parte bloccante: apre libdivecomputer sopra il ponte, scarica, traduce.
    ///
    /// **Gira su un thread suo e non deve mai girare altrove.** `CollegamentoLdc`
    /// contiene puntatori del C che non attraversano i thread, quindi tutto —
    /// contesto, descrittore, scarico e traduzione — nasce e muore qui dentro, e
    /// quello che torna indietro è soltanto il modello, che è dati.
    fn scarica_bloccante(
        emetti: &dyn Fn(EventoScarico),
        ponte: PonteBle,
        marca: &str,
        prodotto: &str,
        segnalibro: &[u8],
    ) -> Result<EsitoEsterno, String> {
        let PonteBle {
            entrata,
            scrittura,
            accessori,
            su_silenzio,
            descrizione,
            riassunto,
            misure,
            metodo,
            ..
        } = ponte;

        emetti(EventoScarico::Trace {
            line: format!("modello scelto: {marca} {prodotto}"),
        });
        emetti(EventoScarico::Trace { line: descrizione });

        let descrittore = trova_descrittore(marca, prodotto).ok_or_else(|| {
            format!("libdivecomputer non conosce nessun «{marca} {prodotto}»")
        })?;
        // Un contesto a parte da quello del collegamento: `traduci` ne vuole uno
        // e non ha niente a che vedere col Bluetooth — vedi il commento su
        // `Contesto` in `trasporto_ldc.rs`.
        let contesto = Contesto::nuovo()?;

        // ► LA POLITICA VIENE DAL TENTATIVO, NON PIÙ DEDOTTA QUI. ◄ Il primo
        // tentativo porta quella scelta per il modello; dal secondo in poi è
        // il giro a variarla, e dedurla un'altra volta qui la ribalterebbe.
        let come = metodo.riassemblaggio;
        if come == Riassemblaggio::PacchettoIntero {
            emetti(EventoScarico::Trace {
                line: "le notifiche si rimettono insieme: il pacchetto si legge intero in una volta sola"
                    .into(),
            });
        }
        let flusso = FlussoBle::nuovo(entrata, scrittura)
            .con_accessori(accessori, su_silenzio)
            .con_riassemblaggio(come);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso))?;
        emetti(EventoScarico::Progress {
            done: 0,
            total: None,
            label: "lettura della memoria del computer".into(),
        });

        /*
         * IL RIASSUNTO DELLO SCAMBIO va nel diario comunque sia andata, e
         * quando è andata male va anche nel messaggio d'errore: chi segnala
         * copia quello che vede, e «stato -6» da solo ha già mandato una
         * segnalazione vera a cercare il guasto dalla parte sbagliata. Con il
         * riassunto accanto — «1 scrittura, 0 notifiche, il collegamento è
         * caduto» — la seconda segnalazione dice dove si è rotto.
         */
        /*
         * ► E QUELLO CHE HA DETTO LIBDIVECOMPUTER VA NEL DIARIO PRIMA DI TUTTO
         * IL RESTO. ◄ Il riassunto racconta il **nostro** lato dello scambio —
         * quante scritture, quante notifiche, quanto grandi — ed è servito a
         * smentire un'ipotesi sbagliata. Ma il numero di stato da solo non dice
         * QUALE controllo della libreria è fallito, e su `-8` la differenza
         * decide tutto: dal pacchetto (`mares_iconhd_transfer` ritenta quattro
         * volte) o dal toggle dei segmenti (non si ritenta affatto, lo scarico
         * muore alla prima). Vedi `Contesto` in `trasporto_ldc.rs`.
         *
         * Escono **comunque vada**, come il riassunto: su uno scarico riuscito
         * gli avvisi dicono cosa ha perdonato, e sapere cosa ha perdonato è il
         * modo di vedere arrivare il guasto prima che chiuda una segnalazione.
         */
        let voce_della_libreria = || {
            for riga in collegamento.righe_della_libreria() {
                emetti(EventoScarico::Trace { line: riga });
            }
        };
        // I numeri escono PRIMA della prosa, e comunque vada: sono quelli che
        // decidono il tentativo dopo, e devono arrivare a chi ascolta anche se
        // il messaggio d'errore che segue lo fa smettere di leggere.
        let dire_le_misure = || {
            let m = misure();
            emetti(EventoScarico::Exchange {
                writes: m.scritture,
                notifications: m.notifiche,
                bytes: m.byte_ricevuti,
            });
        };
        /*
         * ► SI PRENDE QUELLO CHE È ARRIVATO ANCHE QUANDO SI È ROTTO. ◄ Vedi
         * `CollegamentoLdc::scarica_tutto`: un backend che consegna le
         * immersioni una per volta può averne consegnate quaranta prima di
         * inciampare, e fino a stanotte le buttavamo tutte. Adesso il guasto e
         * il bottino viaggiano insieme, e il guasto si racconta **dopo** aver
         * consegnato il bottino.
         */
        if !segnalibro.is_empty() {
            emetti(EventoScarico::Trace {
                line: format!(
                    "segnalibro: si leggono solo le immersioni più recenti di quella già in archivio ({} byte)",
                    segnalibro.len()
                ),
            });
        }
        let esito_scarico = collegamento.scarica_tutto(&descrittore, segnalibro);
        let guasto_dello_scarico = esito_scarico.guasto;
        let grezze = esito_scarico.immersioni;
        let coda_del_guasto = match &guasto_dello_scarico {
            None => {
                dire_le_misure();
                voce_della_libreria();
                emetti(EventoScarico::Trace { line: riassunto() });
                None
            }
            Some(motivo) => {
                let m = misure();
                dire_le_misure();
                voce_della_libreria();
                /*
                 * ► LA RIGA CHE DICE A CHI LEGGE QUALE DEI DUE GUASTI È. ◄ Il
                 * riassunto dà i numeri; questa dice cosa vogliono dire, ed è
                 * la stessa domanda su cui l'interfaccia decide se riprovare
                 * uguale o cambiare metodo. Scriverla qui serve a chi riceve
                 * il diario incollato in una segnalazione: senza, deve
                 * ricavarla contando, ed è esattamente il conto che il 9
                 * settembre 2026 ho sbagliato.
                 */
                emetti(EventoScarico::Trace {
                    line: if m.qualcosa_e_arrivato() {
                        "il computer aveva risposto: questo modo funziona, si è rotto il collegamento"
                            .to_string()
                    } else {
                        "il computer non ha risposto: questo modo non ha dimostrato niente".to_string()
                    },
                });
                if !grezze.is_empty() {
                    // Chi legge il diario deve sapere che non è finita a mani
                    // vuote: «non riuscito» accanto a quaranta immersioni
                    // entrate è una frase che si contraddice da sola.
                    emetti(EventoScarico::Trace {
                        line: format!(
                            "lo scarico si è rotto, ma {} immersioni erano già arrivate e si tengono",
                            grezze.len()
                        ),
                    });
                }
                let scambio = riassunto();
                emetti(EventoScarico::Trace { line: scambio.clone() });
                Some(format!("{motivo} — {scambio}"))
            }
        };
        let quante = grezze.len();
        emetti(EventoScarico::Counted { total: Some(quante) });

        let mut immersioni = Vec::with_capacity(quante);
        for (indice, grezza) in grezze.into_iter().enumerate() {
            // La chiave è l'impronta, che è quello con cui il computer dice
            // «questa te l'ho già data». Se non ce l'ha, la posizione: serve a
            // poter nominare nel messaggio l'immersione che non si è letta,
            // invece di dire «una».
            let chiave = if grezza.impronta.is_empty() {
                format!("posizione-{indice}")
            } else {
                grezza.impronta.iter().map(|v| format!("{v:02x}")).collect()
            };
            match traduci(&contesto, &descrittore, &grezza.dati) {
                Ok(immersione) => {
                    emetti(EventoScarico::Record {
                        done: immersioni.len() + 1,
                        total: Some(quante),
                        // I byte grezzi viaggiano insieme al modello perché è
                        // quello che fanno anche i driver scritti in casa: chi
                        // ascolta può archiviarli e riprovare la lettura più
                        // avanti, senza ricollegare il computer.
                        record: RecordScaricato { key: chiave, bytes: grezza.dati },
                    });
                    immersioni.push(immersione);
                }
                // Un'immersione illeggibile NON ferma le altre: quarantanove
                // immersioni e un avviso valgono più di zero immersioni e un
                // errore.
                Err(motivo) => emetti(EventoScarico::Skipped { key: chiave, reason: motivo }),
            }
        }
        /*
         * Il guasto si racconta ALLA FINE, dopo che ogni immersione salvabile è
         * stata consegnata a chi ascolta. Restituirlo prima — com'era — voleva
         * dire che un errore all'ultimo record buttava via anche i
         * precedenti.
         */
        Ok(EsitoEsterno { immersioni, guasto: coda_del_guasto })
    }

    /// I Mares che leggono il pacchetto intero con una `dc_iostream_read` sola.
    ///
    /// ════════════════════════════════════════════════════════════════════════
    /// ► PERCHÉ UN ELENCO DI CINQUE NOMI E NON UNA REGOLA. ◄
    ///
    /// Perché la regola sta in `mares_iconhd.c` e si chiama `ISSIRIUS`, ed è
    /// un elenco anche là: quattro numeri di modello, che nei descrittori di
    /// libdivecomputer diventano cinque nomi — il Puck 4 e il Puck Lite sono
    /// lo stesso apparecchio con due etichette. Riscriverla come «i modelli
    /// dopo il tale anno» sarebbe indovinare.
    ///
    /// Per questi cinque, e solo per questi, libdivecomputer NON apre il
    /// livello che rimette insieme i pacchetti (`dc_packet_open`): legge con
    /// una `dc_iostream_read` e si aspetta il pacchetto intero, dal `AA` al
    /// `EA`. Se l'MTU del telefono non lo fa stare in una notifica, il
    /// pacchetto arriva spezzato e viene rifiutato — quattro volte, poi si
    /// arrende. È misurato in
    /// `il_pacchetto_del_mares_deve_stare_in_una_notifica_sola`.
    ///
    /// Per tutti gli altri computer resta il comportamento di sempre, che per
    /// gli Uwatec non è un dettaglio ma un obbligo: unire due notifiche lì
    /// infilerebbe un byte di sequenza dentro i dati, in silenzio.
    ///
    /// `mares_ramoVariabile.test.ts` legge i sorgenti della libreria e
    /// controlla che questo elenco sia ancora quello giusto: se un domani
    /// libdivecomputer aggiungesse un modello a `ISSIRIUS`, quella prova
    /// diventa rossa prima che qualcuno se ne accorga con un computer in mano.
    const MARES_PACCHETTO_INTERO: [&str; 5] =
        ["Puck Air 2", "Sirius", "Quad Ci", "Puck 4", "Puck Lite"];

    /// Come vanno rimesse insieme le notifiche per questo computer.
    pub fn riassemblaggio_per(marca: &str, prodotto: &str) -> Riassemblaggio {
        if marca.eq_ignore_ascii_case("Mares")
            && MARES_PACCHETTO_INTERO.iter().any(|m| m.eq_ignore_ascii_case(prodotto))
        {
            Riassemblaggio::PacchettoIntero
        } else {
            Riassemblaggio::UnaNotifica
        }
    }

    /// Se uno scarico è in corso. Il plugin ha UN dispositivo collegato e
    /// UNA lista di ascoltatori: due scarichi insieme si iscriverebbero alla
    /// stessa caratteristica e si scollegherebbero a vicenda. Un doppio tocco
    /// sul pulsante deve trovare un «no» qui, non un ponte a metà.
    static SCARICO_IN_CORSO: AtomicBool = AtomicBool::new(false);

    /// Dove il thread dello scarico aspetta le sei cifre.
    ///
    /// ► PERCHÉ UNA VARIABILE GLOBALE, CHE È QUASI SEMPRE SBAGLIATA. ◄
    /// Perché la risposta non torna da dove è partita la domanda: la domanda
    /// esce come evento verso la finestra, la risposta rientra come comando
    /// Tauri, e fra i due non c'è nessun oggetto in comune da cui passare. La
    /// globale è lecita qui e solo qui perché **c'è al massimo uno scarico
    /// alla volta** — lo garantisce `SCARICO_IN_CORSO`, poche righe più su —
    /// quindi c'è al massimo una domanda in attesa.
    ///
    /// Fuori dall'attesa vale `None`, e un `rispondi_codice_pin` che arriva
    /// quando nessuno sta aspettando non fa niente: non è un errore, è una
    /// finestra chiusa un istante dopo la scadenza.
    pub static ATTESA_PIN: Mutex<Option<SyncSender<Option<String>>>> = Mutex::new(None);

    /// Quanto si aspetta che qualcuno legga sei cifre su uno schermo piccolo.
    ///
    /// Tre minuti, e non è generosità: il computer subacqueo mostra il PIN
    /// **dopo** essersi collegato, spesso in mano a chi lo ha appena tolto
    /// dal polso bagnato, e chi lo legge di solito non si aspettava che gli
    /// venisse chiesto niente. Il costo di un'attesa lunga è un'attesa lunga;
    /// il costo di una corta è ricominciare tutto il collegamento.
    ///
    /// Nelle prove è cortissima, perché una prova che aspetta tre minuti per
    /// vedere una scadenza insegna a non lanciare le prove.
    pub const ATTESA_PIN_MAX: Duration =
        // Nelle prove è più lunga del giro d'attesa che le prove stesse fanno
        // per vedere la busta: se fossero uguali, su una macchina carica la
        // scadenza scatterebbe prima della risposta e la prova diventerebbe
        // rossa per un motivo che non è quello sotto esame.
        if cfg!(test) { Duration::from_millis(800) } else { Duration::from_secs(180) };

    /// Chiede il PIN a chi guarda lo schermo, e blocca finché non risponde.
    ///
    /// **Gira sul thread dello scarico**, dentro la `ioctl` di
    /// libdivecomputer: qui il protocollo è fermo a metà di una stretta di
    /// mano, e resta fermo. Non c'è modo di fare altrimenti — il backend
    /// chiama `dc_iostream_ioctl` e vuole una risposta — ed è anche il
    /// momento giusto, perché è ora che il numero è sullo schermo.
    pub fn chiedi_pin_allinterfaccia(manda: &dyn Fn(EventoScarico)) -> Option<String> {
        let (rispondi, risposta) = std::sync::mpsc::sync_channel(1);
        match ATTESA_PIN.lock() {
            Ok(mut posto) => *posto = Some(rispondi),
            // Un lucchetto avvelenato qui vuol dire che un panico è passato
            // di là mentre qualcuno aspettava. Non si insiste: si rinuncia al
            // PIN, e lo scarico fallisce dicendolo, invece di aspettare tre
            // minuti una risposta che nessuno può più mandare.
            Err(_) => return None,
        }
        manda(EventoScarico::PinRequired);
        let esito = risposta.recv_timeout(ATTESA_PIN_MAX).unwrap_or(None);
        // La busta si toglie SEMPRE, anche dopo una scadenza: lasciarla lì
        // farebbe recapitare la risposta di stasera alla domanda di domani.
        if let Ok(mut posto) = ATTESA_PIN.lock() {
            *posto = None;
        }
        esito
    }

    /// La risposta dall'interfaccia. Vedi `ATTESA_PIN`.
    ///
    /// `None` è una rinuncia esplicita, ed è una risposta a tutti gli effetti:
    /// fa fallire lo scarico **subito**, invece di lasciarlo appeso fino alla
    /// scadenza. Per questo l'interfaccia deve chiamarla anche quando l'utente
    /// chiude la finestra.
    pub fn rispondi_pin(pin: Option<String>) {
        let busta = match ATTESA_PIN.lock() {
            Ok(mut posto) => posto.take(),
            Err(_) => None,
        };
        if let Some(busta) = busta {
            // Se il ricevente non c'è più — scadenza appena scattata — il
            // `send` fallisce, e va bene così: la risposta è arrivata tardi.
            let _ = busta.try_send(pin);
        }
    }

    /// Abbassa la bandierina quando lo scarico finisce, comunque finisca —
    /// anche per un `?` a metà strada.
    struct FineScarico;
    impl Drop for FineScarico {
        fn drop(&mut self) {
            SCARICO_IN_CORSO.store(false, Ordering::SeqCst);
        }
    }

    /// Il giro completo, come lo vede il comando.
    pub async fn scarica(
        app: tauri::AppHandle,
        dispositivo: String,
        nome: Option<String>,
        marca: String,
        prodotto: String,
        codice_accesso: Option<String>,
        tentativo: Option<usize>,
        metodo: Option<String>,
        segnalibro: Option<String>,
    ) -> Result<EsitoEsterno, String> {
        use tauri::Emitter;

        if SCARICO_IN_CORSO.swap(true, Ordering::SeqCst) {
            return Err("uno scarico è già in corso: aspetta che finisca prima di avviarne un altro".into());
        }
        let _fine = FineScarico;

        let manda = {
            let app = app.clone();
            move |evento: EventoScarico| {
                // Un evento che non parte non deve far fallire uno scarico: la
                // finestra può essersi chiusa mentre il computer parlava.
                let _ = app.emit(EVENTO, evento);
            }
        };
        manda(EventoScarico::Connecting);

        let antenna = AntennaBlec;
        let cronista: Cronista = {
            let manda = manda.clone();
            Arc::new(move |riga: String| manda(EventoScarico::Trace { line: riga }))
        };
        let scelta = SceltaMetodo {
            marca: marca.clone(),
            prodotto: prodotto.clone(),
            indice: tentativo,
            chiave: metodo,
        };
        let ponte = match apri_ponte(antenna, &dispositivo, nome.as_deref(), cronista, &scelta).await {
            Ok(ponte) => ponte,
            Err(motivo) => {
                /*
                 * Anche qui ci si scollega: il collegamento è già in piedi
                 * quando la scelta del profilo o l'iscrizione falliscono, e
                 * prima restava in piedi — con il computer sveglio e, su
                 * alcuni firmware, il tentativo successivo che trovava la
                 * porta occupata. È lo stesso «SEMPRE» di sotto, applicato
                 * anche all'apertura.
                 */
                if let Err(scollegamento) = antenna.scollega().await {
                    manda(EventoScarico::Trace { line: format!("scollegamento: {scollegamento}") });
                }
                return Err(motivo);
            }
        };

        /*
         * ► L'ACCOPPIAMENTO: il PIN da chiedere e la chiave da conservare. ◄
         *
         * Un codice illeggibile NON è un errore da mostrare: si riparte dal
         * PIN, che funziona sempre, e la riga nel diario dice che è successo.
         * L'alternativa — fermare lo scarico perché una preferenza è storta —
         * bloccherebbe una persona su un dato che può cancellare solo
         * disinstallando.
         */
        let codice = match codice_accesso.as_deref() {
            None => None,
            Some(testo) => match da_esadecimale(testo) {
                Some(byte) => Some(byte),
                None => {
                    manda(EventoScarico::Trace {
                        line: "il codice di accesso conservato non si legge: si riparte dal PIN".into(),
                    });
                    None
                }
            },
        };
        /*
         * Il segnalibro arriva in esadecimale come il codice d'accesso, e come
         * quello un testo illeggibile **non ferma niente**: si scarica tutto,
         * che è quello che si faceva prima che il segnalibro esistesse. *Un
         * dato di comodo che diventa un errore bloccante trasforma un
         * miglioramento in una regressione.*
         */
        let segnalibro_byte = match segnalibro.as_deref() {
            None => Vec::new(),
            Some(testo) => match da_esadecimale(testo) {
                Some(byte) => byte,
                None => {
                    manda(EventoScarico::Trace {
                        line: "il segnalibro conservato non si legge: si scarica tutto".into(),
                    });
                    Vec::new()
                }
            },
        };
        let ponte = {
            let per_pin = manda.clone();
            let per_codice = manda.clone();
            ponte.con_segreti(
                Box::new(move || chiedi_pin_allinterfaccia(&per_pin)),
                codice,
                Box::new(move |codice: &[u8]| {
                    per_codice(EventoScarico::AccessCode { hex: in_esadecimale(codice) })
                }),
            )
        };

        /*
         * IL CRONISTA DELL'AVANZAMENTO: un thread che ogni mezzo secondo dice
         * quanti byte sono arrivati.
         *
         * Serve perché lo scarico di questi protocolli è un blocco unico che
         * dura minuti: senza, l'interfaccia resterebbe ferma su «Leggo…» dal
         * primo comando all'ultimo, e un'applicazione ferma che non dice niente
         * è indistinguibile da una bloccata. È la differenza fra aspettare e
         * riavviare. Il numero di immersioni non si sa prima — lo si scopre
         * tagliando la memoria sui marcatori — quindi `total` resta assente,
         * che è la verità.
         */
        manda(EventoScarico::Method {
            index: ponte.metodo_indice + 1,
            total: ponte.metodi_totali,
            name: ponte.metodo.nome.clone(),
            key: ponte.metodo.chiave(),
        });

        let ricevuti = ponte.ricevuti.clone();
        let scollegamento_voluto = ponte.scollegamento_voluto.clone();
        let finito = Arc::new(AtomicBool::new(false));
        {
            let finito = finito.clone();
            let manda = manda.clone();
            /*
             * Non se ne aspetta la fine, e non è distrazione: aspettarla
             * significherebbe bloccare un thread del runtime per il mezzo
             * secondo del sonno, che è esattamente la cosa che tutto questo file
             * esiste per non fare. Il thread guarda la bandierina e finisce da
             * sé; al massimo manda un ultimo avanzamento in ritardo, che non fa
             * male a nessuno.
             */
            std::thread::spawn(move || {
                let mut ultimo = usize::MAX;
                while !finito.load(Ordering::Relaxed) {
                    std::thread::sleep(RITMO_AVANZAMENTO);
                    let ora = ricevuti.load(Ordering::Relaxed);
                    // Solo quando cambia: una barra che si aggiorna senza
                    // muoversi è rumore, e nasconde il caso in cui si è fermata.
                    if ora != ultimo {
                        ultimo = ora;
                        manda(EventoScarico::Progress {
                            done: ora,
                            total: None,
                            label: "byte ricevuti dal computer".into(),
                        });
                    }
                }
            });
        }

        /*
         * Lo scarico su un thread suo, e il risultato che torna da un canale.
         *
         * `spawn_blocking` avrebbe fatto quasi la stessa cosa, ma «quasi»: i
         * thread di quel pool sono del runtime, hanno un numero massimo e
         * vengono riusati. Uno scarico che dura minuti ne occuperebbe uno per
         * tutto quel tempo, e chi tiene un pool occupato per minuti prima o poi
         * lo esaurisce. Un thread nostro nasce, blocca quanto vuole e muore.
         */
        let (esito_va, mut esito_viene) =
            tauri::async_runtime::channel::<Result<EsitoEsterno, String>>(1);
        let manda_dal_thread = manda.clone();
        std::thread::spawn(move || {
            let esito = scarica_bloccante(&manda_dal_thread, ponte, &marca, &prodotto, &segnalibro_byte);
            let _ = esito_va.blocking_send(esito);
        });

        let esito = esito_viene
            .recv()
            .await
            .unwrap_or_else(|| Err("lo scarico è finito senza dire come".into()));

        finito.store(true, Ordering::Relaxed);

        /*
         * Ci si scollega SEMPRE, anche quando è andata male. Un collegamento
         * dimenticato tiene il computer subacqueo sveglio finché ha batteria, e
         * su alcuni firmware impedisce il tentativo successivo. La bandierina
         * si alza PRIMA: la callback di caduta scatta anche per uno
         * scollegamento nostro, e non deve raccontarlo come una caduta.
         */
        scollegamento_voluto.store(true, Ordering::SeqCst);
        if let Err(motivo) = antenna.scollega().await {
            manda(EventoScarico::Trace { line: format!("scollegamento: {motivo}") });
        }

        esito
    }
}

// ------------------------------------------------------------------ il comando

/*
 * PERCHÉ DUE DEFINIZIONI E NON UNA CON UN `cfg` DENTRO.
 *
 * `tauri::generate_handler!` non accetta attributi sulle voci del suo elenco:
 * non si può scrivere `#[cfg(feature = "…")] ponte_blec::scarica_…` in mezzo
 * agli altri comandi. Le alternative erano duplicare i quattro elenchi di
 * comandi — che divergerebbero al primo comando aggiunto distrattamente — o
 * tenere il comando sempre registrato e cambiare quello che risponde. È la
 * seconda, ed è la stessa scelta già fatta per `elenca_computer_supportati`:
 * senza la funzionalità il comando esiste e dichiara di non poter fare niente,
 * invece di sparire e far fallire l'interfaccia con «comando sconosciuto», che
 * è un messaggio che non spiega nulla a nessuno.
 */

/// Scarica le immersioni da un computer che parla un protocollo di libdivecomputer.
///
/// `dispositivo` è l'identificativo del sistema operativo — su Apple un UUID che
/// vale solo per questa macchina e questa installazione, vedi `BleFoundDevice.id`
/// — `nome` è quello visto in scansione (serve a libdivecomputer per gli
/// Oceanic, che ci leggono dentro il numero di serie), mentre `marca` e
/// `prodotto` sono quelli scelti dall'elenco di `elenca_computer_supportati`,
/// cioè le stesse due stringhe che libdivecomputer usa per i suoi descrittori.
///
/// L'avanzamento arriva dall'evento `scarico-esterno`, con le parole di
/// `DownloadEvent`.
#[cfg(feature = "computer-esterni")]
#[tauri::command]
pub async fn scarica_da_computer_esterno(
    app: tauri::AppHandle,
    dispositivo: String,
    nome: Option<String>,
    marca: String,
    prodotto: String,
    codice_accesso: Option<String>,
    tentativo: Option<usize>,
    metodo: Option<String>,
    segnalibro: Option<String>,
) -> Result<dentro::EsitoEsterno, String> {
    dentro::scarica(
        app, dispositivo, nome, marca, prodotto, codice_accesso, tentativo, metodo, segnalibro,
    )
    .await
}

/// La risposta alla richiesta del PIN, dall'interfaccia.
///
/// Va chiamata **anche quando la persona rinuncia**, con `null`: senza, lo
/// scarico resta fermo dentro la `ioctl` fino alla scadenza di tre minuti, e
/// un'applicazione che non risponde per tre minuti è un'applicazione rotta,
/// qualunque cosa stia facendo davvero.
///
/// Non restituisce niente e non fallisce mai: una risposta che arriva quando
/// nessuno aspetta più — la finestra chiusa un istante dopo la scadenza — non
/// è un errore da mostrare a nessuno.
#[cfg(feature = "computer-esterni")]
#[tauri::command]
pub fn rispondi_codice_pin(pin: Option<String>) {
    dentro::rispondi_pin(pin);
}

/// Lo stesso comando in una copia compilata senza `computer-esterni`.
///
/// Non c'è nessuno scarico che possa aspettare un PIN, quindi non fa niente —
/// e non fa niente in silenzio, perché il comando non viene mai chiamato se
/// l'evento che lo provoca non è mai stato emesso.
#[cfg(not(feature = "computer-esterni"))]
#[tauri::command]
pub fn rispondi_codice_pin(_pin: Option<String>) {}

/// Lo stesso comando in una copia compilata senza `computer-esterni`.
///
/// Dice di no, e dice perché. È la risposta vera: questa copia non ha dentro
/// libdivecomputer, quindi non c'è nessun protocollo in più da parlare.
#[cfg(not(feature = "computer-esterni"))]
#[tauri::command]
pub async fn scarica_da_computer_esterno(
    _dispositivo: String,
    _nome: Option<String>,
    _marca: String,
    _prodotto: String,
    _codice_accesso: Option<String>,
    _tentativo: Option<usize>,
    _metodo: Option<String>,
    _segnalibro: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    Err("questa copia dell’applicazione è stata compilata senza libdivecomputer: \
sa parlare solo con i computer dei driver scritti in casa"
        .into())
}

// -------------------------------------------------------------------- prove

/// Le prove del ponte, contro un'antenna finta.
///
/// NIENTE BLUETOOTH, e non è una rinuncia: è il motivo per cui `AntennaBle`
/// esiste. Quello che qui si può inchiodare è tutto quello che sta fra il
/// plugin e `FlussoBle` — che i byte scritti arrivino a destinazione, che le
/// notifiche finiscano nel canale nell'ordine giusto e intere, che un
/// collegamento caduto diventi un errore leggibile invece di un'attesa muta,
/// che la scelta del servizio faccia quello che dice di fare, che la
/// negoziazione della modalità cambi quando deve e SOLO quando deve, che i
/// crediti partano prima dei dati, e che il diario racconti lo scambio. Resta
/// fuori solo l'ultimo miglio, che ha bisogno di un computer subacqueo acceso.
///
/// **Il finto vive nel modello di `FintoAladin`** di `trasporto_ldc.rs`: uno
/// stato condiviso che si può interrogare dopo, e che si comporta come il vero
/// nei punti in cui il vero è scomodo.
#[cfg(all(test, feature = "computer-esterni"))]
mod prove {
    use super::dentro::*;
    use crate::trasporto_ldc::{
        AccessoriBle, FlussoBle, FlussoByte, GuastoScrittura, Riassemblaggio, Ripiego,
    };
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// Una caratteristica finta, in una riga.
    fn car(uuid: &str, scrivibile: bool, senza_risposta: bool, notifica: bool) -> CaratteristicaVista {
        CaratteristicaVista {
            uuid: uuid.to_string(),
            scrivibile,
            scrivibile_senza_risposta: senza_risposta,
            notifica,
        }
    }

    const SCRIVI: &str = "11111111-0000-1000-8000-00805f9b34fb";
    const ASCOLTA: &str = "22222222-0000-1000-8000-00805f9b34fb";

    /// Un servizio «seriale su BLE» come lo espone mezzo mondo: una
    /// caratteristica su cui si scrive (in entrambi i modi), una che notifica.
    fn seriale(servizio: &str) -> ServizioVisto {
        ServizioVisto {
            uuid: servizio.to_string(),
            caratteristiche: vec![car(SCRIVI, true, true, false), car(ASCOLTA, false, false, true)],
        }
    }

    /// Una seriale la cui caratteristica di scrittura accetta UNA modalità sola.
    fn seriale_rigida(servizio: &str, senza_risposta: bool) -> ServizioVisto {
        ServizioVisto {
            uuid: servizio.to_string(),
            caratteristiche: vec![
                car(SCRIVI, !senza_risposta, senza_risposta, false),
                car(ASCOLTA, false, false, true),
            ],
        }
    }

    /// Il servizio «informazioni sul dispositivo»: si legge e basta.
    fn informativo() -> ServizioVisto {
        ServizioVisto {
            uuid: "0000180a-0000-1000-8000-00805f9b34fb".to_string(),
            caratteristiche: vec![car("00002a29-0000-1000-8000-00805f9b34fb", false, false, false)],
        }
    }

    const TELIT: &str = "0000fefb-0000-1000-8000-00805f9b34fb";
    const TELIT_DATI_RX: &str = "00000001-0000-1000-8000-008025000000";
    const TELIT_DATI_TX: &str = "00000002-0000-1000-8000-008025000000";
    const TELIT_CREDITI_RX: &str = "00000003-0000-1000-8000-008025000000";
    const TELIT_CREDITI_TX: &str = "00000004-0000-1000-8000-008025000000";

    /// Il Terminal I/O di Telit come lo espone un OSTC.
    fn telit() -> ServizioVisto {
        ServizioVisto {
            uuid: TELIT.to_string(),
            caratteristiche: vec![
                car(TELIT_DATI_RX, true, true, false),
                car(TELIT_DATI_TX, false, false, true),
                car(TELIT_CREDITI_RX, true, false, false),
                car(TELIT_CREDITI_TX, false, false, true),
            ],
        }
    }

    // ------------------------------------------------------- l'antenna finta

    /// La callback delle notifiche, come il ponte la consegna.
    type Ascoltatore = Box<dyn Fn(Vec<u8>) + Send + Sync>;

    /// Una scrittura come l'ha vista il dispositivo.
    #[derive(Clone, Debug, PartialEq)]
    struct Scritta {
        caratteristica: String,
        modo: ModoScrittura,
        dati: Vec<u8>,
    }

    struct Interno {
        servizi: Vec<ServizioVisto>,
        nome: String,
        /// Tutto quello che è stato scritto, in ordine, una voce per scrittura come lo
        /// riceverebbe il dispositivo.
        scritte: Mutex<Vec<Scritta>>,
        /// Dove versare le notifiche, per caratteristica, appena qualcuno si iscrive.
        ascoltatori: Mutex<HashMap<String, Ascoltatore>>,
        /// L'ordine in cui ci si è iscritti: i crediti vogliono un ordine preciso.
        iscrizioni: Mutex<Vec<String>>,
        /// Cosa chiamare per far cadere il collegamento.
        caduta: Mutex<Option<Box<dyn FnOnce() + Send>>>,
        scollegata: AtomicBool,
        /// Se acceso, ogni scrittura fallisce: è il computer che non c'è più.
        scrittura_guasta: AtomicBool,
        /// La modalità che il dispositivo rifiuta, come farebbe Android o BlueZ.
        rifiuta: Mutex<Option<ModoScrittura>>,
        /// Se acceso, la prossima scrittura non risponde mai: è il plugin che
        /// si impianta, e la conferma che non arriva.
        muta: AtomicBool,
        /// I valori delle caratteristiche leggibili.
        valori: Mutex<HashMap<String, Vec<u8>>>,
        /// Quanti `collega` devono fallire prima che uno riesca.
        ///
        /// È il guasto vero del 9 settembre 2026: *«Timeout during execution of
        /// Connect»*, e il tentativo dopo — stessa persona, stesso
        /// apparecchio — si collega in sessanta millisecondi.
        collegamenti_da_fallire: AtomicUsize,
        /// Quante volte `collega` è stato chiamato, riuscito o no.
        collegamenti_chiesti: AtomicUsize,
        /// Quante volte è stato chiesto di scollegarsi.
        scollegamenti: AtomicUsize,
        /// Quante volte l'elenco dei servizi deve tornare VUOTO prima di
        /// riempirsi: su iOS la scoperta può non essere ancora finita.
        servizi_vuoti_allinizio: AtomicUsize,
    }

    #[derive(Clone)]
    struct FintaAntenna(Arc<Interno>);

    impl FintaAntenna {
        fn con(servizi: Vec<ServizioVisto>) -> Self {
            Self(Arc::new(Interno {
                servizi,
                nome: "FQ001124".into(),
                scritte: Mutex::new(Vec::new()),
                ascoltatori: Mutex::new(HashMap::new()),
                iscrizioni: Mutex::new(Vec::new()),
                caduta: Mutex::new(None),
                scollegata: AtomicBool::new(false),
                scrittura_guasta: AtomicBool::new(false),
                rifiuta: Mutex::new(None),
                muta: AtomicBool::new(false),
                valori: Mutex::new(HashMap::new()),
                collegamenti_da_fallire: AtomicUsize::new(0),
                collegamenti_chiesti: AtomicUsize::new(0),
                scollegamenti: AtomicUsize::new(0),
                servizi_vuoti_allinizio: AtomicUsize::new(0),
            }))
        }

        /// Fallisce i primi `quanti` collegamenti, poi si comporta bene.
        fn che_non_si_collega(self, quanti: usize) -> Self {
            self.0.collegamenti_da_fallire.store(quanti, Ordering::SeqCst);
            self
        }

        /// Le prime `quante` richieste di servizi tornano vuote.
        fn coi_servizi_in_ritardo(self, quante: usize) -> Self {
            self.0.servizi_vuoti_allinizio.store(quante, Ordering::SeqCst);
            self
        }

        fn che_rifiuta(self, modo: ModoScrittura) -> Self {
            *self.0.rifiuta.lock().unwrap() = Some(modo);
            self
        }

        fn con_valore(self, caratteristica: &str, valore: &[u8]) -> Self {
            self.0.valori.lock().unwrap().insert(caratteristica.to_lowercase(), valore.to_vec());
            self
        }

        /// Manda una notifica dalla caratteristica detta, come farebbe il dispositivo.
        fn notifica_da(&self, caratteristica: &str, dati: &[u8]) {
            let presa = self.0.ascoltatori.lock().unwrap();
            let callback = presa
                .get(&caratteristica.to_lowercase())
                .unwrap_or_else(|| panic!("nessuno si è iscritto a {caratteristica}"));
            callback(dati.to_vec());
        }

        /// Manda una notifica dalla caratteristica di ascolto di una seriale.
        fn notifica(&self, dati: &[u8]) {
            self.notifica_da(ASCOLTA, dati);
        }

        /// Il collegamento cade da sé, a metà scarico.
        fn fai_cadere(&self) {
            self.0.scrittura_guasta.store(true, Ordering::SeqCst);
            if let Some(caduta) = self.0.caduta.lock().unwrap().take() {
                caduta();
            }
        }

        fn scritte(&self) -> Vec<Scritta> {
            self.0.scritte.lock().unwrap().clone()
        }

        /// Solo i byte, per le prove a cui la modalità non interessa.
        fn scritti(&self) -> Vec<Vec<u8>> {
            self.scritte().into_iter().map(|s| s.dati).collect()
        }

        fn iscrizioni(&self) -> Vec<String> {
            self.0.iscrizioni.lock().unwrap().clone()
        }
    }

    impl AntennaBle for FintaAntenna {
        async fn collega(
            &self,
            _dispositivo: String,
            caduta: Box<dyn FnOnce() + Send>,
        ) -> Result<(), String> {
            self.0.collegamenti_chiesti.fetch_add(1, Ordering::SeqCst);
            if self
                .0
                .collegamenti_da_fallire
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |q| q.checked_sub(1))
                .is_ok()
            {
                return Err("Timeout during execution of Connect".into());
            }
            *self.0.caduta.lock().unwrap() = Some(caduta);
            Ok(())
        }

        async fn servizi(&self, _dispositivo: String) -> Result<Vec<ServizioVisto>, String> {
            if self
                .0
                .servizi_vuoti_allinizio
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |q| q.checked_sub(1))
                .is_ok()
            {
                return Ok(Vec::new());
            }
            Ok(self.0.servizi.clone())
        }

        async fn nome(&self, _dispositivo: String) -> Result<String, String> {
            Ok(self.0.nome.clone())
        }

        async fn iscrivi(
            &self,
            _servizio: String,
            caratteristica: String,
            arrivata: Box<dyn Fn(Vec<u8>) + Send + Sync>,
        ) -> Result<(), String> {
            self.0.iscrizioni.lock().unwrap().push(caratteristica.to_lowercase());
            self.0.ascoltatori.lock().unwrap().insert(caratteristica.to_lowercase(), arrivata);
            Ok(())
        }

        async fn scrivi(
            &self,
            _servizio: String,
            caratteristica: String,
            dati: Vec<u8>,
            modo: ModoScrittura,
        ) -> Result<(), String> {
            // Un collegamento caduto non accetta più scritture, e lo dice: è la
            // metà in scrittura del guasto che la prova qui sotto verifica.
            if self.0.scrittura_guasta.load(Ordering::SeqCst) {
                return Err("il dispositivo non è più raggiungibile".into());
            }
            if *self.0.rifiuta.lock().unwrap() == Some(modo) {
                return Err(format!("il dispositivo rifiuta le scritture {:?}", modo));
            }
            if self.0.muta.swap(false, Ordering::SeqCst) {
                // Una scrittura che non torna mai: si aspetta più della
                // pazienza del postino, poi si registra comunque, perché nel
                // mondo vero il plugin la consegna in ritardo.
                std::thread::sleep(Duration::from_millis(600));
            }
            self.0.scritte.lock().unwrap().push(Scritta { caratteristica, modo, dati });
            Ok(())
        }

        async fn leggi(&self, caratteristica: String) -> Result<Vec<u8>, String> {
            self.0
                .valori
                .lock()
                .unwrap()
                .get(&caratteristica.to_lowercase())
                .cloned()
                .ok_or_else(|| format!("la caratteristica {caratteristica} non si legge"))
        }

        async fn scollega(&self) -> Result<(), String> {
            self.0.scollegamenti.fetch_add(1, Ordering::SeqCst);
            self.0.scollegata.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    /// Il diario raccolto dalle prove: ogni riga che il ponte racconta.
    #[derive(Clone, Default)]
    struct Diario(Arc<Mutex<Vec<String>>>);

    impl Diario {
        fn cronista(&self) -> Cronista {
            let righe = self.0.clone();
            Arc::new(move |riga: String| righe.lock().unwrap().push(riga))
        }

        fn righe(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }

        fn contiene(&self, pezzo: &str) -> bool {
            self.righe().iter().any(|r| r.contains(pezzo))
        }

        fn testo(&self) -> String {
            self.righe().join("\n")
        }
    }

    /// Apre il ponte dal thread della prova.
    ///
    /// **`block_on` sta QUI e non nel codice.** Aprire è asincrono e non blocca
    /// niente; quello che segue — scrivere, leggere — va fatto FUORI dal
    /// `block_on`, cioè sul thread della prova, che è il posto del thread dello
    /// scarico. Chiamare la chiusura di scrittura da dentro il runtime andrebbe
    /// in panico, ed è esattamente la disciplina che il codice vero rispetta.
    fn apri(antenna: &FintaAntenna) -> (PonteBle, Diario) {
        let diario = Diario::default();
        let ponte = tauri::async_runtime::block_on(apri_ponte(antenna.clone(), "finto-01", None, diario.cronista(), &SceltaMetodo::default()))
            .expect("il ponte deve aprirsi");
        (ponte, diario)
    }

    /// Prova ad aprire il ponte e restituisce l'esito, senza pretendere che vada.
    fn prova_ad_aprire(antenna: &FintaAntenna) -> (Result<PonteBle, String>, Diario) {
        let diario = Diario::default();
        let esito = tauri::async_runtime::block_on(apri_ponte(
            antenna.clone(),
            "finto-01",
            None,
            diario.cronista(),
            &SceltaMetodo::default(),
        ));
        (esito, diario)
    }

    #[test]
    fn un_collegamento_che_scade_si_riprova_dopo_aver_scollegato() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL PRIMO GUASTO DEL DIARIO DEL 9 SETTEMBRE 2026. ◄
         *
         * «collegamento non riuscito: Timeout during execution of Connect»,
         * zero immersioni — e il tentativo dopo, stessa persona con lo stesso
         * apparecchio, si è collegato in sessanta millisecondi. Non era rotto
         * niente: era andata male una volta, e l'applicazione si arrendeva.
         *
         * ► E LA RIGA CHE CONTA NON È «RIPROVA»: È «SCOLLEGA PRIMA». ◄ Su BLE
         * un `connect` che scade lascia quasi sempre un collegamento a metà, e
         * il tentativo dopo trova la porta presa. Senza lo scollegamento in
         * mezzo, insistere sarebbe soltanto sbagliare più volte — che è quello
         * che il proprietario ha chiesto di NON fare quando ha detto che il
         * tentativo dopo deve avere più probabilità di funzionare, non solo
         * raccogliere altri dati.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")])
            .che_non_si_collega(2);
        let (esito, diario) = prova_ad_aprire(&antenna);
        assert!(esito.is_ok(), "al terzo tentativo il ponte deve aprirsi");
        assert_eq!(antenna.0.collegamenti_chiesti.load(Ordering::SeqCst), 3);
        assert_eq!(
            antenna.0.scollegamenti.load(Ordering::SeqCst),
            2,
            "fra un tentativo e l'altro si scollega davvero, o si ritenta sulla porta occupata"
        );
        assert!(diario.contiene("collegamento riuscito al tentativo n. 3"), "{}", diario.testo());
        assert!(diario.contiene("scollego e riprovo"), "{}", diario.testo());
    }

    #[test]
    fn dopo_tutti_i_tentativi_il_collegamento_si_arrende_dicendo_quanti_ne_ha_fatti() {
        // Un computer spento non si accende a furia di insistere, e chi legge
        // deve poter distinguere «ci ho provato una volta» da «ci ho provato
        // tre volte»: senza il numero, la stessa riga descrive due mondi.
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")])
            .che_non_si_collega(99);
        let (esito, _diario) = prova_ad_aprire(&antenna);
        let Err(errore) = esito else {
            panic!("con il computer spento non si apre niente");
        };
        assert!(errore.contains("dopo 3 tentativi"), "{errore}");
        assert!(errore.contains("Timeout during execution of Connect"), "{errore}");
        assert_eq!(antenna.0.collegamenti_chiesti.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn un_elenco_di_servizi_vuoto_si_richiede_invece_di_arrendersi() {
        /*
         * Su iOS la scoperta dei servizi può non essere finita nei primi
         * istanti dopo il collegamento. Un elenco vuoto lì non vuol dire
         * «questo apparecchio non ha servizi»: vuol dire «non li ho ancora».
         *
         * La differenza pesa perché `risolvi_profilo` su un elenco vuoto si
         * rifiuta, con un messaggio che manda chi ripara a cercare il guasto
         * dalla parte sbagliata — «nessun candidato» su un computer che i
         * servizi ce li ha eccome.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")])
            .coi_servizi_in_ritardo(2);
        let (esito, diario) = prova_ad_aprire(&antenna);
        assert!(esito.is_ok(), "i servizi arrivano al terzo giro");
        assert!(diario.contiene("i servizi sono comparsi alla richiesta n. 3"), "{}", diario.testo());
    }

    #[test]
    fn un_collegamento_riuscito_al_primo_colpo_non_racconta_niente() {
        // Il caso normale è la stragrande maggioranza degli scarichi, e non
        // deve pagare niente: né un'attesa, né una riga di diario che
        // suggerisce un problema che non c'è stato.
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (esito, diario) = prova_ad_aprire(&antenna);
        assert!(esito.is_ok());
        assert_eq!(antenna.0.collegamenti_chiesti.load(Ordering::SeqCst), 1);
        assert_eq!(antenna.0.scollegamenti.load(Ordering::SeqCst), 0);
        assert!(!diario.contiene("tentativo n."), "{}", diario.testo());
        assert!(!diario.contiene("i servizi sono comparsi"), "{}", diario.testo());
    }

    /// Il ponte già dentro un `FlussoBle` completo, come nello scarico vero.
    fn apri_flusso(antenna: &FintaAntenna) -> (FlussoBle, Diario, Box<dyn Fn() -> String + Send + Sync>) {
        let (ponte, diario) = apri(antenna);
        let PonteBle { entrata, scrittura, accessori, su_silenzio, riassunto, .. } = ponte;
        (FlussoBle::nuovo(entrata, scrittura).con_accessori(accessori, su_silenzio), diario, riassunto)
    }

    // -------------------------------------------------------------- il ponte

    // ------------------------------------------------- il giro dei tentativi

    /// I nomi dei tentativi, che è quello che vede chi preme il pulsante.
    fn nomi(tentativi: &[Tentativo]) -> Vec<String> {
        tentativi.iter().map(|t| t.nome.clone()).collect()
    }

    #[test]
    fn il_primo_tentativo_e_esattamente_quello_che_si_faceva_prima() {
        /*
         * ► LA PROVA CHE PROTEGGE DAL PEGGIO CHE QUESTO GIRO POSSA FARE. ◄
         *
         * Il giro esiste per aggiungere tentativi DOPO il primo. Se cambiasse
         * anche il primo, ogni computer che oggi funziona — il Peregrine, gli
         * Aladin, i Mares che scaricano — comincerebbe da una combinazione
         * diversa da quella con cui è stato provato con l'apparecchio in mano.
         * Sarebbe una regressione silenziosa su tutto quello che va, pagata
         * per far funzionare quello che non va.
         */
        let servizi = vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")];
        let profilo = risolvi_profilo(&servizi).unwrap();
        let tentativi = elenca_tentativi(&servizi, "Shearwater", "Peregrine").unwrap();

        assert_eq!(tentativi[0].servizio, profilo.servizio);
        assert_eq!(tentativi[0].scrittura, profilo.scrittura);
        assert_eq!(tentativi[0].notifica, profilo.notifica);
        assert_eq!(tentativi[0].modo, profilo.modo);
        assert_eq!(tentativi[0].descrizione, profilo.descrizione);
        // E il riassemblaggio è quello deciso per il modello, non un altro.
        assert_eq!(
            tentativi[0].riassemblaggio,
            riassemblaggio_per("Shearwater", "Peregrine")
        );
        // Il ripiego sul silenzio resta acceso SOLO nel primo: dal secondo in
        // poi la modalità è dichiarata, e lasciarla ribaltare renderebbe
        // impossibile dire quale combinazione ha vinto.
        assert_eq!(tentativi[0].alternativa, profilo.alternativa);
        assert!(tentativi[1..].iter().all(|t| t.alternativa.is_none()));
    }

    #[test]
    fn i_tentativi_variano_prima_quello_che_non_costa_una_riconnessione() {
        /*
         * L'ordine non è di eleganza: è il costo per chi ha il computer in
         * mano e la batteria che cala. Modalità di scrittura e riassemblaggio
         * si cambiano senza riconnettere; una caratteristica diversa no.
         */
        let servizi = vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")];
        let tentativi = elenca_tentativi(&servizi, "Shearwater", "Peregrine").unwrap();
        assert_eq!(
            nomi(&tentativi),
            vec![
                "senza conferma, notifiche una per volta",
                "senza conferma, notifiche unite",
                "con conferma, notifiche una per volta",
                "con conferma, notifiche unite",
            ],
            "quattro combinazioni, e nessuna ripetuta"
        );
        // Tutte sullo stesso servizio e sulle stesse caratteristiche: il
        // servizio è uno solo, non c'è altro da variare.
        assert!(tentativi.iter().all(|t| t.servizio == "fe25c237-0ece-443c-b0aa-e02033e7029d"));
    }

    #[test]
    fn una_caratteristica_che_accetta_una_modalita_sola_non_genera_laltra() {
        /*
         * Provare una modalità che il GATT non dichiara non è un tentativo: è
         * una scrittura che il plugin rifiuta prima di partire. Sarebbe un
         * pulsante premuto per niente, e una riga di diario che manda a
         * cercare dalla parte sbagliata.
         */
        let servizi = vec![informativo(), seriale_rigida("fe25c237-0ece-443c-b0aa-e02033e7029d", true)];
        let tentativi = elenca_tentativi(&servizi, "Shearwater", "Peregrine").unwrap();
        assert_eq!(
            nomi(&tentativi),
            vec!["senza conferma, notifiche una per volta", "senza conferma, notifiche unite"],
        );
    }

    #[test]
    fn per_il_mares_il_primo_tentativo_ha_le_notifiche_unite_e_il_secondo_no() {
        /*
         * ► IL CASO PER CUI TUTTO QUESTO È NATO. ◄ Il Quad Ci del centro sub.
         * Il primo tentativo porta la scelta fatta leggendo `mares_iconhd.c`
         * — notifiche unite — e il secondo prova esattamente il contrario,
         * perché quella scelta è un'ipotesi mia su un computer che non ho mai
         * avuto in mano, e un'ipotesi sbagliata deve avere una via d'uscita.
         */
        let servizi = vec![informativo(), seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")];
        let tentativi = elenca_tentativi(&servizi, "Mares", "Quad Ci").unwrap();
        assert_eq!(tentativi[0].riassemblaggio, Riassemblaggio::PacchettoIntero);
        assert_eq!(tentativi[1].riassemblaggio, Riassemblaggio::UnaNotifica);
        assert_eq!(tentativi[0].modo, tentativi[1].modo, "prima si cambia una cosa sola");

        // E su un computer che NON è di quei cinque, il primo tentativo tiene
        // le notifiche separate: unirle è l'eccezione, non il contrario.
        let altri = vec![informativo(), seriale("fdcdeaaa-295d-470e-bf15-04217b7aa0a0")];
        let tentativi = elenca_tentativi(&altri, "Scubapro", "Aladin Sport Matrix").unwrap();
        assert_eq!(tentativi[0].riassemblaggio, Riassemblaggio::UnaNotifica);
    }

    #[test]
    fn le_altre_caratteristiche_arrivano_dopo_e_gli_altri_servizi_per_ultimi() {
        /*
         * Un servizio noto con DUE caratteristiche scrivibili, più un secondo
         * servizio che ha la forma di una seriale e che nessun profilo
         * conosce. L'ordine deve essere: tutte le combinazioni del servizio
         * noto, poi l'ipotesi sull'altro.
         */
        let noto = ServizioVisto {
            uuid: "fe25c237-0ece-443c-b0aa-e02033e7029d".to_string(),
            caratteristiche: vec![
                car(SCRIVI, true, true, false),
                car("33333333-0000-1000-8000-00805f9b34fb", true, true, false),
                car(ASCOLTA, false, false, true),
            ],
        };
        let servizi = vec![informativo(), noto, seriale("0000abcd-0000-1000-8000-00805f9b34fb")];
        let tentativi = elenca_tentativi(&servizi, "Shearwater", "Peregrine").unwrap();

        // Le prime quattro sono la prima caratteristica; poi la seconda.
        assert!(tentativi[..4].iter().all(|t| t.scrittura == SCRIVI), "{:?}", nomi(&tentativi));
        assert_eq!(tentativi[4].scrittura, "33333333-0000-1000-8000-00805f9b34fb");
        assert!(
            tentativi[4].descrizione.contains("servizio noto con più di una candidata"),
            "{}",
            tentativi[4].descrizione
        );

        // E il servizio sconosciuto, se ci arriva, si dichiara per quello che
        // è: un'ipotesi. Mai in mezzo alle combinazioni di quello noto.
        let primo_ipotesi = tentativi.iter().position(|t| t.descrizione.contains("IPOTESI"));
        if let Some(i) = primo_ipotesi {
            assert!(
                tentativi[..i].iter().all(|t| t.servizio == "fe25c237-0ece-443c-b0aa-e02033e7029d"),
                "le ipotesi vanno in fondo"
            );
        }
    }

    #[test]
    fn dove_prima_ci_si_rifiutava_adesso_si_prova() {
        /*
         * ► IL GUADAGNO PIÙ GRANDE DI TUTTO IL GIRO, ED È FACILE NON VEDERLO. ◄
         *
         * `risolvi_profilo` si RIFIUTA quando dentro un servizio ci sono due
         * caratteristiche scrivibili: «va scelta a mano nella tabella dei
         * profili, invece di indovinare». Era la scelta giusta finché
         * indovinare voleva dire scommettere una volta sola e in silenzio.
         *
         * Con un giro di tentativi non è più una scommessa: si provano una per
         * una, ognuna dichiarata nel diario, e chi ha il computer in mano
         * scopre in due tocchi quale funziona. Il rifiuto diventava un vicolo
         * cieco — «aggiungi il servizio giusto alla tabella» non è una cosa
         * che possa fare chi sta su una barca.
         */
        /*
         * Il servizio è quello della famiglia Peregrine, che sta nella TABELLA
         * dei profili: è lì che il rifiuto scatta. Per i servizi dell'elenco
         * di Subsurface la regola è un'altra — «la prima, come fa Subsurface»
         * — e infatti quelli non si rifiutano mai.
         */
        let ambiguo = ServizioVisto {
            uuid: "fe25c237-0ece-443c-b0aa-e02033e7029d".to_string(),
            caratteristiche: vec![
                car(SCRIVI, true, true, false),
                car("33333333-0000-1000-8000-00805f9b34fb", true, true, false),
                car(ASCOLTA, false, false, true),
            ],
        };
        let servizi = vec![informativo(), ambiguo];

        let rifiuto = risolvi_profilo(&servizi).unwrap_err();
        assert!(rifiuto.contains("caratteristiche scrivibili"), "{rifiuto}");

        let tentativi = elenca_tentativi(&servizi, "Shearwater", "Peregrine").unwrap();
        assert_eq!(tentativi.len(), 8, "quattro combinazioni per ognuna delle due candidate");
        // Il servizio la tabella lo conosce: si dichiara noto, e non come
        // un'ipotesi tirata a caso su un servizio qualunque.
        assert!(tentativi.iter().all(|t| !t.descrizione.contains("IPOTESI")), "{:?}", nomi(&tentativi));
        assert!(tentativi.iter().any(|t| t.scrittura == SCRIVI));
        assert!(tentativi.iter().any(|t| t.scrittura == "33333333-0000-1000-8000-00805f9b34fb"));
    }

    #[test]
    fn un_servizio_conosciuto_si_prova_prima_di_uno_sconosciuto() {
        /*
         * ► L'ORDINE FRA I SERVIZI, E PERCHÉ NON È QUELLO IN CUI ARRIVANO. ◄
         *
         * Un dispositivo annuncia i servizi nell'ordine che decide il suo
         * firmware, e non ha niente a che vedere con quale sia quello giusto.
         * Se il giro li provasse in quell'ordine, su un computer che annuncia
         * prima un servizio qualunque si comincerebbe **tirando a indovinare**
         * e si arriverebbe alla risposta conosciuta al terzo o quarto tocco —
         * cioè, in pratica, mai: chi preme un pulsante due volte senza esito
         * smette.
         *
         * Qui il servizio noto è annunciato per SECONDO, ed è ambiguo dentro
         * (due caratteristiche scrivibili) — quindi `risolvi_profilo` si
         * rifiuta e non c'è nessun profilo a mettere in testa. Deve andare
         * comunque per primo.
         */
        // Un UUID che NON è del SIG: quelli in `0000xxxx-0000-1000-8000-…`
        // sono standard e vengono esclusi come servizi di sistema, quindi non
        // arriverebbero nemmeno all'ordinamento — e la prova non proverebbe
        // niente.
        let sconosciuto = seriale("7b1e4a90-3c2f-4d18-9a55-0c1de2f3a4b6");
        let noto = ServizioVisto {
            uuid: "fe25c237-0ece-443c-b0aa-e02033e7029d".to_string(),
            caratteristiche: vec![
                car(SCRIVI, true, true, false),
                car("33333333-0000-1000-8000-00805f9b34fb", true, true, false),
                car(ASCOLTA, false, false, true),
            ],
        };
        let servizi = vec![informativo(), sconosciuto, noto];
        assert!(risolvi_profilo(&servizi).is_err(), "il servizio noto è ambiguo: ci si rifiuta");

        let tentativi = elenca_tentativi(&servizi, "Shearwater", "Peregrine").unwrap();
        assert_eq!(
            tentativi[0].servizio, "fe25c237-0ece-443c-b0aa-e02033e7029d",
            "il servizio che la tabella conosce va provato per primo, non nell'ordine in cui il \
             firmware lo annuncia"
        );
        assert!(!tentativi[0].descrizione.contains("IPOTESI"), "{}", tentativi[0].descrizione);
    }

    #[test]
    fn i_tentativi_non_sono_mai_piu_di_otto() {
        /*
         * Oltre una certa lunghezza un elenco non è più un ragionamento: è una
         * persona che preme un pulsante finché non succede qualcosa. Qui un
         * dispositivo con tre scrivibili e tre che notificano darebbe
         * trentasei combinazioni.
         */
        let molte = ServizioVisto {
            uuid: "fe25c237-0ece-443c-b0aa-e02033e7029d".to_string(),
            caratteristiche: vec![
                car(SCRIVI, true, true, false),
                car("33333333-0000-1000-8000-00805f9b34fb", true, true, false),
                car("44444444-0000-1000-8000-00805f9b34fb", true, true, false),
                car(ASCOLTA, false, false, true),
                car("55555555-0000-1000-8000-00805f9b34fb", false, false, true),
                car("66666666-0000-1000-8000-00805f9b34fb", false, false, true),
            ],
        };
        let tentativi = elenca_tentativi(&[informativo(), molte], "Shearwater", "Peregrine").unwrap();
        assert_eq!(tentativi.len(), 8);
        // E sono tutti diversi: un elenco con dentro due volte la stessa cosa
        // farebbe premere due volte lo stesso pulsante per lo stesso tentativo.
        let mut chiavi: Vec<String> = tentativi.iter().map(|t| t.chiave()).collect();
        chiavi.sort();
        chiavi.dedup();
        assert_eq!(chiavi.len(), 8);
    }

    #[test]
    fn un_dispositivo_senza_niente_con_cui_parlare_da_lerrore_che_elenca_i_servizi() {
        // Qui il messaggio di `risolvi_profilo` è più utile di qualunque cosa
        // possa dire il giro: elenca quello che il dispositivo annuncia
        // davvero, che è la sola cosa da cui ripartire.
        let errore = elenca_tentativi(&[informativo()], "Mares", "Quad Ci").unwrap_err();
        assert!(errore.contains("0000180a"), "{errore}");
    }

    #[test]
    fn la_chiave_del_metodo_va_e_torna_e_una_che_non_esiste_piu_riparte_dal_primo() {
        let servizi = vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")];
        let tentativi = elenca_tentativi(&servizi, "Shearwater", "Peregrine").unwrap();

        // La chiave conservata ritrova il suo tentativo, e la riga di diario
        // dice che è così — fra «l'ho scelto perché ha funzionato» e «è il
        // primo dell'elenco» c'è tutta la differenza, tre settimane dopo.
        let terza = tentativi[2].chiave();
        let (n, perche) = scegli_tentativo(
            &tentativi,
            &SceltaMetodo { chiave: Some(terza), ..Default::default() },
        );
        assert_eq!(n, 2);
        assert!(perche.contains("conservato"), "{perche}");

        /*
         * ► UNA CHIAVE CHE NON ESISTE PIÙ NON È UN ERRORE. ◄ L'elenco dipende
         * da quali servizi il computer annuncia, e un aggiornamento del
         * firmware può cambiarli. Si riparte dal primo e si dice che è
         * successo: fermare uno scarico perché una preferenza è vecchia
         * bloccherebbe una persona su un dato che non sa nemmeno di avere.
         */
        let (n, perche) = scegli_tentativo(
            &tentativi,
            &SceltaMetodo { chiave: Some("roba|che|non|esiste|piu".into()), ..Default::default() },
        );
        assert_eq!(n, 0);
        assert!(perche.contains("non è più"), "{perche}");

        // Il numero chiesto dal pulsante vince sulla chiave conservata: chi
        // preme «riprova con un altro metodo» sta dicendo proprio che quello
        // conservato non va.
        let (n, _) = scegli_tentativo(
            &tentativi,
            &SceltaMetodo {
                indice: Some(3),
                chiave: Some(tentativi[1].chiave()),
                ..Default::default()
            },
        );
        assert_eq!(n, 3);

        // E un numero fuori dall'elenco riparte dal primo, dicendolo.
        let (n, perche) = scegli_tentativo(
            &tentativi,
            &SceltaMetodo { indice: Some(99), ..Default::default() },
        );
        assert_eq!(n, 0);
        assert!(perche.contains("i metodi sono 4"), "{perche}");
    }

    #[test]
    fn la_chiave_distingue_tutto_quello_che_distingue_un_tentativo() {
        // Se due combinazioni diverse avessero la stessa chiave, conservarne
        // una vorrebbe dire ripescare l'altra: il giro dopo si ripartirebbe
        // dalla combinazione sbagliata senza che nessuno se ne accorga.
        let servizi = vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")];
        let tentativi = elenca_tentativi(&servizi, "Shearwater", "Peregrine").unwrap();
        for t in &tentativi {
            let chiave = t.chiave();
            let pezzi: Vec<&str> = chiave.split('|').collect();
            assert_eq!(pezzi.len(), 5, "servizio, scrittura, notifica, modalità, riassemblaggio");
        }
        // Le maiuscole non contano: CoreBluetooth dà gli UUID in maiuscolo e
        // btleplug in minuscolo, e la stessa combinazione non deve sembrare
        // due cose diverse a seconda del sistema.
        let maiuscolo = Tentativo {
            servizio: tentativi[0].servizio.to_uppercase(),
            scrittura: tentativi[0].scrittura.to_uppercase(),
            notifica: tentativi[0].notifica.to_uppercase(),
            ..tentativi[0].clone()
        };
        assert_eq!(maiuscolo.chiave(), tentativi[0].chiave());
    }

    // ----------------------------------------------- il diario: testa e coda

    #[test]
    fn il_diario_racconta_la_testa_in_diretta_e_la_coda_alla_fine() {
        /*
         * ► IL CASO VERO CHE HA PAGATO QUESTA PROVA. ◄ Il 7 settembre 2026 un
         * Mares Quad Ci si è fermato alla scrittura numero 1503 dopo 349 KB
         * scaricati, e del diario è arrivata solo la testa: le prime sei
         * scritture, cioè esattamente la parte che aveva funzionato. Di che
         * comando fosse la risposta rifiutata non c'era traccia.
         *
         * Qui si scrive dieci volte e si controllano tutte e due le metà: in
         * diretta le prime sei e non la settima, nel riassunto le ultime otto
         * e non le prime due.
         */
        let antenna = FintaAntenna::con(vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")]);
        let (mut ponte, diario) = apri(&antenna);
        for n in 1u8..=10 {
            (ponte.scrittura)(&[n, 0xee]).expect("la scrittura deve riuscire");
        }

        let righe = diario.righe();
        let in_diretta: Vec<&String> = righe.iter().filter(|r| r.starts_with("scrittura n.")).collect();
        assert_eq!(in_diretta.len(), 6, "in diretta solo le prime sei: {in_diretta:?}");
        assert!(in_diretta[0].contains("scrittura n. 1:"), "{in_diretta:?}");
        assert!(in_diretta[5].contains("scrittura n. 6:"), "{in_diretta:?}");

        let fine = (ponte.riassunto)();
        assert!(fine.contains("ultime scritture prima della fine"), "{fine}");
        // La coda tiene le ultime otto — dalla terza alla decima — ma ne
        // RACCONTA solo quelle che non erano già uscite in diretta: dalla
        // settima in poi. Ripetere le prime sei raddoppierebbe il diario dei
        // casi piccoli, che sono quelli in cui si legge meglio.
        for n in 7..=10 {
            assert!(fine.contains(&format!("scrittura n. {n}:")), "manca la n. {n} in:\n{fine}");
        }
        for n in 1..=6 {
            assert!(
                !fine.contains(&format!("scrittura n. {n}:")),
                "la n. {n} era già uscita in diretta:\n{fine}"
            );
        }
        // I byte veri, non solo i numeri: la coda serve a sapere COSA è stato
        // mandato per ultimo, non quante volte.
        assert!(fine.contains("0a ee"), "l'ultima scrittura, in esadecimale:\n{fine}");
    }

    #[test]
    fn con_poche_scritture_la_coda_non_ripete_quello_che_e_gia_uscito_in_diretta() {
        /*
         * Con quattro scritture, testa e coda sono la stessa cosa: ripeterle
         * raddoppierebbe il diario dei casi più piccoli, che sono anche
         * quelli in cui si legge meglio. La soglia è la stessa
         * `SCRITTURE_RACCONTATE`, e questa prova la inchioda dai due lati.
         */
        let antenna = FintaAntenna::con(vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")]);
        let (mut ponte, _) = apri(&antenna);
        for n in 1u8..=6 {
            (ponte.scrittura)(&[n]).expect("la scrittura deve riuscire");
        }
        let fine = (ponte.riassunto)();
        assert!(!fine.contains("ultime scritture"), "sei scritture sono già tutte in diretta:\n{fine}");

        // Sette invece sì: la settima non è mai uscita in diretta.
        (ponte.scrittura)(&[7]).expect("la scrittura deve riuscire");
        let fine = (ponte.riassunto)();
        assert!(fine.contains("ultime scritture"), "{fine}");
        assert!(fine.contains("scrittura n. 7:"), "{fine}");
    }

    // ------------------------------------------- l'accoppiamento: PIN e chiave

    #[test]
    fn linvolucro_dei_segreti_chiede_il_pin_e_ne_toglie_gli_spazi() {
        /*
         * Sei cifre digitate su un telefono arrivano spesso con uno spazio in
         * coda, e `pelagic_i330r_init_passcode` rifiuta qualunque carattere
         * che non sia una cifra: il rifiuto sarebbe «codice errato» a chi ha
         * digitato quello giusto. Toglierli è la riparazione onesta.
         */
        struct Nudi;
        impl AccessoriBle for Nudi {
            fn nome(&mut self) -> Option<String> {
                Some("i330R".into())
            }
            fn leggi_caratteristica(&mut self, _uuid: [u8; 16]) -> Result<Vec<u8>, String> {
                Err("niente".into())
            }
        }
        let mut segreti = AccessoriConSegreti::nuovo(
            Box::new(Nudi),
            Box::new(|| Some("  482915 ".to_string())),
            None,
            Box::new(|_| {}),
        );
        assert_eq!(segreti.codice_pin().as_deref(), Some("482915"));
        // E quello che sta dentro continua a rispondere: l'involucro non deve
        // rubare il nome, che è quello da cui gli Oceanic ricavano il seriale.
        assert_eq!(segreti.nome().as_deref(), Some("i330R"));

        // Una rinuncia resta una rinuncia, e non diventa una stringa vuota —
        // che sarebbe un PIN di zero cifre, cioè una domanda diversa.
        let mut rinuncia =
            AccessoriConSegreti::nuovo(Box::new(Nudi), Box::new(|| None), None, Box::new(|_| {}));
        assert_eq!(rinuncia.codice_pin(), None);
    }

    #[test]
    fn il_codice_appena_ricevuto_vale_subito_anche_dentro_lo_stesso_scarico() {
        /*
         * ► IL PUNTO CHE SI DIMENTICA. ◄ `pelagic_i330r_init` scrive il codice
         * con `SET_ACCESSCODE` e poi lo usa; e se in mezzo qualcuno lo
         * richiedesse, rispondere «non ce l'ho» rimanderebbe al PIN un
         * computer che ce l'ha appena dato. Conservarlo FUORI non basta: il
         * fuori è l'archivio dell'interfaccia, che questo scarico non
         * rilegge.
         */
        struct Nudi;
        impl AccessoriBle for Nudi {
            fn nome(&mut self) -> Option<String> {
                None
            }
            fn leggi_caratteristica(&mut self, _uuid: [u8; 16]) -> Result<Vec<u8>, String> {
                Err("niente".into())
            }
        }
        let fuori = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let dentro_fuori = fuori.clone();
        let mut segreti = AccessoriConSegreti::nuovo(
            Box::new(Nudi),
            Box::new(|| None),
            None,
            Box::new(move |c: &[u8]| dentro_fuori.lock().unwrap().push(c.to_vec())),
        );
        assert_eq!(segreti.codice_accesso(), None, "la prima volta non c'è niente");
        segreti.salva_codice_accesso(&[1, 2, 3, 4]);
        assert_eq!(segreti.codice_accesso(), Some(vec![1, 2, 3, 4]), "e adesso c'è");
        assert_eq!(fuori.lock().unwrap().as_slice(), &[vec![1, 2, 3, 4]], "ed è uscito anche di fuori");
    }

    #[test]
    fn lesadecimale_del_codice_va_e_torna_e_rifiuta_quello_che_non_e_esadecimale() {
        assert_eq!(in_esadecimale(&[0x0a, 0xff, 0x00]), "0aff00");
        assert_eq!(da_esadecimale("0aff00"), Some(vec![0x0a, 0xff, 0x00]));
        // Le maiuscole e gli spazi si tollerano: un codice copiato a mano da
        // un diario è la forma in cui arriverà, il giorno che servirà.
        assert_eq!(da_esadecimale(" 0A FF 00 "), Some(vec![0x0a, 0xff, 0x00]));
        // Tutto il resto no. Mezzo codice è peggio di nessun codice: il
        // computer lo rifiuterebbe senza dire perché, mentre «non ce l'ho» fa
        // ripartire dal PIN.
        assert_eq!(da_esadecimale("0aff0"), None, "un numero dispari di cifre");
        assert_eq!(da_esadecimale("0agf"), None, "una lettera che non è esadecimale");
        assert_eq!(da_esadecimale(""), None);
        assert_eq!(da_esadecimale("   "), None);
    }

    /// Le prove del PIN toccano l'unica variabile globale del file, e cargo
    /// lancia le prove in parallelo: senza questo lucchetto due prove del PIN
    /// si ruberebbero la busta a vicenda e fallirebbero a giorni alterni, che
    /// è il modo migliore per insegnare a non fidarsi delle prove. La globale
    /// nel programma vero è protetta da `SCARICO_IN_CORSO`; qui no, perché
    /// qui non c'è nessuno scarico.
    static UNA_PROVA_DEL_PIN_ALLA_VOLTA: Mutex<()> = Mutex::new(());

    fn in_fila() -> std::sync::MutexGuard<'static, ()> {
        // Un lucchetto avvelenato da una prova già fallita non deve far
        // fallire anche le altre per un motivo diverso da quello vero.
        UNA_PROVA_DEL_PIN_ALLA_VOLTA.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn una_domanda_ha_una_risposta_sola_e_la_busta_si_consuma() {
        /*
         * ► PERCHÉ LA BUSTA SI TOGLIE E NON SI COPIA. ◄ Chi tocca due volte
         * «Conferma» manda due risposte. La prima è quella buona; la seconda,
         * se la busta fosse ancora lì, resterebbe nel canale — e il canale ha
         * posto per una. Non farebbe danni oggi, ma è la forma esatta della
         * risposta di ieri consegnata alla domanda di oggi, che è il difetto
         * che questo file ha già pagato altrove.
         */
        let _fila = in_fila();
        let (busta, risposta) = std::sync::mpsc::sync_channel(1);
        *ATTESA_PIN.lock().unwrap() = Some(busta);

        rispondi_pin(Some("482915".into()));
        assert!(ATTESA_PIN.lock().unwrap().is_none(), "la busta si consuma con la risposta");
        assert_eq!(risposta.recv().unwrap().as_deref(), Some("482915"));

        rispondi_pin(Some("000000".into()));
        assert!(risposta.try_recv().is_err(), "la seconda risposta non deve entrare in canna");
    }

    #[test]
    fn la_risposta_al_pin_arriva_al_thread_che_aspetta_e_una_rinuncia_non_lo_lascia_appeso() {
        let _fila = in_fila();
        /*
         * La domanda esce come evento e la risposta rientra come comando: fra
         * i due non c'è nessun oggetto in comune, e questa prova percorre
         * proprio quel giro — un thread che aspetta, un altro che risponde.
         */
        let visti = Arc::new(Mutex::new(Vec::<String>::new()));
        let per_manda = visti.clone();
        let manda = move |e: EventoScarico| {
            if let EventoScarico::PinRequired = e {
                per_manda.lock().unwrap().push("chiesto".into());
            }
        };

        let atteso = std::thread::spawn(move || chiedi_pin_allinterfaccia(&manda));
        // Si aspetta che la busta sia stata messa: senza, la risposta
        // arriverebbe prima della domanda e il finto proverebbe una cosa che
        // nella realtà non succede.
        let mut giri = 0;
        while ATTESA_PIN.lock().map(|p| p.is_none()).unwrap_or(true) && giri < 200 {
            std::thread::sleep(Duration::from_millis(1));
            giri += 1;
        }
        rispondi_pin(Some("482915".into()));
        assert_eq!(atteso.join().unwrap().as_deref(), Some("482915"));
        assert_eq!(visti.lock().unwrap().len(), 1, "l'evento esce una volta sola");

        // La rinuncia: `None` è una risposta, e deve tornare SUBITO — non
        // dopo la scadenza. Con la scadenza di prova a 200 ms, un giro che
        // aspettasse quella si vedrebbe nel tempo.
        let inizio = Instant::now();
        let atteso = std::thread::spawn(|| chiedi_pin_allinterfaccia(&|_| {}));
        let mut giri = 0;
        while ATTESA_PIN.lock().map(|p| p.is_none()).unwrap_or(true) && giri < 200 {
            std::thread::sleep(Duration::from_millis(1));
            giri += 1;
        }
        rispondi_pin(None);
        assert_eq!(atteso.join().unwrap(), None);
        assert!(inizio.elapsed() < ATTESA_PIN_MAX, "la rinuncia non aspetta la scadenza");
    }

    #[test]
    fn se_nessuno_risponde_si_rinuncia_invece_di_aspettare_per_sempre() {
        /*
         * ► LA GUARDIA CHE PROTEGGE DALL'APPLICAZIONE BLOCCATA. ◄ Qui il
         * thread dello scarico è dentro una `ioctl` di libdivecomputer, che
         * non ha nessuna scadenza propria: se questa attesa non ne avesse una,
         * una finestra chiusa senza rispondere lascerebbe lo scarico appeso
         * **per sempre**, con il computer subacqueo collegato e sveglio finché
         * ha batteria. Non c'è nessun altro che possa accorgersene.
         *
         * L'attesa si misura da fuori con un canale e non con `join`, perché
         * un `join` su un thread che non finisce mai non fallisce: appende la
         * prova, e una prova appesa non è una prova rossa.
         */
        let _fila = in_fila();
        let (finito, esito) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = finito.send(chiedi_pin_allinterfaccia(&|_| {}));
        });
        let risposta = esito
            .recv_timeout(ATTESA_PIN_MAX * 20)
            .expect("l'attesa del PIN deve scadere da sola");
        assert_eq!(risposta, None, "chi non risponde vale una rinuncia");
        assert!(
            ATTESA_PIN.lock().unwrap().is_none(),
            "e la busta si toglie anche dopo una scadenza: lasciarla lì farebbe \
             recapitare la risposta di stasera alla domanda di domani"
        );
    }

    #[test]
    fn una_risposta_che_arriva_quando_nessuno_aspetta_non_fa_niente() {
        // La finestra chiusa un istante dopo la scadenza. Non è un errore, e
        // soprattutto non deve restare in una busta per lo scarico di domani.
        let _fila = in_fila();
        rispondi_pin(Some("000000".into()));
        assert!(ATTESA_PIN.lock().unwrap().is_none());
        rispondi_pin(None);
    }

    #[test]
    fn quello_che_si_scrive_arriva_al_dispositivo() {
        let antenna = FintaAntenna::con(vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")]);
        let (mut ponte, _) = apri(&antenna);

        (ponte.scrittura)(&[0x05, 0x10, 0x00]).expect("la scrittura deve riuscire");

        assert_eq!(antenna.scritti(), vec![vec![0x05, 0x10, 0x00]]);
    }

    #[test]
    fn una_scrittura_lunga_arriva_intera_in_una_scrittura_sola() {
        /*
         * Il Pelagic i330R manda la richiesta d'accesso in UN pacchetto da 21
         * byte e il firmware valida ogni scrittura ATT come pacchetto intero:
         * spezzata in 20+1 sono due pacchetti malformati, scartati in
         * silenzio. Come Subsurface, il ponte consegna il buffer intero e si
         * affida all'MTU negoziato dal sistema.
         */
        let antenna = FintaAntenna::con(vec![seriale("fdcdeaaa-295d-470e-bf15-04217b7aa0a0")]);
        let (mut ponte, _) = apri(&antenna);

        let lungo: Vec<u8> = (0u8..50).collect();
        (ponte.scrittura)(&lungo).unwrap();

        let scritti = antenna.scritti();
        assert_eq!(scritti.len(), 1, "una scrittura sola, non pezzi: {scritti:?}");
        assert_eq!(scritti[0], lungo);
    }

    #[test]
    fn le_notifiche_finiscono_nel_canale_nellordine_giusto_e_intere() {
        /*
         * L'ordine E i confini. Che arrivino in ordine è ovvio finché non si
         * mette in mezzo un runtime asincrono; che restino separate è
         * l'invariante che salva il protocollo — vedi il commento di
         * `FlussoBle::leggi`: il primo byte di ogni notifica non è dato, e due
         * notifiche unite mettono un byte di sequenza dentro i dati.
         */
        let antenna = FintaAntenna::con(vec![seriale("fdcdeaaa-295d-470e-bf15-04217b7aa0a0")]);
        let (ponte, _) = apri(&antenna);

        antenna.notifica(&[0xf7, 0x01, 0x02]);
        antenna.notifica(&[0x0a, 0x03, 0x04]);
        antenna.notifica(&[0x1d, 0x05]);

        let mut flusso = FlussoBle::nuovo(ponte.entrata, ponte.scrittura);
        let attesa = Duration::from_millis(500);
        assert_eq!(flusso.leggi(100, attesa).unwrap(), vec![0xf7, 0x01, 0x02]);
        assert_eq!(flusso.leggi(100, attesa).unwrap(), vec![0x0a, 0x03, 0x04]);
        assert_eq!(flusso.leggi(100, attesa).unwrap(), vec![0x1d, 0x05]);
    }

    #[test]
    fn i_byte_ricevuti_si_contano_per_poter_mostrare_lavanzamento() {
        let antenna = FintaAntenna::con(vec![seriale("fdcdeaaa-295d-470e-bf15-04217b7aa0a0")]);
        let (ponte, _) = apri(&antenna);

        antenna.notifica(&[0; 20]);
        antenna.notifica(&[0; 13]);

        assert_eq!(ponte.ricevuti.load(Ordering::Relaxed), 33);
    }

    #[test]
    fn il_collegamento_che_cade_a_meta_da_un_errore_leggibile() {
        /*
         * Il caso vero: il computer si spegne, esce dalla portata, o il suo
         * firmware chiude la sessione a un terzo del trasferimento. Deve
         * diventare un errore che si legge — in lettura E in scrittura — non
         * un'attesa muta fino alla scadenza seguita da «tempo scaduto», che
         * manderebbe a cercare il guasto dalla parte sbagliata.
         */
        let antenna = FintaAntenna::con(vec![seriale("fdcdeaaa-295d-470e-bf15-04217b7aa0a0")]);
        let (mut flusso, diario, riassunto) = apri_flusso(&antenna);

        antenna.notifica(&[0xf7, 0x63]);
        assert_eq!(flusso.leggi(10, Duration::from_millis(200)).unwrap(), vec![0xf7, 0x63]);

        antenna.fai_cadere();

        let errore = flusso
            .leggi(10, Duration::from_secs(5))
            .expect_err("una lettura su un collegamento caduto deve fallire");
        assert!(errore.contains("chiuso"), "messaggio poco chiaro: {errore}");

        let errore = flusso
            .scrivi(&[0x01])
            .expect_err("una scrittura su un collegamento caduto deve fallire");
        assert!(
            errore.motivo().contains("raggiungibile") || errore.motivo().contains("chiuso"),
            "messaggio poco chiaro: {}",
            errore.motivo()
        );
        // E il diario lo dice, con il conto delle notifiche arrivate prima.
        assert!(diario.contiene("caduto da sé, dopo 1 notifiche"), "{}", diario.testo());
        assert!(riassunto().contains("il collegamento è caduto da sé"), "{}", riassunto());
    }

    // ------------------------------------------------------ la scelta del profilo

    #[test]
    fn un_profilo_noto_vince_e_dice_su_cosa_e_stato_verificato() {
        // Shearwater: il profilo noto va scelto anche se il dispositivo espone
        // altri servizi che al ripiego sembrerebbero buoni.
        let antenna = FintaAntenna::con(vec![
            informativo(),
            seriale("fe25c237-0ece-443c-b0aa-e02033e7029d"),
            seriale("0000abcd-0000-1000-8000-00805f9b34fb"),
        ]);
        let (ponte, _) = apri(&antenna);

        let profilo = risolvi_profilo(&antenna.0.servizi).unwrap();
        assert_eq!(profilo.servizio, "fe25c237-0ece-443c-b0aa-e02033e7029d");
        assert_eq!(profilo.modo, ModoScrittura::SenzaRisposta);
        assert!(profilo.descrizione.contains("Peregrine"), "{}", profilo.descrizione);
        assert!(!profilo.descrizione.contains("RIPIEGO"), "{}", profilo.descrizione);
        assert_eq!(ponte.descrizione, profilo.descrizione);
    }

    #[test]
    fn il_ripiego_sceglie_il_solo_servizio_che_puo_parlare_e_lo_dichiara() {
        /*
         * Un computer che non conosciamo: nessun profilo in tabella, nessun
         * servizio nell'elenco, un solo servizio con la forma di una seriale
         * su BLE. Si prova, e si SCRIVE nel diario che è un'euristica — perché
         * se poi il computer tace, chi legge deve sapere che la scelta era
         * un'ipotesi.
         */
        let servizi = vec![
            informativo(),
            ServizioVisto {
                uuid: "0000180f-0000-1000-8000-00805f9b34fb".into(),
                caratteristiche: vec![car("00002a19-0000-1000-8000-00805f9b34fb", false, false, true)],
            },
            seriale("0000ffe0-0000-1000-8000-00805f9b34fb"),
            seriale("12345678-0000-4000-8000-00805f9b34fb"),
        ];
        let profilo = risolvi_profilo(&servizi).expect("il ripiego deve riuscire");

        assert_eq!(profilo.servizio, "12345678-0000-4000-8000-00805f9b34fb");
        assert_eq!(profilo.scrittura, SCRIVI);
        assert_eq!(profilo.notifica, ASCOLTA);
        assert!(profilo.descrizione.contains("RIPIEGO"), "{}", profilo.descrizione);
    }

    #[test]
    fn i_servizi_standard_del_sig_non_sono_mai_candidati() {
        /*
         * `0000ffe0-…` ha la forma di una seriale ed è un UUID «standard» a 16
         * bit: Subsurface li ignora tutti in blocco, a meno che non siano
         * nell'elenco dei riconosciuti. Prima c'era un elenco a mano di otto
         * servizi di sistema, e il nono — questo — avrebbe reso ambiguo un
         * dispositivo che funziona.
         */
        let servizi = vec![
            seriale("0000ffe0-0000-1000-8000-00805f9b34fb"),
            seriale("12345678-0000-4000-8000-00805f9b34fb"),
        ];
        let profilo = risolvi_profilo(&servizi).expect("un solo candidato vero");
        assert_eq!(profilo.servizio, "12345678-0000-4000-8000-00805f9b34fb");

        // Ma i due standard che Subsurface riconosce (Telit, Divesoft) sì.
        let servizi = vec![seriale("0000fcef-0000-1000-8000-00805f9b34fb")];
        let profilo = risolvi_profilo(&servizi).expect("Divesoft è riconosciuto");
        assert!(profilo.descrizione.contains("Divesoft"), "{}", profilo.descrizione);
    }

    #[test]
    fn il_ripiego_ambiguo_rifiuta_invece_di_indovinare() {
        // Due servizi plausibili e sconosciuti. Sceglierne uno a caso significa
        // scrivere comandi a un servizio sbagliato: meglio un messaggio che un
        // pomeriggio.
        let servizi = vec![
            seriale("12345678-0000-4000-8000-00805f9b34fb"),
            seriale("87654321-0000-4000-8000-00805f9b34fb"),
        ];
        let errore = risolvi_profilo(&servizi).expect_err("due candidati devono essere rifiutati");
        assert!(errore.contains("12345678-0000-4000-8000-00805f9b34fb"), "{errore}");
        assert!(errore.contains("87654321-0000-4000-8000-00805f9b34fb"), "{errore}");
        assert!(errore.contains("riconosciuti"), "{errore}");
    }

    #[test]
    fn un_servizio_riconosciuto_da_subsurface_batte_lambiguita_e_si_presenta_col_nome() {
        /*
         * Il caso del centro immersioni: un Mares con il BlueLink Pro. Il suo
         * servizio non è in tabella, ma è nell'elenco di Subsurface, e questo
         * basta a sceglierlo anche accanto a un altro servizio plausibile. Nel
         * diario deve comparire il NOME — «Mares BlueLink Pro» — perché un
         * UUID non dice niente a chi legge una segnalazione.
         */
        let servizi = vec![
            seriale("12345678-0000-4000-8000-00805f9b34fb"),
            seriale("544e326b-5b72-c6b0-1c46-41c1bc448118"),
        ];
        let profilo = risolvi_profilo(&servizi).expect("il servizio riconosciuto vince");
        assert_eq!(profilo.servizio, "544e326b-5b72-c6b0-1c46-41c1bc448118");
        assert!(profilo.descrizione.contains("Mares BlueLink Pro"), "{}", profilo.descrizione);
        assert!(profilo.descrizione.contains("Subsurface"), "{}", profilo.descrizione);
        assert!(!profilo.descrizione.contains("RIPIEGO"), "{}", profilo.descrizione);
        // La modalità viene dalle proprietà, e con entrambe dichiarate si negozia.
        assert_eq!(profilo.modo, ModoScrittura::SenzaRisposta);
        assert_eq!(profilo.alternativa, Some(ModoScrittura::ConRisposta));
        assert!(profilo.descrizione.contains("si negozia"), "{}", profilo.descrizione);
    }

    #[test]
    fn senza_nessun_candidato_il_ripiego_rifiuta_e_dice_cosa_ha_visto() {
        let servizi = vec![informativo()];
        let errore = risolvi_profilo(&servizi).expect_err("nessun candidato: si rifiuta");
        assert!(errore.contains("0000180a-0000-1000-8000-00805f9b34fb"), "{errore}");
    }

    #[test]
    fn i_servizi_di_aggiornamento_firmware_non_confondono_il_ripiego() {
        /*
         * L'aggiornamento firmware di Nordic (e i due di Broadcom) è scrivibile
         * e notifica, e sta addosso a mezzo mondo del BLE: senza l'elenco
         * renderebbe ambiguo ogni dispositivo che lo espone.
         */
        for aggiornamento in [
            "00001530-1212-efde-1523-785feabcd123",
            "9e5d1e47-5c13-43a0-8635-82ad38a1386f",
            "a86abc2d-d44c-442e-99f7-80059a873e36",
        ] {
            let servizi = vec![seriale(aggiornamento), seriale("12345678-0000-4000-8000-00805f9b34fb")];
            let profilo = risolvi_profilo(&servizi).expect("il servizio di aggiornamento va ignorato");
            assert_eq!(profilo.servizio, "12345678-0000-4000-8000-00805f9b34fb", "{aggiornamento}");
        }
    }

    #[test]
    fn gli_uuid_si_confrontano_senza_guardare_le_maiuscole() {
        // CoreBluetooth li dà in maiuscolo, btleplug in minuscolo, la tabella è
        // scritta a mano: un confronto letterale farebbe fallire il
        // riconoscimento su una piattaforma sola, che è il difetto più difficile
        // da riprodurre.
        let servizi = vec![seriale("FDCDEAAA-295D-470E-BF15-04217B7AA0A0")];
        let profilo = risolvi_profilo(&servizi).expect("il profilo noto va riconosciuto");
        assert!(profilo.descrizione.contains("Aladin"), "{}", profilo.descrizione);
        assert!(!profilo.descrizione.contains("RIPIEGO"), "{}", profilo.descrizione);

        let servizi = vec![seriale("544E326B-5B72-C6B0-1C46-41C1BC448118")];
        let profilo = risolvi_profilo(&servizi).expect("l'elenco va riconosciuto");
        assert!(profilo.descrizione.contains("Mares"), "{}", profilo.descrizione);
    }

    #[test]
    fn un_servizio_sconosciuto_con_due_caratteristiche_scrivibili_non_si_indovina() {
        // Un servizio che nessuno conosce, con due candidate identiche: meglio
        // un errore che un comando scritto alla caratteristica sbagliata.
        let servizi = vec![ServizioVisto {
            uuid: "12345678-0000-4000-8000-00805f9b34fb".into(),
            caratteristiche: vec![
                car(SCRIVI, true, true, false),
                car("33333333-0000-1000-8000-00805f9b34fb", true, true, false),
                car(ASCOLTA, false, false, true),
            ],
        }];
        let errore = risolvi_profilo(&servizi).expect_err("due scrivibili: si rifiuta");
        assert!(errore.contains("scrivibili"), "{errore}");
    }

    #[test]
    fn un_servizio_riconosciuto_con_due_candidate_prende_la_prima_come_subsurface_e_lo_dice() {
        /*
         * Lo stesso servizio, ma nell'elenco di Subsurface: là la regola «la
         * prima scrivibile, la prima che notifica» è quella con cui Subsurface
         * scarica davvero da quei computer. Rifiutare negherebbe un
         * dispositivo che funziona altrove; scegliere la prima E scriverlo nel
         * diario è quello che fa Subsurface, con in più la riga che lo dice.
         */
        let servizi = vec![ServizioVisto {
            uuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e".into(),
            caratteristiche: vec![
                car(SCRIVI, true, true, false),
                car("33333333-0000-1000-8000-00805f9b34fb", true, true, false),
                car(ASCOLTA, false, false, true),
                car("44444444-0000-1000-8000-00805f9b34fb", false, false, true),
            ],
        }];
        let profilo = risolvi_profilo(&servizi).expect("riconosciuto: si prende la prima");
        assert_eq!(profilo.scrittura, SCRIVI);
        assert_eq!(profilo.notifica, ASCOLTA);
        assert!(profilo.descrizione.contains("la prima come fa Subsurface"), "{}", profilo.descrizione);
    }

    #[test]
    fn una_caratteristica_nominata_dalla_tabella_deve_avere_le_proprieta_che_la_tabella_le_attribuisce() {
        // Il Terminal I/O con DATA_RX che non si scrive: la voce di tabella
        // punta a una caratteristica sbagliata, e va detto adesso.
        let servizi = vec![ServizioVisto {
            uuid: TELIT.into(),
            caratteristiche: vec![
                car(TELIT_DATI_RX, false, false, false),
                car(TELIT_DATI_TX, false, false, true),
                car(TELIT_CREDITI_RX, true, false, false),
                car(TELIT_CREDITI_TX, false, false, true),
            ],
        }];
        let errore = risolvi_profilo(&servizi).expect_err("una nominata senza proprietà è un errore");
        assert!(errore.contains("non accetta scritture"), "{errore}");
    }

    #[test]
    fn le_caratteristiche_da_evitare_di_subsurface_non_contano() {
        // Il McLean Extreme: un servizio solo, sei scrivibili, e le proprietà
        // non distinguono. Le quattro da evitare vanno tolte PRIMA di contare.
        let servizi = vec![ServizioVisto {
            uuid: "49535343-fe7d-4ae5-8fa9-9fafd205e455".into(),
            caratteristiche: vec![
                // Una da evitare che sembra «di scrittura» e una che sembra
                // «di lettura»: senza l'elenco, ognuna renderebbe ambiguo il
                // suo verso, e la scelta si rifiuterebbe.
                car("49535343-6daa-4d02-abf6-19569aca69fe", true, true, false),
                car("49535343-aca3-481c-91ec-d85e28a60318", false, false, true),
                car("49535343-1e4d-4bd9-ba61-23c647249616", false, false, true),
                car("49535343-8841-43f4-a8d4-ecbe34729bb3", true, true, false),
            ],
        }];
        let profilo = risolvi_profilo(&servizi).expect("tolte quelle da evitare, ne resta una per verso");
        assert_eq!(profilo.scrittura, "49535343-8841-43f4-a8d4-ecbe34729bb3");
        assert_eq!(profilo.notifica, "49535343-1e4d-4bd9-ba61-23c647249616");
    }

    #[test]
    fn la_modalita_automatica_segue_quello_che_la_caratteristica_dichiara() {
        /*
         * Il profilo Uwatec chiede «automatica» perché quella caratteristica non
         * l'ha mai guardata nessuno. Su una che accetta solo «write» deve uscire
         * «con conferma», e senza alternativa: scrivere senza conferma dove il
         * GATT non lo permette fallisce alla PRIMA scrittura, cioè dove il
         * sintomo è identico a «il computer non risponde».
         */
        let servizi = vec![seriale_rigida("fdcdeaaa-295d-470e-bf15-04217b7aa0a0", false)];
        let profilo = risolvi_profilo(&servizi).unwrap();
        assert_eq!(profilo.modo, ModoScrittura::ConRisposta);
        assert_eq!(profilo.alternativa, None);
        assert!(profilo.descrizione.contains("solo questa modalità"), "{}", profilo.descrizione);

        let servizi = vec![seriale("fdcdeaaa-295d-470e-bf15-04217b7aa0a0")];
        let profilo = risolvi_profilo(&servizi).unwrap();
        assert_eq!(profilo.modo, ModoScrittura::SenzaRisposta);
        assert_eq!(profilo.alternativa, Some(ModoScrittura::ConRisposta));
    }

    #[test]
    fn un_profilo_noto_senza_le_caratteristiche_giuste_e_un_errore_che_si_legge() {
        // Il servizio è quello del Peregrine, ma non c'è niente che notifichi:
        // il computer non avrebbe modo di rispondere, e va detto adesso invece
        // che dopo cinque secondi di silenzio.
        let servizi = vec![ServizioVisto {
            uuid: "fe25c237-0ece-443c-b0aa-e02033e7029d".into(),
            caratteristiche: vec![car(SCRIVI, true, true, false)],
        }];
        let errore = risolvi_profilo(&servizi).expect_err("senza notifiche si rifiuta");
        assert!(errore.contains("notifica"), "{errore}");
    }

    // ------------------------------------------------- la negoziazione del modo

    #[test]
    fn una_scrittura_rifiutata_si_ripete_nellaltra_modalita_e_il_diario_lo_dice() {
        /*
         * Android e BlueZ rifiutano una scrittura «senza conferma» a una
         * caratteristica che la dichiara ma non la gradisce (o viceversa). Il
         * primo tentativo va nella modalità del profilo; al rifiuto si cambia
         * UNA volta e si riprova lo stesso pezzo. Il dispositivo deve ricevere
         * i byte una volta sola, nella modalità buona, e il diario deve
         * raccontare tutte e due le cose.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")])
            .che_rifiuta(ModoScrittura::SenzaRisposta);
        let (mut ponte, diario) = apri(&antenna);

        (ponte.scrittura)(&[0xc2, 0x8d]).expect("la seconda modalità deve salvare la scrittura");

        assert_eq!(
            antenna.scritte(),
            vec![Scritta { caratteristica: SCRIVI.into(), modo: ModoScrittura::ConRisposta, dati: vec![0xc2, 0x8d] }]
        );
        assert!(diario.contiene("rifiutata"), "{}", diario.testo());
        assert!(diario.contiene("riprovo con conferma"), "{}", diario.testo());

        // Da qui in poi si resta nella modalità che ha funzionato, senza altre righe di rifiuto.
        (ponte.scrittura)(&[0x01]).unwrap();
        assert_eq!(antenna.scritte().last().unwrap().modo, ModoScrittura::ConRisposta);
        assert_eq!(diario.righe().iter().filter(|r| r.contains("rifiutata")).count(), 1);
    }

    #[test]
    fn una_conferma_che_non_arriva_non_cambia_modalita() {
        /*
         * La conferma scaduta non dice niente sul GATT: la scrittura può
         * essere ancora in corso. Se qui si cambiasse modalità e si
         * riscrivesse, il computer riceverebbe lo stesso comando due volte,
         * in due modalità, quando la prima poi arriva. Si fallisce e basta,
         * e la modalità resta quella.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut ponte, diario) = apri(&antenna);
        antenna.0.muta.store(true, Ordering::SeqCst);

        let errore = (ponte.scrittura)(&[0xc2, 0x8d]).expect_err("la conferma scade");
        assert!(errore.motivo().contains("non è stata confermata"), "{}", errore.motivo());
        // ► E soprattutto: deve uscire QUALIFICATA come scaduta. È l'unica
        // differenza che `cb_write` guarda, ed è quella che decide se
        // libdivecomputer può ritentare o deve arrendersi. Il messaggio è
        // per l'uomo; questa riga è per il backend.
        assert!(
            matches!(errore, GuastoScrittura::Scaduta(_)),
            "una conferma non arrivata non è un rifiuto: {errore:?}"
        );
        assert!(!diario.contiene("riprovo"), "{}", diario.testo());
        // E il diario lo dice a chi lo leggerà: se le righe continuano dopo
        // questa, il ritentativo di libdivecomputer ha funzionato.
        assert!(diario.contiene("si può ritentare"), "{}", diario.testo());
        // La scrittura in ritardo arriva, una sola, nella modalità di partenza.
        std::thread::sleep(Duration::from_millis(500));
        let scritte = antenna.scritte();
        assert_eq!(scritte.len(), 1, "{scritte:?}");
        assert_eq!(scritte[0].modo, ModoScrittura::SenzaRisposta);
        (ponte.scrittura)(&[0x01]).unwrap();
        assert_eq!(antenna.scritte().last().unwrap().modo, ModoScrittura::SenzaRisposta);
    }

    #[test]
    fn se_anche_il_rinvio_scade_lo_scarico_puo_ancora_ritentare() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► LO STESSO ERRORE, IN PICCOLO, NEL RAMO CHE NESSUNO GUARDA. ◄
         *
         * Il rinvio nell'altra modalità parte solo dopo un RIFIUTO, e per
         * questo la tentazione è di dire che il guasto finale è un rifiuto e
         * chiuderla lì. Ma il rinvio è una scrittura come tutte le altre: può
         * benissimo restare senza conferma. Se in quel caso uscisse
         * qualificato «rifiutata», `cb_write` risponderebbe «errore di
         * trasmissione» e `mares_iconhd_transfer` si arrenderebbe — cioè
         * rifaremmo qui, su un ramo più stretto, esattamente il guasto del
         * 9 settembre 2026 che tutto questo serve a togliere.
         *
         * L'antenna rifiuta la modalità di partenza (il primo tentativo
         * fallisce ed è un rifiuto vero, quindi si cambia) e resta muta su
         * quella dopo: il rinvio parte e non torna in tempo.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")])
            .che_rifiuta(ModoScrittura::SenzaRisposta);
        antenna.0.muta.store(true, Ordering::SeqCst);
        let (mut ponte, diario) = apri(&antenna);

        let errore = (ponte.scrittura)(&[0xc2, 0x8d]).expect_err("il rinvio non viene confermato");
        // Il racconto dice tutte e due le cose, perché per capire il diario
        // servono tutte e due.
        assert!(errore.motivo().contains("rifiutata"), "{}", errore.motivo());
        assert!(errore.motivo().contains("e anche"), "{}", errore.motivo());
        assert!(
            matches!(errore, GuastoScrittura::Scaduta(_)),
            "la qualifica è quella del SECONDO guasto, non del primo: {errore:?}"
        );
        assert!(diario.contiene("riprovo con conferma"), "{}", diario.testo());
        // La scrittura in ritardo arriva comunque: si aspetta, per non
        // lasciarla cadere dentro la prova dopo.
        std::thread::sleep(Duration::from_millis(500));
    }

    #[test]
    fn se_la_caratteristica_accetta_una_modalita_sola_non_ce_niente_da_negoziare() {
        let antenna = FintaAntenna::con(vec![seriale_rigida("544e326b-5b72-c6b0-1c46-41c1bc448118", true)])
            .che_rifiuta(ModoScrittura::SenzaRisposta);
        let (mut ponte, diario) = apri(&antenna);

        let errore = (ponte.scrittura)(&[0xc2, 0x8d]).expect_err("senza alternativa si fallisce");
        assert!(errore.motivo().contains("scrittura n. 1"), "{}", errore.motivo());
        assert!(errore.motivo().contains("senza conferma"), "{}", errore.motivo());
        assert!(
            matches!(errore, GuastoScrittura::Rifiutata(_)),
            "un rifiuto del plugin resta un rifiuto: {errore:?}"
        );
        assert!(antenna.scritte().is_empty());
        assert!(diario.contiene("fallita"), "{}", diario.testo());
        assert!(!diario.contiene("riprovo"), "{}", diario.testo());
        // Un RIFIUTO non si ritenta, e il diario non deve dire il contrario:
        // una riga che promette un ritentativo che non ci sarà manda chi
        // ripara a cercare nel posto sbagliato.
        assert!(!diario.contiene("si può ritentare"), "{}", diario.testo());
    }

    #[test]
    fn dopo_la_prima_risposta_un_errore_di_scrittura_non_cambia_piu_modalita() {
        /*
         * Una volta che il computer ha risposto, la modalità ha dimostrato di
         * funzionare: un errore a quel punto è un'altra cosa (quasi sempre il
         * collegamento caduto), e cambiare modalità lo travestirebbe da
         * problema di GATT.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut ponte, diario) = apri(&antenna);
        (ponte.scrittura)(&[0xc2, 0x8d]).unwrap();
        antenna.notifica(&[0xaa]);
        *antenna.0.rifiuta.lock().unwrap() = Some(ModoScrittura::SenzaRisposta);

        let errore = (ponte.scrittura)(&[0xe7, 0x18]).expect_err("si fallisce senza cambiare");
        assert!(errore.motivo().contains("scrittura n. 2"), "{}", errore.motivo());
        assert!(!diario.contiene("riprovo"), "{}", diario.testo());
    }

    #[test]
    fn il_primo_scambio_muto_rimanda_il_comando_nellaltra_modalita_una_volta_sola() {
        /*
         * Il caso di Apple: btleplug non rifiuta mai una modalità, la
         * converte; se il computer non gradisce quella scelta, semplicemente
         * TACE. Quando la prima lettura scade senza che sia mai arrivata una
         * notifica, il ponte rimanda l'ultimo comando per intero nell'altra
         * modalità e aspetta ancora una volta — una sola: un secondo silenzio
         * è un silenzio vero.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, diario, _) = apri_flusso(&antenna);

        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        let inizio = std::time::Instant::now();
        let letti = flusso.leggi(20, Duration::from_millis(150)).unwrap();
        assert!(letti.is_empty(), "nessuno ha risposto, e deve essere vuoto: {letti:?}");
        // Due attese, non una: la seconda è per il rinvio.
        assert!(inizio.elapsed() >= Duration::from_millis(280), "{:?}", inizio.elapsed());

        let scritte = antenna.scritte();
        assert_eq!(scritte.len(), 2, "{scritte:?}");
        assert_eq!(scritte[0].modo, ModoScrittura::SenzaRisposta);
        assert_eq!(scritte[1].modo, ModoScrittura::ConRisposta);
        assert_eq!(scritte[1].dati, vec![0xc2, 0x8d]);
        assert!(diario.contiene("primo scambio muto"), "{}", diario.testo());
        assert!(diario.contiene("rimando le 1 scritture fatte finora (n. 1–1"), "{}", diario.testo());

        // Un terzo silenzio non rimanda più niente, e le scritture successive
        // usano la modalità nuova.
        let inizio = std::time::Instant::now();
        assert!(flusso.leggi(20, Duration::from_millis(100)).unwrap().is_empty());
        assert!(inizio.elapsed() < Duration::from_millis(190), "{:?}", inizio.elapsed());
        assert_eq!(antenna.scritte().len(), 2);
        flusso.scrivi(&[0x01]).unwrap();
        assert_eq!(antenna.scritte().last().unwrap().modo, ModoScrittura::ConRisposta);
    }

    #[test]
    fn il_rinvio_sul_silenzio_rimanda_tutte_le_scritture_fatte_prima_nellordine() {
        /*
         * Il primo comando di Mares è due scritture (intestazione, poi il
         * resto), quello di Suunto viene spezzato a venti dall'HDLC:
         * rimandare solo l'ultima sarebbe rimandare un frammento, e la
         * negoziazione non proverebbe davvero l'altra modalità.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, diario, _) = apri_flusso(&antenna);
        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        flusso.scrivi(&[0x01, 0x02, 0x03]).unwrap();
        assert!(flusso.leggi(20, Duration::from_millis(80)).unwrap().is_empty());

        let scritte = antenna.scritte();
        assert_eq!(scritte.len(), 4, "{scritte:?}");
        assert_eq!(scritte[2].modo, ModoScrittura::ConRisposta);
        assert_eq!(scritte[2].dati, vec![0xc2, 0x8d]);
        assert_eq!(scritte[3].dati, vec![0x01, 0x02, 0x03]);
        assert!(diario.contiene("rimando le 2 scritture fatte finora (n. 1–2, 5 byte"), "{}", diario.testo());
    }

    #[test]
    fn il_rinvio_sul_silenzio_funziona_quando_il_computer_risponde_alla_seconda() {
        // Lo stesso, con un computer che alla seconda modalità risponde: la
        // lettura deve restituire la risposta, non il vuoto della prima attesa.
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, diario, riassunto) = apri_flusso(&antenna);
        flusso.scrivi(&[0xc2, 0x8d]).unwrap();

        let risponditore = {
            let antenna = antenna.clone();
            std::thread::spawn(move || {
                // Aspetta che compaia la scrittura con conferma, poi risponde.
                for _ in 0..200 {
                    if antenna.scritte().iter().any(|s| s.modo == ModoScrittura::ConRisposta) {
                        antenna.notifica(&[0xaa, 0x01]);
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                panic!("il rinvio con conferma non è mai arrivato");
            })
        };
        let letti = flusso.leggi(20, Duration::from_millis(300)).unwrap();
        risponditore.join().unwrap();
        assert_eq!(letti, vec![0xaa, 0x01]);
        assert!(diario.contiene("prima notifica: 2 byte"), "{}", diario.testo());
        assert!(riassunto().contains("1 scritture"), "{}", riassunto());
        assert!(riassunto().contains("con conferma; 1 rinvio"), "{}", riassunto());
        assert!(riassunto().contains("1 notifiche"), "{}", riassunto());
    }

    #[test]
    fn dopo_una_notifica_il_silenzio_non_rimanda_niente() {
        // Il rinvio è lecito solo al primo scambio: dopo, un silenzio è del
        // protocollo, e ripetere un comando a caso potrebbe fare danni.
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, diario, _) = apri_flusso(&antenna);
        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        antenna.notifica(&[0xaa]);
        assert_eq!(flusso.leggi(20, Duration::from_millis(100)).unwrap(), vec![0xaa]);

        flusso.scrivi(&[0xe7, 0x18]).unwrap();
        assert!(flusso.leggi(20, Duration::from_millis(100)).unwrap().is_empty());
        assert_eq!(antenna.scritte().len(), 2);
        assert!(!diario.contiene("rimando"), "{}", diario.testo());
    }

    #[test]
    fn il_ripiego_stesso_rifiuta_di_rimandare_dopo_una_notifica_o_dopo_la_caduta() {
        /*
         * `FlussoBle` non lo chiama dopo la prima notifica, ma il ripiego non
         * si fida di chi lo chiama: chiamato a mano dopo una risposta, o dopo
         * la caduta del collegamento, non deve rimandare niente. Rimandare un
         * comando su un collegamento morto sarebbe innocuo; rimandarlo dopo
         * una risposta potrebbe ripetere un comando che non è più
         * un'identificazione.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut ponte, _) = apri(&antenna);
        (ponte.scrittura)(&[0xc2, 0x8d]).unwrap();
        antenna.notifica(&[0xaa]);
        assert_eq!((ponte.su_silenzio)(), Ripiego::Esaurito, "dopo una notifica non si rimanda");
        assert_eq!(antenna.scritte().len(), 1);

        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut ponte, diario) = apri(&antenna);
        (ponte.scrittura)(&[0xc2, 0x8d]).unwrap();
        antenna.fai_cadere();
        assert_eq!((ponte.su_silenzio)(), Ripiego::Esaurito, "su un collegamento caduto non si rimanda");
        assert!(!diario.contiene("rimando"), "{}", diario.testo());
    }

    #[test]
    fn un_silenzio_prima_di_qualunque_scrittura_non_brucia_la_negoziazione() {
        /*
         * Un protocollo che aspetta un saluto spontaneo legge prima di
         * scrivere. Se quella lettura scade, non c'è niente da rimandare, e
         * soprattutto l'alternativa NON va consumata: deve restare
         * disponibile per il primo scambio vero.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, diario, _) = apri_flusso(&antenna);

        assert!(flusso.leggi(20, Duration::from_millis(80)).unwrap().is_empty());
        assert!(diario.contiene("niente da rimandare"), "{}", diario.testo());
        assert!(antenna.scritte().is_empty());

        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        assert!(flusso.leggi(20, Duration::from_millis(80)).unwrap().is_empty());
        let scritte = antenna.scritte();
        assert_eq!(scritte.len(), 2, "il rinvio deve ancora poter succedere: {scritte:?}");
        assert_eq!(scritte[1].modo, ModoScrittura::ConRisposta);
    }

    #[test]
    fn se_il_rinvio_viene_rifiutato_si_torna_alla_modalita_di_prima() {
        // Il rinvio nell'altra modalità viene rifiutato dal plugin: la
        // modalità torna quella che le scritture le accettava, altrimenti
        // ogni scrittura successiva di libdivecomputer fallirebbe.
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")])
            .che_rifiuta(ModoScrittura::ConRisposta);
        let (mut flusso, diario, _) = apri_flusso(&antenna);
        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        assert!(flusso.leggi(20, Duration::from_millis(80)).unwrap().is_empty());
        assert!(diario.contiene("si resta senza conferma"), "{}", diario.testo());

        flusso.scrivi(&[0x01]).expect("la modalità di prima accetta ancora");
        assert_eq!(antenna.scritte().last().unwrap().modo, ModoScrittura::SenzaRisposta);
    }

    #[test]
    fn dopo_un_cambio_per_errore_il_silenzio_dice_che_laltra_e_gia_stata_provata() {
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")])
            .che_rifiuta(ModoScrittura::SenzaRisposta);
        let (mut flusso, diario, _) = apri_flusso(&antenna);
        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        assert!(flusso.leggi(20, Duration::from_millis(80)).unwrap().is_empty());
        assert!(diario.contiene("già stata provata"), "{}", diario.testo());
        assert!(!diario.contiene("accetta solo la modalità"), "{}", diario.testo());
    }

    #[test]
    fn lo_scollegamento_voluto_non_si_racconta_come_una_caduta() {
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (ponte, diario) = apri(&antenna);
        ponte.scollegamento_voluto.store(true, Ordering::SeqCst);
        antenna.fai_cadere();
        assert!(!diario.contiene("caduto da sé"), "{}", diario.testo());
        assert!(!(ponte.riassunto)().contains("caduto"), "{}", (ponte.riassunto)());
    }

    #[test]
    fn con_una_modalita_sola_il_silenzio_viene_raccontato_e_basta() {
        let antenna = FintaAntenna::con(vec![seriale_rigida("544e326b-5b72-c6b0-1c46-41c1bc448118", true)]);
        let (mut flusso, diario, _) = apri_flusso(&antenna);
        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        assert!(flusso.leggi(20, Duration::from_millis(100)).unwrap().is_empty());
        assert_eq!(antenna.scritte().len(), 1);
        assert!(diario.contiene("niente da ritentare"), "{}", diario.testo());
    }

    // ------------------------------------------------------------- i crediti

    #[test]
    fn il_terminal_io_di_telit_si_avvia_come_dice_la_guida_e_poi_ricarica() {
        /*
         * L'ordine di `setupHwTerminalIo`: iscrizione ai crediti in arrivo,
         * iscrizione ai dati, poi 254 crediti CON conferma — prima di
         * qualunque comando. E dopo 222 notifiche di dati (254 − 32), altri
         * 222 crediti, sempre con conferma, sulla caratteristica dei crediti
         * e non su quella dei dati.
         */
        let antenna = FintaAntenna::con(vec![informativo(), telit()]);
        let (mut ponte, diario) = apri(&antenna);

        assert_eq!(antenna.iscrizioni(), vec![TELIT_CREDITI_TX.to_string(), TELIT_DATI_TX.to_string()]);
        assert_eq!(
            antenna.scritte(),
            vec![Scritta { caratteristica: TELIT_CREDITI_RX.into(), modo: ModoScrittura::ConRisposta, dati: vec![254] }]
        );
        assert!(diario.contiene("concessi 254 crediti"), "{}", diario.testo());
        assert!(ponte.descrizione.contains("Terminal I/O"), "{}", ponte.descrizione);
        assert!(ponte.descrizione.contains("MAI VERIFICATO"), "{}", ponte.descrizione);

        // I dati vanno su DATA_RX, non sui crediti.
        (ponte.scrittura)(&[0xbb, 0x00]).unwrap();
        let ultima = antenna.scritte().last().unwrap().clone();
        assert_eq!(ultima.caratteristica, TELIT_DATI_RX);

        for _ in 0..221 {
            antenna.notifica_da(TELIT_DATI_TX, &[0x00; 20]);
        }
        // La ricarica, se partisse, partirebbe da un compito asincrono: si
        // aspetta abbastanza da vederla — è quello che rende rossa una soglia
        // sbagliata di uno, che altrimenti passerebbe per la corsa.
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(antenna.scritte().len(), 2, "a 33 crediti non si ricarica ancora");
        antenna.notifica_da(TELIT_DATI_TX, &[0x00; 20]);
        // La ricarica parte da un compito asincrono: si dà il tempo di arrivare.
        let mut ricarica = None;
        for _ in 0..200 {
            if let Some(s) = antenna.scritte().into_iter().nth(2) {
                ricarica = Some(s);
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let ricarica = ricarica.expect("dopo 222 notifiche deve partire una ricarica");
        assert_eq!(ricarica.caratteristica, TELIT_CREDITI_RX);
        assert_eq!(ricarica.modo, ModoScrittura::ConRisposta);
        assert_eq!(ricarica.dati, vec![222]);
        assert_eq!(antenna.scritte().len(), 3, "una ricarica sola, non una per notifica");

        // Una ricarica che fallisce si vede nel riassunto, e i crediti NON
        // vengono contati: il computer resta senza, e la causa deve essere
        // scritta dove poi si legge il «tempo scaduto».
        *antenna.0.rifiuta.lock().unwrap() = Some(ModoScrittura::ConRisposta);
        for _ in 0..222 {
            antenna.notifica_da(TELIT_DATI_TX, &[0x00; 20]);
        }
        std::thread::sleep(Duration::from_millis(150));
        assert!(diario.contiene("ricarica di 222 crediti non è riuscita"), "{}", diario.testo());
        assert!((ponte.riassunto)().contains("ricarica di crediti non è riuscita"), "{}", (ponte.riassunto)());
        *antenna.0.rifiuta.lock().unwrap() = None;

        // I crediti in arrivo dal computer si raccontano la prima volta e basta.
        antenna.notifica_da(TELIT_CREDITI_TX, &[0x10]);
        antenna.notifica_da(TELIT_CREDITI_TX, &[0x10]);
        assert_eq!(diario.righe().iter().filter(|r| r.contains("ci concede crediti")).count(), 1);
        assert_eq!(ponte.ricevuti.load(Ordering::Relaxed), 444 * 20, "i crediti non sono dati");
    }

    #[test]
    fn il_servizio_telit_senza_le_caratteristiche_dei_crediti_e_un_errore_che_si_legge() {
        let servizi = vec![ServizioVisto {
            uuid: TELIT.into(),
            caratteristiche: vec![car(TELIT_DATI_RX, true, true, false), car(TELIT_DATI_TX, false, false, true)],
        }];
        let errore = risolvi_profilo(&servizi).expect_err("senza crediti si rifiuta");
        assert!(errore.contains("crediti"), "{errore}");
    }

    #[test]
    fn se_la_concessione_dei_crediti_fallisce_il_ponte_non_si_apre() {
        let antenna = FintaAntenna::con(vec![telit()]).che_rifiuta(ModoScrittura::ConRisposta);
        let diario = Diario::default();
        let errore = tauri::async_runtime::block_on(apri_ponte(antenna, "finto-01", None, diario.cronista(), &SceltaMetodo::default()))
            .err()
            .expect("senza crediti non si parte");
        assert!(errore.contains("254 crediti"), "{errore}");
    }

    // ------------------------------------------------------------ gli accessori

    #[test]
    fn il_nome_e_le_caratteristiche_arrivano_a_libdivecomputer_dal_thread_dello_scarico() {
        // Il nome è già in mano; la lettura di una caratteristica passa dal
        // postino, cioè dal runtime, come le scritture.
        let antenna = FintaAntenna::con(vec![seriale("6e400001-b5a3-f393-e0a9-e50e24dc10b8")])
            .con_valore("6e400003-b5a3-f393-e0a9-e50e24dc10b8", &[1, 2, 3, 4, 5]);
        let (mut flusso, _, _) = apri_flusso(&antenna);

        assert_eq!(flusso.nome(), Some("FQ001124".to_string()));

        // Il nome visto in scansione batte quello del plugin, perché è quello
        // pubblicitario; uno vuoto non lo batte.
        let diario = Diario::default();
        let ponte = tauri::async_runtime::block_on(apri_ponte(antenna.clone(), "finto-01", Some("FQ009999"), diario.cronista(), &SceltaMetodo::default())).unwrap();
        let PonteBle { entrata, scrittura, accessori, su_silenzio, .. } = ponte;
        let mut flusso = FlussoBle::nuovo(entrata, scrittura).con_accessori(accessori, su_silenzio);
        assert_eq!(flusso.nome(), Some("FQ009999".to_string()));
        let ponte = tauri::async_runtime::block_on(apri_ponte(antenna.clone(), "finto-01", Some("  "), diario.cronista(), &SceltaMetodo::default())).unwrap();
        let PonteBle { entrata, scrittura, accessori, su_silenzio, .. } = ponte;
        let mut flusso = FlussoBle::nuovo(entrata, scrittura).con_accessori(accessori, su_silenzio);
        assert_eq!(flusso.nome(), Some("FQ001124".to_string()));
        let uuid = uuid::Uuid::parse_str("6e400003-b5a3-f393-e0a9-e50e24dc10b8").unwrap();
        assert_eq!(flusso.leggi_caratteristica(*uuid.as_bytes()).unwrap(), vec![1, 2, 3, 4, 5]);
        let errore = flusso
            .leggi_caratteristica([0; 16])
            .expect_err("una caratteristica che non c'è deve dirlo");
        assert!(errore.contains("non si legge"), "{errore}");
    }

    // --------------------------------------------------------------- il diario

    #[test]
    fn il_diario_racconta_le_prime_scritture_e_poi_riassume() {
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, diario, riassunto) = apri_flusso(&antenna);

        assert!(diario.contiene("servizi annunciati"), "{}", diario.testo());
        for i in 0..10u8 {
            flusso.scrivi(&[0xc2, i]).unwrap();
        }
        let raccontate = diario.righe().iter().filter(|r| r.starts_with("scrittura n.")).count();
        assert_eq!(raccontate, 6, "{}", diario.testo());
        assert!(diario.contiene("scrittura n. 1: 2 byte [c2 00], senza conferma"), "{}", diario.testo());

        antenna.notifica(&[0xaa; 20]);
        flusso.leggi(20, Duration::from_millis(100)).unwrap();
        let r = riassunto();
        assert!(r.contains("10 scritture (20 byte, senza conferma)"), "{r}");
        assert!(r.contains("1 notifiche (20 byte"), "{r}");
        assert!(r.contains("prima notifica dopo"), "{r}");
        // ► LA MISURA CHE IL 7 SETTEMBRE MANCAVA. ◄ Quanto sta in una
        // notifica è l'MTU meno tre, ed è il numero che decide se il
        // pacchetto di un Mares del ramo variabile arriva intero o spezzato.
        assert!(r.contains("notifiche da 20 byte"), "la dimensione va scritta: {r}");
        assert!(diario.contiene("ms dopo la prima scrittura"), "{}", diario.testo());
    }

    #[test]
    fn il_riassunto_dice_se_le_notifiche_sono_arrivate_di_dimensioni_diverse() {
        /*
         * ► È LA RIGA CHE AVREBBE RISPOSTO ALLA DOMANDA DEL 7 SETTEMBRE. ◄
         *
         * Su BLE i frammenti di uno stesso messaggio sono tutti pieni tranne
         * l'ultimo. Quindi due dimensioni diverse nello stesso scarico dicono
         * che qualcosa è arrivato a pezzi — e per i Mares del ramo variabile,
         * che leggono il pacchetto con una lettura sola, è la differenza fra
         * scaricare e non scaricare. Una dimensione sola dice il contrario, ed
         * è altrettanto utile: esclude l'ipotesi.
         */
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, _, riassunto) = apri_flusso(&antenna);
        antenna.notifica(&[0xaa; 100]);
        antenna.notifica(&[0xbb; 42]);
        flusso.leggi(200, Duration::from_millis(100)).unwrap();
        flusso.leggi(200, Duration::from_millis(100)).unwrap();
        let r = riassunto();
        assert!(r.contains("notifiche da 42 a 100 byte"), "{r}");
    }

    #[test]
    fn il_riassemblaggio_si_accende_per_i_mares_del_ramo_variabile_e_per_nessun_altro() {
        /*
         * L'elenco vero — cinque nomi — è controllato contro i sorgenti della
         * libreria da `maresRamoVariabile.test.ts`, che sa leggere `ISSIRIUS`.
         * Qui si prova la funzione: che guardi la marca oltre al modello, e
         * che non si faccia ingannare dalle maiuscole, perché i nomi arrivano
         * da un catalogo generato e da una scelta fatta a schermo.
         */
        assert_eq!(riassemblaggio_per("Mares", "Quad Ci"), Riassemblaggio::PacchettoIntero);
        assert_eq!(riassemblaggio_per("mares", "QUAD CI"), Riassemblaggio::PacchettoIntero);
        assert_eq!(riassemblaggio_per("Mares", "Sirius"), Riassemblaggio::PacchettoIntero);

        // Gli altri Mares no: per loro libdivecomputer apre `dc_packet_open`,
        // che i pezzi li rimette insieme da sé.
        assert_eq!(riassemblaggio_per("Mares", "Genius"), Riassemblaggio::UnaNotifica);
        assert_eq!(riassemblaggio_per("Mares", "Puck Pro"), Riassemblaggio::UnaNotifica);

        // E soprattutto NON gli Uwatec: unire due notifiche lì infilerebbe un
        // byte di sequenza dentro i dati, in silenzio.
        assert_eq!(riassemblaggio_per("Scubapro", "Aladin Sport Matrix"), Riassemblaggio::UnaNotifica);
        assert_eq!(riassemblaggio_per("Shearwater", "Peregrine"), Riassemblaggio::UnaNotifica);
        // Un'altra marca con lo stesso nome di modello non conta: la marca fa
        // parte della domanda.
        assert_eq!(riassemblaggio_per("Cressi", "Sirius"), Riassemblaggio::UnaNotifica);
    }

    #[test]
    fn senza_notifiche_il_riassunto_lo_dice_con_quelle_parole() {
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, _, riassunto) = apri_flusso(&antenna);
        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        assert!(riassunto().contains("nessuna notifica ricevuta"), "{}", riassunto());
    }
}
