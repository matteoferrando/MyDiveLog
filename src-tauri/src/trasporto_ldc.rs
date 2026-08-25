//! Il ponte fra libdivecomputer e il nostro Bluetooth.
//!
//! IL PROBLEMA, in una riga: libdivecomputer chiama in modo **bloccante**, il
//! nostro Bluetooth risponde in modo **asincrono**, e i due non si parlano senza
//! un traduttore.
//!
//! Detto per esteso. libdivecomputer è una libreria C degli anni in cui una
//! porta seriale era una porta seriale: dice `read(16 byte)` e si aspetta di
//! restare ferma finché quei byte non arrivano. `tauri-plugin-blec` invece
//! consegna le notifiche a una callback, quando capita, dentro un runtime
//! asincrono. Non è una differenza di stile: è che se si chiamasse
//! libdivecomputer dentro il runtime, la sua prima lettura bloccherebbe il
//! runtime che deve consegnarle i byte, e resterebbe lì per sempre.
//!
//! LA SOLUZIONE, che è anche l'unica che regge: **libdivecomputer gira su un
//! thread suo.** Le notifiche arrivano dal runtime a quel thread attraverso un
//! canale; le scritture fanno il viaggio inverso. Il thread può bloccarsi quanto
//! vuole, perché non sta bloccando nessuno.
//!
//! PERCHÉ C'È UN TRATTO E NON SI CHIAMA DIRETTAMENTE BLEC. Perché così il ponte
//! si può provare **senza un computer subacqueo e senza Bluetooth**: nei test
//! sotto c'è un flusso finto che rimanda indietro quello che riceve, e si
//! verifica che libdivecomputer legga e scriva davvero attraverso il nostro
//! codice. È la sola parte di questa integrazione che si possa inchiodare senza
//! hardware, e sarebbe un peccato non farlo.
//!
//! COSA C'È E COSA MANCA. C'è il trasporto — libdivecomputer scrive byte che
//! finiscono sul nostro flusso e legge byte che vengono dal nostro flusso — e
//! c'è lo scarico: `dc_device_open`, `dc_device_foreach`, e `traduci()` che
//! passa ogni record al parser della famiglia giusta e ne cava
//! `ImmersioneLdc`. Da lì in poi la palla passa a
//! `src/core/ble/esterni.ts`.
//!
//! MANCA LA PROVA CON UN COMPUTER VERO, e va detto ogni volta perché è l'unica
//! cosa che manca e la più facile da dimenticare: nessun apparecchio di terzi è
//! mai stato collegato a questo codice. Quello che si può inchiodare senza —
//! il trasporto contro un flusso finto, l'accorpamento dei campioni, la
//! traduzione — è inchiodato; il resto è una promessa finché qualcuno non
//! accende un Mares e guarda cosa succede.

#![cfg(feature = "computer-esterni")]

use std::collections::VecDeque;
use std::ffi::{c_int, c_uint, c_void};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

// ------------------------------------------------------------------ il tratto

/// Un flusso di byte bidirezionale, visto da chi parla il protocollo.
///
/// Deliberatamente povero: nessun concetto di pacchetto, di caratteristica o di
/// notifica. libdivecomputer vuole byte, e tutto ciò che sta sopra i byte —
/// riassemblare le notifiche, buttare il byte di sequenza dell'Aladin — è
/// responsabilità di chi implementa questo tratto, non sua.
pub trait FlussoByte: Send {
    fn scrivi(&mut self, dati: &[u8]) -> Result<(), String>;
    /// Fino a `quanti` byte, aspettando al massimo `attesa`.
    ///
    /// Restituire MENO byte del richiesto è legittimo e normale: libdivecomputer
    /// richiama finché non ha finito. Restituirne zero significa che il tempo è
    /// scaduto, e quello è un errore per il chiamante.
    fn leggi(&mut self, quanti: usize, attesa: Duration) -> Result<Vec<u8>, String>;
    /// Quanti byte sono già arrivati e aspettano di essere letti.
    fn disponibili(&mut self) -> usize;
}

// --------------------------------------------------------------- il flusso BLE

/// Il flusso vero: notifiche in entrata da un canale, scritture verso il runtime.
///
/// Non conosce `tauri-plugin-blec` per scelta — riceve una chiusura che scrive.
/// Così questo file non dipende da come è fatto il Bluetooth, e il giorno che il
/// plugin cambia API cambia una riga in chi lo costruisce.
pub struct FlussoBle {
    entrata: Receiver<Vec<u8>>,
    /// Le notifiche arrivate e non ancora consegnate, **ancora separate**.
    arrivate: VecDeque<Vec<u8>>,
    /// Quel che resta della notifica consegnata a metà.
    avanzo: VecDeque<u8>,
    scrittura: Box<dyn FnMut(&[u8]) -> Result<(), String> + Send>,
}

impl FlussoBle {
    pub fn nuovo(
        entrata: Receiver<Vec<u8>>,
        scrittura: Box<dyn FnMut(&[u8]) -> Result<(), String> + Send>,
    ) -> Self {
        Self { entrata, arrivate: VecDeque::new(), avanzo: VecDeque::new(), scrittura }
    }

    /// Svuota il canale senza aspettare. Serve a `disponibili` e prima di leggere.
    fn raccogli_subito(&mut self) {
        while let Ok(pezzo) = self.entrata.try_recv() {
            self.arrivate.push_back(pezzo);
        }
    }
}

impl FlussoByte for FlussoBle {
    fn scrivi(&mut self, dati: &[u8]) -> Result<(), String> {
        (self.scrittura)(dati)
    }

    /// Una lettura restituisce **al massimo una notifica**, mai due unite.
    ///
    /// QUESTA RIGA VALE TUTTO IL FILE, e la prima versione la sbagliava.
    ///
    /// Sembrava naturale trattare il Bluetooth come un flusso continuo di byte e
    /// consegnare a chi legge tutto quello che è arrivato. Il finto Aladin dei
    /// test lo ha smentito subito, e il motivo è nel protocollo: su BLE il
    /// PRIMO byte di ogni notifica non è dato — è una specie di numero di
    /// sequenza — e libdivecomputer lo butta via calcolando
    /// `lunghezza = ricevuti - 1`. Se una lettura consegnasse due notifiche
    /// attaccate, il byte di sequenza della seconda finirebbe **dentro i dati**,
    /// e il byte di sequenza è l'unico che non deve entrarci.
    ///
    /// Il sintomo sarebbe stato quello peggiore: nessun errore, un trasferimento
    /// «riuscito», e un blocco di memoria disallineato in cui i marcatori delle
    /// immersioni non si trovano più — cioè «zero immersioni scaricate» senza
    /// una riga di spiegazione.
    ///
    /// L'avanzo serve al caso opposto: se chi legge chiede MENO di una notifica,
    /// il resto di quella notifica resta lì per la lettura dopo, e non si passa
    /// alla successiva finché non è finita.
    fn leggi(&mut self, quanti: usize, attesa: Duration) -> Result<Vec<u8>, String> {
        if self.avanzo.is_empty() {
            self.raccogli_subito();
            let scadenza = std::time::Instant::now() + attesa;
            while self.arrivate.is_empty() {
                let rimasto = scadenza.saturating_duration_since(std::time::Instant::now());
                if rimasto.is_zero() {
                    break;
                }
                match self.entrata.recv_timeout(rimasto) {
                    Ok(pezzo) => self.arrivate.push_back(pezzo),
                    Err(RecvTimeoutError::Timeout) => break,
                    // Il canale chiuso vuol dire che il Bluetooth se n'è andato:
                    // è un errore, e va distinto da «non è ancora arrivato
                    // niente».
                    Err(RecvTimeoutError::Disconnected) => {
                        return Err("il collegamento Bluetooth si è chiuso".into())
                    }
                }
            }
            match self.arrivate.pop_front() {
                Some(notifica) => self.avanzo.extend(notifica),
                None => return Ok(Vec::new()),
            }
        }
        let quanti = quanti.min(self.avanzo.len());
        Ok(self.avanzo.drain(..quanti).collect())
    }

    fn disponibili(&mut self) -> usize {
        self.raccogli_subito();
        self.avanzo.len() + self.arrivate.iter().map(Vec::len).sum::<usize>()
    }
}

// ------------------------------------------------------- le dichiarazioni C

#[repr(C)]
pub struct DcContext {
    _vuoto: [u8; 0],
}
#[repr(C)]
pub struct DcIostream {
    _vuoto: [u8; 0],
}

/// Gli stati di libdivecomputer che ci servono. Il resto sono errori e basta.
const DC_STATUS_SUCCESS: c_int = 0;
const DC_STATUS_IO: c_int = -6;
const DC_STATUS_TIMEOUT: c_int = -7;
const DC_TRANSPORT_BLE: c_uint = 1 << 5;

