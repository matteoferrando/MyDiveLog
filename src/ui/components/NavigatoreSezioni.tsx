/**
 * L'INDICE DI UNA PAGINA LUNGA, sul bordo destro, sotto il pollice.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL PROBLEMA CHE RISOLVE, e perché i capitoli da soli non bastavano. ◄
 *
 * Il Gas ha diciotto capitoli, le Statistiche diciotto, la scheda di
 * un'immersione sette. Chiusi ci stanno quasi tutti in una schermata, e sembra
 * risolto — finché non se ne aprono due: allora l'ottavo torna a essere a mille
 * pixel di distanza, e per arrivarci si trascina alla cieca. *Un indice non
 * serve a una pagina corta: serve a una pagina che può diventare lunga.*
 *
 * ► PERCHÉ UN RAIL DI PUNTI E NON UN ELENCO DI NOMI. ◄ Diciotto nomi in
 * verticale su uno schermo largo 402 px non ci stanno in nessun modo, e in
 * orizzontale sarebbero la striscia che si trascina di lato — il difetto che
 * questa applicazione ha già pagato due volte. I punti costano sedici pixel di
 * larghezza, che sono esattamente il margine che le carte lasciano libero: **il
 * navigatore non ruba niente al contenuto.** Il nome compare quando serve, cioè
 * mentre si preme.
 *
 * ► IL TOCCO APRE, e non solo porta. ◄ Portare qualcuno davanti a un riquadro
 * chiuso è consegnargli il libro alla pagina giusta ma sigillato: due gesti per
 * una cosa sola, e il secondo non è nemmeno ovvio. Un capitolo raggiunto
 * dall'indice si apre.
 *
 * ► QUANDO NON C'È. ◄ Sopra i 700 px mai: là le carte sono aperte, la finestra è
 * alta, e un indice su una pagina che si vede tutta è arredamento. E sotto i sei
 * capitoli mai: con cinque punti l'indice è più lungo della pagina che indicizza.
 */

import { useEffect, useRef, useState } from 'react';
import { impostaApertura, useCapitoli } from './capitoli';
import { contenitoreCheScorre } from '../memoriaDellElenco';
import { comeScorrere } from '../scorri';
import { useLingua } from '../lingua';

/**
 * Sotto questo numero di capitoli l'indice non compare.
 *
 * Sei, misurato sulle pagine vere: Impostazioni ne ha cinque ed è alta 1.8
 * schermate — un indice lì indicizzerebbe una pagina che si scorre in due
 * gesti. La scheda di un'immersione ne ha sette ed è alta quattro: quella lo
 * vuole.
 */
export const MINIMO_CAPITOLI = 6;

