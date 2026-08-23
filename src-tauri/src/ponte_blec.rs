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
//! ogni costruttore ha il suo. Qui la risposta arriva da due strade in fila —
//! una tabella dei profili noti, e un ripiego che guarda cosa il dispositivo
//! annuncia. Il ripiego è un'euristica dichiarata, e quando sbaglia lo dice il
//! silenzio: si scrive su una caratteristica che nessuno legge, il computer non
//! risponde, e lo scarico si ferma con «tempo scaduto» senza aver scritto niente
//! sul computer. È il guasto meno grave possibile, ed è deliberato.

// ------------------------------------------------------------------ il ponte

#[cfg(feature = "computer-esterni")]
mod dentro {
    use std::future::Future;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use crate::trasporto_ldc::{
        traduci, trova_descrittore, CollegamentoLdc, Contesto, FlussoBle, ImmersioneLdc,
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

    /// Cosa il profilo CHIEDE, prima di guardare il dispositivo.
    ///
    /// `Automatica` significa «senza conferma se la caratteristica lo permette,
    /// con conferma altrimenti», ed è la scelta giusta quando il dispositivo
    /// vero non l'ha mai visto nessuno: le due modalità non sono
    /// intercambiabili a livello GATT, e scrivere «senza risposta» dove è
    /// dichiarato solo «write» fallisce alla PRIMA scrittura.
    // `ConRisposta` non è usata da nessuna delle due voci di oggi, e resta:
    // togliere una delle tre possibilità perché al momento non serve
    // significherebbe che chi aggiunge il primo computer che la vuole deve prima
    // rimetterla, e nel frattempo è tentato di scrivere «automatica» e sperare.
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
        /// **Su quale computer questa voce è stata verificata davvero.**
        ///
        /// `None` non è un campo dimenticato: è una dichiarazione, e finisce
        /// nella riga di diario che l'interfaccia mostra. Una voce mai provata
        /// che si spaccia per provata è peggio di una voce assente, perché
        /// quando il computer tace nessuno sa se è colpa del profilo.
        verificato_su: Option<&'static str>,
    }

    /// I profili che conosciamo.
    ///
    /// Nasce con due voci — le stesse due che i driver scritti in casa usano, e
    /// gli UUID sono COPIATI da `src/core/ble/drivers/`, non ricavati altrove —
    /// ed è fatta per crescere: una riga per famiglia, e un commento che dice su
    /// che cosa è stata verificata.
    ///
    /// Le caratteristiche restano da scoprire (`None`) in entrambe, e non per
    /// pigrizia: dentro un servizio proprietario gli UUID delle caratteristiche
    /// cambiano da modello a modello e da firmware a firmware, mentre le
    /// PROPRIETÀ no — quella su cui si scrive dichiara «write», quella da cui si
    /// legge dichiara «notify». Scoprire regge su tutta la famiglia di un
    /// costruttore; scrivere gli UUID a mano regge su un modello solo. Resta
    /// possibile scriverli per i casi in cui un servizio ne espone più di una.
    const PROFILI: &[VoceProfilo] = &[
        VoceProfilo {
            // La famiglia Peregrine/Perdix/Petrel/Teric/Tern. Il Perdix 3 usa un
            // altro servizio E un altro protocollo: non è questo, e riconoscerlo
            // qui sarebbe peggio che ignorarlo.
            servizio: "fe25c237-0ece-443c-b0aa-e02033e7029d",
            scrittura: None,
            notifica: None,
            // Verificata col computer in mano: il Peregrine vuole «senza
            // conferma», ed è quello che dichiara anche il driver in TypeScript.
            preferenza: Preferenza::SenzaRisposta,
            verificato_su: Some("Shearwater Peregrine"),
        },
        VoceProfilo {
            // La «seriale su BLE» di Scubapro/Uwatec: Aladin Matrix, A1, A2, G2,
            // G3, Luna 2.
            servizio: "fdcdeaaa-295d-470e-bf15-04217b7aa0a0",
            scrittura: None,
            notifica: None,
            // ⚠️ Automatica, e resta automatica: il servizio è verificato
            // sull'Aladin, la MODALITÀ DI SCRITTURA no — quella caratteristica
            // non l'ha mai guardata nessuno da vicino. Inchiodarla a una delle
            // due sarebbe indovinare, e l'errore si vedrebbe alla prima
            // scrittura sotto forma di silenzio.
            preferenza: Preferenza::Automatica,
            verificato_su: Some(
                "Scubapro Aladin Sport Matrix (servizio; la modalità di scrittura no)",
            ),
        },
    ];

