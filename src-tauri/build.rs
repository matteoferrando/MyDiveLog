//! Cosa succede prima della compilazione di Rust.
//!
//! Di suo questo file conterrebbe una riga sola — `tauri_build::build()`. Il
//! resto c'è perché, quando la funzionalità `computer-esterni` è attiva, va
//! compilata **libdivecomputer**, che è C e non Rust, e che non si prende da
//! `crates.io`.

fn main() {
    #[cfg(feature = "computer-esterni")]
    compila_libdivecomputer();
    tauri_build::build()
}

/// La versione vendorizzata. Cambiarla qui e mettere il tarball accanto.
#[cfg(feature = "computer-esterni")]
const VERSIONE: &str = "0.9.0";

/// Versione minima di iOS per cui compilare la parte C.
///
/// **Deve restare allineata al resto del progetto**: `tauri.conf.json`
/// (`bundle.iOS.minimumSystemVersion`) e `gen/apple/project.yml`
/// (`options.deploymentTarget.iOS`) dicono entrambi 14.0, e il progetto Xcode
/// generato ne eredita `IPHONEOS_DEPLOYMENT_TARGET`. Se un archivio statico
/// dichiarasse una minima più alta di quella dell'applicazione, il linker si
/// lamenterebbe al momento sbagliato — cioè in fondo, quando si mette insieme
/// il pacchetto, e non qui dove il messaggio si capisce.
#[cfg(feature = "computer-esterni")]
const IOS_MINIMA: &str = "14.0";

/// Livello di API Android per cui compilare la parte C.
///
/// **Deve restare allineata a quella dell'applicazione**: Tauri genera il
/// progetto Gradle con `minSdkVersion 24`, e un archivio statico compilato
/// contro un'API più alta userebbe simboli che su un telefono con Android 7 non
/// esistono. Il guasto non si vedrebbe qui: si vedrebbe al primo avvio, su un
/// apparecchio che non abbiamo, con un errore di simbolo mancante.
#[cfg(feature = "computer-esterni")]
const ANDROID_API: &str = "24";

