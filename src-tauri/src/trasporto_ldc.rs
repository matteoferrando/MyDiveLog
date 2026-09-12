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
    scrittura: Box<dyn FnMut(&[u8]) -> Result<(), GuastoScrittura> + Send>,
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
}

impl Riassemblaggio {
    /// L'altra politica. Serve al giro dei tentativi: quando la scelta fatta
    /// per un modello non funziona, l'unica altra cosa da provare è questa.
    pub fn altro(self) -> Self {
        match self {
            Self::UnaNotifica => Self::PacchettoIntero,
            Self::PacchettoIntero => Self::UnaNotifica,
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
        scrittura: Box<dyn FnMut(&[u8]) -> Result<(), GuastoScrittura> + Send>,
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
            registratore: None,
        }
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

impl FlussoByte for FlussoBle {
    fn scrivi(&mut self, dati: &[u8]) -> Result<(), GuastoScrittura> {
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
        let quanti = quanti.min(self.avanzo.len());
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
/// interessano. Qui ne interessa uno solo: gli altri o li sappiamo già dal
/// nostro lato dello scambio (modello e seriale li legge il protocollo, e il
/// diario li scrive) o non hanno niente da mostrare a chi guarda.
///
/// Come tutte le costanti copiate da un'intestazione C, è confrontata con
/// l'intestazione vera da una prova: una trascrizione sbagliata di un enum non
/// dà errore, dà un numero plausibile — qui iscriverebbe a un evento diverso e
/// la barra resterebbe ferma senza che niente fallisca.
const DC_EVENT_PROGRESS: c_uint = 1 << 1;

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
    /// Il guasto, se c'è stato. Non toglie validità alle immersioni sopra.
    pub guasto: Option<String>,
}

impl EsitoScarico {
    /// Per chi non ha niente da salvare a metà: o tutto, o l'errore.
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

/// I byte letti finora, da `DC_EVENT_PROGRESS`.
extern "C" fn avanzamento_della_libreria(
    _dispositivo: *mut DcDevice,
    evento: c_uint,
    dati: *const c_void,
    userdata: *mut c_void,
) {
    // Iscritti a un evento solo, ma la firma è quella generica: un giorno
    // qualcuno ne aggiungerà un altro e questa riga eviterà che i campi di
    // `dc_event_devinfo_t` vengano letti come se fossero un progresso.
    if evento != DC_EVENT_PROGRESS || dati.is_null() || userdata.is_null() {
        return;
    }
    // SICUREZZA: iscrivendoci a `DC_EVENT_PROGRESS` la libreria passa un
    // `dc_event_progress_t`, e `userdata` è la stessa `Raccolta` di `raccogli`.
    let progresso = unsafe { &*(dati as *const DcEventProgress) };
    let raccolta = unsafe { &mut *(userdata as *mut Raccolta) };
    raccolta.corrente.byte_letti = progresso.current;
    raccolta.corrente.byte_totali = progresso.maximum;
    raccolta.racconta();
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
        Some(format!(
            "letture: {}, di cui {} corte e {} vuote; pacchetti lasciati a metà: {}; pausa più lunga colmata fra due frammenti: {} ms (ci si arrende a {} ms); silenzio più lungo fra un comando e la risposta: {} ms; seconde finestre concesse: {}, di cui utili {}; congelamenti visti: {}",
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
        let iscritto =
            unsafe { dc_device_set_events(dispositivo, DC_EVENT_PROGRESS, avanzamento_della_libreria, suo) };
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
        // La causa si legge PRIMA di chiudere: per i backend il cui `close`
        // scrive sul flusso (l'OSTC manda EXIT, Shearwater chiude la
        // sessione), una chiusura su un collegamento già caduto annota un
        // secondo guasto che sovrascriverebbe quello dello scarico — e il
        // messaggio parlerebbe della chiusura invece che di cosa si è rotto.
        let spiegazione = if esito != DC_STATUS_SUCCESS { Some(self.spiega(esito)) } else { None };
        // Il dispositivo si chiude comunque, anche quando lo scarico è fallito:
        // lasciarlo aperto significherebbe un computer che resta occupato.
        unsafe { dc_device_close(dispositivo) };

        EsitoScarico {
            immersioni: raccolte,
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
            guasto: Some("il collegamento è caduto".into()),
        };
        assert_eq!(esito.immersioni.len(), 1);
        assert!(esito.guasto.is_some());

        // E `in_risultato` butta via il bottino di proposito: la usano le
        // prove e chi non ha niente da salvare a metà. Se un giorno qualcuno
        // la usasse nello scarico vero, questa riga dice cosa costa.
        let perso = EsitoScarico {
            immersioni: vec![ImmersioneGrezza { dati: vec![1], impronta: vec![] }],
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
}