    /// Il profilo scelto, pronto da usare.
    #[derive(Clone, Debug)]
    pub struct ProfiloRisolto {
        pub servizio: String,
        pub scrittura: String,
        pub notifica: String,
        pub modo: ModoScrittura,
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

    /// I servizi standard, che non sono mai quello giusto.
    ///
    /// Servono al ripiego: se uno di questi finisse fra i candidati, la scelta
    /// diventerebbe ambigua e verrebbe rifiutata una situazione che ambigua non
    /// è. Sono pochi e noti — accesso generico, attributi, ora corrente,
    /// informazioni sul dispositivo, batteria, HID — più il servizio di
    /// aggiornamento firmware di Nordic, che è scrivibile e notifica e sta
    /// addosso a mezzo mondo del BLE.
    const SERVIZI_DI_SISTEMA: &[&str] = &[
        "00001800-0000-1000-8000-00805f9b34fb",
        "00001801-0000-1000-8000-00805f9b34fb",
        "00001805-0000-1000-8000-00805f9b34fb",
        "0000180a-0000-1000-8000-00805f9b34fb",
        "0000180f-0000-1000-8000-00805f9b34fb",
        "00001812-0000-1000-8000-00805f9b34fb",
        "0000fe59-0000-1000-8000-00805f9b34fb",
        "00001530-1212-efde-1523-785feabcd123",
    ];

    fn di_sistema(servizio: &str) -> bool {
        SERVIZI_DI_SISTEMA.iter().any(|s| uguale(s, servizio))
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
    ) -> Result<(CaratteristicaVista, CaratteristicaVista, ModoScrittura), String> {
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
                .filter(|c| c.scrivibile || c.scrivibile_senza_risposta)
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
                .filter(|c| c.notifica)
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
        Ok((da_scrivere, da_ascoltare, modo))
    }

    fn nome_modo(modo: ModoScrittura) -> &'static str {
        match modo {
            ModoScrittura::ConRisposta => "con conferma",
            ModoScrittura::SenzaRisposta => "senza conferma",
        }
    }