/// Le opzioni di `configure` che spengono quello che a noi non serve.
///
/// PERCHÉ SPEGNERE INVECE DI LASCIAR FARE. Noi apriamo il computer subacqueo
/// **solo** con `dc_custom_open`, cioè con un trasporto scritto da noi che
/// parla BLE attraverso CoreBluetooth (vedi `trasporto_ldc.rs`). Tutti i
/// trasporti che libdivecomputer sa fare da sé — libusb, hidapi, il Bluetooth
/// di sistema via BlueZ — sono peso morto: su iPhone non esistono proprio, e
/// sul Mac aggiungerebbero dipendenze esterne per codice che non chiamiamo mai.
/// Meno pezzi si compilano, meno cose si rompono quando si cambia bersaglio.
///
/// Le altre due riguardano cosa `make` produce oltre alla libreria: gli esempi
/// sono eseguibili da riga di comando (per iOS sarebbero binari che nessuno può
/// lanciare, e in compilazione incrociata sono solo un modo in più di
/// fallire), e la documentazione pretende `mandoc` installato.
///
/// COSA NON SI PUÒ SPEGNERE. Il trasporto seriale: in `configure.ac` di 0.9.0
/// `transport_serial` è scritto `"yes"` fisso, senza nessuna opzione che lo
/// tocchi. Non è un problema — `serial_posix.c` è termios, che sull'SDK di iOS
/// c'è e compila; il controllo su `IOKit/serial/ioss.h` fallisce da solo
/// quando si compila per iPhone, che è esattamente il comportamento giusto.
#[cfg(feature = "computer-esterni")]
const SPENTI: &[&str] = &[
    "--without-libusb",
    "--without-hidapi",
    "--without-bluez",
    "--enable-examples=no",
    "--enable-doc=no",
    "--enable-pty=no",
];

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
    use std::path::PathBuf;
    use std::process::Command;

    let radice = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let tarball = radice.join(format!("vendor/libdivecomputer-{VERSIONE}.tar.gz"));
    let lavoro = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let sorgenti = lavoro.join(format!("libdivecomputer-{VERSIONE}"));
    let libreria = sorgenti.join("src/.libs/libdivecomputer.a");

    // Il bersaglio va letto dall'ambiente e **non** con `cfg!(target_os = …)`:
    // questo file è a sua volta un programma, e cargo lo compila e lo esegue
    // sulla macchina di chi sviluppa. Lì dentro `cfg!` descrive il Mac, non
    // l'iPhone. `TARGET` invece è la tripletta che cargo sta compilando adesso.
    let bersaglio = std::env::var("TARGET").unwrap();

    println!("cargo:rerun-if-changed={}", tarball.display());

    // Ricompilare centoquindici file C a ogni build sarebbe un minuto buttato
    // ogni volta: se la libreria è già lì, è già quella giusta — `OUT_DIR`
    // cambia quando cambia la configurazione, bersaglio compreso, quindi
    // l'archivio del Mac e quello dell'iPhone non si pestano i piedi, e il
    // tarball è sotto controllo.
    if !libreria.exists() {
        if !sorgenti.exists() {
            esegui(
                Command::new("tar").arg("xzf").arg(&tarball).current_dir(&lavoro),
                "estrazione di libdivecomputer",
            );
        }

        let mut configure = Command::new("./configure");
        configure
            // Statica: il pacchetto deve reggersi da solo, senza chiedere a
            // chi lo apre di avere una libreria installata.
            .args(["--disable-shared", "--enable-static", "--disable-dependency-tracking"])
            .args(SPENTI)
            .current_dir(&sorgenti);

        if let Some(incrocio) = incrocio_android(&bersaglio) {
            // ANDROID NON HA UN `xcrun`. La catena sta dentro l'NDK, in un
            // percorso che contiene il nome della macchina che compila: si
            // guarda cosa c'è invece di indovinarlo, perché un NDK scaricato su
            // Linux e uno scaricato su un Mac hanno cartelle diverse.
            //
            // Il compilatore NON è `clang` ma `aarch64-linux-android24-clang`,
            // uno script che chiama clang con il `--target` e il `--sysroot`
            // giusti già dentro. Usare il clang nudo e passargli le bandiere a
            // mano è la strada che sembra più pulita e non lo è: il wrapper
            // sceglie anche la libreria C giusta per quel livello di API, e
            // quella scelta cambia da versione a versione dell'NDK.
            configure
                .arg(format!("--host={}", incrocio.host_autoconf))
                .env("CC", &incrocio.cc)
                // `llvm-ar` e `llvm-ranlib` e non quelli prefissati col nome
                // del bersaglio: dall'NDK 23 in poi i secondi non ci sono più,
                // e autoconf che non li trova ripiegherebbe sull'`ar` di
                // sistema — che produce un archivio che il linker di Android
                // non riconosce.
                .env("AR", &incrocio.ar)
                .env("RANLIB", &incrocio.ranlib)
                // `-fPIC` perché il risultato finisce dentro una libreria
                // condivisa: Tauri su Android costruisce l'applicazione come
                // `.so` caricata dalla macchina virtuale Java, e un archivio
                // non rilocabile lì dentro non ci entra. Su iOS non serviva:
                // là il codice è statico fino in fondo.
                .env("CFLAGS", "-fPIC -Os")
                .env_remove("SDKROOT");
        } else if let Some(incrocio) = incrocio_apple(&bersaglio) {
            let sdk = xcrun(incrocio.sdk, &["--show-sdk-path"]);
            let bandiere = format!(
                "-target {} -isysroot {} {}",
                incrocio.tripletta_clang, sdk, incrocio.minima
            );

            configure
                // PERCHÉ `--host` ANCHE QUANDO NON SEMBRA SERVIRE. Senza,
                // autoconf resta in modalità nativa: compila i programmini di
                // prova e **li esegue** per rispondere alle sue domande. Un
                // binario per iPhone sul Mac non parte, e la risposta a ogni
                // domanda diventa «no». Con `--host` diverso da `--build`
                // autoconf passa in modalità incrociata e smette di eseguire.
                .arg(format!("--host={}", incrocio.host_autoconf))
                .env("CC", xcrun(incrocio.sdk, &["-f", "clang"]))
                // PERCHÉ FISSARE ANCHE AR E RANLIB. In modalità incrociata
                // autoconf cerca `aarch64-apple-ios-ar`, non lo trova, e
                // ripiega sul primo `ar` del PATH avvisando «using cross tools
                // not prefixed with host triplet». Su un Mac con le binutils
                // di Homebrew davanti nel PATH quel primo `ar` è quello GNU,
                // che di archivi Mach-O non sa niente. Chiederli a `xcrun`
                // toglie il dubbio invece di fidarsi dell'ordine del PATH.
                .env("AR", xcrun(incrocio.sdk, &["-f", "ar"]))
                .env("RANLIB", xcrun(incrocio.sdk, &["-f", "ranlib"]))
                .env("CFLAGS", &bandiere)
                // Se chi compila ha `SDKROOT` già impostato — capita dentro
                // Xcode, che lancia i suoi script con l'ambiente pieno — clang
                // se lo prenderebbe come radice al posto del nostro
                // `-isysroot`, e uscirebbe un archivio per la piattaforma
                // sbagliata con il nome giusto. Meglio toglierlo di mezzo.
                .env_remove("SDKROOT");
        }

        esegui(&mut configure, "configure di libdivecomputer");

        // A `make` non serve rimettere niente in ambiente: `configure` cuce
        // CC, CFLAGS, AR e RANLIB dentro i Makefile che genera. Verificato,
        // non dedotto: la compilazione per iPhone fatta con `make` in una
        // shell pulita produce comunque un archivio con `LC_BUILD_VERSION
        // platform IOS`.
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

/// Come parlare a `configure` quando il bersaglio è un telefono Android.
#[cfg(feature = "computer-esterni")]
struct IncrocioAndroid {
    /// Tripletta per `--host=` di autoconf.
    host_autoconf: &'static str,
    /// Percorso pieno del wrapper clang dell'NDK per quel bersaglio.
    cc: String,
    ar: String,
    ranlib: String,
}

/// Traduce la tripletta di cargo in come si compila per Android, oppure `None`
/// quando il bersaglio non è Android e la domanda non si pone.
///
/// PERCHÉ `armv7a-linux-androideabi` E NON `armv7-linux-androideabi`. Rust
/// chiama quel bersaglio `armv7-linux-androideabi`; l'NDK il suo wrapper lo
/// chiama `armv7a-linux-androideabi{API}-clang`, con la «a». Sono lo stesso
/// processore e due nomi, e chi si fida della tripletta di cargo trova un file
/// che non c'è. Autoconf invece vuole la forma senza «a».
#[cfg(feature = "computer-esterni")]
fn incrocio_android(bersaglio: &str) -> Option<IncrocioAndroid> {
    let (host_autoconf, prefisso) = match bersaglio {
        "aarch64-linux-android" => ("aarch64-linux-android", "aarch64-linux-android"),
        "armv7-linux-androideabi" => ("arm-linux-androideabi", "armv7a-linux-androideabi"),
        "i686-linux-android" => ("i686-linux-android", "i686-linux-android"),
        "x86_64-linux-android" => ("x86_64-linux-android", "x86_64-linux-android"),
        _ => return None,
    };

    let ndk = radice_ndk();
    let attrezzi = prebuilt(&ndk);

    Some(IncrocioAndroid {
        host_autoconf,
        cc: attrezzi
            .join(format!("{prefisso}{ANDROID_API}-clang"))
            .display()
            .to_string(),
        ar: attrezzi.join("llvm-ar").display().to_string(),
        ranlib: attrezzi.join("llvm-ranlib").display().to_string(),
    })
}

/// Dove sta l'NDK, e un errore che dice cosa fare se non c'è.
///
/// I tre nomi sono tutti in uso: `NDK_HOME` è quello che vuole Tauri,
/// `ANDROID_NDK_HOME` e `ANDROID_NDK_ROOT` sono quelli che impostano
/// rispettivamente Android Studio e le azioni di CI. Guardarli tutti e tre
/// costa tre righe e toglie un'ora di «ma io ce l'ho, l'NDK».
#[cfg(feature = "computer-esterni")]
fn radice_ndk() -> std::path::PathBuf {
    for nome in ["NDK_HOME", "ANDROID_NDK_HOME", "ANDROID_NDK_ROOT"] {
        if let Ok(valore) = std::env::var(nome) {
            if !valore.is_empty() {
                return std::path::PathBuf::from(valore);
            }
        }
    }
    panic!(
        "FERMO: si sta compilando per Android ma l'NDK non si trova.\n\n\
         Serve una di queste variabili: NDK_HOME, ANDROID_NDK_HOME, ANDROID_NDK_ROOT.\n\
         Chi vuole solo l'interfaccia può saltare tutta la parte C con\n\
         `--no-default-features`."
    );
}

/// La cartella `bin` della catena LLVM dentro l'NDK.
///
/// Il pezzo di mezzo del percorso porta il nome della macchina CHE COMPILA
/// (`linux-x86_64`, `darwin-x86_64`), non del bersaglio. Non si indovina: si
/// legge cosa c'è. Su un Mac Apple Silicon la cartella si chiama comunque
/// `darwin-x86_64` — dentro ci sono binari universali — ed è esattamente il
/// genere di dettaglio per cui indovinare è peggio che guardare.
#[cfg(feature = "computer-esterni")]
fn prebuilt(ndk: &std::path::Path) -> std::path::PathBuf {
    let base = ndk.join("toolchains/llvm/prebuilt");
    let mut voci: Vec<_> = std::fs::read_dir(&base)
        .unwrap_or_else(|e| panic!("FERMO: {} non si legge ({e})", base.display()))
        .filter_map(|v| v.ok())
        .map(|v| v.path())
        .filter(|p| p.is_dir())
        .collect();
    voci.sort();
    let prima = voci.into_iter().next().unwrap_or_else(|| {
        panic!("FERMO: dentro {} non c'è nessuna catena LLVM", base.display())
    });
    prima.join("bin")
}

/// Come parlare a `configure` quando il bersaglio non è la macchina che compila.
#[cfg(feature = "computer-esterni")]
struct IncrocioApple {
    /// Nome dell'SDK per `xcrun --sdk`: `iphoneos` o `iphonesimulator`.
    sdk: &'static str,
    /// Tripletta per il `-target` di clang. È **lei** a decidere davvero per
    /// quale piattaforma esce il codice macchina, non `--host`.
    tripletta_clang: String,
    /// Tripletta per `--host=` di autoconf. Vedi `incrocio_apple`.
    host_autoconf: &'static str,
    /// `-mios-version-min` o `-mios-simulator-version-min`: sono due flag
    /// diverse, e passare quella del telefono al simulatore fa uscire un
    /// archivio che il linker del simulatore rifiuta.
    minima: String,
}

/// Traduce la tripletta di cargo in come si compila per quel bersaglio, oppure
/// `None` quando si compila per la macchina stessa (il Mac) e non c'è niente da
/// dire a `configure` più di quello che indovina da solo.
///
/// PERCHÉ `--host=aarch64-apple-ios` ANCHE PER IL SIMULATORE. Perché il
/// `config.sub` che libdivecomputer 0.9.0 si porta dietro rifiuta la tripletta
/// del simulatore:
///
/// ```text
/// $ ./config.sub aarch64-apple-ios-sim
/// Invalid configuration `aarch64-apple-ios-sim': Kernel `ios' not known to work with OS `sim'.
/// ```
///
/// e non c'è nessun altro nome che sappia dire «simulatore» — `config.sub` è
/// un file del tarball, e il tarball non si tocca. Non è però una perdita:
/// `--host` serve ad autoconf per due cose sole, entrare in modalità incrociata
/// e sapere come prefissare i nomi degli attrezzi, e per tutte e due
/// `aarch64-apple-ios` va bene. La piattaforma vera la decide il `-target` che
/// diamo a clang. Verificato sull'archivio prodotto: con `-target
/// arm64-apple-ios14.0-simulator` esce `LC_BUILD_VERSION platform 7`, cioè
/// simulatore, mentre per il telefono esce `platform 2`, cioè iOS.
#[cfg(feature = "computer-esterni")]
fn incrocio_apple(bersaglio: &str) -> Option<IncrocioApple> {
    // Rust dice `aarch64`, Apple dice `arm64`: sono la stessa architettura con
    // due nomi, e clang capisce solo il secondo dentro una tripletta Apple.
    let arco = match bersaglio.split('-').next()? {
        "aarch64" => "arm64",
        altro => altro,
    };

    // `x86_64-apple-ios` è il simulatore sui Mac Intel: rustc, per ragioni
    // storiche, a quello non appiccica il suffisso `-sim` che invece usa per
    // `aarch64-apple-ios-sim`. Vanno trattati allo stesso modo, e va guardato
    // prima del caso del telefono perché altrimenti ci cadrebbe dentro.
    if bersaglio.ends_with("-apple-ios-sim") || bersaglio == "x86_64-apple-ios" {
        Some(IncrocioApple {
            sdk: "iphonesimulator",
            tripletta_clang: format!("{arco}-apple-ios{IOS_MINIMA}-simulator"),
            host_autoconf: "aarch64-apple-ios",
            minima: format!("-mios-simulator-version-min={IOS_MINIMA}"),
        })
    } else if bersaglio.ends_with("-apple-ios") {
        Some(IncrocioApple {
            sdk: "iphoneos",
            tripletta_clang: format!("{arco}-apple-ios{IOS_MINIMA}"),
            host_autoconf: "aarch64-apple-ios",
            minima: format!("-mios-version-min={IOS_MINIMA}"),
        })
    } else {
        // Mac, o qualunque altra cosa: `configure` indovina da sé, ed è quello
        // che ha sempre fatto. Cambiare anche questo ramo vorrebbe dire
        // rischiare di rompere l'unico bersaglio che oggi funziona.
        None
    }
}

/// Chiede a `xcrun` un percorso dell'SDK indicato, e muore dicendo cosa
/// mancava se Xcode non c'è o l'SDK non è installato — che è l'errore più
/// probabile su una macchina nuova, e da «No such file or directory» non si
/// capirebbe.
#[cfg(feature = "computer-esterni")]
fn xcrun(sdk: &str, argomenti: &[&str]) -> String {
    let uscita = std::process::Command::new("xcrun")
        .arg("--sdk")
        .arg(sdk)
        .args(argomenti)
        .output()
        .unwrap_or_else(|e| panic!("xcrun --sdk {sdk} {argomenti:?}: impossibile avviarlo ({e}) — serve Xcode installato"));
    if !uscita.status.success() {
        panic!(
            "xcrun --sdk {sdk} {argomenti:?}: fallito con {} — manca l'SDK «{sdk}»?\n{}",
            uscita.status,
            String::from_utf8_lossy(&uscita.stderr)
        );
    }
    String::from_utf8_lossy(&uscita.stdout).trim().to_string()
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
fn esegui(comando: &mut std::process::Command, cosa: &str) {
    let esito = comando
        .status()
        .unwrap_or_else(|e| panic!("{cosa}: impossibile avviare il comando ({e})"));
    if !esito.success() {
        panic!("{cosa}: fallito con {esito}");
    }
}
