//! Scrivere più istruzioni SQL come **una cosa sola**.
//!
//! ════════════════════════════════════════════════════════════════════════════
//! ► IL DIFETTO CHE QUESTO MODULO CHIUDE, misurato da una verifica esterna il
//!   16 settembre 2026. ◄
//!
//! In `storage/sqlite.ts` c'era scritto, sopra `putDives`, *«Scrive le
//! immersioni, TUTTE O NESSUNA»*, e sotto:
//!
//! ```text
//!   await this.sql.execute('BEGIN');
//!   …gli inserimenti…
//!   await this.sql.execute('COMMIT');
//! ```
//!
//! Sembra una transazione e non lo è. `tauri-plugin-sql` non tiene una
//! connessione: tiene un **pool** SQLx, e ogni `execute` ne prende una
//! qualunque, la usa e la restituisce. `BEGIN` apre una transazione su una
//! connessione; SQLx, quando quella connessione torna nel pool, **annulla da sé
//! la transazione rimasta aperta**; gli inserimenti arrivano su una connessione
//! senza transazione, cioè in auto-commit, e si scrivono uno per uno; `COMMIT`
//! e `ROLLBACK` non trovano niente da chiudere.
//!
//! La verifica l'ha riprodotto con SQLx 0.8.6, la stessa versione che sta in
//! `Cargo.lock`:
//!
//! ```text
//!   BEGIN    Ok(SqliteQueryResult { changes: 0 })
//!   INSERT   Ok(SqliteQueryResult { changes: 1 })
//!   ROLLBACK Ok(SqliteQueryResult { changes: 0 })
//!   Righe dopo il rollback: 1
//! ```
//!
//! **Tre risposte «Ok» e la riga resta.** Non c'è un errore da nessuna parte: è
//! esattamente la forma di difetto che questo progetto insegue — *un esito zero
//! dice che il comando non è morto, non che abbia fatto quello che doveva.*
//!
//! ► PERCHÉ IMPORTA, e non è un cavillo da manuale. ◄ Ogni immersione sono
//! **tre scritture**: il riepilogo, il profilo, l'eventuale secondo profilo. In
//! auto-commit sono tre transazioni separate; l'applicazione che muore in mezzo
//! — su un telefono succede quando il sistema ha bisogno di memoria — lascia in
//! archivio un'immersione **senza il suo profilo**. Su un dispositivo con
//! l'account la sincronizzazione lo ripesca; su uno senza, quel profilo non c'è
//! più e niente lo dice.
//!
//! ► PERCHÉ LA CURA STA QUI E NON LÀ. ◄ Perché dal lato TypeScript una
//! transazione vera **non si può scrivere**: il plugin espone `execute` e
//! `select`, e nessuno dei due permette di dire «queste istruzioni sulla stessa
//! connessione». La connessione la si può tenere solo da questa parte. Da cui
//! un comando solo, che riceve l'elenco delle istruzioni e le esegue dentro una
//! transazione che possiede la sua connessione dall'inizio alla fine.
//!
//! **L'SQL resta in TypeScript**, dove è sempre stato: qui non si sa niente di
//! immersioni, di profili e di tabelle. Questo modulo sa una cosa sola — o tutte
//! o nessuna — ed è il motivo per cui serve anche a `deleteDive` e a `clear`,
//! che avevano lo stesso difetto e che nessuno aveva guardato perché non
//! nominavano nemmeno una transazione.

use serde::Deserialize;
use sqlx::{Executor, Sqlite};

/// Un'istruzione e i suoi valori, come li manda il lato TypeScript.
#[derive(Deserialize)]
pub struct Passo {
    /// L'SQL, con i `?` al posto dei valori.
    pub sql: String,
    /// I valori da legare, nell'ordine dei `?`.
    #[serde(default)]
    pub valori: Vec<serde_json::Value>,
}

