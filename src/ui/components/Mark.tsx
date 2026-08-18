/**
 * Il marchio: il profilo di un'immersione.
 *
 * È lo stesso disegno dell'icona dell'app (`src-tauri/icons/icon.svg`), tenuto in
 * un componente invece che in un file immagine per due ragioni: scala senza
 * sfocare a qualsiasi densità di schermo, e resta identico nel dock, nella barra
 * dell'app e nella scheda del browser — che è tutto quello che un marchio deve
 * fare quando l'app è una sola.
 *
 * Le due regole di costruzione sono quelle del grafico dentro l'app: il
 * riempimento sta fra la superficie e la traccia, e il punto bianco è la sosta di
 * sicurezza.
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      role="img"
      aria-label="MyDiveLog"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="mark-water" x1="512" y1="0" x2="512" y2="1024" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1c5c9e" />
          <stop offset="0.52" stopColor="#123d71" />
          <stop offset="1" stopColor="#07203c" />
        </linearGradient>
        <linearGradient id="mark-column" x1="512" y1="318" x2="512" y2="792" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9fcbfa" stopOpacity="0.42" />
          <stop offset="1" stopColor="#9fcbfa" stopOpacity="0.04" />
        </linearGradient>
        <clipPath id="mark-card">
          <rect width="1024" height="1024" rx="228" />
        </clipPath>
      </defs>
      <rect width="1024" height="1024" rx="228" fill="url(#mark-water)" />
      <g clipPath="url(#mark-card)">
        <path
          d="M150 318 L352 756 L566 756 L694 536 L792 536 L878 330 L878 318 L150 318 Z"
          fill="url(#mark-column)"
        />
        <path
          d="M150 318 L352 756 L566 756 L694 536 L792 536 L878 330"
          stroke="#9ac6f8"
          strokeWidth={80}
          strokeLinecap="butt"
          strokeLinejoin="round"
        />
        <rect x="128" y="302" width="768" height="32" rx="16" fill="#ffffff" fillOpacity="0.96" />
        <circle cx="694" cy="536" r="60" fill="#ffffff" />
      </g>
    </svg>
  );
}

/** La frase che dice cosa fa questa app e nessun'altra. */
export const CLAIM = 'Il meglio dei tuoi computer, in un logbook solo.';