/// **L'ORDINE DEI CAMPI È QUELLO DI `custom.h` E NON PUÒ CAMBIARE.**
///
/// È una tabella di puntatori a funzione letta dal C per posizione: un campo
/// fuori posto non dà un errore di compilazione, dà una chiamata alla funzione
/// sbagliata — cioè un crollo, o peggio, un comportamento assurdo. I campi che
/// non ci servono restano `None`, che in un `Option<extern "C" fn>` è
/// garantito essere un puntatore nullo, ed è esattamente quello che
/// libdivecomputer si aspetta di trovare.
#[repr(C)]
struct DcCustomCbs {
    set_timeout: Option<extern "C" fn(*mut c_void, c_int) -> c_int>,
    set_break: Option<extern "C" fn(*mut c_void, c_uint) -> c_int>,
    set_dtr: Option<extern "C" fn(*mut c_void, c_uint) -> c_int>,
    set_rts: Option<extern "C" fn(*mut c_void, c_uint) -> c_int>,
    get_lines: Option<extern "C" fn(*mut c_void, *mut c_uint) -> c_int>,
    get_available: Option<extern "C" fn(*mut c_void, *mut usize) -> c_int>,
    configure: Option<extern "C" fn(*mut c_void, c_uint, c_uint, c_int, c_int, c_int) -> c_int>,
    poll: Option<extern "C" fn(*mut c_void, c_int) -> c_int>,
    read: Option<extern "C" fn(*mut c_void, *mut c_void, usize, *mut usize) -> c_int>,
    write: Option<extern "C" fn(*mut c_void, *const c_void, usize, *mut usize) -> c_int>,
    ioctl: Option<extern "C" fn(*mut c_void, c_uint, *mut c_void, usize) -> c_int>,
    flush: Option<extern "C" fn(*mut c_void) -> c_int>,
    purge: Option<extern "C" fn(*mut c_void, c_int) -> c_int>,
    sleep: Option<extern "C" fn(*mut c_void, c_uint) -> c_int>,
    close: Option<extern "C" fn(*mut c_void) -> c_int>,
}

#[repr(C)]
pub struct DcDescriptor {
    _vuoto: [u8; 0],
}
#[repr(C)]
pub struct DcDevice {
    _vuoto: [u8; 0],
}
#[repr(C)]
struct DcIterator {
    _vuoto: [u8; 0],
}

/// Quello che libdivecomputer chiama per ogni immersione trovata.
///
/// Restituire 0 significa «basta così»: è il modo in cui si interrompe uno
/// scarico a metà senza che sia un errore.
type DcDiveCallback = extern "C" fn(
    dati: *const u8,
    dimensione: c_uint,
    impronta: *const u8,
    dimensione_impronta: c_uint,
    userdata: *mut c_void,
) -> c_int;

extern "C" {
    fn dc_context_new(context: *mut *mut DcContext) -> c_int;
    fn dc_context_free(context: *mut DcContext) -> c_int;
    fn dc_custom_open(
        iostream: *mut *mut DcIostream,
        context: *mut DcContext,
        transport: c_uint,
        callbacks: *const DcCustomCbs,
        userdata: *mut c_void,
    ) -> c_int;
    fn dc_iostream_read(
        iostream: *mut DcIostream,
        data: *mut c_void,
        size: usize,
        actual: *mut usize,
    ) -> c_int;
    fn dc_iostream_write(
        iostream: *mut DcIostream,
        data: *const c_void,
        size: usize,
        actual: *mut usize,
    ) -> c_int;
    fn dc_iostream_set_timeout(iostream: *mut DcIostream, timeout: c_int) -> c_int;
    fn dc_iostream_close(iostream: *mut DcIostream) -> c_int;

    fn dc_descriptor_iterator_new(iterator: *mut *mut DcIterator, context: *mut DcContext) -> c_int;
    fn dc_iterator_next(iterator: *mut DcIterator, item: *mut *mut DcDescriptor) -> c_int;
    fn dc_iterator_free(iterator: *mut DcIterator) -> c_int;
    fn dc_descriptor_get_vendor(descriptor: *mut DcDescriptor) -> *const std::ffi::c_char;
    fn dc_descriptor_get_product(descriptor: *mut DcDescriptor) -> *const std::ffi::c_char;
    fn dc_descriptor_free(descriptor: *mut DcDescriptor) -> c_int;

    fn dc_device_open(
        out: *mut *mut DcDevice,
        context: *mut DcContext,
        descriptor: *mut DcDescriptor,
        iostream: *mut DcIostream,
    ) -> c_int;
    fn dc_device_foreach(
        device: *mut DcDevice,
        callback: DcDiveCallback,
        userdata: *mut c_void,
    ) -> c_int;
    fn dc_device_close(device: *mut DcDevice) -> c_int;
}

// ------------------------------------------------- le callback viste dal C

/// Quello che sta dietro il `void *userdata` che gira dentro libdivecomputer.
struct Stato {
    flusso: Box<dyn FlussoByte>,
    /// L'attesa impostata da `set_timeout`. Negativa vuol dire «per sempre»,
    /// che qui diventa un minuto: aspettare davvero per sempre significa
    /// un'applicazione che non si chiude più.
    attesa: Duration,
}

/// Riprende lo stato dal puntatore opaco.
///
/// SICUREZZA: il puntatore è quello che abbiamo dato noi a `dc_custom_open`, e
/// lo `Stato` resta vivo finché non chiamiamo `chiudi`, che è l'unico posto in
/// cui viene distrutto.
unsafe fn stato<'a>(userdata: *mut c_void) -> &'a mut Stato {
    &mut *(userdata as *mut Stato)
}

extern "C" fn cb_set_timeout(userdata: *mut c_void, timeout: c_int) -> c_int {
    let s = unsafe { stato(userdata) };
    s.attesa = if timeout < 0 {
        Duration::from_secs(60)
    } else {
        Duration::from_millis(timeout as u64)
    };
    DC_STATUS_SUCCESS
}

extern "C" fn cb_get_available(userdata: *mut c_void, value: *mut usize) -> c_int {
    let s = unsafe { stato(userdata) };
    unsafe { *value = s.flusso.disponibili() };
    DC_STATUS_SUCCESS
}

