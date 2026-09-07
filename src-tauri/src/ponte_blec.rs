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
    use std::future::Future;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use crate::trasporto_ldc::{
        traduci, trova_descrittore, AccessoriBle, CollegamentoLdc, Contesto, FlussoBle,
        ImmersioneLdc,
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
    #[derive(Clone, Debug)]
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
    fn scegli(
        servizio: &ServizioVisto,
        scrittura: Option<&str>,
        notifica: Option<&str>,
        preferenza: Preferenza,
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
                scegli(servizio, voce.scrittura, voce.notifica, voce.preferenza)?;
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
                scegli(servizio, None, None, Preferenza::Automatica)?;
            let provenienza = format!(
                "servizio riconosciuto dall'elenco di Subsurface («{nome}»), caratteristiche dalle proprietà"
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
                    scegli(uno, None, None, Preferenza::Automatica)?;
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

    /// Quanti byte per scrittura.
    ///
    /// Venti è il pavimento: l'MTU minimo di ATT è 23 byte, meno tre di
    /// intestazione. Un collegamento vero ne negozia quasi sempre di più, ma un
    /// MTU più grande rende il trasferimento più veloce, mai più corretto —
    /// mentre scrivere più di quanto il collegamento regge fallisce, e fallisce
    /// alla prima scrittura. Spezzare qui è sicuro per i protocolli che
    /// conosciamo: i comandi Uwatec stanno in otto byte e non vengono mai
    /// spezzati, i pacchetti SLIP di Shearwater portano i propri confini
    /// dentro i byte, e per Mares libdivecomputer spezza già da sé a venti
    /// (`dc_packet_open(…, 244, 20)`), quindi qui non cambia niente.
    const BYTE_PER_SCRITTURA: usize = 20;

    /// Quanto si aspetta la conferma di UNA scrittura.
    ///
    /// Non è il timeout del protocollo — quello lo gestisce libdivecomputer — è
    /// solo la garanzia che il thread dello scarico non resti appeso per sempre
    /// se il compito asincrono muore senza dirlo.
    const ATTESA_CONFERMA: Duration = Duration::from_secs(10);

    /// Quante scritture si raccontano una per una nel diario, prima di passare
    /// al riassunto. Le prime sono quelle che contano — il comando di
    /// identificazione, la stretta di mano — e le altre migliaia direbbero
    /// tutte la stessa cosa.
    const SCRITTURE_RACCONTATE: usize = 6;

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
    pub type ChiusuraScrittura = Box<dyn FnMut(&[u8]) -> Result<(), String> + Send>;

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
        /// L'ultima chiamata di scrittura per intero, prima di spezzarla: è
        /// quello che il ripiego sul silenzio rimanda nell'altra modalità.
        ultimo_comando: Vec<u8>,
        prima_scrittura: Option<Instant>,
        /// Quante volte l'ultimo comando è stato rimandato dal ripiego sul
        /// silenzio: non sono scritture di libdivecomputer, e nel riassunto
        /// vanno contate a parte.
        rinvii: usize,
    }

    /// Il canale verso il runtime, con le due operazioni bloccanti sopra.
    ///
    /// **I metodi bloccano il thread chiamante e vanno chiamati SOLO dal thread
    /// dello scarico.** È il motivo per cui il commento in cima al file
    /// insiste tanto: da dentro il runtime andrebbero in panico.
    struct Postino {
        comandi: tauri::async_runtime::Sender<Comando>,
    }

    impl Postino {
        fn scrivi(&self, caratteristica: &str, dati: &[u8], modo: ModoScrittura) -> Result<(), String> {
            let (rispondi, risposta) = std::sync::mpsc::sync_channel(1);
            self.comandi
                .blocking_send(Comando::Scrivi {
                    caratteristica: caratteristica.to_string(),
                    dati: dati.to_vec(),
                    modo,
                    conferma: rispondi,
                })
                .map_err(|_| "il Bluetooth non accetta più scritture".to_string())?;
            match risposta.recv_timeout(ATTESA_CONFERMA) {
                Ok(esito) => esito,
                Err(RecvTimeoutError::Timeout) => {
                    Err("la scrittura sul Bluetooth non è stata confermata entro dieci secondi".into())
                }
                Err(RecvTimeoutError::Disconnected) => {
                    Err("il collegamento Bluetooth si è chiuso durante una scrittura".into())
                }
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
        /// Millisecondi fra la prima scrittura e la prima notifica;
        /// `u64::MAX` finché la prima notifica non arriva.
        prima_notifica_ms: AtomicU64,
        /// I crediti che il computer ha ancora, se il profilo li usa.
        crediti_rimasti: AtomicUsize,
        /// Se il collegamento è caduto da sé.
        caduto: AtomicBool,
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

    /// Tutto quello che serve a costruire un `FlussoBle`, più il contorno.
    pub struct PonteBle {
        /// Le notifiche, una per messaggio. Va dato a `FlussoBle::nuovo`.
        pub entrata: Receiver<Vec<u8>>,
        /// La scrittura. **Va chiamata solo dal thread dello scarico.**
        pub scrittura: ChiusuraScrittura,
        /// Gli accessori (nome, lettura di caratteristiche) e il ripiego sul
        /// silenzio. Vanno dati a `FlussoBle::con_accessori`.
        pub accessori: Box<dyn AccessoriBle>,
        pub su_silenzio: Box<dyn FnMut() -> bool + Send>,
        /// Come è stato scelto il profilo: riga di diario tecnico.
        pub descrizione: String,
        /// Quanti byte sono arrivati finora, per l'avanzamento.
        pub ricevuti: Arc<AtomicUsize>,
        /// Il riassunto dello scambio, da leggere alla fine, comunque sia andata.
        pub riassunto: Box<dyn Fn() -> String + Send + Sync>,
    }

    /// Apre il ponte: collega, sceglie il profilo, si iscrive, avvia lo scrittore.
    ///
    /// È `async` e gira nel runtime: qui dentro non si blocca niente. Il pezzo
    /// bloccante — lo scarico — è il chiamante, su un thread suo.
    pub async fn apri_ponte<A: AntennaBle>(
        antenna: A,
        dispositivo: &str,
        cronista: Cronista,
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
        let contatori = Arc::new(Contatori {
            notifiche: AtomicUsize::new(0),
            ricevuti: ricevuti.clone(),
            prima_notifica_ms: AtomicU64::new(u64::MAX),
            crediti_rimasti: AtomicUsize::new(0),
            caduto: AtomicBool::new(false),
        });

        let alla_caduta = mittente.clone();
        let contatori_caduta = contatori.clone();
        let cronista_caduta = cronista.clone();
        antenna
            .collega(
                dispositivo.to_string(),
                Box::new(move || {
                    contatori_caduta.caduto.store(true, Ordering::SeqCst);
                    cronista_caduta(format!(
                        "il collegamento è caduto da sé, dopo {} notifiche",
                        contatori_caduta.notifiche.load(Ordering::Relaxed)
                    ));
                    if let Ok(mut posto) = alla_caduta.lock() {
                        *posto = None;
                    }
                }),
            )
            .await?;

        let servizi = antenna.servizi(dispositivo.to_string()).await?;
        cronista(format!(
            "servizi annunciati: {}",
            servizi
                .iter()
                .map(|s| format!("{} ({} caratteristiche)", s.uuid, s.caratteristiche.len()))
                .collect::<Vec<_>>()
                .join(", ")
        ));
        let profilo = risolvi_profilo(&servizi)?;

        // Il nome si chiede subito e si tiene: quando libdivecomputer lo
        // vorrà, sarà sul thread dello scarico, dove non si può aspettare il
        // plugin. Se non c'è non è un errore — lo diventa solo per i backend
        // che ne hanno bisogno, e allora lo dicono loro.
        let nome = match antenna.nome(dispositivo.to_string()).await {
            Ok(n) if !n.trim().is_empty() => Some(n),
            Ok(_) => {
                cronista("il dispositivo non annuncia un nome".into());
                None
            }
            Err(motivo) => {
                cronista(format!("il nome del dispositivo non si legge: {motivo}"));
                None
            }
        };

        let scambio = Arc::new(Mutex::new(Scambio {
            modo: profilo.modo,
            alternativa: profilo.alternativa,
            cambiata_per_errore: false,
            scritture: 0,
            byte_scritti: 0,
            ultimo_comando: Vec::new(),
            prima_scrittura: None,
            rinvii: 0,
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
                        let prima = contatori_notifica.crediti_rimasti.fetch_sub(1, Ordering::SeqCst);
                        if prima.saturating_sub(1) == CREDITI_MINIMI {
                            let quanti = CREDITI_INIZIALI - CREDITI_MINIMI;
                            contatori_notifica.crediti_rimasti.fetch_add(quanti, Ordering::SeqCst);
                            let antenna = antenna.clone();
                            let servizio = servizio.clone();
                            let concessione = concessione.clone();
                            let cronista = cronista_notifica.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(motivo) = antenna
                                    .scrivi(servizio, concessione, vec![quanti as u8], ModoScrittura::ConRisposta)
                                    .await
                                {
                                    cronista(format!("la ricarica di {quanti} crediti non è riuscita: {motivo}"));
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
         * riprova lo stesso pezzo. Se fallisce anche così, o se la modalità
         * era già stata cambiata, si fallisce e il diario dice tutte e due le
         * cose. Il caso opposto — scrittura accettata ma computer muto — lo
         * gestisce `su_silenzio`, qui sotto, con lo stesso registro.
         */
        let postino_scrittura = postino.clone();
        let scambio_scrittura = scambio.clone();
        let contatori_scrittura = contatori.clone();
        let cronista_scrittura = cronista.clone();
        let caratteristica_scrittura = profilo.scrittura.clone();
        let scrittura = Box::new(move |dati: &[u8]| -> Result<(), String> {
            let numero = {
                let mut s = scambio_scrittura.lock().map_err(|_| "registro dello scambio guasto")?;
                s.scritture += 1;
                s.byte_scritti += dati.len();
                s.ultimo_comando = dati.to_vec();
                if s.prima_scrittura.is_none() {
                    s.prima_scrittura = Some(Instant::now());
                }
                s.scritture
            };
            for pezzo in dati.chunks(BYTE_PER_SCRITTURA) {
                let modo = scambio_scrittura.lock().map_err(|_| "registro dello scambio guasto")?.modo;
                if let Err(motivo) = postino_scrittura.scrivi(&caratteristica_scrittura, pezzo, modo) {
                    let altro = {
                        let mut s = scambio_scrittura.lock().map_err(|_| "registro dello scambio guasto")?;
                        // Si cambia solo se non è ancora arrivato niente:
                        // dopo la prima risposta la modalità ha dimostrato di
                        // funzionare, e un errore a quel punto è un'altra
                        // cosa (il collegamento caduto, quasi sempre).
                        let mai_risposto = contatori_scrittura.notifiche.load(Ordering::Relaxed) == 0;
                        if s.cambiata_per_errore || !mai_risposto {
                            None
                        } else {
                            s.alternativa.take().inspect(|a| {
                                s.cambiata_per_errore = true;
                                s.modo = *a;
                            })
                        }
                    };
                    let Some(altro) = altro else {
                        cronista_scrittura(format!(
                            "scrittura n. {numero} ({} byte [{}], {}) fallita: {motivo}",
                            dati.len(),
                            anteprima(dati),
                            nome_modo(modo)
                        ));
                        return Err(format!("scrittura n. {numero} ({}): {motivo}", nome_modo(modo)));
                    };
                    cronista_scrittura(format!(
                        "scrittura n. {numero} ({} byte [{}], {}) rifiutata: {motivo}; riprovo {}",
                        dati.len(),
                        anteprima(dati),
                        nome_modo(modo),
                        nome_modo(altro)
                    ));
                    postino_scrittura.scrivi(&caratteristica_scrittura, pezzo, altro).map_err(|seconda| {
                        cronista_scrittura(format!(
                            "scrittura n. {numero} fallita anche {}: {seconda}",
                            nome_modo(altro)
                        ));
                        format!(
                            "scrittura n. {numero}: rifiutata {} ({motivo}) e anche {} ({seconda})",
                            nome_modo(modo),
                            nome_modo(altro)
                        )
                    })?;
                }
            }
            if numero <= SCRITTURE_RACCONTATE {
                let modo = scambio_scrittura.lock().map_err(|_| "registro dello scambio guasto")?.modo;
                cronista_scrittura(format!(
                    "scrittura n. {numero}: {} byte [{}], {}",
                    dati.len(),
                    anteprima(dati),
                    nome_modo(modo)
                ));
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
        let su_silenzio = Box::new(move || -> bool {
            if contatori_silenzio.notifiche.load(Ordering::Relaxed) > 0
                || contatori_silenzio.caduto.load(Ordering::Relaxed)
            {
                return false;
            }
            let (comando, da, a, numero, trascorso) = {
                let Ok(mut s) = scambio_silenzio.lock() else { return false };
                let trascorso = s.prima_scrittura.map(|i| i.elapsed().as_millis()).unwrap_or(0);
                let Some(a) = s.alternativa.take() else {
                    cronista_silenzio(format!(
                        "primo scambio muto: nessuna notifica {trascorso} ms dopo la prima scrittura, \
e la caratteristica accetta solo la modalità {}: niente da ritentare",
                        nome_modo(s.modo)
                    ));
                    return false;
                };
                let da = s.modo;
                s.modo = a;
                s.rinvii += 1;
                (s.ultimo_comando.clone(), da, a, s.scritture, trascorso)
            };
            cronista_silenzio(format!(
                "primo scambio muto: nessuna notifica {trascorso} ms dopo la prima scrittura; \
rimando la scrittura n. {numero} ({} byte [{}]) {} invece che {}",
                comando.len(),
                anteprima(&comando),
                nome_modo(a),
                nome_modo(da)
            ));
            for pezzo in comando.chunks(BYTE_PER_SCRITTURA) {
                if let Err(motivo) = postino_silenzio.scrivi(&caratteristica_silenzio, pezzo, a) {
                    cronista_silenzio(format!("il rinvio {} non è riuscito: {motivo}", nome_modo(a)));
                    return false;
                }
            }
            true
        });

        let riassunto = {
            let scambio = scambio.clone();
            let contatori = contatori.clone();
            Box::new(move || -> String {
                let (scritture, byte_scritti, modo, rinvii) = match scambio.lock() {
                    Ok(s) => (s.scritture, s.byte_scritti, nome_modo(s.modo), s.rinvii),
                    Err(_) => (0, 0, "sconosciuto", 0),
                };
                let rinvii = match rinvii {
                    0 => String::new(),
                    1 => "; 1 rinvio".to_string(),
                    n => format!("; {n} rinvii"),
                };
                let notifiche = contatori.notifiche.load(Ordering::Relaxed);
                let ricevuti = contatori.ricevuti.load(Ordering::Relaxed);
                let prima = contatori.prima_notifica_ms.load(Ordering::Relaxed);
                let prima = if prima == u64::MAX {
                    "nessuna notifica ricevuta".to_string()
                } else {
                    format!("prima notifica dopo {prima} ms")
                };
                let caduto = if contatori.caduto.load(Ordering::Relaxed) {
                    "; il collegamento è caduto da sé"
                } else {
                    ""
                };
                format!(
                    "scambio: {scritture} scritture ({byte_scritti} byte, {modo}{rinvii}), \
{notifiche} notifiche ({ricevuti} byte), {prima}{caduto}"
                )
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
    ) -> Result<Vec<ImmersioneLdc>, String> {
        let PonteBle { entrata, scrittura, accessori, su_silenzio, descrizione, riassunto, .. } =
            ponte;

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

        let flusso = FlussoBle::nuovo(entrata, scrittura).con_accessori(accessori, su_silenzio);
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
        let grezze = match collegamento.scarica(&descrittore) {
            Ok(grezze) => {
                emetti(EventoScarico::Trace { line: riassunto() });
                grezze
            }
            Err(motivo) => {
                let scambio = riassunto();
                emetti(EventoScarico::Trace { line: scambio.clone() });
                return Err(format!("{motivo} — {scambio}"));
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
        Ok(immersioni)
    }

    /// Il giro completo, come lo vede il comando.
    pub async fn scarica(
        app: tauri::AppHandle,
        dispositivo: String,
        marca: String,
        prodotto: String,
    ) -> Result<Vec<ImmersioneLdc>, String> {
        use tauri::Emitter;

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
        let ponte = match apri_ponte(antenna, &dispositivo, cronista).await {
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
        let ricevuti = ponte.ricevuti.clone();
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
            tauri::async_runtime::channel::<Result<Vec<ImmersioneLdc>, String>>(1);
        let manda_dal_thread = manda.clone();
        std::thread::spawn(move || {
            let esito = scarica_bloccante(&manda_dal_thread, ponte, &marca, &prodotto);
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
         * su alcuni firmware impedisce il tentativo successivo.
         */
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
/// — mentre `marca` e `prodotto` sono quelli scelti dall'elenco di
/// `elenca_computer_supportati`, cioè le stesse due stringhe che libdivecomputer
/// usa per i suoi descrittori.
///
/// L'avanzamento arriva dall'evento `scarico-esterno`, con le parole di
/// `DownloadEvent`.
#[cfg(feature = "computer-esterni")]
#[tauri::command]
pub async fn scarica_da_computer_esterno(
    app: tauri::AppHandle,
    dispositivo: String,
    marca: String,
    prodotto: String,
) -> Result<Vec<crate::trasporto_ldc::ImmersioneLdc>, String> {
    dentro::scarica(app, dispositivo, marca, prodotto).await
}

/// Lo stesso comando in una copia compilata senza `computer-esterni`.
///
/// Dice di no, e dice perché. È la risposta vera: questa copia non ha dentro
/// libdivecomputer, quindi non c'è nessun protocollo in più da parlare.
#[cfg(not(feature = "computer-esterni"))]
#[tauri::command]
pub async fn scarica_da_computer_esterno(
    _dispositivo: String,
    _marca: String,
    _prodotto: String,
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
    use crate::trasporto_ldc::{FlussoBle, FlussoByte};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

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
        /// Tutto quello che è stato scritto, in ordine e già spezzato come lo
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
        /// I valori delle caratteristiche leggibili.
        valori: Mutex<HashMap<String, Vec<u8>>>,
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
                valori: Mutex::new(HashMap::new()),
            }))
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
            *self.0.caduta.lock().unwrap() = Some(caduta);
            Ok(())
        }

        async fn servizi(&self, _dispositivo: String) -> Result<Vec<ServizioVisto>, String> {
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
        let ponte = tauri::async_runtime::block_on(apri_ponte(antenna.clone(), "finto-01", diario.cronista()))
            .expect("il ponte deve aprirsi");
        (ponte, diario)
    }

    /// Il ponte già dentro un `FlussoBle` completo, come nello scarico vero.
    fn apri_flusso(antenna: &FintaAntenna) -> (FlussoBle, Diario, Box<dyn Fn() -> String + Send + Sync>) {
        let (ponte, diario) = apri(antenna);
        let PonteBle { entrata, scrittura, accessori, su_silenzio, riassunto, .. } = ponte;
        (FlussoBle::nuovo(entrata, scrittura).con_accessori(accessori, su_silenzio), diario, riassunto)
    }

    // -------------------------------------------------------------- il ponte

    #[test]
    fn quello_che_si_scrive_arriva_al_dispositivo() {
        let antenna = FintaAntenna::con(vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")]);
        let (mut ponte, _) = apri(&antenna);

        (ponte.scrittura)(&[0x05, 0x10, 0x00]).expect("la scrittura deve riuscire");

        assert_eq!(antenna.scritti(), vec![vec![0x05, 0x10, 0x00]]);
    }

    #[test]
    fn una_scrittura_lunga_si_spezza_ma_non_si_perde() {
        /*
         * Venti byte per notifica sono il pavimento dell'MTU. Un comando più
         * lungo va spezzato, e la prova che conta è che i pezzi arrivino tutti e
         * nell'ordine: un byte perso in mezzo a un comando dà un dispositivo che
         * tace, che è il sintomo illeggibile per eccellenza.
         */
        let antenna = FintaAntenna::con(vec![seriale("fdcdeaaa-295d-470e-bf15-04217b7aa0a0")]);
        let (mut ponte, _) = apri(&antenna);

        let lungo: Vec<u8> = (0u8..50).collect();
        (ponte.scrittura)(&lungo).unwrap();

        let scritti = antenna.scritti();
        assert_eq!(scritti.len(), 3, "cinquanta byte in pezzi da venti");
        assert_eq!(scritti.concat(), lungo);
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
            errore.contains("raggiungibile") || errore.contains("chiuso"),
            "messaggio poco chiaro: {errore}"
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
    fn un_servizio_con_due_caratteristiche_scrivibili_non_si_indovina() {
        // Dentro il servizio giusto, ma con due candidate identiche: la tabella
        // deve nominarne una, e finché non lo fa è meglio un errore.
        let servizi = vec![ServizioVisto {
            uuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e".into(),
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
    fn se_la_caratteristica_accetta_una_modalita_sola_non_ce_niente_da_negoziare() {
        let antenna = FintaAntenna::con(vec![seriale_rigida("544e326b-5b72-c6b0-1c46-41c1bc448118", true)])
            .che_rifiuta(ModoScrittura::SenzaRisposta);
        let (mut ponte, diario) = apri(&antenna);

        let errore = (ponte.scrittura)(&[0xc2, 0x8d]).expect_err("senza alternativa si fallisce");
        assert!(errore.contains("scrittura n. 1"), "{errore}");
        assert!(errore.contains("senza conferma"), "{errore}");
        assert!(antenna.scritte().is_empty());
        assert!(diario.contiene("fallita"), "{}", diario.testo());
        assert!(!diario.contiene("riprovo"), "{}", diario.testo());
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
        assert!(errore.contains("scrittura n. 2"), "{errore}");
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
        assert!(diario.contiene("rimando la scrittura n. 1"), "{}", diario.testo());

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
        assert!(!(ponte.su_silenzio)(), "dopo una notifica non si rimanda");
        assert_eq!(antenna.scritte().len(), 1);

        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut ponte, diario) = apri(&antenna);
        (ponte.scrittura)(&[0xc2, 0x8d]).unwrap();
        antenna.fai_cadere();
        assert!(!(ponte.su_silenzio)(), "su un collegamento caduto non si rimanda");
        assert!(!diario.contiene("rimando"), "{}", diario.testo());
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

        // I crediti in arrivo dal computer si raccontano la prima volta e basta.
        antenna.notifica_da(TELIT_CREDITI_TX, &[0x10]);
        antenna.notifica_da(TELIT_CREDITI_TX, &[0x10]);
        assert_eq!(diario.righe().iter().filter(|r| r.contains("ci concede crediti")).count(), 1);
        assert_eq!(ponte.ricevuti.load(Ordering::Relaxed), 222 * 20, "i crediti non sono dati");
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
        let errore = tauri::async_runtime::block_on(apri_ponte(antenna, "finto-01", diario.cronista()))
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
        assert!(r.contains("1 notifiche (20 byte)"), "{r}");
        assert!(r.contains("prima notifica dopo"), "{r}");
        assert!(diario.contiene("ms dopo la prima scrittura"), "{}", diario.testo());
    }

    #[test]
    fn senza_notifiche_il_riassunto_lo_dice_con_quelle_parole() {
        let antenna = FintaAntenna::con(vec![seriale("544e326b-5b72-c6b0-1c46-41c1bc448118")]);
        let (mut flusso, _, riassunto) = apri_flusso(&antenna);
        flusso.scrivi(&[0xc2, 0x8d]).unwrap();
        assert!(riassunto().contains("nessuna notifica ricevuta"), "{}", riassunto());
    }
}