/// Il cuore, senza Tauri intorno — ed è senza Tauri intorno **perché si prova**.
///
/// Un comando `#[tauri::command]` vuole un `AppHandle`, e un `AppHandle` vuole
/// un'applicazione avviata: una prova che ne avesse bisogno non girerebbe in
/// `cargo test`. Separando il pool dal modo di trovarlo, la parte che contiene
/// la regola diventa una funzione qualunque a cui si passa un archivio finto.
pub async fn in_transazione(pool: &sqlx::Pool<Sqlite>, passi: &[Passo]) -> Result<(), String> {
    /*
     * ► E QUI C'ERA UN `PRAGMA foreign_keys = ON` CHE NON SERVIVA A NIENTE. ◄
     *
     * L'avevo scritto io, con accanto un commento che spiegava perché fosse
     * indispensabile: le chiavi esterne valgono **per connessione**, e dentro
     * una transazione quel pragma è un'istruzione che SQLite ignora — quindi
     * andava prima. Ragionamento giusto, conclusione sbagliata: **SQLx accende
     * le chiavi esterne da sé su ogni connessione che apre**
     * (`SqliteConnectOptions` le ha vere per difetto), quindi quella riga
     * ripeteva una cosa già fatta.
     *
     * Si è visto togliendola: la prova che doveva difenderla —
     * `le_chiavi_esterne_valgono_dentro_la_transazione` — **è rimasta verde col
     * difetto messo**. *Una guardia che non si è mai vista rossa non è una
     * guardia*, e una riga che protegge da qualcosa da cui era già protetto non
     * è prudenza: è una seconda copia di una regola, che il giorno che le due
     * divergono fa cercare nel posto sbagliato.
     *
     * Quello che resta è la PROPRIETÀ, non la riga: quella prova pretende che
     * un profilo senza il suo riepilogo venga respinto. Se un giorno SQLx
     * cambiasse il suo difetto, diventerebbe rossa e si saprebbe perché.
     */
    let mut transazione = pool
        .begin()
        .await
        .map_err(|e| format!("transazione non aperta: {e}"))?;

    for (indice, passo) in passi.iter().enumerate() {
        let mut interrogazione = sqlx::query(&passo.sql);
        for valore in &passo.valori {
            interrogazione = match valore {
                /*
                 * Gli stessi tipi che lega `tauri-plugin-sql` nel suo `execute`,
                 * e di proposito: le stesse istruzioni passavano di là fino a
                 * ieri, e un valore legato in modo diverso vorrebbe dire che le
                 * righe scritte da qui non sono identiche a quelle scritte da
                 * là. I numeri vanno in `f64` come fa lui — SQLite ha
                 * l'affinità di tipo e in una colonna `INTEGER` un 42.0 torna
                 * 42.
                 */
                serde_json::Value::Null => interrogazione.bind(None::<String>),
                serde_json::Value::String(s) => interrogazione.bind(s.clone()),
                serde_json::Value::Number(n) => interrogazione.bind(n.as_f64().unwrap_or_default()),
                serde_json::Value::Bool(b) => interrogazione.bind(*b),
                /*
                 * ► E QUI CI SI FERMA, invece di indovinare. ◄
                 *
                 * Il plugin, per un array o un oggetto, lega il JSON grezzo e
                 * si affida a una caratteristica di SQLx che potrebbe non
                 * esserci. Nessuna delle istruzioni di questo programma passa
                 * di qui — si legano identificativi, date, numeri e documenti
                 * già serializzati — quindi arrivarci significa che qualcuno ha
                 * scritto un passo nuovo e non ci ha pensato. *Meglio un errore
                 * che si legge subito che una riga scritta in un modo che
                 * nessuno ha deciso.*
                 */
                altro => {
                    return Err(format!(
                        "passo {}: il valore {altro} non è legabile (attesi testo, numero, booleano o vuoto)",
                        indice + 1
                    ))
                }
            };
        }
        /*
         * Il fallimento ESCE, e non si continua col passo dopo.
         *
         * `transazione` viene lasciata cadere qui senza `commit`, e SQLx la
         * annulla: è la ragione per cui non serve un `ROLLBACK` scritto a mano
         * — e la ragione per cui quello scritto a mano, nella versione di
         * prima, poteva fallire a sua volta senza che nessuno se ne accorgesse.
         */
        (&mut *transazione)
            .execute(interrogazione)
            .await
            .map_err(|e| format!("passo {} di {}: {e}", indice + 1, passi.len()))?;
    }

    transazione
        .commit()
        .await
        .map_err(|e| format!("scrittura non confermata: {e}"))
}

