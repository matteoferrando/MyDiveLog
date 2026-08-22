//! Cosa succede prima della compilazione di Rust.
//!
//! Di suo questo file conterrebbe una riga sola — `tauri_build::build()`. Il
//! resto c'è perché, quando la funzionalità `computer-esterni` è attiva, va
//! compilata **libdivecomputer**, che è C e non Rust, e che non si prende da
//! `crates.io`.

use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    #[cfg(feature = "computer-esterni")]
    compila_libdivecomputer();
    tauri_build::build()
}

/// La versione vendorizzata. Cambiarla qui e mettere il tarball accanto.
#[cfg(feature = "computer-esterni")]
const VERSIONE: &str = "0.9.0";

/// Compila libdivecomputer dentro la cartella di lavoro di cargo.
///
/// PERCHÉ UN TARBALL NEL REPOSITORY E NON UN SOTTOMODULO GIT. Perché il
/// pacchetto rilasciato porta con sé lo `configure` già generato, mentre un
/// clone del repository pretende `autoreconf`, cioè autoconf, automake e
/// libtool installati su ogni macchina che compila. Con il tarball serve solo
/// `tar`, `make` e un compilatore C — roba che su un Mac di sviluppo c'è già.
/// Sono ottocento kilobyte versionati una volta, e in cambio la compilazione è
/// riproducibile e non tocca la rete.
///
/// PERCHÉ È DIETRO UNA FUNZIONALITÀ SPENTA DI SUA INIZIATIVA. Due ragioni, e la
/// seconda pesa più della prima. La prima: chi lavora sull'applicazione non deve
/// aspettare centoquindici file C a ogni `cargo build` pulito per lavorare su
/// una schermata. La seconda: **la licenza**. libdivecomputer è LGPL-2.1, che
/// permette a un programma MIT di usarla purché chi lo riceve possa
/// ricompilarla e rimetterla al suo posto. Con tutto il sorgente
/// dell'applicazione pubblico la condizione è soddisfatta per un pacchetto che
/// si scarica da GitHub; su App Store, dove il binario lo firma Apple e nessuno
/// può rilinkare niente, la stessa domanda non ha una risposta comoda. Una
/// funzionalità che si accende per bersaglio è il modo di tenere aperte
/// entrambe le strade finché quella domanda non ha risposta.
#[cfg(feature = "computer-esterni")]
fn compila_libdivecomputer() {
    let radice = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let tarball = radice.join(format!("vendor/libdivecomputer-{VERSIONE}.tar.gz"));
    let lavoro = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let sorgenti = lavoro.join(format!("libdivecomputer-{VERSIONE}"));
    let libreria = sorgenti.join("src/.libs/libdivecomputer.a");

    println!("cargo:rerun-if-changed={}", tarball.display());

    // Ricompilare centoquindici file C a ogni build sarebbe un minuto buttato
    // ogni volta: se la libreria è già lì, è già quella giusta — `OUT_DIR`
    // cambia quando cambia la configurazione, e il tarball è sotto controllo.
    if !libreria.exists() {
        if !sorgenti.exists() {
            esegui(
                Command::new("tar").arg("xzf").arg(&tarball).current_dir(&lavoro),
                "estrazione di libdivecomputer",
            );
        }
        esegui(
            Command::new("./configure")
                // Statica: il pacchetto deve reggersi da solo, senza chiedere a
                // chi lo apre di avere una libreria installata.
                .args(["--disable-shared", "--enable-static", "--disable-dependency-tracking"])
                .current_dir(&sorgenti),
            "configure di libdivecomputer",
        );
        esegui(
            Command::new("make").arg("-j").arg(numero_lavori()).current_dir(&sorgenti),
            "make di libdivecomputer",
        );
    }

    println!("cargo:rustc-link-search=native={}", sorgenti.join("src/.libs").display());
    println!("cargo:rustc-link-lib=static=divecomputer");
    // Le intestazioni servono solo a chi legge: le dichiarazioni `extern` sono
    // scritte a mano in `computer_esterni.rs`, senza bindgen — che porterebbe
    // dentro libclang su ogni macchina che compila, per generare venti righe.
    println!("cargo:include={}", sorgenti.join("include").display());
}

#[cfg(feature = "computer-esterni")]
fn numero_lavori() -> String {
    std::env::var("NUM_JOBS").unwrap_or_else(|_| "4".into())
}

/// Esegue un comando e **muore con un messaggio leggibile** se fallisce.
///
/// Un `unwrap()` qui darebbe «exit status: 2» senza dire quale passo, e chi lo
/// legge dovrebbe indovinare fra estrazione, configure e make.
#[cfg(feature = "computer-esterni")]
fn esegui(comando: &mut Command, cosa: &str) {
    let esito = comando
        .status()
        .unwrap_or_else(|e| panic!("{cosa}: impossibile avviare il comando ({e})"));
    if !esito.success() {
        panic!("{cosa}: fallito con {esito}");
    }
}

/// Serve solo a zittire l'avviso quando la funzionalità è spenta.
#[allow(dead_code)]
fn _inutilizzato(_: &Path) {}
