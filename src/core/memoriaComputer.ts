/**
 * Quel poco che l'applicazione ricorda di un singolo computer subacqueo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ UN FILE A PARTE PER TRE FUNZIONI DI QUATTRO RIGHE. ◄
 *
 * Perché le quattro righe non sono le tre funzioni: sono i `try`/`catch`
 * intorno. `localStorage` **lancia al solo accesso** su alcuni browser quando i
 * dati dei siti sono bloccati, e non esiste affatto in certi ambienti di prova.
 * Un file che dimentica una di quelle protezioni non dà un dato sbagliato: fa
 * fallire l'apertura di una scheda, e il sintomo è a due schermate di distanza
 * dalla causa.
 *
 * Le cose ricordate finora sono due — la chiave di accoppiamento di chi chiede
 * un PIN, e il metodo di collegamento che ha funzionato — e la seconda è
 * arrivata dopo la prima. Averle scritte due volte sarebbe stato il modo di
 * scoprire fra sei mesi che una delle due copie aveva perso un `catch`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► COSA NON VA MESSO QUI. ◄ Niente che valga altrove: questo è un archivio in
 * chiaro nel browser dell'applicazione. Ci stanno cose che hanno senso solo
 * davanti a quell'apparecchio — una chiave di accoppiamento, il nome di una
 * combinazione di UUID — e non ci sta niente che somigli a una parola
 * d'accesso. Per quelle c'è il portachiavi di sistema, che è un'altra cosa.
 */

/**
 * L'archivio dove si scrive. Iniettabile per le prove.
 *
 * Si legge al momento della chiamata e non all'importazione: in un ambiente
 * senza `localStorage` leggerlo all'importazione farebbe fallire il
 * caricamento del modulo, cioè romperebbe l'applicazione intera per una
 * comodità.
 */
function archivio(dato?: Storage): Storage | undefined {
  if (dato) return dato;
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Legge il valore ricordato per questo dispositivo, se è ancora valido.
 *
 * `valida` è la ragione per cui questa funzione prende una funzione: un valore
 * malformato — scritto da una versione più vecchia, o rimasto a metà — deve
 * valere come **assente**, non essere restituito a metà. Chi chiama sa cosa sia
 * valido; questo file sa solo dove guardare.
 */
export function ricordo(
  prefisso: string,
  dispositivo: string,
  valida: (v: string) => boolean,
  dato?: Storage,
): string | undefined {
  const dove = archivio(dato);
  if (!dove || dispositivo === '') return undefined;
  let grezzo: string | null = null;
  try {
    grezzo = dove.getItem(prefisso + dispositivo);
  } catch {
    return undefined;
  }
  if (grezzo === null) return undefined;
  const pulito = grezzo.trim();
  return valida(pulito) ? pulito : undefined;
}

/**
 * Ricorda un valore per questo dispositivo.
 *
 * Un guasto della scrittura — spazio finito, dati dei siti bloccati — non si
 * racconta a nessuno: la conseguenza è che la volta dopo si rifarà quello che
 * si è appena fatto, che è un fastidio e non un guasto. Un riquadro rosso a
 * operazione riuscita costerebbe più della verità che nasconde.
 */
export function ricorda(
  prefisso: string,
  dispositivo: string,
  valore: string,
  valida: (v: string) => boolean,
  dato?: Storage,
): void {
  const dove = archivio(dato);
  const pulito = valore.trim();
  if (!dove || dispositivo === '' || !valida(pulito)) return;
  try {
    dove.setItem(prefisso + dispositivo, pulito);
  } catch {
    // Vedi sopra.
  }
}

/** Dimentica quello che si ricordava di questo dispositivo. */
export function dimentica(prefisso: string, dispositivo: string, dato?: Storage): void {
  const dove = archivio(dato);
  if (!dove || dispositivo === '') return;
  try {
    dove.removeItem(prefisso + dispositivo);
  } catch {
    // Vedi sopra.
  }
}