/// Le istruzioni arrivano da TypeScript; la connessione la tiene questo lato.
///
/// `archivio` è la stringa con cui l'archivio è stato aperto —
/// `sqlite:mydivelog.db` — perché è la chiave con cui `tauri-plugin-sql` tiene
/// i suoi pool. Non è un percorso e non va costruita: è la stessa costante che
/// il lato TypeScript passa a `Database.load`, e se le due divergono questo
/// comando risponde «non è aperto» invece di aprire un secondo archivio per
/// conto suo.
#[tauri::command]
pub async fn tutte_o_nessuna(
    app: tauri::AppHandle,
    archivio: String,
    passi: Vec<Passo>,
) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_sql::{DbInstances, DbPool};

    let istanze = app.state::<DbInstances>();
    let aperti = istanze.0.read().await;
    let Some(DbPool::Sqlite(pool)) = aperti.get(&archivio) else {
        return Err(format!(
            "l'archivio «{archivio}» non è aperto: la scrittura non è stata tentata"
        ));
    };
    in_transazione(pool, &passi).await
}

#[cfg(test)]
mod prove {
    use super::*;
    use sqlx::Row;

    fn passo(sql: &str, valori: Vec<serde_json::Value>) -> Passo {
        Passo { sql: sql.to_string(), valori }
    }

    /// Un archivio vero, in un file temporaneo, con un pool come quello del plugin.
    ///
    /// **Un file e non `:memory:`**, e non è pigrizia: un archivio in memoria di
    /// SQLite appartiene alla singola connessione, quindi un pool ne creerebbe
    /// uno diverso per connessione — e la prova qui sotto, che esiste proprio
    /// per misurare cosa fa un pool, misurerebbe un'altra cosa.
    fn archivio_di_prova(nome: &str) -> sqlx::Pool<Sqlite> {
        let percorso = std::env::temp_dir().join(format!("mydivelog-prova-{nome}.db"));
        let _ = std::fs::remove_file(&percorso);
        let url = format!("sqlite:{}?mode=rwc", percorso.display());
        tauri::async_runtime::block_on(async move {
            let pool = sqlx::Pool::<Sqlite>::connect(&url).await.unwrap();
            pool.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
                .await
                .unwrap();
            pool
        })
    }

    fn quante(pool: &sqlx::Pool<Sqlite>) -> i64 {
        tauri::async_runtime::block_on(async {
            sqlx::query("SELECT COUNT(*) AS n FROM t")
                .fetch_one(pool)
                .await
                .unwrap()
                .get::<i64, _>("n")
        })
    }

    /// ► LA MISURA DEL DIFETTO, ed è la prova che giustifica tutto il modulo. ◄
    ///
    /// Se un giorno questa diventasse rossa vorrebbe dire che SQLx ha cambiato
    /// comportamento e che `BEGIN` sul pool funziona: allora questo modulo si
    /// potrebbe togliere. Finché resta verde, toglierlo rimette il difetto.
    #[test]
    fn begin_e_rollback_sul_pool_non_annullano_niente() {
        let pool = archivio_di_prova("pool");
        tauri::async_runtime::block_on(async {
            pool.execute("BEGIN").await.unwrap();
            pool.execute("INSERT INTO t (id, v) VALUES (1, 'rimasta')").await.unwrap();
            // Il `ROLLBACK` può anche lamentarsi di non avere niente da annullare:
            // il punto non è cosa risponde, è cosa resta sul disco.
            let _ = pool.execute("ROLLBACK").await;
        });
        assert_eq!(
            quante(&pool),
            1,
            "se fosse 0 il pool saprebbe fare le transazioni, e questo modulo non servirebbe"
        );
    }