/// Aspetta che ci sia almeno un byte, o che scada il tempo.
///
/// libdivecomputer la usa per non chiamare `read` a vuoto. Restituire
/// `TIMEOUT` è un esito normale, non un guasto.
extern "C" fn cb_poll(userdata: *mut c_void, timeout: c_int) -> c_int {
    let s = unsafe { stato(userdata) };
    let attesa = if timeout < 0 {
        Duration::from_secs(60)
    } else {
        Duration::from_millis(timeout as u64)
    };
    if s.flusso.disponibili() > 0 {
        return DC_STATUS_SUCCESS;
    }
    let scadenza = std::time::Instant::now() + attesa;
    while std::time::Instant::now() < scadenza {
        if s.flusso.disponibili() > 0 {
            return DC_STATUS_SUCCESS;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    DC_STATUS_TIMEOUT
}

extern "C" fn cb_read(
    userdata: *mut c_void,
    data: *mut c_void,
    size: usize,
    actual: *mut usize,
) -> c_int {
    let s = unsafe { stato(userdata) };
    match s.flusso.leggi(size, s.attesa) {
        Ok(letti) => {
            // SICUREZZA: `data` punta a un buffer di almeno `size` byte, e non
            // ne scriviamo mai più di quanti ne abbiamo letti — che è al più
            // `size`, perché `leggi` non può restituirne di più.
            unsafe {
                std::ptr::copy_nonoverlapping(letti.as_ptr(), data as *mut u8, letti.len());
                *actual = letti.len();
            }
            // Zero byte dopo l'attesa è un timeout, e va detto: se si
            // restituisse SUCCESS con zero byte, libdivecomputer girerebbe a
            // vuoto invece di rinunciare.
            if letti.is_empty() {
                DC_STATUS_TIMEOUT
            } else {
                DC_STATUS_SUCCESS
            }
        }
        Err(_) => {
            unsafe { *actual = 0 };
            DC_STATUS_IO
        }
    }
}

extern "C" fn cb_write(
    userdata: *mut c_void,
    data: *const c_void,
    size: usize,
    actual: *mut usize,
) -> c_int {
    let s = unsafe { stato(userdata) };
    // SICUREZZA: `data` punta a `size` byte validi per la durata della chiamata.
    let dati = unsafe { std::slice::from_raw_parts(data as *const u8, size) };
    match s.flusso.scrivi(dati) {
        Ok(()) => {
            unsafe { *actual = size };
            DC_STATUS_SUCCESS
        }
        Err(_) => {
            unsafe { *actual = 0 };
            DC_STATUS_IO
        }
    }
}

extern "C" fn cb_sleep(_userdata: *mut c_void, millisecondi: c_uint) -> c_int {
    std::thread::sleep(Duration::from_millis(millisecondi as u64));
    DC_STATUS_SUCCESS
}

/// L'unico posto in cui lo `Stato` viene distrutto.
extern "C" fn cb_close(userdata: *mut c_void) -> c_int {
    // SICUREZZA: riprendiamo la proprietà della Box che avevamo lasciato andare
    // in `apri`, e la lasciamo cadere. libdivecomputer chiama `close` una volta
    // sola, alla chiusura del flusso.
    drop(unsafe { Box::from_raw(userdata as *mut Stato) });
    DC_STATUS_SUCCESS
}

// -------------------------------------------------------------- l'involucro

/// Un contesto e un flusso di libdivecomputer, che si chiudono da soli.
///
/// PERCHÉ UN `Drop` E NON DUE CHIAMATE A MANO. Perché fra l'apertura e la
/// chiusura c'è tutto lo scarico, che può fallire in dieci modi, e ogni ritorno
/// anticipato sarebbe un contesto C lasciato aperto. Con `Drop` la chiusura
/// avviene comunque, compreso quando qualcosa va in panico.
pub struct CollegamentoLdc {
    contesto: Contesto,
    flusso: *mut DcIostream,
}

/// Il contesto di libdivecomputer, che si libera da solo.
///
/// Sta a parte dal collegamento perché serve anche a chi NON sta parlando con
/// un computer: tradurre i byte di un'immersione già scaricata vuole un
/// contesto e nient'altro, e pretendere un Bluetooth aperto per farlo sarebbe
/// una dipendenza inventata.
pub struct Contesto(*mut DcContext);

impl Contesto {
    pub fn nuovo() -> Result<Self, String> {
        let mut contesto: *mut DcContext = std::ptr::null_mut();
        if unsafe { dc_context_new(&mut contesto) } != DC_STATUS_SUCCESS {
            return Err("libdivecomputer non ha creato il contesto".into());
        }
        Ok(Self(contesto))
    }
}

impl Drop for Contesto {
    fn drop(&mut self) {
        unsafe { dc_context_free(self.0) };
    }
}

impl CollegamentoLdc {
    /// Apre un flusso di libdivecomputer sopra il nostro trasporto.
    pub fn apri(trasporto: Box<dyn FlussoByte>) -> Result<Self, String> {
        let contesto = Contesto::nuovo()?;

        let stato = Box::into_raw(Box::new(Stato {
            flusso: trasporto,
            attesa: Duration::from_secs(5),
        }));

        let callbacks = DcCustomCbs {
            set_timeout: Some(cb_set_timeout),
            set_break: None,
            set_dtr: None,
            set_rts: None,
            get_lines: None,
            get_available: Some(cb_get_available),
            // `configure` è la velocità della porta seriale: su BLE non
            // significa niente, e lasciarla nulla fa restituire a
            // libdivecomputer «non supportato», che è la verità.
            configure: None,
            poll: Some(cb_poll),
            read: Some(cb_read),
            write: Some(cb_write),
            ioctl: None,
            flush: None,
            purge: None,
            sleep: Some(cb_sleep),
            close: Some(cb_close),
        };

        let mut flusso: *mut DcIostream = std::ptr::null_mut();
        let esito = unsafe {
            dc_custom_open(
                &mut flusso,
                contesto.0,
                DC_TRANSPORT_BLE,
                &callbacks,
                stato as *mut c_void,
            )
        };
        if esito != DC_STATUS_SUCCESS {
            // La `close` non è stata registrata da nessuna parte: lo `Stato` va
            // ripreso e distrutto a mano, o resta perso.
            drop(unsafe { Box::from_raw(stato) });
            return Err(format!("libdivecomputer non ha aperto il trasporto (stato {esito})"));
        }
        Ok(Self { contesto, flusso })
    }

    /*
     * ► QUESTI TRE METODI ESISTONO PER LE PROVE, E VANNO TENUTI. ◄
     *
     * Nello scarico vero non li chiama nessuno: è libdivecomputer a chiamare
     * NOI, attraverso le callback di `dc_custom_open`. Servono al contrario —
     * a spingere byte DENTRO la libreria e a rileggerli — che è il solo modo
     * di verificare, senza un computer subacqueo, che il ponte trasporti
     * davvero i byte invece di sembrarlo.
     *
     * Sono usati solo da `mod prove`, quindi in una compilazione normale
     * risultano morti. `#[allow(dead_code)]` e non un avviso lasciato acceso:
     * un avviso che compare a ogni compilazione insegna a non guardare gli
     * avvisi, ed è esattamente così che passa quello vero.
     */
    #[allow(dead_code)]
    pub fn imposta_attesa(&self, millisecondi: i32) {
        unsafe { dc_iostream_set_timeout(self.flusso, millisecondi) };
    }

    /// Scrive attraverso libdivecomputer. Serve ai test: nello scarico vero
    /// scrive la libreria, per conto suo.
    #[allow(dead_code)]
    pub fn scrivi(&self, dati: &[u8]) -> Result<usize, String> {
        let mut scritti: usize = 0;
        let esito = unsafe {
            dc_iostream_write(self.flusso, dati.as_ptr() as *const c_void, dati.len(), &mut scritti)
        };
        if esito == DC_STATUS_SUCCESS {
            Ok(scritti)
        } else {
            Err(format!("scrittura fallita (stato {esito})"))
        }
    }

    /// Legge attraverso libdivecomputer. Come sopra: serve ai test.
    #[allow(dead_code)]
    pub fn leggi(&self, quanti: usize) -> Result<Vec<u8>, String> {
        let mut buffer = vec![0u8; quanti];
        let mut letti: usize = 0;
        let esito = unsafe {
            dc_iostream_read(self.flusso, buffer.as_mut_ptr() as *mut c_void, quanti, &mut letti)
        };
        if esito == DC_STATUS_SUCCESS {
            buffer.truncate(letti);
            Ok(buffer)
        } else {
            Err(format!("lettura fallita (stato {esito})"))
        }
    }
}

/// Cerca il descrittore di un modello, per marca e nome.
///
/// PERCHÉ NON UN NUMERO. Il «modello» di libdivecomputer non è unico — Aladin
/// Sport Matrix e Aladin H Matrix sono entrambi 23 — ed è un dettaglio interno
/// alla libreria. Marca e nome sono quello che una persona sceglie da un elenco,
/// e sono quello che l'interfaccia mostrerà.
pub fn trova_descrittore(marca: &str, prodotto: &str) -> Option<Descrittore> {
    let mut iteratore: *mut DcIterator = std::ptr::null_mut();
    if unsafe { dc_descriptor_iterator_new(&mut iteratore, std::ptr::null_mut()) }
        != DC_STATUS_SUCCESS
    {
        return None;
    }
    let mut trovato = None;
    loop {
        let mut descrittore: *mut DcDescriptor = std::ptr::null_mut();
        if unsafe { dc_iterator_next(iteratore, &mut descrittore) } != DC_STATUS_SUCCESS {
            break;
        }
        let leggi = |p: *const std::ffi::c_char| -> String {
            if p.is_null() {
                String::new()
            } else {
                unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned()
            }
        };
        if leggi(unsafe { dc_descriptor_get_vendor(descrittore) }) == marca
            && leggi(unsafe { dc_descriptor_get_product(descrittore) }) == prodotto
        {
            trovato = Some(Descrittore(descrittore));
            break;
        }
        unsafe { dc_descriptor_free(descrittore) };
    }
    unsafe { dc_iterator_free(iteratore) };
    trovato
}

/// Un descrittore che si libera da solo.
pub struct Descrittore(*mut DcDescriptor);

impl Drop for Descrittore {
    fn drop(&mut self) {
        unsafe { dc_descriptor_free(self.0) };
    }
}

/// Una immersione come esce da libdivecomputer: byte grezzi e impronta.
///
/// NON è ancora un'immersione nostra. La conversione nel modello canonico è un
/// passo a parte, e tenerla fuori da qui significa che questo file resta
/// provabile senza tirarci dentro mezzo `src/core`.
pub struct ImmersioneGrezza {
    pub dati: Vec<u8>,
    /// Quello che il computer usa per dire «questa te l'ho già data».
    pub impronta: Vec<u8>,
}

extern "C" fn raccogli(
    dati: *const u8,
    dimensione: c_uint,
    impronta: *const u8,
    dimensione_impronta: c_uint,
    userdata: *mut c_void,
) -> c_int {
    // SICUREZZA: `userdata` è il Vec che abbiamo passato a `dc_device_foreach`,
    // vivo per tutta la durata della chiamata.
    let raccolte = unsafe { &mut *(userdata as *mut Vec<ImmersioneGrezza>) };
    let copia = |p: *const u8, n: c_uint| -> Vec<u8> {
        if p.is_null() || n == 0 {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(p, n as usize) }.to_vec()
        }
    };
    raccolte.push(ImmersioneGrezza {
        dati: copia(dati, dimensione),
        impronta: copia(impronta, dimensione_impronta),
    });
    1 // continua
}

impl CollegamentoLdc {
    /// Scarica tutte le immersioni dal computer, in byte grezzi.
    ///
    /// **Questa chiamata BLOCCA per minuti.** Va invocata sul thread dedicato,
    /// mai dentro il runtime asincrono: è tutto il motivo per cui questo file
    /// esiste.
    pub fn scarica(&self, descrittore: &Descrittore) -> Result<Vec<ImmersioneGrezza>, String> {
        let mut dispositivo: *mut DcDevice = std::ptr::null_mut();
        let esito = unsafe {
            dc_device_open(&mut dispositivo, self.contesto.0, descrittore.0, self.flusso)
        };
        if esito != DC_STATUS_SUCCESS {
            return Err(format!("il computer non si è aperto (stato {esito})"));
        }

        let mut raccolte: Vec<ImmersioneGrezza> = Vec::new();
        let esito = unsafe {
            dc_device_foreach(
                dispositivo,
                raccogli,
                &mut raccolte as *mut Vec<ImmersioneGrezza> as *mut c_void,
            )
        };
        // Il dispositivo si chiude comunque, anche quando lo scarico è fallito:
        // lasciarlo aperto significherebbe un computer che resta occupato.
        unsafe { dc_device_close(dispositivo) };

        if esito != DC_STATUS_SUCCESS {
            return Err(format!("scarico non riuscito (stato {esito})"));
        }
        Ok(raccolte)
    }
}

// ------------------------------------------------- dalla libreria al modello

/// Un campione come lo vede il nostro modello canonico.
///
/// I nomi sono quelli di `src/core/model.ts` — `t`, `depth`, `tempC` — e non
/// quelli di libdivecomputer, perché questo è il confine: di qua c'è una
/// libreria C, di là c'è l'applicazione, e il posto giusto per tradurre è uno
/// solo.
#[derive(serde::Serialize, Default, Clone, Debug, PartialEq)]
pub struct CampioneLdc {
    /// Secondi dall'inizio. libdivecomputer li dà in millisecondi.
    pub t: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<f64>,
    #[serde(rename = "tempC", skip_serializing_if = "Option::is_none")]
    pub temp_c: Option<f64>,
    /// Pressione per bombola, nell'ordine delle bombole.
    #[serde(rename = "pressureBar", skip_serializing_if = "Vec::is_empty")]
    pub pressione_bar: Vec<Option<f64>>,
    #[serde(rename = "ndlS", skip_serializing_if = "Option::is_none")]
    pub ndl_s: Option<u32>,
    #[serde(rename = "ttsS", skip_serializing_if = "Option::is_none")]
    pub tts_s: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ceiling: Option<f64>,
    #[serde(rename = "inDeco", skip_serializing_if = "Option::is_none")]
    pub in_deco: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cns: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ppo2: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setpoint: Option<f64>,
    #[serde(rename = "rbtMin", skip_serializing_if = "Option::is_none")]
    pub rbt_min: Option<u32>,
}

/// Un'immersione tradotta, pronta per il lato TypeScript.
#[derive(serde::Serialize, Default, Clone, Debug)]
pub struct ImmersioneLdc {
    /// Inizio, millisecondi dall'epoca. È l'ora **locale** del computer letta
    /// come se fosse UTC: libdivecomputer non dice in che fuso fosse, e
    /// inventarne uno sarebbe peggio che dichiarare l'ambiguità.
    #[serde(rename = "startMs")]
    pub inizio_ms: i64,
    #[serde(rename = "durationS")]
    pub durata_s: u32,
    #[serde(rename = "maxDepth")]
    pub profondita_max: f64,
    #[serde(rename = "avgDepth", skip_serializing_if = "Option::is_none")]
    pub profondita_media: Option<f64>,
    #[serde(rename = "tempMinC", skip_serializing_if = "Option::is_none")]
    pub temp_min_c: Option<f64>,
    #[serde(rename = "tempMaxC", skip_serializing_if = "Option::is_none")]
    pub temp_max_c: Option<f64>,
    /// Frazioni di ossigeno ed elio, una per miscela, nell'ordine del computer.
    pub gas: Vec<GasLdc>,
    /// Le bombole, che sono una lista a sé: vedi `BombolaLdc`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bombole: Vec<BombolaLdc>,
    /// `oc`, `ccr`, `scr`, `gauge`, `freedive`. Assente se il computer non lo dice.
    #[serde(rename = "mode", skip_serializing_if = "Option::is_none")]
    pub modalita: Option<&'static str>,
    /**
     * Vero quando il computer NON ha dato una data.
     *
     * Serviva, e mancava: `dc_parser_get_datetime` può fallire, e
     * `millisecondi()` restituisce zero per un anno zero. Uno zero è un istante
     * legittimo — il 1° gennaio 1970 — quindi il lato TypeScript non aveva modo
     * di distinguere «mezzanotte del 1970» da «non lo so», e ci applicava il
     * fuso: l'immersione entrava in archivio datata **31 dicembre 1969**.
     */
    #[serde(rename = "senzaData", skip_serializing_if = "std::ops::Not::not")]
    pub senza_data: bool,
    pub samples: Vec<CampioneLdc>,
}

#[derive(serde::Serialize, Default, Clone, Debug)]
pub struct GasLdc {
    pub o2: f64,
    pub he: f64,
}

/// Una bombola, con il suo legame verso la miscela che contiene.
///
/// ► ESISTE PERCHÉ `pressione_bar` DEI CAMPIONI È INDICIZZATA QUI, NON SUI GAS. ◄
///
/// `dc_sample_value_t.pressure.tank` è un indice in QUESTA lista. Passarlo al
/// lato TypeScript come se fosse un indice di miscela era il difetto: un
/// computer con un gas dichiarato e il trasmettitore sulla bombola 2 mandava
/// `[null, 220]`, il logbook leggeva solo la posizione 0, e dichiarava per
/// iscritto «nessuna pressione bombola: consumo gas non calcolabile» su
/// un'immersione in cui il computer aveva registrato 130 bar consumati.
#[derive(serde::Serialize, Default, Clone, Debug)]
pub struct BombolaLdc {
    /// L'indice della miscela in `gas`, assente se il computer non lo dice.
    #[serde(rename = "gasIndex", skip_serializing_if = "Option::is_none")]
    pub indice_gas: Option<usize>,
    /// Capacità in acqua, litri. Assente quando la bombola non la dichiara.
    #[serde(rename = "sizeL", skip_serializing_if = "Option::is_none")]
    pub volume_l: Option<f64>,
    #[serde(rename = "startBar", skip_serializing_if = "Option::is_none")]
    pub pressione_iniziale_bar: Option<f64>,
    #[serde(rename = "endBar", skip_serializing_if = "Option::is_none")]
    pub pressione_finale_bar: Option<f64>,
}

/// Quello che si accumula mentre libdivecomputer sciorina i campioni.
struct Accumulatore {
    immersione: ImmersioneLdc,
    corrente: CampioneLdc,
    iniziato: bool,
    quante_bombole: usize,
}

/*
 * ► IL TIPO DI SOSTA. LA COSTANTE ERA SBAGLIATA DI UNO, E NON DAVA ERRORE. ◄
 *
 * Il commento che stava qui diceva «0 nessuna, 1 NDL, 2 sosta deco, 3 sosta di
 * sicurezza». È un ordine inventato. Quello vero sta in
 * `vendor/libdivecomputer-0.9.0.tar.gz`, `include/libdivecomputer/parser.h`:
 *
 *     typedef enum dc_deco_type_t {
 *         DC_DECO_NDL,        // 0
 *         DC_DECO_SAFETYSTOP, // 1
 *         DC_DECO_DECOSTOP,   // 2
 *         DC_DECO_DEEPSTOP    // 3
 *     }
 *
 * Con `DECO_NDL = 1` succedevano tre cose insieme, tutte silenziose:
 *
 *  1. **`ndlS` non arrivava mai**, per nessun modello: il ramo dell'NDL non si
 *     imboccava. Sparivano il grafico dell'NDL nella scheda e la colonna nei
 *     contesti per l'analisi.
 *  2. I secondi di una **sosta di sicurezza** finivano dentro `ndlS`: «180
 *     secondi di curva» a tre metri dalla superficie.
 *  3. Ogni campione IN CURVA riceveva **`ceiling: 0`** — perché la profondità
 *     di un NDL è zero — e questo è il peggiore dei tre. `hasCeiling` diventava
 *     vero, e in `dedupe.ts` un profilo con «dati decompressivi» vale due punti
 *     nel confronto dei canali: un profilo letto da libdivecomputer poteva
 *     **battere e sostituire** il profilo vero di uno dei driver di casa.
 *
 * Nessuna di queste tre cose dà errore. È il motivo per cui una costante
 * copiata a occhio da un'intestazione C va confrontata con l'intestazione.
 */
const DECO_NDL: c_uint = 0;

extern "C" fn campione(tipo: c_uint, valore: *const ValoreCampione, userdata: *mut c_void) {
    // SICUREZZA: entrambi i puntatori arrivano da libdivecomputer e valgono per
    // la durata della chiamata.
    let acc = unsafe { &mut *(userdata as *mut Accumulatore) };
    let v = unsafe { &*valore };

    match tipo {
        0 => {
            /*
             * DC_SAMPLE_TIME apre un campione NUOVO, e chiude il precedente.
             *
             * libdivecomputer non consegna record completi: manda un istante e
             * poi, uno alla volta, i valori che a quell'istante sono cambiati.
             * Chi lo usa deve accorpare, e chi non lo fa si ritrova un campione
             * per ogni grandezza — cioè un profilo lungo cinque volte tanto con
             * un buco in ogni riga.
             */
            if acc.iniziato {
                let finito = std::mem::take(&mut acc.corrente);
                acc.immersione.samples.push(finito);
            }
            acc.iniziato = true;
            acc.corrente = CampioneLdc { t: unsafe { v.tempo } / 1000, ..Default::default() };
        }
        1 => acc.corrente.depth = Some(unsafe { v.profondita }),
        2 => {
            let p = unsafe { v.pressione };
            let indice = p.bombola as usize;
            if acc.corrente.pressione_bar.len() <= indice {
                acc.corrente.pressione_bar.resize(indice + 1, None);
            }
            acc.corrente.pressione_bar[indice] = Some(p.valore);
            acc.quante_bombole = acc.quante_bombole.max(indice + 1);
        }
        3 => acc.corrente.temp_c = Some(unsafe { v.temperatura }),
        5 => acc.corrente.rbt_min = Some(unsafe { v.rbt }),
        9 => acc.corrente.setpoint = Some(unsafe { v.setpoint }),
        10 => acc.corrente.ppo2 = Some(unsafe { v.ppo2 }.valore),
        11 => acc.corrente.cns = Some(unsafe { v.cns } * 100.0),
        12 => {
            let d = unsafe { v.deco };
            if d.tipo == DECO_NDL {
                acc.corrente.ndl_s = Some(d.tempo);
                acc.corrente.in_deco = Some(false);
            } else {
                acc.corrente.ceiling = Some(d.profondita);
                acc.corrente.in_deco = Some(d.profondita > 0.0);
            }
            if d.tts > 0 {
                acc.corrente.tts_s = Some(d.tts);
            }
        }
        // Eventi, battito, rilevamento, dati del costruttore, cambio gas: non
        // servono al modello canonico e si scartano di proposito, invece di
        // essere raccolti «casomai».
        _ => {}
    }
}

/// L'unione dei valori di `dc_sample_value_t`, per i campi che leggiamo.
///
/// **È una `union` e va letta solo dopo aver guardato il tipo.** Leggere il
/// campo sbagliato non dà un errore: dà un numero.
#[repr(C)]
union ValoreCampione {
    tempo: c_uint,
    profondita: f64,
    pressione: PressioneCampione,
    temperatura: f64,
    rbt: c_uint,
    setpoint: f64,
    ppo2: Ppo2Campione,
    cns: f64,
    deco: DecoCampione,
    _riempimento: [u8; 32],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct PressioneCampione {
    bombola: c_uint,
    valore: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Ppo2Campione {
    _sensore: c_uint,
    valore: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct DecoCampione {
    tipo: c_uint,
    tempo: c_uint,
    profondita: f64,
    tts: c_uint,
}

/// I campi dell'intestazione, nell'ordine di `dc_field_type_t`.
const CAMPO_DURATA: c_uint = 0;
const CAMPO_PROF_MAX: c_uint = 1;
const CAMPO_PROF_MEDIA: c_uint = 2;
const CAMPO_GAS_QUANTI: c_uint = 3;
const CAMPO_GAS: c_uint = 4;
const CAMPO_TEMP_MIN: c_uint = 8;
const CAMPO_TEMP_MAX: c_uint = 9;
/*
 * Le bombole, che sono una lista DIVERSA dalle miscele, ed è la distinzione che
 * mancava. `dc_tank_t` porta un campo `gasmix` proprio perché le due liste non
 * coincidono: un trasmettitore assegnato alla seconda bombola su un computer
 * che dichiara un gas solo è la normalità su un integrato d'aria.
 */
const CAMPO_BOMBOLE_QUANTE: c_uint = 10;
const CAMPO_BOMBOLA: c_uint = 11;
/// La modalità: circuito aperto, chiuso, semichiuso, profondimetro, apnea.
const CAMPO_MODALITA: c_uint = 12;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct GasMix {
    elio: f64,
    ossigeno: f64,
    azoto: f64,
    _tipo: c_uint,
}

/// `dc_tank_t`, campo per campo nell'ordine dell'intestazione.
///
/// `gasmix` è **l'indice nella lista delle miscele**, o `0xFFFFFFFF` quando il
/// computer non lo dice. È l'unico ponte fra le due liste, ed è il motivo per
/// cui questa struttura va letta invece di dare per scontato che bombola *n* e
/// miscela *n* siano la stessa cosa: su un integrato d'aria non lo sono quasi
/// mai. `volume` è sempre la capacità in acqua, in litri: libdivecomputer
/// converte da sé le bombole imperiali.
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct BombolaC {
    gasmix: c_uint,
    _tipo: c_uint,
    volume: f64,
    _pressione_lavoro: f64,
    pressione_iniziale: f64,
    pressione_finale: f64,
    _uso: c_uint,
}

const GASMIX_SCONOSCIUTA: c_uint = 0xFFFF_FFFF;

#[repr(C)]
struct DcDatetime {
    anno: c_int,
    mese: c_uint,
    giorno: c_uint,
    ora: c_uint,
    minuto: c_uint,
    secondo: c_uint,
    fuso: c_int,
}

#[repr(C)]
pub struct DcParser {
    _vuoto: [u8; 0],
}

extern "C" {
    fn dc_parser_new2(
        parser: *mut *mut DcParser,
        context: *mut DcContext,
        descriptor: *mut DcDescriptor,
        data: *const u8,
        size: usize,
    ) -> c_int;
    fn dc_parser_get_datetime(parser: *mut DcParser, datetime: *mut DcDatetime) -> c_int;
    fn dc_parser_get_field(
        parser: *mut DcParser,
        tipo: c_uint,
        flags: c_uint,
        valore: *mut c_void,
    ) -> c_int;
    fn dc_parser_samples_foreach(
        parser: *mut DcParser,
        callback: extern "C" fn(c_uint, *const ValoreCampione, *mut c_void),
        userdata: *mut c_void,
    ) -> c_int;
    fn dc_parser_destroy(parser: *mut DcParser) -> c_int;
}

/// Traduce i byte grezzi di UNA immersione nel nostro modello.
///
/// PERCHÉ QUI E NON IN TYPESCRIPT. Perché i byte grezzi di un computer che non
/// conosciamo non li sa leggere nessuno tranne libdivecomputer, e farli
/// attraversare il confine per poi rimandarli indietro sarebbe un giro inutile.
/// Quello che attraversa il confine è già il modello.
pub fn traduci(
    contesto: &Contesto,
    descrittore: &Descrittore,
    dati: &[u8],
) -> Result<ImmersioneLdc, String> {
    let mut parser: *mut DcParser = std::ptr::null_mut();
    let esito = unsafe {
        dc_parser_new2(&mut parser, contesto.0, descrittore.0, dati.as_ptr(), dati.len())
    };
    if esito != DC_STATUS_SUCCESS {
        return Err(format!("nessun lettore per questa immersione (stato {esito})"));
    }

    let mut immersione = ImmersioneLdc::default();

    /*
     * LA DATA PUÒ NON ESSERCI, e va detto invece che finto.
     *
     * `dc_parser_get_datetime` può fallire, e `millisecondi()` restituisce zero
     * per un anno zero. Zero però è un istante vero — il 1° gennaio 1970 — e
     * chi legge dall'altra parte non poteva distinguerlo da «non lo so»:
     * applicandoci il fuso, l'immersione entrava in archivio datata 31 dicembre
     * 1969, con la catena dei tessuti e ogni statistica per giornata al
     * seguito. Adesso c'è una bandiera, e chi legge decide.
     */
    let mut quando = DcDatetime { anno: 0, mese: 0, giorno: 0, ora: 0, minuto: 0, secondo: 0, fuso: 0 };
    if unsafe { dc_parser_get_datetime(parser, &mut quando) } == DC_STATUS_SUCCESS && quando.anno != 0
    {
        immersione.inizio_ms = millisecondi(&quando);
    } else {
        immersione.senza_data = true;
    }

    let leggi_numero = |campo: c_uint| -> Option<f64> {
        let mut valore: f64 = 0.0;
        let esito =
            unsafe { dc_parser_get_field(parser, campo, 0, &mut valore as *mut f64 as *mut c_void) };
        // DC_STATUS_UNSUPPORTED (-1) vuol dire «questo computer non lo dice», e
        // non è un errore: è un campo che resta vuoto.
        if esito == DC_STATUS_SUCCESS {
            Some(valore)
        } else {
            None
        }
    };
    immersione.profondita_max = leggi_numero(CAMPO_PROF_MAX).unwrap_or(0.0);
    immersione.profondita_media = leggi_numero(CAMPO_PROF_MEDIA).filter(|v| *v > 0.0);
    immersione.temp_min_c = leggi_numero(CAMPO_TEMP_MIN);
    immersione.temp_max_c = leggi_numero(CAMPO_TEMP_MAX);

    let mut durata: c_uint = 0;
    if unsafe {
        dc_parser_get_field(parser, CAMPO_DURATA, 0, &mut durata as *mut c_uint as *mut c_void)
    } == DC_STATUS_SUCCESS
    {
        immersione.durata_s = durata;
    }

    let mut quanti_gas: c_uint = 0;
    if unsafe {
        dc_parser_get_field(parser, CAMPO_GAS_QUANTI, 0, &mut quanti_gas as *mut c_uint as *mut c_void)
    } == DC_STATUS_SUCCESS
    {
        for i in 0..quanti_gas {
            let mut mix = GasMix::default();
            if unsafe {
                dc_parser_get_field(parser, CAMPO_GAS, i, &mut mix as *mut GasMix as *mut c_void)
            } == DC_STATUS_SUCCESS
            {
                immersione.gas.push(GasLdc { o2: mix.ossigeno, he: mix.elio });
            }
        }
    }

    /*
     * LE BOMBOLE, che sono la lista su cui sono indicizzate le pressioni dei
     * campioni. Da qui arrivano anche volume e pressioni di inizio e fine —
     * senza le quali il consumo in litri al minuto non si calcola affatto, e
     * infatti non si calcolava.
     */
    let mut quante_bombole: c_uint = 0;
    if unsafe {
        dc_parser_get_field(
            parser,
            CAMPO_BOMBOLE_QUANTE,
            0,
            &mut quante_bombole as *mut c_uint as *mut c_void,
        )
    } == DC_STATUS_SUCCESS
    {
        for i in 0..quante_bombole {
            let mut b = BombolaC::default();
            if unsafe {
                dc_parser_get_field(parser, CAMPO_BOMBOLA, i, &mut b as *mut BombolaC as *mut c_void)
            } == DC_STATUS_SUCCESS
            {
                immersione.bombole.push(BombolaLdc {
                    indice_gas: (b.gasmix != GASMIX_SCONOSCIUTA).then_some(b.gasmix as usize),
                    // Zero non è una misura: è «non dichiarato». `dc_tank_t` lo
                    // dice esplicitamente per il volume, e una bombola da zero
                    // litri o da zero bar farebbe divisioni per zero a valle.
                    volume_l: (b.volume > 0.0).then_some(b.volume),
                    pressione_iniziale_bar: (b.pressione_iniziale > 0.0)
                        .then_some(b.pressione_iniziale),
                    pressione_finale_bar: (b.pressione_finale > 0.0).then_some(b.pressione_finale),
                });
            }
        }
    }

    /*
     * LA MODALITÀ. Senza, ogni immersione entrava in archivio a circuito aperto
     * — compreso un rebreather, che il logbook conta a parte in mezzo posto:
     * statistiche, attrezzatura, e il libretto a valore legale.
     */
    let mut modalita: c_uint = 0;
    if unsafe {
        dc_parser_get_field(parser, CAMPO_MODALITA, 0, &mut modalita as *mut c_uint as *mut c_void)
    } == DC_STATUS_SUCCESS
    {
        // `dc_divemode_t`: 0 apnea, 1 profondimetro, 2 circuito aperto,
        // 3 circuito chiuso, 4 semichiuso. Le parole sono quelle di `DiveMode`
        // in `src/core/model.ts`, così il lato TypeScript non deve tradurre.
        immersione.modalita = match modalita {
            0 => Some("freedive"),
            1 => Some("gauge"),
            2 => Some("oc"),
            3 => Some("ccr"),
            4 => Some("scr"),
            _ => None,
        };
    }

    let mut acc = Accumulatore {
        immersione,
        corrente: CampioneLdc::default(),
        iniziato: false,
        quante_bombole: 0,
    };
    let esito = unsafe {
        dc_parser_samples_foreach(parser, campione, &mut acc as *mut Accumulatore as *mut c_void)
    };
    unsafe { dc_parser_destroy(parser) };
    if esito != DC_STATUS_SUCCESS {
        return Err(format!("profilo illeggibile (stato {esito})"));
    }

    // L'ultimo campione non ha un `DC_SAMPLE_TIME` dopo di sé che lo chiuda.
    if acc.iniziato {
        let ultimo = std::mem::take(&mut acc.corrente);
        acc.immersione.samples.push(ultimo);
    }
    Ok(acc.immersione)
}

/// Da una data «locale senza fuso» ai millisecondi dall'epoca.
///
/// Fatto a mano invece che con una libreria di date: sono quattro righe di
/// aritmetica civile e l'alternativa è una dipendenza in più per questo.
/// L'algoritmo dei giorni dall'epoca è quello di Howard Hinnant, che è pubblico
/// e non ha casi speciali per gli anni bisestili.
fn millisecondi(q: &DcDatetime) -> i64 {
    let (mut anno, mese, giorno) = (q.anno as i64, q.mese as i64, q.giorno as i64);
    if anno == 0 {
        return 0;
    }
    anno -= i64::from(mese <= 2);
    let era = if anno >= 0 { anno } else { anno - 399 } / 400;
    let anno_era = anno - era * 400;
    let giorno_anno = (153 * (mese + if mese > 2 { -3 } else { 9 }) + 2) / 5 + giorno - 1;
    let giorno_era = anno_era * 365 + anno_era / 4 - anno_era / 100 + giorno_anno;
    let giorni = era * 146_097 + giorno_era - 719_468;
    let secondi = giorni * 86_400 + q.ora as i64 * 3600 + q.minuto as i64 * 60 + q.secondo as i64;
    secondi * 1000
}

impl Drop for CollegamentoLdc {
    fn drop(&mut self) {
        // `dc_iostream_close` chiama la nostra `cb_close`, che distrugge lo
        // `Stato`. Il contesto si libera dopo, da sé: è un campo, e i campi
        // cadono dopo il corpo del `Drop`.
        unsafe { dc_iostream_close(self.flusso) };
    }
}

// ------------------------------------------------------------------- prove

#[cfg(test)]
mod prove {
    use super::*;
    use std::sync::mpsc::channel;
    use std::sync::{Arc, Mutex};

    /// Un flusso finto che rimanda indietro quello che riceve.
    ///
    /// Basta a provare la cosa che conta: che i byte che libdivecomputer scrive
    /// arrivino davvero nel nostro codice Rust, e che quelli che il nostro
    /// codice mette a disposizione arrivino davvero a libdivecomputer. Il
    /// protocollo di un computer subacqueo è un'altra storia e ha bisogno di un
    /// computer subacqueo.
    struct Eco {
        coda: Arc<Mutex<VecDeque<u8>>>,
        scritti: Arc<Mutex<Vec<u8>>>,
    }

    impl FlussoByte for Eco {
        fn scrivi(&mut self, dati: &[u8]) -> Result<(), String> {
            self.scritti.lock().unwrap().extend_from_slice(dati);
            self.coda.lock().unwrap().extend(dati);
            Ok(())
        }
        fn leggi(&mut self, quanti: usize, _attesa: Duration) -> Result<Vec<u8>, String> {
            let mut coda = self.coda.lock().unwrap();
            let quanti = quanti.min(coda.len());
            Ok(coda.drain(..quanti).collect())
        }
        fn disponibili(&mut self) -> usize {
            self.coda.lock().unwrap().len()
        }
    }

    #[test]
    fn libdivecomputer_scrive_e_legge_attraverso_il_nostro_trasporto() {
        let scritti = Arc::new(Mutex::new(Vec::new()));
        let eco = Eco {
            coda: Arc::new(Mutex::new(VecDeque::new())),
            scritti: scritti.clone(),
        };
        let collegamento = CollegamentoLdc::apri(Box::new(eco)).expect("il flusso deve aprirsi");

        assert_eq!(collegamento.scrivi(&[0x10, 0x20, 0x30]).unwrap(), 3);
        // I byte sono arrivati al NOSTRO codice, non a un buffer interno del C.
        assert_eq!(*scritti.lock().unwrap(), vec![0x10, 0x20, 0x30]);
        // E tornano indietro passando per libdivecomputer.
        assert_eq!(collegamento.leggi(3).unwrap(), vec![0x10, 0x20, 0x30]);
    }

    #[test]
    fn una_lettura_piu_corta_non_perde_il_resto() {
        /*
         * L'invariante che salva il protocollo. Una notifica BLE porta venti
         * byte perché venti ne entrano in un pacchetto; libdivecomputer ne
         * chiede quattro. Se i sedici avanzati sparissero, il secondo scambio
         * leggerebbe byte sbagliati — e non lo direbbe.
         */
        let eco = Eco {
            coda: Arc::new(Mutex::new(VecDeque::new())),
            scritti: Arc::new(Mutex::new(Vec::new())),
        };
        let collegamento = CollegamentoLdc::apri(Box::new(eco)).unwrap();
        collegamento.scrivi(&(0u8..20).collect::<Vec<_>>()).unwrap();

        assert_eq!(collegamento.leggi(4).unwrap(), vec![0, 1, 2, 3]);
        assert_eq!(collegamento.leggi(16).unwrap(), (4u8..20).collect::<Vec<_>>());
    }

    #[test]
    fn il_flusso_ble_tiene_da_parte_quello_che_avanza() {
        // Lo stesso, un piano sotto: direttamente sul `FlussoBle`, con le
        // notifiche che arrivano da un canale come farebbe il Bluetooth vero.
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        manda.send(vec![1, 2, 3, 4, 5]).unwrap();

        // Chiedendo meno di una notifica, il resto DI QUELLA notifica resta lì:
        // è il caso opposto a quello sopra, e va gestito senza confondere i due.
        assert_eq!(flusso.leggi(2, Duration::from_millis(50)).unwrap(), vec![1, 2]);
        assert_eq!(flusso.disponibili(), 3);
        assert_eq!(flusso.leggi(10, Duration::from_millis(50)).unwrap(), vec![3, 4, 5]);
    }

    #[test]
    fn due_notifiche_non_si_uniscono_mai_in_una_lettura() {
        /*
         * La prova nata da un difetto vero, trovato dal finto Aladin prima che
         * lo trovasse un computer subacqueo.
         *
         * La prima versione trattava il Bluetooth come un flusso continuo e
         * consegnava tutto quello che era arrivato. Ma su questo protocollo il
         * primo byte di ogni notifica NON è dato — è un numero di sequenza — e
         * libdivecomputer lo scarta calcolando `lunghezza = ricevuti - 1`.
         * Unendo due notifiche, il byte di sequenza della seconda finisce dentro
         * i dati.
         *
         * Il sintomo non sarebbe stato un errore: sarebbe stato un trasferimento
         * riuscito con dentro un blocco disallineato, in cui i marcatori delle
         * immersioni non si trovano più. Cioè «zero immersioni», senza motivo.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        manda.send(vec![1, 2]).unwrap();
        manda.send(vec![3, 4]).unwrap();

        assert_eq!(flusso.leggi(100, Duration::from_millis(200)).unwrap(), vec![1, 2]);
        assert_eq!(flusso.leggi(100, Duration::from_millis(200)).unwrap(), vec![3, 4]);
    }

    #[test]
    fn quando_non_arriva_niente_si_rinuncia_invece_di_aspettare_per_sempre() {
        let (_manda, ricevi) = channel::<Vec<u8>>();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        let inizio = std::time::Instant::now();
        let letti = flusso.leggi(4, Duration::from_millis(80)).unwrap();
        assert!(letti.is_empty());
        assert!(inizio.elapsed() >= Duration::from_millis(70));
        assert!(inizio.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn il_bluetooth_che_se_ne_va_e_un_errore_non_un_silenzio() {
        /*
         * La differenza fra «non è ancora arrivato niente» e «il collegamento
         * è caduto». Confonderle vorrebbe dire aspettare il timeout intero a
         * ogni lettura su un dispositivo che non c'è più, e poi dire «tempo
         * scaduto» invece di «si è scollegato».
         */
        let (manda, ricevi) = channel::<Vec<u8>>();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        drop(manda);
        assert!(flusso.leggi(4, Duration::from_secs(5)).is_err());
    }

/// Un finto Aladin Sport Matrix, che parla il protocollo vero.
    ///
    /// PERCHÉ VALE LA PENA. Senza, tutto quello che sta sopra il trasporto —
    /// aprire il dispositivo, chiedere modello e seriale, scaricare la memoria,
    /// ritagliare le immersioni — resterebbe codice mai eseguito fino al giorno
    /// in cui qualcuno accende un computer subacqueo davanti a un'app che non ha
    /// mai provato quella strada. Con un finto dispositivo, invece, il giro
    /// completo si percorre a ogni `cargo test`.
    ///
    /// IL PROTOCOLLO, per quel poco che serve qui. Su BLE si scrive
    /// `[lunghezza+1, comando, ...parametri]` e si legge una serie di notifiche
    /// da venti byte, di cui **il primo va buttato**: libdivecomputer lo
    /// documenta come una specie di numero di sequenza che cresce di 19 a ogni
    /// pacchetto. Diciannove è la parte utile di una notifica da venti.
    struct FintoAladin {
        /// La memoria che il computer consegnerà, marcatori compresi.
        memoria: Vec<u8>,
        /// Le risposte preparate, **una notifica per elemento**: è così che
        /// arrivano davvero, ed è la differenza che ha fatto emergere il difetto.
        risposta: VecDeque<Vec<u8>>,
        /// Il comando in arrivo, mentre lo si mette insieme.
        ricevuto: Vec<u8>,
    }

    impl FintoAladin {
        fn nuovo(memoria: Vec<u8>) -> Self {
            Self { memoria, risposta: VecDeque::new(), ricevuto: Vec::new() }
        }

        /// Impacchetta una risposta come farebbe il computer: venti byte per
        /// notifica, il primo dei quali non è dato.
        fn accoda(&mut self, corpo: &[u8]) {
            let mut sequenza: u8 = 0xf7;
            for pezzo in corpo.chunks(19) {
                let mut notifica = Vec::with_capacity(pezzo.len() + 1);
                notifica.push(sequenza);
                notifica.extend_from_slice(pezzo);
                self.risposta.push_back(notifica);
                sequenza = sequenza.wrapping_add(19);
            }
        }

        fn esegui(&mut self, comando: u8, _parametri: &[u8]) {
            match comando {
                0x10 => self.accoda(&[23]),                     // modello
                0x11 => self.accoda(&[1]),                      // hardware
                0x13 => self.accoda(&[0x12]),                   // software (BCD)
                0x14 => self.accoda(&[0x02, 0x45, 0x05, 0x03]), // seriale
                0x1a => self.accoda(&[0, 0, 0, 0]),             // orologio
                0xc6 => {
                    let n = self.memoria.len() as u32;
                    self.accoda(&n.to_le_bytes());
                }
                0xc4 => {
                    /*
                     * CMD_DATA risponde DUE VOLTE, e questa è la sottigliezza
                     * che il finto dispositivo ha insegnato: prima quattro byte
                     * con il totale — che è la lunghezza più quattro, e
                     * libdivecomputer lo verifica — e solo dopo la memoria. Un
                     * finto che mandasse subito la memoria farebbe fallire lo
                     * scarico con «spazio insufficiente», che è quello che è
                     * successo al primo tentativo.
                     */
                    let totale = self.memoria.len() as u32 + 4;
                    self.accoda(&totale.to_le_bytes());
                    let memoria = std::mem::take(&mut self.memoria);
                    self.accoda(&memoria);
                    self.memoria = memoria;
                }
                _ => {}
            }
        }
    }

    impl FlussoByte for FintoAladin {
        fn scrivi(&mut self, dati: &[u8]) -> Result<(), String> {
            self.ricevuto.extend_from_slice(dati);
            // `[lunghezza+1, comando, ...]`: il primo byte dice quanto manca.
            while self.ricevuto.len() >= 2 {
                let attesi = self.ricevuto[0] as usize + 1;
                if self.ricevuto.len() < attesi {
                    break;
                }
                let comando = self.ricevuto[1];
                let parametri: Vec<u8> = self.ricevuto[2..attesi].to_vec();
                self.ricevuto.drain(..attesi);
                self.esegui(comando, &parametri);
            }
            Ok(())
        }
        fn leggi(&mut self, quanti: usize, _attesa: Duration) -> Result<Vec<u8>, String> {
            // UNA notifica per lettura, come il Bluetooth vero. Restituirne due
            // attaccate è precisamente il difetto che questo finto ha scoperto.
            match self.risposta.pop_front() {
                Some(notifica) if notifica.len() <= quanti => Ok(notifica),
                Some(mut notifica) => {
                    let resto = notifica.split_off(quanti);
                    self.risposta.push_front(resto);
                    Ok(notifica)
                }
                None => Ok(Vec::new()),
            }
        }
        fn disponibili(&mut self) -> usize {
            self.risposta.iter().map(Vec::len).sum()
        }
    }

    /// Una memoria finta con `quante` immersioni dentro, ciascuna di `lunghezza`
    /// byte, marcatore `A5 A5 5A 5A` e lunghezza dichiarata compresi.
    fn memoria_con(quante: usize, lunghezza: u32) -> Vec<u8> {
        let mut memoria = Vec::new();
        for i in 0..quante {
            memoria.extend_from_slice(&[0xa5, 0xa5, 0x5a, 0x5a]);
            memoria.extend_from_slice(&lunghezza.to_le_bytes());
            // I quattro byte dopo la lunghezza sono l'impronta: un orario, che
            // qui basta sia diverso per ogni immersione.
            memoria.extend_from_slice(&(1000u32 + i as u32).to_le_bytes());
            memoria.resize(memoria.len() + lunghezza as usize - 12, 0);
        }
        memoria
    }

    #[test]
    fn il_giro_completo_su_un_finto_aladin() {
        /*
         * La prova che vale più di tutte le altre di questo file: libdivecomputer
         * apre il dispositivo, chiede modello seriale e orologio, scarica la
         * memoria e ne ritaglia le immersioni — attraverso il NOSTRO trasporto,
         * senza che ci sia niente di reale dall'altra parte.
         */
        let Some(descrittore) = trova_descrittore("Scubapro", "Aladin Sport Matrix") else {
            panic!("il descrittore dell’Aladin Sport Matrix deve esistere");
        };
        let finto = FintoAladin::nuovo(memoria_con(3, 120));
        let collegamento = CollegamentoLdc::apri(Box::new(finto)).unwrap();

        let immersioni = collegamento.scarica(&descrittore).expect("lo scarico deve riuscire");

        assert_eq!(immersioni.len(), 3, "tre marcatori, tre immersioni");
        for immersione in &immersioni {
            assert_eq!(immersione.dati.len(), 120);
            assert_eq!(&immersione.dati[..4], &[0xa5, 0xa5, 0x5a, 0x5a]);
            assert_eq!(immersione.impronta.len(), 4);
        }
        // Le impronte sono diverse fra loro: è quello che permette al computer
        // di dire «questa te l'ho già data» al giro dopo.
        let mut impronte: Vec<&Vec<u8>> = immersioni.iter().map(|i| &i.impronta).collect();
        impronte.sort();
        impronte.dedup();
        assert_eq!(impronte.len(), 3);
    }

    #[test]
    fn una_memoria_vuota_da_zero_immersioni_e_non_un_errore() {
        // Il caso di chi collega un computer appena azzerato. Deve dire «non c'è
        // niente», non «scarico fallito».
        let descrittore = trova_descrittore("Scubapro", "Aladin Sport Matrix").unwrap();
        let collegamento = CollegamentoLdc::apri(Box::new(FintoAladin::nuovo(Vec::new()))).unwrap();
        assert_eq!(collegamento.scarica(&descrittore).unwrap().len(), 0);
    }

    #[test]
    fn una_memoria_grande_arriva_intera_attraverso_notifiche_da_venti_byte() {
        /*
         * Cinquanta immersioni da 400 byte sono ventimila byte, cioè più di mille
         * notifiche da venti. È il caso in cui un errore di un byte
         * nell'assemblaggio si vede: i marcatori non si troverebbero più e il
         * risultato sarebbe «zero immersioni» con il trasferimento riuscito —
         * che è esattamente il difetto peggiore di questo protocollo.
         */
        let descrittore = trova_descrittore("Scubapro", "Aladin Sport Matrix").unwrap();
        let finto = FintoAladin::nuovo(memoria_con(50, 400));
        let collegamento = CollegamentoLdc::apri(Box::new(finto)).unwrap();
        assert_eq!(collegamento.scarica(&descrittore).unwrap().len(), 50);
    }

#[test]
    fn la_traduzione_regge_su_immersioni_vere() {
        /*
         * LA PROVA CHE NON PUÒ STARE NEL REPOSITORY, e il motivo per cui è
         * `ignore`: ha bisogno di immersioni vere, e le immersioni di una
         * persona non si versionano.
         *
         * Si lancia così, dopo aver estratto i blob da un export LogTRAK con
         * `node scripts/confronto-ldc/estrai.mjs`:
         *
         *     MDL_BLOB=/tmp/blob cargo test --features computer-esterni -- --ignored
         *
         * Scrive `/tmp/serie-rust.txt` nello stesso formato degli altri due
         * strumenti, così `scripts/confronto-ldc/confronta.mjs` mette a
         * confronto TRE implementazioni: la nostra in TypeScript, quella C di
         * libdivecomputer, e questa traduzione in mezzo.
         *
         * Cosa verifica che il confronto in C non verificava: l'accorpamento
         * dei campioni. libdivecomputer non consegna record completi — manda un
         * istante e poi, uno alla volta, i valori cambiati — e chi non li
         * accorpa si ritrova un campione per grandezza invece che per istante.
         * Il numero di campioni è la spia che lo prende.
         */
        let Ok(cartella) = std::env::var("MDL_BLOB") else {
            eprintln!("MDL_BLOB non impostata: prova saltata");
            return;
        };
        let contesto = Contesto::nuovo().unwrap();
        let descrittore = trova_descrittore("Scubapro", "Aladin Sport Matrix").unwrap();

        let mut percorsi: Vec<_> = std::fs::read_dir(&cartella)
            .expect("la cartella dei blob deve esistere")
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|e| e == "bin"))
            .collect();
        percorsi.sort();
        assert!(!percorsi.is_empty(), "nessun blob in {cartella}");

        let mut righe = Vec::new();
        let mut senza_profondita = 0;
        for percorso in &percorsi {
            let dati = std::fs::read(percorso).unwrap();
            let immersione = traduci(&contesto, &descrittore, &dati)
                .unwrap_or_else(|e| panic!("{}: {e}", percorso.display()));

            // Nessuna immersione può avere durata o profondità a zero: sarebbe
            // il segno che l'intestazione è stata letta dall'offset sbagliato.
            assert!(immersione.durata_s > 0, "{}: durata zero", percorso.display());
            assert!(immersione.profondita_max > 0.0, "{}: profondità zero", percorso.display());
            assert!(immersione.inizio_ms > 0, "{}: data assente", percorso.display());

            let profondita: Vec<String> = immersione
                .samples
                .iter()
                .filter_map(|c| c.depth.map(|d| format!("{d:.2}")))
                .collect();
            if profondita.is_empty() {
                senza_profondita += 1;
            }
            righe.push(format!("{}\t{}", percorso.display(), profondita.join(",")));
        }
        assert_eq!(senza_profondita, 0, "immersioni senza nessun campione di profondità");
        std::fs::write("/tmp/serie-rust.txt", righe.join("\n") + "\n").unwrap();
        eprintln!("{} immersioni tradotte, serie in /tmp/serie-rust.txt", percorsi.len());
    }

    #[test]
    fn quello_che_si_scrive_passa_dalla_chiusura_che_gli_abbiamo_dato() {
        let visti = Arc::new(Mutex::new(Vec::new()));
        let copia = visti.clone();
        let (_manda, ricevi) = channel::<Vec<u8>>();
        let mut flusso = FlussoBle::nuovo(
            ricevi,
            Box::new(move |dati| {
                copia.lock().unwrap().extend_from_slice(dati);
                Ok(())
            }),
        );
        flusso.scrivi(&[0xAA, 0xBB]).unwrap();
        assert_eq!(*visti.lock().unwrap(), vec![0xAA, 0xBB]);
    }
}
