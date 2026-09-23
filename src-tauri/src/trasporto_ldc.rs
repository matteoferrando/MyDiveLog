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
//! IL PRIMO COMPUTER VERO È ARRIVATO IL 16 SETTEMBRE 2026, ed era un Mares
//! Quad Ci. Per tre settimane qui c'è stato scritto che «nessun apparecchio di
//! terzi è mai stato collegato a questo codice», e finché è stato vero andava
//! scritto; adesso non lo è più.
//!
//! Quello che resta vero, e che vale la pena scrivere al suo posto: **un
//! modello provato non è una famiglia provata**, e lo si è visto lo stesso
//! giorno. Un Aqualung i330R, dallo stesso programma, si è fermato a metà — e
//! il difetto era di qui dentro, su un pacchetto che la radio aveva spezzato e
//! che questo file consegnava a metà. Vedi `Riassemblaggio::LunghezzaDichiarata`.
//!
//! Quello che si può inchiodare senza un apparecchio — il trasporto contro un
//! flusso finto, l'accorpamento dei campioni, la traduzione — è inchiodato; il
//! resto resta una promessa, un modello per volta, finché qualcuno non lo
//! accende e racconta cosa è successo.

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
/// Perché una scrittura non è andata, dal punto di vista di chi deve decidere
/// se ha senso ritentare.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► «SCADUTA» NON È «FALLITA», E QUESTA DISTINZIONE È COSTATA UNO SCARICO. ◄
///
/// Il 9 settembre 2026 un Mares Quad Ci ha scaricato **276 KB** — millecentro e
/// passa scambi perfetti — e poi si è fermato così: la scrittura n. 1226, due
/// byte, non è stata confermata dal Bluetooth entro dieci secondi. Il trasporto
/// ha risposto «errore di trasmissione» (`DC_STATUS_IO`), e per
/// `mares_iconhd_transfer` quello è un errore **definitivo**: ritenta solo su
/// `PROTOCOL` e `TIMEOUT`, su tutto il resto si arrende subito.
///
/// Ma una conferma che non arriva non dice che la scrittura sia fallita: dice
/// che **non si sa**. Il pacchetto può essere partito, può essere in coda, il
/// collegamento può essere solo lento. Chiamarlo «errore di trasmissione»
/// significa affermare una cosa che non abbiamo misurato — e affermarla nel
/// punto esatto in cui costa l'intero scarico, perché toglie al backend
/// l'unica cosa che sa fare in questi casi: dormire un secondo, svuotare
/// l'ingresso e rimandare il comando.
///
/// Un RIFIUTO è un'altra cosa: il plugin dice di no subito, la modalità è
/// sbagliata o la caratteristica non accetta scritture, e ritentare la stessa
/// identica cosa darebbe lo stesso identico esito. Quello resta `IO`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuastoScrittura {
    /// Il Bluetooth ha detto di no. Ritentare non serve.
    Rifiutata(String),
    /// La conferma non è arrivata in tempo. Non si sa se sia andata.
    Scaduta(String),
}

impl std::fmt::Display for GuastoScrittura {
    /// Si stampa come il suo motivo e basta: la qualifica serve a decidere, non
    /// a essere letta. Chi legge il diario vuole sapere cosa è successo, e «la
    /// scrittura non è stata confermata entro dieci secondi» lo dice già.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.motivo())
    }
}

impl GuastoScrittura {
    pub fn motivo(&self) -> &str {
        match self {
            Self::Rifiutata(m) | Self::Scaduta(m) => m,
        }
    }
}

/// Un guasto senza altra qualifica è un RIFIUTO.
///
/// È il valore per difetto giusto: «scaduta» è un'affermazione precisa — so che
/// ho aspettato e non è arrivato niente — e va fatta da chi quel tempo l'ha
/// misurato davvero. Chi non lo sa non deve poterla fare per distrazione,
/// perché il costo di dire «riprova» a vuoto è un giro di ritentativi inutili
/// su un collegamento che non c'è più.
impl From<String> for GuastoScrittura {
    fn from(motivo: String) -> Self {
        Self::Rifiutata(motivo)
    }
}

impl From<&str> for GuastoScrittura {
    fn from(motivo: &str) -> Self {
        Self::Rifiutata(motivo.to_string())
    }
}

pub trait FlussoByte: Send {
    fn scrivi(&mut self, dati: &[u8]) -> Result<(), GuastoScrittura>;
    /// Fino a `quanti` byte, aspettando al massimo `attesa`.
    ///
    /// Restituire MENO byte del richiesto è legittimo e normale: libdivecomputer
    /// richiama finché non ha finito. Restituirne zero significa che il tempo è
    /// scaduto, e quello è un errore per il chiamante.
    fn leggi(&mut self, quanti: usize, attesa: Duration) -> Result<Vec<u8>, String>;
    /// Quanti byte sono già arrivati e aspettano di essere letti.
    fn disponibili(&mut self) -> usize;

    /// Il nome che il dispositivo annuncia, se il trasporto lo conosce.
    ///
    /// NON è un dettaglio decorativo: la famiglia Oceanic/Aqualung/Pelagic su
    /// BLE (i770R, i200C, Pro Plus X, Geo 4.0…) ricava il numero di serie dal
    /// nome Bluetooth e lo usa nella stretta di mano iniziale. Senza nome,
    /// `oceanic_atom2.c` risponde «Bluetooth device name too short» e lo
    /// scarico muore con stato -6 — lo stesso -6 di un collegamento caduto,
    /// che è il modo peggiore di non funzionare. `None` è la risposta onesta
    /// dei trasporti che non sono Bluetooth, e diventa «non supportato».
    fn nome(&mut self) -> Option<String> {
        None
    }

    /// Butta via quello che è arrivato e non è ancora stato letto.
    ///
    /// libdivecomputer lo chiede (`dc_iostream_purge`) all'apertura e quando
    /// riprova dopo un pacchetto scaduto o corrotto: Mares dorme un secondo,
    /// svuota, e rimanda il comando. Se lo svuotamento non svuotasse, ogni
    /// tentativo rileggerebbe la stessa spazzatura e la ripresa da un errore
    /// — che è il motivo per cui i backend ritentano — non riuscirebbe mai.
    fn svuota(&mut self) {}

    /// Il codice PIN che il computer mostra sul suo schermo, sei cifre.
    ///
    /// ► QUESTA È L'UNICA `ioctl` CHE NON SI PUÒ NON SAPER FARE. ◄
    /// `pelagic_i330r_init` tollera l'assenza del codice di accesso e la
    /// tollera in scrittura, ma su questa si ferma e basta: `GET_PINCODE` che
    /// risponde «non supportato» è «Failed to get the PIN code», ed è dove si
    /// fermava l'Aqualung i330R del centro sub il 7 settembre 2026.
    ///
    /// **Il momento conta quanto la risposta.** Il PIN compare sul display del
    /// computer solo DOPO che il backend ha mandato `CMD_ACCESS_REQUEST`, cioè
    /// esattamente quando questa funzione viene chiamata: chiederlo prima
    /// vorrebbe dire chiedere un numero che non c'è ancora. Quindi qui si
    /// **aspetta una persona**, e chi implementa questo metodo blocca il
    /// thread finché non ha una risposta o rinuncia.
    ///
    /// `None` significa «non lo so chiedere» — un trasporto che non è
    /// un'interfaccia — e diventa «non supportato».
    fn codice_pin(&mut self) -> Option<String> {
        None
    }

    /// Il codice di accesso di sedici byte già ottenuto in passato, se c'è.
    ///
    /// È il gemello del PIN e serve a non chiederlo mai più: con un codice
    /// valido `pelagic_i330r_init` salta tutto il ramo del PIN. `None` è la
    /// risposta onesta la prima volta, ed è tollerata dal backend.
    fn codice_accesso(&mut self) -> Option<Vec<u8>> {
        None
    }

    /// Il codice di accesso appena ottenuto dal computer, da conservare.
    ///
    /// Non è un segreto dell'utente: è una chiave di accoppiamento fra questa
    /// installazione e quel computer, dello stesso genere di un legame
    /// Bluetooth. Va conservata dove sta il resto di ciò che l'app sa di quel
    /// dispositivo, e non nel diario tecnico — che si allega alle
    /// segnalazioni.
    fn salva_codice_accesso(&mut self, _codice: &[u8]) {}

    /// Legge una caratteristica GATT per UUID, fuori dal flusso di byte.
    ///
    /// Serve al Cressi Goa (e a chiunque imiti il suo modo di presentarsi),
    /// che su BLE non chiede la versione con un comando ma legge tre
    /// caratteristiche una per una. I sedici byte sono quelli di
    /// `dc_ble_uuid_t`: l'UUID nell'ordine in cui si scrive.
    fn leggi_caratteristica(&mut self, _uuid: [u8; 16]) -> Result<Vec<u8>, String> {
        Err("questo trasporto non sa leggere una caratteristica a parte".into())
    }

    /// Quante volte un pacchetto è rimasto a metà per l'attesa scaduta, e la
    /// pausa più lunga davvero aspettata fra due frammenti, in millisecondi.
    ///
    /// Sta sul trasporto e non sul chiamante perché è l'unico che vede i
    /// frammenti: sopra di lui esistono solo letture, e una lettura corta non
    /// dice se è corta perché il pacchetto era finito o perché un pezzo ha
    /// tardato. Vedi `MisureLettura`. Chi non rimette insieme niente risponde
    /// zero, che è la verità e non un valore di comodo.
    fn misure_frammenti(&self) -> (usize, u64) {
        (0, 0)
    }

    /// Il silenzio più lungo fra un comando e la sua risposta, in millisecondi.
    /// Vedi `MisureLettura`. Zero è la risposta onesta di chi non aspetta mai.
    fn silenzio_massimo_ms(&self) -> u64 {
        0
    }

    /// Quante seconde finestre sono state concesse, quante hanno portato
    /// davvero una risposta, e quante volte il processo si è rivelato
    /// congelato. Vedi `MisureLettura`.
    fn proroghe(&self) -> (usize, usize, usize) {
        (0, 0, 0)
    }

    /// Quante notifiche sono arrivate PRIMA del primo comando e sono state
    /// buttate, e quanti byte portavano. Vedi `FlussoBle::ascolta_prima_di_parlare`.
    /// Zero è la risposta onesta di chi non ascolta prima di parlare.
    fn scartate_prima_di_parlare(&self) -> (usize, usize) {
        (0, 0)
    }

    /// Quanti pacchetti sono stati buttati perché rispondevano a un altro
    /// comando, e quanti byte portavano. Vedi `FlussoBle::con_filtro_del_comando`.
    fn pacchetti_estranei(&self) -> (usize, usize) {
        (0, 0)
    }
}

/// Il silenzio che si aspetta prima del primo comando, sui computer che lo
/// chiedono. Vedi `FlussoBle::ascolta_prima_di_parlare`.
///
/// ► TRECENTO MILLISECONDI NON SONO NOSTRI: SONO DI LIBDIVECOMPUTER. ◄ È la
/// pausa che la libreria stessa fa all'apertura di `shearwater_common.c` e di
/// `deepsix_excursion.c` — `dc_iostream_sleep (…, 300)` e subito dopo
/// `dc_iostream_purge`, sotto il commento *«Make sure everything is in a sane
/// state»*. Qui si aspetta **trecento millisecondi di silenzio** e non trecento
/// millisecondi e basta: una pausa fissa taglierebbe a metà un computer che sta
/// ancora svuotando la coda, e il resto arriverebbe dopo lo svuotamento.
pub const SILENZIO_PRIMA_DI_PARLARE: Duration = Duration::from_millis(300);

/// Oltre questo si parla comunque.
///
/// Un computer che dopo tre secondi sta ancora mandando dati non sta svuotando
/// una coda: sta parlando con qualcun altro — un'altra applicazione collegata
/// allo stesso apparecchio — e aspettare non lo zittisce. A quel punto decide
/// libdivecomputer, che al primo pacchetto estraneo si ferma e lo dice.
pub const TETTO_PRIMA_DI_PARLARE: Duration = Duration::from_secs(3);

// --------------------------------------------------------------- il flusso BLE

/// Come si scrivono i byte verso il computer: riesce, o dice con un nome perché
/// non è riuscito. Un nome per il tipo perché compariva identico in due firme.
pub type ScritturaBle = Box<dyn FnMut(&[u8]) -> Result<(), GuastoScrittura> + Send>;

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
    scrittura: ScritturaBle,
    /// Gli accessori del Bluetooth che non sono byte: nome e lettura di una
    /// caratteristica. Vedi `AccessoriBle`.
    accessori: Option<Box<dyn AccessoriBle>>,
    /// Cosa fare quando il PRIMO scambio resta muto — vedi `leggi`.
    su_silenzio: Option<Box<dyn FnMut() -> Ripiego + Send>>,
    /// Se una notifica è mai stata consegnata: dopo la prima, il ripiego sul
    /// silenzio non ha più senso, perché il canale ha dimostrato di funzionare.
    ricevuto_qualcosa: bool,
    /// Come si rimettono insieme le notifiche. Vedi `Riassemblaggio`.
    riassemblaggio: Riassemblaggio,
    /// La notifica più grande vista finora: è la stima della dimensione
    /// «piena», cioè dell'MTU meno tre. Non si può chiedere al plugin in modo
    /// portabile, e comunque quello che conta è quanto arriva davvero.
    notifica_piena: usize,
    /// Quante volte il riassemblaggio si è arreso con un pacchetto a metà.
    frammenti_mancati: usize,
    /// La pausa più lunga fra due frammenti che è stata **colmata**. Vedi `MisureLettura`.
    pausa_colmata: Duration,
    /// Il silenzio più lungo fra un comando e la sua risposta. Vedi `MisureLettura`.
    silenzio_massimo: Duration,
    /// Quante volte si è concessa una seconda finestra invece di dire «scaduta».
    proroghe: usize,
    /// Quante di quelle hanno portato davvero una risposta. Vedi `MisureLettura`.
    proroghe_utili: usize,
    /// Quante volte l'attesa ha sforato la scadenza tanto da rivelare un
    /// congelamento del processo.
    congelamenti: usize,
    /// Il silenzio da aspettare prima del primo comando, e il tetto oltre cui
    /// si parla comunque. `None` per chi non ne ha bisogno. Vedi
    /// `ascolta_prima_di_parlare`.
    ascolto_iniziale: Option<(Duration, Duration)>,
    /// Se il primo comando è già partito: l'ascolto iniziale si fa una volta
    /// sola, prima di quello, e mai più.
    ha_parlato: bool,
    /// Le notifiche buttate prima del primo comando: quante, e quanti byte.
    scartate_prima: (usize, usize),
    /// Se si buttano i pacchetti Pelagic che rispondono a un comando diverso
    /// dall'ultimo scritto. Vedi `con_filtro_del_comando`.
    filtro_del_comando: bool,
    /// Il comando dell'ultimo pacchetto Pelagic scritto, quando il filtro è acceso.
    ultimo_comando: Option<u8>,
    /// I pacchetti buttati dal filtro: quanti, e quanti byte.
    estranei: (usize, usize),
    /**
     * Dove si annotano le letture **andate a vuoto**, per il banco di prova.
     *
     * ════════════════════════════════════════════════════════════════════════
     * ► IL BUCO CHE HA MOSTRATO LA PRIMA REGISTRAZIONE VERA DELLA STRADA LDC. ◄
     *
     * L'11 settembre 2026, sera. Il file conteneva cinque scritture e **nessuna
     * lettura**, perché le letture erano tornate tutte vuote e una lettura
     * vuota non produce nessuna notifica da registrare. Dal file si capiva lo
     * stesso — le scritture distavano 4,1 secondi l'una dall'altra, che sono i
     * tre secondi di attesa della libreria più il secondo di sonno del suo
     * ritentativo — **ma solo sapendo già il protocollo.**
     *
     * *Un file che si legge solo se sai già la risposta non è una
     * registrazione: è un promemoria.* E questo file nasce per essere riaperto
     * fra mesi, da chi quella cadenza non la ricorda.
     *
     * Quindi le letture a vuoto si scrivono, con quanto si era chiesto e
     * quanto si è aspettato. Le letture **riuscite** no: quelle le racconta già
     * la notifica che è arrivata, e scriverle due volte raddoppierebbe un file
     * che su un archivio pieno ha già migliaia di righe.
     */
    registratore: Option<Box<dyn Fn(String) + Send>>,
}

/// Come si rimettono insieme le notifiche dentro una lettura.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► DUE PROTOCOLLI CHIEDONO A QUESTO TRASPORTO DUE COSE OPPOSTE. ◄
///
/// **Uwatec** (Aladin, G2, Luna) mette in testa a ogni notifica un byte che
/// non è dato — libdivecomputer lo scarta calcolando `len = ricevuti - 1`, e
/// c'è un commento di venti righe in `uwatec_smart.c` che ammette di non
/// sapere bene cosa sia. Unire due notifiche in una lettura sola infilerebbe
/// quel byte **dentro i dati**, e il sintomo sarebbe il peggiore possibile:
/// nessun errore, un trasferimento «riuscito», e una memoria disallineata in
/// cui i marcatori delle immersioni non si trovano più.
///
/// **Mares**, sul ramo a lunghezza variabile — Sirius, Puck 4, Puck Air 2 e
/// **Quad Ci** — fa l'opposto: legge il pacchetto con UNA `dc_iostream_read` e
/// si aspetta di trovarcelo tutto, dal `AA` iniziale al `EA` finale. Per gli
/// altri modelli Mares libdivecomputer apre `dc_packet_open(…, 244, 20)`, che
/// i pezzi li rimette insieme da sé; per questi no. Se il pacchetto non sta in
/// una notifica, il primo byte c'è ma l'ultimo no, e la risposta viene
/// rifiutata — quattro volte, che è il numero di `MAXRETRIES`.
///
/// Non è un'ipotesi: `il_pacchetto_del_mares_deve_stare_in_una_notifica_sola`
/// lo misura contro libdivecomputer vera, e il confine cade **esattamente a
/// 142 byte** per il pacchetto della versione.
///
/// Quindi la politica non può essere una sola, e non può nemmeno essere
/// indovinata: la sceglie chi apre il collegamento, perché è l'unico che sa
/// con quale computer sta per parlare.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Riassemblaggio {
    /// Una notifica per lettura, mai due unite. È il comportamento per
    /// difetto, ed è quello che serve a Uwatec.
    UnaNotifica,
    /// Le notifiche si rimettono insieme fino a riempire la lettura.
    ///
    /// Si uniscono solo finché ognuna arriva **piena**: su BLE un messaggio
    /// più lungo dell'MTU viene spezzato in frammenti tutti della stessa
    /// dimensione tranne l'ultimo, quindi una notifica più corta delle altre è
    /// la fine del messaggio. È una regola del trasporto e non del protocollo,
    /// ed è per questo che si può applicare senza sapere cosa c'è dentro.
    PacchettoIntero,
    /// **La lunghezza la dichiara il pacchetto**, e allora non si indovina.
    ///
    /// ════════════════════════════════════════════════════════════════════════
    /// ► LA SEGNALAZIONE DEL 16 SETTEMBRE 2026, DA UN AQUALUNG i330R. ◄
    ///
    /// Quaranta immersioni arrivate, poi:
    ///
    /// ```text
    /// libdivecomputer, errore: Invalid packet length (96). [pelagic_i330r.c:214]
    /// ```
    ///
    /// Quella riga, nel sorgente, è `if (length + 5 > transferred)`: il
    /// pacchetto dichiarava 96 byte di carico — 101 in tutto — e il nostro
    /// trasporto ne aveva consegnati meno. Il diario dice anche la dimensione
    /// delle notifiche, *«da 6 a 101 byte»*: il pacchetto pieno è proprio 101, e
    /// quella volta la radio l'aveva spezzato in due.
    ///
    /// La politica in uso era `UnaNotifica`, che una notifica per lettura la
    /// consegna e basta. Finché ogni pacchetto sta in una notifica va bene —
    /// quaranta immersioni sono passate così. Nell'istante in cui uno si spezza,
    /// libdivecomputer ne vede il primo pezzo e lo rifiuta.
    ///
    /// ► E `PacchettoIntero` NON ERA LA RISPOSTA. ◄ Quella unisce «finché ogni
    /// notifica arriva piena», che è una regola del TRASPORTO: vera quando a
    /// spezzare è l'MTU, muta quando a spezzare è qualcos'altro. Su un pacchetto
    /// da 101 byte che è anche il più grande mai visto, aspetterebbe 250 ms un
    /// frammento che non arriva mai; e se nel frattempo arriva il pacchetto
    /// *dopo*, lo incolla al primo e i suoi byte si perdono in silenzio — che è
    /// il difetto peggiore dei due, perché non dà nessun errore.
    ///
    /// ► QUI LA REGOLA È DEL PROTOCOLLO, ED È SCRITTA NEL PACCHETTO. ◄
    /// L'inquadramento della famiglia Pelagic è
    /// `CD <bandiera> <comando> <checksum> <lunghezza>` e poi il carico: il
    /// totale è **`lunghezza + 5`**. Non è dedotto dal sorgente della libreria,
    /// è misurato su cinque pacchetti del diario di quel giorno, quattro
    /// scritture e una notifica:
    ///
    /// ```text
    /// cd 40 fa f6 09 …  14 byte    0x09 + 5 = 14
    /// cd 80 fa 92 10 …  21 byte    0x10 + 5 = 21
    /// cd 80 fb 94 06 …  11 byte    0x06 + 5 = 11
    /// cd 00 0d be 09 …  14 byte    0x09 + 5 = 14
    /// cd c0 fa 94 02 01 00  7 byte 0x02 + 5 = 7
    /// ```
    ///
    /// Quindi: si legge l'intestazione, si aspetta finché i byte dichiarati non
    /// ci sono tutti, e si consegna **esattamente quel pacchetto** — il resto,
    /// se è arrivato attaccato, resta in cassa per la lettura dopo. Nessuna
    /// attesa quando il pacchetto è già intero, nessun incollamento quando non
    /// lo è.
    ///
    /// *Dove il protocollo dice la lunghezza, indovinarla è una scelta — ed è
    /// la scelta sbagliata.*
    LunghezzaDichiarata,
}

/// Il byte con cui comincia ogni pacchetto della famiglia Pelagic.
const INIZIO_PACCHETTO: u8 = 0xCD;
/// `CD <bandiera> <comando> <checksum> <lunghezza>`: cinque byte prima del carico.
const INTESTAZIONE: usize = 5;

/// Quanto è lungo, in tutto, il pacchetto che comincia qui — quando si può già
/// saperlo.
///
/// `None` ha due significati diversi e va bene che li abbia tutti e due, perché
/// portano allo stesso gesto — consegnare quello che c'è: o l'intestazione non è
/// ancora arrivata tutta, o il primo byte non è quello d'inizio e allora siamo
/// fuori sincronia. Nel secondo caso la diagnosi giusta la dà libdivecomputer,
/// che risponde «Unexpected packet start byte» e dice *quale* byte ha trovato:
/// tenersi i byte qui dentro per «riallinearsi» nasconderebbe l'unica
/// informazione utile.
fn confine_dichiarato(avanzo: &VecDeque<u8>) -> Option<usize> {
    if avanzo.len() < INTESTAZIONE || avanzo.front() != Some(&INIZIO_PACCHETTO) {
        return None;
    }
    Some(avanzo[INTESTAZIONE - 1] as usize + INTESTAZIONE)
}

/// Se del pacchetto cominciato manca ancora un pezzo.
///
/// Un avanzo che non comincia per `CD` non è un pacchetto a metà: è un avanzo
/// fuori sincronia, e aspettare dei frammenti per lui vorrebbe dire fermarsi
/// 250 ms per ogni lettura fino alla fine dello scarico.
fn manca_un_pezzo(avanzo: &VecDeque<u8>) -> bool {
    match avanzo.front() {
        None => false,
        Some(&primo) if primo != INIZIO_PACCHETTO => false,
        // Intestazione incompleta: non si sa quanto manca, ma si sa che manca.
        Some(_) => match confine_dichiarato(avanzo) {
            None => true,
            Some(quanto) => avanzo.len() < quanto,
        },
    }
}

impl Riassemblaggio {
    /// L'altra politica. Serve al giro dei tentativi: quando la scelta fatta
    /// per un modello non funziona, l'unica altra cosa da provare è questa.
    ///
    /// Per `LunghezzaDichiarata` l'altra è `UnaNotifica`, cioè il comportamento
    /// di prima: se leggere la lunghezza dal pacchetto non funziona, vuol dire
    /// che quell'apparecchio non ha l'inquadramento che crediamo, e l'unica
    /// cosa onesta che resta è consegnare quello che arriva.
    pub fn altro(self) -> Self {
        match self {
            Self::UnaNotifica => Self::PacchettoIntero,
            Self::PacchettoIntero => Self::UnaNotifica,
            Self::LunghezzaDichiarata => Self::UnaNotifica,
        }
    }
}

/// Quanto si concede **a chiunque**, anche a un metodo che non ha mai parlato,
/// quando la finestra vera è appena scaduta.
///
/// Non è l'attesa di un frammento: è l'ultimo istante prima di dichiarare muta
/// una combinazione di caratteristiche. Qui il tetto **deve** restare corto, e
/// la ragione non è il risparmio ma il giro dei metodi: ci sono otto
/// combinazioni da provare e ogni vicolo cieco si paga su ognuna. Quaranta
/// millisecondi contro i tremila della finestra vera.
///
/// Nelle prove è cortissimo: una prova che aspetta per vedere un'attesa insegna
/// a non lanciare le prove.
/// L'intervallo di connessione BLE **misurato**, non quello dei manuali.
///
/// Aladin Sport Matrix, 11 settembre 2026: andate e ritorni di 59, 58, 60, 60,
/// 60 ms. Mares Puck 4, 12 settembre: 7472 scambi in 462 s di registrazione,
/// mediana **60 ms**, massimo 151. *Due apparecchi di due marche, lo stesso
/// numero.*
///
/// Sta qui perché i due tetti qui sotto si giustificano **contro di lui** e non
/// contro un'intuizione: è la costante che ha smentito la forbice «7,5-30 ms»
/// su cui era stato scelto il tetto vecchio.
const INTERVALLO_MISURATO: Duration = Duration::from_millis(60);

/// Il valore vero di `ULTIMO_ISTANTE`. Separato perché una prova lo possa
/// guardare: sotto `cfg(test)` la costante usata è cortissima, quindi una prova
/// che la leggesse non direbbe niente su quello che viene spedito.
const ULTIMO_ISTANTE_VERO: Duration = Duration::from_millis(40);

const ULTIMO_ISTANTE: Duration =
    if cfg!(test) { Duration::from_millis(5) } else { ULTIMO_ISTANTE_VERO };

/// Quanto si aspetta il pezzo successivo di un messaggio **già cominciato**.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► QUARANTA MILLISECONDI ERANO MENO DI UN GIRO DI RADIO, E IL 12 SETTEMBRE
/// SI È VISTO. ◄
///
/// Fino alla 1.8.17 questo tetto e `ULTIMO_ISTANTE` erano **la stessa
/// costante**, e la giustificazione scritta qui sopra era una sola: «i
/// frammenti arrivano a distanza di un intervallo di connessione — da 7,5 a 30
/// millisecondi sui parametri consueti — quindi quaranta è largo abbastanza».
///
/// **Quel numero non era stato misurato, ed era sbagliato.** L'intervallo di
/// connessione vero, misurato l'11 settembre sull'Aladin — 59, 58, 60, 60, 60
/// ms di andata e ritorno — e confermato il 12 sul Puck 4 — 307 secondi utili
/// per 4854 scambi, 63 ms l'uno — è il **doppio** del limite alto di quella
/// forbice. *Aspettavamo un frammento meno di quanto la radio impiega a
/// ripassare.*
///
/// Il diario del Puck 4 del 12 settembre lo dice con due numeri accostati, e
/// li accosta apposta: `pausa più lunga fra due frammenti: 41 ms (si aspetta al
/// massimo 40 ms)`, e `pacchetti lasciati a metà: 2`. Il tetto è stato toccato,
/// e due pacchetti sono stati consegnati a metà a un protocollo che non ha
/// checksum.
///
/// ► E LA DOMANDA ERA STATA SCRITTA PRIMA. ◄ Nel commento di `MisureLettura`,
/// l'11 settembre: *«alzare quel tetto sarebbe una deduzione, e le deduzioni in
/// questa storia hanno già perso una volta. Quindi non si alza: si misura. Se
/// la pausa più lunga davvero osservata sta incollata al tetto, il tetto è il
/// problema e si alza sapendo perché.»* È incollata. Si alza, e adesso il
/// perché c'è.
///
/// **Duecentocinquanta millisecondi, cioè quattro intervalli di connessione
/// misurati.** Il costo si paga solo dove il pacchetto è davvero cominciato e
/// davvero si ferma: il 12 settembre sarebbe stato due volte su 4854 letture,
/// cioè meno di mezzo secondo su sei minuti. E qui l'argomento del giro dei
/// metodi **non vale**, ed è il motivo per cui le due costanti sono state
/// separate: un pacchetto a metà è la prova che questa combinazione funziona.
/// *Un tetto che serve a due scopi opposti prende il valore sbagliato per
/// almeno uno dei due.*
/// Di quanto un'attesa deve sforare la propria scadenza perché si possa dire
/// che il processo era **congelato** invece che in ascolto.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► UNA LETTURA NON È SCADUTA SOLO PERCHÉ IL TEMPO È PASSATO. ◄
///
/// `aspetta` calcola una scadenza assoluta e ci dorme sopra. Finché il
/// processo gira, sforarla di più di qualche millisecondo è impossibile. Ma su
/// iOS un'applicazione che va in secondo piano viene **sospesa**: i thread si
/// fermano, l'orologio no. Al risveglio la scadenza è passata da un pezzo, e il
/// codice — senza questa riga — direbbe «il computer non ha risposto» proprio
/// nell'istante in cui il sistema gli sta consegnando la risposta che aveva
/// tenuto in coda.
///
/// *Quel falso scaduto non è un fastidio: è l'innesco.* Il backend Mares, a
/// quel punto, dorme un secondo, svuota l'ingresso e rimanda il comando — e
/// siccome il protocollo Mares non ha né checksum né numeri di sequenza, una
/// risposta vecchia che arriva dopo lo svuotamento desincronizza tutto senza
/// che nessuno possa accorgersene. È la catena esatta del diario del 10
/// settembre.
///
/// Mezzo secondo: abbondante per qualunque ritardo di sistema operativo
/// occupato, incomparabilmente più corto di un blocco schermo.
const SFORO_DA_CONGELAMENTO: Duration = if cfg!(test) {
    Duration::from_millis(20)
} else {
    Duration::from_millis(500)
};

/// Se un'attesa finita in `passato`, che ne chiedeva `attesa`, rivela che il
/// processo era fermo.
///
/// ► STA FUORI DAL FLUSSO PERCHÉ UN CONGELAMENTO NON SI PUÒ SIMULARE. ◄ Per
/// vederlo davvero servirebbe sospendere il thread dall'esterno, cioè un
/// sistema operativo dentro una prova. La regola però è una riga, e una riga si
/// può inchiodare da sola: quello che resta senza guardia è soltanto il punto
/// in cui viene chiamata, che sta in vista tre righe sotto. *È meno di quanto
/// vorrei e più di quanto avevo: la versione prima non aveva né la funzione né
/// la prova, e una mutazione è rimasta verde a dirlo.*
fn e_un_congelamento(passato: Duration, attesa: Duration) -> bool {
    passato > attesa + SFORO_DA_CONGELAMENTO
}

/// Il valore vero di `ATTESA_FRAMMENTO`. Vedi `ULTIMO_ISTANTE_VERO` per il
/// perché sta fuori dal `cfg`.
const ATTESA_FRAMMENTO_VERA: Duration = Duration::from_millis(250);

const ATTESA_FRAMMENTO: Duration =
    if cfg!(test) { Duration::from_millis(5) } else { ATTESA_FRAMMENTO_VERA };

/// ► «DUECENTOCINQUANTA, CIOÈ QUATTRO INTERVALLI MISURATI», adesso lo controlla
/// il compilatore. ◄
///
/// `INTERVALLO_MISURATO` esiste per giustificare questo tetto — sta scritto nel
/// suo commento — e fino al 18 settembre 2026 **nessuno lo leggeva**: era una
/// costante morta, che clippy segnalava come tale, e la relazione fra i due
/// numeri viveva soltanto in una frase. *Un fatto scritto in un commento non si
/// rimisura da solo.* Il giorno che qualcuno riabbassasse l'attesa a cento
/// millisecondi per «renderla più reattiva», la frase continuerebbe a dire
/// quattro e nessuno se ne accorgerebbe fino al prossimo pacchetto consegnato a
/// metà — a un protocollo che non ha checksum.
///
/// Adesso non compila.
const _: () = assert!(
    ATTESA_FRAMMENTO_VERA.as_millis() >= 4 * INTERVALLO_MISURATO.as_millis(),
    "l'attesa di un frammento deve coprire almeno quattro intervalli di connessione misurati"
);

#[cfg(test)]
mod prove_dei_tetti {
    use super::*;

    /// ════════════════════════════════════════════════════════════════════════
    /// ► I DUE TETTI SI GIUDICANO CONTRO UNA MISURA, NON L'UNO CONTRO L'ALTRO. ◄
    ///
    /// Sotto `cfg(test)` valgono tutti e due cinque millisecondi, quindi
    /// **nessuna prova del trasporto può accorgersi se li si scambia**: si
    /// spedirebbe un'applicazione in cui il frammento aspetta quaranta
    /// millisecondi e il giro dei metodi ne aspetta duecentocinquanta, e tutto
    /// resterebbe verde. *Un numero che conta solo in produzione va inchiodato
    /// in produzione, o non è inchiodato affatto.*
    ///
    /// È la stessa regola che questo progetto applica ai conti scritti nei
    /// commenti: se una spiegazione è la ragione di un valore, la spiegazione
    /// diventa un'asserzione.
    #[test]
    fn il_frammento_aspetta_piu_di_un_giro_di_radio_e_il_giro_dei_metodi_meno() {
        assert!(
            ATTESA_FRAMMENTO_VERA >= INTERVALLO_MISURATO * 4,
            "un pacchetto già cominciato deve poter attraversare più giri di radio: \
             {ATTESA_FRAMMENTO_VERA:?} contro un intervallo di {INTERVALLO_MISURATO:?}. \
             Il 12 settembre 2026 il tetto era 40 ms, cioè MENO di un giro, e il diario \
             del Puck 4 lo dice: «pausa più lunga fra due frammenti: 45 ms»."
        );
        assert!(
            ULTIMO_ISTANTE_VERO < INTERVALLO_MISURATO,
            "l'ultimo istante si paga su OGNI vicolo cieco del giro degli otto metodi, \
             e lì un tetto lungo raddoppia il tempo di ogni metodo sbagliato: \
             {ULTIMO_ISTANTE_VERO:?} deve restare sotto {INTERVALLO_MISURATO:?}"
        );
    }
}

/*
 * ► QUI C'ERA UN'ECONOMIA, ED ERA UNA TRAPPOLA. ◄
 *
 * La prima versione smetteva di aspettare frammenti dopo tre attese a vuoto,
 * per non regalare quaranta millisecondi a lettura su un apparecchio che non
 * spezza mai niente. Sembrava prudente e non lo era, per una ragione che si
 * vede solo guardando il protocollo: **le risposte non sono tutte della stessa
 * lunghezza**. La prima è il pacchetto della versione, 142 byte; i segmenti
 * dello scarico arrivano a 244. Su un telefono con l'MTU in mezzo — e sono
 * tanti — le prime letture non spezzano niente, il fermo scattava, e poi il
 * primo segmento grosso arrivava a pezzi con l'attesa già spenta: mezzo
 * pacchetto consegnato, «errore di protocollo», quattro ritentativi. Cioè
 * esattamente il guasto che tutto questo esiste per riparare, ricreato
 * dall'ottimizzazione che doveva renderlo più veloce.
 *
 * Il costo vero, adesso che l'attesa non si spegne mai: un'attesa per lettura
 * SOLO quando la notifica è arrivata piena e la lettura chiedeva di più. Su uno
 * scarico da millecinquecento letture sono meno di un minuto su tre o quattro,
 * e si pagano solo per i cinque Mares che ne hanno bisogno. Un minuto in più
 * vale uno scarico che riesce.
 */

/// Cosa ha fatto il ripiego sul silenzio, quando è stato chiamato.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ripiego {
    /// Non c'era niente da rimandare (nessuna scrittura ancora): il ripiego
    /// resta disponibile per il primo scambio vero.
    NienteDaFare,
    /// Ha rimandato l'ultimo comando nell'altra modalità: vale una seconda
    /// attesa, e non si richiama più.
    Rimandato,
    /// Non può fare niente (una modalità sola, o già provata): non si
    /// richiama più.
    Esaurito,
}

/// Le due domande che libdivecomputer fa al Bluetooth oltre ai byte.
///
/// Stanno in un tratto a parte, e non dentro la chiusura di scrittura, perché
/// sono l'unica parte del trasporto che ha bisogno di tornare nel runtime
/// asincrono (leggere una caratteristica è una chiamata al plugin): chi
/// costruisce il `FlussoBle` sa come farlo, `FlussoBle` no, e non deve.
pub trait AccessoriBle: Send {
    fn nome(&mut self) -> Option<String>;
    fn leggi_caratteristica(&mut self, uuid: [u8; 16]) -> Result<Vec<u8>, String>;
    /// Chiede le sei cifre a chi guarda lo schermo, e ASPETTA. Vedi
    /// `FlussoByte::codice_pin`.
    fn codice_pin(&mut self) -> Option<String> {
        None
    }
    /// Il codice di accesso conservato da uno scarico precedente.
    fn codice_accesso(&mut self) -> Option<Vec<u8>> {
        None
    }
    /// Il codice di accesso appena emesso dal computer, da conservare.
    fn salva_codice_accesso(&mut self, _codice: &[u8]) {}
}

impl FlussoBle {
    pub fn nuovo(
        entrata: Receiver<Vec<u8>>,
        scrittura: ScritturaBle,
    ) -> Self {
        Self {
            entrata,
            arrivate: VecDeque::new(),
            avanzo: VecDeque::new(),
            scrittura,
            accessori: None,
            su_silenzio: None,
            ricevuto_qualcosa: false,
            riassemblaggio: Riassemblaggio::UnaNotifica,
            notifica_piena: 0,
            frammenti_mancati: 0,
            pausa_colmata: Duration::ZERO,
            silenzio_massimo: Duration::ZERO,
            proroghe: 0,
            proroghe_utili: 0,
            congelamenti: 0,
            ascolto_iniziale: None,
            ha_parlato: false,
            scartate_prima: (0, 0),
            filtro_del_comando: false,
            ultimo_comando: None,
            estranei: (0, 0),
            registratore: None,
        }
    }

    /// Lo stesso flusso, che prima del primo comando aspetta `silenzio` di
    /// quiete — al massimo per `tetto` — e butta tutto quello che arriva
    /// intanto. Vedi `ascolta_prima_di_parlare`.
    pub fn con_ascolto_iniziale(mut self, silenzio: Duration, tetto: Duration) -> Self {
        self.ascolto_iniziale = Some((silenzio, tetto));
        self
    }

    /**
     * ► UNA RISPOSTA PELAGIC PORTA IL COMANDO A CUI RISPONDE: QUELLE CHE NON
     *   LO PORTANO SI BUTTANO. ◄
     *
     * `pelagic_i330r_recv` pretende che il terzo byte di ogni pacchetto sia il
     * comando che ha appena mandato, e al primo che non lo è si ferma:
     * «Unexpected packet command byte». Un pacchetto con un altro comando,
     * quindi, non può mai essere consegnato con profitto — può solo fermare lo
     * scarico. È esattamente quello che ha fatto la coda della lettura rimasta
     * a metà, il 22 settembre 2026.
     *
     * L'ascolto prima di parlare copre la coda che arriva PRIMA del primo
     * comando, ed è il caso che il diario ha mostrato. Questo copre il resto:
     * una coda più lunga del tetto dell'ascolto, o un pacchetto vecchio che
     * arriva dopo. Si butta solo un pacchetto **intero** — la lunghezza la dice
     * lui — e **solo se il comando è diverso**: chi arrivasse con il comando
     * giusto ma i dati di un'altra lettura resta un caso per la libreria, che
     * ha il checksum per accorgersene. Ogni pacchetto buttato si conta, e il
     * diario lo dice.
     *
     * Vale solo con `Riassemblaggio::LunghezzaDichiarata`: senza i confini dei
     * pacchetti non si sa dove comincia il terzo byte di nessuno.
     */
    pub fn con_filtro_del_comando(mut self) -> Self {
        self.filtro_del_comando = true;
        self
    }

    /**
     * PRIMA DI PARLARE SI ASCOLTA, E QUELLO CHE ARRIVA SI BUTTA.
     *
     * ════════════════════════════════════════════════════════════════════════
     * ► IL DIARIO DEL 22 SETTEMBRE 2026, DA UN AQUALUNG i330R. ◄
     *
     *     scrittura n. 1: 14 byte [cd 40 fa f6 09 00 00 00 …], senza conferma
     *     prima notifica: 101 byte [cd a0 0d 82 60 aa aa aa …], 1 ms dopo la prima scrittura
     *     libdivecomputer, errore: Unexpected packet command byte (0d). [pelagic_i330r.c:207]
     *
     * La scrittura è la richiesta d'accesso (`CMD_ACCESS_REQUEST`, `0xFA`), e
     * la risposta che `pelagic_i330r_recv` aspetta porta lo stesso comando. È
     * arrivato invece un pacchetto di `CMD_READ_FLASH` (`0x0D`): novantasei byte
     * di memoria, tutti `0xAA`, con un checksum **giusto** — `0x82` è quello
     * che si calcola su quei byte. Non era rumore: era un pezzo di memoria
     * intero, che nessuno in quel collegamento aveva chiesto.
     *
     * E non poteva essere una risposta a noi: **un millisecondo** è meno di un
     * giro di radio — su BLE una scrittura parte al primo evento di
     * collegamento, e la risposta al più presto a quello dopo. Quel pacchetto
     * era già in viaggio. Le notifiche in tutto sono state due, poi silenzio:
     * è la coda di una lettura rimasta a metà, che il computer ha svuotato
     * appena gli si è riaperto il canale.
     *
     * ► E LA LIBRERIA NON SVUOTA, PER QUESTA FAMIGLIA. ◄ Quasi tutti i backend
     * di libdivecomputer all'apertura fanno `dc_iostream_purge`, sotto il
     * commento *«Make sure everything is in a sane state»* — Shearwater e Deep
     * Six anche con trecento millisecondi di sonno prima. `pelagic_i330r.c`
     * no: nemmeno una chiamata. E il suo `recv` si ferma al primo pacchetto
     * col comando sbagliato, senza cercare quello giusto dopo.
     *
     * Quindi lo si fa qui, nel solo punto in cui è certo che niente di quello
     * che arriva sia nostro: **prima del primo comando**. Si aspetta un
     * silenzio vero — non un tempo fisso, che taglierebbe a metà una coda
     * ancora in uscita — e si butta tutto. Poi si parla.
     *
     * Solo per chi lo chiede: la famiglia Pelagic, che è quella in cui si è
     * visto. Per le altre non c'è una misura, e un'attesa in più su cento
     * modelli mai provati è un cambiamento che nessuno ha chiesto.
     */
    fn ascolta_prima_di_parlare(&mut self) {
        let Some((silenzio, tetto)) = self.ascolto_iniziale else { return };
        let fine = std::time::Instant::now() + tetto;
        self.raccogli_subito();
        loop {
            while let Some(notifica) = self.arrivate.pop_front() {
                self.scartate_prima.0 += 1;
                self.scartate_prima.1 += notifica.len();
            }
            let rimasto = fine.saturating_duration_since(std::time::Instant::now());
            if rimasto.is_zero() {
                break;
            }
            match self.entrata.recv_timeout(silenzio.min(rimasto)) {
                Ok(notifica) => self.arrivate.push_back(notifica),
                // Silenzio per tutto il tempo chiesto, o tetto raggiunto: si
                // parla. Un canale chiuso lo dirà la scrittura, con parole sue.
                Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        self.avanzo.clear();
    }

    /// Lo stesso flusso, che annota le letture a vuoto sul banco di prova.
    ///
    /// La chiusura riceve la riga già composta: chi la fornisce decide dove
    /// metterla e come marcarla. Vedi `registratore`.
    pub fn con_registratore(mut self, dove: Box<dyn Fn(String) + Send>) -> Self {
        self.registratore = Some(dove);
        self
    }

    /// Lo stesso flusso, con la politica di riassemblaggio detta.
    ///
    /// La sceglie chi apre il collegamento, che è l'unico a sapere con quale
    /// computer si sta per parlare. Vedi `Riassemblaggio`.
    pub fn con_riassemblaggio(mut self, come: Riassemblaggio) -> Self {
        self.riassemblaggio = come;
        self
    }

    /// Lo stesso flusso, con gli accessori e il ripiego sul silenzio.
    ///
    /// `su_silenzio` viene chiamata quando una lettura scade senza che sia
    /// mai arrivata una notifica in tutta la sessione. Se ha rimandato
    /// l'ultimo comando nell'altra modalità, la lettura aspetta un'altra
    /// volta lo stesso tempo e il ripiego non viene più chiamato; se non
    /// aveva niente da rimandare resta a disposizione per il primo scambio
    /// vero; se non può fare niente, non viene più chiamato.
    pub fn con_accessori(
        mut self,
        accessori: Box<dyn AccessoriBle>,
        su_silenzio: Box<dyn FnMut() -> Ripiego + Send>,
    ) -> Self {
        self.accessori = Some(accessori);
        self.su_silenzio = Some(su_silenzio);
        self
    }

    /// Svuota il canale senza aspettare. Serve a `disponibili` e prima di leggere.
    fn raccogli_subito(&mut self) {
        while let Ok(pezzo) = self.entrata.try_recv() {
            self.arrivate.push_back(pezzo);
        }
    }

    /// Aspetta al massimo `attesa` che arrivi almeno una notifica.
    ///
    /// Scadere non è un errore (si torna con la coda vuota); il canale chiuso
    /// sì, perché vuol dire che il Bluetooth se n'è andato, e va distinto da
    /// «non è ancora arrivato niente».
    fn aspetta(&mut self, attesa: Duration) -> Result<(), String> {
        let scadenza = std::time::Instant::now() + attesa;
        while self.arrivate.is_empty() {
            let rimasto = scadenza.saturating_duration_since(std::time::Instant::now());
            if rimasto.is_zero() {
                break;
            }
            match self.entrata.recv_timeout(rimasto) {
                Ok(pezzo) => self.arrivate.push_back(pezzo),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("il collegamento Bluetooth si è chiuso".into())
                }
            }
        }
        Ok(())
    }
}

impl FlussoBle {
    /// Aspetta i frammenti che mancano al pacchetto Pelagic cominciato in
    /// cassa, finché i byte dichiarati non ci sono tutti.
    ///
    /// ► QUI LA LUNGHEZZA NON SI INDOVINA: LA DICE IL PACCHETTO. ◄ Un frammento
    /// vale `ATTESA_FRAMMENTO`, e se non arriva si conta — ma la condizione
    /// d'uscita è un fatto invece di una regola empirica: si smette quando i
    /// byte dichiarati ci sono tutti. Vedi `Riassemblaggio::LunghezzaDichiarata`
    /// per la segnalazione che l'ha resa necessaria. Il caso che la regola del
    /// pacchetto pieno non sa distinguere e questo sì: un pacchetto **intero**
    /// che è anche il più grande mai visto. Là si aspetterebbe un seguito che non
    /// esiste, qui si esce subito perché il conto torna.
    fn completa_il_dichiarato(&mut self) -> Result<(), String> {
        while manca_un_pezzo(&self.avanzo) {
            self.raccogli_subito();
            if self.arrivate.is_empty() {
                let inizio_pausa = std::time::Instant::now();
                let esito_attesa = self.aspetta(ATTESA_FRAMMENTO);
                let quanto = inizio_pausa.elapsed();
                if let Err(motivo) = esito_attesa {
                    self.avanzo.clear();
                    return Err(motivo);
                }
                if self.arrivate.is_empty() {
                    /*
                     * Il pacchetto resta a metà e si consegna com'è:
                     * libdivecomputer risponderà «Invalid packet length», che è
                     * la verità. Quello che cambia rispetto a prima è che adesso
                     * **il diario lo sa**: `frammenti_mancati` sale, e il numero
                     * che prima diceva zero davanti a un pacchetto spezzato
                     * smette di dire zero.
                     */
                    self.frammenti_mancati += 1;
                    break;
                }
                self.pausa_colmata = self.pausa_colmata.max(quanto);
            }
            let Some(pezzo) = self.arrivate.pop_front() else { break };
            self.notifica_piena = self.notifica_piena.max(pezzo.len());
            self.avanzo.extend(pezzo);
        }
        Ok(())
    }
}

impl FlussoByte for FlussoBle {
    fn scrivi(&mut self, dati: &[u8]) -> Result<(), GuastoScrittura> {
        if !self.ha_parlato {
            self.ha_parlato = true;
            self.ascolta_prima_di_parlare();
        }
        if self.filtro_del_comando && dati.len() > 2 && dati[0] == INIZIO_PACCHETTO {
            self.ultimo_comando = Some(dati[2]);
        }
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
            /*
             * ► SI CRONOMETRA SEMPRE, E NON SERVE NESSUNA GUARDIA. ◄ La prima
             * versione aveva un `if` che misurava solo quando la coda era
             * vuota, con un commento che diceva «altrimenti si annacqua il
             * massimo». Era sbagliato, e una mutazione lo ha dimostrato
             * restando verde: *un massimo non si annacqua*. Una lettura che
             * trova la risposta già arrivata contribuisce zero, e zero non
             * sposta un massimo — sposterebbe una media, che qui non c'è.
             *
             * Vale la pena tenerlo scritto: quel guardiano non sorvegliava
             * niente, e senza la mutazione sarebbe rimasto lì per sempre a
             * sembrare prudenza.
             */
            let inizio_silenzio = std::time::Instant::now();
            let esito_attesa = self.aspetta(attesa);
            let passato = inizio_silenzio.elapsed();
            self.silenzio_massimo = self.silenzio_massimo.max(passato);
            esito_attesa?;

            /*
             * ════════════════════════════════════════════════════════════════
             * ► NON CI SI ARRENDE AL PRIMO SILENZIO. ◄
             *
             * Questa è la correzione che non dipende da quale sia la causa
             * vera, ed è per questo che vale più delle altre. Il silenzio di
             * qualche secondo ha dieci cause possibili — l'applicazione
             * congelata da iOS, il computer che si prende una pausa, un
             * pacchetto perso — e su nessuna di quelle possiamo intervenire da
             * qui. **Ma su cosa chiamiamo «scaduto» sì.**
             *
             * E chiamarlo scaduto costa caro: il backend Mares dorme un
             * secondo, svuota l'ingresso e rimanda il comando, e il protocollo
             * Mares non ha né checksum né numeri di sequenza — una risposta
             * vecchia che arriva dopo lo svuotamento desincronizza tutto senza
             * che nessuno se ne accorga. *Il timeout non è la reazione al
             * guasto: è il guasto.*
             *
             * Due mosse, in ordine di costo.
             *
             * **L'ultimo istante**, che si concede a chiunque, anche a un metodo
             * che non ha mai parlato. Non è una seconda finestra: è
             * `ULTIMO_ISTANTE`, quaranta millisecondi, contro i tremila della
             * finestra vera. Serve al caso in cui la risposta è arrivata un
             * soffio dopo la scadenza — e su una prima risposta quel soffio
             * costa il metodo intero, perché il giro lo scarta come muto e
             * passa al successivo.
             *
             * *La prima versione qui non aspettava niente: guardava e basta. Una
             * mutazione è rimasta verde e ha dimostrato che quel guardare non
             * era sorvegliato da nessuna prova — e non lo poteva essere, perché
             * il caso da riprodurre era un millisecondo esatto fra due righe.
             * Quaranta millisecondi sono la stessa idea in una forma che si può
             * inchiodare.*
             */
            if self.arrivate.is_empty() {
                // ► `ULTIMO_ISTANTE` E NON `ATTESA_FRAMMENTO`, DAL 12 SETTEMBRE. ◄
                // Qui il computer potrebbe non aver mai parlato, e il giro degli
                // otto metodi si paga su ogni vicolo cieco. Là sotto, dove un
                // pacchetto è già cominciato, vale il contrario. Fino alla
                // 1.8.17 era la stessa costante per tutti e due, e ha preso il
                // valore giusto per questo e sbagliato per quello.
                self.aspetta(ULTIMO_ISTANTE)?;
            }

            /*
             * **La seconda finestra**, che costa un'attesa in più — e solo
             * quando ha senso.
             *
             * ► LA CONDIZIONE `ricevuto_qualcosa` NON È PRUDENZA, È IL GIRO DEI
             * METODI. ◄ Se da questa combinazione di caratteristiche non è mai
             * arrivato niente, il metodo è sbagliato e va cambiato in fretta:
             * raddoppiare l'attesa lì vorrebbe dire raddoppiare il tempo di
             * ogni vicolo cieco, cioè rendere insopportabile proprio il giro
             * che esiste per uscirne. Qui invece il computer ha già parlato:
             * *una conversazione che funziona e inciampa merita un'altra
             * domanda, una sola.*
             *
             * Il tetto è una proroga per lettura: un collegamento davvero morto
             * costa il doppio del tempo, non l'infinito.
             */
            if self.arrivate.is_empty() && self.ricevuto_qualcosa {
                if e_un_congelamento(passato, attesa) {
                    // L'attesa ha sforato la propria scadenza: il processo era
                    // fermo. Vedi `SFORO_DA_CONGELAMENTO`.
                    self.congelamenti += 1;
                }
                self.proroghe += 1;
                self.aspetta(attesa)?;
                if !self.arrivate.is_empty() {
                    // ► IL NUMERO CHE GIUDICA QUESTA CORREZIONE. ◄ Se le
                    // proroghe utili sono tante, il tempo concesso era il
                    // problema; se sono sempre zero, questa riga è solo un
                    // raddoppio dell'attesa e va tolta. Il prossimo diario
                    // decide, e nessuno deve indovinare.
                    self.proroghe_utili += 1;
                }
            }
            /*
             * IL RIPIEGO SUL SILENZIO. Se non è mai arrivato niente in tutta la
             * sessione e la prima attesa è scaduta, il primo scambio è muto:
             * o il computer non ascolta questa caratteristica, o non gradisce
             * la modalità di scrittura. Sulla seconda si può fare qualcosa —
             * chi ha costruito il flusso sa rimandare l'ultimo comando
             * nell'altra modalità — e se lo fa, si aspetta ancora una volta.
             * Una volta sola: se tace anche così, è un silenzio vero, e
             * ripeterlo all'infinito lo nasconderebbe.
             */
            if self.arrivate.is_empty() && !self.ricevuto_qualcosa {
                if let Some(mut ripiego) = self.su_silenzio.take() {
                    match ripiego() {
                        Ripiego::Rimandato => self.aspetta(attesa)?,
                        // Niente da rimandare ancora: il ripiego torna al
                        // suo posto, per la prima lettura DOPO una scrittura.
                        Ripiego::NienteDaFare => self.su_silenzio = Some(ripiego),
                        Ripiego::Esaurito => {}
                    }
                }
            }
            match self.arrivate.pop_front() {
                Some(notifica) => {
                    self.ricevuto_qualcosa = true;
                    let dimensione = notifica.len();
                    self.notifica_piena = self.notifica_piena.max(dimensione);
                    self.avanzo.extend(notifica);
                    /*
                     * ► IL MESSAGGIO SPEZZATO, RIMESSO INSIEME. ◄ Solo se la
                     * politica lo chiede: vedi `Riassemblaggio` per il perché
                     * non può valere per tutti.
                     *
                     * Si continua finché ogni notifica arriva PIENA, perché su
                     * BLE i frammenti di uno stesso messaggio sono tutti della
                     * dimensione massima tranne l'ultimo: una più corta è la
                     * fine, e fermarsi lì costa zero attese.
                     */
                    if self.riassemblaggio == Riassemblaggio::PacchettoIntero {
                        let mut ultima = dimensione;
                        while self.avanzo.len() < quanti && ultima == self.notifica_piena {
                            self.raccogli_subito();
                            if self.arrivate.is_empty() {
                                // Il collegamento caduto qui è un errore, e i
                                // byte a metà NON restano in cassa: consegnarli
                                // alla lettura dopo li farebbe passare per un
                                // pacchetto riuscito, e la prima diagnosi che
                                // libdivecomputer vedrebbe sarebbe quella
                                // sbagliata.
                                //
                                // ► E QUI SI CRONOMETRA. ◄ Il frammento non
                                // c'è ancora: quanto si aspetta prima che
                                // arrivi — o prima di arrendersi — è il numero
                                // che dice se il tetto di `ATTESA_FRAMMENTO` è
                                // stretto. Si misura solo in questo ramo
                                // apposta: se il frammento era già arrivato,
                                // la pausa è zero e contarla annacquerebbe il
                                // massimo, che è proprio la cosa da non
                                // annacquare.
                                //
                                // ► E SI CONTA SOLO SE IL FRAMMENTO POI ARRIVA.
                                // ◄ Dal 12 settembre, e il motivo è che il
                                // numero di prima **si saturava sul proprio
                                // tetto**: un'attesa scaduta dura per
                                // definizione quanto il tetto, quindi appena
                                // una scadeva il massimo diventava il tetto e
                                // non diceva più niente di tutte le altre. Il
                                // diario del Puck diceva «41 ms (si aspetta al
                                // massimo 40 ms)» e quel 41 non era una pausa
                                // colmata: era il tetto più il ritardo dello
                                // scheduler. *Un numero che si appoggia al
                                // proprio limite dice che il limite è stato
                                // toccato, e nient'altro — e a contare le volte
                                // in cui è stato toccato c'è già
                                // `frammenti_mancati`.*
                                //
                                // Adesso qui sta la pausa più lunga **colmata**,
                                // cioè quanto margine abbiamo davvero sotto il
                                // tetto: è l'unico dei due numeri che possa
                                // dire se il tetto nuovo è largo abbastanza.
                                let inizio_pausa = std::time::Instant::now();
                                let esito_attesa = self.aspetta(ATTESA_FRAMMENTO);
                                let quanto = inizio_pausa.elapsed();
                                if let Err(motivo) = esito_attesa {
                                    self.avanzo.clear();
                                    return Err(motivo);
                                }
                                if self.arrivate.is_empty() {
                                    // Il pacchetto resta a metà. Chi legge con
                                    // `actual` nullo — cioè quasi tutti i
                                    // backend — lo conterà come scaduto e
                                    // butterà quello che è arrivato.
                                    self.frammenti_mancati += 1;
                                    break;
                                }
                                self.pausa_colmata = self.pausa_colmata.max(quanto);
                            }
                            let Some(pezzo) = self.arrivate.pop_front() else { break };
                            ultima = pezzo.len();
                            self.notifica_piena = self.notifica_piena.max(ultima);
                            self.avanzo.extend(pezzo);
                        }
                    }
                    /*
                     * ► E QUI LA LUNGHEZZA NON SI INDOVINA: LA DICE IL PACCHETTO. ◄
                     *
                     * Stessa attesa del ramo di sopra — un frammento vale
                     * `ATTESA_FRAMMENTO`, e se non arriva si conta — ma la
                     * condizione d'uscita è un fatto invece di una regola
                     * empirica: si smette quando i byte dichiarati ci sono
                     * tutti. Vedi `Riassemblaggio::LunghezzaDichiarata` per la
                     * segnalazione che l'ha resa necessaria.
                     *
                     * Il caso che il ramo di sopra non sa distinguere e questo
                     * sì: un pacchetto **intero** che è anche il più grande mai
                     * visto. Là si aspetterebbe un seguito che non esiste, qui
                     * si esce subito perché il conto torna.
                     */
                    // La lunghezza dichiarata si completa più sotto, per le
                    // due strade insieme: vedi `completa_il_dichiarato`.
                }
                None => {
                    /*
                     * ► LA LETTURA A VUOTO SI SCRIVE NEL BANCO DI PROVA. ◄ Per
                     * chi legge il file fra mesi, il silenzio deve essere un
                     * fatto scritto e non un buco fra due scritture da
                     * interpretare. Vedi `registratore`.
                     */
                    if let Some(dove) = &self.registratore {
                        dove(format!(
                            "lettura a vuoto: chiesti {quanti} byte, aspettati {} ms",
                            attesa.as_millis()
                        ));
                    }
                    return Ok(Vec::new());
                }
            }
        }
        /*
         * ► E LA LUNGHEZZA DICHIARATA SI COMPLETA ANCHE QUANDO IL PACCHETTO
         *   COMINCIA IN CASSA. ◄ Fino al 23 settembre 2026 questo giro stava
         *   dentro il ramo della cassa vuota: un pacchetto cominciato in coda a
         *   un altro, nella stessa notifica, restava a metà e si consegnava
         *   così. Vedi `il_pacchetto_cominciato_in_coda_a_un_altro_si_aspetta_anche_dalla_cassa`.
         */
        if self.riassemblaggio == Riassemblaggio::LunghezzaDichiarata {
            self.completa_il_dichiarato()?;
            // Il filtro: un pacchetto intero che risponde a un altro comando
            // si butta, e si torna ad aspettare. Vedi `con_filtro_del_comando`.
            if let (true, Some(atteso), Some(quanto)) =
                (self.filtro_del_comando, self.ultimo_comando, confine_dichiarato(&self.avanzo))
            {
                if self.avanzo.len() >= quanto && self.avanzo[2] != atteso {
                    self.avanzo.drain(..quanto);
                    self.estranei.0 += 1;
                    self.estranei.1 += quanto;
                    return self.leggi(quanti, attesa);
                }
            }
        }
        /*
         * ► SI CONSEGNA UN PACCHETTO, NON TUTTO QUELLO CHE C'È. ◄
         *
         * `quanti` qui vale quasi sempre la dimensione del buffer di chi legge —
         * `pelagic_i330r.c` ne chiede 260 — quindi senza questo confine due
         * pacchetti arrivati attaccati verrebbero consegnati insieme. Chi li
         * riceve legge la lunghezza del PRIMO, prende quei byte e butta il
         * resto: il secondo pacchetto sparisce **senza un errore**, e il sintomo
         * arriva molto più tardi, sotto forma di dati che non si tengono
         * insieme.
         *
         * Per le altre due politiche non cambia niente: là il confine non c'è, e
         * `None` lascia il conto com'era.
         */
        let disponibile = match self.riassemblaggio {
            Riassemblaggio::LunghezzaDichiarata => {
                confine_dichiarato(&self.avanzo).unwrap_or(usize::MAX).min(self.avanzo.len())
            }
            _ => self.avanzo.len(),
        };
        let quanti = quanti.min(disponibile);
        Ok(self.avanzo.drain(..quanti).collect())
    }

    fn svuota(&mut self) {
        self.raccogli_subito();
        self.arrivate.clear();
        self.avanzo.clear();
    }

    /// I conti NON si azzerano qui: `svuota` butta via i byte, non la storia di
    /// come sono andate le letture. Azzerarli renderebbe il diario cieco
    /// proprio sul caso che interessa, che è quello in cui si svuota perché
    /// qualcosa era andato storto.
    fn misure_frammenti(&self) -> (usize, u64) {
        (self.frammenti_mancati, self.pausa_colmata.as_millis() as u64)
    }

    fn silenzio_massimo_ms(&self) -> u64 {
        self.silenzio_massimo.as_millis() as u64
    }

    fn proroghe(&self) -> (usize, usize, usize) {
        (self.proroghe, self.proroghe_utili, self.congelamenti)
    }

    fn scartate_prima_di_parlare(&self) -> (usize, usize) {
        self.scartate_prima
    }

    fn pacchetti_estranei(&self) -> (usize, usize) {
        self.estranei
    }

    fn nome(&mut self) -> Option<String> {
        self.accessori.as_mut().and_then(|a| a.nome())
    }

    fn leggi_caratteristica(&mut self, uuid: [u8; 16]) -> Result<Vec<u8>, String> {
        match self.accessori.as_mut() {
            Some(a) => a.leggi_caratteristica(uuid),
            None => Err("questo flusso non ha accesso alle caratteristiche".into()),
        }
    }

    fn codice_pin(&mut self) -> Option<String> {
        self.accessori.as_mut().and_then(|a| a.codice_pin())
    }

    fn codice_accesso(&mut self) -> Option<Vec<u8>> {
        self.accessori.as_mut().and_then(|a| a.codice_accesso())
    }

    fn salva_codice_accesso(&mut self, codice: &[u8]) {
        if let Some(a) = self.accessori.as_mut() {
            a.salva_codice_accesso(codice);
        }
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
const DC_STATUS_UNSUPPORTED: c_int = -1;
const DC_STATUS_INVALIDARGS: c_int = -2;
const DC_STATUS_IO: c_int = -6;
const DC_STATUS_TIMEOUT: c_int = -7;
const DC_STATUS_DATAFORMAT: c_int = -9;
const DC_TRANSPORT_BLE: c_uint = 1 << 5;

/// Il nome di uno stato, per i messaggi.
///
/// Un numero negativo in un messaggio d'errore è un indovinello: «stato -6»
/// ha mandato una segnalazione vera a cercare il guasto dalla parte sbagliata.
/// I nomi sono quelli di `dc_status_t` in `common.h`, tradotti.
pub fn nome_stato(stato: c_int) -> &'static str {
    match stato {
        0 => "riuscito",
        1 => "finito",
        -1 => "non supportato",
        -2 => "argomenti non validi",
        -3 => "memoria esaurita",
        -4 => "nessun dispositivo",
        -5 => "accesso negato",
        -6 => "errore di trasmissione",
        -7 => "tempo scaduto",
        -8 => "errore di protocollo",
        -9 => "dati in un formato inatteso",
        -10 => "annullato",
        _ => "stato sconosciuto",
    }
}

/*
 * Le richieste `ioctl` che libdivecomputer fa a un trasporto BLE.
 *
 * Sono i valori di `DC_IOCTL_BLE_*` in `ble.h`, calcolati con la macro
 * `DC_IOCTL_BASE(dir, type, nr, size)` di `ioctl.h`:
 * `(dir << 30) | (size << 16) | ('b' << 8) | nr`, con `size` = 0 (variabile).
 * Sono numeri e non `bindgen` per la stessa ragione di tutto il resto del
 * file: la tabella delle callback è già scritta a mano, e un generatore per
 * sei costanti sarebbe una dipendenza in più da spiegare.
 */
/// Il nome Bluetooth del dispositivo, come stringa terminata da zero.
const DC_IOCTL_BLE_GET_NAME: c_uint = 0x4000_6200;
/// Il codice PIN d'accoppiamento, come stringa terminata da zero. Il buffer
/// che `pelagic_i330r.c` passa è di sette byte: sei cifre più lo zero.
const DC_IOCTL_BLE_GET_PINCODE: c_uint = 0x4000_6201;
/// Il codice di accesso conservato, un array di byte di lunghezza variabile —
/// sedici, per il Pelagic. Direzione lettura: lo chiede a noi.
const DC_IOCTL_BLE_GET_ACCESSCODE: c_uint = 0x4000_6202;
/// Lo stesso codice, appena ottenuto dal computer: qui la direzione è
/// SCRITTURA, il bit più alto cambia, e il buffer va letto e non riempito.
const DC_IOCTL_BLE_SET_ACCESSCODE: c_uint = 0x8000_6202;
/// Leggere una caratteristica: nel buffer i primi 16 byte sono l'UUID, il
/// resto riceve il valore.
const DC_IOCTL_BLE_CHARACTERISTIC_READ: c_uint = 0x4000_6203;

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
/// `DC_EVENT_PROGRESS` di `dc_event_type_t`, in `device.h`.
///
/// I valori sono una maschera di bit — `WAITING`, `PROGRESS`, `DEVINFO`,
/// `CLOCK`, `VENDOR` — e `dc_device_set_events` vuole l'OR di quelli che
/// interessano. Qui ne interessano due: questo, e `DC_EVENT_DEVINFO` qui
/// sotto. `CLOCK` e `VENDOR` non hanno niente da mostrare a chi guarda, e
/// `WAITING` nessun backend BLE lo manda.
///
/// Come tutte le costanti copiate da un'intestazione C, è confrontata con
/// l'intestazione vera da una prova: una trascrizione sbagliata di un enum non
/// dà errore, dà un numero plausibile — qui iscriverebbe a un evento diverso e
/// la barra resterebbe ferma senza che niente fallisca.
const DC_EVENT_PROGRESS: c_uint = 1 << 1;

/// `DC_EVENT_DEVINFO` di `dc_event_type_t`: il computer dice chi è.
///
/// ► NON SERVIVA, FINCHÉ NON SI È VISTO A COSA SERVE. ◄ Il commento sopra
/// diceva, fino al 22 settembre 2026, che modello e seriale «li sappiamo già
/// dal nostro lato dello scambio». Per i driver scritti in casa è vero; per
/// libdivecomputer no: il
/// modello che conoscevamo era quello SCELTO — da un elenco, o proposto dal
/// nome Bluetooth — e il lettore delle immersioni veniva costruito su quello.
/// Il 22 settembre 2026 si è visto che Subsurface fa il contrario: costruisce
/// il lettore sul dispositivo aperto (`dc_parser_new`), cioè sul modello che il
/// computer ha DICHIARATO con questo evento. Vedi `leggi_dal_dispositivo`.
///
/// Confrontata con `device.h` da `tests/costantiLibdivecomputer.test.ts`, come
/// la sorella qui sopra.
const DC_EVENT_DEVINFO: c_uint = 1 << 2;

/// `dc_event_devinfo_t`: modello, firmware e numero di serie, come li dichiara
/// il computer. Tre `unsigned int`, in quest'ordine — confrontato con
/// l'intestazione dalla stessa prova delle costanti.
#[repr(C)]
struct DcEventDevinfo {
    model: c_uint,
    firmware: c_uint,
    serial: c_uint,
}

/// Quello che il computer ha detto di sé all'inizio dello scarico.
///
/// Il **numero di serie non c'è di proposito**: questo valore finisce nel
/// diario, e il diario si allega alle segnalazioni. Modello e firmware bastano
/// a capire con che cosa si stava parlando; il seriale identifica la persona.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Dichiarazione {
    pub modello: u32,
    pub firmware: u32,
}

/// `dc_event_progress_t`: quanto della memoria del computer è stato letto.
///
/// **`maximum` non è il numero di immersioni**, ed è la ragione per cui a
/// schermo le due cose restano separate: è la dimensione della zona di memoria
/// che il backend ha deciso di attraversare. Quante immersioni ci siano dentro
/// si scopre leggendole, una alla volta — sui Mares del 12 settembre 2026 sono
/// uscite ottantuno da 1,73 MB, e nessuno lo sapeva prima di arrivare in fondo.
#[repr(C)]
struct DcEventProgress {
    current: c_uint,
    maximum: c_uint,
}

/// `dc_event_callback_t` di `device.h`.
type DcEventCallback = extern "C" fn(*mut DcDevice, c_uint, *const c_void, *mut c_void);

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
    fn dc_context_set_loglevel(context: *mut DcContext, loglevel: c_int) -> c_int;
    fn dc_context_set_logfunc(
        context: *mut DcContext,
        logfunc: Option<
            extern "C" fn(
                *mut DcContext,
                c_int,
                *const std::ffi::c_char,
                c_uint,
                *const std::ffi::c_char,
                *const std::ffi::c_char,
                *mut c_void,
            ),
        >,
        userdata: *mut c_void,
    ) -> c_int;
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
    fn dc_iostream_purge(iostream: *mut DcIostream, direction: c_int) -> c_int;
    fn dc_iostream_ioctl(
        iostream: *mut DcIostream,
        request: c_uint,
        data: *mut c_void,
        size: usize,
    ) -> c_int;
    fn dc_iostream_close(iostream: *mut DcIostream) -> c_int;

    fn dc_descriptor_iterator_new(iterator: *mut *mut DcIterator, context: *mut DcContext) -> c_int;
    fn dc_iterator_next(iterator: *mut DcIterator, item: *mut *mut DcDescriptor) -> c_int;
    fn dc_iterator_free(iterator: *mut DcIterator) -> c_int;
    fn dc_descriptor_get_vendor(descriptor: *mut DcDescriptor) -> *const std::ffi::c_char;
    fn dc_descriptor_get_product(descriptor: *mut DcDescriptor) -> *const std::ffi::c_char;
    fn dc_descriptor_get_type(descriptor: *mut DcDescriptor) -> c_uint;
    fn dc_descriptor_get_model(descriptor: *mut DcDescriptor) -> c_uint;
    fn dc_descriptor_free(descriptor: *mut DcDescriptor) -> c_int;

    fn dc_device_open(
        out: *mut *mut DcDevice,
        context: *mut DcContext,
        descriptor: *mut DcDescriptor,
        iostream: *mut DcIostream,
    ) -> c_int;
    fn dc_device_set_fingerprint(
        device: *mut DcDevice,
        data: *const u8,
        size: c_uint,
    ) -> c_int;
    fn dc_device_foreach(
        device: *mut DcDevice,
        callback: DcDiveCallback,
        userdata: *mut c_void,
    ) -> c_int;
    fn dc_device_set_events(
        device: *mut DcDevice,
        events: c_uint,
        callback: DcEventCallback,
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
    /// L'ultima cosa andata male nel trasporto, con parole nostre.
    ///
    /// libdivecomputer riduce ogni guasto a un numero (`DC_STATUS_IO`) e lo
    /// fa risalire fino a `dc_device_foreach`; il messaggio della chiusura —
    /// «il collegamento si è chiuso», «scrittura non riuscita: …» — resterebbe
    /// nel `Result` che la callback ha buttato via. Si tiene qui, condiviso
    /// con `CollegamentoLdc`, e finisce nel messaggio finale accanto al
    /// numero. È la differenza fra «stato -6» e «il collegamento Bluetooth si
    /// è chiuso durante la scrittura n. 1».
    guasto: Guasto,
    /// Il conto delle letture, condiviso col collegamento. Vedi `MisureLettura`.
    conteggi: Conteggi,
}

/// Il posto dove il trasporto lascia scritto perché ha fallito.
type Guasto = std::sync::Arc<std::sync::Mutex<Option<String>>>;

/// Quello che il trasporto ha visto passare, e che serve a capire DOPO perché
/// una lettura è scaduta.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► PERCHÉ QUESTI QUATTRO NUMERI, E NON ALTRI. ◄
///
/// Il diario del Puck 4 del 10 settembre 2026 racconta una catena precisa: una
/// lettura scaduta (`mares_iconhd.c:329`), il ritentativo interno del backend —
/// due scritture identiche di fila nella coda, `ac 09` e `ac 09` — e poi una
/// risposta disallineata (`mares_iconhd.c:521`) che nessuno ritenta e che
/// chiude lo scarico. **Il primo anello è la lettura scaduta**: senza quella,
/// niente ritentativo e niente disallineamento.
///
/// E su quel primo anello c'è un'ipotesi che si può provare con un numero solo.
/// Un pacchetto Mares a lunghezza variabile arriva spezzato in una dozzina di
/// notifiche, e questo trasporto le rimette insieme aspettando al massimo
/// `ATTESA_FRAMMENTO` — **quaranta millisecondi** — fra l'una e l'altra. Su un
/// telefono occupato, con un intervallo di connessione BLE negoziato largo,
/// quaranta millisecondi possono non bastare: il pacchetto torna a metà,
/// `dc_iostream_read` lo conta come scaduto perché ne aveva chiesti di più, e
/// la catena comincia.
///
/// *Alzare quel tetto sarebbe una deduzione, e le deduzioni in questa storia
/// hanno già perso una volta.* Quindi non si alza: si misura. Se la pausa più
/// lunga davvero osservata sta incollata al tetto, il tetto è il problema e si
/// alza sapendo perché; se le pause sono di cinque millisecondi e le letture
/// scadono lo stesso, l'ipotesi è morta e si guarda altrove. **In tutti e due i
/// casi il prossimo diario risponde a una domanda posta prima**, che è la cosa
/// che in questa faccenda è mancata più spesso.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct MisureLettura {
    /// Quante letture ha chiesto libdivecomputer.
    pub letture: usize,
    /// Quante ne sono tornate con MENO byte di quanti ne erano stati chiesti.
    ///
    /// Non è un guasto di per sé — il contratto lo permette — ma per chi legge
    /// con `actual` nullo, cioè quasi tutti i backend, una lettura corta **è**
    /// una lettura scaduta, e i byte tornati vengono buttati.
    pub letture_corte: usize,
    /// Quante sono tornate completamente vuote dopo aver aspettato tutto.
    pub letture_vuote: usize,
    /// Quante volte l'attesa fra due frammenti è scaduta lasciando il pacchetto a metà.
    pub frammenti_mancati: usize,
    /// La pausa più lunga fra due frammenti dello stesso pacchetto che è stata
    /// **colmata** — cioè dopo la quale il frammento è davvero arrivato — in
    /// millisecondi.
    ///
    /// ► NON È LA PAUSA PIÙ LUNGA VISTA, ED È UNA CORREZIONE DEL 12 SETTEMBRE. ◄
    /// Quella si saturava sul tetto e smetteva di dire qualcosa: un'attesa
    /// scaduta dura quanto il tetto, quindi bastava una scadenza perché il
    /// massimo diventasse il tetto per sempre. Le scadenze le conta
    /// `frammenti_mancati`; qui sta il **margine**, ed è il numero che dice se
    /// `ATTESA_FRAMMENTO` è largo abbastanza. Vicino al tetto: stretto ancora.
    /// Lontano: largo, e la causa del prossimo guasto è un'altra.
    pub pausa_massima_ms: u64,
    /// Il silenzio più lungo fra un comando e la sua risposta, in millisecondi.
    ///
    /// ► È IL NUMERO CHE DISTINGUE DUE CAUSE CHE SI SOMIGLIANO. ◄ Una lettura
    /// che scade può voler dire due cose molto diverse: il computer ha smesso
    /// di parlare (batteria, distanza, un pacchetto perso sul filo), **oppure
    /// siamo stati noi a smettere di ascoltare** — su iOS un'applicazione
    /// sospesa perché lo schermo si è spento non riceve più le notifiche, e il
    /// tempo passa lo stesso.
    ///
    /// Da solo non basta a separarle, e apposta non ci prova: il pezzo che
    /// manca lo mette l'interfaccia, che conta quante volte la pagina è sparita
    /// (vedi `schermoSveglio.ts`). Silenzio lungo **e** pagina sparita: era lo
    /// schermo. Silenzio lungo e pagina sempre presente: era il computer. *Due
    /// misure indipendenti che insieme rispondono, e nessuna delle due che
    /// risponde da sola.*
    pub silenzio_massimo_ms: u64,
    /// Quante volte si è concessa una seconda finestra invece di dire «scaduta».
    pub proroghe: usize,
    /// Quante di quelle hanno portato davvero una risposta.
    ///
    /// ► È IL NUMERO CHE GIUDICA LA CORREZIONE PIÙ IMPORTANTE DI QUESTA
    /// VERSIONE. ◄ Se le proroghe utili sono tante, il tempo concesso era il
    /// problema e la riga si è guadagnata il posto. Se sono sempre zero, quella
    /// riga non fa che raddoppiare l'attesa di ogni guasto, e va tolta. *Una
    /// correzione che porta con sé il numero che la può condannare è l'unico
    /// tipo di correzione che non diventa superstizione.*
    pub proroghe_utili: usize,
    /// Quante volte l'attesa ha sforato la scadenza tanto da rivelare che il
    /// processo era fermo — cioè sospeso dal sistema operativo.
    pub congelamenti: usize,
    /// Le notifiche arrivate PRIMA del primo comando e buttate, e i loro byte.
    ///
    /// ► È IL NUMERO CHE DICE SE L'ASCOLTO INIZIALE SERVE. ◄ Se su un i330R
    /// resta sempre zero, la coda lasciata a metà del 22 settembre 2026 è stata
    /// un caso, e trecento millisecondi in più a ogni scarico sono un costo
    /// senza ritorno. Se sale, ogni volta che sale è uno scarico che prima si
    /// sarebbe fermato alla richiesta d'accesso. Vedi
    /// `FlussoBle::ascolta_prima_di_parlare`.
    pub scartate_prima: usize,
    pub byte_scartati_prima: usize,
    /// I pacchetti buttati perché rispondevano a un altro comando, e i loro
    /// byte. Come il numero sopra, dice se il filtro serve: zero per sempre
    /// vuol dire che non è mai scattato. Vedi `FlussoBle::con_filtro_del_comando`.
    pub estranei: usize,
    pub byte_estranei: usize,
}

/// Il posto condiviso dove il trasporto tiene il conto. Come `Guasto`: una
/// copia sta nello `Stato` che vive dietro il puntatore di C, l'altra nel
/// collegamento, che è quello che poi le racconta.
type Conteggi = std::sync::Arc<std::sync::Mutex<MisureLettura>>;

fn annota(guasto: &Guasto, cosa: String) {
    if let Ok(mut posto) = guasto.lock() {
        *posto = Some(cosa);
    }
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
    // Zero byte chiesti: niente da fare, e niente da toccare — `data` può
    // essere nullo, e anche una copia di lunghezza zero da un puntatore nullo
    // è fuori dal contratto di Rust.
    if size == 0 {
        unsafe { *actual = 0 };
        return DC_STATUS_SUCCESS;
    }
    let esito = s.flusso.leggi(size, s.attesa);
    /*
     * ► IL CONTO SI TIENE QUI, E COMUNQUE SIA ANDATA. ◄ Questo è l'unico punto
     * in cui si sa tutto e insieme: quanti byte erano stati chiesti, quanti ne
     * sono tornati, e — chiedendolo al trasporto — quante pause fra frammenti
     * ci sono volute. Una riga sola nel diario, e la prossima segnalazione
     * risponde alla domanda invece di aprirne un'altra. Vedi `MisureLettura`.
     */
    if let Ok(mut conti) = s.conteggi.lock() {
        conti.letture += 1;
        match &esito {
            Ok(letti) if letti.is_empty() => conti.letture_vuote += 1,
            Ok(letti) if letti.len() < size => conti.letture_corte += 1,
            _ => {}
        }
        let (mancati, pausa) = s.flusso.misure_frammenti();
        conti.frammenti_mancati = mancati;
        conti.pausa_massima_ms = conti.pausa_massima_ms.max(pausa);
        conti.silenzio_massimo_ms = conti.silenzio_massimo_ms.max(s.flusso.silenzio_massimo_ms());
        let (proroghe, utili, congelamenti) = s.flusso.proroghe();
        conti.proroghe = proroghe;
        conti.proroghe_utili = utili;
        conti.congelamenti = congelamenti;
        let (scartate, byte) = s.flusso.scartate_prima_di_parlare();
        conti.scartate_prima = scartate;
        conti.byte_scartati_prima = byte;
        let (estranei, byte_estranei) = s.flusso.pacchetti_estranei();
        conti.estranei = estranei;
        conti.byte_estranei = byte_estranei;
    }
    match esito {
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
        Err(motivo) => {
            unsafe { *actual = 0 };
            annota(&s.guasto, format!("lettura di {size} byte: {motivo}"));
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
    if size == 0 {
        unsafe { *actual = 0 };
        return DC_STATUS_SUCCESS;
    }
    // SICUREZZA: `data` punta a `size` byte validi per la durata della chiamata.
    let dati = unsafe { std::slice::from_raw_parts(data as *const u8, size) };
    match s.flusso.scrivi(dati) {
        Ok(()) => {
            unsafe { *actual = size };
            DC_STATUS_SUCCESS
        }
        Err(guasto) => {
            unsafe { *actual = 0 };
            annota(&s.guasto, format!("scrittura di {size} byte: {}", guasto.motivo()));
            /*
             * ► LA RIGA CHE DECIDE SE LO SCARICO MUORE O RIPARTE. ◄ Vedi
             * `GuastoScrittura`: «tempo scaduto» è l'unica risposta che dà al
             * backend il permesso di riprovare, e su una conferma che non
             * arriva è anche l'unica vera.
             */
            match guasto {
                GuastoScrittura::Scaduta(_) => DC_STATUS_TIMEOUT,
                GuastoScrittura::Rifiutata(_) => DC_STATUS_IO,
            }
        }
    }
}

/// Le domande che libdivecomputer fa al trasporto oltre ai byte.
///
/// ► PERCHÉ NON PUÒ RESTARE `None`, che è come era. ◄ In `custom.c`, una
/// `ioctl` nulla NON restituisce «non supportato»: restituisce **successo
/// senza toccare il buffer**. Per `oceanic_atom2.c` questo vuol dire un nome
/// vuoto → «Bluetooth device name too short» → stato -6, cioè tutta la
/// famiglia Oceanic/Aqualung/Pelagic su BLE moriva con lo stesso numero di un
/// collegamento caduto. Per `cressi_goa.c` vuol dire tre caratteristiche
/// «lette» piene di zeri. Rispondere davvero, e dire «non supportato» a
/// quello che non sappiamo fare, è ciò che libdivecomputer si aspetta: chi
/// chiede il nome tollera l'assenza (lo dichiara), chi chiede il codice PIN
/// del Pelagic i330R si ferma con il SUO errore («Failed to get the PIN
/// code»), che arriva come stato e non come annotazione nostra.
///
/// ► DAL 8 SETTEMBRE 2026 IL PIN SI SA CHIEDERE. ◄ Quel «Failed to get the
/// PIN code» è arrivato per davvero, dal log di un Aqualung i330R provato al
/// centro sub, ed era l'unico punto in cui `pelagic_i330r_init` non tollera
/// un «non supportato». Adesso questa funzione risponde a **cinque** delle
/// sei richieste di `ble.h`: il nome, il PIN, il codice di accesso in
/// lettura e in scrittura, e la lettura di una caratteristica. Resta fuori
/// la scrittura di una caratteristica, che nessun backend che ci interessa
/// usa — e resta fuori dichiarandolo, non tacendo.
extern "C" fn cb_ioctl(
    userdata: *mut c_void,
    request: c_uint,
    data: *mut c_void,
    size: usize,
) -> c_int {
    let s = unsafe { stato(userdata) };
    match request {
        DC_IOCTL_BLE_GET_NAME => {
            // Senza nome NON si annota un guasto: i backend che lo chiedono
            // tollerano l'assenza (Oceanic prosegue con un avviso), e
            // un'annotazione qui finirebbe accodata a un errore successivo
            // che non c'entra niente.
            let Some(nome) = s.flusso.nome() else {
                return DC_STATUS_UNSUPPORTED;
            };
            if size == 0 {
                return DC_STATUS_UNSUPPORTED;
            }
            // Una stringa C: al più `size - 1` byte più lo zero finale. Il
            // troncamento è quello che farebbe `strncpy`, e il chiamante
            // forza comunque lo zero all'ultimo posto.
            let byte = nome.as_bytes();
            let quanti = byte.len().min(size - 1);
            // SICUREZZA: `data` punta a `size` byte scrivibili per la durata
            // della chiamata, e non se ne scrivono più di `quanti + 1 <= size`.
            unsafe {
                std::ptr::copy_nonoverlapping(byte.as_ptr(), data as *mut u8, quanti);
                *(data as *mut u8).add(quanti) = 0;
            }
            DC_STATUS_SUCCESS
        }
        /*
         * ► IL PIN DELL'AQUALUNG i330R, E IL MOTIVO PER CUI SI TRONCA MAI. ◄
         *
         * `pelagic_i330r.c` passa `char pincode[6 + 1]` e poi forza lo zero
         * all'ultimo posto. Se il codice fosse più lungo del buffer e lo
         * troncassimo, il backend manderebbe al computer un PIN sbagliato
         * *senza che nessuno se ne accorga*: il computer rifiuterebbe, e il
         * sintomo sarebbe «codice errato» con l'utente che ha digitato quello
         * giusto. Un numero troncato è peggio di un errore, e qui si sceglie
         * l'errore.
         *
         * `None` NON si annota: chi ha rinunciato lo sa già — è
         * l'interfaccia che ha chiesto le cifre e non le ha avute — e sa
         * dirlo meglio di quanto sappia farlo un trasporto.
         */
        DC_IOCTL_BLE_GET_PINCODE => {
            // Il posto si guarda PRIMA di chiedere: tenere ferma una persona
            // fino a tre minuti per poi buttare via la risposta sarebbe il
            // modo peggiore di scoprire che il buffer era di zero byte.
            if size == 0 {
                return DC_STATUS_UNSUPPORTED;
            }
            let Some(pin) = s.flusso.codice_pin() else {
                return DC_STATUS_UNSUPPORTED;
            };
            let byte = pin.as_bytes();
            /*
             * ► IL VUOTO PASSEREBBE DA SOLO, ED È IL CASO PIÙ INSIDIOSO. ◄
             * Zero cifre non è «più lungo del posto», e `all(is_ascii_digit)`
             * su un elenco vuoto è VERO per definizione: senza questa riga si
             * scriverebbe una stringa C vuota e si risponderebbe «riuscito».
             * `pelagic_i330r_init_passcode` allinea a destra e ne farebbe un
             * codice di sei zeri — che il computer rifiuta senza spiegare.
             */
            if byte.is_empty() {
                annota(&s.guasto, "il codice PIN è arrivato vuoto".into());
                return DC_STATUS_INVALIDARGS;
            }
            if byte.len() > size - 1 {
                annota(
                    &s.guasto,
                    format!(
                        "il codice PIN è di {} cifre e ce ne stanno {}",
                        byte.len(),
                        size - 1
                    ),
                );
                return DC_STATUS_INVALIDARGS;
            }
            if !byte.iter().all(|c| c.is_ascii_digit()) {
                // Lo controlla anche `pelagic_i330r_init_passcode`, e lì
                // diventa «Invalid pincode character». Dirlo qui costa una
                // riga e fa arrivare la causa nel diario nostro, dove chi
                // legge la segnalazione la trova.
                annota(&s.guasto, "il codice PIN contiene qualcosa che non è una cifra".into());
                return DC_STATUS_INVALIDARGS;
            }
            // SICUREZZA: `data` copre `size` byte scrivibili, e se ne
            // scrivono `byte.len() + 1 <= size`.
            unsafe {
                std::ptr::copy_nonoverlapping(byte.as_ptr(), data as *mut u8, byte.len());
                *(data as *mut u8).add(byte.len()) = 0;
            }
            DC_STATUS_SUCCESS
        }
        /*
         * Il codice di accesso conservato da uno scarico precedente.
         *
         * ► «NON SUPPORTATO» QUI NON È UN GUASTO, È LA PRIMA VOLTA. ◄
         * `pelagic_i330r_init` tollera questa risposta apposta: se non c'è un
         * codice, il buffer resta a zeri e il backend prende il ramo del PIN.
         * Per questo, quando qualcosa non torna, si risponde «non supportato»
         * **senza toccare il buffer**: si ricomincia dal PIN, che funziona
         * sempre. Riempire il buffer a metà darebbe un codice inventato, e il
         * computer chiuderebbe il collegamento senza dire perché.
         */
        DC_IOCTL_BLE_GET_ACCESSCODE => {
            let Some(codice) = s.flusso.codice_accesso() else {
                return DC_STATUS_UNSUPPORTED;
            };
            if codice.len() != size {
                annota(
                    &s.guasto,
                    format!(
                        "il codice di accesso conservato è di {} byte, ne servono {}: si riparte dal PIN",
                        codice.len(),
                        size
                    ),
                );
                return DC_STATUS_UNSUPPORTED;
            }
            if codice.iter().all(|b| *b == 0) {
                // Tutti zeri è esattamente ciò che il backend interpreta come
                // «non c'è»: restituirlo come se fosse un codice vero non
                // cambierebbe niente, e nasconderebbe una conservazione
                // andata storta dietro un comportamento normale.
                annota(&s.guasto, "il codice di accesso conservato è tutto zeri: si riparte dal PIN".into());
                return DC_STATUS_UNSUPPORTED;
            }
            // SICUREZZA: `data` copre `size` byte scrivibili, e `codice` ne ha
            // esattamente `size`.
            unsafe {
                std::ptr::copy_nonoverlapping(codice.as_ptr(), data as *mut u8, size);
            }
            DC_STATUS_SUCCESS
        }
        /*
         * Il codice appena emesso dal computer, in risposta al PIN.
         *
         * Qui la direzione è SCRITTURA — il bit più alto della richiesta
         * cambia — e il buffer va LETTO, non riempito. È l'unica `ioctl` di
         * questo trasporto in cui i byte vanno nel verso opposto, ed è anche
         * l'unica il cui esito il backend non guarda davvero:
         * `pelagic_i330r_init` tollera «non supportato» anche qui. Rispondere
         * «riuscito» senza conservare niente sarebbe però una bugia che si
         * paga allo scarico dopo, quando il PIN verrebbe richiesto di nuovo
         * senza che nessuno sappia perché.
         */
        DC_IOCTL_BLE_SET_ACCESSCODE => {
            if size == 0 {
                return DC_STATUS_UNSUPPORTED;
            }
            // SICUREZZA: `data` punta a `size` byte leggibili per la durata
            // della chiamata.
            let codice = unsafe { std::slice::from_raw_parts(data as *const u8, size) };
            s.flusso.salva_codice_accesso(codice);
            DC_STATUS_SUCCESS
        }
        DC_IOCTL_BLE_CHARACTERISTIC_READ => {
            if size < 16 {
                return DC_STATUS_UNSUPPORTED;
            }
            // SICUREZZA: come sopra, `data` copre `size >= 16` byte.
            let buffer = unsafe { std::slice::from_raw_parts_mut(data as *mut u8, size) };
            let mut uuid = [0u8; 16];
            uuid.copy_from_slice(&buffer[..16]);
            match s.flusso.leggi_caratteristica(uuid) {
                Ok(valore) => {
                    // Più lungo del posto: si tronca, chi chiede N byte vuole
                    // i primi N e un riempimento fino a venti non deve far
                    // fallire niente. Più CORTO: no — gli zeri lasciati nel
                    // buffer diventerebbero una versione o un numero di serie
                    // inventati, e Subsurface lì risponde «formato dati».
                    let posto = &mut buffer[16..];
                    if valore.len() < posto.len() {
                        annota(
                            &s.guasto,
                            format!(
                                "la caratteristica ha risposto {} byte, ne servivano {}",
                                valore.len(),
                                posto.len()
                            ),
                        );
                        return DC_STATUS_DATAFORMAT;
                    }
                    posto.copy_from_slice(&valore[..posto.len()]);
                    DC_STATUS_SUCCESS
                }
                Err(motivo) => {
                    annota(&s.guasto, format!("lettura di una caratteristica: {motivo}"));
                    DC_STATUS_IO
                }
            }
        }
        _ => DC_STATUS_UNSUPPORTED,
    }
}

/// `purge`: svuotare l'ingresso. `direction` è una maschera: bit 1 ingresso,
/// bit 2 uscita. L'uscita non ha una coda da svuotare — le scritture partono
/// subito — quindi conta solo il primo bit. Nulla non andava bene: `custom.c`
/// risponde «successo» senza svuotare, e i ritentativi di Mares e Oceanic
/// rileggerebbero la stessa spazzatura.
extern "C" fn cb_purge(userdata: *mut c_void, direction: c_int) -> c_int {
    let s = unsafe { stato(userdata) };
    if direction & 1 != 0 {
        s.flusso.svuota();
    }
    DC_STATUS_SUCCESS
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
    /// La copia nostra del posto in cui il trasporto annota il guasto.
    guasto: Guasto,
    /// E quella del conto delle letture. Vedi `MisureLettura`.
    conteggi: Conteggi,
}

/// Il contesto di libdivecomputer, che si libera da solo.
///
/// Sta a parte dal collegamento perché serve anche a chi NON sta parlando con
/// un computer: tradurre i byte di un'immersione già scaricata vuole un
/// contesto e nient'altro, e pretendere un Bluetooth aperto per farlo sarebbe
/// una dipendenza inventata.
/// Livelli di `dc_loglevel_t`. Ci fermiamo a WARNING di proposito: vedi
/// `Contesto::nuovo_con_diario`.
const DC_LOGLEVEL_WARNING: c_int = 2;

/// Quante righe di libdivecomputer finiscono nel diario, al massimo.
///
/// Il diario lo copia e lo incolla una persona: mille righe non le incolla
/// nessuno, e quelle che contano sono **le ultime** — l'errore che ha chiuso lo
/// scarico è l'ultimo che la libreria stampa prima di arrendersi.
const RIGHE_DI_LIBDIVECOMPUTER: usize = 14;

/// Il posto dove la voce di libdivecomputer viene raccolta mentre parla.
///
/// È un `Mutex` e non un canale perché la libreria chiama la callback dal
/// thread dello scarico, dentro la nostra stessa pila: non c'è niente da
/// sincronizzare fra thread, serve solo un posto dove mettere le righe finché
/// qualcuno non le chiede.
struct DiarioDellaLibreria {
    righe: std::sync::Mutex<(VecDeque<String>, usize)>,
}

/// ════════════════════════════════════════════════════════════════════════════
/// ► LA LIBRERIA DICEVA PERCHÉ, E NOI LO BUTTAVAMO VIA. ◄
///
/// Ogni `return DC_STATUS_PROTOCOL` di libdivecomputer è preceduto da una
/// `ERROR(...)` che dice **quale** controllo è fallito, con file e riga:
///
/// ```text
/// ERROR: Unexpected packet header (00). [in mares_iconhd.c:1030 (mares_iconhd_read_object)]
/// ```
///
/// Senza `dc_context_set_logfunc` quella riga va su `stderr`, e su un telefono
/// `stderr` non esiste. Quindi al diario arrivava soltanto il numero: `-8`.
///
/// **E `-8` non è una diagnosi, è una famiglia.** Nel solo ramo VARIABILE dei
/// Mares, `DC_STATUS_PROTOCOL` esce da sei posti diversi, e due di essi
/// chiedono rimedi opposti:
///
/// - da `mares_iconhd_packet_variable` (intestazione, coda, lunghezza) — e lì
///   `mares_iconhd_transfer` **ritenta quattro volte**, quindi è un guasto del
///   nostro riassemblaggio che il backend sa perdonare;
/// - da `mares_iconhd_read_object`, sul controllo del *toggle*
///   (`(rsp[0] & 0xF0) >> 4 != toggle`) — e lì **non si ritenta affatto**: la
///   funzione torna subito e lo scarico muore.
///
/// Distinguere i due casi guardando i byte scritti è quello che ho dovuto fare
/// due volte di fila su due diari veri, e la seconda volta non ci sono
/// arrivato. *Una libreria che spiega il guasto e un'applicazione che stampa
/// solo il codice numerico sono, insieme, peggio della libreria da sola.*
pub struct Contesto(*mut DcContext, Option<Box<DiarioDellaLibreria>>);

impl Contesto {
    /// Un contesto muto, per chi traduce byte già arrivati con un descrittore
    /// (`traduci`). Dal 22 settembre 2026 lo scarico legge col dispositivo
    /// aperto, sul contesto del collegamento, e questo resta alle prove.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn nuovo() -> Result<Self, String> {
        let mut contesto: *mut DcContext = std::ptr::null_mut();
        if unsafe { dc_context_new(&mut contesto) } != DC_STATUS_SUCCESS {
            return Err("libdivecomputer non ha creato il contesto".into());
        }
        Ok(Self(contesto, None))
    }

    /// Come `nuovo`, ma la libreria parla e noi la ascoltiamo.
    ///
    /// **Ci si ferma a WARNING**, e non è pigrizia: da `INFO` in giù
    /// libdivecomputer stampa *ogni pacchetto* in esadecimale — su uno scarico
    /// da millecinquecento scambi sono decine di migliaia di righe, che
    /// seppellirebbero le tre che contano. È la stessa lezione dei quattordici
    /// avvisi di lint e delle novecento righe di HTML: **un'uscita che non si
    /// può leggere è spenta**, e l'unico modo di tenerla accesa è non
    /// riversarci dentro tutto quello che si potrebbe.
    pub fn nuovo_con_diario() -> Result<Self, String> {
        let mut contesto: *mut DcContext = std::ptr::null_mut();
        if unsafe { dc_context_new(&mut contesto) } != DC_STATUS_SUCCESS {
            return Err("libdivecomputer non ha creato il contesto".into());
        }
        let diario = Box::new(DiarioDellaLibreria {
            righe: std::sync::Mutex::new((VecDeque::new(), 0)),
        });
        // Il puntatore resta valido finché resta vivo il `Box`, e il `Box` vive
        // dentro questo `Contesto`: la callback non può sopravvivere al posto
        // in cui scrive, perché `dc_context_free` avviene in `drop` prima che
        // il `Box` venga liberato (l'ordine dei campi lo garantisce).
        let userdata = &*diario as *const DiarioDellaLibreria as *mut c_void;
        unsafe {
            dc_context_set_loglevel(contesto, DC_LOGLEVEL_WARNING);
            dc_context_set_logfunc(contesto, Some(cb_log), userdata);
        }
        Ok(Self(contesto, Some(diario)))
    }

    /// Le righe raccolte, dalla più vecchia alla più recente, con davanti la
    /// conta di quelle che non ci stavano.
    pub fn righe_della_libreria(&self) -> Vec<String> {
        let Some(diario) = self.1.as_ref() else {
            return Vec::new();
        };
        let Ok(dentro) = diario.righe.lock() else {
            return Vec::new();
        };
        let (righe, scartate) = &*dentro;
        let mut fuori = Vec::with_capacity(righe.len() + 1);
        if *scartate > 0 {
            fuori.push(format!("(altre {scartate} righe prima di queste)"));
        }
        fuori.extend(righe.iter().cloned());
        fuori
    }
}

/// Quel che libdivecomputer ha da dire, ridotto a una riga leggibile.
///
/// Si tiene **il file e la riga** perché sono l'unica cosa che distingue due
/// messaggi identici che escono da posti diversi — ed è esattamente il caso
/// che ci serve: «Unexpected packet header» compare sia nel controllo del
/// pacchetto sia in quello del toggle, e i due chiedono rimedi opposti.
extern "C" fn cb_log(
    _contesto: *mut DcContext,
    livello: c_int,
    file: *const std::ffi::c_char,
    riga: c_uint,
    _funzione: *const std::ffi::c_char,
    messaggio: *const std::ffi::c_char,
    userdata: *mut c_void,
) {
    if userdata.is_null() {
        return;
    }
    let diario = unsafe { &*(userdata as *const DiarioDellaLibreria) };
    let testo = |p: *const std::ffi::c_char| -> String {
        if p.is_null() {
            return String::new();
        }
        unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned()
    };
    let etichetta = if livello <= 1 { "errore" } else { "avviso" };
    let dove = {
        let f = testo(file);
        // Solo il nome del file: il percorso di compilazione è quello della
        // macchina che ha costruito il pacchetto e non dice niente a nessuno.
        let corto = f.rsplit('/').next().unwrap_or(&f).to_string();
        if corto.is_empty() { String::new() } else { format!(" [{corto}:{riga}]") }
    };
    let riga = format!("libdivecomputer, {etichetta}: {}{dove}", testo(messaggio));
    if let Ok(mut dentro) = diario.righe.lock() {
        let (righe, scartate) = &mut *dentro;
        righe.push_back(riga);
        while righe.len() > RIGHE_DI_LIBDIVECOMPUTER {
            righe.pop_front();
            *scartate += 1;
        }
    }
}

impl Drop for Contesto {
    fn drop(&mut self) {
        // PRIMA si stacca la callback, POI si libera il contesto: se libera
        // il contesto scatenasse un'ultima riga di log, quella riga cercherebbe
        // un `Box` che sta per sparire.
        if self.1.is_some() {
            unsafe { dc_context_set_logfunc(self.0, None, std::ptr::null_mut()) };
        }
        unsafe { dc_context_free(self.0) };
    }
}

/// Quello che uno scarico ha portato a casa, e come è finito.
///
/// Le due cose non sono in alternativa: uno scarico può finire male **e** aver
/// consegnato quaranta immersioni buone. Vedi `CollegamentoLdc::scarica_tutto`.
pub struct EsitoScarico {
    pub immersioni: Vec<ImmersioneGrezza>,
    /// Le stesse immersioni, lette — una per una, nello stesso ordine — col
    /// lettore che il dispositivo APERTO sa costruire. Vedi
    /// `leggi_dal_dispositivo` per il perché. Un errore riguarda solo quella.
    pub tradotte: Vec<Result<ImmersioneLdc, String>>,
    /// Chi ha detto di essere il computer (`DC_EVENT_DEVINFO`), se l'ha detto.
    pub dichiarato: Option<Dichiarazione>,
    /// Vero se `dc_device_open` non è riuscito: il computer non si è aperto, e
    /// quindi nessuna immersione poteva arrivare. Per i backend con un codice
    /// di accesso (Pelagic i330R, DSX) vuol dire anche che il codice presentato
    /// non ha aperto niente — vedi `EsitoChiave` nel ponte.
    pub non_aperto: bool,
    /// Il guasto, se c'è stato. Non toglie validità alle immersioni sopra.
    pub guasto: Option<String>,
}

impl EsitoScarico {
    /// Per chi non ha niente da salvare a metà: o tutto, o l'errore.
    ///
    /// `#[cfg(test)]` perché è vero: l'applicazione non la chiama da nessuna
    /// parte — quando uno scarico si rompe a metà, quello che è arrivato si
    /// tiene. Senza l'attributo era codice morto nella libreria e vivo solo
    /// nelle prove, cioè una funzione che *sembrava* far parte del prodotto.
    #[cfg(test)]
    pub fn in_risultato(self) -> Result<Vec<ImmersioneGrezza>, String> {
        match self.guasto {
            Some(motivo) => Err(motivo),
            None => Ok(self.immersioni),
        }
    }
}

impl CollegamentoLdc {
    /// Apre un flusso di libdivecomputer sopra il nostro trasporto.
    pub fn apri(trasporto: Box<dyn FlussoByte>) -> Result<Self, String> {
        // ► IL CONTESTO CHE ASCOLTA. ◄ È questo il contesto su cui gira lo
        // scarico (`dc_device_open` più sotto prende `self.contesto`), quindi è
        // qui che le `ERROR(...)` della libreria vanno raccolte. Vedi
        // `Contesto`: senza, al diario arriva solo il numero di stato, e `-8`
        // da solo non dice quale dei sei controlli è fallito né se il backend
        // avesse il diritto di ritentare.
        let contesto = Contesto::nuovo_con_diario()?;

        let guasto: Guasto = std::sync::Arc::new(std::sync::Mutex::new(None));
        let conteggi: Conteggi = std::sync::Arc::new(std::sync::Mutex::new(MisureLettura::default()));
        let stato = Box::into_raw(Box::new(Stato {
            flusso: trasporto,
            attesa: Duration::from_secs(5),
            guasto: guasto.clone(),
            conteggi: conteggi.clone(),
        }));

        let callbacks = DcCustomCbs {
            set_timeout: Some(cb_set_timeout),
            set_break: None,
            set_dtr: None,
            set_rts: None,
            get_lines: None,
            get_available: Some(cb_get_available),
            // `configure` è la velocità della porta seriale: su BLE non
            // significa niente. Lasciarla nulla fa restituire a
            // libdivecomputer **successo** (non «non supportato»: vedi
            // `dc_custom_configure` in `custom.c`), ed è quello che serve —
            // ogni backend la chiama all'apertura e si ferma se fallisce.
            configure: None,
            poll: Some(cb_poll),
            read: Some(cb_read),
            write: Some(cb_write),
            // Qui invece il nullo NON va bene: vedi il commento di `cb_ioctl`.
            ioctl: Some(cb_ioctl),
            flush: None,
            // Anche qui il nullo sarebbe «successo senza fare niente»: vedi
            // `cb_purge`.
            purge: Some(cb_purge),
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
        Ok(Self { contesto, flusso, guasto, conteggi })
    }

    /// Il numero di libdivecomputer con il suo nome e, se il trasporto ha
    /// annotato qualcosa, la causa con parole nostre.
    fn spiega(&self, esito: c_int) -> String {
        let causa = self.guasto.lock().ok().and_then(|p| p.clone());
        match causa {
            Some(causa) => format!("stato {esito}, {}: {causa}", nome_stato(esito)),
            None => format!("stato {esito}, {}", nome_stato(esito)),
        }
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

    /// Una `ioctl` attraverso libdivecomputer. Come sopra: serve ai test, che
    /// così percorrono la strada vera — `dc_iostream_ioctl` → `custom.c` →
    /// `cb_ioctl` — invece di chiamare la callback a mano.
    #[allow(dead_code)]
    pub fn ioctl(&self, richiesta: c_uint, buffer: &mut [u8]) -> c_int {
        unsafe {
            dc_iostream_ioctl(
                self.flusso,
                richiesta,
                buffer.as_mut_ptr() as *mut c_void,
                buffer.len(),
            )
        }
    }

    /// Svuota attraverso libdivecomputer. Come sopra: serve ai test.
    #[allow(dead_code)]
    pub fn svuota(&self) -> c_int {
        unsafe { dc_iostream_purge(self.flusso, 1) }
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

impl Descrittore {
    /// Il numero di modello secondo `descriptor.c`.
    pub fn modello(&self) -> u32 {
        // SICUREZZA: il puntatore è valido finché il descrittore vive.
        unsafe { dc_descriptor_get_model(self.0) }
    }
}

/// Marca e nome di TUTTI i descrittori della stessa famiglia di `scelto` che
/// portano il numero di modello `modello`, nell'ordine di `descriptor.c`.
///
/// Serve a dire con che cosa si stava parlando davvero, quando il computer si
/// dichiara diverso da quello scelto — è la stessa ricerca che fa Subsurface
/// all'arrivo di `DC_EVENT_DEVINFO` («EVENT_DEVINFO gave us a different
/// detected product»). **Tutti, e non il primo come fa Subsurface**: più
/// descrittori possono avere lo stesso numero — Aladin Sport Matrix e H Matrix
/// sono entrambi 23, i quattro Puck nuovi sono tutti 0x35 — e chi usa questo
/// elenco per RINOMINARE deve poter vedere che il numero non basta.
pub fn nomi_del_modello(scelto: &Descrittore, modello: u32) -> Vec<(String, String)> {
    // SICUREZZA: il puntatore è valido finché `scelto` vive.
    let famiglia = unsafe { dc_descriptor_get_type(scelto.0) };
    let mut iteratore: *mut DcIterator = std::ptr::null_mut();
    if unsafe { dc_descriptor_iterator_new(&mut iteratore, std::ptr::null_mut()) } != DC_STATUS_SUCCESS {
        return Vec::new();
    }
    let leggi = |p: *const std::ffi::c_char| -> String {
        if p.is_null() {
            String::new()
        } else {
            unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned()
        }
    };
    let mut trovati = Vec::new();
    loop {
        let mut d: *mut DcDescriptor = std::ptr::null_mut();
        if unsafe { dc_iterator_next(iteratore, &mut d) } != DC_STATUS_SUCCESS {
            break;
        }
        if unsafe { dc_descriptor_get_type(d) } == famiglia && unsafe { dc_descriptor_get_model(d) } == modello {
            let coppia = (leggi(unsafe { dc_descriptor_get_vendor(d) }), leggi(unsafe { dc_descriptor_get_product(d) }));
            // Lo stesso nome compare più volte quando il descrittore ha più
            // trasporti scritti su righe diverse: una volta basta.
            if !trovati.contains(&coppia) {
                trovati.push(coppia);
            }
        }
        unsafe { dc_descriptor_free(d) };
    }
    unsafe { dc_iterator_free(iteratore) };
    trovati
}

/// Il primo di `nomi_del_modello`: quello che direbbe Subsurface.
#[cfg_attr(not(test), allow(dead_code))]
pub fn nome_del_modello(scelto: &Descrittore, modello: u32) -> Option<(String, String)> {
    nomi_del_modello(scelto, modello).into_iter().next()
}

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

/// Quello che si può dire a chi guarda mentre lo scarico va avanti.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► DUE NUMERI, E NON SI FONDONO MAI IN UNO. ◄
///
/// `immersioni` è quante ne sono già uscite: è il numero che una persona
/// capisce, e l'unico che le interessi davvero. `byte_letti` su `byte_totali` è
/// quanto manca: è l'unico che sappia dire **quando finisce**.
///
/// Fondere i due — inventare un «27 di 81» — richiederebbe di sapere prima
/// quante immersioni ci sono, e con questi protocolli non si sa: si scopre
/// leggendo. *Una barra che avanza verso un totale inventato promette una fine
/// che non conosce*, ed è già scritto nell'interfaccia perché la stessa
/// tentazione era venuta a chi ha scritto il driver Uwatec.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Avanzamento {
    pub immersioni: usize,
    pub byte_letti: u32,
    pub byte_totali: u32,
}

/// Ogni quanto si può dire la stessa cosa a chi guarda.
const RESPIRO_DELL_AVANZAMENTO: Duration =
    if cfg!(test) { Duration::from_millis(1) } else { Duration::from_millis(250) };

/// Se questo avanzamento merita di attraversare il confine verso l'interfaccia.
///
/// ► LA CALLBACK DI libdivecomputer SCATTA A OGNI LETTURA. ◄ Sul Puck 4 del 12
/// settembre 2026 sarebbero **7472 eventi** in sette minuti e quarantaquattro
/// secondi: ognuno un messaggio serializzato, spedito attraverso il ponte e
/// trasformato in un disegno. Su un telefono quel lavoro se lo prende lo stesso
/// processo che deve stare dietro al Bluetooth — *un avanzamento che rallenta lo
/// scarico che sta raccontando è un peggioramento travestito da funzione*.
///
/// Due ragioni per parlare, e la prima non ha respiro:
///
/// - **è uscita un'immersione nuova.** È il numero che è stato chiesto, cambia
///   di rado — ottantuno volte in un'intera memoria — e vederlo salire è
///   l'unica cosa che dica «sta andando avanti davvero» invece di «il programma
///   non è bloccato»;
/// - **è cambiata la percentuale intera**, e sono passati almeno
///   `RESPIRO_DELL_AVANZAMENTO`. Più spesso di così nessuno lo vede: la barra si
///   muoverebbe di meno di un pixel.
///
/// Sta fuori come funzione pura perché è l'unica parte di tutto questo che si
/// possa inchiodare senza un computer subacqueo attaccato.
fn vale_la_pena_dirlo(prima: Option<Avanzamento>, adesso: Avanzamento, passato: Duration) -> bool {
    let Some(prima) = prima else { return true };
    if adesso.immersioni != prima.immersioni {
        return true;
    }
    if passato < RESPIRO_DELL_AVANZAMENTO {
        return false;
    }
    percentuale(prima) != percentuale(adesso)
}

/// La percentuale intera, o `None` quando il totale non si sa ancora.
fn percentuale(a: Avanzamento) -> Option<u32> {
    if a.byte_totali == 0 {
        None
    } else {
        Some((u64::from(a.byte_letti) * 100 / u64::from(a.byte_totali)).min(100) as u32)
    }
}

/// Quello che sta dietro il `void *userdata` delle DUE callback dello scarico.
///
/// ► UNA SOLA, PER TUTTE E DUE. ◄ Le immersioni arrivano da
/// `dc_device_foreach`, i byte da `dc_device_set_events`, e a schermo devono
/// comparire **nella stessa riga**: con due userdata separati il conto delle
/// immersioni e la percentuale sarebbero due verità che si rincorrono, e la
/// riga direbbe «27 immersioni» accanto a una barra ferma a prima della
/// ventisettesima.
///
/// ► E NON SERVE NESSUN LUCCHETTO. ◄ libdivecomputer chiama tutte e due dal
/// thread che ha invocato `dc_device_foreach`, cioè da questo: è codice C
/// sincrono, non c'è nessun altro thread in giro. *Scritto qui perché la
/// prossima persona che legge `*mut` e callback si chiederà se serve un
/// `Mutex`, e la risposta è no per un motivo, non per fortuna.*
struct Raccolta<'a> {
    immersioni: Vec<ImmersioneGrezza>,
    avvisa: &'a dyn Fn(Avanzamento),
    corrente: Avanzamento,
    detto: Option<Avanzamento>,
    quando: std::time::Instant,
    /// Modello e firmware dichiarati dal computer, da `DC_EVENT_DEVINFO`.
    dichiarato: Option<Dichiarazione>,
}

impl Raccolta<'_> {
    /// Dice l'avanzamento se vale la pena, e si ricorda cosa ha detto.
    fn racconta(&mut self) {
        if !vale_la_pena_dirlo(self.detto, self.corrente, self.quando.elapsed()) {
            return;
        }
        (self.avvisa)(self.corrente);
        self.detto = Some(self.corrente);
        self.quando = std::time::Instant::now();
    }
}

extern "C" fn raccogli(
    dati: *const u8,
    dimensione: c_uint,
    impronta: *const u8,
    dimensione_impronta: c_uint,
    userdata: *mut c_void,
) -> c_int {
    // SICUREZZA: `userdata` è la `Raccolta` passata a `dc_device_foreach`, viva
    // per tutta la durata della chiamata.
    let raccolta = unsafe { &mut *(userdata as *mut Raccolta) };
    let copia = |p: *const u8, n: c_uint| -> Vec<u8> {
        if p.is_null() || n == 0 {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(p, n as usize) }.to_vec()
        }
    };
    raccolta.immersioni.push(ImmersioneGrezza {
        dati: copia(dati, dimensione),
        impronta: copia(impronta, dimensione_impronta),
    });
    raccolta.corrente.immersioni = raccolta.immersioni.len();
    raccolta.racconta();
    1 // continua
}

/// I byte letti finora, da `DC_EVENT_PROGRESS`, e chi dice di essere il
/// computer, da `DC_EVENT_DEVINFO`.
extern "C" fn avanzamento_della_libreria(
    _dispositivo: *mut DcDevice,
    evento: c_uint,
    dati: *const c_void,
    userdata: *mut c_void,
) {
    if dati.is_null() || userdata.is_null() {
        return;
    }
    // SICUREZZA: `userdata` è la stessa `Raccolta` di `raccogli`, viva per
    // tutta la durata di `dc_device_foreach`.
    let raccolta = unsafe { &mut *(userdata as *mut Raccolta) };
    /*
     * ► IL TIPO DELLA STRUTTURA LO DICE L'EVENTO, E SOLO LUI. ◄ Le due
     * strutture sono entrambe fatte di `unsigned int`: leggere una
     * `dc_event_devinfo_t` come un progresso non darebbe nessun errore, darebbe
     * una barra al «modello su firmware» per cento. Per questo ogni ramo
     * confronta l'evento esatto, e tutto il resto si ignora.
     */
    match evento {
        DC_EVENT_PROGRESS => {
            // SICUREZZA: con `DC_EVENT_PROGRESS` la libreria passa un
            // `dc_event_progress_t`.
            let progresso = unsafe { &*(dati as *const DcEventProgress) };
            raccolta.corrente.byte_letti = progresso.current;
            raccolta.corrente.byte_totali = progresso.maximum;
            raccolta.racconta();
        }
        DC_EVENT_DEVINFO => {
            // SICUREZZA: con `DC_EVENT_DEVINFO` la libreria passa un
            // `dc_event_devinfo_t`. Il seriale si legge e si lascia lì: vedi
            // `Dichiarazione`.
            let info = unsafe { &*(dati as *const DcEventDevinfo) };
            let _ = info.serial;
            raccolta.dichiarato = Some(Dichiarazione { modello: info.model, firmware: info.firmware });
        }
        _ => {}
    }
}

impl CollegamentoLdc {
    /// Scarica tutte le immersioni dal computer, in byte grezzi.
    ///
    /// **Questa chiamata BLOCCA per minuti.** Va invocata sul thread dedicato,
    /// mai dentro il runtime asincrono: è tutto il motivo per cui questo file
    /// esiste.
    /// Quel che libdivecomputer ha detto mentre lavorava: al massimo le ultime
    /// `RIGHE_DI_LIBDIVECOMPUTER`, con la conta di quelle scartate.
    pub fn righe_della_libreria(&self) -> Vec<String> {
        self.contesto.righe_della_libreria()
    }

    /// Il conto delle letture, così com'è adesso.
    pub fn misure_lettura(&self) -> MisureLettura {
        self.conteggi.lock().map(|c| *c).unwrap_or_default()
    }

    /// Il conto delle letture in una riga di diario, o niente se non c'è stata
    /// nessuna lettura.
    ///
    /// ► SI TACE QUANDO NON C'È NIENTE DA DIRE. ◄ Uno scarico che non è mai
    /// arrivato a leggere — il computer non si apre, il collegamento cade
    /// prima — produrrebbe «0 letture, pausa più lunga 0 ms», che è una riga
    /// vera e inutile: occupa posto nel diario che una persona deve copiare e
    /// incollare, e insegna a saltare le righe di questo tipo. *Un diario si
    /// legge tutto solo finché ogni riga si è guadagnata il posto.*
    ///
    /// E il tetto si scrive accanto alla pausa **sempre**, anche quando sono
    /// lontani: è il confronto a dire qualcosa, non il numero da solo, e chi
    /// legge il diario non ha il codice davanti.
    pub fn riga_delle_letture(&self) -> Option<String> {
        let m = self.misure_lettura();
        if m.letture == 0 {
            return None;
        }
        /*
         * Le notifiche buttate prima di parlare si dicono SOLO quando ci sono:
         * sono un evento, non un conto che ogni scarico deve portarsi dietro.
         * E quando ci sono, sono la prima cosa da sapere — vuol dire che il
         * computer stava ancora parlando di qualcos'altro.
         */
        let mut prima = if m.scartate_prima > 0 {
            format!(
                "; arrivate prima del primo comando e buttate: {} notifiche ({} byte)",
                m.scartate_prima, m.byte_scartati_prima
            )
        } else {
            String::new()
        };
        if m.estranei > 0 {
            prima.push_str(&format!(
                "; pacchetti che rispondevano a un altro comando, buttati: {} ({} byte)",
                m.estranei, m.byte_estranei
            ));
        }
        Some(format!(
            "letture: {}, di cui {} corte e {} vuote; pacchetti lasciati a metà: {}; pausa più lunga colmata fra due frammenti: {} ms (ci si arrende a {} ms); silenzio più lungo fra un comando e la risposta: {} ms; seconde finestre concesse: {}, di cui utili {}; congelamenti visti: {}{prima}",
            m.letture,
            m.letture_corte,
            m.letture_vuote,
            m.frammenti_mancati,
            m.pausa_massima_ms,
            ATTESA_FRAMMENTO.as_millis(),
            m.silenzio_massimo_ms,
            m.proroghe,
            m.proroghe_utili,
            m.congelamenti,
        ))
    }

    /// Come `scarica_tutto`, ma butta via quello che è arrivato se poi si è
    /// rotto qualcosa. La usano le prove, dove non c'è niente da salvare.
    ///
    /// `#[cfg(test)]` perché è vero, e vale la pena che si veda: l'applicazione
    /// chiama sempre `scarica_tutto` con l'elenco di quello che ha già e con il
    /// riferimento per l'avanzamento. Le otto prove che passano di qui provano
    /// quindi una firma che in produzione non viene mai usata — è una
    /// scorciatoia da prove, e adesso lo dichiara.
    #[cfg(test)]
    pub fn scarica(&self, descrittore: &Descrittore) -> Result<Vec<ImmersioneGrezza>, String> {
        // Le prove che usano questa scorciatoia non hanno nessuno a cui
        // raccontare l'avanzamento: quelle che lo guardano chiamano `scarica_tutto`.
        self.scarica_tutto(descrittore, &[], &|_| {}).in_risultato()
    }

    /// Scarica, e restituisce **quello che è arrivato anche se poi si è rotto**.
    ///
    /// ════════════════════════════════════════════════════════════════════════
    /// ► UN'IMMERSIONE ARRIVATA È ARRIVATA, ANCHE SE LA VENTUNESIMA NO. ◄
    ///
    /// Fino a stanotte questa funzione, davanti a un errore, restituiva
    /// `Err(...)` e lasciava cadere le immersioni già decodificate. Su un
    /// backend che le consegna una per volta — Shearwater, Suunto, Oceanic —
    /// vuol dire che uno scarico rotto al novantesimo per cento **non portava a
    /// casa niente**, e il tentativo dopo ricominciava da zero.
    ///
    /// È un difetto che si vede solo adesso, perché adesso l'applicazione
    /// riprova da sola: prima ogni fallimento era definitivo e la differenza
    /// fra «niente» e «quasi tutto» non aveva a chi importare. *Un pezzo di
    /// codice diventa sbagliato anche quando cambia il codice che gli sta
    /// intorno, senza che nessuno lo tocchi.*
    ///
    /// Chi legge deve fare due cose distinte: prendersi le immersioni **e**
    /// raccontare il guasto. Non sono in alternativa, ed è tutto il punto.
    pub fn scarica_tutto(
        &self,
        descrittore: &Descrittore,
        impronta: &[u8],
        avvisa: &dyn Fn(Avanzamento),
    ) -> EsitoScarico {
        let mut dispositivo: *mut DcDevice = std::ptr::null_mut();
        let esito = unsafe {
            dc_device_open(&mut dispositivo, self.contesto.0, descrittore.0, self.flusso)
        };
        if esito != DC_STATUS_SUCCESS {
            return EsitoScarico {
                immersioni: Vec::new(),
                tradotte: Vec::new(),
                dichiarato: None,
                non_aperto: true,
                guasto: Some(format!("il computer non si è aperto ({})", self.spiega(esito))),
            };
        }

        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL SEGNALIBRO: SI SCARICA SOLO QUELLO CHE NON C'È GIÀ. ◄
         *
         * `dc_device_set_fingerprint` dice a libdivecomputer qual è l'ultima
         * immersione che abbiamo già. I backend leggono dalla più recente alla
         * più vecchia e si fermano appena la ritrovano — nei Mares è
         * letteralmente `Stopping due to detecting a matching fingerprint`, e
         * la fermata avviene dopo aver letto la sola INTESTAZIONE, prima dei
         * dati veri.
         *
         * Non chiamandola mai, ogni scarico rileggeva **tutta** la memoria del
         * computer: per chi ha quarantacinque immersioni in archivio, ogni
         * volta, comprese le quarantaquattro che ha già. Trecento kilobyte
         * invece di dieci — e su un collegamento che perde colpi, i byte che
         * non attraversi sono l'unica cosa che non può rompersi.
         *
         * ► COSA SUCCEDE SE L'IMPRONTA È SBAGLIATA, E PERCHÉ NON FA DANNI. ◄
         * Un'impronta che non corrisponde a nessuna immersione **non combacia
         * mai**, quindi non ferma niente e si legge tutto: costa un po' di
         * inutilità, non un dato perso. Il caso che fa danno è un altro e va
         * evitato da chi la conserva, non da qui: un'impronta che combacia con
         * un'immersione che NON è più in archivio farebbe saltare per sempre
         * tutte quelle più vecchie. Per questo chi la salva lo fa solo dopo uno
         * scarico **finito bene**, mai dopo uno interrotto a metà — dove le più
         * vecchie non sono ancora state lette.
         */
        if !impronta.is_empty() {
            let esito = unsafe {
                dc_device_set_fingerprint(
                    dispositivo,
                    impronta.as_ptr(),
                    impronta.len() as c_uint,
                )
            };
            if esito != DC_STATUS_SUCCESS {
                // Non è un motivo per fermarsi: senza segnalibro si scarica
                // tutto, che è quello che si faceva fino a ieri. Ma va detto,
                // perché uno scarico lungo dove ci si aspettava un lampo è
                // esattamente il genere di cosa che fa sospettare il guasto
                // sbagliato.
                annota(
                    &self.guasto,
                    format!(
                        "il computer non ha accettato il segnalibro di {} byte ({}): si scarica tutto",
                        impronta.len(),
                        self.spiega(esito)
                    ),
                );
            }
        }

        let mut raccolta = Raccolta {
            immersioni: Vec::new(),
            avvisa,
            corrente: Avanzamento::default(),
            detto: None,
            quando: std::time::Instant::now(),
            dichiarato: None,
        };
        let suo = &mut raccolta as *mut Raccolta as *mut c_void;
        /*
         * ► L'ISCRIZIONE ALL'AVANZAMENTO NON PUÒ FAR FALLIRE UNO SCARICO. ◄
         * Se la libreria la rifiuta — non dovrebbe, ma è un `dc_status_t` come
         * tutti gli altri — l'unica conseguenza è una barra che non si muove.
         * Fermarsi qui vorrebbe dire buttare via uno scarico che avrebbe
         * funzionato per non poter raccontare come stava andando: *il resoconto
         * non vale mai più della cosa che racconta.* Va però detto nel diario,
         * o la barra ferma diventerebbe un secondo mistero da spiegare.
         */
        let iscritto = unsafe {
            dc_device_set_events(
                dispositivo,
                DC_EVENT_PROGRESS | DC_EVENT_DEVINFO,
                avanzamento_della_libreria,
                suo,
            )
        };
        if iscritto != DC_STATUS_SUCCESS {
            annota(
                &self.guasto,
                format!(
                    "la libreria non ha accettato di raccontare l'avanzamento ({}): la barra resterà ferma",
                    self.spiega(iscritto)
                ),
            );
        }
        let esito = unsafe { dc_device_foreach(dispositivo, raccogli, suo) };
        let raccolte = raccolta.immersioni;
        let dichiarato = raccolta.dichiarato;
        // La causa si legge PRIMA di chiudere: per i backend il cui `close`
        // scrive sul flusso (l'OSTC manda EXIT, Shearwater chiude la
        // sessione), una chiusura su un collegamento già caduto annota un
        // secondo guasto che sovrascriverebbe quello dello scarico — e il
        // messaggio parlerebbe della chiusura invece che di cosa si è rotto.
        let spiegazione = if esito != DC_STATUS_SUCCESS { Some(self.spiega(esito)) } else { None };
        /*
         * ► LE IMMERSIONI SI LEGGONO ADESSO, COL DISPOSITIVO ANCORA APERTO. ◄
         *
         * Il lettore che il dispositivo sa costruire usa il modello che il
         * computer ha dichiarato, e non quello che è stato scelto: vedi
         * `leggi_dal_dispositivo`. Dopo `dc_device_close` il dispositivo non
         * esiste più, e con lui quel modello. Leggere cento immersioni costa
         * millisecondi: il collegamento resta aperto un istante in più, e
         * nessuno scambio col computer avviene in quell'istante — il lettore
         * lavora sui byte già arrivati.
         */
        let tradotte = raccolte.iter().map(|g| leggi_dal_dispositivo(dispositivo, &g.dati)).collect();
        // Il dispositivo si chiude comunque, anche quando lo scarico è fallito:
        // lasciarlo aperto significherebbe un computer che resta occupato.
        unsafe { dc_device_close(dispositivo) };

        EsitoScarico {
            immersioni: raccolte,
            tradotte,
            dichiarato,
            non_aperto: false,
            guasto: spiegazione.map(|s| format!("scarico non riuscito ({s})")),
        }
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
    /// L'indice della miscela respirata, nella lista delle MISCELE.
    ///
    /// ► NON È L'INDICE DELLA BOMBOLA, E IL NOME LO DICE. ◄ libdivecomputer
    /// tiene due liste separate — `DC_FIELD_GASMIX` e `DC_FIELD_TANK` — e
    /// `dc_tank_t` porta un campo `gasmix` proprio perché non coincidono. Il
    /// modello dell'applicazione invece indicizza `Sample.gasIndex` sulle
    /// BOMBOLE. Chiamarlo `gasIndex` già da qui vorrebbe dire consegnare a
    /// valle un numero giusto con l'etichetta di un altro: la traduzione la fa
    /// `core/ble/esterni.ts`, che è l'unico posto che vede tutte e due le
    /// liste.
    #[serde(rename = "gasMixIndex", skip_serializing_if = "Option::is_none")]
    pub indice_miscela: Option<u32>,
    /// Il computer sta contando la SOSTA DI SICUREZZA, e lo dice lui.
    ///
    /// Non è un tetto e non è un obbligo: è il contatore che parte da solo negli
    /// ultimi metri. Tenerlo separato è tutta la ragione di questi due campi —
    /// vedi il commento sul tipo di sosta, sopra.
    #[serde(rename = "inSafetyStop", skip_serializing_if = "Option::is_none")]
    pub in_safety_stop: Option<bool>,
    /// Il computer sta proponendo una SOSTA PROFONDA. Consiglio, non obbligo.
    #[serde(rename = "inDeepStop", skip_serializing_if = "Option::is_none")]
    pub in_deep_stop: Option<bool>,
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
    /**
     * Lo scostamento da UTC in MINUTI, quando il computer lo dichiara.
     *
     * Per mesi qui c'era scritto, in un commento, che libdivecomputer il fuso
     * non lo fornisce. Non era vero: `dc_datetime_t` ha il campo `timezone`, sei
     * famiglie di lettori lo riempiono — Shearwater compresa — e il valore
     * veniva letto e poi buttato. Le immersioni di uno Shearwater entravano in
     * archivio con l'orario spostato dello scostamento: fatte alle 10:38 in
     * Italia, mostrate alle 08:38.
     *
     * `DC_TIMEZONE_NONE` (0x7FFFFFFF) resta assente, che è la cosa giusta: «non
     * lo dice» non è «è a Greenwich».
     */
    #[serde(rename = "utcOffsetMinutes", skip_serializing_if = "Option::is_none")]
    pub fuso_minuti: Option<i32>,
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

/// UNA LISTA INDICIZZATA LETTA DALLA LIBRERIA, CON IL POSTO DELLE LETTURE FALLITE.
///
/// ► PERCHÉ ESISTE UNA FUNZIONE PER DUE RIGHE. ◄ Perché lo stesso difetto è
/// stato commesso due volte, a quaranta righe di distanza, e chiuso una volta
/// sola.
///
/// Le liste che libdivecomputer espone per indice — le bombole e le miscele —
/// sono l'indirizzo con cui i CAMPIONI parlano: il campione dice «bombola 2,
/// 137 bar» e «adesso respiro la miscela 2». Se chi legge fa `push` solo quando
/// la lettura riesce, una voce rifiutata a metà elenco fa **scalare di uno
/// tutte quelle dopo**, e il campione continua a indicare il numero 2 trovando
/// il contenuto del 3.
///
/// Il 15 settembre 2026 questo è stato corretto per le bombole. Le miscele sono
/// rimaste come prima fino al 16, e la conseguenza era peggiore: misurata su un
/// profilo con tre gas in cui la libreria rifiuta il secondo, la bombola di
/// decompressione diventava **ossigeno puro** e la PPO2 di picco passava da
/// 1.06 a **1.62** — cioè un'immersione tranquilla mostrata come un'esposizione
/// da convulsione, o il suo contrario, a seconda di come cade lo scorrimento.
///
/// *Due copie della stessa regola sono una regola e la sua versione vecchia.*
/// Adesso la regola è una, i due chiamanti la usano, e la prova la esercita
/// davvero — invece di ricostruire a mano un vettore e controllare il vettore
/// che si è appena costruito.
fn lista_allineata<T: Default>(quante: c_uint, leggi: impl Fn(c_uint) -> Option<T>) -> Vec<T> {
    (0..quante).map(|i| leggi(i).unwrap_or_default()).collect()
}

/// Quello che si accumula mentre libdivecomputer sciorina i campioni.
struct Accumulatore {
    immersione: ImmersioneLdc,
    corrente: CampioneLdc,
    iniziato: bool,
    quante_bombole: usize,
    /// ════════════════════════════════════════════════════════════════════════
    /// ► LA MISCELA SI DICE QUANDO CAMBIA, E VALE FINO AL CAMBIO DOPO. ◄
    ///
    /// libdivecomputer manda `DC_SAMPLE_GASMIX` **solo nell'istante del
    /// cambio**: il campione dopo non lo ripete. Chi legge deve portarla avanti,
    /// e chi non lo fa si ritrova un profilo in cui il gas è dichiarato su un
    /// campione ogni duemila.
    ///
    /// Non è una comodità: `analysis/tissues.ts` legge `s.gasIndex ?? 0` **su
    /// ogni campione**, quindi senza il riporto tutta l'immersione verrebbe
    /// calcolata sulla miscela di fondo — compresa la risalita fatta con il
    /// deco gas. *Su un'immersione con cambio gas sarebbe una saturazione
    /// sbagliata presentata con la stessa faccia di una giusta.*
    miscela_corrente: Option<u32>,
    /// Quante letture di pressione sono state scartate perché l'indice di
    /// bombola era fuori scala. Vedi il ramo `DC_SAMPLE_PRESSURE`.
    pressioni_fuori_scala: usize,
}

/*
 * ► IL TIPO DI SOSTA. LA COSTANTE ERA SBAGLIATA DI UNO, E NON DAVA ERRORE. ◄
 *
 * Il commento che stava qui diceva «0 nessuna, 1 NDL, 2 sosta deco, 3 sosta di
 * sicurezza». È un ordine inventato. Quello vero sta in
 * `include/libdivecomputer/parser.h` del tarball in `vendor/` (0.9.0 allora,
 * il ramo principale dal 22 settembre 2026 — l'ordine è rimasto quello):
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
/// `DC_SAMPLE_GASMIX` di `dc_sample_type_t`, in `parser.h`.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► QUESTO CAMPIONE VENIVA BUTTATO DI PROPOSITO, E ERA UN BUCO. ◄
///
/// Fino alla 1.8.18 qui c'era scritto, nel ramo `_ => {}`: *«Eventi, battito,
/// rilevamento, dati del costruttore, **cambio gas**: non servono al modello
/// canonico e si scartano di proposito»*. Il modello canonico però ce l'ha, il
/// posto per il gas — `Sample.gasIndex` esiste dal primo giorno e lo riempiono
/// i driver di casa e i lettori di file — e **tutto quello che sta a valle lo
/// legge**: la saturazione dei tessuti, la CNS, l'OTU, e il controllo che un
/// cambio gas non sia stato fatto sotto la MOD del gas su cui si passa.
///
/// Senza, un'immersione con cambio gas veniva calcolata **tutta sulla miscela
/// di fondo**, risalita e soste comprese. Non dava nessun errore: dava una
/// saturazione plausibile e sbagliata, che in un logbook è il guasto peggiore.
///
/// ► QUANTO COPRE, MISURATO INVECE CHE SPERATO. ◄ Dei 36 parser di
/// libdivecomputer — contati nella 0.9.0 e ricontati nel ramo principale il 22
/// settembre 2026, stessi numeri — **26 mandano `DC_SAMPLE_GASMIX`** — fra cui
/// `mares_iconhd` (il Puck 4), `shearwater_predator` e `uwatec_smart` — e
/// **nessuno** usa soltanto il vecchio evento `SAMPLE_EVENT_GASCHANGE`.
/// Contati nel sorgente, non dedotti: `grep -l DC_SAMPLE_GASMIX src/*.c`.
/// Quindi non c'è nessun ripiego da scrivere sull'evento, e scriverlo sarebbe
/// indovinare una miscela da una percentuale di ossigeno per una strada che
/// nessun backend percorre.
const CAMPIONE_MISCELA: c_uint = 13;

const DECO_NDL: c_uint = 0;
const DECO_SOSTA_SICUREZZA: c_uint = 1;
const DECO_SOSTA_DECO: c_uint = 2;
const DECO_SOSTA_PROFONDA: c_uint = 3;

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
            acc.corrente = CampioneLdc {
                t: unsafe { v.tempo } / 1000,
                // ► LA MISCELA SI EREDITA DAL CAMPIONE PRIMA. ◄ Vedi
                // `Accumulatore::miscela_corrente`: la libreria la dice solo
                // quando cambia, e un `DC_SAMPLE_GASMIX` che arriva dopo questo
                // istante sovrascrive tanto il campione quanto l'eredità.
                indice_miscela: acc.miscela_corrente,
                ..Default::default()
            };
        }
        1 => acc.corrente.depth = Some(unsafe { v.profondita }),
        2 => {
            let p = unsafe { v.pressione };
            /*
             * ════════════════════════════════════════════════════════════════
             * ► UN INDICE DI BOMBOLA NON CONTROLLATO ERA LA DIMENSIONE DI
             * UN'ALLOCAZIONE, E FACEVA ABORTIRE L'APPLICAZIONE INTERA. ◄
             *
             * `p.bombola` è un `unsigned int` che arriva così com'è dalla
             * libreria e finiva dritto in `resize`. Con `0xFFFFFFFF` diventa
             * `resize(4_294_967_296)` di elementi da sedici byte: **64 GiB**. In
             * Rust un'allocazione fallita non è un `Err` e non è un panic che si
             * possa raccogliere: è `abort()`. Muore il processo Tauri a metà di
             * un trasferimento da minuti, senza messaggio, senza diario e senza
             * le immersioni già arrivate.
             *
             * ► E NON È TEORICO: `0xFFFFFFFF` È UN VALORE CHE LA LIBRERIA MANDA.
             * `shearwater_predator_parser.c` definisce `UNDEFINED 0xFFFFFFFF`,
             * lo scrive in `tankidx[i]` per ogni slot non attivo e poi assegna
             * `sample.pressure.tank = parser->tankidx[id]` **senza controllare**;
             * `suunto_eonsteel_parser.c` fa `sample.pressure.tank = info->gasnr
             * - 1` con `gasnr` inizializzato a zero, che in `unsigned` è di
             * nuovo `0xFFFFFFFF`. Su un telefono a 32 bit va perfino peggio:
             * `indice + 1` trabocca `usize` e in release diventa `resize(0)`,
             * cioè un accesso fuori dai limiti subito dopo.
             *
             * ► IL TETTO, E PERCHÉ QUESTO NUMERO. ◄ `NTANKS` di Shearwater vale
             * sei; nessun computer in commercio dichiara più bombole di così, e
             * `dc_tank_t` ne conta una manciata. Sedici lascia margine a
             * chiunque e resta un vettore da niente. *Oltre questo numero non
             * c'è una bombola: c'è un dato sbagliato*, e un dato sbagliato si
             * scarta — non gli si alloca la memoria che chiede.
             */
            const BOMBOLE_AL_MASSIMO: usize = 16;
            let indice = p.bombola as usize;
            if indice < BOMBOLE_AL_MASSIMO {
                if acc.corrente.pressione_bar.len() <= indice {
                    acc.corrente.pressione_bar.resize(indice + 1, None);
                }
                acc.corrente.pressione_bar[indice] = Some(p.valore);
                acc.quante_bombole = acc.quante_bombole.max(indice + 1);
            } else {
                // Contato e non taciuto: un conto che resta a zero per sempre è
                // la prova che il tetto non serve, e se un giorno salisse
                // vorremmo saperlo dal diario invece che da una segnalazione.
                acc.pressioni_fuori_scala += 1;
            }
        }
        3 => acc.corrente.temp_c = Some(unsafe { v.temperatura }),
        5 => acc.corrente.rbt_min = Some(unsafe { v.rbt }),
        9 => acc.corrente.setpoint = Some(unsafe { v.setpoint }),
        10 => acc.corrente.ppo2 = Some(unsafe { v.ppo2 }.valore),
        11 => acc.corrente.cns = Some(unsafe { v.cns } * 100.0),
        12 => {
            let d = unsafe { v.deco };
            /*
             * ► QUATTRO TIPI, TRE SIGNIFICATI, E PRIMA ERANO DUE RAMI. ◄
             *
             * `dc_deco_type_t` distingue la curva, la **sosta di sicurezza**, la
             * **tappa di decompressione** e la **sosta profonda**. Qui i tre tipi
             * diversi da `NDL` finivano tutti nello stesso `else`, con un tetto
             * valorizzato e `in_deco = true`. Cioè: **il computer diceva «sto
             * contando la sosta di sicurezza» e noi lo scrivevamo come «sei in
             * decompressione».**
             *
             * Non è una sfumatura statistica. Una sosta di sicurezza si può
             * saltare, una tappa no: è la distinzione su cui è costruito tutto il
             * resto dell'applicazione, ed era appiattita esattamente nel punto in
             * cui il computer la stava dichiarando. Le conseguenze, seguite nel
             * codice TypeScript:
             *
             *  1. `decoS` contava quei tre minuti come obbligo → l'immersione
             *     diventava «con decompressione», e quel conteggio alimenta i
             *     prerequisiti di prontezza per i corsi;
             *  2. essendo «con deco», usciva dal denominatore delle soste di
             *     sicurezza: la statistica di chi la sosta la fa sempre veniva
             *     calcolata su meno immersioni;
             *  3. con il tetto a cinque metri, il subacqueo che durante la sosta
             *     galleggia a 4,5 m finiva in `ceilingViolationS`. **Una sosta di
             *     sicurezza normale poteva risultare una violazione del tetto di
             *     decompressione**, che è il messaggio che fa ignorare anche gli
             *     avvisi veri.
             *
             * Adesso: la curva è curva, la tappa è un obbligo con il suo tetto, e
             * le due soste consigliate hanno il loro campo e **non** scrivono né
             * `ceiling` né `in_deco`.
             */
            match d.tipo {
                DECO_NDL => {
                    acc.corrente.ndl_s = Some(d.tempo);
                    acc.corrente.in_deco = Some(false);
                }
                DECO_SOSTA_SICUREZZA => {
                    acc.corrente.in_safety_stop = Some(true);
                    acc.corrente.in_deco = Some(false);
                }
                DECO_SOSTA_PROFONDA => {
                    acc.corrente.in_deep_stop = Some(true);
                    acc.corrente.in_deco = Some(false);
                }
                DECO_SOSTA_DECO => {
                    acc.corrente.ceiling = Some(d.profondita);
                    acc.corrente.in_deco = Some(d.profondita > 0.0);
                }
                /*
                 * Un tipo che non conosciamo NON si tratta come una tappa. Se un
                 * giorno libdivecomputer ne aggiungesse uno, scriverlo come
                 * obbligo decompressivo sarebbe l'errore che questo blocco è
                 * appena finito di correggere: nel dubbio non si dichiara niente.
                 */
                _ => {}
            }
            if d.tts > 0 {
                acc.corrente.tts_s = Some(d.tts);
            }
        }
        CAMPIONE_MISCELA => {
            let quale = unsafe { v.miscela };
            acc.miscela_corrente = Some(quale);
            acc.corrente.indice_miscela = Some(quale);
        }
        // Eventi, battito, rilevamento e dati del costruttore: non servono al
        // modello canonico e si scartano di proposito, invece di essere
        // raccolti «casomai».
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
    /// L'indice nella lista delle MISCELE — non delle bombole. Vedi
    /// `CAMPIONE_MISCELA`.
    miscela: c_uint,
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
    fn dc_parser_new(
        parser: *mut *mut DcParser,
        device: *mut DcDevice,
        data: *const u8,
        size: usize,
    ) -> c_int;
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

/// Traduce i byte grezzi di UNA immersione nel nostro modello, col lettore
/// costruito sul DESCRITTORE.
///
/// PERCHÉ QUI E NON IN TYPESCRIPT. Perché i byte grezzi di un computer che non
/// conosciamo non li sa leggere nessuno tranne libdivecomputer, e farli
/// attraversare il confine per poi rimandarli indietro sarebbe un giro inutile.
/// Quello che attraversa il confine è già il modello.
///
/// ► NON È PIÙ LA STRADA DELLO SCARICO. ◄ Allo scarico si legge col
/// dispositivo aperto: vedi `leggi_dal_dispositivo`. Questa resta per chi ha
/// solo i byte e un descrittore — le prove, e il confronto con le immersioni
/// esportate — ed è quello che fa anche Subsurface quando importa un file.
#[cfg_attr(not(test), allow(dead_code))]
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
    leggi_col_lettore(parser)
}

/// Traduce UNA immersione col lettore che il dispositivo aperto sa costruire.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► IL LETTORE COSTRUITO SUL MODELLO SCELTO LEGGEVA CON GLI OCCHI DI UN ALTRO. ◄
///
/// Fino al 22 settembre 2026 le immersioni scaricate si leggevano con
/// `dc_parser_new2`, cioè con il modello del DESCRITTORE: quello scelto
/// dall'elenco, o proposto dal nome Bluetooth. Per molte famiglie il modello
/// decide come si leggono i byte — la disposizione dei campioni dei Mares,
/// hwOS 3 o hwOS 4 negli OSTC, gli schemi della memoria Pelagic — e il
/// modello scelto può non essere quello vero: chi ha un Mares dietro un
/// adattatore BlueLink Pro sceglie fra diciassette nomi, chi ha un Ratio fra
/// venticinque, e con libdivecomputer aggiornata **tutti gli OSTC fino al Plus
/// hanno il numero zero**. Un lettore col modello sbagliato non dà errore: dà
/// un profilo plausibile e falso, che in un logbook è il guasto peggiore.
///
/// `dc_parser_new` costruisce il lettore sul DISPOSITIVO, cioè sul modello che
/// il computer ha dichiarato con `DC_EVENT_DEVINFO` — e tutti i backend BLE
/// della libreria lo dichiarano, prima della prima immersione. È esattamente
/// quello che fa Subsurface (`dive_cb` in `core/libdivecomputer.cpp`), che è la
/// strada su cui i backend vengono provati davvero. *Una strada diversa da
/// quella del programma su cui la libreria è collaudata è una strada che non
/// ha collaudato nessuno.*
fn leggi_dal_dispositivo(dispositivo: *mut DcDevice, dati: &[u8]) -> Result<ImmersioneLdc, String> {
    let mut parser: *mut DcParser = std::ptr::null_mut();
    // SICUREZZA: `dispositivo` è aperto — chi chiama lo chiude dopo — e `dati`
    // vive per tutta la chiamata; il lettore ne tiene una copia sua.
    let esito = unsafe { dc_parser_new(&mut parser, dispositivo, dati.as_ptr(), dati.len()) };
    if esito != DC_STATUS_SUCCESS {
        return Err(format!("nessun lettore per questa immersione (stato {esito})"));
    }
    leggi_col_lettore(parser)
}

/// Il corpo comune delle due traduzioni: prende possesso del lettore, lo usa e
/// lo distrugge.
fn leggi_col_lettore(parser: *mut DcParser) -> Result<ImmersioneLdc, String> {
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
    if unsafe { dc_parser_get_datetime(parser, &mut quando) } == DC_STATUS_SUCCESS
        && data_plausibile(&quando)
    {
        immersione.inizio_ms = millisecondi(&quando);
        /*
         * ► IL FUSO C'È, E LO SI BUTTAVA. ◄
         *
         * Qui c'era un commento che diceva che libdivecomputer il fuso non lo
         * fornisce. Non è vero: `dc_datetime_t` ha il campo `timezone`, e sei
         * famiglie di lettori lo riempiono — fra cui Shearwater, che è il
         * computer più diffuso fra chi usa questa applicazione.
         *
         * `DC_TIMEZONE_NONE` vale `0x7FFFFFFF` e significa «questo computer non
         * lo dice»: quello sì va ignorato. Tutto il resto sono secondi di
         * scostamento da UTC, e buttarli via faceva comparire l'immersione con
         * l'orario spostato dell'offset — un'immersione fatta alle 10:38 in
         * Italia mostrata alle 08:38.
         */
        const FUSO_ASSENTE: i32 = 0x7FFF_FFFF;
        if quando.fuso != FUSO_ASSENTE {
            let minuti = quando.fuso / 60;
            // Gli stessi limiti che applica il lettore di Shearwater Cloud:
            // da UTC−12:00 a UTC+14:00. Fuori di lì non è un fuso.
            if (-720..=840).contains(&minuti) {
                immersione.fuso_minuti = Some(minuti);
            }
        }
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
        /*
         * ► UNA MISCELA CHE NON SI LEGGE LASCIA IL SUO POSTO, esattamente come
         *   una bombola. ◄ Vedi `lista_allineata`: qui il `push` condizionato
         *   faceva scorrere gli indici, e il campione che dichiara «miscela 2»
         *   finiva a respirare la 3.
         *
         * Il posto vuoto è `o2 = 0`, che non è una miscela possibile — le
         * frazioni di `dc_gasmix_t` stanno fra 0 e 1 e nessun gas respirabile
         * ha zero ossigeno — quindi è un valore che vuol dire soltanto «di
         * questa non sappiamo niente». Il lato TypeScript lo interpreta già
         * così: `miscela()` in `ble/esterni.ts` tratta `o2 <= 0` come «non
         * dichiarata» e ricade sull'aria, che è l'assunzione presa in un posto
         * solo e scritta lì accanto.
         */
        immersione.gas = lista_allineata(quanti_gas, |i| {
            let mut mix = GasMix::default();
            (unsafe {
                dc_parser_get_field(parser, CAMPO_GAS, i, &mut mix as *mut GasMix as *mut c_void)
            } == DC_STATUS_SUCCESS)
                .then_some(GasLdc { o2: mix.ossigeno, he: mix.elio })
        });
        let ignote = immersione.gas.iter().filter(|g| g.o2 <= 0.0).count();
        if ignote > 0 {
            // Sul diario, mai in silenzio: è la stessa regola delle pressioni
            // fuori scala qui sotto.
            eprintln!("miscele dichiarate ma illeggibili, posto tenuto: {ignote}");
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
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► UNA BOMBOLA CHE LA LIBRERIA NON SA DESCRIVERE LASCIA IL SUO POSTO
         *   VUOTO, NON SPARISCE. ◄
         *
         * IL DIFETTO CHIUSO IL 15 SETTEMBRE 2026, ed è un dato falso e
         * credibile — la specie peggiore.
         *
         * Le pressioni dei CAMPIONI sono indicizzate sull'indice che la
         * libreria dà alla bombola: il campione dice «bombola 2, 137 bar».
         * Qui invece si faceva `push` solo quando la lettura riusciva, quindi
         * una bombola rifiutata a metà elenco — capita sui Mares con le unità
         * imperiali — faceva **scalare di uno tutte quelle dopo**. Il campione
         * continuava a dire «bombola 2» e trovava la 3.
         *
         * Cioè: la pressione di una bombola finiva attribuita a un'altra. Il
         * consumo, la riserva, il grafico delle pressioni, tutto giusto nella
         * forma e riferito all'oggetto sbagliato — e nessun modo di accorgersene
         * leggendo la scheda.
         *
         * Il posto resta, con tutti i campi a `None`: «qui c'è una bombola di
         * cui non sappiamo niente» è un'affermazione vera, e a valle un campo
         * assente è già gestito dappertutto. *Un buco dichiarato è pur sempre un
         * buco, ma un buco che sposta gli altri è un altro problema.*
         */
        immersione.bombole = lista_allineata(quante_bombole, |i| {
            let mut b = BombolaC::default();
            (unsafe {
                dc_parser_get_field(parser, CAMPO_BOMBOLA, i, &mut b as *mut BombolaC as *mut c_void)
            } == DC_STATUS_SUCCESS)
                .then(|| BombolaLdc {
                    indice_gas: (b.gasmix != GASMIX_SCONOSCIUTA).then_some(b.gasmix as usize),
                    // Zero non è una misura: è «non dichiarato». `dc_tank_t` lo
                    // dice esplicitamente per il volume, e una bombola da zero
                    // litri o da zero bar farebbe divisioni per zero a valle.
                    volume_l: (b.volume > 0.0).then_some(b.volume),
                    pressione_iniziale_bar: (b.pressione_iniziale > 0.0)
                        .then_some(b.pressione_iniziale),
                    pressione_finale_bar: (b.pressione_finale > 0.0).then_some(b.pressione_finale),
                })
        });
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
        // Nessuna miscela finché il computer non ne dichiara una: `None` vuol
        // dire «non lo so», e a valle diventa «usa la prima», che è
        // un'assunzione presa in un posto solo e dichiarata.
        miscela_corrente: None,
        pressioni_fuori_scala: 0,
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
    if acc.pressioni_fuori_scala > 0 {
        // Sul diario, non in silenzio: il tetto sugli indici di bombola scarta
        // un dato, e un dato scartato senza dirlo è la stessa specie di guasto
        // che il tetto serve a evitare.
        eprintln!(
            "letture di pressione scartate per indice di bombola fuori scala: {}",
            acc.pressioni_fuori_scala
        );
    }
    Ok(acc.immersione)
}

/// UNA DATA CHE PUÒ ESISTERE.
///
/// ════════════════════════════════════════════════════════════════════════════
/// ► IL DIFETTO CHIUSO IL 15 SETTEMBRE 2026. ◄ Il controllo era `anno != 0`, e
/// basta. Tutto il resto entrava come data certa: mese 0, giorno 0, ora 31,
/// anno 4095 — cioè i valori che escono da un blocco di memoria non
/// inizializzato, o da un computer a cui non è mai stata messa l'ora.
///
/// `millisecondi` è aritmetica civile pura e non si lamenta: con mese 0 e giorno
/// 0 produce un istante, e quell'istante finisce in archivio con la catena dei
/// tessuti, le statistiche per giornata e il libretto a valore legale appresi.
///
/// Meglio nessuna data — che l'applicazione sa già mostrare e far correggere a
/// mano — che una data sbagliata di tre mesi.
///
/// ► E IL DIFETTO CHE ERA RIMASTO, CHIUSO IL 16 SETTEMBRE 2026. ◄ Il giorno lo
/// si controllava con `(1..=31)`, cioè senza guardare in che mese cade: il **31
/// febbraio** passava, e con lui il 31 aprile, il 31 giugno, il 31 settembre e
/// il 31 novembre.
///
/// E passare non vuol dire «entra e si vede che è strano»: `millisecondi` è
/// aritmetica civile di Howard Hinnant, che **non ha casi speciali** — il 31
/// febbraio 2026 diventa il 3 marzo, il 31 aprile diventa il 1° maggio. La
/// data entra in archivio **spostata fino a tre giorni e dichiarata certa**, e
/// da lì comanda l'ordine del logbook, il raggruppamento per giornata di CNS e
/// OTU, l'intervallo di superficie della catena dei tessuti e il libretto a
/// valore legale.
///
/// *Un valore impossibile riconosciuto come impossibile diventa «senza data»,
/// che l'applicazione sa mostrare e far correggere a mano. Un valore
/// impossibile arrotondato a uno possibile non lo riconosce più nessuno.*
fn data_plausibile(q: &DcDatetime) -> bool {
    // 1950 perché i computer subacquei non esistevano prima; il tetto è largo
    // per non tagliare fuori chi ha l'orologio avanti di qualche mese.
    (1950..=2100).contains(&q.anno)
        && (1..=12).contains(&q.mese)
        && q.giorno >= 1
        && q.giorno <= giorni_del_mese(q.anno, q.mese)
        && q.ora <= 23
        && q.minuto <= 59
        // Il 60 è il secondo intercalare, che esiste davvero: `millisecondi` lo
        // porta al minuto dopo, ed è uno spostamento di un secondo su un dato
        // vero — non la stessa specie di cosa del 31 febbraio.
        && q.secondo <= 60
}

/// Quanti giorni ha un mese, bisestili compresi.
///
/// Il calendario gregoriano in una riga: bisestile se divisibile per quattro, a
/// meno che non lo sia per cento, a meno che non lo sia per quattrocento. Il
/// 2000 è bisestile, il 1900 no, e il 2100 — che è il tetto degli anni
/// accettati qui sopra — nemmeno.
fn giorni_del_mese(anno: c_int, mese: c_uint) -> c_uint {
    match mese {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let bisestile = anno % 4 == 0 && (anno % 100 != 0 || anno % 400 == 0);
            if bisestile {
                29
            } else {
                28
            }
        }
        // Un mese che non esiste non ha giorni: il controllo sul mese qui sopra
        // lo prende già, e questo ramo non lascia comunque passare niente.
        _ => 0,
    }
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

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ► QUESTO `Drop` NON SCATTA SU UN PANIC, E VA SAPUTO. ◄
 *
 * Verificato il 15 settembre 2026. `Cargo.toml` mette `panic = "abort"` nel
 * profilo `release`: un panic non srotola lo stack, quindi **nessun `Drop`
 * viene eseguito** — questo compreso.
 *
 * Perché non è un difetto da correggere. Con `abort` il processo muore subito,
 * e quando il processo muore il sistema operativo chiude ogni descrittore e
 * libera ogni pagina: il collegamento Bluetooth cade, la memoria della libreria
 * torna al sistema. Non si perde niente che non si perderebbe comunque.
 *
 * Perché allora scriverlo. Perché la riga sopra dice «si libera dopo, da sé» e
 * chi la legge potrebbe concluderne che quella pulizia avvenga SEMPRE — e da lì
 * ragionare che un panic sia gestibile, che il collegamento si chiuda per bene,
 * che si possa riprovare senza riaprire l'applicazione. Nessuna delle tre è
 * vera in `release`.
 *
 * In `debug` invece lo srotolamento c'è e il `Drop` scatta: cioè il
 * comportamento delle prove NON è quello dei pacchetti che si spediscono.
 * *Una prova che passa in una configurazione che non si distribuisce dice meno
 * di quanto sembra*, e questo riquadro esiste perché non se ne perda memoria.
 */

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
        fn scrivi(&mut self, dati: &[u8]) -> Result<(), GuastoScrittura> {
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
        fn scrivi(&mut self, dati: &[u8]) -> Result<(), GuastoScrittura> {
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
    fn un_esito_puo_portare_immersioni_e_un_guasto_insieme() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► LE DUE COSE NON SONO IN ALTERNATIVA, ED È TUTTO IL PUNTO. ◄
         *
         * `Result` costringe a scegliere: o le immersioni o l'errore. Per uno
         * scarico via Bluetooth quella scelta è falsa — un backend che
         * consegna le immersioni una per volta può averne date quaranta buone
         * e poi perdere il collegamento — e finché è stata imposta dal tipo,
         * quelle quaranta le buttavamo senza che nessuno lo notasse.
         *
         * Questa prova inchioda la forma, non un comportamento: che si possa
         * dire «è andata male» e «ecco cosa è arrivato» nella stessa frase.
         */
        let esito = EsitoScarico {
            immersioni: vec![ImmersioneGrezza { dati: vec![1, 2, 3], impronta: vec![9] }],
            tradotte: vec![Err("byte di prova".into())],
            dichiarato: None,
            non_aperto: false,
            guasto: Some("il collegamento è caduto".into()),
        };
        assert_eq!(esito.immersioni.len(), 1);
        assert!(esito.guasto.is_some());

        // E `in_risultato` butta via il bottino di proposito: la usano le
        // prove e chi non ha niente da salvare a metà. Se un giorno qualcuno
        // la usasse nello scarico vero, questa riga dice cosa costa.
        let perso = EsitoScarico {
            immersioni: vec![ImmersioneGrezza { dati: vec![1], impronta: vec![] }],
            tradotte: vec![Err("byte di prova".into())],
            dichiarato: None,
            non_aperto: false,
            guasto: Some("rotto".into()),
        };
        assert!(perso.in_risultato().is_err(), "in_risultato sceglie l'errore e perde le immersioni");
    }

    #[test]
    fn un_computer_che_non_si_apre_non_inventa_immersioni() {
        // L'altra metà della forma: quando non è arrivato niente, l'esito deve
        // dirlo con una lista vuota e non con una lista finta.
        let Some(descrittore) = trova_descrittore("Scubapro", "Aladin Sport Matrix") else {
            panic!("il descrittore dell’Aladin Sport Matrix deve esistere");
        };
        let (mittente, ricevente) = std::sync::mpsc::channel::<Vec<u8>>();
        drop(mittente);
        let flusso = FlussoBle::nuovo(ricevente, Box::new(|_| Ok(())));
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
        assert!(esito.guasto.is_some(), "un computer muto non è uno scarico riuscito");
        assert!(esito.immersioni.is_empty(), "{} immersioni dal nulla", esito.immersioni.len());
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
    fn il_computer_si_presenta_e_le_immersioni_si_leggono_col_dispositivo_aperto() {
        /*
         * ► IL MODELLO DICHIARATO ARRIVA, E OGNI IMMERSIONE HA LA SUA LETTURA. ◄
         *
         * Il finto Aladin risponde al comando del modello con 23 — l'Aladin
         * Sport Matrix — e libdivecomputer lo dichiara con `DC_EVENT_DEVINFO`.
         * Qui si guarda che la dichiarazione arrivi fino all'esito, e che le
         * letture fatte col dispositivo aperto siano una per immersione, nello
         * stesso ordine: la lista che il ponte scorre accanto a quella dei byte.
         */
        let descrittore = trova_descrittore("Scubapro", "Aladin Sport Matrix").unwrap();
        let collegamento =
            CollegamentoLdc::apri(Box::new(FintoAladin::nuovo(memoria_con(3, 120)))).unwrap();
        let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
        assert!(esito.guasto.is_none(), "{:?}", esito.guasto);
        assert_eq!(esito.immersioni.len(), 3);
        assert_eq!(esito.tradotte.len(), 3, "una lettura per ogni immersione");
        let dichiarato = esito.dichiarato.expect("il finto Aladin dice il suo modello");
        assert_eq!(dichiarato.modello, 23);
        assert_eq!(dichiarato.modello, descrittore.modello(), "scelto e dichiarato coincidono");
    }

    #[test]
    fn un_modello_scelto_male_si_vede_e_si_sa_dire_quale_era() {
        /*
         * ► LA SCELTA SBAGLIATA, COME SUCCEDE DAVVERO. ◄ Chi ha un Aladin e
         * sceglie «G2» dall'elenco: il backend Uwatec non guarda il descrittore
         * — il modello lo chiede al computer — e lo scarico riesce lo stesso.
         * Fino al 22 settembre 2026 però il LETTORE veniva costruito sul G2, e
         * niente lo diceva. Adesso la dichiarazione arriva, è diversa dalla
         * scelta, e `nome_del_modello` sa dire chi è: è la riga che finisce
         * nel diario.
         */
        let g2 = trova_descrittore("Scubapro", "G2").unwrap();
        assert_ne!(g2.modello(), 23);
        let collegamento =
            CollegamentoLdc::apri(Box::new(FintoAladin::nuovo(memoria_con(2, 120)))).unwrap();
        let esito = collegamento.scarica_tutto(&g2, &[], &|_| {});
        assert!(esito.guasto.is_none(), "{:?}", esito.guasto);
        let dichiarato = esito.dichiarato.expect("il modello dichiarato deve arrivare");
        assert_eq!(dichiarato.modello, 23);
        assert_ne!(dichiarato.modello, g2.modello());
        let (marca, modello) = nome_del_modello(&g2, dichiarato.modello).expect("il 23 ha un nome");
        assert_eq!(marca, "Scubapro");
        assert!(modello.contains("Matrix"), "il 23 è un Aladin Matrix, non «{modello}»");
        // Un numero che la famiglia non ha non si inventa un nome.
        assert!(nome_del_modello(&g2, 0xDEAD).is_none());
        /*
         * ► E UN NUMERO NON È SEMPRE UN NOME SOLO. ◄ Il 23 è l'Aladin Sport
         * Matrix E l'Aladin H Matrix: chi rinomina le immersioni col modello
         * dichiarato deve vedere che qui il numero non basta, e non
         * rinominare. Vedi `modello_dichiarato` nel ponte.
         */
        let tutti = nomi_del_modello(&g2, 23);
        assert!(tutti.len() >= 2, "il 23 ha più di un nome: {tutti:?}");
        let mares = trova_descrittore("Mares", "Quad").unwrap();
        let puck = nomi_del_modello(&mares, 0x35);
        assert!(puck.len() >= 4, "i Puck nuovi sono tutti 0x35: {puck:?}");
        let quad2 = nomi_del_modello(&mares, 0x32);
        assert_eq!(quad2, vec![("Mares".to_string(), "Quad 2".to_string())], "lo 0x32 è solo il Quad 2");
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
    fn un_segnalibro_non_rompe_mai_uno_scarico_nemmeno_quando_e_sbagliato() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► QUELLO CHE SI PUÒ MISURARE DEL SEGNALIBRO, E QUELLO CHE NO. ◄
         *
         * `dc_device_set_fingerprint` dice a libdivecomputer qual è l'ultima
         * immersione che abbiamo già, e serve ad accorciare il trasferimento:
         * senza, ogni scarico rilegge tutta la memoria del computer, comprese
         * le quaranta immersioni che sono già in archivio. Su un collegamento
         * che perde colpi è la leva più forte che esista, perché i byte che non
         * attraversi sono gli unici che non possono rompersi.
         *
         * **Che si fermi prima, qui, non si può dimostrare**, e vale la pena
         * scrivere perché invece di far finta. Per gli Uwatec il filtro non lo
         * fa la libreria: il timestamp viene mandato **al computer**, dentro i
         * parametri di `CMD_SIZE`, ed è il computer a rispondere con le sole
         * immersioni più recenti (`uwatec_smart.c`, `params[0..4]`). Il nostro
         * finto quel parametro lo ignora e restituisce sempre tutta la memoria.
         * Per i Mares invece il confronto è dentro la libreria
         * (`Stopping due to detecting a matching fingerprint`), ma il finto
         * Quad Ci non arriva a servire oggetti di immersione. *Quindi la
         * fermata è verificata leggendo i due sorgenti, non provandola: sta
         * scritto qui perché la prossima persona non creda il contrario.*
         *
         * Quello che invece si misura, ed è la promessa che conta per chi
         * scarica, è che **un segnalibro non possa fare danni**: né quello
         * giusto, né uno di lunghezza sbagliata, né uno che non corrisponde a
         * niente. Un miglioramento che, sbagliando, rompe quello che prima
         * funzionava non è un miglioramento.
         */
        let descrittore = trova_descrittore("Scubapro", "Aladin Sport Matrix").unwrap();

        let tutte = {
            let finto = FintoAladin::nuovo(memoria_con(50, 400));
            let collegamento = CollegamentoLdc::apri(Box::new(finto)).unwrap();
            collegamento.scarica(&descrittore).unwrap()
        };
        assert_eq!(tutte.len(), 50);
        let piu_recente = tutte[0].impronta.clone();
        assert_eq!(piu_recente.len(), 4, "l'Aladin dà impronte da quattro byte");

        // 1. Il segnalibro giusto: lo scarico va, come senza.
        let finto = FintoAladin::nuovo(memoria_con(50, 400));
        let collegamento = CollegamentoLdc::apri(Box::new(finto)).unwrap();
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► E QUI SI GUARDA ANCHE L'AVANZAMENTO, SULLA LIBRERIA VERA. ◄
         *
         * È il solo posto di tutto il progetto dove `dc_device_set_events` può
         * essere provato senza un computer subacqueo attaccato: di là c'è
         * libdivecomputer compilata, e se l'iscrizione all'evento fosse scritta
         * male — la costante sbagliata, la firma della callback sbagliata, lo
         * userdata condiviso male — **niente fallirebbe**. Lo scarico andrebbe
         * benissimo e la barra resterebbe ferma, cioè il difetto tornerebbe
         * esattamente com'era prima della 1.8.18 e nessuna prova se ne
         * accorgerebbe.
         */
        let visti = std::sync::Mutex::new(Vec::<Avanzamento>::new());
        let esito =
            collegamento.scarica_tutto(&descrittore, &piu_recente, &|a| visti.lock().unwrap().push(a));
        assert!(esito.guasto.is_none(), "{:?}", esito.guasto);
        assert_eq!(esito.immersioni.len(), 50);

        let visti = visti.into_inner().unwrap();
        assert!(!visti.is_empty(), "durante uno scarico di cinquanta immersioni non si è detto niente");
        // Le immersioni salgono e arrivano a cinquanta: è il numero chiesto il
        // 12 settembre 2026, «quante immersioni stai scaricando».
        assert_eq!(
            visti.last().map(|a| a.immersioni),
            Some(50),
            "l'ultimo avanzamento deve aver visto tutte le immersioni: {visti:?}"
        );
        assert!(
            visti.windows(2).all(|c| c[1].immersioni >= c[0].immersioni),
            "il conto delle immersioni non può tornare indietro: {visti:?}"
        );
        // E i byte: se `DC_EVENT_PROGRESS` non arrivasse, resterebbero a zero e
        // la barra non avrebbe verso dove andare.
        assert!(
            visti.iter().any(|a| a.byte_totali > 0),
            "la libreria non ha mai detto quanta memoria c'è da leggere: {visti:?}"
        );
        assert!(
            visti.iter().any(|a| a.byte_letti > 0),
            "la libreria non ha mai detto quanta memoria ha letto: {visti:?}"
        );
        // E il segnalibro buono NON lascia la nota: se la lasciasse sempre,
        // la riga non distinguerebbe più niente e il diario mentirebbe.
        let nota = collegamento.guasto.lock().unwrap().clone();
        assert!(
            !nota.as_deref().unwrap_or("").contains("segnalibro"),
            "un segnalibro accettato non si lamenta: {nota:?}"
        );

        /*
         * 2. ► IL CASO CHE FA PAURA: UN SEGNALIBRO DELLA LUNGHEZZA SBAGLIATA. ◄
         *
         * `uwatec_smart_device_set_fingerprint` rifiuta qualunque cosa che non
         * sia quattro byte, e i Mares vogliono la loro misura: un segnalibro
         * conservato per un computer e riproposto a un altro arriva storto.
         * Deve costare **niente** — si scarica tutto, com'era prima che il
         * segnalibro esistesse — e non far fallire lo scarico.
         */
        let finto = FintoAladin::nuovo(memoria_con(50, 400));
        let collegamento = CollegamentoLdc::apri(Box::new(finto)).unwrap();
        let esito = collegamento.scarica_tutto(&descrittore, &[0x01, 0x02, 0x03], &|_| {});
        assert!(esito.guasto.is_none(), "un segnalibro storto non è un guasto: {:?}", esito.guasto);
        assert_eq!(esito.immersioni.len(), 50, "e non deve costare nemmeno un'immersione");
        /*
         * ► MA DEVE LASCIARE UNA TRACCIA, E QUESTA RIGA È L'UNICA COSA CHE
         * INCHIODA LA CHIAMATA ALLA LIBRERIA. ◄ Senza, togliere del tutto
         * `dc_device_set_fingerprint` lascerebbe tutte le prove verdi — cioè il
         * segnalibro potrebbe non essere mai passato a nessuno e nessuno se ne
         * accorgerebbe. *Un miglioramento invisibile è indistinguibile da un
         * miglioramento assente.*
         *
         * E serve anche a chi ripara: uno scarico lungo dove ci si aspettava un
         * lampo, senza questa riga nel diario, manda a cercare il guasto
         * dalla parte sbagliata.
         */
        let nota = collegamento.guasto.lock().unwrap().clone();
        assert!(
            nota.as_deref().is_some_and(|n| n.contains("non ha accettato il segnalibro")),
            "il rifiuto del segnalibro va annotato: {nota:?}"
        );

        // 3. E uno che non corrisponde a niente: non combacia mai, quindi non
        //    ferma niente. Costa inutilità, non dati.
        let finto = FintoAladin::nuovo(memoria_con(50, 400));
        let collegamento = CollegamentoLdc::apri(Box::new(finto)).unwrap();
        let esito = collegamento.scarica_tutto(&descrittore, &[0xde, 0xad, 0xbe, 0xef], &|_| {});
        assert_eq!(esito.immersioni.len(), 50);
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

    // ------------------------------------------------- il finto Mares Quad Ci

    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► LA DOMANDA CHE QUESTO FINTO ESISTE PER RISPONDERE. ◄
     *
     * Il 7 settembre 2026 un Mares Quad Ci prestato da un centro sub ha
     * scaricato per un pezzo e poi si è fermato con «errore di protocollo»,
     * ritentato quattro volte, con una risposta che arrivava a ogni
     * tentativo. Una risposta che arriva ed è **persistentemente rifiutata**
     * lascia solo tre possibilità, e sono scritte in
     * `mares_iconhd_packet_variable`: primo byte diverso da `AA`, ultimo
     * diverso da `EA`, oppure una lunghezza che non torna.
     *
     * La terza è quella che dipende da NOI, ed è misurabile qui: quel ramo del
     * protocollo — quello dei Sirius, Puck 4, Puck Air 2 e **Quad Ci** — legge
     * il pacchetto con UNA sola `dc_iostream_read` e si aspetta di trovarcelo
     * tutto. Non c'è nessun livello che rimetta insieme i pezzi: per gli altri
     * modelli Mares libdivecomputer apre `dc_packet_open(…, 244, 20)`, per
     * questi no. E il nostro trasporto, per una ragione altrettanto solida —
     * il numero di sequenza in testa a ogni notifica degli Uwatec — consegna
     * **al massimo una notifica per lettura**.
     *
     * Quindi: se la risposta del computer non sta in una notifica sola, questo
     * protocollo non può funzionare. Il pacchetto della versione è di 142 byte
     * (`AA` + 140 + `EA`), i segmenti arrivano a 244. Il finto qui sotto
     * risponde davvero come il computer vero, e la dimensione della notifica è
     * il PARAMETRO: si misura dove passa il confine, invece di dedurlo.
     */

    /// Il Mares Quad Ci, per quel tanto che serve a far parlare
    /// `mares_iconhd.c` sul suo ramo BLE a lunghezza variabile.
    ///
    /// Il protocollo: si scrivono due byte `[cmd, cmd ^ 0xA5]`, si legge
    /// `AA <corpo> EA`. Il finto risponde solo al comando della versione — è
    /// il primo, ed è già abbastanza per rispondere alla domanda: se non passa
    /// quello, non passa niente.
    struct FintoQuadCi {
        /// Quanti byte al massimo in una notifica. È il numero sotto esame:
        /// su BLE vale l'MTU negoziato meno tre.
        notifica: usize,
        risposta: VecDeque<Vec<u8>>,
        ricevuto: Vec<u8>,
        /// Quante volte è stato chiesto il pacchetto della versione: serve a
        /// vedere i ritentativi di `mares_iconhd_transfer`.
        versioni_chieste: Arc<Mutex<usize>>,
    }

    impl FintoQuadCi {
        const XOR: u8 = 0xA5;
        const ACK: u8 = 0xAA;
        const END: u8 = 0xEA;
        const CMD_VERSION: u8 = 0xC2;

        fn nuovo(notifica: usize, versioni_chieste: Arc<Mutex<usize>>) -> Self {
            Self { notifica, risposta: VecDeque::new(), ricevuto: Vec::new(), versioni_chieste }
        }

        /// Il pacchetto della versione: 140 byte, con il nome del prodotto a
        /// 0x46 — è lì che `mares_iconhd_get_model` va a cercarlo, e senza il
        /// nome giusto il modello resta zero.
        fn pacchetto_versione() -> Vec<u8> {
            let mut corpo = vec![0u8; 140];
            corpo[0x46..0x46 + 7].copy_from_slice(b"Quad Ci");
            corpo
        }

        /// Impacchetta come il computer vero: `AA` in testa, `EA` in coda, e
        /// poi taglia in notifiche della dimensione dichiarata.
        fn accoda(&mut self, corpo: &[u8]) {
            let mut pacchetto = Vec::with_capacity(corpo.len() + 2);
            pacchetto.push(Self::ACK);
            pacchetto.extend_from_slice(corpo);
            pacchetto.push(Self::END);
            for pezzo in pacchetto.chunks(self.notifica) {
                self.risposta.push_back(pezzo.to_vec());
            }
        }
    }

    impl FlussoByte for FintoQuadCi {
        fn scrivi(&mut self, dati: &[u8]) -> Result<(), GuastoScrittura> {
            self.ricevuto.extend_from_slice(dati);
            while self.ricevuto.len() >= 2 {
                let comando = self.ricevuto[0];
                let controllo = self.ricevuto[1];
                self.ricevuto.drain(..2);
                // Il secondo byte è il primo XOR 0xA5: un comando che non
                // torna non è un comando, e il computer vero non risponde.
                if controllo != comando ^ Self::XOR {
                    continue;
                }
                if comando == Self::CMD_VERSION {
                    *self.versioni_chieste.lock().unwrap() += 1;
                    let versione = Self::pacchetto_versione();
                    self.accoda(&versione);
                }
                // A tutti gli altri comandi non si risponde: dopo la versione
                // la prova non ha più niente da misurare, e il silenzio
                // diventa «tempo scaduto», che è distinguibile da «errore di
                // protocollo» — ed è esattamente la distinzione che serve.
            }
            Ok(())
        }
        fn leggi(&mut self, quanti: usize, _attesa: Duration) -> Result<Vec<u8>, String> {
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

    /// Apre il Quad Ci con notifiche di quella dimensione, e dice com'è andata.
    fn quadci_con_notifiche(dimensione: usize) -> (String, usize) {
        let descrittore =
            trova_descrittore("Mares", "Quad Ci").expect("il descrittore del Quad Ci deve esistere");
        let chieste = Arc::new(Mutex::new(0));
        let finto = FintoQuadCi::nuovo(dimensione, chieste.clone());
        let collegamento = CollegamentoLdc::apri(Box::new(finto)).unwrap();
        let esito = match collegamento.scarica(&descrittore) {
            Ok(_) => "riuscito".to_string(),
            Err(errore) => errore,
        };
        let n = *chieste.lock().unwrap();
        (esito, n)
    }

    #[test]
    fn la_voce_di_libdivecomputer_arriva_al_diario_e_dice_quale_controllo_e_fallito() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL NUMERO DI STATO NON È UNA DIAGNOSI: `-8` SONO SEI GUASTI. ◄
         *
         * Il 9 settembre 2026 sono arrivati due diari veri, e tutte e due le
         * volte ho dovuto risalire alla causa contando i byte scritti — la
         * prima volta ci sono arrivato, la seconda no. Eppure libdivecomputer
         * la causa la **dice**, riga per riga, prima di ogni `return`: dice
         * quale controllo è fallito, con che byte, in che file e a che riga.
         * Finiva su `stderr`, e su un telefono `stderr` non esiste.
         *
         * Questa prova mette il Quad Ci finto — protocollo vero contro la vera
         * `mares_iconhd.c` — in una condizione che fallisce, e pretende che
         * quello che la libreria ha detto sia **recuperabile**, non perso.
         * Non inchioda il testo del messaggio, che è di un'altra squadra e può
         * cambiare col tarball: inchioda che ci sia, che nomini il file da cui
         * viene, e che quel file sia quello del guasto.
         */
        let descrittore =
            trova_descrittore("Mares", "Quad Ci").expect("il descrittore del Quad Ci deve esistere");
        let chieste = Arc::new(Mutex::new(0));
        // 141 byte: uno meno del pacchetto della versione, cioè la condizione
        // già misurata in cui il ramo VARIABILE rifiuta e ritenta.
        let finto = FintoQuadCi::nuovo(141, chieste.clone());
        let collegamento = CollegamentoLdc::apri(Box::new(finto)).unwrap();
        let esito = collegamento.scarica(&descrittore);
        assert!(esito.is_err(), "con notifiche da 141 byte lo scarico deve fallire");

        let righe = collegamento.righe_della_libreria();
        assert!(
            !righe.is_empty(),
            "libdivecomputer ha parlato e non l'abbiamo raccolta: il diario resta col solo numero"
        );
        assert!(
            righe.iter().any(|r| r.contains("mares_iconhd.c:")),
            "una riga deve dire da QUALE file e riga viene, perché lo stesso messaggio esce da posti \
             diversi che chiedono rimedi opposti: {righe:?}"
        );
        assert!(
            righe.iter().any(|r| r.contains("libdivecomputer, errore")),
            "gli errori vanno etichettati come tali: {righe:?}"
        );
    }

    #[test]
    fn il_diario_della_libreria_tiene_le_ultime_righe_e_conta_quelle_scartate() {
        /*
         * Le righe che contano sono **le ultime**: l'errore che chiude lo
         * scarico è l'ultimo che la libreria stampa prima di arrendersi. Ma
         * chi legge deve sapere che ce n'erano altre prima, o crederà di avere
         * tutta la storia. *È lo stesso motivo per cui il riassunto dello
         * scambio dice «altre N» invece di tacere.*
         */
        let contesto = Contesto::nuovo_con_diario().unwrap();
        let diario = contesto.1.as_ref().expect("il contesto col diario ha il diario");
        let userdata = &**diario as *const DiarioDellaLibreria as *mut c_void;
        let file = std::ffi::CString::new("/percorso/lungo/di/chi/ha/compilato/mares_iconhd.c").unwrap();
        for n in 0..(RIGHE_DI_LIBDIVECOMPUTER + 3) {
            let messaggio = std::ffi::CString::new(format!("guasto numero {n}")).unwrap();
            cb_log(std::ptr::null_mut(), 1, file.as_ptr(), 42, std::ptr::null(), messaggio.as_ptr(), userdata);
        }
        let righe = contesto.righe_della_libreria();
        assert_eq!(righe.len(), RIGHE_DI_LIBDIVECOMPUTER + 1, "{righe:?}");
        assert!(righe[0].contains("altre 3 righe prima"), "{righe:?}");
        assert!(righe.last().unwrap().contains("guasto numero 16"), "{righe:?}");
        assert!(
            !righe.last().unwrap().contains("/percorso/lungo/"),
            "il percorso di compilazione è della macchina che ha costruito il pacchetto, \
             non dice niente a chi legge: {righe:?}"
        );
        assert!(righe.last().unwrap().contains("mares_iconhd.c:42"), "{righe:?}");
    }

    /// Un Quad Ci che, alla scrittura numero `inciampa`, lascia scadere la
    /// conferma invece di rispondere. È il guasto vero del 9 settembre 2026.
    struct QuadCiCheInciampa {
        dentro: FintoQuadCi,
        scritture: usize,
        inciampa: usize,
        /// Se il guasto è una conferma scaduta o un rifiuto: è l'unica
        /// differenza sotto esame.
        scaduta: bool,
    }

    impl FlussoByte for QuadCiCheInciampa {
        fn scrivi(&mut self, dati: &[u8]) -> Result<(), GuastoScrittura> {
            self.scritture += 1;
            if self.scritture == self.inciampa {
                let motivo = "la scrittura sul Bluetooth non è stata confermata entro dieci secondi";
                return Err(if self.scaduta {
                    GuastoScrittura::Scaduta(motivo.into())
                } else {
                    GuastoScrittura::Rifiutata("il Bluetooth ha rifiutato la scrittura".into())
                });
            }
            self.dentro.scrivi(dati)
        }
        fn leggi(&mut self, quanti: usize, attesa: Duration) -> Result<Vec<u8>, String> {
            self.dentro.leggi(quanti, attesa)
        }
        fn disponibili(&mut self) -> usize {
            self.dentro.disponibili()
        }
    }

    #[test]
    fn una_conferma_scaduta_lascia_ritentare_e_lo_scarico_va_avanti() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL GUASTO VERO, RIPRODOTTO. ◄
         *
         * 9 settembre 2026, Mares Quad Ci di un amico del proprietario: **276
         * KB scaricati**, 1224 scambi perfetti, e poi la scrittura n. 1226 —
         * due byte — non viene confermata dal Bluetooth entro dieci secondi.
         * Lo scarico muore lì, e non salva niente.
         *
         * Il difetto non era la scrittura mancata: era la RISPOSTA che il
         * trasporto dava a libdivecomputer. «Errore di trasmissione» è un
         * verdetto definitivo, e `mares_iconhd_transfer` ritenta solo su
         * `PROTOCOL` e `TIMEOUT`: su tutto il resto si arrende subito. Una
         * conferma che non arriva però **non dice che la scrittura sia
         * fallita**: dice che non si sa. E «non si sa» è esattamente il caso
         * in cui il backend sa cosa fare — dormire un secondo, svuotare,
         * rimandare il comando — se solo glielo si lascia fare.
         *
         * Qui la stessa identica situazione, con l'unica differenza che
         * conta: come viene chiamato il guasto.
         */
        let descrittore = trova_descrittore("Mares", "Quad Ci").unwrap();

        // Scaduta: il primo comando inciampa, `mares_iconhd_transfer` ritenta,
        // e la versione passa lo stesso. Lo scarico prosegue e si ferma più in
        // là — per «tempo scaduto», perché questo finto dopo la versione non
        // risponde ad altro.
        let chieste = Arc::new(Mutex::new(0usize));
        let inciampa = QuadCiCheInciampa {
            dentro: FintoQuadCi::nuovo(244, chieste.clone()),
            scritture: 0,
            inciampa: 1,
            scaduta: true,
        };
        let collegamento = CollegamentoLdc::apri(Box::new(inciampa)).unwrap();
        let esito = match collegamento.scarica(&descrittore) {
            Ok(_) => panic!("questo finto non arriva mai a consegnare immersioni"),
            Err(e) => e,
        };
        assert!(
            esito.contains("stato -7"),
            "dopo il ritentativo la versione passa, e ci si ferma dove si fermerebbe comunque: {esito}"
        );
        assert!(
            *chieste.lock().unwrap() >= 1,
            "la versione è stata chiesta davvero, dopo l'inciampo"
        );

        /*
         * ► E IL GEMELLO, CHE È QUELLO CHE DÀ SENSO AL PRIMO. ◄ Un RIFIUTO —
         * il plugin che dice di no subito — resta definitivo: ritentare la
         * stessa identica scrittura darebbe lo stesso identico esito, e un
         * giro di ritentativi su un collegamento che non c'è più è solo tempo
         * tolto a chi aspetta. Se anche questo caso diventasse «tempo
         * scaduto», la correzione qui sopra non sarebbe una distinzione:
         * sarebbe una resa.
         */
        let chieste = Arc::new(Mutex::new(0usize));
        let rifiutato = QuadCiCheInciampa {
            dentro: FintoQuadCi::nuovo(244, chieste.clone()),
            scritture: 0,
            inciampa: 1,
            scaduta: false,
        };
        let collegamento = CollegamentoLdc::apri(Box::new(rifiutato)).unwrap();
        let esito = match collegamento.scarica(&descrittore) {
            Ok(_) => panic!("una scrittura rifiutata non può portare a uno scarico riuscito"),
            Err(e) => e,
        };
        assert!(esito.contains("stato -6"), "un rifiuto resta un errore di trasmissione: {esito}");
        assert_eq!(*chieste.lock().unwrap(), 0, "e non si ritenta niente");
    }

    #[test]
    fn il_pacchetto_del_mares_deve_stare_in_una_notifica_sola() {
        /*
         * ► IL CONFINE, MISURATO. ◄ Il pacchetto della versione è di 142 byte:
         * `AA`, centoquaranta di corpo, `EA`. Con notifiche capaci di
         * contenerlo, libdivecomputer lo accetta e va avanti — e si ferma più
         * in là per «tempo scaduto», perché questo finto non risponde ad
         * altro. Con notifiche più corte lo stesso identico pacchetto diventa
         * «errore di protocollo», e viene ritentato quattro volte prima di
         * arrendersi: è la firma esatta di quello che ha fatto il Quad Ci del
         * centro sub.
         *
         * Questa prova non dice che il difetto del 7 settembre sia questo:
         * dice che questo difetto **esiste**, che ha esattamente quella
         * firma, e che dipende da un numero — la dimensione della notifica —
         * che nessuno stava misurando. Per quello adesso il riassunto dello
         * scambio la scrive.
         */
        let (largo, chieste_largo) = quadci_con_notifiche(244);
        assert!(
            largo.contains("stato -7") || largo.contains("tempo scaduto"),
            "con una notifica capiente la versione passa, e ci si ferma dopo: {largo}"
        );
        assert_eq!(chieste_largo, 1, "e la versione si chiede una volta sola");

        let (stretto, chieste_stretto) = quadci_con_notifiche(100);
        assert!(
            stretto.contains("stato -8") || stretto.contains("protocollo"),
            "con una notifica corta lo stesso pacchetto è un errore di protocollo: {stretto}"
        );
        assert_eq!(
            chieste_stretto, 5,
            "e viene ritentato quattro volte, come dice MAXRETRIES in mares_iconhd.c"
        );
    }

    /// Lo stesso finto Quad Ci, ma dietro un `FlussoBle` vero — cioè con il
    /// canale delle notifiche in mezzo, che è dov'è il riassemblaggio.
    fn quadci_dietro_il_flusso(dimensione: usize, come: Riassemblaggio) -> (String, usize) {
        let descrittore =
            trova_descrittore("Mares", "Quad Ci").expect("il descrittore del Quad Ci deve esistere");
        let chieste = Arc::new(Mutex::new(0usize));
        let (manda, ricevi) = channel();
        let per_chiusura = chieste.clone();
        let mut ricevuto: Vec<u8> = Vec::new();
        let scrittura = move |dati: &[u8]| -> Result<(), GuastoScrittura> {
            ricevuto.extend_from_slice(dati);
            while ricevuto.len() >= 2 {
                let comando = ricevuto[0];
                let controllo = ricevuto[1];
                ricevuto.drain(..2);
                if controllo != comando ^ FintoQuadCi::XOR || comando != FintoQuadCi::CMD_VERSION {
                    continue;
                }
                *per_chiusura.lock().unwrap() += 1;
                let corpo = FintoQuadCi::pacchetto_versione();
                let mut pacchetto = Vec::with_capacity(corpo.len() + 2);
                pacchetto.push(FintoQuadCi::ACK);
                pacchetto.extend_from_slice(&corpo);
                pacchetto.push(FintoQuadCi::END);
                // Una notifica per pezzo, come il Bluetooth vero quando il
                // messaggio non sta nell'MTU.
                for pezzo in pacchetto.chunks(dimensione) {
                    let _ = manda.send(pezzo.to_vec());
                }
            }
            Ok(())
        };
        let flusso = FlussoBle::nuovo(ricevi, Box::new(scrittura)).con_riassemblaggio(come);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        let esito = match collegamento.scarica(&descrittore) {
            Ok(_) => "riuscito".to_string(),
            Err(errore) => errore,
        };
        let n = *chieste.lock().unwrap();
        (esito, n)
    }

    #[test]
    fn il_riassemblaggio_rimette_insieme_il_pacchetto_spezzato_del_mares() {
        /*
         * ► LA CORREZIONE, MISURATA CONTRO LO STESSO FINTO CHE HA MOSTRATO IL
         * DIFETTO. ◄
         *
         * Notifiche da cento byte, pacchetto da centoquarantadue: spezzato in
         * due. Con la politica di prima — una notifica per lettura — è «errore
         * di protocollo» ritentato quattro volte. Con il riassemblaggio è lo
         * stesso pacchetto, intero, e si passa oltre: l'errore che resta è
         * «tempo scaduto», perché questo finto dopo la versione non risponde
         * più a niente.
         *
         * Le due righe qui sotto sono la stessa situazione con l'unica
         * differenza che conta.
         */
        let (senza, chieste_senza) = quadci_dietro_il_flusso(100, Riassemblaggio::UnaNotifica);
        assert!(senza.contains("stato -8"), "senza riassemblaggio: protocollo. {senza}");
        assert_eq!(chieste_senza, 5, "e quattro ritentativi");

        let (con, chieste_con) = quadci_dietro_il_flusso(100, Riassemblaggio::PacchettoIntero);
        assert!(con.contains("stato -7"), "con il riassemblaggio la versione passa: {con}");
        assert_eq!(chieste_con, 1, "e non c'è niente da ritentare");
    }

    #[test]
    fn il_riassemblaggio_non_cambia_niente_quando_il_pacchetto_gia_ci_stava() {
        // La stessa politica su un apparecchio che non spezza: deve
        // comportarsi come prima, e non aspettare frammenti che non ci sono.
        let (con, chieste) = quadci_dietro_il_flusso(244, Riassemblaggio::PacchettoIntero);
        assert!(con.contains("stato -7"), "{con}");
        assert_eq!(chieste, 1);
    }

    #[test]
    fn unire_le_notifiche_e_una_scelta_e_non_il_comportamento_per_difetto() {
        /*
         * ► LA GUARDIA CHE PROTEGGE GLI UWATEC. ◄ Se il riassemblaggio
         * diventasse il comportamento per difetto, gli Aladin scaricherebbero
         * una memoria disallineata **senza nessun errore**: il byte di
         * sequenza in testa a ogni notifica finirebbe dentro i dati. Il
         * sintomo sarebbe «zero immersioni» dopo un trasferimento riuscito.
         *
         * Qui si prova la cosa a monte di tutte: un flusso appena costruito
         * consegna una notifica per volta, e due notifiche non si uniscono mai
         * da sole.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        manda.send(vec![0xf7, 1, 2, 3]).unwrap();
        manda.send(vec![0x14, 4, 5, 6]).unwrap();
        let primo = flusso.leggi(100, Duration::from_millis(50)).unwrap();
        assert_eq!(primo, vec![0xf7, 1, 2, 3], "una notifica, non due unite");
        let secondo = flusso.leggi(100, Duration::from_millis(50)).unwrap();
        assert_eq!(secondo, vec![0x14, 4, 5, 6]);

        // E con il riassemblaggio acceso, le stesse due si uniscono: è la
        // differenza che rende la scelta una scelta.
        let (manda, ricevi) = channel();
        let mut unito = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        manda.send(vec![0xf7, 1, 2, 3]).unwrap();
        manda.send(vec![0x14, 4, 5, 6]).unwrap();
        assert_eq!(
            unito.leggi(100, Duration::from_millis(50)).unwrap(),
            vec![0xf7, 1, 2, 3, 0x14, 4, 5, 6]
        );
    }

    /// Un pacchetto della famiglia Pelagic: `CD <bandiera> <comando> <crc> <len>`.
    ///
    /// Il checksum qui è finto e non importa: questo livello la lunghezza la
    /// legge e il checksum no — lo verifica `pelagic_i330r.c`, che è dall'altra
    /// parte. Mettercelo vero farebbe credere che la prova misuri anche quello.
    fn pacchetto_pelagic(comando: u8, carico: &[u8]) -> Vec<u8> {
        let mut p = vec![0xCD, 0x80, comando, 0x00, carico.len() as u8];
        p.extend_from_slice(carico);
        p
    }

    fn flusso_pelagic() -> (std::sync::mpsc::Sender<Vec<u8>>, FlussoBle) {
        let (manda, ricevi) = channel();
        let flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::LunghezzaDichiarata);
        (manda, flusso)
    }

    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► LA SEGNALAZIONE DEL 16 SETTEMBRE 2026, DA UN AQUALUNG i330R. ◄
     *
     * Quaranta immersioni arrivate, poi «Invalid packet length (96)» da
     * `pelagic_i330r.c:214`, che è `if (length + 5 > transferred)`. Il pacchetto
     * dichiarava 96 byte di carico — 101 in tutto — e il trasporto ne aveva
     * consegnati meno: la radio l'aveva spezzato in due e la politica in uso,
     * «una notifica per lettura», non li rimette insieme.
     *
     * Il numero 96 non è scelto a caso: è quello del diario.
     */
    #[test]
    fn il_pacchetto_spezzato_in_due_notifiche_arriva_intero() {
        let intero = pacchetto_pelagic(0x0d, &[0xAB; 96]);
        assert_eq!(intero.len(), 101, "è il pacchetto pieno del diario");

        let (manda, mut flusso) = flusso_pelagic();
        manda.send(intero[..96].to_vec()).unwrap();
        manda.send(intero[96..].to_vec()).unwrap();

        // 260 è quello che chiede `pelagic_i330r.c`: MAXPACKET + 5.
        let letto = flusso.leggi(260, Duration::from_millis(50)).unwrap();
        assert_eq!(letto, intero, "il pacchetto va consegnato tutto, in una lettura sola");
    }

    #[test]
    fn e_con_la_politica_di_prima_ne_arrivavano_novantasei() {
        /*
         * ► LA MISURA DEL DIFETTO. ◄ La stessa identica radio, con la politica
         * che c'era: la lettura consegna 96 byte davanti a un pacchetto che ne
         * dichiara 101, ed è esattamente il numero che l'utente ha letto nel
         * suo diario. Se un giorno questa diventasse verde con 101, vorrebbe
         * dire che `UnaNotifica` ha smesso di essere «una notifica».
         */
        let intero = pacchetto_pelagic(0x0d, &[0xAB; 96]);
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        manda.send(intero[..96].to_vec()).unwrap();
        manda.send(intero[96..].to_vec()).unwrap();

        let letto = flusso.leggi(260, Duration::from_millis(50)).unwrap();
        assert_eq!(letto.len(), 96, "è il «Invalid packet length (96)» del 16 settembre");
        assert_eq!(letto[4], 96, "e la lunghezza che il pacchetto dichiarava era 96");
    }

    #[test]
    fn due_pacchetti_attaccati_non_si_incollano() {
        /*
         * ► IL DANNO PEGGIORE DEI DUE, perché non dà nessun errore. ◄
         *
         * Chi riceve legge la lunghezza del PRIMO pacchetto, prende quei byte e
         * butta il resto. Il secondo sparisce in silenzio, e il sintomo compare
         * molto dopo come dati che non si tengono insieme — nel diario del
         * 16 settembre, dodici avvisi «Profiles are not continuous» di fila.
         */
        let primo = pacchetto_pelagic(0x0d, &[1, 2, 3]);
        let secondo = pacchetto_pelagic(0x0d, &[4, 5]);
        let mut insieme = primo.clone();
        insieme.extend_from_slice(&secondo);

        let (manda, mut flusso) = flusso_pelagic();
        manda.send(insieme).unwrap();

        assert_eq!(flusso.leggi(260, Duration::from_millis(50)).unwrap(), primo);
        assert_eq!(
            flusso.leggi(260, Duration::from_millis(50)).unwrap(),
            secondo,
            "il secondo non si butta: resta in cassa per la lettura dopo"
        );
    }

    #[test]
    fn il_pacchetto_cominciato_in_coda_a_un_altro_si_aspetta_anche_dalla_cassa() {
        /*
         * ► IL CASO CHE LA CASSA NON SAPEVA FINIRE. ◄
         *
         * Una notifica porta un pacchetto intero E l'inizio del successivo — un
         * ponte che riempie le notifiche con quello che ha nel buffer lo fa — e
         * il resto del secondo arriva con la notifica dopo. La prima lettura
         * consegna il primo e tiene l'inizio del secondo in cassa. La seconda
         * lettura trova la cassa piena e non aspetta niente: prima di questa
         * prova consegnava il pezzo così com'era, e la libreria rispondeva
         * «Invalid packet length». Il pacchetto dichiara la sua lunghezza anche
         * quando comincia in cassa.
         */
        let primo = pacchetto_pelagic(0x0d, &[1, 2, 3]);
        let secondo = pacchetto_pelagic(0x0d, &[4, 5, 6, 7, 8]);
        let mut notifica_uno = primo.clone();
        notifica_uno.extend_from_slice(&secondo[..3]);
        let notifica_due = secondo[3..].to_vec();

        let (manda, mut flusso) = flusso_pelagic();
        // Tutte e due già arrivate: la differenza fra prima e dopo la
        // correzione non è l'attesa, è che la seconda lettura GUARDI se il
        // resto del pacchetto c'è, invece di consegnare la cassa com'è.
        manda.send(notifica_uno).unwrap();
        manda.send(notifica_due).unwrap();

        assert_eq!(flusso.leggi(260, Duration::from_millis(500)).unwrap(), primo);
        assert_eq!(
            flusso.leggi(260, Duration::from_millis(500)).unwrap(),
            secondo,
            "il secondo si aspetta intero anche se è cominciato nella notifica del primo"
        );
    }

    #[test]
    fn col_filtro_un_pacchetto_che_risponde_a_un_altro_comando_si_butta() {
        /*
         * La coda di una lettura vecchia che arriva DOPO il primo comando: un
         * `CMD_READ_FLASH` (0x0D) mentre si aspetta la risposta alla richiesta
         * d'accesso (0xFA). Senza filtro arriva alla libreria, che si ferma;
         * col filtro si butta, si conta, e la risposta vera passa.
         */
        let domanda = pacchetto_pelagic(0xFA, &[0; 9]);
        let vecchio = pacchetto_pelagic(0x0D, &[0xAA; 96]);
        let risposta = pacchetto_pelagic(0xFA, &[1]);

        let (manda, flusso) = flusso_pelagic();
        let mut flusso = flusso.con_filtro_del_comando();
        flusso.scrivi(&domanda).unwrap();
        manda.send(vecchio.clone()).unwrap();
        manda.send(risposta.clone()).unwrap();
        assert_eq!(flusso.leggi(260, Duration::from_millis(200)).unwrap(), risposta);
        assert_eq!(flusso.pacchetti_estranei(), (1, vecchio.len()));

        // Senza filtro, lo stesso pacchetto arriva alla libreria com'è: è la
        // forma che il 22 settembre ha fermato lo scarico.
        let (manda, mut senza) = flusso_pelagic();
        senza.scrivi(&domanda).unwrap();
        manda.send(vecchio.clone()).unwrap();
        assert_eq!(senza.leggi(260, Duration::from_millis(200)).unwrap(), vecchio);
        assert_eq!(senza.pacchetti_estranei(), (0, 0));
    }

    #[test]
    fn prima_del_primo_comando_il_filtro_non_sa_cosa_aspettarsi_e_non_butta() {
        // Senza un comando scritto non c'è niente con cui confrontare: il
        // filtro tace, e quello che arriva prima di parlare lo gestisce
        // l'ascolto iniziale, che ha le sue regole.
        let (manda, flusso) = flusso_pelagic();
        let mut flusso = flusso.con_filtro_del_comando();
        let pacchetto = pacchetto_pelagic(0x0D, &[1, 2, 3]);
        manda.send(pacchetto.clone()).unwrap();
        assert_eq!(flusso.leggi(260, Duration::from_millis(200)).unwrap(), pacchetto);
        assert_eq!(flusso.pacchetti_estranei(), (0, 0));
    }

    #[test]
    fn un_pacchetto_intero_non_si_tira_dietro_quello_dopo() {
        /*
         * ► IL CASO CHE `PacchettoIntero` SBAGLIA, e per cui questa politica
         *   esiste invece di riusare quella. ◄
         *
         * Quella unisce «finché ogni notifica arriva piena», dove «piena» vuol
         * dire «grande come la più grande vista finora». Un pacchetto completo
         * da 101 byte che è anche il più grande soddisfa la condizione: si
         * aspetta un seguito che non esiste, e se nel frattempo arriva il
         * pacchetto DOPO, se lo tira dentro.
         *
         * Le due metà di questa prova sono la stessa radio con l'unica
         * differenza che conta.
         */
        let grande = pacchetto_pelagic(0x0d, &[0xAB; 96]);
        let piccolo = pacchetto_pelagic(0xfa, &[0x01, 0x00]);

        let (manda, ricevi) = channel();
        let mut vecchia = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        manda.send(grande.clone()).unwrap();
        manda.send(piccolo.clone()).unwrap();
        let incollato = vecchia.leggi(260, Duration::from_millis(50)).unwrap();
        assert_eq!(
            incollato.len(),
            grande.len() + piccolo.len(),
            "con la regola del trasporto i due si incollano: {incollato:?}"
        );

        let (manda, mut nuova) = flusso_pelagic();
        manda.send(grande.clone()).unwrap();
        manda.send(piccolo.clone()).unwrap();
        assert_eq!(nuova.leggi(260, Duration::from_millis(50)).unwrap(), grande);
        assert_eq!(nuova.leggi(260, Duration::from_millis(50)).unwrap(), piccolo);
    }

    #[test]
    fn fuori_sincronia_si_consegna_e_si_lascia_dire_alla_libreria() {
        /*
         * Un avanzo che non comincia per `CD` non è un pacchetto a metà: è un
         * avanzo fuori sincronia. Tenerselo qui per «riallinearsi» vorrebbe dire
         * fermarsi ad aspettare frammenti a ogni lettura fino alla fine dello
         * scarico, e nascondere l'unica informazione utile — che
         * `pelagic_i330r.c` dà per intero: «Unexpected packet start byte (%02x)»,
         * col byte che ha trovato.
         */
        let (manda, mut flusso) = flusso_pelagic();
        manda.send(vec![0x11, 0x22, 0x33]).unwrap();
        assert_eq!(
            flusso.leggi(260, Duration::from_millis(50)).unwrap(),
            vec![0x11, 0x22, 0x33]
        );
    }

    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► IL DIARIO DEL 22 SETTEMBRE 2026, DA UN AQUALUNG i330R. ◄
     *
     *     scrittura n. 1: 14 byte [cd 40 fa f6 09 00 00 00 …], senza conferma
     *     prima notifica: 101 byte [cd a0 0d 82 60 aa aa aa …], 1 ms dopo la prima scrittura
     *     libdivecomputer, errore: Unexpected packet command byte (0d). [pelagic_i330r.c:207]
     *
     * La richiesta d'accesso è partita, e la prima cosa arrivata è stata un
     * pacchetto di lettura della memoria che nessuno aveva chiesto: la coda di
     * una lettura rimasta a metà, che il computer ha svuotato appena gli si è
     * riaperto il canale. Il racconto intero sta su
     * `FlussoBle::ascolta_prima_di_parlare`; qui ci sono le prove, e la prima
     * è che i byte del diario siano davvero quello che si dice che siano.
     */

    /// Il checksum dei pacchetti Pelagic, lo stesso di `pelagic_i330r.c`.
    ///
    /// Qui serve VERO, al contrario di `pacchetto_pelagic`: dall'altra parte
    /// delle prove che seguono c'è la libreria, e la libreria lo verifica.
    fn checksum_pelagic(dati: &[u8]) -> u8 {
        let mut c: u32 = 0;
        for &x in dati {
            let a = c ^ x as u32;
            let b = (a >> 7) ^ ((a >> 4) ^ a);
            c = ((b << 4) & 0xFF) ^ ((b << 1) & 0xFF);
        }
        (c & 0xFF) as u8
    }

    /// Un pacchetto Pelagic intero, col checksum giusto.
    fn pacchetto_i330r(bandiera: u8, comando: u8, carico: &[u8]) -> Vec<u8> {
        let mut p = vec![0xCD, bandiera, comando, 0x00, carico.len() as u8];
        p.extend_from_slice(carico);
        p[3] = checksum_pelagic(&p);
        p
    }

    /// La coda della lettura rimasta a metà: novantasei byte di `0xAA`.
    fn coda_del_22_settembre() -> Vec<u8> {
        pacchetto_i330r(0xA0, 0x0D, &[0xAA; 96])
    }

    #[test]
    fn i_byte_del_diario_sono_una_lettura_della_memoria_intera_e_non_rumore() {
        /*
         * ► LA MISURA PRIMA DELLA DIAGNOSI. ◄ Se il pacchetto arrivato fosse
         * spazzatura della radio, buttarlo sarebbe coprire un guasto. Non lo è:
         * il checksum `0x82` del diario è ESATTAMENTE quello che si calcola su
         * `CD A0 0D · 60` più novantasei `0xAA`. Un pacchetto di
         * `CMD_READ_FLASH` intero, arrivato in una conversazione che non ne
         * aveva chiesto nessuno.
         *
         * E la nostra scrittura è la richiesta d'accesso, byte per byte: lo
         * stesso `f6` del diario.
         */
        let coda = coda_del_22_settembre();
        assert_eq!(&coda[..8], &[0xcd, 0xa0, 0x0d, 0x82, 0x60, 0xaa, 0xaa, 0xaa]);
        assert_eq!(coda.len(), 101, "le notifiche del diario erano da 101 byte");
        let richiesta = pacchetto_i330r(0x40, 0xFA, &[0; 9]);
        assert_eq!(&richiesta[..8], &[0xcd, 0x40, 0xfa, 0xf6, 0x09, 0x00, 0x00, 0x00]);
        assert_eq!(richiesta.len(), 14, "la scrittura del diario era da 14 byte");
    }

    /// Il codice di accesso conservato da uno scarico precedente: con questo
    /// `pelagic_i330r_init` salta il PIN e va dritto alla richiesta d'accesso,
    /// come nel diario.
    struct ChiaveConservata;

    impl AccessoriBle for ChiaveConservata {
        fn nome(&mut self) -> Option<String> {
            None
        }
        fn leggi_caratteristica(&mut self, _uuid: [u8; 16]) -> Result<Vec<u8>, String> {
            Err("il finto non ha caratteristiche da leggere".into())
        }
        fn codice_accesso(&mut self) -> Option<Vec<u8>> {
            Some(vec![0x5A; 16])
        }
    }

    /// I comandi che il finto ha ricevuto, come `(comando, bandiera)`.
    type Comandi = Arc<Mutex<Vec<(u8, u8)>>>;

    /**
     * Un i330R finto, quanto basta per arrivare in fondo all'apertura:
     * richiesta d'accesso, risveglio, autenticazione. Alla calibrazione dice di
     * no, e la prova si ferma lì — tutto quello che si prova sta prima.
     *
     * Due cose del finto vengono dal diario e non sono decorazioni:
     *
     *  - **la coda esce da sola**, venti millisecondi dopo l'apertura del
     *    canale, senza aspettare nessun comando: nel diario è arrivata un
     *    millisecondo dopo la prima scrittura, cioè prima che la scrittura
     *    potesse arrivare al computer;
     *  - **ogni risposta arriva un giro di radio dopo la domanda**, e mai nello
     *    stesso istante. È quello che mette la coda davanti alla risposta vera,
     *    come è successo.
     */
    fn finto_i330r(coda: Vec<Vec<u8>>, ascolta: bool) -> (FlussoBle, Comandi) {
        let (manda, ricevi) = channel::<Vec<u8>>();
        let comandi: Comandi = Arc::new(Mutex::new(Vec::new()));

        let manda_coda = manda.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            for pacchetto in coda {
                let _ = manda_coda.send(pacchetto);
            }
        });

        let visti = comandi.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            let (bandiera, comando) = (dati[1], dati[2]);
            visti.lock().unwrap().push((comando, bandiera));
            let risposte = match (comando, bandiera) {
                // Richiesta d'accesso, prima e seconda metà: RSP_READY e RSP_DONE.
                (0xFA, 0x40) => vec![pacchetto_i330r(0xC0, 0xFA, &[1])],
                (0xFA, 0x80) => vec![pacchetto_i330r(0xC0, 0xFA, &[2])],
                // Il risveglio restituisce sedici byte di identità; il modello
                // sta nei byte 12 e 13, e 0x4744 è l'i330R del catalogo.
                (0x22, _) => {
                    let mut id = [0u8; 16];
                    id[12] = 0x47;
                    id[13] = 0x44;
                    vec![pacchetto_i330r(0x80, 0x22, &id), pacchetto_i330r(0xC0, 0x22, &[2])]
                }
                (0x97, _) => vec![pacchetto_i330r(0xC0, 0x97, &[1])],
                // Tutto il resto: un rifiuto, che ferma la libreria qui.
                _ => vec![pacchetto_i330r(0xC0, comando, &[9])],
            };
            let manda = manda.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(80));
                for pacchetto in risposte {
                    let _ = manda.send(pacchetto);
                }
            });
            Ok(())
        });

        let mut flusso = FlussoBle::nuovo(ricevi, scrittura)
            .con_accessori(Box::new(ChiaveConservata), Box::new(|| Ripiego::Esaurito))
            .con_riassemblaggio(Riassemblaggio::LunghezzaDichiarata);
        if ascolta {
            flusso = flusso.con_ascolto_iniziale(SILENZIO_PRIMA_DI_PARLARE, TETTO_PRIMA_DI_PARLARE);
        }
        (flusso, comandi)
    }

    #[test]
    fn la_coda_di_una_lettura_a_meta_fermava_la_richiesta_d_accesso() {
        /*
         * ► LA MISURA DEL DIFETTO, sulla libreria vera. ◄ Senza ascolto
         * iniziale il finto rifà il diario: un comando solo — la richiesta
         * d'accesso — e la libreria che si ferma sul primo pacchetto della
         * coda. Se un giorno questa diventasse verde con più di un comando,
         * vorrebbe dire che `pelagic_i330r.c` ha imparato a saltare i pacchetti
         * estranei, e l'ascolto iniziale andrebbe riconsiderato.
         */
        let descrittore = trova_descrittore("Aqualung", "i330R").expect("il descrittore dell'i330R deve esistere");
        let (flusso, comandi) = finto_i330r(vec![coda_del_22_settembre(), coda_del_22_settembre()], false);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        assert!(collegamento.scarica(&descrittore).is_err());
        assert_eq!(*comandi.lock().unwrap(), vec![(0xFA, 0x40)], "si ferma alla richiesta d'accesso");
        let righe = collegamento.righe_della_libreria();
        assert!(
            righe.iter().any(|r| r.contains("pelagic_i330r.c:") && r.contains("(0d)")),
            "la libreria deve dire il comando estraneo che ha trovato, come nel diario: {righe:?}"
        );
    }

    #[test]
    fn con_l_ascolto_iniziale_la_coda_si_butta_e_l_apertura_va_avanti() {
        /*
         * Lo stesso finto, la stessa coda, con l'ascolto che il ponte accende
         * per la famiglia Pelagic. La coda arriva mentre si aspetta il
         * silenzio, si butta, e la richiesta d'accesso trova la sua risposta:
         * dopo passano il risveglio e l'autenticazione, e la libreria si
         * ferma solo dove il finto dice di no apposta, alla calibrazione.
         */
        let descrittore = trova_descrittore("Aqualung", "i330R").expect("il descrittore dell'i330R deve esistere");
        let (flusso, comandi) = finto_i330r(vec![coda_del_22_settembre(), coda_del_22_settembre()], true);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        assert!(collegamento.scarica(&descrittore).is_err(), "il finto rifiuta la calibrazione apposta");
        assert_eq!(
            *comandi.lock().unwrap(),
            vec![(0xFA, 0x40), (0xFA, 0x80), (0x22, 0x40), (0x97, 0x40), (0x27, 0x40)],
            "accesso, risveglio e autenticazione devono passare"
        );
        let righe = collegamento.righe_della_libreria();
        assert!(
            !righe.iter().any(|r| r.contains("Unexpected packet command byte")),
            "nessun pacchetto estraneo deve arrivare alla libreria: {righe:?}"
        );
        let misure = collegamento.misure_lettura();
        assert_eq!((misure.scartate_prima, misure.byte_scartati_prima), (2, 202));
        let riga = collegamento.riga_delle_letture().expect("ci sono state letture");
        assert!(
            riga.contains("arrivate prima del primo comando e buttate: 2 notifiche (202 byte)"),
            "il diario deve dirlo, o la prossima segnalazione non saprà che è successo: {riga}"
        );
    }

    /// Un i330R che la chiave conservata non la riconosce più: azzerato, o
    /// accoppiato con un altro telefono. Risponde come dice il commit della
    /// libreria che ha insegnato a gestirlo (`6026d96`, «Handle an invalid
    /// access code response»): codice d'errore 13, e un PIN nuovo sul display.
    struct I330rCheHaCambiatoChiave {
        valida: [u8; 16],
        pin: [u8; 6],
    }

    /// La persona davanti allo schermo: sa leggere il PIN, e la chiave che ha
    /// in tasca è vecchia.
    struct ChiInTascaHaUnaChiaveVecchia {
        pin_chiesti: Arc<Mutex<usize>>,
        salvata: Arc<Mutex<Option<Vec<u8>>>>,
    }

    impl AccessoriBle for ChiInTascaHaUnaChiaveVecchia {
        fn nome(&mut self) -> Option<String> {
            None
        }
        fn leggi_caratteristica(&mut self, _uuid: [u8; 16]) -> Result<Vec<u8>, String> {
            Err("il finto non ha caratteristiche da leggere".into())
        }
        fn codice_pin(&mut self) -> Option<String> {
            *self.pin_chiesti.lock().unwrap() += 1;
            Some("482915".into())
        }
        fn codice_accesso(&mut self) -> Option<Vec<u8>> {
            // Quella salvata in questo scarico vale; se non c'è, quella vecchia.
            Some(self.salvata.lock().unwrap().clone().unwrap_or_else(|| vec![0x5A; 16]))
        }
        fn salva_codice_accesso(&mut self, codice: &[u8]) {
            *self.salvata.lock().unwrap() = Some(codice.to_vec());
        }
    }

    #[test]
    fn una_chiave_che_non_vale_piu_porta_al_pin_e_la_chiave_nuova_apre() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL VICOLO CIECO CHE LA 0.9.0 NON SAPEVA APRIRE. ◄
         *
         * Con la 0.9.0 una chiave conservata faceva saltare del tutto il ramo
         * del PIN: il computer rispondeva 13, la libreria diceva «errore di
         * protocollo» e si fermava — a ogni tentativo, per sempre. Dal ramo
         * principale il 13 diventa `DC_STATUS_NOACCESS`, e la libreria chiede
         * il PIN da sé, se ne fa dare una chiave nuova e riprova.
         *
         * Qui si percorre quel giro intero attraverso il NOSTRO trasporto: la
         * richiesta del PIN (`GET_PINCODE`), la chiave nuova da conservare
         * (`SET_ACCESSCODE`), e la seconda richiesta d'accesso con la chiave
         * appena arrivata. Il finto si ferma alla calibrazione, come l'altro.
         */
        let descrittore = trova_descrittore("Aqualung", "i330R").expect("il descrittore dell'i330R deve esistere");
        let finto = I330rCheHaCambiatoChiave { valida: [0xA5; 16], pin: [4, 8, 2, 9, 1, 5] };
        let (manda, ricevi) = channel::<Vec<u8>>();
        let comandi: Comandi = Arc::new(Mutex::new(Vec::new()));
        let visti = comandi.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            let (bandiera, comando) = (dati[1], dati[2]);
            let carico = &dati[5..];
            visti.lock().unwrap().push((comando, bandiera));
            let risposte = match (comando, bandiera) {
                (0xFA, 0x40) | (0xFB, 0x40) => vec![pacchetto_i330r(0xC0, comando, &[1])],
                // La chiave: giusta, o il 13 che fa comparire il PIN nuovo.
                (0xFA, 0x80) if carico == finto.valida => vec![pacchetto_i330r(0xC0, 0xFA, &[2])],
                (0xFA, 0x80) => vec![pacchetto_i330r(0xC0, 0xFA, &[13])],
                // Il PIN giusto vale una chiave nuova.
                (0xFB, 0x80) if carico == finto.pin => vec![
                    pacchetto_i330r(0x80, 0xFB, &finto.valida),
                    pacchetto_i330r(0xC0, 0xFB, &[2]),
                ],
                (0x22, _) => {
                    let mut id = [0u8; 16];
                    id[12] = 0x47;
                    id[13] = 0x44;
                    vec![pacchetto_i330r(0x80, 0x22, &id), pacchetto_i330r(0xC0, 0x22, &[2])]
                }
                (0x97, _) => vec![pacchetto_i330r(0xC0, 0x97, &[1])],
                _ => vec![pacchetto_i330r(0xC0, comando, &[9])],
            };
            for r in risposte {
                let _ = manda.send(r);
            }
            Ok(())
        });
        let pin_chiesti = Arc::new(Mutex::new(0usize));
        let salvata = Arc::new(Mutex::new(None));
        let accessori = ChiInTascaHaUnaChiaveVecchia { pin_chiesti: pin_chiesti.clone(), salvata: salvata.clone() };
        let flusso = FlussoBle::nuovo(ricevi, scrittura)
            .con_accessori(Box::new(accessori), Box::new(|| Ripiego::Esaurito))
            .con_riassemblaggio(Riassemblaggio::LunghezzaDichiarata);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();

        assert!(collegamento.scarica(&descrittore).is_err(), "il finto rifiuta la calibrazione apposta");
        assert_eq!(*pin_chiesti.lock().unwrap(), 1, "il PIN si chiede una volta sola");
        assert_eq!(salvata.lock().unwrap().as_deref(), Some(&[0xA5u8; 16][..]), "la chiave nuova si conserva");
        assert_eq!(
            *comandi.lock().unwrap(),
            vec![
                (0xFA, 0x40),
                (0xFA, 0x80), // la chiave vecchia: 13
                (0xFB, 0x40),
                (0xFB, 0x80), // il PIN: la chiave nuova
                (0xFA, 0x40),
                (0xFA, 0x80), // la chiave nuova: aperto
                (0x22, 0x40),
                (0x97, 0x40),
                (0x27, 0x40),
            ],
            "chiave vecchia, PIN, chiave nuova, risveglio, autenticazione"
        );
        let righe = collegamento.righe_della_libreria();
        assert!(
            righe.iter().any(|r| r.contains("invalid access code")),
            "la libreria deve dire perché ha chiesto il PIN: {righe:?}"
        );
    }

    #[test]
    fn col_filtro_la_coda_si_butta_anche_senza_ascolto_e_l_apertura_va_avanti() {
        /*
         * Il finto del diario, SENZA l'ascolto iniziale ma col filtro: la coda
         * arriva dopo la richiesta d'accesso — com'è arrivata davvero, un
         * millisecondo dopo — e il filtro la butta pacchetto per pacchetto.
         * Accesso, risveglio e autenticazione passano, come con l'ascolto. Le
         * due guardie coprono lo stesso difetto da due lati: l'ascolto ciò che
         * arriva prima di parlare, il filtro ciò che arriva dopo.
         */
        let descrittore = trova_descrittore("Aqualung", "i330R").expect("il descrittore dell'i330R deve esistere");
        let (flusso, comandi) = finto_i330r(vec![coda_del_22_settembre(), coda_del_22_settembre()], false);
        // La coda del finto parte venti millisecondi dopo l'apertura del
        // canale: si aspetta che sia partita, così arriva dopo la prima
        // scrittura come nel diario.
        std::thread::sleep(Duration::from_millis(5));
        let collegamento = CollegamentoLdc::apri(Box::new(flusso.con_filtro_del_comando())).unwrap();
        assert!(collegamento.scarica(&descrittore).is_err(), "il finto rifiuta la calibrazione apposta");
        assert_eq!(
            *comandi.lock().unwrap(),
            vec![(0xFA, 0x40), (0xFA, 0x80), (0x22, 0x40), (0x97, 0x40), (0x27, 0x40)],
            "accesso, risveglio e autenticazione devono passare"
        );
        let misure = collegamento.misure_lettura();
        assert_eq!((misure.estranei, misure.byte_estranei), (2, 202), "le due code, contate");
        let riga = collegamento.riga_delle_letture().expect("ci sono state letture");
        assert!(
            riga.contains("pacchetti che rispondevano a un altro comando, buttati: 2 (202 byte)"),
            "il diario deve dirlo: {riga}"
        );
    }

    #[test]
    fn l_ascolto_iniziale_si_fa_una_volta_sola() {
        /*
         * Prima del primo comando niente è una risposta; DOPO, tutto può
         * esserlo. Buttare anche prima del secondo comando vorrebbe dire
         * buttare risposte vere — e su un protocollo che risponde in ritardo,
         * la risposta al primo comando.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_ascolto_iniziale(Duration::from_millis(20), Duration::from_secs(1));
        manda.send(vec![0xde, 0xad]).unwrap();
        flusso.scrivi(&[1]).unwrap();
        assert_eq!(flusso.scartate_prima_di_parlare(), (1, 2));

        manda.send(vec![0xbe, 0xef]).unwrap();
        flusso.scrivi(&[2]).unwrap();
        assert_eq!(
            flusso.leggi(10, Duration::from_millis(50)).unwrap(),
            vec![0xbe, 0xef],
            "dopo il primo comando niente si butta più"
        );
        assert_eq!(flusso.scartate_prima_di_parlare(), (1, 2));
    }

    #[test]
    fn senza_ascolto_iniziale_non_si_butta_niente() {
        // Le altre famiglie restano com'erano: nessuna misura dice che ne
        // abbiano bisogno, e un'attesa in più non è gratis.
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        manda.send(vec![0xde, 0xad]).unwrap();
        let prima = std::time::Instant::now();
        flusso.scrivi(&[1]).unwrap();
        assert!(prima.elapsed() < Duration::from_millis(15), "nessuna attesa: {:?}", prima.elapsed());
        assert_eq!(flusso.leggi(10, Duration::from_millis(50)).unwrap(), vec![0xde, 0xad]);
        assert_eq!(flusso.scartate_prima_di_parlare(), (0, 0));
    }

    #[test]
    fn un_computer_che_non_smette_di_parlare_non_blocca_il_primo_comando() {
        /*
         * ► IL TETTO. ◄ Un computer che parla senza sosta non sta svuotando una
         * coda: sta parlando con qualcun altro. Aspettare il silenzio lì
         * vorrebbe dire aspettare per sempre, e un'applicazione ferma senza
         * dire niente è indistinguibile da una bloccata. Al tetto si parla
         * comunque, e il resto lo decide la libreria.
         */
        let (manda, ricevi) = channel();
        let scritte = Arc::new(Mutex::new(0usize));
        let contate = scritte.clone();
        let mut flusso = FlussoBle::nuovo(
            ricevi,
            Box::new(move |_| {
                *contate.lock().unwrap() += 1;
                Ok(())
            }),
        )
        .con_ascolto_iniziale(Duration::from_millis(60), Duration::from_millis(200));
        let chiacchierone = std::thread::spawn(move || {
            for _ in 0..100 {
                if manda.send(vec![0xaa; 20]).is_err() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        let prima = std::time::Instant::now();
        flusso.scrivi(&[1]).unwrap();
        let passato = prima.elapsed();
        assert!(passato >= Duration::from_millis(200), "il silenzio non c'è mai stato: si aspetta fino al tetto");
        assert!(passato < Duration::from_millis(800), "e non oltre: {passato:?}");
        assert_eq!(*scritte.lock().unwrap(), 1, "al tetto il comando parte comunque");
        assert!(flusso.scartate_prima_di_parlare().0 >= 5, "{:?}", flusso.scartate_prima_di_parlare());
        drop(flusso);
        let _ = chiacchierone.join();
    }

    #[test]
    fn il_frammento_che_non_arriva_adesso_si_conta() {
        /*
         * ► IL NUMERO CHE DICEVA ZERO DAVANTI A UN PACCHETTO SPEZZATO. ◄
         *
         * Il diario del 16 settembre riporta «pacchetti lasciati a metà: 0»
         * mentre un pacchetto era stato lasciato a metà per davvero. Non era una
         * bugia del contatore: era che con «una notifica per lettura» il codice
         * che lo incrementa **non gira affatto**.
         *
         * Adesso gira, quindi il diario della prossima segnalazione dirà una
         * cosa vera. Il pacchetto a metà si consegna lo stesso — la diagnosi
         * giusta è quella di libdivecomputer — ma non passa più inosservato da
         * questa parte.
         */
        let intero = pacchetto_pelagic(0x0d, &[0xAB; 96]);
        let (manda, mut flusso) = flusso_pelagic();
        manda.send(intero[..96].to_vec()).unwrap();

        let letto = flusso.leggi(260, Duration::from_millis(50)).unwrap();
        assert_eq!(letto.len(), 96, "si consegna quello che c'è");
        assert_eq!(flusso.misure_frammenti().0, 1, "e si scrive che mancava qualcosa");
    }

    #[test]
    fn la_lunghezza_dichiarata_si_legge_dal_quinto_byte() {
        /*
         * ► LA GUARDIA DELLA GUARDIA. ◄ Tutto il resto poggia su una regola
         * sola: totale = `pacchetto[4] + 5`. Non è dedotta dal sorgente della
         * libreria, è misurata sui pacchetti veri del diario del 16 settembre —
         * quattro scritture e una notifica, tutte con la stessa aritmetica.
         */
        for (byte, atteso) in [
            (vec![0xcd, 0x40, 0xfa, 0xf6, 0x09], 14usize),
            (vec![0xcd, 0x80, 0xfa, 0x92, 0x10], 21),
            (vec![0xcd, 0x80, 0xfb, 0x94, 0x06], 11),
            (vec![0xcd, 0x00, 0x0d, 0xbe, 0x09], 14),
            (vec![0xcd, 0xc0, 0xfa, 0x94, 0x02], 7),
        ] {
            let avanzo: VecDeque<u8> = byte.into_iter().collect();
            assert_eq!(confine_dichiarato(&avanzo), Some(atteso));
            assert!(manca_un_pezzo(&avanzo), "l'intestazione da sola non basta mai");
        }

        // E i due casi in cui non si sa: intestazione incompleta, e byte
        // d'inizio sbagliato. Portano allo stesso gesto per ragioni opposte.
        let corta: VecDeque<u8> = vec![0xcd, 0x40].into_iter().collect();
        assert_eq!(confine_dichiarato(&corta), None);
        assert!(manca_un_pezzo(&corta), "manca, ma non si sa quanto");

        let storta: VecDeque<u8> = vec![0x11, 0x22, 0x33, 0x44, 0x55].into_iter().collect();
        assert_eq!(confine_dichiarato(&storta), None);
        assert!(!manca_un_pezzo(&storta), "fuori sincronia non si aspetta niente");
    }

    #[test]
    fn una_notifica_piu_corta_delle_altre_chiude_il_messaggio_senza_aspettare() {
        /*
         * La regola che rende il riassemblaggio gratuito: su BLE i frammenti
         * di uno stesso messaggio sono tutti della dimensione massima tranne
         * l'ultimo. Quindi una notifica più corta è la fine, e non si aspetta
         * niente — se si aspettasse, si rischierebbe di risucchiare dentro
         * questa lettura la risposta al comando successivo.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        manda.send(vec![1, 2, 3, 4]).unwrap();
        manda.send(vec![5, 6]).unwrap();
        manda.send(vec![7, 8, 9, 0]).unwrap();
        // Le prime due si uniscono (la seconda è più corta: fine del
        // messaggio), la terza resta per la lettura dopo.
        assert_eq!(flusso.leggi(100, Duration::from_millis(50)).unwrap(), vec![1, 2, 3, 4, 5, 6]);
        assert_eq!(flusso.leggi(100, Duration::from_millis(50)).unwrap(), vec![7, 8, 9, 0]);
    }

    #[test]
    fn un_frammento_che_arriva_dopo_si_aspetta_e_non_si_perde() {
        /*
         * ► LA PROVA CHE DISTINGUE «UNIRE» DA «ASPETTARE». ◄
         *
         * Tutte le altre prove del riassemblaggio mettono i pezzi nel canale
         * PRIMA di leggere, e allora unirli non costa niente. Ma il Bluetooth
         * vero non funziona così: i frammenti di uno stesso messaggio arrivano
         * a distanza di un intervallo di connessione, e quando la lettura
         * comincia il secondo pezzo **non c'è ancora**. Senza l'attesa, quella
         * lettura consegnerebbe mezzo pacchetto — che è esattamente il difetto
         * da cui è nato tutto questo.
         *
         * Qui il secondo pezzo arriva da un altro thread, in ritardo, e la
         * lettura deve trovarlo lo stesso.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        manda.send(vec![0xaa; 8]).unwrap();
        std::thread::spawn(move || {
            // Meno dell'attesa dei frammenti, che nelle prove è di cinque
            // millisecondi: il pezzo arriva in ritardo ma dentro la finestra.
            std::thread::sleep(Duration::from_millis(1));
            let _ = manda.send(vec![0xea; 3]);
        });
        let letto = flusso.leggi(100, Duration::from_millis(200)).unwrap();
        assert_eq!(letto.len(), 11, "il pezzo in ritardo va aspettato, non perso");
        assert_eq!(letto[10], 0xea);
    }

    #[test]
    fn ogni_lettura_aspetta_al_massimo_un_frammento_e_non_di_piu() {
        /*
         * ► IL COSTO DEL RIASSEMBLAGGIO, INCHIODATO. ◄
         *
         * Su un apparecchio che non spezza mai niente, ogni lettura paga
         * un'attesa a vuoto: è il prezzo della correttezza, e va bene. Quello
         * che NON deve succedere è pagarne due o tre per lettura — un ciclo che
         * riprova finché non si stanca trasformerebbe uno scarico da tre
         * minuti in uno da dieci, e nessuno capirebbe perché.
         *
         * Qui la scadenza delle prove è di cinque millisecondi: una lettura
         * deve costare più o meno quella, non un multiplo.
         *
         * ► E PERCHÉ NON C'È PIÙ IL FERMO DOPO TRE ATTESE A VUOTO. ◄ C'era, e
         * spegneva l'attesa per il resto della sessione. Sembrava prudente:
         * era la stessa trappola di prima con un vestito nuovo, perché le
         * risposte di questo protocollo non sono tutte lunghe uguali — la
         * versione è 142 byte, i segmenti 244 — e il fermo scattava sulle
         * prime per poi far arrivare a pezzi le seconde.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        let mut attese = Vec::new();
        for _ in 0..6 {
            manda.send(vec![1, 2, 3, 4]).unwrap();
            let inizio = std::time::Instant::now();
            assert_eq!(flusso.leggi(100, Duration::from_millis(200)).unwrap().len(), 4);
            attese.push(inizio.elapsed());
        }
        for (n, quanto) in attese.iter().enumerate() {
            assert!(
                *quanto < ATTESA_FRAMMENTO * 3,
                "la lettura n. {n} ha aspettato {quanto:?}, cioè più di un frammento"
            );
        }
    }

    #[test]
    fn il_riassemblaggio_non_si_spegne_mai_da_solo() {
        /*
         * ► LA PROVA CHE È NATA DA UN DIFETTO VERO, TROVATO RILEGGENDO. ◄
         *
         * La prima versione smetteva di aspettare frammenti dopo tre attese a
         * vuoto. Con questo protocollo è una condanna: le prime risposte sono
         * corte e non spezzano niente — tre attese a vuoto garantite — e i
         * segmenti grossi arrivano dopo, quando l'attesa è già spenta.
         *
         * Qui si fanno quattro letture che non spezzano, e poi una che spezza
         * con il secondo pezzo IN RITARDO. Se l'attesa si fosse spenta, quella
         * lettura consegnerebbe mezzo pacchetto — che è il difetto del 7
         * settembre, ricreato dall'ottimizzazione.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        for _ in 0..4 {
            manda.send(vec![0xaa; 8]).unwrap();
            assert_eq!(flusso.leggi(100, Duration::from_millis(200)).unwrap().len(), 8);
        }
        // E adesso quella che spezza, con il pezzo in ritardo.
        manda.send(vec![0xaa; 8]).unwrap();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1));
            let _ = manda.send(vec![0xea; 3]);
        });
        let letto = flusso.leggi(100, Duration::from_millis(200)).unwrap();
        assert_eq!(letto.len(), 11, "dopo quattro letture intere l'attesa deve esserci ancora");
    }

    #[test]
    fn il_confine_del_mares_sta_esattamente_a_centoquarantadue_byte() {
        // Centoquaranta di corpo più `AA` ed `EA`. Un byte meno e si spezza:
        // il numero non è arrotondato, ed è quello che rende questa prova utile
        // il giorno che qualcuno cambierà la dimensione delle notifiche.
        let (giusto, _) = quadci_con_notifiche(142);
        assert!(giusto.contains("stato -7"), "142 byte bastano: {giusto}");
        let (uno_in_meno, _) = quadci_con_notifiche(141);
        assert!(uno_in_meno.contains("stato -8"), "141 no: {uno_in_meno}");
    }

    // ------------------------------------------------------- le ioctl e i guasti

    /// Un flusso che risponde alle domande accessorie, e basta.
    struct ConAccessori {
        nome: Option<String>,
        valore: Result<Vec<u8>, String>,
        /// L'UUID che gli è stato chiesto, per controllare che arrivi intero.
        chiesto: Arc<Mutex<Option<[u8; 16]>>>,
    }

    impl FlussoByte for ConAccessori {
        fn scrivi(&mut self, _dati: &[u8]) -> Result<(), GuastoScrittura> {
            Err("questo flusso non scrive: è qui per le ioctl".into())
        }
        fn leggi(&mut self, _quanti: usize, _attesa: Duration) -> Result<Vec<u8>, String> {
            Err("il collegamento Bluetooth si è chiuso".into())
        }
        fn disponibili(&mut self) -> usize {
            0
        }
        fn nome(&mut self) -> Option<String> {
            self.nome.clone()
        }
        fn leggi_caratteristica(&mut self, uuid: [u8; 16]) -> Result<Vec<u8>, String> {
            *self.chiesto.lock().unwrap() = Some(uuid);
            self.valore.clone()
        }
    }

    fn con_accessori(nome: Option<&str>, valore: Result<Vec<u8>, String>) -> (CollegamentoLdc, Arc<Mutex<Option<[u8; 16]>>>) {
        let chiesto = Arc::new(Mutex::new(None));
        let flusso = ConAccessori { nome: nome.map(String::from), valore, chiesto: chiesto.clone() };
        (CollegamentoLdc::apri(Box::new(flusso)).unwrap(), chiesto)
    }

    #[test]
    fn il_nome_bluetooth_arriva_a_libdivecomputer_come_stringa_c() {
        /*
         * La strada vera: `dc_iostream_ioctl` → `custom.c` → `cb_ioctl`. È
         * quella che `oceanic_atom2.c` percorre per ricavare il numero di
         * serie dal nome — e senza questa risposta la sua stretta di mano
         * muore con «name too short», stato -6.
         */
        let (collegamento, _) = con_accessori(Some("FQ001124"), Ok(vec![]));
        let mut buffer = [0xffu8; 9];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_NAME, &mut buffer), DC_STATUS_SUCCESS);
        assert_eq!(&buffer[..8], b"FQ001124");
        assert_eq!(buffer[8], 0, "terminata da zero, come una stringa C");

        // Un nome più lungo del posto si tronca, e resta terminato.
        let mut corto = [0xffu8; 4];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_NAME, &mut corto), DC_STATUS_SUCCESS);
        assert_eq!(&corto, b"FQ0\0");
    }

    #[test]
    fn senza_nome_e_per_le_richieste_sconosciute_si_risponde_non_supportato_non_successo() {
        /*
         * Il difetto che c'era: con `ioctl: None`, `custom.c` risponde
         * SUCCESSO senza toccare il buffer. Chi chiede il nome lo trova
         * vuoto e fallisce in modo illeggibile; chi chiede il codice PIN
         * del Pelagic crede di averlo. «Non supportato» (-1) è la risposta
         * che i backend sanno gestire: `oceanic_atom2.c` la tollera con un
         * avviso, `pelagic_i330r.c` si ferma dicendo cosa manca.
         */
        let (collegamento, _) = con_accessori(None, Ok(vec![]));
        let mut buffer = [0xffu8; 9];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_NAME, &mut buffer), DC_STATUS_UNSUPPORTED);
        assert_eq!(buffer, [0xff; 9], "il buffer non va toccato");
        // Il PIN del Pelagic (IOR 'b' 1): non lo sappiamo, e lo diciamo.
        assert_eq!(collegamento.ioctl(0x4000_6201, &mut buffer), DC_STATUS_UNSUPPORTED);
    }

    #[test]
    fn la_lettura_di_una_caratteristica_passa_uuid_e_riporta_il_valore_dopo_luuid() {
        // Il formato di `DC_IOCTL_BLE_CHARACTERISTIC_READ`: sedici byte di
        // UUID in testa, il valore nel resto. È quello che `cressi_goa.c` si
        // aspetta quando legge le tre caratteristiche della versione.
        let (collegamento, chiesto) = con_accessori(None, Ok(vec![1, 2, 3, 4, 5]));
        let mut buffer = [0u8; 16 + 5];
        buffer[..16].copy_from_slice(&[
            0x6E, 0x40, 0x00, 0x03, 0xB5, 0xA3, 0xF3, 0x93, 0xE0, 0xA9, 0xE5, 0x0E, 0x24, 0xDC, 0x10, 0xB8,
        ]);
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_CHARACTERISTIC_READ, &mut buffer), DC_STATUS_SUCCESS);
        assert_eq!(&buffer[16..], &[1, 2, 3, 4, 5]);
        assert_eq!(chiesto.lock().unwrap().unwrap()[..4], [0x6E, 0x40, 0x00, 0x03]);

        // Un valore più lungo del posto si tronca ai primi byte: un
        // dispositivo che riempie la caratteristica fino a venti byte non
        // deve far fallire lo scarico per il riempimento.
        let (collegamento, _) = con_accessori(None, Ok(vec![1, 2, 3, 4, 5, 6]));
        let mut buffer = [0u8; 16 + 5];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_CHARACTERISTIC_READ, &mut buffer), DC_STATUS_SUCCESS);
        assert_eq!(&buffer[16..], &[1, 2, 3, 4, 5]);

        // E una lettura fallita torna come errore, con la causa annotata.
        let (collegamento, _) = con_accessori(None, Err("la caratteristica non si legge".into()));
        let mut buffer = [0u8; 16 + 5];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_CHARACTERISTIC_READ, &mut buffer), DC_STATUS_IO);
        assert!(collegamento.spiega(DC_STATUS_IO).contains("non si legge"), "{}", collegamento.spiega(DC_STATUS_IO));
    }

    #[test]
    fn il_conto_delle_letture_dice_quante_sono_tornate_a_meta_e_quanto_si_e_aspettato() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► LA MISURA CHE DEVE RISPONDERE AL PROSSIMO DIARIO. ◄
         *
         * Il diario del Puck 4 del 10 settembre 2026 racconta una catena:
         * lettura scaduta (`mares_iconhd.c:329`) → ritentativo interno del
         * backend (due `ac 09` di fila nella coda) → risposta disallineata
         * (`mares_iconhd.c:521`, che nessuno ritenta) → fine dello scarico.
         *
         * Il primo anello è nostro, ed è l'unico su cui si possa fare
         * qualcosa. L'ipotesi: un frammento che tarda più dei quaranta
         * millisecondi che questo trasporto concede fa tornare il pacchetto a
         * metà, e per chi legge con `actual` nullo — cioè tutti i backend —
         * una lettura corta È una lettura scaduta.
         *
         * *Alzare il tetto senza sapere sarebbe una deduzione, e in questa
         * storia le deduzioni hanno già perso una volta.* Quindi qui si misura
         * e basta. Questa prova costruisce apposta il caso: un pacchetto che
         * resta a metà perché il pezzo dopo non arriva mai.
         */
        let (manda, ricevi) = channel();
        let flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        collegamento.imposta_attesa(50);

        // Prima di leggere non c'è niente da raccontare, e non si racconta.
        assert!(
            collegamento.riga_delle_letture().is_none(),
            "senza letture la riga sarebbe vera e inutile"
        );

        // Un frammento «pieno» e nessun seguito: il pacchetto resta a metà, e
        // chi ne aveva chiesti cento ne riceve otto.
        manda.send(vec![0xaa; 8]).unwrap();
        assert_eq!(collegamento.leggi(100).unwrap().len(), 8);

        let m = collegamento.misure_lettura();
        assert_eq!(m.letture, 1);
        assert_eq!(m.letture_corte, 1, "otto byte su cento chiesti è una lettura corta");
        assert_eq!(m.letture_vuote, 0);
        assert_eq!(m.frammenti_mancati, 1, "il pacchetto è rimasto a metà per l'attesa scaduta");
        /*
         * ► E LA PAUSA RESTA ZERO, CHE È IL CONTRARIO DI PRIMA. ◄ Fino alla
         * 1.8.17 qui si pretendeva `> 0`, perché il numero contava anche le
         * attese scadute — e proprio per questo si saturava sul tetto e non
         * diceva più niente. Adesso conta solo le pause **colmate**: qui il
         * frammento non è mai arrivato, quindi non c'è nessun margine da
         * riportare, e la scadenza la racconta `frammenti_mancati` che sta la
         * riga sopra. *Due numeri che dicono due cose, invece di uno che le
         * confonde.*
         */
        assert_eq!(
            m.pausa_massima_ms, 0,
            "il frammento non è arrivato: non c'è nessuna pausa colmata da riportare: {m:?}"
        );

        // E una lettura che non porta niente si conta a parte: «corta» e
        // «vuota» mandano a guardare due cose diverse — la prima il tetto fra
        // i frammenti, la seconda il collegamento.
        assert!(collegamento.leggi(10).is_err());
        let m = collegamento.misure_lettura();
        assert_eq!((m.letture, m.letture_corte, m.letture_vuote), (2, 1, 1));

        // E il silenzio: qui la seconda lettura ha aspettato tutto il tempo
        // concesso senza ricevere niente, ed è il numero che — accanto alla
        // conta delle sparizioni dello schermo — dice se a tacere è stato il
        // computer o siamo stati noi a smettere di ascoltare.
        assert!(
            m.silenzio_massimo_ms > 0,
            "una lettura ha aspettato a vuoto e non è stata cronometrata: {m:?}"
        );

        let riga = collegamento.riga_delle_letture().unwrap();
        assert!(riga.contains("silenzio più lungo"), "{riga}");
        assert!(riga.contains("letture: 2"), "{riga}");
        assert!(riga.contains("1 corte"), "{riga}");
        assert!(riga.contains("1 vuote"), "{riga}");
        assert!(riga.contains("lasciati a metà: 1"), "{riga}");
        // Il tetto sta accanto alla pausa: è il confronto a dire qualcosa, e
        // chi legge il diario non ha il codice davanti.
        assert!(
            riga.contains(&format!("ci si arrende a {} ms", ATTESA_FRAMMENTO.as_millis())),
            "{riga}"
        );
    }

    fn avanzamento(immersioni: usize, letti: u32, totali: u32) -> Avanzamento {
        Avanzamento { immersioni, byte_letti: letti, byte_totali: totali }
    }

    /// Guida `campione` come fa libdivecomputer: un istante, poi i valori che a
    /// quell'istante sono cambiati.
    fn accumula(passi: &[(c_uint, ValoreCampione)]) -> Vec<CampioneLdc> {
        let mut acc = Accumulatore {
            immersione: ImmersioneLdc::default(),
            corrente: CampioneLdc::default(),
            iniziato: false,
            quante_bombole: 0,
            miscela_corrente: None,
            pressioni_fuori_scala: 0,
        };
        for (tipo, valore) in passi {
            campione(*tipo, valore, &mut acc as *mut Accumulatore as *mut c_void);
        }
        // L'ultimo campione non ha un `DC_SAMPLE_TIME` dopo di sé che lo
        // chiuda: lo chiude chi chiama, e qui si fa lo stesso.
        if acc.iniziato {
            acc.immersione.samples.push(acc.corrente);
        }
        acc.immersione.samples
    }

    const CAMPIONE_TEMPO: c_uint = 0;
    const CAMPIONE_PRESSIONE: c_uint = 2;

    #[test]
    fn la_miscela_si_porta_avanti_fino_al_cambio_dopo() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► È LA METÀ CHE SI DIMENTICA, E SENZA DI LEI IL RESTO NON SERVE. ◄
         *
         * libdivecomputer manda `DC_SAMPLE_GASMIX` **solo nell'istante del
         * cambio**: il campione dopo non lo ripete. Leggendolo senza portarlo
         * avanti si ottiene il gas dichiarato su un campione ogni duemila — e
         * `analysis/tissues.ts` legge `s.gasIndex ?? 0` su OGNI campione, quindi
         * tutta la risalita tornerebbe a essere calcolata sulla miscela di
         * fondo. *Cioè il difetto di prima, con in più l'aria di essere stato
         * corretto.*
         */
        let campioni = accumula(&[
            (CAMPIONE_TEMPO, ValoreCampione { tempo: 0 }),
            (CAMPIONE_MISCELA, ValoreCampione { miscela: 0 }),
            (CAMPIONE_TEMPO, ValoreCampione { tempo: 10_000 }),
            (CAMPIONE_TEMPO, ValoreCampione { tempo: 20_000 }),
            (CAMPIONE_MISCELA, ValoreCampione { miscela: 1 }),
            (CAMPIONE_TEMPO, ValoreCampione { tempo: 30_000 }),
        ]);
        assert_eq!(
            campioni.iter().map(|c| c.indice_miscela).collect::<Vec<_>>(),
            vec![Some(0), Some(0), Some(1), Some(1)],
            "la miscela dichiarata una volta vale fino al cambio dopo"
        );
        assert_eq!(campioni.iter().map(|c| c.t).collect::<Vec<_>>(), vec![0, 10, 20, 30]);
    }

    #[test]
    fn prima_che_il_computer_dica_una_miscela_non_se_ne_inventa_nessuna() {
        /*
         * ► ASSENTE NON È ZERO. ◄ Dieci parser su trentasei non mandano mai
         * `DC_SAMPLE_GASMIX`. Per loro il campo deve restare vuoto: a valle
         * `?? 0` vuol dire «usa la prima bombola», che è un'assunzione presa in
         * un posto solo e dichiarata lì. Scrivere zero qui la travestirebbe da
         * lettura del computer — e la stessa riga direbbe due cose diverse a
         * seconda di chi l'ha scritta.
         *
         * Vale anche per i campioni PRIMA del primo cambio su un computer che
         * invece li manda: se il gas lo dichiara solo a metà immersione, la
         * prima metà non l'ha detto nessuno.
         */
        let campioni = accumula(&[
            (CAMPIONE_TEMPO, ValoreCampione { tempo: 0 }),
            (CAMPIONE_TEMPO, ValoreCampione { tempo: 10_000 }),
            (CAMPIONE_MISCELA, ValoreCampione { miscela: 2 }),
            (CAMPIONE_TEMPO, ValoreCampione { tempo: 20_000 }),
        ]);
        assert_eq!(
            campioni.iter().map(|c| c.indice_miscela).collect::<Vec<_>>(),
            vec![None, Some(2), Some(2)]
        );
    }

    #[test]
    fn unimmersione_nuova_si_dice_sempre_e_subito() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► È IL NUMERO CHE È STATO CHIESTO, E NON HA RESPIRO. ◄
         *
         * Le immersioni escono di rado — ottantuno in sette minuti e
         * quarantaquattro secondi, sul Puck 4 del 12 settembre 2026 — e vederle
         * salire è l'unica cosa che distingua «sta andando avanti» da «il
         * programma non è bloccato». Farle aspettare il respiro della barra
         * vorrebbe dire mostrare «26 immersioni» per un quarto di secondo dopo
         * che la ventisettesima è già in archivio: piccolo, e falso.
         */
        let prima = avanzamento(26, 500_000, 1_700_000);
        assert!(
            vale_la_pena_dirlo(Some(prima), avanzamento(27, 500_000, 1_700_000), Duration::ZERO),
            "l'immersione nuova non aspetta nessun respiro"
        );
    }

    #[test]
    fn la_stessa_percentuale_non_si_ripete_e_quella_nuova_aspetta_il_respiro() {
        /*
         * ► SETTEMILAQUATTROCENTOSETTANTADUE EVENTI, SE NESSUNO LI FILTRA. ◄
         * La callback di libdivecomputer scatta a ogni lettura: sul Puck 4
         * sarebbero stati 7472 messaggi serializzati e spediti attraverso il
         * ponte, sullo stesso processo che deve stare dietro al Bluetooth.
         * *Un avanzamento che rallenta lo scarico che sta raccontando è un
         * peggioramento travestito da funzione.*
         */
        let prima = avanzamento(10, 500_000, 1_700_000);
        assert!(
            !vale_la_pena_dirlo(Some(prima), avanzamento(10, 500_100, 1_700_000), Duration::ZERO),
            "stessa percentuale e nessun respiro: non c'è niente da dire"
        );
        assert!(
            !vale_la_pena_dirlo(
                Some(prima),
                avanzamento(10, 1_000_000, 1_700_000),
                Duration::ZERO
            ),
            "la percentuale è cambiata ma il respiro no: si aspetta"
        );
        assert!(
            vale_la_pena_dirlo(
                Some(prima),
                avanzamento(10, 1_000_000, 1_700_000),
                RESPIRO_DELL_AVANZAMENTO
            ),
            "respiro passato e percentuale cambiata: si dice"
        );
        /*
         * ► E IL ROVESCIO, CHE È QUELLO CHE TIENE ONESTA LA REGOLA. ◄ Passato
         * il respiro ma con la barra ferma allo stesso punto intero, non si
         * dice niente: una barra che si aggiorna senza muoversi è rumore, e
         * nasconde proprio il caso in cui si è fermata davvero.
         */
        assert!(
            !vale_la_pena_dirlo(
                Some(prima),
                avanzamento(10, 500_100, 1_700_000),
                RESPIRO_DELL_AVANZAMENTO * 100
            ),
            "il tempo da solo non è una notizia"
        );
    }

    #[test]
    fn il_primo_avanzamento_si_dice_comunque() {
        // Senza, la barra comparirebbe solo al secondo evento utile: su un
        // computer lento è mezzo minuto di schermata muta.
        assert!(vale_la_pena_dirlo(None, Avanzamento::default(), Duration::ZERO));
    }

    #[test]
    fn la_percentuale_non_divide_per_zero_e_non_supera_cento() {
        /*
         * ► IL TOTALE PUÒ ESSERE ZERO, E NON È UN CASO LIMITE INVENTATO. ◄
         * Prima che `DC_EVENT_PROGRESS` arrivi la prima volta i due campi
         * valgono zero, e `Avanzamento::default()` è esattamente quello stato.
         * Una divisione lì dentro farebbe cadere il thread dello scarico —
         * cioè perdere le immersioni già arrivate — per colpa del pezzo di
         * codice che doveva solo raccontarlo.
         */
        assert_eq!(percentuale(Avanzamento::default()), None);
        assert_eq!(percentuale(avanzamento(0, 12_345, 0)), None);
        assert_eq!(percentuale(avanzamento(0, 850_000, 1_700_000)), Some(50));
        // Alcuni backend stimano il massimo e poi lo superano: la barra si
        // ferma piena invece di uscire dal riquadro.
        assert_eq!(percentuale(avanzamento(0, 2_000_000, 1_700_000)), Some(100));
    }

    #[test]
    fn un_frammento_in_ritardo_ma_dentro_il_tetto_viene_preso_e_cronometrato() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL CASO CHE SPIEGA «IL MAC ARRIVA IN FONDO E IL TELEFONO NO». ◄
         *
         * Il 12 settembre 2026 lo stesso Puck 4, nello stesso pomeriggio, ha
         * consegnato **81 immersioni al Mac e 20 al telefono**. La differenza
         * plausibile non sta nel protocollo — la registrazione del Mac è
         * pulita, 7472 comandi e 7472 risposte senza un solo ritentativo — ma
         * nell'**MTU**.
         *
         * Sul Mac le notifiche arrivavano fino a **244 byte**, cioè un
         * pacchetto Mares intero in una sola: il rimontaggio non entrava quasi
         * mai in funzione, e infatti i pacchetti lasciati a metà sono stati due
         * su settemila. Con l'MTU più piccolo che iOS negozia di solito, lo
         * STESSO pacchetto arriva in due pezzi, e allora questa attesa si paga
         * **su ogni lettura** invece che due volte in tutto lo scarico.
         *
         * Da qui il senso della prova: un frammento che tarda — più
         * dell'`ULTIMO_ISTANTE`, meno dell'`ATTESA_FRAMMENTO` — **deve essere
         * preso**, e la sua pausa deve finire nel numero che poi si legge nel
         * diario. Prima della 1.8.17 le due attese erano la stessa costante:
         * questa prova, allora, sarebbe stata impossibile da scrivere.
         */
        let (manda, ricevi) = channel();
        let flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        collegamento.imposta_attesa(50);

        // Il primo pezzo, «pieno». Il secondo parte in ritardo, da un altro
        // thread: è l'unico modo di avere un frammento che arriva DOPO che
        // qualcuno ha già cominciato ad aspettarlo.
        manda.send(vec![0xaa; 8]).unwrap();
        let tardivo = std::thread::spawn(move || {
            std::thread::sleep(ATTESA_FRAMMENTO / 2);
            manda.send(vec![0xbb; 4]).unwrap();
            manda
        });

        let letto = collegamento.leggi(12).unwrap();
        assert_eq!(letto.len(), 12, "il pacchetto va consegnato INTERO: {letto:?}");
        assert_eq!(&letto[8..], &[0xbb; 4], "e la coda è quella arrivata in ritardo");

        let m = collegamento.misure_lettura();
        assert_eq!(m.frammenti_mancati, 0, "nessun pacchetto lasciato a metà: {m:?}");
        assert_eq!(m.letture_corte, 0, "e nessuna lettura corta: {m:?}");
        /*
         * ► E LA PAUSA COLMATA DEVE ESSERCI. ◄ È il numero che dal 12 settembre
         * dice quanto margine resta sotto il tetto, ed è l'unico dei due che
         * possa condannare il tetto nuovo come il vecchio è stato condannato.
         * Senza questa riga, un codice che non lo scrive mai passerebbe tutte
         * le altre prove: quella del pacchetto a metà pretende zero, e quella
         * del pacchetto intero pretende zero.
         */
        assert!(
            m.pausa_massima_ms > 0,
            "il frammento è arrivato dopo un'attesa vera, e non è stato cronometrato: {m:?}"
        );

        let _ = tardivo.join();
    }

    #[test]
    fn un_pacchetto_arrivato_intero_non_conta_nessuna_pausa() {
        /*
         * ► IL ROVESCIO, E SERVE QUANTO L'ALTRO. ◄ Se ogni lettura contasse una
         * pausa, il massimo sarebbe sempre incollato al tetto e la misura non
         * distinguerebbe più niente — direbbe «il tetto è stretto» anche su uno
         * scarico perfetto. *Un numero che dice sempre la stessa cosa non è una
         * misura, è una decorazione.*
         */
        let (manda, ricevi) = channel();
        let flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_riassemblaggio(Riassemblaggio::PacchettoIntero);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        collegamento.imposta_attesa(50);
        // Quattro byte e poi due: la seconda notifica è più corta, quindi il
        // messaggio è finito e non si aspetta niente.
        manda.send(vec![1, 2, 3, 4]).unwrap();
        manda.send(vec![5, 6]).unwrap();
        assert_eq!(collegamento.leggi(100).unwrap(), vec![1, 2, 3, 4, 5, 6]);

        let m = collegamento.misure_lettura();
        assert_eq!(m.frammenti_mancati, 0);
        assert_eq!(m.pausa_massima_ms, 0, "nessuna attesa: il pacchetto c'era già tutto");
        // E il silenzio resta zero perché la risposta era già lì: non per una
        // guardia nel codice, ma perché non si è aspettato. È la stessa cosa
        // vista da fuori, ed è quella giusta da provare.
        assert_eq!(m.silenzio_massimo_ms, 0, "la risposta era già arrivata: nessun silenzio");
    }

    #[test]
    fn una_risposta_in_ritardo_non_si_butta_via_come_se_non_fosse_mai_arrivata() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► LA CORREZIONE CHE NON DIPENDE DALLA CAUSA, E LA PROVA CHE LA TIENE. ◄
         *
         * Il silenzio di qualche secondo ha dieci cause possibili e su nessuna
         * possiamo intervenire da qui. Su cosa chiamiamo «scaduto», sì. E
         * chiamarlo scaduto è l'innesco: il backend Mares dorme un secondo,
         * svuota l'ingresso e rimanda il comando, e siccome il protocollo Mares
         * non ha né checksum né numeri di sequenza, una risposta vecchia dopo
         * lo svuotamento desincronizza tutto senza che nessuno se ne accorga.
         *
         * Qui il computer ha già parlato una volta — quindi il metodo è buono —
         * e la risposta dopo arriva **oltre** la scadenza della prima attesa.
         * Prima di oggi era una lettura vuota, cioè un `DC_STATUS_TIMEOUT`.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));

        // Il primo scambio funziona: da qui in poi il metodo ha dimostrato di
        // essere quello giusto.
        manda.send(vec![1, 2, 3]).unwrap();
        assert_eq!(flusso.leggi(10, Duration::from_millis(30)).unwrap(), vec![1, 2, 3]);

        // La risposta dopo tarda più della finestra concessa.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            let _ = manda.send(vec![9, 9]);
        });
        let letto = flusso.leggi(10, Duration::from_millis(30)).unwrap();
        assert_eq!(letto, vec![9, 9], "la risposta è arrivata in ritardo, non è mai mancata");

        let (proroghe, utili, _) = flusso.proroghe();
        assert_eq!(proroghe, 1, "si concede UNA seconda finestra, non un'attesa infinita");
        assert_eq!(utili, 1, "e questa è servita: è il numero che giudica la riga");
    }

    #[test]
    fn unattesa_che_sfora_la_propria_scadenza_rivela_un_processo_fermo() {
        /*
         * Un'attesa che dorme su una scadenza assoluta non può sforarla, se il
         * processo gira: qualche millisecondo di sistema occupato, non di più.
         * Sforarla di mezzo secondo vuol dire che i thread erano fermi mentre
         * l'orologio andava avanti — cioè l'applicazione sospesa, che su iOS è
         * quello che succede appena lo schermo si spegne.
         *
         * Distinguerlo conta perché il rimedio è diverso: un computer che tace
         * è un problema di collegamento, un processo fermo è un problema di
         * schermo. Nel diario le due cose arrivano accanto e insieme
         * rispondono.
         */
        let attesa = Duration::from_millis(100);
        assert!(!e_un_congelamento(Duration::from_millis(100), attesa), "finita in tempo");
        assert!(
            !e_un_congelamento(Duration::from_millis(105), attesa),
            "qualche millisecondo è un sistema occupato, non un congelamento"
        );
        assert!(
            e_un_congelamento(Duration::from_millis(100) + SFORO_DA_CONGELAMENTO * 2, attesa),
            "sforare di molto la propria scadenza si può spiegare in un modo solo"
        );
    }

    #[test]
    fn anche_la_primissima_risposta_ha_diritto_a_un_ultimo_istante() {
        /*
         * ► IL CASO CHE COSTA UN METODO INTERO. ◄ Alla prima risposta di una
         * combinazione mai provata, arrivare un soffio dopo la scadenza non
         * vuol dire «questo metodo non funziona»: vuol dire «ci è mancato un
         * soffio». Ma il giro dei metodi legge la lettura vuota come un vicolo
         * cieco, scarta la combinazione e passa alla successiva — cioè butta
         * via quella giusta.
         *
         * Qui il computer non ha mai parlato (niente seconda finestra intera) e
         * la risposta arriva appena dopo la scadenza: deve essere presa lo
         * stesso.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        std::thread::spawn(move || {
            // Oltre i 20 ms di finestra, dentro i 5 ms + margine dell'ultimo
            // istante... no: nelle prove `ATTESA_FRAMMENTO` è 5 ms, quindi si
            // sceglie un ritardo che sta dentro la somma.
            std::thread::sleep(Duration::from_millis(6));
            let _ = manda.send(vec![7]);
        });
        let letto = flusso.leggi(10, Duration::from_millis(4)).unwrap();
        assert_eq!(letto, vec![7], "un soffio di ritardo non è un metodo sbagliato");
        assert_eq!(flusso.proroghe().0, 0, "l'ultimo istante non è una seconda finestra");
    }

    #[test]
    fn una_lettura_a_vuoto_finisce_nella_registrazione_del_banco_di_prova() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * IL BUCO CHE HA MOSTRATO LA PRIMA REGISTRAZIONE VERA, L'11 SETTEMBRE.
         *
         * Il file conteneva cinque scritture e **nessuna lettura**: le letture
         * erano tornate tutte vuote, e una lettura vuota non produce nessuna
         * notifica da registrare. Si capiva lo stesso — le scritture distavano
         * 4,1 secondi l'una dall'altra, che sono i tre secondi di attesa della
         * libreria più il secondo di sonno del suo ritentativo — **ma solo
         * sapendo già il protocollo**.
         *
         * *Un file che si legge solo se sai già la risposta non è una
         * registrazione: è un promemoria.* E questo file nasce per essere
         * riaperto fra mesi da chi quella cadenza non la ricorda.
         */
        let (manda, ricevi) = channel();
        let righe: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let dove = righe.clone();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_registratore(Box::new(move |r: String| dove.lock().unwrap().push(r)));

        assert!(flusso.leggi(241, Duration::from_millis(10)).unwrap().is_empty());

        let scritte = righe.lock().unwrap().clone();
        assert_eq!(scritte.len(), 1, "una riga per la lettura a vuoto: {scritte:?}");
        assert!(scritte[0].contains("241 byte"), "quanto si era chiesto: {}", scritte[0]);
        assert!(scritte[0].contains("10 ms"), "e quanto si è aspettato: {}", scritte[0]);
        drop(manda);
    }

    #[test]
    #[allow(non_snake_case)] // il maiuscolo è l'enfasi: è lo stile dei nomi delle prove
    fn una_lettura_RIUSCITA_non_si_scrive_due_volte() {
        /*
         * ► IL ROVESCIO. ◄ Una lettura andata bene la racconta già la notifica
         * che è arrivata: scriverla anche qui raddoppierebbe un file che su un
         * archivio pieno ha già migliaia di righe, e un file gonfio è un file
         * che nessuno apre.
         */
        let (manda, ricevi) = channel();
        let righe: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let dove = righe.clone();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())))
            .con_registratore(Box::new(move |r: String| dove.lock().unwrap().push(r)));
        manda.send(vec![1, 2, 3]).unwrap();
        assert_eq!(flusso.leggi(10, Duration::from_millis(50)).unwrap(), vec![1, 2, 3]);
        assert!(righe.lock().unwrap().is_empty(), "niente riga per una lettura riuscita");
    }

    #[test]
    fn un_metodo_che_non_ha_mai_parlato_non_si_prende_il_doppio_del_tempo() {
        /*
         * ► IL ROVESCIO, E PROTEGGE IL GIRO DEI METODI. ◄ Se da questa
         * combinazione di caratteristiche non è mai arrivato niente, il metodo
         * è sbagliato e va cambiato in fretta. Concedere anche lì la seconda
         * finestra raddoppierebbe il tempo di ogni vicolo cieco — cioè
         * renderebbe insopportabile proprio il giro che esiste per uscirne, e
         * su otto metodi da provare è la differenza fra due minuti e quattro.
         */
        let (manda, ricevi) = channel();
        let mut flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        // Il canale resta aperto e muto: `manda` vive fino a fine prova.
        let inizio = std::time::Instant::now();
        assert!(flusso.leggi(10, Duration::from_millis(40)).unwrap().is_empty());
        let passato = inizio.elapsed();
        assert!(
            passato < Duration::from_millis(90),
            "un metodo muto non deve costare due finestre: {passato:?}"
        );
        assert_eq!(flusso.proroghe().0, 0, "nessuna proroga a chi non ha mai risposto");
        drop(manda);
    }

    #[test]
    fn lo_svuotamento_chiesto_da_libdivecomputer_butta_via_davvero_quello_che_aspetta() {
        /*
         * Mares, dopo un pacchetto scaduto, dorme un secondo, svuota
         * l'ingresso e rimanda il comando. Con `purge: None` libdivecomputer
         * rispondeva «successo» senza svuotare, e il ritentativo rileggeva la
         * spazzatura del tentativo prima. La strada vera: `dc_iostream_purge`
         * → `custom.c` → `cb_purge` → `FlussoBle::svuota`.
         */
        let (manda, ricevi) = channel();
        let flusso = FlussoBle::nuovo(ricevi, Box::new(|_| Ok(())));
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        manda.send(vec![0xaa, 0xbb]).unwrap();
        manda.send(vec![0xcc]).unwrap();
        collegamento.imposta_attesa(50);

        assert_eq!(collegamento.svuota(), DC_STATUS_SUCCESS);
        assert!(collegamento.leggi(10).is_err(), "dopo lo svuotamento non c'è più niente");

        // E svuota anche l'avanzo di una notifica letta a metà.
        manda.send(vec![1, 2, 3, 4]).unwrap();
        assert_eq!(collegamento.leggi(2).unwrap(), vec![1, 2]);
        collegamento.svuota();
        manda.send(vec![9]).unwrap();
        assert_eq!(collegamento.leggi(10).unwrap(), vec![9], "l'avanzo [3, 4] deve essere sparito");
    }

    /// Un flusso che sa le tre cose dell'accoppiamento, e registra cosa gli è
    /// stato chiesto e cosa gli è stato dato da conservare.
    struct ConSegreti {
        pin: Option<String>,
        codice: Option<Vec<u8>>,
        conservato: Arc<Mutex<Option<Vec<u8>>>>,
        chieste: Arc<Mutex<usize>>,
    }

    impl FlussoByte for ConSegreti {
        fn scrivi(&mut self, _dati: &[u8]) -> Result<(), GuastoScrittura> {
            Err("questo flusso non scrive: è qui per le ioctl".into())
        }
        fn leggi(&mut self, _quanti: usize, _attesa: Duration) -> Result<Vec<u8>, String> {
            Err("il collegamento Bluetooth si è chiuso".into())
        }
        fn disponibili(&mut self) -> usize {
            0
        }
        fn codice_pin(&mut self) -> Option<String> {
            *self.chieste.lock().unwrap() += 1;
            self.pin.clone()
        }
        fn codice_accesso(&mut self) -> Option<Vec<u8>> {
            self.codice.clone()
        }
        fn salva_codice_accesso(&mut self, codice: &[u8]) {
            *self.conservato.lock().unwrap() = Some(codice.to_vec());
        }
    }

    #[allow(clippy::type_complexity)]
    fn con_segreti(
        pin: Option<&str>,
        codice: Option<Vec<u8>>,
    ) -> (CollegamentoLdc, Arc<Mutex<Option<Vec<u8>>>>, Arc<Mutex<usize>>) {
        let conservato = Arc::new(Mutex::new(None));
        let chieste = Arc::new(Mutex::new(0));
        let flusso = ConSegreti {
            pin: pin.map(String::from),
            codice,
            conservato: conservato.clone(),
            chieste: chieste.clone(),
        };
        (CollegamentoLdc::apri(Box::new(flusso)).unwrap(), conservato, chieste)
    }

    #[test]
    fn il_pin_arriva_come_stringa_c_nel_buffer_da_sette_byte_del_pelagic() {
        /*
         * La strada vera: `dc_iostream_ioctl` → `custom.c` → `cb_ioctl`. È
         * quella che `pelagic_i330r_init` percorre dopo aver acceso il PIN
         * sullo schermo del computer, e l'unica in cui un «non supportato»
         * non è tollerato: è dove si fermava l'i330R del centro sub.
         *
         * Sette byte non è un numero scelto da noi: è `char pincode[6 + 1]`
         * in `pelagic_i330r.c`.
         */
        let (collegamento, _, chieste) = con_segreti(Some("482915"), None);
        let mut buffer = [0xffu8; 7];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_PINCODE, &mut buffer), DC_STATUS_SUCCESS);
        assert_eq!(&buffer[..6], b"482915");
        assert_eq!(buffer[6], 0, "terminata da zero, come una stringa C");
        assert_eq!(*chieste.lock().unwrap(), 1, "si chiede una volta sola");
    }

    #[test]
    fn un_pin_piu_lungo_del_posto_e_un_errore_e_non_un_troncamento() {
        /*
         * ► IL CUORE DI QUESTA `ioctl`. ◄ Troncare darebbe al computer un PIN
         * **diverso** da quello digitato, e il computer lo rifiuterebbe: il
         * sintomo sarebbe «codice errato» a chi ha digitato quello giusto, che
         * è il modo peggiore di sbagliare. Un errore qui è leggibile; un
         * numero troncato no.
         */
        let (collegamento, _, _) = con_segreti(Some("4829150"), None);
        let mut buffer = [0xffu8; 7];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_PINCODE, &mut buffer), DC_STATUS_INVALIDARGS);
        assert_eq!(buffer, [0xff; 7], "il buffer non va toccato");
        assert!(
            collegamento.spiega(DC_STATUS_INVALIDARGS).contains("7 cifre e ce ne stanno 6"),
            "{}",
            collegamento.spiega(DC_STATUS_INVALIDARGS)
        );

        // E quello che cifra non è: `pelagic_i330r_init_passcode` lo
        // rifiuterebbe comunque, ma con la causa dalla sua parte e non dalla
        // nostra — e il diario che si allega a una segnalazione è il nostro.
        let (collegamento, _, _) = con_segreti(Some("48291a"), None);
        let mut buffer = [0xffu8; 7];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_PINCODE, &mut buffer), DC_STATUS_INVALIDARGS);
        assert!(collegamento.spiega(DC_STATUS_INVALIDARGS).contains("non è una cifra"));
    }

    #[test]
    fn senza_pin_si_dice_non_supportato_e_il_backend_si_ferma_dicendo_cosa_manca() {
        // Chi rinuncia lo sa già: qui non si annota niente, e si risponde la
        // sola cosa vera — «non lo so».
        let (collegamento, _, chieste) = con_segreti(None, None);
        let mut buffer = [0xffu8; 7];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_PINCODE, &mut buffer), DC_STATUS_UNSUPPORTED);
        assert_eq!(buffer, [0xff; 7]);
        assert_eq!(*chieste.lock().unwrap(), 1);
    }

    #[test]
    fn il_codice_di_accesso_conservato_si_restituisce_solo_se_e_intero() {
        // Sedici byte, che è quanto `pelagic_i330r_device_t` tiene da parte.
        let buono: Vec<u8> = (1u8..=16).collect();
        let (collegamento, _, _) = con_segreti(None, Some(buono.clone()));
        let mut buffer = [0u8; 16];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_ACCESSCODE, &mut buffer), DC_STATUS_SUCCESS);
        assert_eq!(&buffer[..], &buono[..]);

        /*
         * ► LA LUNGHEZZA SBAGLIATA NON RIEMPIE MEZZO BUFFER. ◄ Riempirlo a
         * metà darebbe un codice inventato, e il computer chiuderebbe il
         * collegamento senza dire perché. «Non supportato» invece è la
         * risposta che `pelagic_i330r_init` tollera apposta: riparte dal PIN,
         * che funziona sempre.
         */
        let (collegamento, _, _) = con_segreti(None, Some(vec![1, 2, 3]));
        let mut buffer = [0xffu8; 16];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_ACCESSCODE, &mut buffer), DC_STATUS_UNSUPPORTED);
        assert_eq!(buffer, [0xff; 16], "il buffer non va toccato");
        assert!(collegamento.spiega(DC_STATUS_UNSUPPORTED).contains("si riparte dal PIN"));

        // E tutti zeri è esattamente ciò che il backend legge come «non c'è»:
        // restituirlo come se fosse un codice nasconderebbe una conservazione
        // andata storta dietro un comportamento normale.
        let (collegamento, _, _) = con_segreti(None, Some(vec![0; 16]));
        let mut buffer = [0xffu8; 16];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_ACCESSCODE, &mut buffer), DC_STATUS_UNSUPPORTED);
        assert!(collegamento.spiega(DC_STATUS_UNSUPPORTED).contains("tutto zeri"));

        // Senza niente da parte: la prima volta, ed è normale.
        let (collegamento, _, _) = con_segreti(None, None);
        let mut buffer = [0xffu8; 16];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_GET_ACCESSCODE, &mut buffer), DC_STATUS_UNSUPPORTED);
        assert_eq!(buffer, [0xff; 16]);
    }

    #[test]
    fn il_codice_di_accesso_nuovo_si_conserva_e_i_byte_vanno_nel_verso_opposto() {
        /*
         * L'unica `ioctl` di questo trasporto in cui i byte si LEGGONO dal
         * buffer invece di scriverli: la direzione sta nel bit più alto della
         * richiesta, `0x8000_6202` contro `0x4000_6202`. Confonderle darebbe
         * un codice di zeri conservato al posto di quello vero, e il PIN
         * richiesto a ogni scarico senza che nessuno capisca perché.
         */
        let (collegamento, conservato, _) = con_segreti(None, None);
        let mut codice: Vec<u8> = (0xa0u8..0xb0).collect();
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_SET_ACCESSCODE, &mut codice), DC_STATUS_SUCCESS);
        assert_eq!(conservato.lock().unwrap().as_deref(), Some(&codice[..]));

        // Zero byte non è un codice: non si conserva niente e si dice.
        let (collegamento, conservato, _) = con_segreti(None, None);
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_SET_ACCESSCODE, &mut []), DC_STATUS_UNSUPPORTED);
        assert!(conservato.lock().unwrap().is_none());
    }

    #[test]
    fn una_caratteristica_che_risponde_meno_byte_del_richiesto_e_formato_dati_non_zeri() {
        let (collegamento, _) = con_accessori(None, Ok(vec![1, 2]));
        let mut buffer = [0u8; 16 + 5];
        assert_eq!(collegamento.ioctl(DC_IOCTL_BLE_CHARACTERISTIC_READ, &mut buffer), DC_STATUS_DATAFORMAT);
        assert!(collegamento.spiega(DC_STATUS_DATAFORMAT).contains("ne servivano 5"));
    }

    #[test]
    fn il_numero_di_libdivecomputer_arriva_con_il_nome_e_con_la_causa() {
        /*
         * «stato -6» da solo ha mandato una segnalazione vera a cercare il
         * guasto dalla parte sbagliata. Il messaggio deve dire il nome dello
         * stato E quello che il trasporto ha annotato: qui la scrittura che
         * il flusso rifiuta.
         */
        let Some(descrittore) = trova_descrittore("Scubapro", "Aladin Sport Matrix") else {
            panic!("il descrittore dell’Aladin Sport Matrix deve esistere");
        };
        let (collegamento, _) = con_accessori(None, Ok(vec![]));
        let errore = match collegamento.scarica(&descrittore) {
            Ok(_) => panic!("il flusso rifiuta di scrivere: lo scarico non può riuscire"),
            Err(errore) => errore,
        };
        assert!(errore.contains("stato -6, errore di trasmissione"), "{errore}");
        assert!(errore.contains("scrittura di"), "{errore}");
        assert!(errore.contains("è qui per le ioctl"), "{errore}");

        assert_eq!(nome_stato(-7), "tempo scaduto");
        assert_eq!(nome_stato(-8), "errore di protocollo");
        assert_eq!(nome_stato(-1), "non supportato");
    }

    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► UN INDICE DI BOMBOLA FUORI SCALA NON DEVE DIVENTARE UN'ALLOCAZIONE. ◄
     *
     * `0xFFFFFFFF` è un valore che la libreria manda davvero:
     * `shearwater_predator_parser.c` lo usa come `UNDEFINED` e lo passa senza
     * controllarlo, e `suunto_eonsteel_parser.c` ci arriva con un `gasnr - 1`
     * partito da zero. Prima del tetto quel numero diventava
     * `resize(4_294_967_296)` di elementi da sedici byte — 64 GiB — e in Rust
     * un'allocazione fallita è `abort()`: moriva il processo intero.
     *
     * Questa prova non può vedere l'abort (ucciderebbe anche il processo di
     * prova): vede il **rimedio**, cioè che la lettura viene scartata, contata,
     * e che il vettore delle pressioni resta della misura di prima.
     */
    #[test]
    fn un_indice_di_bombola_assurdo_viene_scartato_e_contato() {
        let mut acc = Accumulatore {
            immersione: ImmersioneLdc::default(),
            corrente: CampioneLdc::default(),
            iniziato: false,
            quante_bombole: 0,
            miscela_corrente: None,
            pressioni_fuori_scala: 0,
        };
        let utente = &mut acc as *mut Accumulatore as *mut c_void;

        campione(CAMPIONE_TEMPO, &ValoreCampione { tempo: 0 }, utente);
        // Prima quella buona, così si vede che il vettore resta com'era.
        campione(
            CAMPIONE_PRESSIONE,
            &ValoreCampione { pressione: PressioneCampione { bombola: 0, valore: 200.0 } },
            utente,
        );
        assert_eq!(acc.corrente.pressione_bar.len(), 1);

        for assurdo in [0xFFFF_FFFFu32, 0xFFFF_FFFE, 1_000_000, 16] {
            campione(
                CAMPIONE_PRESSIONE,
                &ValoreCampione {
                    pressione: PressioneCampione { bombola: assurdo, valore: 111.0 },
                },
                utente,
            );
        }

        assert_eq!(acc.corrente.pressione_bar.len(), 1, "il vettore è cresciuto");
        assert_eq!(acc.corrente.pressione_bar[0], Some(200.0), "persa la lettura buona");
        assert_eq!(acc.quante_bombole, 1);
        assert_eq!(acc.pressioni_fuori_scala, 4, "gli scarti non sono stati contati");
    }

    /// E il tetto non deve stringere su nessun apparecchio vero: `NTANKS` di
    /// Shearwater vale sei, ed è il più generoso fra quelli che conosciamo.
    #[test]
    fn le_bombole_vere_ci_stanno_tutte() {
        let mut acc = Accumulatore {
            immersione: ImmersioneLdc::default(),
            corrente: CampioneLdc::default(),
            iniziato: false,
            quante_bombole: 0,
            miscela_corrente: None,
            pressioni_fuori_scala: 0,
        };
        let utente = &mut acc as *mut Accumulatore as *mut c_void;
        campione(CAMPIONE_TEMPO, &ValoreCampione { tempo: 0 }, utente);
        for b in 0..6u32 {
            campione(
                CAMPIONE_PRESSIONE,
                &ValoreCampione {
                    pressione: PressioneCampione { bombola: b, valore: 200.0 - b as f64 },
                },
                utente,
            );
        }
        assert_eq!(acc.quante_bombole, 6);
        assert_eq!(acc.pressioni_fuori_scala, 0);
        assert_eq!(acc.corrente.pressione_bar[5], Some(195.0));
    }
}

#[cfg(test)]
mod prove_data_e_bombole {
    use super::*;

    fn quando(anno: c_int, mese: c_uint, giorno: c_uint, ora: c_uint) -> DcDatetime {
        DcDatetime { anno, mese, giorno, ora, minuto: 0, secondo: 0, fuso: 0 }
    }

    /// ► IL CONTROLLO ERA `anno != 0`, E BASTA. ◄
    ///
    /// Tutto il resto entrava come data certa: mese 0, giorno 0, ora 31, anno
    /// 4095 — cioè i valori che escono da un blocco di memoria non
    /// inizializzato o da un computer a cui non è mai stata messa l'ora.
    /// `millisecondi` è aritmetica pura e non si lamenta: produce un istante, e
    /// quell'istante finisce in archivio con la catena dei tessuti e le
    /// statistiche per giornata appresso.
    ///
    /// Meglio nessuna data — che l'applicazione sa mostrare e far correggere a
    /// mano — che una data sbagliata di tre mesi.
    #[test]
    fn una_data_impossibile_non_e_una_data() {
        assert!(data_plausibile(&quando(2026, 6, 14, 10)), "una data vera deve passare");
        assert!(data_plausibile(&quando(1950, 1, 1, 0)), "il limite basso passa");
        assert!(data_plausibile(&quando(2100, 12, 31, 23)), "il limite alto passa");

        assert!(!data_plausibile(&quando(0, 1, 1, 0)), "anno zero");
        assert!(!data_plausibile(&quando(4095, 6, 14, 10)), "anno da memoria sporca");
        assert!(!data_plausibile(&quando(2026, 0, 14, 10)), "mese zero");
        assert!(!data_plausibile(&quando(2026, 13, 14, 10)), "mese tredici");
        assert!(!data_plausibile(&quando(2026, 6, 0, 10)), "giorno zero");
        assert!(!data_plausibile(&quando(2026, 6, 32, 10)), "giorno trentadue");

        /*
         * ► I GIORNI CHE NEL LORO MESE NON ESISTONO. ◄ Passavano tutti, e non
         * restavano strani: `millisecondi` li arrotonda in avanti — il 31
         * febbraio 2026 diventa il 3 marzo — e la data entrava certa, spostata
         * fino a tre giorni.
         */
        assert!(!data_plausibile(&quando(2026, 2, 31, 10)), "31 febbraio");
        assert!(!data_plausibile(&quando(2026, 2, 30, 10)), "30 febbraio");
        assert!(!data_plausibile(&quando(2026, 2, 29, 10)), "29 febbraio di un anno non bisestile");
        assert!(!data_plausibile(&quando(2026, 4, 31, 10)), "31 aprile");
        assert!(!data_plausibile(&quando(2026, 6, 31, 10)), "31 giugno");
        assert!(!data_plausibile(&quando(2026, 9, 31, 10)), "31 settembre");
        assert!(!data_plausibile(&quando(2026, 11, 31, 10)), "31 novembre");

        // E i giorni che invece esistono devono continuare a passare, altrimenti
        // il controllo avrebbe solo cambiato verso: un'immersione vera buttata
        // via è lo stesso guasto dall'altra parte.
        assert!(data_plausibile(&quando(2026, 2, 28, 10)), "28 febbraio");
        assert!(data_plausibile(&quando(2024, 2, 29, 10)), "29 febbraio di un anno bisestile");
        assert!(data_plausibile(&quando(2000, 2, 29, 10)), "il 2000 è bisestile");
        assert!(!data_plausibile(&quando(1900, 2, 29, 10)), "il 1900 no");
        assert!(!data_plausibile(&quando(2100, 2, 29, 10)), "e nemmeno il 2100");
        assert!(data_plausibile(&quando(2026, 4, 30, 10)), "30 aprile");
        assert!(data_plausibile(&quando(2026, 12, 31, 10)), "31 dicembre");
        assert!(!data_plausibile(&quando(2026, 6, 14, 31)), "ora trentuno");
        assert!(!data_plausibile(&DcDatetime { minuto: 99, ..quando(2026, 6, 14, 10) }));
        assert!(!data_plausibile(&DcDatetime { secondo: 99, ..quando(2026, 6, 14, 10) }));
    }

    /// ► UNA VOCE CHE NON SI LEGGE LASCIA IL SUO POSTO VUOTO. ◄
    ///
    /// Bombole e miscele sono l'indirizzo con cui i campioni parlano:
    /// `CampioneLdc.pressione_bar` è indicizzata sulle bombole e
    /// `gas_mix_index` sulle miscele. Saltando la voce rifiutata — capita sui
    /// Mares in unità imperiali — tutte quelle dopo scalavano di uno, e il
    /// contenuto di una finiva attribuito a un'altra.
    ///
    /// ► LA PROVA DI PRIMA NON POTEVA VEDERLO. ◄ Costruiva a mano un `Vec` con
    /// il posto vuoto dentro e poi controllava che il posto vuoto ci fosse:
    /// *una prova che legge il valore che sta controllando non può vederlo
    /// cambiare.* Il codice vero poteva tornare a fare `push` condizionato e
    /// lei restava verde — ed è esattamente quello che è successo alle
    /// miscele, rimaste col difetto mentre la prova sulle bombole era verde.
    ///
    /// Adesso esercita `lista_allineata`, che è la funzione che i due
    /// chiamanti usano davvero, con un lettore finto che rifiuta la seconda
    /// voce.
    #[test]
    fn il_posto_della_voce_illeggibile_resta() {
        let bombole: Vec<BombolaLdc> = lista_allineata(3, |i| {
            // La seconda (indice 1) è quella che la libreria rifiuta.
            (i != 1).then(|| BombolaLdc {
                indice_gas: Some(i as usize),
                volume_l: Some(12.0),
                pressione_iniziale_bar: Some(200.0 + f64::from(i)),
                pressione_finale_bar: Some(50.0),
            })
        });
        assert_eq!(bombole.len(), 3, "il posto della bombola illeggibile resta");
        assert_eq!(bombole[2].pressione_iniziale_bar, Some(202.0), "la terza è ancora la terza");
        assert!(bombole[1].volume_l.is_none(), "e quella in mezzo non dichiara niente");
        assert!(bombole[1].indice_gas.is_none());

        /*
         * LE MISCELE, che è il difetto misurato il 16 settembre 2026.
         *
         * Aria di fondo, un gas intermedio che la libreria rifiuta, ossigeno
         * puro per le soste. Scalando, l'indice 1 — quello che il campione usa
         * a venti metri — trovava l'ossigeno: PPO2 di picco da 1.06 a **1.62**.
         */
        let gas: Vec<GasLdc> = lista_allineata(3, |i| match i {
            0 => Some(GasLdc { o2: 0.21, he: 0.0 }),
            1 => None,
            _ => Some(GasLdc { o2: 1.0, he: 0.0 }),
        });
        assert_eq!(gas.len(), 3, "il posto della miscela illeggibile resta");
        assert_eq!(gas[2].o2, 1.0, "l'ossigeno è ancora il terzo");
        assert_eq!(
            gas[1].o2, 0.0,
            "e quella in mezzo non dichiara niente: `o2 = 0` non è una miscela possibile, \
             ed è così che il lato TypeScript riconosce il posto vuoto"
        );
    }

    /// La lista vuota e la lista intera, cioè i due bordi.
    #[test]
    fn lista_allineata_ai_bordi() {
        let niente: Vec<GasLdc> = lista_allineata(0, |_| Some(GasLdc { o2: 0.21, he: 0.0 }));
        assert!(niente.is_empty(), "zero voci fanno una lista vuota, non una voce vuota");

        let tutte: Vec<GasLdc> =
            lista_allineata(4, |i| Some(GasLdc { o2: 0.2 + f64::from(i) / 100.0, he: 0.0 }));
        assert_eq!(tutte.len(), 4);
        assert_eq!(tutte[3].o2, 0.23, "senza rifiuti l'ordine è quello di lettura");

        let nessuna: Vec<GasLdc> = lista_allineata(2, |_| None);
        assert_eq!(nessuna.len(), 2, "due voci illeggibili restano due posti vuoti");
    }
}

/// ════════════════════════════════════════════════════════════════════════════
/// ► IL BANCO PER FAMIGLIA: UN COMPUTER FINTO PER OGNI PROTOCOLLO NUOVO. ◄
///
/// Qui di computer subacquei ce n'è uno. Per tutti gli altri, la domanda «si
/// scarica?» ha due metà, e una sola si può misurare da qui: se **il nostro
/// trasporto** consegna alla libreria quello che la libreria si aspetta —
/// notifiche intere o spezzate, scritture della misura giusta, l'ordine delle
/// risposte. L'altra metà — come parla la radio di quel modello — resta un
/// fatto di chi ce l'ha in mano.
///
/// Ogni finto qui sotto parla il protocollo **come lo scrive il sorgente della
/// libreria**, e passa dal `FlussoBle` vero con la politica che il ponte usa
/// per quel computer: è la metà misurabile, misurata. *Un finto scritto
/// leggendo la libreria non prova che la libreria abbia ragione sul computer:
/// prova che fra lei e noi non si perde niente.*
#[cfg(test)]
mod banco_per_famiglia {
    use super::*;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Arc, Mutex};

    // ─────────────────────────────────────────────── la codifica SLIP (RFC 1055)

    const END: u8 = 0xC0;
    const ESC: u8 = 0xDB;
    const ESC_END: u8 = 0xDC;
    const ESC_ESC: u8 = 0xDD;

    fn slip(dati: &[u8]) -> Vec<u8> {
        let mut fuori = Vec::with_capacity(dati.len() + 2);
        for &b in dati {
            match b {
                END => fuori.extend_from_slice(&[ESC, ESC_END]),
                ESC => fuori.extend_from_slice(&[ESC, ESC_ESC]),
                _ => fuori.push(b),
            }
        }
        fuori.push(END);
        fuori
    }

    fn de_slip(dati: &[u8]) -> Vec<u8> {
        let mut fuori = Vec::with_capacity(dati.len());
        let mut dopo_esc = false;
        for &b in dati {
            if dopo_esc {
                fuori.push(match b {
                    ESC_END => END,
                    ESC_ESC => ESC,
                    altro => altro,
                });
                dopo_esc = false;
            } else if b == ESC {
                dopo_esc = true;
            } else {
                fuori.push(b);
            }
        }
        fuori
    }

    /// Manda una risposta come notifiche della misura data: è la radio che
    /// decide dove spezzare, non il protocollo.
    fn in_notifiche(manda: &Sender<Vec<u8>>, byte: &[u8], misura: usize) {
        for pezzo in byte.chunks(misura) {
            let _ = manda.send(pezzo.to_vec());
        }
    }

    // ──────────────────────────────────── Shearwater Perdix 3, protocollo «V2»

    /// La compressione delle immersioni Shearwater, al contrario: prima lo XOR a
    /// blocchi di 32, poi la codifica a nove bit — ogni byte un valore col bit
    /// alto acceso, e uno zero in fondo. Lo scrive `shearwater_common.c`
    /// (`decompress_xor`, `decompress_lre`); qui si fa l'inverso.
    ///
    /// Esce a gruppi di nove byte, perché la libreria decomprime **blocco per
    /// blocco** e pretende che ogni blocco sia un numero intero di valori.
    fn comprimi_shearwater(immersione: &[u8]) -> Vec<u8> {
        let mut xor = immersione.to_vec();
        for i in (32..xor.len()).rev() {
            xor[i] ^= immersione[i - 32];
        }
        let mut valori: Vec<u16> = xor.iter().map(|&b| 0x100 | b as u16).collect();
        valori.push(0);
        while valori.len() % 8 != 0 {
            valori.push(0);
        }
        let mut fuori = Vec::with_capacity(valori.len() * 9 / 8);
        for gruppo in valori.chunks(8) {
            let mut bit: u128 = 0;
            for &v in gruppo {
                bit = (bit << 9) | v as u128;
            }
            for i in (0..9).rev() {
                fuori.push((bit >> (i * 8)) as u8);
            }
        }
        fuori
    }

    /// Un Perdix 3 finto: memoria, modello, firmware, e le misure di quello che
    /// ha visto arrivare.
    struct StatoPerdix3 {
        immersioni: Vec<([u8; 4], Vec<u8>)>,
        /// I byte della trama in arrivo, fino al prossimo `END`.
        in_arrivo: Vec<u8>,
        /// Il trasferimento in corso: i byte ancora da mandare e il prossimo blocco.
        in_uscita: VecDeque<u8>,
        blocco: u8,
        /// Quanto è grande un blocco di dati: la libreria lo sa dalla risposta
        /// all'inizio del trasferimento.
        blocco_massimo: usize,
        misura_notifica: usize,
        richieste: Vec<Vec<u8>>,
        scrittura_piu_lunga: usize,
        trame_con_intestazione: usize,
    }

    const MANIFESTO: u32 = 0xE000_0000;
    const BASE_REGISTRO: u32 = 0x8000_0000;

    impl StatoPerdix3 {
        fn manifesto(&self) -> Vec<u8> {
            let mut m = vec![0u8; 0x600];
            for (i, (impronta, _)) in self.immersioni.iter().enumerate() {
                let r = &mut m[i * 0x20..(i + 1) * 0x20];
                r[0] = 0xA5;
                r[1] = 0xC4;
                r[4..8].copy_from_slice(impronta);
                r[20..24].copy_from_slice(&((i as u32 + 1) * 0x0001_0000).to_be_bytes());
            }
            m
        }

        fn rispondi(&mut self, richiesta: &[u8]) -> Option<Vec<u8>> {
            match richiesta {
                // RDBI: seriale in esadecimale, firmware «V99», modello 14, e
                // il formato del registro (il Petrel Native Format, 0x80000000).
                [0x22, alto, basso] => {
                    let dati: Vec<u8> = match u16::from_be_bytes([*alto, *basso]) {
                        0x8010 => b"0A1B2C3D".to_vec(),
                        0x8011 => b"V99".to_vec(),
                        0x8060 => vec![14],
                        0x8021 => {
                            let mut v = vec![0u8; 9];
                            v[1..5].copy_from_slice(&BASE_REGISTRO.to_be_bytes());
                            v
                        }
                        _ => return Some(vec![0x7F, 0x22, 0x31]),
                    };
                    Some([&[0x62, *alto, *basso][..], &dati].concat())
                }
                // L'inizio di un trasferimento: dove e quanto, e se compresso.
                [0x35, compressione, 0x34, a3, a2, a1, a0, ..] => {
                    let indirizzo = u32::from_be_bytes([*a3, *a2, *a1, *a0]);
                    let dati = if indirizzo == MANIFESTO {
                        self.manifesto()
                    } else {
                        let quale = ((indirizzo - BASE_REGISTRO) >> 16) as usize - 1;
                        let (_, immersione) = &self.immersioni[quale];
                        assert_eq!(*compressione, 0x10, "le immersioni si chiedono compresse");
                        comprimi_shearwater(immersione)
                    };
                    self.in_uscita = dati.into();
                    self.blocco = 1;
                    let massimo = (self.blocco_massimo as u16).to_be_bytes();
                    Some(vec![0x75, 0x20, massimo[0], massimo[1]])
                }
                // Un blocco. Per la compressione, un numero intero di gruppi di
                // nove byte: vedi `comprimi_shearwater`.
                [0x36, blocco, 0x00] => {
                    assert_eq!(*blocco, self.blocco, "i blocchi si chiedono in ordine");
                    let quanti = self.in_uscita.len().min(self.blocco_massimo / 9 * 9);
                    let mut r = vec![0x76, *blocco];
                    r.extend(self.in_uscita.drain(..quanti));
                    self.blocco = self.blocco.wrapping_add(1);
                    Some(r)
                }
                [0x37] => Some(vec![0x77, 0x00]),
                // Lo spegnimento alla chiusura: nessuna risposta.
                [0x2E, 0x90, 0x20, 0x00] => None,
                altro => panic!("il Perdix 3 finto non conosce la richiesta {altro:02x?}"),
            }
        }
    }

    /// Il Perdix 3 finto dietro un `FlussoBle` vero, come lo costruisce il
    /// ponte per Shearwater: una notifica per lettura (`UnaNotifica`), niente
    /// ascolto prima di parlare.
    fn finto_perdix3(
        immersioni: Vec<([u8; 4], Vec<u8>)>,
        misura_notifica: usize,
    ) -> (FlussoBle, Arc<Mutex<StatoPerdix3>>) {
        let (manda, ricevi) = channel::<Vec<u8>>();
        let stato = Arc::new(Mutex::new(StatoPerdix3 {
            immersioni,
            in_arrivo: Vec::new(),
            in_uscita: VecDeque::new(),
            blocco: 1,
            blocco_massimo: 0x400,
            misura_notifica,
            richieste: Vec::new(),
            scrittura_piu_lunga: 0,
            trame_con_intestazione: 0,
        }));
        let dentro = stato.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            let mut s = dentro.lock().unwrap();
            s.scrittura_piu_lunga = s.scrittura_piu_lunga.max(dati.len());
            // Il V1 su BLE mette due byte davanti a ogni pezzo (quanti pezzi, e
            // quale): il V2 no. Una trama che comincia senza 0xFF 0x01 è una
            // trama col formato del Perdix di prima.
            if s.in_arrivo.is_empty() && dati.first() != Some(&0xFF) {
                s.trame_con_intestazione += 1;
            }
            for &b in dati {
                if b != END {
                    s.in_arrivo.push(b);
                    continue;
                }
                if s.in_arrivo.is_empty() {
                    continue;
                }
                let trama = de_slip(&std::mem::take(&mut s.in_arrivo));
                // FF 01 00 <lunghezza su due byte> <richiesta>
                assert_eq!(&trama[..3], &[0xFF, 0x01, 0x00], "intestazione V2: {trama:02x?}");
                let lunghezza = u16::from_be_bytes([trama[3], trama[4]]) as usize;
                let richiesta = trama[5..5 + lunghezza].to_vec();
                s.richieste.push(richiesta.clone());
                if let Some(risposta) = s.rispondi(&richiesta) {
                    let n = (risposta.len() as u16).to_be_bytes();
                    let pacchetto = [&[0x01, 0xFF, 0x00, n[0], n[1]][..], &risposta].concat();
                    in_notifiche(&manda, &slip(&pacchetto), s.misura_notifica);
                }
            }
            Ok(())
        });
        (FlussoBle::nuovo(ricevi, scrittura), stato)
    }

    /// Un'immersione finta, riconoscibile byte per byte.
    fn registro_finto(semina: u8, quanti: usize, impronta: [u8; 4]) -> Vec<u8> {
        let mut v: Vec<u8> = (0..quanti).map(|i| (i as u8).wrapping_mul(7).wrapping_add(semina)).collect();
        // Dove la libreria legge l'impronta: dal byte 12.
        v[12..16].copy_from_slice(&impronta);
        // Qualche END ed ESC in mezzo, perché la codifica SLIP li deve
        // attraversare anche dentro i dati.
        v[40] = END;
        v[41] = ESC;
        v
    }

    #[test]
    fn perdix3_scarica_attraverso_il_nostro_trasporto_con_ogni_misura_di_notifica() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL PERDIX 3, DA CAPO A FONDO. ◄
         *
         * Il modello nuovo più atteso della libreria nuova, e il solo che il
         * driver di casa avrebbe letto male (vedi `scelta.ts`): con la regola
         * dei numeri di modello va a libdivecomputer, e qui si misura che da lì
         * arrivi davvero in fondo. Il protocollo «V2» di `shearwater_common.c`:
         * niente intestazione di due byte sulle scritture BLE, cornice da
         * cinque, SLIP sopra, letture fino a 514 byte, immersioni compresse.
         *
         * Tre misure di notifica, quelle che i telefoni negoziano davvero: 20
         * (l'MTU di partenza di Android), 182 (iOS), 509 (un Mac). Una
         * risposta del Perdix attraversa più notifiche, e una notifica può
         * contenere la fine di una trama e l'inizio della successiva — che è
         * il caso in cui un trasporto che unisce o taglia male perde i byte.
         */
        let descrittore = trova_descrittore("Shearwater", "Perdix 3").expect("il Perdix 3 deve esserci");
        assert_eq!(descrittore.modello(), 14);
        let prima = registro_finto(3, 700, [0x11, 0x22, 0x33, 0x44]);
        let seconda = registro_finto(9, 1500, [0x55, 0x66, 0x77, 0x88]);
        for misura in [20usize, 182, 509] {
            let (flusso, stato) = finto_perdix3(
                vec![([0xA1, 0xA2, 0xA3, 0xA4], prima.clone()), ([0xB1, 0xB2, 0xB3, 0xB4], seconda.clone())],
                misura,
            );
            let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
            let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
            assert!(esito.guasto.is_none(), "notifiche da {misura}: {:?}", esito.guasto);
            let dichiarato = esito.dichiarato.expect("il Perdix 3 si presenta");
            assert_eq!((dichiarato.modello, dichiarato.firmware), (14, 99), "notifiche da {misura}");
            assert_eq!(esito.immersioni.len(), 2, "notifiche da {misura}");
            assert_eq!(esito.immersioni[0].dati, prima, "notifiche da {misura}: la prima, byte per byte");
            assert_eq!(esito.immersioni[1].dati, seconda, "notifiche da {misura}: la seconda, byte per byte");
            assert_eq!(esito.immersioni[0].impronta, vec![0x11, 0x22, 0x33, 0x44]);
            let s = stato.lock().unwrap();
            assert!(
                s.scrittura_piu_lunga <= 20,
                "il V2 scrive a pezzi da 20 byte: visto {}",
                s.scrittura_piu_lunga
            );
            assert_eq!(s.trame_con_intestazione, 0, "nessuna trama col formato del Perdix di prima");
            assert!(
                s.richieste.iter().any(|r| r.as_slice() == [0x2E, 0x90, 0x20, 0x00]),
                "alla chiusura il computer si spegne"
            );
        }
    }

    #[test]
    fn perdix3_appena_azzerato_da_zero_immersioni_e_nessun_errore() {
        let descrittore = trova_descrittore("Shearwater", "Perdix 3").unwrap();
        let (flusso, stato) = finto_perdix3(Vec::new(), 182);
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
        assert!(esito.guasto.is_none(), "{:?}", esito.guasto);
        assert!(esito.immersioni.is_empty());
        // Il manifesto si chiede una volta sola: vuoto vuol dire finito.
        let inizi = stato.lock().unwrap().richieste.iter().filter(|r| r.first() == Some(&0x35)).count();
        assert_eq!(inizi, 1);
    }

    // ──────────────────────────────────────── Cressi (Goa, Cartesio, Leonardo 2.0…)

    /// Chi risponde alle letture di caratteristica: la versione dei Cressi via
    /// BLE non si chiede con un comando, si legge da tre caratteristiche
    /// (`cressi_goa.c`, «there is no variant of the CMD_VERSION command»).
    struct CaratteristicheCressi {
        valori: Vec<([u8; 16], Vec<u8>)>,
        lette: Arc<Mutex<Vec<[u8; 16]>>>,
    }

    impl AccessoriBle for CaratteristicheCressi {
        fn nome(&mut self) -> Option<String> {
            None
        }
        fn leggi_caratteristica(&mut self, uuid: [u8; 16]) -> Result<Vec<u8>, String> {
            self.lette.lock().unwrap().push(uuid);
            self.valori
                .iter()
                .find(|(u, _)| *u == uuid)
                .map(|(_, v)| v.clone())
                .ok_or_else(|| "caratteristica sconosciuta al Cressi finto".to_string())
        }
    }

    /// `6E4000xx-B5A3-F393-E0A9-E50E24DC10B8`, il servizio Nordic dei Cressi.
    fn uuid_cressi(n: u8) -> [u8; 16] {
        [0x6E, 0x40, 0x00, n, 0xB5, 0xA3, 0xF3, 0x93, 0xE0, 0xA9, 0xE5, 0x0E, 0x24, 0xDC, 0x10, 0xB8]
    }

    /// Una risposta lunga dei Cressi via BLE: due byte di lunghezza, i dati,
    /// in pacchetti da 512 (l'ultimo riempito), ogni pacchetto spezzato dalla
    /// radio nella misura della notifica, e in fondo «EOT xmodem» in una
    /// notifica sua.
    fn manda_cressi(manda: &Sender<Vec<u8>>, dati: &[u8], misura: usize) {
        let mut flusso = (dati.len() as u16).to_le_bytes().to_vec();
        flusso.extend_from_slice(dati);
        while flusso.len() % 512 != 0 {
            flusso.push(0);
        }
        for pacchetto in flusso.chunks(512) {
            in_notifiche(manda, pacchetto, misura);
        }
        let _ = manda.send(b"EOT xmodem\0\0\0\0\0\0".to_vec());
    }

    /// Un registro dei Cressi col formato 4 e oltre (firmware 300): voci da
    /// quindici byte, il numero dell'immersione nei primi due, l'impronta di
    /// sei byte dal terzo. La libreria scorre il registro dal fondo.
    fn voce_cressi(numero: u16, impronta: [u8; 6]) -> Vec<u8> {
        let mut v = vec![0u8; 15];
        v[..2].copy_from_slice(&numero.to_le_bytes());
        v[3..9].copy_from_slice(&impronta);
        v
    }

    /// E l'immersione: il numero in testa, la stessa impronta dal quarto byte.
    fn immersione_cressi(numero: u16, impronta: [u8; 6], quanti: usize) -> Vec<u8> {
        let mut v: Vec<u8> = (0..quanti).map(|i| (i as u8).wrapping_mul(13).wrapping_add(numero as u8)).collect();
        v[..2].copy_from_slice(&numero.to_le_bytes());
        v[4..10].copy_from_slice(&impronta);
        v
    }

    type Scritti = Arc<Mutex<Vec<Vec<u8>>>>;

    fn finto_cressi(
        registro: Vec<u8>,
        immersioni: Vec<(u16, Vec<u8>)>,
        misura: usize,
    ) -> (FlussoBle, Scritti, Arc<Mutex<Vec<[u8; 16]>>>) {
        let (manda, ricevi) = channel::<Vec<u8>>();
        let scritti: Scritti = Arc::new(Mutex::new(Vec::new()));
        let visti = scritti.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            visti.lock().unwrap().push(dati.to_vec());
            match dati {
                // CMD_LOGBOOK_BLE, con l'argomento zero.
                [0x02, 0x00] => manda_cressi(&manda, &registro, misura),
                // CMD_DIVE_BLE, col numero in big-endian.
                [0x03, alto, basso] => {
                    let numero = u16::from_be_bytes([*alto, *basso]);
                    let (_, dati) = immersioni
                        .iter()
                        .find(|(n, _)| *n == numero)
                        .unwrap_or_else(|| panic!("il Cressi finto non ha l'immersione {numero}"));
                    manda_cressi(&manda, dati, misura);
                }
                altro => panic!("il Cressi finto non conosce il comando {altro:02x?}"),
            }
            Ok(())
        });
        let lette = Arc::new(Mutex::new(Vec::new()));
        let accessori = CaratteristicheCressi {
            valori: vec![
                // Seriale 0x01020304, modello 10, firmware 300 (formato 5).
                (uuid_cressi(3), vec![0x04, 0x03, 0x02, 0x01, 10]),
                (uuid_cressi(4), 300u16.to_le_bytes().to_vec()),
                (uuid_cressi(5), vec![0x00, 0x00]),
            ],
            lette: lette.clone(),
        };
        let flusso = FlussoBle::nuovo(ricevi, scrittura)
            .con_accessori(Box::new(accessori), Box::new(|| Ripiego::Esaurito));
        (flusso, scritti, lette)
    }

    #[test]
    fn cressi_scarica_attraverso_il_nostro_trasporto() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► I CRESSI, IL PROTOCOLLO PIÙ STRANO DEL CATALOGO. ◄
         *
         * Otto modelli, e la marca che in Italia si vede di più in acqua. Via
         * BLE `cressi_goa.c` fa tre cose che nessun'altra famiglia fa insieme:
         * la versione si **legge da tre caratteristiche** invece di chiederla
         * (il nostro `DC_IOCTL_BLE_CHARACTERISTIC_READ`); le risposte lunghe
         * arrivano in **pacchetti da 512 byte** che la libreria ricompone
         * lettura dopo lettura; e la fine è una notifica «EOT xmodem» che deve
         * arrivare **intera in una lettura sola**. Se il trasporto unisse la
         * coda di un pacchetto alla fine, o la tagliasse, lo scarico si
         * fermerebbe su «Unexpected end bytes».
         *
         * Ogni comando costa due secondi di attesa voluti dalla libreria
         * («without this delay, the transfer will fail most of the time»):
         * per questo le misure sono due e le immersioni una.
         */
        let descrittore = trova_descrittore("Cressi", "Goa").expect("il Goa deve esserci");
        let impronta = [0x21, 0x22, 0x23, 0x24, 0x25, 0x26];
        let registro = voce_cressi(7, impronta);
        let immersione = immersione_cressi(7, impronta, 1300);
        for misura in [20usize, 182] {
            let (flusso, scritti, lette) = finto_cressi(registro.clone(), vec![(7, immersione.clone())], misura);
            let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
            let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
            assert!(esito.guasto.is_none(), "notifiche da {misura}: {:?}", esito.guasto);
            let dichiarato = esito.dichiarato.expect("il Cressi si presenta");
            assert_eq!((dichiarato.modello, dichiarato.firmware), (10, 300), "notifiche da {misura}");
            assert_eq!(
                *lette.lock().unwrap(),
                vec![uuid_cressi(3), uuid_cressi(4), uuid_cressi(5)],
                "la versione si legge dalle tre caratteristiche, in ordine"
            );
            assert_eq!(*scritti.lock().unwrap(), vec![vec![0x02, 0x00], vec![0x03, 0x00, 0x07]]);
            assert_eq!(esito.immersioni.len(), 1, "notifiche da {misura}");
            // La libreria mette davanti all'immersione la versione e la voce
            // del registro, con due byte che ne dicono la misura: il lettore
            // ne ha bisogno, e qui si controlla che il resto sia intatto.
            let dati = &esito.immersioni[0].dati;
            assert_eq!(&dati[..2], &[9, 15], "notifiche da {misura}");
            assert_eq!(&dati[2 + 9 + 15..], immersione.as_slice(), "notifiche da {misura}: byte per byte");
            assert_eq!(esito.immersioni[0].impronta, impronta.to_vec());
        }
    }


    // ─────────────────────────────────────────────────────────────── Seac Tablet

    /// CRC-16/CCITT come la calcola `checksum.c`: polinomio 0x1021, partenza
    /// 0xFFFF, niente riflessioni.
    fn crc_ccitt(dati: &[u8]) -> u16 {
        let mut crc: u16 = 0xFFFF;
        for &b in dati {
            crc ^= (b as u16) << 8;
            for _ in 0..8 {
                crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
            }
        }
        crc
    }

    /// Un record Seac da 64 byte: il numero dell'immersione in testa, il tipo
    /// nel terzultimo byte, il CRC negli ultimi due (così il CRC del record
    /// intero fa zero, che è quello che `seac_screen_record_isvalid` guarda).
    fn record_seac(numero: u32, tipo: u8, riempi: impl Fn(&mut [u8])) -> Vec<u8> {
        let mut r = vec![0u8; 64];
        riempi(&mut r);
        r[..4].copy_from_slice(&numero.to_le_bytes());
        r[61] = tipo;
        let crc = crc_ccitt(&r[..62]);
        r[62..].copy_from_slice(&crc.to_be_bytes());
        r
    }

    /// Un'immersione Seac: due record di intestazione — il secondo dice quanti
    /// campioni seguono — e i campioni, da 64 byte l'uno.
    fn immersione_seac(numero: u32, campioni: u32) -> Vec<u8> {
        let mut v = record_seac(numero, 0xCF, |_| {});
        v.extend(record_seac(numero, 0xC0, |r| r[4..8].copy_from_slice(&campioni.to_le_bytes())));
        for c in 0..campioni {
            v.extend(record_seac(numero, 0xAA, |r| {
                for (j, b) in r.iter_mut().enumerate().skip(4).take(56) {
                    *b = (j as u32 * 3 + c) as u8;
                }
            }));
        }
        v
    }

    /// Un Seac Tablet finto: la memoria del Tablet dall'indirizzo 0x0A0000, e le
    /// immersioni una dopo l'altra.
    struct StatoSeac {
        memoria: Vec<u8>,
        indirizzi: Vec<(u32, u32)>,
        comandi: Vec<u16>,
        scrittura_piu_lunga: usize,
    }

    const SEAC_INIZIO: u32 = 0x0A_0000;

    impl StatoSeac {
        fn rispondi(&mut self, comando: u16, dati: &[u8]) -> Vec<u8> {
            match comando {
                // Le informazioni: il modello (0x10, il Tablet) e il seriale
                // nell'hardware, il firmware nel software.
                0x1833 => {
                    let mut v = vec![0u8; 256];
                    v[4..8].copy_from_slice(&0x10u32.to_le_bytes());
                    v[0x10..0x14].copy_from_slice(&0x0000_2A2Bu32.to_le_bytes());
                    v
                }
                0x1834 => {
                    let mut v = vec![0u8; 256];
                    v[0x14..0x18].copy_from_slice(&0x0103u32.to_le_bytes());
                    v
                }
                // Il primo e l'ultimo numero d'immersione.
                0x1850 => {
                    let primo = self.indirizzi.first().map(|(n, _)| *n).unwrap_or(1);
                    let ultimo = self.indirizzi.last().map(|(n, _)| *n).unwrap_or(0);
                    [primo.to_be_bytes(), ultimo.to_be_bytes()].concat()
                }
                0x1851 => {
                    let numero = u32::from_be_bytes([dati[0], dati[1], dati[2], dati[3]]);
                    let (_, dove) = self.indirizzi.iter().find(|(n, _)| *n == numero).expect("numero noto");
                    dove.to_be_bytes().to_vec()
                }
                0x1852 => {
                    let da = u32::from_be_bytes([dati[0], dati[1], dati[2], dati[3]]) - SEAC_INIZIO;
                    let quanti = u32::from_be_bytes([dati[4], dati[5], dati[6], dati[7]]);
                    self.memoria[da as usize..(da + quanti) as usize].to_vec()
                }
                altro => panic!("il Seac finto non conosce il comando {altro:04x}"),
            }
        }
    }

    fn finto_seac(immersioni: &[(u32, Vec<u8>)], misura: usize) -> (FlussoBle, Arc<Mutex<StatoSeac>>) {
        let mut memoria = vec![0xFFu8; (0x40_0000 - SEAC_INIZIO) as usize];
        let mut indirizzi = Vec::new();
        let mut dove = SEAC_INIZIO + 0x1000;
        for (numero, dati) in immersioni {
            let da = (dove - SEAC_INIZIO) as usize;
            memoria[da..da + dati.len()].copy_from_slice(dati);
            indirizzi.push((*numero, dove));
            dove += dati.len() as u32;
        }
        let stato = Arc::new(Mutex::new(StatoSeac { memoria, indirizzi, comandi: Vec::new(), scrittura_piu_lunga: 0 }));
        let (manda, ricevi) = channel::<Vec<u8>>();
        let dentro = stato.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            let mut s = dentro.lock().unwrap();
            s.scrittura_piu_lunga = s.scrittura_piu_lunga.max(dati.len());
            // Il byte di risveglio, 0x61: nessuna risposta.
            if dati == [0x61] {
                return Ok(());
            }
            // 55 <lunghezza> <comando> <dati> <crc>: una scrittura per comando.
            assert_eq!(dati[0], 0x55, "inizio del comando: {dati:02x?}");
            let lunghezza = u16::from_be_bytes([dati[1], dati[2]]) as usize;
            assert_eq!(dati.len(), lunghezza + 1, "lunghezza dichiarata: {dati:02x?}");
            let crc = u16::from_be_bytes([dati[dati.len() - 2], dati[dati.len() - 1]]);
            assert_eq!(crc, crc_ccitt(&dati[..dati.len() - 2]), "CRC del comando");
            let comando = u16::from_be_bytes([dati[3], dati[4]]);
            s.comandi.push(comando);
            let risposta = s.rispondi(comando, &dati[5..dati.len() - 2]);
            let l = (risposta.len() + 7) as u16;
            let mut pacchetto = vec![0x55, (l >> 8) as u8, l as u8, dati[3], dati[4]];
            pacchetto.extend_from_slice(&risposta);
            pacchetto.push(0x09);
            let crc = crc_ccitt(&pacchetto);
            pacchetto.extend_from_slice(&crc.to_be_bytes());
            in_notifiche(&manda, &pacchetto, misura);
            Ok(())
        });
        (FlussoBle::nuovo(ricevi, scrittura), stato)
    }

    #[test]
    fn seac_tablet_scarica_attraverso_il_nostro_trasporto() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► IL SEAC TABLET: PACCHETTI DA 244, RISPOSTE DA DUEMILA BYTE. ◄
         *
         * Nuovo col ramo principale, e il primo Seac del catalogo. Via BLE
         * `seac_screen.c` si mette dietro `dc_packet_open(244, 244)`: legge a
         * pacchetti da 244 e ricompone lui. Le risposte alla lettura della
         * memoria arrivano a 2 056 byte, cioè da cinque a centotré notifiche a
         * seconda della radio, ognuna col suo CRC da verificare in fondo —
         * se il nostro trasporto perdesse, raddoppiasse o riordinasse un
         * pezzo, il CRC lo direbbe.
         *
         * Quattro misure di notifica, compresa una più grande dei pacchetti
         * della libreria (509 su 244): lì il resto della notifica deve
         * restare in cassa per la lettura dopo, non andare perso.
         */
        let descrittore = trova_descrittore("Seac", "Tablet").expect("il Tablet deve esserci");
        let quinta = immersione_seac(5, 3);
        let sesta = immersione_seac(6, 40);
        for misura in [20usize, 182, 244, 509] {
            let (flusso, stato) = finto_seac(&[(5, quinta.clone()), (6, sesta.clone())], misura);
            let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
            let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
            assert!(esito.guasto.is_none(), "notifiche da {misura}: {:?}", esito.guasto);
            let dichiarato = esito.dichiarato.expect("il Tablet si presenta");
            assert_eq!((dichiarato.modello, dichiarato.firmware), (0x10, 0x0103), "notifiche da {misura}");
            assert_eq!(esito.immersioni.len(), 2, "notifiche da {misura}");
            // La più recente per prima.
            assert_eq!(esito.immersioni[0].dati, sesta, "notifiche da {misura}: la sesta, byte per byte");
            assert_eq!(esito.immersioni[1].dati, quinta, "notifiche da {misura}: la quinta, byte per byte");
            assert_eq!(esito.immersioni[0].impronta, 6u32.to_le_bytes().to_vec());
            let s = stato.lock().unwrap();
            assert!(s.scrittura_piu_lunga <= 244, "scritture da {} byte", s.scrittura_piu_lunga);
            assert!(s.comandi.contains(&0x1852), "la memoria si legge col comando del Tablet");
        }
    }


    // ──────────────────────────────────── Suunto (EON Steel, EON Core, D5…)

    /// CRC-32 riflesso, quello di zlib: `checksum_crc32r`.
    fn crc32r(dati: &[u8]) -> u32 {
        let mut crc: u32 = 0xFFFF_FFFF;
        for &b in dati {
            crc ^= b as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    /// HDLC come lo scrive `hdlc.c`: 0x7E in testa e in coda, 0x7D che
    /// scappa i due caratteri speciali col bit 0x20 rovesciato.
    fn hdlc(dati: &[u8]) -> Vec<u8> {
        let mut fuori = vec![0x7E];
        for &b in dati {
            if b == 0x7E || b == 0x7D {
                fuori.extend_from_slice(&[0x7D, b ^ 0x20]);
            } else {
                fuori.push(b);
            }
        }
        fuori.push(0x7E);
        fuori
    }

    struct StatoSuunto {
        /// Le immersioni: il nome del file (il tempo, in esadecimale) e il contenuto.
        file: Vec<(u32, Vec<u8>)>,
        in_arrivo: Vec<u8>,
        dentro_trama: bool,
        dopo_esc: bool,
        magia: Option<u32>,
        aperto: Option<(Vec<u8>, usize)>,
        cartella_letta: bool,
        comandi: Vec<u16>,
        scrittura_piu_lunga: usize,
    }

    impl StatoSuunto {
        fn rispondi(&mut self, comando: u16, dati: &[u8]) -> Vec<u8> {
            match comando {
                // INIT: la «versione» da 0x30 byte — il seriale in cifre dal
                // byte 0x10, il firmware in big-endian dal 0x20.
                0x0000 => {
                    let mut v = vec![0u8; 0x30];
                    v[0x10..0x18].copy_from_slice(b"12345678");
                    v[0x20..0x24].copy_from_slice(&0x0002_0501u32.to_be_bytes());
                    v
                }
                // DIR_OPEN su «0:/dives».
                0x0810 => {
                    assert_eq!(&dati[4..], b"0:/dives\0", "la cartella delle immersioni");
                    self.cartella_letta = false;
                    vec![0u8; 4]
                }
                // READDIR: tutte le voci in una volta, e «ultima».
                0x0910 => {
                    let mut v = Vec::new();
                    v.extend_from_slice(&(self.file.len() as u32).to_le_bytes());
                    v.extend_from_slice(&1u32.to_le_bytes());
                    if !self.cartella_letta {
                        for (tempo, _) in &self.file {
                            let nome = format!("{tempo:08X}.LOG");
                            v.extend_from_slice(&1u32.to_le_bytes());
                            v.extend_from_slice(&(nome.len() as u32).to_le_bytes());
                            v.extend_from_slice(nome.as_bytes());
                            v.push(0);
                        }
                    }
                    self.cartella_letta = true;
                    v
                }
                0x0A10 | 0x0510 => vec![0u8; 4],
                // FILE_OPEN «0:/dives/XXXXXXXX.LOG».
                0x0010 => {
                    let nome = String::from_utf8_lossy(&dati[4..dati.len() - 1]).to_string();
                    let tempo = u32::from_str_radix(nome.trim_start_matches("0:/dives/").trim_end_matches(".LOG"), 16)
                        .expect("nome del file");
                    let (_, contenuto) = self.file.iter().find(|(t, _)| *t == tempo).expect("file noto");
                    self.aperto = Some((contenuto.clone(), 0));
                    vec![0u8; 4]
                }
                // FILE_STAT: la dimensione dal byte 4.
                0x0710 => {
                    let (contenuto, _) = self.aperto.as_ref().expect("un file aperto");
                    [0u32.to_le_bytes(), (contenuto.len() as u32).to_le_bytes()].concat()
                }
                // FILE_READ: 1234 (non è una posizione), quanti, i byte.
                0x0110 => {
                    let chiesti = u32::from_le_bytes([dati[4], dati[5], dati[6], dati[7]]) as usize;
                    let (contenuto, dove) = self.aperto.as_mut().expect("un file aperto");
                    let quanti = chiesti.min(contenuto.len() - *dove);
                    let mut v = [1234u32.to_le_bytes(), (quanti as u32).to_le_bytes()].concat();
                    v.extend_from_slice(&contenuto[*dove..*dove + quanti]);
                    *dove += quanti;
                    v
                }
                altro => panic!("il Suunto finto non conosce il comando {altro:04x}"),
            }
        }
    }

    fn finto_suunto(file: Vec<(u32, Vec<u8>)>, misura: usize) -> (FlussoBle, Arc<Mutex<StatoSuunto>>) {
        let (manda, ricevi) = channel::<Vec<u8>>();
        let stato = Arc::new(Mutex::new(StatoSuunto {
            file,
            in_arrivo: Vec::new(),
            dentro_trama: false,
            dopo_esc: false,
            magia: None,
            aperto: None,
            cartella_letta: false,
            comandi: Vec::new(),
            scrittura_piu_lunga: 0,
        }));
        let dentro = stato.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            let mut s = dentro.lock().unwrap();
            s.scrittura_piu_lunga = s.scrittura_piu_lunga.max(dati.len());
            for &b in dati {
                if b == 0x7E {
                    if !s.dentro_trama {
                        s.dentro_trama = true;
                        continue;
                    }
                    s.dentro_trama = false;
                    let trama = std::mem::take(&mut s.in_arrivo);
                    // cmd, magia, sequenza, lunghezza, dati, CRC-32.
                    let (corpo, crc) = trama.split_at(trama.len() - 4);
                    assert_eq!(u32::from_le_bytes([crc[0], crc[1], crc[2], crc[3]]), crc32r(corpo), "CRC del comando");
                    let comando = u16::from_le_bytes([corpo[0], corpo[1]]);
                    let magia = u32::from_le_bytes([corpo[2], corpo[3], corpo[4], corpo[5]]);
                    let sequenza = u16::from_le_bytes([corpo[6], corpo[7]]);
                    let lunghezza = u32::from_le_bytes([corpo[8], corpo[9], corpo[10], corpo[11]]) as usize;
                    assert_eq!(corpo.len(), 12 + lunghezza, "lunghezza dichiarata");
                    s.comandi.push(comando);
                    let risposta = s.rispondi(comando, &corpo[12..]);
                    // La magia: all'INIT la sceglie il computer, e poi risponde
                    // sempre con quella della domanda più cinque.
                    let magia_risposta = if comando == 0 {
                        s.magia = Some(0x4B1D_0000);
                        0x4B1D_0000
                    } else {
                        assert_eq!(Some(magia), s.magia.map(|m| m | 5), "la magia della domanda");
                        magia + 5
                    };
                    let mut r = Vec::new();
                    r.extend_from_slice(&comando.to_le_bytes());
                    r.extend_from_slice(&magia_risposta.to_le_bytes());
                    r.extend_from_slice(&sequenza.to_le_bytes());
                    r.extend_from_slice(&(risposta.len() as u32).to_le_bytes());
                    r.extend_from_slice(&risposta);
                    let crc = crc32r(&r);
                    r.extend_from_slice(&crc.to_le_bytes());
                    in_notifiche(&manda, &hdlc(&r), misura);
                    continue;
                }
                if !s.dentro_trama {
                    continue;
                }
                if b == 0x7D {
                    s.dopo_esc = true;
                    continue;
                }
                let c = if s.dopo_esc { b ^ 0x20 } else { b };
                s.dopo_esc = false;
                s.in_arrivo.push(c);
            }
            Ok(())
        });
        (FlussoBle::nuovo(ricevi, scrittura), stato)
    }

    #[test]
    fn suunto_scarica_attraverso_il_nostro_trasporto() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► I SUUNTO: UN FILE SYSTEM, IN HDLC, A PEZZI DA VENTI BYTE. ◄
         *
         * EON Steel, EON Core, D5: la seconda marca al mondo. Via BLE
         * `suunto_eonsteel.c` si mette dietro `dc_hdlc_open(20, 20)` e parla a
         * un file system — apri la cartella, leggi le voci, apri il file,
         * chiedine la misura, leggilo a pezzi da 1024 — con un CRC-32 per
         * trama e un numero «magico» che cambia a ogni domanda. Una lettura
         * della memoria arriva in una trama sola da più di mille byte: da
         * cinquanta a sessanta notifiche col telefono più avaro.
         */
        let descrittore = trova_descrittore("Suunto", "EON Steel").expect("l'EON Steel deve esserci");
        let prima: Vec<u8> = (0..2500u32).map(|i| (i * 11 + 7) as u8).collect();
        let seconda: Vec<u8> = (0..300u32).map(|i| (i * 5 + 0x7E) as u8).collect();
        for misura in [20usize, 182] {
            let (flusso, stato) =
                finto_suunto(vec![(0x5F5E_1000, prima.clone()), (0x5F60_2000, seconda.clone())], misura);
            let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
            let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
            assert!(esito.guasto.is_none(), "notifiche da {misura}: {:?}", esito.guasto);
            let dichiarato = esito.dichiarato.expect("l'EON si presenta");
            assert_eq!(dichiarato.firmware, 0x0002_0501, "notifiche da {misura}");
            assert_eq!(esito.immersioni.len(), 2, "notifiche da {misura}");
            // La più recente per prima; in testa il tempo, che è anche l'impronta.
            assert_eq!(&esito.immersioni[0].dati[..4], &0x5F60_2000u32.to_le_bytes());
            assert_eq!(&esito.immersioni[0].dati[4..], seconda.as_slice(), "notifiche da {misura}");
            assert_eq!(&esito.immersioni[1].dati[4..], prima.as_slice(), "notifiche da {misura}");
            assert_eq!(esito.immersioni[1].impronta, 0x5F5E_1000u32.to_le_bytes().to_vec());
            let s = stato.lock().unwrap();
            assert!(s.scrittura_piu_lunga <= 20, "HDLC scrive a pezzi da 20: visto {}", s.scrittura_piu_lunga);
            assert!(s.comandi.iter().filter(|c| **c == 0x0110).count() >= 4, "la prima si legge in tre pezzi");
        }
    }


    // ─────────────────── Oceanic e Aqualung (i200C, i300C, i770R, Geo 4.0…)

    /// Il nome Bluetooth, per il `DC_IOCTL_BLE_GET_NAME` della stretta di mano.
    struct NomeBluetooth(&'static str, Arc<Mutex<usize>>);

    impl AccessoriBle for NomeBluetooth {
        fn nome(&mut self) -> Option<String> {
            *self.1.lock().unwrap() += 1;
            Some(self.0.to_string())
        }
        fn leggi_caratteristica(&mut self, _uuid: [u8; 16]) -> Result<Vec<u8>, String> {
            Err("niente caratteristiche".into())
        }
    }

    struct StatoOceanic {
        memoria: Vec<u8>,
        /// Il comando in arrivo, pezzo dopo pezzo, e la sua sequenza.
        in_arrivo: Vec<u8>,
        comandi: Vec<Vec<u8>>,
        scrittura_piu_lunga: usize,
        pacchetti_mandati: usize,
    }

    fn somma8(dati: &[u8]) -> u8 {
        dati.iter().fold(0u8, |a, b| a.wrapping_add(*b))
    }

    fn finto_oceanic(nome: &'static str) -> (FlussoBle, Arc<Mutex<StatoOceanic>>, Arc<Mutex<usize>>) {
        // La memoria di un i200C appena azzerato: la pagina d'identità con il
        // modello (0x4749) e il seriale in BCD, i puntatori col registro vuoto
        // (primo = ultimo), il resto a 0xFF.
        let mut memoria = vec![0xFFu8; 0x10000];
        memoria[0..16].copy_from_slice(&[0u8; 16]);
        memoria[8..10].copy_from_slice(&0x4749u16.to_be_bytes());
        memoria[10..13].copy_from_slice(&[0x00, 0x00, 0x01]);
        memoria[0x40..0x50].copy_from_slice(&[0u8; 16]);
        memoria[0x44..0x46].copy_from_slice(&0x0240u16.to_le_bytes());
        memoria[0x46..0x48].copy_from_slice(&0x0240u16.to_le_bytes());
        memoria[0x48..0x4A].copy_from_slice(&0x0A40u16.to_le_bytes());
        memoria[0x4A..0x4C].copy_from_slice(&0x0A40u16.to_le_bytes());
        let stato = Arc::new(Mutex::new(StatoOceanic {
            memoria,
            in_arrivo: Vec::new(),
            comandi: Vec::new(),
            scrittura_piu_lunga: 0,
            pacchetti_mandati: 0,
        }));
        let (manda, ricevi) = channel::<Vec<u8>>();
        let dentro = stato.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            let mut s = dentro.lock().unwrap();
            s.scrittura_piu_lunga = s.scrittura_piu_lunga.max(dati.len());
            // CD <d1csssss> <sequenza del comando> <lunghezza> <dati>
            assert_eq!(dati[0], 0xCD, "inizio del pacchetto: {dati:02x?}");
            assert_eq!(dati[1] & 0xC0, 0x40, "un comando, non una risposta: {dati:02x?}");
            let sequenza = dati[2];
            let lunghezza = dati[3] as usize;
            assert_eq!(dati.len(), 4 + lunghezza, "lunghezza dichiarata: {dati:02x?}");
            s.in_arrivo.extend_from_slice(&dati[4..]);
            if dati[1] & 0x20 != 0 {
                return Ok(());
            }
            let comando = std::mem::take(&mut s.in_arrivo);
            s.comandi.push(comando.clone());
            let risposta: Vec<u8> = match comando[0] {
                // La versione: ACK, sedici byte, somma.
                0x84 => {
                    let versione = *b"AQUA200C \0\0 512K";
                    [&[0x5A][..], &versione, &[somma8(&versione)]].concat()
                }
                // La stretta di mano: basta l'ACK.
                0xE5 => vec![0x5A],
                // Una pagina da sedici byte.
                0xB1 => {
                    let pagina = u16::from_be_bytes([comando[1], comando[2]]) as usize * 16;
                    let dati = s.memoria[pagina..pagina + 16].to_vec();
                    [&[0x5A][..], &dati, &[somma8(&dati)]].concat()
                }
                // L'uscita, alla chiusura: la libreria aspetta un NAK.
                0x6A => vec![0xA5],
                altro => panic!("l'Oceanic finto non conosce il comando {altro:02x}"),
            };
            // La risposta a pacchetti da sedici byte di dati, uno per notifica.
            let pezzi: Vec<&[u8]> = risposta.chunks(16).collect();
            for (n, pezzo) in pezzi.iter().enumerate() {
                let altri = if n + 1 < pezzi.len() { 0x20 } else { 0x00 };
                let mut pacchetto = vec![0xCD, 0xC0 | altri | (n as u8 & 0x1F), sequenza, pezzo.len() as u8];
                pacchetto.extend_from_slice(pezzo);
                s.pacchetti_mandati += 1;
                let _ = manda.send(pacchetto);
            }
            Ok(())
        });
        let chiesto = Arc::new(Mutex::new(0usize));
        let flusso = FlussoBle::nuovo(ricevi, scrittura)
            .con_accessori(Box::new(NomeBluetooth(nome, chiesto.clone())), Box::new(|| Ripiego::Esaurito));
        (flusso, stato, chiesto)
    }

    #[test]
    fn oceanic_si_apre_col_nome_bluetooth_e_legge_la_memoria_a_pacchetti() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► OCEANIC E AQUALUNG: LA PASSWORD È IL NOME. ◄
         *
         * Quattordici modelli nel catalogo — i200C, i300C, i770R, Geo 4.0, Pro
         * Plus X… — e un protocollo BLE con due cose sue: ogni risposta arriva
         * a pacchetti da venti byte numerati (`CD`, stato con numero di
         * pacchetto, numero di comando, lunghezza), e dopo la versione la
         * libreria manda una **stretta di mano fatta con le cifre del nome
         * Bluetooth** («FQ001124»). Il nome la libreria lo chiede a noi con
         * `DC_IOCTL_BLE_GET_NAME`: se arrivasse quello sbagliato — il nome GAP
         * in cache invece di quello annunciato — il computer non aprirebbe.
         *
         * Un i200C appena azzerato: versione, stretta di mano, pagina
         * d'identità, puntatori, il registro da leggere pagina per pagina
         * (vuoto: tutto 0xFF), l'uscita. Zero immersioni, nessun errore.
         */
        let descrittore = trova_descrittore("Aqualung", "i200C").expect("l'i200C deve esserci");
        let (flusso, stato, chiesto) = finto_oceanic("GI000123");
        let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
        let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
        assert!(esito.guasto.is_none(), "{:?}", esito.guasto);
        assert!(esito.immersioni.is_empty());
        let dichiarato = esito.dichiarato.expect("l'i200C si presenta");
        assert_eq!(dichiarato.modello, 0x4749);
        assert!(*chiesto.lock().unwrap() >= 1, "il nome si chiede per la stretta di mano");
        let s = stato.lock().unwrap();
        // La stretta di mano: 0xE5, le sei cifre del nome, due zeri, la somma.
        let stretta = s.comandi.iter().find(|c| c[0] == 0xE5).expect("la stretta di mano");
        assert_eq!(&stretta[1..9], &[0, 0, 0, 1, 2, 3, 0, 0], "le cifre di «GI000123»");
        assert_eq!(stretta[9], 6, "la somma delle cifre");
        assert!(s.scrittura_piu_lunga <= 20, "pacchetti BLE da venti byte: visto {}", s.scrittura_piu_lunga);
        assert!(s.pacchetti_mandati > s.comandi.len(), "le risposte lunghe attraversano più pacchetti");
        assert_eq!(s.comandi.last().map(|c| c[0]), Some(0x6A), "e alla fine si esce");
    }


    // ─────────────────────────────────────────── Ratio (iX3M, iDive: 25 modelli)

    struct StatoRatio {
        firmware: u32,
        /// Le immersioni: numero, intestazione da 0x36 byte, campioni.
        immersioni: Vec<(u16, Vec<u8>, Vec<Vec<u8>>)>,
        dimensione_campione: usize,
        campioni_per_pacchetto: usize,
        /// L'immersione dell'ultima intestazione chiesta: i campioni sono i suoi.
        ultima_intestazione: Option<u16>,
        comandi: Vec<u8>,
    }

    impl StatoRatio {
        fn rispondi(&mut self, comando: &[u8]) -> Vec<u8> {
            match comando {
                // ID: modello, firmware e seriale, in 0x1A byte.
                [0x11, 0xED] => {
                    let mut v = vec![0u8; 0x1A];
                    v[0..2].copy_from_slice(&0x60u16.to_le_bytes());
                    v[2..6].copy_from_slice(&self.firmware.to_le_bytes());
                    v[6..10].copy_from_slice(&0x0001_E240u32.to_le_bytes());
                    v
                }
                // RANGE: il primo e l'ultimo numero.
                [0x78, 0x8D] => {
                    let primo = self.immersioni.first().map(|(n, _, _)| *n).unwrap_or(1);
                    let ultimo = self.immersioni.last().map(|(n, _, _)| *n).unwrap_or(0);
                    [primo.to_le_bytes(), ultimo.to_le_bytes()].concat()
                }
                // HEADER di un'immersione.
                [0x79, basso, alto] => {
                    let numero = u16::from_le_bytes([*basso, *alto]);
                    self.ultima_intestazione = Some(numero);
                    let (_, testa, _) = self.immersioni.iter().find(|(n, _, _)| *n == numero).expect("numero noto");
                    testa.clone()
                }
                // SAMPLE: dal campione `indice` (da 1), tanti quanti ne stanno
                // in un pacchetto. Oltre l'ultimo il computer manda riempitivo,
                // e la libreria lo scarta.
                [0x7A, basso, alto] => {
                    let indice = u16::from_le_bytes([*basso, *alto]) as usize;
                    let numero = self.ultima_intestazione.expect("un'intestazione prima dei campioni");
                    let (_, _, campioni) = self.immersioni.iter().find(|(n, _, _)| *n == numero).unwrap();
                    let mut v = Vec::new();
                    for k in 0..self.campioni_per_pacchetto {
                        match campioni.get(indice - 1 + k) {
                            Some(c) => v.extend_from_slice(c),
                            None => v.extend(std::iter::repeat_n(0xEE, self.dimensione_campione)),
                        }
                    }
                    v
                }
                altro => panic!("il Ratio finto non conosce il comando {altro:02x?}"),
            }
        }
    }

    /// Un'immersione Ratio: l'intestazione dice quanti campioni (byte 1-2) e
    /// porta l'impronta (byte 7-10).
    fn immersione_ratio(
        numero: u16,
        campioni: usize,
        dimensione: usize,
        impronta: [u8; 4],
    ) -> (u16, Vec<u8>, Vec<Vec<u8>>) {
        let mut testa: Vec<u8> = (0..0x36).map(|i| (i as u8) ^ (numero as u8)).collect();
        testa[1..3].copy_from_slice(&(campioni as u16).to_le_bytes());
        testa[7..11].copy_from_slice(&impronta);
        let corpo = (0..campioni)
            .map(|c| (0..dimensione).map(|j| (c * 7 + j * 3 + numero as usize) as u8).collect())
            .collect();
        (numero, testa, corpo)
    }

    fn finto_ratio(stato: StatoRatio, misura: usize) -> (FlussoBle, Arc<Mutex<StatoRatio>>) {
        let stato = Arc::new(Mutex::new(stato));
        let (manda, ricevi) = channel::<Vec<u8>>();
        let dentro = stato.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            // 55 <lunghezza> <comando> <crc>, una scrittura per comando.
            assert_eq!(dati[0], 0x55, "inizio del comando: {dati:02x?}");
            let lunghezza = dati[1] as usize;
            assert_eq!(dati.len(), lunghezza + 4, "lunghezza dichiarata: {dati:02x?}");
            let crc = u16::from_be_bytes([dati[lunghezza + 2], dati[lunghezza + 3]]);
            assert_eq!(crc, crc_ccitt(&dati[..lunghezza + 2]), "CRC del comando");
            let comando = &dati[2..2 + lunghezza];
            let mut s = dentro.lock().unwrap();
            s.comandi.push(comando[0]);
            let risposta = s.rispondi(comando);
            // 55 <lunghezza> <comando> <dati> <ACK> <crc>
            let mut pacchetto = vec![0x55, (risposta.len() + 2) as u8, comando[0]];
            pacchetto.extend_from_slice(&risposta);
            pacchetto.push(0x06);
            let crc = crc_ccitt(&pacchetto);
            pacchetto.extend_from_slice(&crc.to_be_bytes());
            in_notifiche(&manda, &pacchetto, misura);
            Ok(())
        });
        (FlussoBle::nuovo(ricevi, scrittura), stato)
    }

    #[test]
    fn ratio_scarica_attraverso_il_nostro_trasporto_col_firmware_vecchio_e_con_apos4() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► RATIO: VENTICINQUE MODELLI, UN PROTOCOLLO, DUE FIRMWARE. ◄
         *
         * La famiglia più numerosa del catalogo, e una marca italiana. Via BLE
         * `divesystem_idive.c` sta dietro `dc_packet_open(244, 244)` come il
         * Seac, con un protocollo a comandi: identità, intervallo dei numeri,
         * un'intestazione per immersione e i campioni a pacchetti. Col
         * firmware APOS4 (dalla versione 4) i campioni sono da 0x40 byte e ne
         * viaggiano tre per pacchetto, con riempitivo dopo l'ultimo — che la
         * libreria scarta; prima, uno da 0x36. Il timeout della libreria è di
         * un secondo, il più corto del catalogo.
         */
        let descrittore = trova_descrittore("Ratio", "iX3M 2021 GPS Fancy").expect("l'iX3M 2021 deve esserci");
        for (firmware, dimensione, per_pacchetto) in [(30_200_000u32, 0x36usize, 1usize), (40_100_000, 0x40, 3)] {
            for misura in [20usize, 182] {
                let prima = immersione_ratio(41, 7, dimensione, [0x31, 0x32, 0x33, 0x34]);
                let seconda = immersione_ratio(42, 2, dimensione, [0x41, 0x42, 0x43, 0x44]);
                let attesa = |(_, testa, campioni): &(u16, Vec<u8>, Vec<Vec<u8>>)| {
                    let mut v = testa.clone();
                    for c in campioni {
                        v.extend_from_slice(c);
                    }
                    v
                };
                let (flusso, stato) = finto_ratio(
                    StatoRatio {
                        firmware,
                        immersioni: vec![prima.clone(), seconda.clone()],
                        dimensione_campione: dimensione,
                        campioni_per_pacchetto: per_pacchetto,
                        ultima_intestazione: None,
                        comandi: Vec::new(),
                    },
                    misura,
                );
                let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
                let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
                let caso = format!("firmware {firmware}, notifiche da {misura}");
                assert!(esito.guasto.is_none(), "{caso}: {:?}", esito.guasto);
                let dichiarato = esito.dichiarato.expect("il Ratio si presenta");
                assert_eq!((dichiarato.modello, dichiarato.firmware), (0x60, firmware), "{caso}");
                assert_eq!(esito.immersioni.len(), 2, "{caso}");
                // La più recente per prima.
                assert_eq!(esito.immersioni[0].dati, attesa(&seconda), "{caso}: la 42, byte per byte");
                assert_eq!(esito.immersioni[1].dati, attesa(&prima), "{caso}: la 41, byte per byte");
                assert_eq!(esito.immersioni[1].impronta, vec![0x31, 0x32, 0x33, 0x34]);
                let s = stato.lock().unwrap();
                let campioni_chiesti = s.comandi.iter().filter(|c| **c == 0x7A).count();
                assert_eq!(campioni_chiesti, 7usize.div_ceil(per_pacchetto) + 2usize.div_ceil(per_pacchetto), "{caso}");
            }
        }
    }


    // ───────────────────────────────── Heinrichs Weikamp OSTC (nove modelli)

    struct StatoOstc {
        /// Le immersioni: posizione nel registro, testata da 256 byte, profilo.
        immersioni: Vec<(u8, Vec<u8>, Vec<u8>)>,
        /// I byte in arrivo non ancora usati: comandi di un byte, e per `DIVE`
        /// un byte di argomento che arriva in una scrittura sua.
        in_arrivo: VecDeque<u8>,
        /// Se l'eco di un `DIVE` è già partita e si aspetta il suo numero.
        eco_della_immersione: bool,
        comandi: Vec<u8>,
        scrittura_piu_lunga: usize,
    }

    const OSTC_PRONTO: u8 = 0x4D;

    impl StatoOstc {
        /// Il registro compatto: 256 voci da 16 byte, 0xFF dove non c'è niente.
        fn registro_compatto(&self) -> Vec<u8> {
            let mut r = vec![0xFFu8; 16 * 256];
            for (posto, testa, _) in &self.immersioni {
                let voce = &mut r[*posto as usize * 16..(*posto as usize + 1) * 16];
                voce[0..3].copy_from_slice(&testa[9..12]); // lunghezza del profilo
                voce[3..13].copy_from_slice(&testa[12..22]); // impronta, dieci byte
                voce[13..15].copy_from_slice(&testa[80..82]); // numero interno
                voce[15] = testa[8]; // versione
            }
            r
        }

        /// Consuma i byte arrivati e restituisce quello che il computer risponde.
        fn consuma(&mut self) -> Vec<u8> {
            let mut fuori = Vec::new();
            while let Some(&comando) = self.in_arrivo.front() {
                match comando {
                    // INIT: eco e pronto.
                    0xBB => {
                        self.in_arrivo.pop_front();
                        fuori.extend_from_slice(&[0xBB, OSTC_PRONTO]);
                    }
                    // HARDWARE2: descrittore (0x0A00, niente di hwOS 4), caratteristiche, modello.
                    0x60 => {
                        self.in_arrivo.pop_front();
                        fuori.extend_from_slice(&[0x60, 0x0A, 0x00, 0x00, 0x00, 0x0A, OSTC_PRONTO]);
                    }
                    // IDENTITY: seriale in little-endian, firmware 3.10 in big-endian.
                    0x69 => {
                        self.in_arrivo.pop_front();
                        let mut v = vec![0x20u8; 64];
                        v[0..2].copy_from_slice(&1234u16.to_le_bytes());
                        v[2..4].copy_from_slice(&0x030Au16.to_be_bytes());
                        fuori.push(0x69);
                        fuori.extend(v);
                        fuori.push(OSTC_PRONTO);
                    }
                    // COMPACT: il registro compatto.
                    0x6D => {
                        self.in_arrivo.pop_front();
                        fuori.push(0x6D);
                        fuori.extend(self.registro_compatto());
                        fuori.push(OSTC_PRONTO);
                    }
                    // DIVE: l'eco parte subito, poi si aspetta il numero, che
                    // la libreria scrive solo dopo aver letto l'eco.
                    0x66 => {
                        if self.in_arrivo.len() < 2 {
                            if !self.eco_della_immersione {
                                self.eco_della_immersione = true;
                                self.comandi.push(0x66);
                                fuori.push(0x66);
                            }
                            break;
                        }
                        self.in_arrivo.pop_front();
                        self.eco_della_immersione = false;
                        let posto = self.in_arrivo.pop_front().unwrap();
                        let (_, testa, profilo) = self
                            .immersioni
                            .iter()
                            .find(|(p, _, _)| *p == posto)
                            .unwrap_or_else(|| panic!("l'OSTC finto non ha niente al posto {posto}"));
                        fuori.extend_from_slice(testa);
                        fuori.extend_from_slice(profilo);
                        fuori.push(OSTC_PRONTO);
                        continue;
                    }
                    // EXIT: solo l'eco.
                    0xFF => {
                        self.in_arrivo.pop_front();
                        fuori.push(0xFF);
                    }
                    altro => panic!("l'OSTC finto non conosce il comando {altro:02x}"),
                }
                self.comandi.push(comando);
            }
            fuori
        }
    }

    /// Un'immersione OSTC: la testata da 256 byte con la lunghezza del profilo
    /// (byte 9-11), l'impronta (dal 12), il numero interno (80) e la versione
    /// (8); il profilo comincia con la stessa lunghezza e finisce con FD FD.
    fn immersione_ostc(numero: u16, dati_profilo: usize) -> (Vec<u8>, Vec<u8>) {
        let lunghezza = (dati_profilo + 8) as u32;
        let mut testa: Vec<u8> = (0..256).map(|i| (i as u8).wrapping_mul(3) ^ numero as u8).collect();
        testa[8] = 0x24;
        testa[9..12].copy_from_slice(&lunghezza.to_le_bytes()[..3]);
        testa[80..82].copy_from_slice(&numero.to_le_bytes());
        let mut profilo = lunghezza.to_le_bytes()[..3].to_vec();
        profilo.extend((0..dati_profilo).map(|i| (i as u8).wrapping_add(numero as u8) | 0x01));
        profilo.extend_from_slice(&[0xFD, 0xFD]);
        (testa, profilo)
    }

    fn finto_ostc(immersioni: Vec<(u8, Vec<u8>, Vec<u8>)>, misura: usize) -> (FlussoBle, Arc<Mutex<StatoOstc>>) {
        let stato = Arc::new(Mutex::new(StatoOstc {
            immersioni,
            in_arrivo: VecDeque::new(),
            eco_della_immersione: false,
            comandi: Vec::new(),
            scrittura_piu_lunga: 0,
        }));
        let (manda, ricevi) = channel::<Vec<u8>>();
        let dentro = stato.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            let mut s = dentro.lock().unwrap();
            s.scrittura_piu_lunga = s.scrittura_piu_lunga.max(dati.len());
            s.in_arrivo.extend(dati.iter().copied());
            let risposta = s.consuma();
            in_notifiche(&manda, &risposta, misura);
            Ok(())
        });
        (FlussoBle::nuovo(ricevi, scrittura), stato)
    }

    #[test]
    fn ostc_scarica_attraverso_il_nostro_trasporto() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► GLI OSTC: ECO, DATI, PRONTO. ◄
         *
         * Nove modelli, e tre (OSTC 3, cR, Nano) arrivati via BLE col ramo
         * principale. `hw_ostc3.c` si mette dietro `dc_packet_open(244, 20)`:
         * scrive a pezzi da venti, legge a pacchetti da 244, e ogni comando è
         * un byte che il computer rimanda indietro, i dati, e un byte
         * «pronto». Il registro compatto sono 4 096 byte in una risposta sola;
         * l'immersione si chiede con un numero che parte in una scrittura
         * sua, dopo l'eco. I crediti del modulo Bluetooth non stanno qui: li
         * conta il ponte, e hanno le loro prove.
         */
        let descrittore = trova_descrittore("Heinrichs Weikamp", "OSTC 3").expect("l'OSTC 3 deve esserci");
        let (testa_a, profilo_a) = immersione_ostc(17, 300);
        let (testa_b, profilo_b) = immersione_ostc(18, 45);
        for misura in [20usize, 182] {
            let (flusso, stato) = finto_ostc(
                vec![(4, testa_a.clone(), profilo_a.clone()), (5, testa_b.clone(), profilo_b.clone())],
                misura,
            );
            let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
            let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
            assert!(esito.guasto.is_none(), "notifiche da {misura}: {:?}", esito.guasto);
            let dichiarato = esito.dichiarato.expect("l'OSTC si presenta");
            assert_eq!((dichiarato.modello, dichiarato.firmware), (0x0A, 0x030A), "notifiche da {misura}");
            assert_eq!(esito.immersioni.len(), 2, "notifiche da {misura}");
            // La più recente — il numero interno più alto — per prima.
            assert_eq!(esito.immersioni[0].dati, [testa_b.clone(), profilo_b.clone()].concat(), "notifiche da {misura}");
            assert_eq!(esito.immersioni[1].dati, [testa_a.clone(), profilo_a.clone()].concat(), "notifiche da {misura}");
            assert_eq!(esito.immersioni[0].impronta, testa_b[12..17].to_vec());
            let s = stato.lock().unwrap();
            assert!(s.scrittura_piu_lunga <= 20, "scritture da {} byte", s.scrittura_piu_lunga);
            assert_eq!(s.comandi.first(), Some(&0xBB), "si comincia con INIT");
            assert_eq!(s.comandi.last(), Some(&0xFF), "e si finisce con EXIT");
        }
    }


    // ──────────────────────────────────────────────── Halcyon Symbios (HUD, Handset)

    /// CRC-8 col polinomio 0x07, come `checksum_crc8`.
    fn crc8(dati: &[u8]) -> u8 {
        let mut crc = 0u8;
        for &b in dati {
            crc ^= b;
            for _ in 0..8 {
                crc = if crc & 0x80 != 0 { (crc << 1) ^ 0x07 } else { crc << 1 };
            }
        }
        crc
    }

    struct StatoHalcyon {
        stato_da: usize,
        registro: Vec<u8>,
        immersioni: Vec<(u16, Vec<u8>)>,
        /// Il trasferimento in corso: i blocchi da mandare e il comando dei blocchi.
        blocchi: VecDeque<Vec<u8>>,
        comando_blocchi: u8,
        comandi: Vec<u8>,
    }

    impl StatoHalcyon {
        fn pacchetto(comando: u8, dati: &[u8]) -> Vec<u8> {
            let mut p = vec![comando | 0x80, 0x06];
            p.extend_from_slice(dati);
            let crc = crc8(&p[1..]);
            p.push(crc);
            p
        }

        /// Prepara i blocchi da 200 byte, con il numero di sequenza e il bit
        /// dell'ultimo.
        fn prepara(&mut self, dati: &[u8], comando_blocchi: u8) {
            self.comando_blocchi = comando_blocchi;
            let pezzi: Vec<&[u8]> = dati.chunks(200).collect();
            self.blocchi = pezzi
                .iter()
                .enumerate()
                .map(|(n, pezzo)| {
                    let mut id = (n as u16) + 1;
                    if n + 1 == pezzi.len() {
                        id |= 0x8000;
                    }
                    [&id.to_le_bytes()[..], pezzo].concat()
                })
                .collect();
        }

        fn rispondi(&mut self, dati: &[u8]) -> Option<Vec<u8>> {
            let comando = dati[0];
            self.comandi.push(comando);
            match comando {
                // GET_STATUS: seriale, modello, firmware; 36 byte col
                // protocollo Bluetooth 1.30, 20 prima.
                0x01 => {
                    let mut info = vec![0u8; self.stato_da];
                    info[0..4].copy_from_slice(&0x0000_4D2Cu32.to_le_bytes());
                    info[5] = 7;
                    info[16..19].copy_from_slice(&[1, 30, 2]);
                    Some(Self::pacchetto(0x01, &info))
                }
                // LOGBOOK_REQUEST: la lunghezza, poi i blocchi a richiesta.
                0x04 => {
                    let registro = self.registro.clone();
                    self.prepara(&registro, 0x08);
                    Some(Self::pacchetto(0x04, &(registro.len() as u32).to_le_bytes()))
                }
                // DIVELOG_REQUEST: il numero dell'immersione, e la sua somma.
                0x05 => {
                    assert_eq!(dati.len(), 4, "numero su due byte e CRC: {dati:02x?}");
                    assert_eq!(dati[3], crc8(&dati[1..3]), "CRC del numero");
                    let numero = u16::from_le_bytes([dati[1], dati[2]]);
                    let immersione = self
                        .immersioni
                        .iter()
                        .find(|(n, _)| *n == numero)
                        .map(|(_, d)| d.clone())
                        .expect("numero noto");
                    self.prepara(&immersione, 0x09);
                    Some(Self::pacchetto(0x05, &(immersione.len() as u32).to_le_bytes()))
                }
                // La richiesta del primo blocco, e gli ACK che chiedono il successivo.
                0x08 | 0x09 | 0x06 => {
                    let blocco = self.blocchi.pop_front()?;
                    Some(Self::pacchetto(self.comando_blocchi, &blocco))
                }
                altro => panic!("l'Halcyon finto non conosce il comando {altro:02x}"),
            }
        }
    }

    fn finto_halcyon(stato_da: usize, immersioni: Vec<(u16, [u8; 4], Vec<u8>)>) -> (FlussoBle, Arc<Mutex<StatoHalcyon>>) {
        // Il registro: voci da 32 byte, il numero dal byte 16, l'impronta dal 20.
        let mut registro = Vec::new();
        for (numero, impronta, _) in &immersioni {
            let mut voce = vec![0u8; 32];
            voce[16..18].copy_from_slice(&numero.to_le_bytes());
            voce[20..24].copy_from_slice(impronta);
            registro.extend(voce);
        }
        let stato = Arc::new(Mutex::new(StatoHalcyon {
            stato_da,
            registro,
            immersioni: immersioni.into_iter().map(|(n, _, d)| (n, d)).collect(),
            blocchi: VecDeque::new(),
            comando_blocchi: 0,
            comandi: Vec::new(),
        }));
        let (manda, ricevi) = channel::<Vec<u8>>();
        let dentro = stato.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            // Ogni pacchetto della Symbios sta in una notifica sola: la
            // libreria lo legge tutto in una lettura.
            if let Some(risposta) = dentro.lock().unwrap().rispondi(dati) {
                let _ = manda.send(risposta);
            }
            Ok(())
        });
        (FlussoBle::nuovo(ricevi, scrittura), stato)
    }

    #[test]
    fn halcyon_scarica_col_protocollo_bluetooth_vecchio_e_con_l_1_30() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► HALCYON: IL PERCHÉ DI UNA RIGA DELLE NOTE. ◄
         *
         * Le note della 1.8.30 dicono che l'Halcyon col protocollo Bluetooth
         * 1.30 — uno stato da 36 byte invece di 20 — non viene più rifiutato
         * per la lunghezza. Qui lo si vede: la stessa Symbios finta con tutti e
         * due gli stati, e lo scarico che arriva in fondo. Il protocollo:
         * pacchetti col CRC-8, una notifica per pacchetto, e il trasferimento
         * a blocchi da 200 con numero di sequenza, un ACK per chiedere il
         * successivo e il bit dell'ultimo.
         */
        let descrittore = trova_descrittore("Halcyon", "Symbios Handset").expect("la Symbios deve esserci");
        let prima: Vec<u8> = (0..450u32).map(|i| (i * 13 + 1) as u8).collect();
        let seconda: Vec<u8> = (0..120u32).map(|i| (i * 7 + 2) as u8).collect();
        for stato_da in [20usize, 36] {
            let (flusso, stato) = finto_halcyon(
                stato_da,
                vec![(11, [1, 2, 3, 4], prima.clone()), (12, [5, 6, 7, 8], seconda.clone())],
            );
            let collegamento = CollegamentoLdc::apri(Box::new(flusso)).unwrap();
            let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
            assert!(esito.guasto.is_none(), "stato da {stato_da}: {:?}", esito.guasto);
            let dichiarato = esito.dichiarato.expect("la Symbios si presenta");
            assert_eq!((dichiarato.modello, dichiarato.firmware), (7, 0x011E02), "stato da {stato_da}");
            assert_eq!(esito.immersioni.len(), 2, "stato da {stato_da}");
            // Il registro si scorre dal fondo: la dodicesima per prima.
            assert_eq!(esito.immersioni[0].dati, seconda, "stato da {stato_da}");
            assert_eq!(esito.immersioni[1].dati, prima, "stato da {stato_da}");
            assert_eq!(esito.immersioni[0].impronta, vec![5, 6, 7, 8]);
            let acks = stato.lock().unwrap().comandi.iter().filter(|c| **c == 0x06).count();
            assert_eq!(acks, 1 + 3 + 1, "un ACK per blocco: registro, prima (tre blocchi), seconda");
        }
    }


    // ───────────────── Deep Six Excursion, Crest CR-4, Genesis Centauri, Scorpena Alpha

    struct StatoDeepSix {
        /// Le immersioni: numero, testata (la sua misura nel byte 2), profilo.
        immersioni: Vec<(u16, Vec<u8>, Vec<u8>)>,
        comandi: Vec<(u8, u8)>,
    }

    impl StatoDeepSix {
        fn rispondi(&mut self, gruppo: u8, comando: u8, dati: &[u8]) -> Vec<u8> {
            self.comandi.push((gruppo, comando));
            match (gruppo, comando) {
                (0xB0, 0x28) => Vec::new(),
                (0xA0, 0x01) => b"HW0001".to_vec(),
                // Il firmware 6 e oltre usa i comandi nuovi dell'indice.
                (0xA0, 0x02) => b"D01.62".to_vec(),
                (0xA0, 0x03) => b"SN:000123456".to_vec(),
                (0xC0, 0x05) => (self.immersioni.len() as u16).to_le_bytes().to_vec(),
                (0xC0, 0x06) => {
                    let ultimo = self.immersioni.last().map(|(n, _, _)| *n).unwrap_or(0);
                    (ultimo as u32).to_le_bytes().to_vec()
                }
                (0xC0, 0x08) => {
                    let numero = u32::from_le_bytes([dati[0], dati[1], dati[2], dati[3]]) as u16;
                    let posto = self.immersioni.iter().position(|(n, _, _)| *n == numero).expect("numero noto");
                    (self.immersioni[posto - 1].0 as u32).to_le_bytes().to_vec()
                }
                (0xC0, 0x02) => {
                    let numero = u16::from_le_bytes([dati[0], dati[1]]);
                    self.immersioni.iter().find(|(n, _, _)| *n == numero).expect("numero noto").1.clone()
                }
                // Il profilo, a pacchetti da 200 dallo scostamento chiesto.
                (0xC0, 0x03) => {
                    let numero = u16::from_le_bytes([dati[0], dati[1]]);
                    let da = u32::from_le_bytes([dati[2], dati[3], dati[4], dati[5]]) as usize;
                    let profilo = &self.immersioni.iter().find(|(n, _, _)| *n == numero).expect("numero noto").2;
                    profilo[da..(da + 200).min(profilo.len())].to_vec()
                }
                altro => panic!("il Deep Six finto non conosce il comando {altro:02x?}"),
            }
        }
    }

    fn pacchetto_deepsix(gruppo: u8, comando: u8, direzione: u8, dati: &[u8]) -> Vec<u8> {
        let mut p = vec![gruppo, comando, direzione, dati.len() as u8];
        p.extend_from_slice(dati);
        let somma = p.iter().fold(0u8, |a, b| a.wrapping_add(*b)) ^ 0xFF;
        p.push(somma);
        p
    }

    fn immersione_deepsix(numero: u16, profilo: usize) -> (u16, Vec<u8>, Vec<u8>) {
        let mut testa: Vec<u8> = (0..160).map(|i| (i as u8) ^ (numero as u8)).collect();
        testa[2] = 160;
        testa[8..12].copy_from_slice(&(profilo as u32).to_le_bytes());
        let corpo = (0..profilo).map(|i| (i * 5 + numero as usize) as u8).collect();
        (numero, testa, corpo)
    }

    #[test]
    fn deep_six_scarica_attraverso_il_nostro_trasporto() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► DEEP SIX, CREST, GENESIS, SCORPENA: UN PACCHETTO PER NOTIFICA. ◄
         *
         * Quattro marche, un computer solo sotto. `deepsix_excursion.c` legge
         * **un pacchetto intero per lettura** — gruppo, comando, direzione,
         * lunghezza, dati, somma — e se una lettura ne consegnasse mezzo, o
         * due incollati, si fermerebbe sulla lunghezza o sulla somma. È la
         * forma di trasporto più esigente con la regola «una notifica, una
         * lettura», ed è quella del nostro `UnaNotifica`.
         */
        let descrittore = trova_descrittore("Crest", "CR-4").expect("il CR-4 deve esserci");
        let prima = immersione_deepsix(30, 530);
        let seconda = immersione_deepsix(31, 90);
        let stato = Arc::new(Mutex::new(StatoDeepSix {
            immersioni: vec![prima.clone(), seconda.clone()],
            comandi: Vec::new(),
        }));
        let (manda, ricevi) = channel::<Vec<u8>>();
        let dentro = stato.clone();
        let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
            let lunghezza = dati[3] as usize;
            assert_eq!(dati.len(), 4 + lunghezza + 1, "pacchetto intero: {dati:02x?}");
            let somma = dati[..4 + lunghezza].iter().fold(0u8, |a, b| a.wrapping_add(*b)) ^ 0xFF;
            assert_eq!(dati[4 + lunghezza], somma, "somma del comando");
            let risposta = dentro.lock().unwrap().rispondi(dati[0], dati[1], &dati[4..4 + lunghezza]);
            let _ = manda.send(pacchetto_deepsix(dati[0] + 1, dati[1], dati[2], &risposta));
            Ok(())
        });
        let collegamento = CollegamentoLdc::apri(Box::new(FlussoBle::nuovo(ricevi, scrittura))).unwrap();
        let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
        assert!(esito.guasto.is_none(), "{:?}", esito.guasto);
        assert_eq!(esito.dichiarato.expect("si presenta").firmware, u16::from_be_bytes(*b"62") as u32);
        assert_eq!(esito.immersioni.len(), 2);
        // L'ultima per prima, poi la precedente chiesta col comando nuovo.
        assert_eq!(esito.immersioni[0].dati, [seconda.1.clone(), seconda.2.clone()].concat());
        assert_eq!(esito.immersioni[1].dati, [prima.1.clone(), prima.2.clone()].concat());
        assert_eq!(esito.immersioni[1].impronta, prima.1[12..18].to_vec());
        let c = stato.lock().unwrap().comandi.clone();
        assert!(c.contains(&(0xC0, 0x08)), "la precedente si chiede col comando del firmware 6");
        assert_eq!(c.iter().filter(|x| **x == (0xC0, 0x03)).count(), 3 + 1, "profili a pacchetti da 200");
    }


    // ──────────────────────────────────────────────── Divesoft (Freedom, Liberty)

    /// CRC-16 riflesso con partenza e uscita 0xFFFF (X.25): `checksum_crc16r_ccitt`.
    fn crc16_x25(dati: &[u8]) -> u16 {
        let mut crc: u16 = 0xFFFF;
        for &b in dati {
            crc ^= b as u16;
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0x8408 } else { crc >> 1 };
            }
        }
        !crc
    }

    /// Un'immersione Divesoft: maniglia, impronta (20 byte), testata (64),
    /// registrazioni.
    type ImmersioneDivesoft = (u32, [u8; 20], Vec<u8>, Vec<u8>);

    struct StatoDivesoft {
        immersioni: Vec<ImmersioneDivesoft>,
        in_arrivo: Vec<u8>,
        dentro_trama: bool,
        dopo_esc: bool,
        messaggi: Vec<u16>,
    }

    impl StatoDivesoft {
        fn rispondi(&mut self, tipo: u16, dati: &[u8]) -> (u16, Vec<u8>) {
            self.messaggi.push(tipo);
            match tipo {
                // CONNECT: compressione, protocollo, seriale.
                2 => {
                    assert_eq!(&dati[2..], b"libdivecomputer", "il nome del cliente");
                    let mut v = vec![0u8; 36];
                    v[2] = 1;
                    v[4..20].copy_from_slice(b"FREEDOM000012345");
                    (3, v)
                }
                // VERSION: modello 19 (Freedom 4), software 7.2.1.
                4 => {
                    let mut v = vec![0u8; 26];
                    v[0] = 19;
                    v[3..6].copy_from_slice(&[7, 2, 1]);
                    v[10..26].copy_from_slice(b"FREEDOM000012345");
                    (5, v)
                }
                // DIVE_LIST, la versione 2 dei record: tutte in una volta.
                66 => {
                    let mut v = Vec::new();
                    for (maniglia, impronta, testa, _) in &self.immersioni {
                        v.extend_from_slice(&maniglia.to_le_bytes());
                        v.extend_from_slice(impronta);
                        v.extend_from_slice(testa);
                    }
                    (71, v)
                }
                // DIVE_DATA: la testata e le registrazioni.
                64 => {
                    let maniglia = u32::from_le_bytes([dati[0], dati[1], dati[2], dati[3]]);
                    let (_, _, testa, corpo) =
                        self.immersioni.iter().find(|(m, _, _, _)| *m == maniglia).expect("maniglia nota");
                    (65, [testa.clone(), corpo.clone()].concat())
                }
                altro => panic!("il Divesoft finto non conosce il messaggio {altro}"),
            }
        }
    }

    /// Un messaggio Divesoft in pacchetti da 256 byte, ognuno in una trama HDLC.
    fn trame_divesoft(sequenza: u8, tipo: u16, dati: &[u8]) -> Vec<u8> {
        let mut fuori = Vec::new();
        let pezzi: Vec<&[u8]> = if dati.is_empty() { vec![&[][..]] } else { dati.chunks(256).collect() };
        for (n, pezzo) in pezzi.iter().enumerate() {
            let ultimo = n + 1 == pezzi.len();
            let mut p = vec![((n as u8 & 0x0F) << 4) | (sequenza & 0x0F), if ultimo { 0x40 } else { 0x00 }];
            p.extend_from_slice(&tipo.to_le_bytes());
            p.extend_from_slice(&(pezzo.len() as u16).to_le_bytes());
            p.extend_from_slice(pezzo);
            let crc = crc16_x25(&p);
            p.extend_from_slice(&crc.to_le_bytes());
            fuori.extend(hdlc(&p));
        }
        fuori
    }

    #[test]
    fn divesoft_scarica_attraverso_il_nostro_trasporto() {
        /*
         * ════════════════════════════════════════════════════════════════════
         * ► DIVESOFT: MESSAGGI A PIÙ PACCHETTI, IN HDLC DA 244. ◄
         *
         * Freedom e Liberty. `divesoft_freedom.c` sta dietro
         * `dc_hdlc_open(244, 244)` e parla per messaggi: ognuno in pacchetti
         * da 256 byte al più, numerati, col CRC-16 X.25, e un bit che dice
         * l'ultimo. Una trama HDLC per pacchetto, più lunga di quasi ogni
         * notifica: tutte le trame di un'immersione attraversano la radio a
         * pezzi, e il trasporto le deve consegnare in ordine e intere.
         */
        let descrittore = trova_descrittore("Divesoft", "Freedom").expect("il Freedom deve esserci");
        let immersione = |maniglia: u32, registrazioni: u32| {
            let mut testa: Vec<u8> = (0..64).map(|i| (i as u8) ^ (maniglia as u8)).collect();
            testa[20..24].copy_from_slice(&registrazioni.to_le_bytes());
            let corpo: Vec<u8> = (0..registrazioni * 16).map(|i| (i * 3 + maniglia) as u8).collect();
            let mut impronta = [0u8; 20];
            impronta[0] = maniglia as u8;
            (maniglia, impronta, testa, corpo)
        };
        let prima = immersione(0x101, 40);
        let seconda = immersione(0x102, 3);
        for misura in [20usize, 182] {
            let stato = Arc::new(Mutex::new(StatoDivesoft {
                immersioni: vec![seconda.clone(), prima.clone()],
                in_arrivo: Vec::new(),
                dentro_trama: false,
                dopo_esc: false,
                messaggi: Vec::new(),
            }));
            let (manda, ricevi) = channel::<Vec<u8>>();
            let dentro = stato.clone();
            let scrittura: ScritturaBle = Box::new(move |dati: &[u8]| {
                let mut s = dentro.lock().unwrap();
                for &b in dati {
                    if b == 0x7E {
                        if !s.dentro_trama {
                            s.dentro_trama = true;
                            continue;
                        }
                        s.dentro_trama = false;
                        let p = std::mem::take(&mut s.in_arrivo);
                        let (corpo, crc) = p.split_at(p.len() - 2);
                        assert_eq!(u16::from_le_bytes([crc[0], crc[1]]), crc16_x25(corpo), "CRC del comando");
                        assert_eq!(corpo[1] & 0x40, 0x40, "i comandi della libreria stanno in un pacchetto");
                        let tipo = u16::from_le_bytes([corpo[2], corpo[3]]);
                        let (risposta, dati) = s.rispondi(tipo, &corpo[6..]);
                        in_notifiche(&manda, &trame_divesoft(corpo[0], risposta, &dati), misura);
                        continue;
                    }
                    if !s.dentro_trama {
                        continue;
                    }
                    if b == 0x7D {
                        s.dopo_esc = true;
                        continue;
                    }
                    let c = if s.dopo_esc { b ^ 0x20 } else { b };
                    s.dopo_esc = false;
                    s.in_arrivo.push(c);
                }
                Ok(())
            });
            let collegamento = CollegamentoLdc::apri(Box::new(FlussoBle::nuovo(ricevi, scrittura))).unwrap();
            let esito = collegamento.scarica_tutto(&descrittore, &[], &|_| {});
            assert!(esito.guasto.is_none(), "notifiche da {misura}: {:?}", esito.guasto);
            let dichiarato = esito.dichiarato.expect("il Freedom si presenta");
            assert_eq!((dichiarato.modello, dichiarato.firmware), (19, 0x070201), "notifiche da {misura}");
            assert_eq!(esito.immersioni.len(), 2, "notifiche da {misura}");
            assert_eq!(esito.immersioni[0].dati, [seconda.2.clone(), seconda.3.clone()].concat());
            assert_eq!(esito.immersioni[1].dati, [prima.2.clone(), prima.3.clone()].concat(), "notifiche da {misura}");
            assert_eq!(esito.immersioni[1].impronta, prima.1.to_vec());
            assert_eq!(stato.lock().unwrap().messaggi, vec![2, 4, 66, 64, 64]);
        }
    }

}