    /// E la stessa sequenza dentro `in_transazione`: o tutto o niente.
    #[test]
    fn un_passo_che_fallisce_non_lascia_in_piedi_quelli_di_prima() {
        let pool = archivio_di_prova("tutte-o-nessuna");
        let esito = tauri::async_runtime::block_on(in_transazione(
            &pool,
            &[
                passo("INSERT INTO t (id, v) VALUES (?, ?)", vec![1.into(), "prima".into()]),
                passo("INSERT INTO t (id, v) VALUES (?, ?)", vec![2.into(), "seconda".into()]),
                // Il vincolo `NOT NULL` fa fallire la terza: è il guasto a metà
                // strada, cioè il caso per cui la transazione esiste.
                passo("INSERT INTO t (id, v) VALUES (?, ?)", vec![3.into(), serde_json::Value::Null]),
            ],
        ));

        let errore = esito.expect_err("il terzo passo doveva fallire");
        assert!(errore.contains("passo 3 di 3"), "l'errore dice quale passo: {errore}");
        assert_eq!(quante(&pool), 0, "le prime due non devono essere rimaste");
    }

    /// E quando va bene, ci sono tutte.
    #[test]
    fn quando_nessun_passo_fallisce_ci_sono_tutte() {
        // La metà che impedisce di «correggere» annullando sempre: una
        // transazione che non scrive mai passerebbe la prova qui sopra.
        let pool = archivio_di_prova("tutte-scritte");
        tauri::async_runtime::block_on(in_transazione(
            &pool,
            &[
                passo("INSERT INTO t (id, v) VALUES (?, ?)", vec![1.into(), "prima".into()]),
                passo("INSERT INTO t (id, v) VALUES (?, ?)", vec![2.into(), "seconda".into()]),
            ],
        ))
        .unwrap();
        assert_eq!(quante(&pool), 2);
    }

    /// Un figlio senza padre viene respinto: è la proprietà, chiunque l'abbia accesa.
    #[test]
    fn le_chiavi_esterne_valgono_dentro_la_transazione() {
        /*
         * ► SI MISURA LA PROPRIETÀ, NON LA RIGA CHE DOVREBBE PRODURLA. ◄
         *
         * La prima stesura si chiamava «sono accese dentro la transazione» e
         * doveva difendere un `PRAGMA foreign_keys = ON` scritto qui sopra:
         * togliendo il pragma è rimasta VERDE, perché le chiavi esterne le
         * accende SQLx per conto suo su ogni connessione. La prova aveva
         * ragione sul fatto e torto sul motivo — cioè era una guardia che non
         * poteva diventare rossa.
         *
         * Adesso dice quello che sa: un profilo il cui riepilogo non c'è non
         * entra. Se SQLx cambiasse il suo difetto, questa diventerebbe rossa —
         * ed è esattamente il giorno in cui bisogna saperlo, perché un profilo
         * orfano è un profilo che nessuna query troverà mai più.
         *
         * Due tabelle legate come `dives` e `dive_samples`.
         */
        let pool = archivio_di_prova("chiavi");
        tauri::async_runtime::block_on(async {
            pool.execute("CREATE TABLE padre (id TEXT PRIMARY KEY)").await.unwrap();
            pool.execute(
                "CREATE TABLE figlio (id TEXT PRIMARY KEY, padre_id TEXT NOT NULL REFERENCES padre(id))",
            )
            .await
            .unwrap();
        });

        let esito = tauri::async_runtime::block_on(in_transazione(
            &pool,
            &[passo(
                "INSERT INTO figlio (id, padre_id) VALUES (?, ?)",
                vec!["f".into(), "padre-che-non-c-e".into()],
            )],
        ));
        assert!(esito.is_err(), "senza il pragma il figlio orfano sarebbe entrato");
    }

    /// Un valore che non sappiamo legare si dichiara, non si indovina.
    #[test]
    fn un_valore_non_legabile_ferma_tutto_prima_di_scrivere() {
        let pool = archivio_di_prova("valore-strano");
        let esito = tauri::async_runtime::block_on(in_transazione(
            &pool,
            &[
                passo("INSERT INTO t (id, v) VALUES (?, ?)", vec![1.into(), "prima".into()]),
                passo(
                    "INSERT INTO t (id, v) VALUES (?, ?)",
                    vec![2.into(), serde_json::json!({ "non": "legabile" })],
                ),
            ],
        ));
        assert!(esito.unwrap_err().contains("non è legabile"));
        assert_eq!(quante(&pool), 0, "nemmeno la prima deve restare");
    }
}