export function NavigatoreSezioni() {
  const capitoli = useCapitoli();
  const { t } = useLingua();
  const [corrente, setCorrente] = useState(0);
  const [premuto, setPremuto] = useState<number | null>(null);
  /*
   * Dopo un tocco l'indice smette di inseguire lo scorrimento per un attimo.
   *
   * Senza, succede questo: si tocca il dodicesimo punto, la pagina comincia a
   * scorrere DOLCEMENTE verso il capitolo, e mentre scorre l'osservatore vede
   * passare il settimo, l'ottavo, il nono — e sposta l'evidenziazione su
   * ognuno. Il risultato è un punto che schizza lungo tutto il rail per mezzo
   * secondo dopo ogni tocco: sembra un guasto, ed è solo il seguito fedele di
   * uno scorrimento animato.
   */
  const inViaggio = useRef(false);
  const sveglia = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Il timer va spento allo smontaggio: senza, chi tocca un punto e cambia
  // scheda nello stesso mezzo secondo lascia dietro una chiamata che scrive su
  // un componente che non c'è più.
  useEffect(() => () => clearTimeout(sveglia.current), []);

  /*
   * QUAL È IL CAPITOLO CORRENTE: l'ultimo che ha superato la soglia.
   *
   * Non «quello più vicino al centro»: con un capitolo aperto alto due schermate
   * e i suoi vicini chiusi, il centro cade dentro quello aperto anche quando si
   * sta leggendo il titolo del successivo. La soglia è un ottavo di schermo
   * sotto il bordo alto — cioè poco sotto il punto in cui un titolo si posa
   * quando ci si arriva scorrendo.
   */
  useEffect(() => {
    /*
     * ► CAMBIANDO PAGINA IL VIAGGIO FINISCE, e la prima stesura non lo faceva. ◄
     *
     * Questo componente NON si smonta al cambio di scheda: vive fuori
     * dall'`ErrorBoundary`, che è l'unico a portare la chiave della vista.
     * Quindi `inViaggio` attraversava il cambio pagina, e chi toccava un punto e
     * poi si accorgeva di essere nella scheda sbagliata — cioè il gesto normale
     * — arrivava sulla pagina nuova con l'indice bloccato per mezzo secondo su
     * un capitolo a caso. Misurato: da 18 capitoli a 7, nessun punto acceso.
     */
    inViaggio.current = false;
    clearTimeout(sveglia.current);
    if (capitoli.length < MINIMO_CAPITOLI) return;
    const contenitore = contenitoreCheScorre();
    if (!contenitore) return;
    let attesa = 0;
    const calcola = () => {
      attesa = 0;
      if (inViaggio.current) return;
      const soglia = contenitore.getBoundingClientRect().top + contenitore.clientHeight / 8;
      let trovato = 0;
      for (let i = 0; i < capitoli.length; i++) {
        if (capitoli[i]!.nodo.getBoundingClientRect().top <= soglia) trovato = i;
      }
      setCorrente(trovato);
    };
    const suScorrimento = () => {
      // Un giro di `requestAnimationFrame` per evento di scorrimento: senza,
      // diciotto `getBoundingClientRect` a ogni pixel trascinato, cioè il modo
      // classico di rendere lo scorrimento a scatti proprio mentre si scorre.
      if (!attesa) attesa = requestAnimationFrame(calcola);
    };
    calcola();
    contenitore.addEventListener('scroll', suScorrimento, { passive: true });
    return () => {
      contenitore.removeEventListener('scroll', suScorrimento);
      if (attesa) cancelAnimationFrame(attesa);
    };
  }, [capitoli]);

  if (capitoli.length < MINIMO_CAPITOLI) return null;

  /*
   * L'indice acceso si taglia sulla lunghezza VERA, al disegno.
   *
   * Passare da una pagina di diciotto capitoli a una di sette lascia `corrente`
   * a quindici per un istante, e in quell'istante nessun punto è acceso: un
   * indice che non dice dove si è. Tagliarlo qui rende «uno e uno solo» vero per
   * costruzione invece che per fortuna, senza aggiungere uno stato che si può
   * dimenticare di aggiornare.
   */
  const acceso = Math.min(corrente, capitoli.length - 1);

  const vaiA = (i: number) => {
    const c = capitoli[i];
    if (!c) return;
    impostaApertura(c.chiave, true);
    setCorrente(i);
    inViaggio.current = true;
    clearTimeout(sveglia.current);
    sveglia.current = setTimeout(() => {
      inViaggio.current = false;
    }, 700);
    /*
     * `block: 'start'` e non `'center'`: un capitolo che si apre cresce verso il
     * basso, e centrarne il titolo prima che cresca lo lascia poi a metà
     * schermo. Portato in cima, il titolo resta in cima comunque vada.
     *
     * ► E IL MODO DI SCORRERE LO DECIDE `comeScorrere()`. ◄ Era `'smooth'`
     * scritto a mano — l'unico `scrollIntoView` del progetto a non guardare
     * `prefers-reduced-motion`. Un tocco qui può animare quattro schermate, cioè
     * il caso peggiore per chi quell'impostazione l'ha accesa apposta.
     */
    c.nodo.scrollIntoView({ behavior: comeScorrere(), block: 'start' });
  };

  /*
   * ► IL PASSO È FISSO A VENTIQUATTRO, e il ramo che lo stringeva è sparito. ◄
   *
   * Ventiquattro pixel fra un centro e l'altro sono la misura sotto la quale un
   * bersaglio piccolo smette di essere accettabile: è l'eccezione di spaziatura
   * di WCAG 2.2 AA (2.5.8), e sotto quella soglia non vale più. C'era un ramo
   * che a più di venti capitoli passava a 20 px «perché un indice che esce dallo
   * schermo non indicizza più niente» — ma nessuna pagina arriva a ventuno
   * capitoli (il massimo è diciotto), quindi quel ramo non è mai girato, e il
   * giorno che girasse renderebbe l'indice non conforme proprio dove serve di
   * più. *Un ramo morto che sarebbe sbagliato se vivesse va tolto, non tenuto
   * per prudenza.*
   *
   * Se un giorno una pagina superasse i ventisette capitoli (648 px, più
   * dell'altezza utile di un iPhone SE), la risposta giusta non è stringere i
   * punti: è che quella pagina ha troppi capitoli.
   */
  const passo = 24;

  return (
    <nav
      className="navigatore-sezioni"
      aria-label={t('Sezioni della pagina')}
      style={{ ['--passo' as string]: `${passo}px` }}
    >
      {capitoli.map((c, i) => (
        <button
          key={c.chiave}
          type="button"
          className={i === acceso ? 'punto punto-corrente' : 'punto'}
          /* Il nome sta nell'etichetta e non nel testo: a schermo è un punto, a
             un lettore di schermo è «Esposizione all'ossigeno». */
          aria-label={c.titolo}
          aria-current={i === acceso ? 'true' : undefined}
          onPointerDown={() => setPremuto(i)}
          onPointerUp={() => setPremuto(null)}
          onPointerLeave={() => setPremuto(null)}
          onPointerCancel={() => setPremuto(null)}
          onFocus={() => setPremuto(i)}
          onBlur={() => setPremuto(null)}
          onClick={() => vaiA(i)}
        >
          <span className="punto-segno" aria-hidden="true" />
        </button>
      ))}
      {/*
       * L'etichetta è UNA sola, posizionata, e non una per punto.
       *
       * Diciotto etichette nascoste sono diciotto nodi di testo che il lettore
       * di schermo attraversa e che il browser dispone a ogni render. Una sola,
       * spostata con `top`, fa la stessa cosa a schermo e costa un nodo.
       */}
      {premuto !== null && capitoli[premuto] && (
        <span className="navigatore-nome" style={{ top: premuto * passo + passo / 2 }} aria-hidden="true">
          <b>{capitoli[premuto].titolo}</b>
          {capitoli[premuto].sommario ? <em>{capitoli[premuto].sommario}</em> : null}
        </span>
      )}
    </nav>
  );
}