    /// A quale servizio parlare: prima la tabella, poi il ripiego.
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
    /// e da lì si aggiunge la voce giusta alla tabella.
    pub fn risolvi_profilo(servizi: &[ServizioVisto]) -> Result<ProfiloRisolto, String> {
        for voce in PROFILI {
            let Some(servizio) = servizi.iter().find(|s| uguale(&s.uuid, voce.servizio)) else {
                continue;
            };
            let (scrittura, notifica, modo) =
                scegli(servizio, voce.scrittura, voce.notifica, voce.preferenza)?;
            let provenienza = match voce.verificato_su {
                Some(su) => format!("profilo noto, verificato su {su}"),
                None => "profilo noto ma MAI VERIFICATO SU NESSUN COMPUTER".to_string(),
            };
            return Ok(ProfiloRisolto {
                descrizione: format!(
                    "{provenienza}; servizio {}, scrittura {} ({}), notifiche {}",
                    servizio.uuid,
                    scrittura.uuid,
                    nome_modo(modo),
                    notifica.uuid
                ),
                servizio: servizio.uuid.clone(),
                scrittura: scrittura.uuid,
                notifica: notifica.uuid,
                modo,
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
                let (scrittura, notifica, modo) =
                    scegli(uno, None, None, Preferenza::Automatica)?;
                Ok(ProfiloRisolto {
                    descrizione: format!(
                        "RIPIEGO (euristica, nessun profilo noto): unico servizio con una \
caratteristica scrivibile e una che notifica; servizio {}, scrittura {} ({}), notifiche {}",
                        uno.uuid,
                        scrittura.uuid,
                        nome_modo(modo),
                        notifica.uuid
                    ),
                    servizio: uno.uuid.clone(),
                    scrittura: scrittura.uuid,
                    notifica: notifica.uuid,
                    modo,
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
sbagliato: va aggiunta una voce alla tabella dei profili.",
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

        /// Si iscrive alle notifiche. Ogni notifica va passata ad `arrivata`
        /// **intera**: i confini fra una notifica e l'altra sono dati, non
        /// rumore — vedi il commento di `FlussoBle::leggi`.
        fn iscrivi(
            &self,
            profilo: ProfiloRisolto,
            arrivata: Box<dyn Fn(Vec<u8>) + Send + Sync>,
        ) -> impl Future<Output = Result<(), String>> + Send;

        fn scrivi(
            &self,
            profilo: ProfiloRisolto,
            dati: Vec<u8>,
        ) -> impl Future<Output = Result<(), String>> + Send;

        fn scollega(&self) -> impl Future<Output = Result<(), String>> + Send;
    }

    // --------------------------------------------------------------- il ponte

    /// Quanti byte per scrittura.
    ///
    /// Venti è il pavimento: l'MTU minimo di ATT è 23 byte, meno tre di
    /// intestazione. Un collegamento vero ne negozia quasi sempre di più, ma un
    /// MTU più grande rende il trasferimento più veloce, mai più corretto —
    /// mentre scrivere più di quanto il collegamento regge fallisce, e fallisce
    /// alla prima scrittura. Spezzare qui è sicuro per entrambi i protocolli che
    /// conosciamo: i comandi Uwatec stanno in otto byte e non vengono mai
    /// spezzati, e i pacchetti SLIP di Shearwater portano i propri confini
    /// dentro i byte, quindi non hanno nulla da perdere.
    const BYTE_PER_SCRITTURA: usize = 20;

    /// Quanto si aspetta la conferma di UNA scrittura.
    ///
    /// Non è il timeout del protocollo — quello lo gestisce libdivecomputer — è
    /// solo la garanzia che il thread dello scarico non resti appeso per sempre
    /// se il compito asincrono muore senza dirlo.
    const ATTESA_CONFERMA: Duration = Duration::from_secs(10);

    /// Una scrittura in viaggio verso il runtime, con la busta per la risposta.
    struct Comando {
        dati: Vec<u8>,
        conferma: std::sync::mpsc::SyncSender<Result<(), String>>,
    }

    /// La chiusura che `FlussoBle` usa per scrivere.
    ///
    /// Ha un nome suo solo per leggibilità: è la stessa forma che
    /// `FlussoBle::nuovo` si aspetta, e cambiarla qui vorrebbe dire cambiarla lì.
    pub type ChiusuraScrittura = Box<dyn FnMut(&[u8]) -> Result<(), String> + Send>;

    /// Tutto quello che serve a costruire un `FlussoBle`, più il contorno.
    pub struct PonteBle {
        /// Le notifiche, una per messaggio. Va dato a `FlussoBle::nuovo`.
        pub entrata: Receiver<Vec<u8>>,
        /// La scrittura. **Va chiamata solo dal thread dello scarico.**
        pub scrittura: ChiusuraScrittura,
        /// Come è stato scelto il profilo: riga di diario tecnico.
        pub descrizione: String,
        /// Quanti byte sono arrivati finora.
        ///
        /// Serve all'avanzamento: i protocolli tipo Uwatec chiedono al computer
        /// quanti byte ha e poi li ricevono tutti in un blocco solo, quindi per
        /// minuti non c'è nessun altro segno di vita da mostrare. Un'interfaccia
        /// ferma che non dice niente è indistinguibile da una bloccata.
        pub ricevuti: Arc<AtomicUsize>,
    }

    /// Apre il ponte: collega, sceglie il profilo, si iscrive, avvia lo scrittore.
    ///
    /// È `async` e gira nel runtime: qui dentro non si blocca niente. Il pezzo
    /// bloccante — lo scarico — è il chiamante, su un thread suo.
    pub async fn apri_ponte<A: AntennaBle>(
        antenna: A,
        dispositivo: &str,
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

        let alla_caduta = mittente.clone();
        antenna
            .collega(
                dispositivo.to_string(),
                Box::new(move || {
                    if let Ok(mut posto) = alla_caduta.lock() {
                        *posto = None;
                    }
                }),
            )
            .await?;

        let servizi = antenna.servizi(dispositivo.to_string()).await?;
        let profilo = risolvi_profilo(&servizi)?;

        let ricevuti = Arc::new(AtomicUsize::new(0));
        let contatore = ricevuti.clone();
        let alla_notifica = mittente.clone();
        antenna
            .iscrivi(
                profilo.clone(),
                Box::new(move |dati: Vec<u8>| {
                    contatore.fetch_add(dati.len(), Ordering::Relaxed);
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
        let profilo_scrittore = profilo.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(comando) = in_arrivo.recv().await {
                let esito = antenna
                    .scrivi(profilo_scrittore.clone(), comando.dati)
                    .await;
                // Se chi aspettava non c'è più (ha rinunciato per scadenza) non
                // è un errore: il comando è comunque partito.
                let _ = comando.conferma.send(esito);
            }
            // Il canale si chiude quando la chiusura di scrittura cade, cioè
            // quando `FlussoBle` viene distrutto alla fine dello scarico: da lì
            // in poi questo compito non ha più niente da fare e finisce da sé.
        });

        let descrizione = profilo.descrizione.clone();
        let scrittura = Box::new(move |dati: &[u8]| -> Result<(), String> {
            for pezzo in dati.chunks(BYTE_PER_SCRITTURA) {
                let (rispondi, risposta) = std::sync::mpsc::sync_channel(1);
                /*
                 * `blocking_send` e `recv_timeout` bloccano il thread chiamante.
                 * È corretto QUI e solo qui: siamo sul thread dello scarico, che
                 * esiste apposta per bloccarsi. Chiamare questa chiusura da
                 * dentro il runtime andrebbe in panico, ed è il motivo per cui
                 * il commento in cima al file insiste tanto.
                 */
                comandi
                    .blocking_send(Comando { dati: pezzo.to_vec(), conferma: rispondi })
                    .map_err(|_| "il Bluetooth non accetta più scritture".to_string())?;
                match risposta.recv_timeout(ATTESA_CONFERMA) {
                    Ok(esito) => esito?,
                    Err(RecvTimeoutError::Timeout) => {
                        return Err("la scrittura sul Bluetooth non è stata confermata".into())
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        return Err("il collegamento Bluetooth si è chiuso durante una scrittura"
                            .into())
                    }
                }
            }
            Ok(())
        });

        Ok(PonteBle { entrata, scrittura, descrizione, ricevuti })
    }

    // ------------------------------------------------- l'antenna vera, il plugin

    /// `tauri-plugin-blec` visto attraverso il tratto.
    ///
    /// È l'UNICO punto del progetto che conosce le firme del plugin. Della
    /// versione 0.12 si usano: `get_handler`, `Handler::connect`,
    /// `Handler::discover_services`, `Handler::subscribe`, `Handler::send_data`,
    /// `Handler::disconnect`, più `OnDisconnectHandler::from_sync` e i tipi di
    /// `models`.
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

        async fn iscrivi(
            &self,
            profilo: ProfiloRisolto,
            arrivata: Box<dyn Fn(Vec<u8>) + Send + Sync>,
        ) -> Result<(), String> {
            let handler = maniglia()?;
            let notifica = uuid(&profilo.notifica, "delle notifiche")?;
            let servizio = uuid(&profilo.servizio, "del servizio")?;
            handler
                .subscribe(notifica, Some(servizio), arrivata)
                .await
                .map_err(|e| format!("le notifiche non si attivano: {e}"))
        }

        async fn scrivi(&self, profilo: ProfiloRisolto, dati: Vec<u8>) -> Result<(), String> {
            let handler = maniglia()?;
            let scrittura = uuid(&profilo.scrittura, "di scrittura")?;
            let servizio = uuid(&profilo.servizio, "del servizio")?;
            handler
                .send_data(scrittura, Some(servizio), &dati, profilo.modo.into())
                .await
                .map_err(|e| format!("scrittura non riuscita: {e}"))
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

    /// Byte in esadecimale, per la chiave dell'immersione e per il diario.
    fn esadecimale(b: &[u8]) -> String {
        b.iter().map(|v| format!("{v:02x}")).collect()
    }

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
        let PonteBle { entrata, scrittura, descrizione, .. } = ponte;

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

        let collegamento = CollegamentoLdc::apri(Box::new(FlussoBle::nuovo(entrata, scrittura)))?;
        emetti(EventoScarico::Progress {
            done: 0,
            total: None,
            label: "lettura della memoria del computer".into(),
        });

        let grezze = collegamento.scarica(&descrittore)?;
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
                esadecimale(&grezza.impronta)
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
        let ponte = apri_ponte(antenna, &dispositivo).await?;

        /*
         * IL CRONISTA: un thread che ogni mezzo secondo dice quanti byte sono
         * arrivati.
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
/// collegamento caduto diventi un errore leggibile invece di un'attesa muta, e
/// che la scelta del servizio faccia quello che dice di fare. Resta fuori solo
/// l'ultimo miglio, che ha bisogno di un computer subacqueo acceso.
///
/// **Il finto vive nel modello di `FintoAladin`** di `trasporto_ldc.rs`: uno
/// stato condiviso che si può interrogare dopo, e che si comporta come il vero
/// nei punti in cui il vero è scomodo.
#[cfg(all(test, feature = "computer-esterni"))]
mod prove {
    use super::dentro::*;
    use crate::trasporto_ldc::{FlussoBle, FlussoByte};
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

    /// Un servizio «seriale su BLE» come lo espone mezzo mondo: una
    /// caratteristica su cui si scrive, una che notifica.
    fn seriale(servizio: &str) -> ServizioVisto {
        ServizioVisto {
            uuid: servizio.to_string(),
            caratteristiche: vec![
                car("11111111-0000-1000-8000-00805f9b34fb", true, true, false),
                car("22222222-0000-1000-8000-00805f9b34fb", false, false, true),
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

    // ------------------------------------------------------- l'antenna finta

    /// La callback delle notifiche, come il ponte la consegna.
    type Ascoltatore = Box<dyn Fn(Vec<u8>) + Send + Sync>;

    struct Interno {
        servizi: Vec<ServizioVisto>,
        /// Tutto quello che è stato scritto, in ordine e già spezzato come lo
        /// riceverebbe il dispositivo.
        scritti: Mutex<Vec<Vec<u8>>>,
        /// Dove versare le notifiche, appena qualcuno si iscrive.
        notifica: Mutex<Option<Ascoltatore>>,
        /// Cosa chiamare per far cadere il collegamento.
        caduta: Mutex<Option<Box<dyn FnOnce() + Send>>>,
        /// Il profilo con cui ci si è iscritti: serve a controllare la scelta.
        profilo: Mutex<Option<ProfiloRisolto>>,
        scollegata: AtomicBool,
        /// Se acceso, ogni scrittura fallisce: è il computer che non c'è più.
        scrittura_guasta: AtomicBool,
    }

    #[derive(Clone)]
    struct FintaAntenna(Arc<Interno>);

    impl FintaAntenna {
        fn con(servizi: Vec<ServizioVisto>) -> Self {
            Self(Arc::new(Interno {
                servizi,
                scritti: Mutex::new(Vec::new()),
                notifica: Mutex::new(None),
                caduta: Mutex::new(None),
                profilo: Mutex::new(None),
                scollegata: AtomicBool::new(false),
                scrittura_guasta: AtomicBool::new(false),
            }))
        }

        /// Manda una notifica come farebbe il dispositivo.
        fn notifica(&self, dati: &[u8]) {
            let presa = self.0.notifica.lock().unwrap();
            let callback = presa.as_ref().expect("nessuno si è iscritto alle notifiche");
            callback(dati.to_vec());
        }

        /// Il collegamento cade da sé, a metà scarico.
        fn fai_cadere(&self) {
            self.0.scrittura_guasta.store(true, Ordering::SeqCst);
            if let Some(caduta) = self.0.caduta.lock().unwrap().take() {
                caduta();
            }
        }

        fn scritti(&self) -> Vec<Vec<u8>> {
            self.0.scritti.lock().unwrap().clone()
        }

        fn profilo(&self) -> ProfiloRisolto {
            self.0.profilo.lock().unwrap().clone().expect("nessun profilo risolto")
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

        async fn iscrivi(
            &self,
            profilo: ProfiloRisolto,
            arrivata: Box<dyn Fn(Vec<u8>) + Send + Sync>,
        ) -> Result<(), String> {
            *self.0.profilo.lock().unwrap() = Some(profilo);
            *self.0.notifica.lock().unwrap() = Some(arrivata);
            Ok(())
        }

        async fn scrivi(&self, _profilo: ProfiloRisolto, dati: Vec<u8>) -> Result<(), String> {
            // Un collegamento caduto non accetta più scritture, e lo dice: è la
            // metà in scrittura del guasto che la prova qui sotto verifica.
            if self.0.scrittura_guasta.load(Ordering::SeqCst) {
                return Err("il dispositivo non è più raggiungibile".into());
            }
            self.0.scritti.lock().unwrap().push(dati);
            Ok(())
        }

        async fn scollega(&self) -> Result<(), String> {
            self.0.scollegata.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    /// Apre il ponte dal thread della prova.
    ///
    /// **`block_on` sta QUI e non nel codice.** Aprire è asincrono e non blocca
    /// niente; quello che segue — scrivere, leggere — va fatto FUORI dal
    /// `block_on`, cioè sul thread della prova, che è il posto del thread dello
    /// scarico. Chiamare la chiusura di scrittura da dentro il runtime andrebbe
    /// in panico, ed è esattamente la disciplina che il codice vero rispetta.
    fn apri(antenna: &FintaAntenna) -> PonteBle {
        tauri::async_runtime::block_on(apri_ponte(antenna.clone(), "finto-01"))
            .expect("il ponte deve aprirsi")
    }

    // -------------------------------------------------------------- il ponte

    #[test]
    fn quello_che_si_scrive_arriva_al_dispositivo() {
        let antenna = FintaAntenna::con(vec![informativo(), seriale("fe25c237-0ece-443c-b0aa-e02033e7029d")]);
        let mut ponte = apri(&antenna);

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
        let mut ponte = apri(&antenna);

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
        let ponte = apri(&antenna);

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
        let ponte = apri(&antenna);

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
        let ponte = apri(&antenna);
        let scrittura = ponte.scrittura;
        let mut flusso = FlussoBle::nuovo(ponte.entrata, scrittura);

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
        let _ponte = apri(&antenna);

        let profilo = antenna.profilo();
        assert_eq!(profilo.servizio, "fe25c237-0ece-443c-b0aa-e02033e7029d");
        assert_eq!(profilo.modo, ModoScrittura::SenzaRisposta);
        assert!(profilo.descrizione.contains("Peregrine"), "{}", profilo.descrizione);
        assert!(!profilo.descrizione.contains("RIPIEGO"), "{}", profilo.descrizione);
    }

    #[test]
    fn il_ripiego_sceglie_il_solo_servizio_che_puo_parlare_e_lo_dichiara() {
        /*
         * Un computer che non conosciamo: nessun profilo in tabella, un solo
         * servizio con la forma di una seriale su BLE. Si prova, e si SCRIVE nel
         * diario che è un'euristica — perché se poi il computer tace, chi legge
         * deve sapere che la scelta era un'ipotesi.
         */
        let servizi = vec![
            informativo(),
            ServizioVisto {
                uuid: "0000180f-0000-1000-8000-00805f9b34fb".into(),
                caratteristiche: vec![car("00002a19-0000-1000-8000-00805f9b34fb", false, false, true)],
            },
            seriale("6e400001-b5a3-f393-e0a9-e50e24dcca9e"),
        ];
        let profilo = risolvi_profilo(&servizi).expect("il ripiego deve riuscire");

        assert_eq!(profilo.servizio, "6e400001-b5a3-f393-e0a9-e50e24dcca9e");
        assert_eq!(profilo.scrittura, "11111111-0000-1000-8000-00805f9b34fb");
        assert_eq!(profilo.notifica, "22222222-0000-1000-8000-00805f9b34fb");
        assert!(profilo.descrizione.contains("RIPIEGO"), "{}", profilo.descrizione);
    }

    #[test]
    fn il_ripiego_ambiguo_rifiuta_invece_di_indovinare() {
        // Due servizi plausibili. Sceglierne uno a caso significa scrivere
        // comandi a un servizio sbagliato: meglio un messaggio che un pomeriggio.
        let servizi = vec![
            seriale("6e400001-b5a3-f393-e0a9-e50e24dcca9e"),
            seriale("0000ffe0-0000-1000-8000-00805f9b34fb"),
        ];
        let errore = risolvi_profilo(&servizi).expect_err("due candidati devono essere rifiutati");
        assert!(errore.contains("6e400001-b5a3-f393-e0a9-e50e24dcca9e"), "{errore}");
        assert!(errore.contains("0000ffe0-0000-1000-8000-00805f9b34fb"), "{errore}");
        assert!(errore.contains("tabella dei profili"), "{errore}");
    }

    #[test]
    fn senza_nessun_candidato_il_ripiego_rifiuta_e_dice_cosa_ha_visto() {
        let servizi = vec![informativo()];
        let errore = risolvi_profilo(&servizi).expect_err("nessun candidato: si rifiuta");
        assert!(errore.contains("0000180a-0000-1000-8000-00805f9b34fb"), "{errore}");
    }

    #[test]
    fn i_servizi_di_sistema_non_confondono_il_ripiego() {
        /*
         * L'aggiornamento firmware di Nordic è scrivibile e notifica, e sta
         * addosso a mezzo mondo del BLE: senza l'elenco dei servizi di sistema
         * renderebbe ambiguo ogni dispositivo che lo espone, e il ripiego non
         * funzionerebbe mai dove serve.
         */
        let servizi = vec![
            seriale("0000fe59-0000-1000-8000-00805f9b34fb"),
            seriale("6e400001-b5a3-f393-e0a9-e50e24dcca9e"),
        ];
        let profilo = risolvi_profilo(&servizi).expect("il servizio di sistema va ignorato");
        assert_eq!(profilo.servizio, "6e400001-b5a3-f393-e0a9-e50e24dcca9e");
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
    }

    #[test]
    fn un_servizio_con_due_caratteristiche_scrivibili_non_si_indovina() {
        // Dentro il servizio giusto, ma con due candidate identiche: la tabella
        // deve nominarne una, e finché non lo fa è meglio un errore.
        let servizi = vec![ServizioVisto {
            uuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e".into(),
            caratteristiche: vec![
                car("11111111-0000-1000-8000-00805f9b34fb", true, true, false),
                car("33333333-0000-1000-8000-00805f9b34fb", true, true, false),
                car("22222222-0000-1000-8000-00805f9b34fb", false, false, true),
            ],
        }];
        let errore = risolvi_profilo(&servizi).expect_err("due scrivibili: si rifiuta");
        assert!(errore.contains("scrivibili"), "{errore}");
    }

    #[test]
    fn la_modalita_automatica_segue_quello_che_la_caratteristica_dichiara() {
        /*
         * Il profilo Uwatec chiede «automatica» perché quella caratteristica non
         * l'ha mai guardata nessuno. Su una che accetta solo «write» deve uscire
         * «con conferma»: scrivere senza conferma dove il GATT non lo permette
         * fallisce alla PRIMA scrittura, cioè dove il sintomo è identico a «il
         * computer non risponde».
         */
        let servizi = vec![ServizioVisto {
            uuid: "fdcdeaaa-295d-470e-bf15-04217b7aa0a0".into(),
            caratteristiche: vec![
                car("11111111-0000-1000-8000-00805f9b34fb", true, false, false),
                car("22222222-0000-1000-8000-00805f9b34fb", false, false, true),
            ],
        }];
        let profilo = risolvi_profilo(&servizi).unwrap();
        assert_eq!(profilo.modo, ModoScrittura::ConRisposta);

        let servizi = vec![seriale("fdcdeaaa-295d-470e-bf15-04217b7aa0a0")];
        let profilo = risolvi_profilo(&servizi).unwrap();
        assert_eq!(profilo.modo, ModoScrittura::SenzaRisposta);
    }

    #[test]
    fn un_profilo_noto_senza_le_caratteristiche_giuste_e_un_errore_che_si_legge() {
        // Il servizio è quello del Peregrine, ma non c'è niente che notifichi:
        // il computer non avrebbe modo di rispondere, e va detto adesso invece
        // che dopo cinque secondi di silenzio.
        let servizi = vec![ServizioVisto {
            uuid: "fe25c237-0ece-443c-b0aa-e02033e7029d".into(),
            caratteristiche: vec![car("11111111-0000-1000-8000-00805f9b34fb", true, true, false)],
        }];
        let errore = risolvi_profilo(&servizi).expect_err("senza notifiche si rifiuta");
        assert!(errore.contains("notifica"), "{errore}");
    }
}
