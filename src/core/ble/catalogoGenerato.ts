/**
 * I computer subacquei che libdivecomputer sa leggere VIA BLE.
 *
 * ► FILE GENERATO — non modificarlo a mano. ◄
 * Rigeneralo con: node scripts/catalogo-computer.mjs
 *
 * Fonte: libdivecomputer 0.9.0, `src/descriptor.c`, filtrato su
 * `DC_TRANSPORT_BLE`. Su 356 modelli descritti dalla libreria, questi sono
 * quelli raggiungibili da un telefono: la porta seriale e l'USB su iPhone non
 * esistono, e il Bluetooth classico è riservato ai profili di sistema.
 *
 * Il perché per esteso sta in testa allo script che lo genera.
 */

export interface ModelloComputer {
  marca: string;
  modello: string;
  /** La famiglia di driver di libdivecomputer, es. `shearwater_petrel`. */
  famiglia: string;
  /**
   * I numeri di modello che portano questo nome commerciale.
   *
   * Quasi sempre uno solo. Quando sono più d'uno sono revisioni hardware
   * vendute con lo stesso nome — «OSTC 2» ne ha tre — e la revisione la
   * riconosce il driver alla connessione: il numero non è scritto da nessuna
   * parte sull'apparecchio, quindi non si può chiedere a chi ce l'ha in mano.
   */
  numeri: readonly number[];
}

/** 105 modelli, 20 marche. */
export const MODELLI_BLE: readonly ModelloComputer[] = [
  { marca: 'Apeks', modello: 'DSX', famiglia: 'pelagic_i330r', numeri: [18241] },
  { marca: 'Aqualung', modello: 'i200C', famiglia: 'oceanic_atom2', numeri: [17993, 18249] },
  { marca: 'Aqualung', modello: 'i300C', famiglia: 'oceanic_atom2', numeri: [17992] },
  { marca: 'Aqualung', modello: 'i330R', famiglia: 'pelagic_i330r', numeri: [18244] },
  { marca: 'Aqualung', modello: 'i330R Console', famiglia: 'pelagic_i330r', numeri: [18253] },
  { marca: 'Aqualung', modello: 'i470TC', famiglia: 'oceanic_atom2', numeri: [18243] },
  { marca: 'Aqualung', modello: 'i550C', famiglia: 'oceanic_atom2', numeri: [18002] },
  { marca: 'Aqualung', modello: 'i750TC', famiglia: 'oceanic_atom2', numeri: [17754] },
  { marca: 'Aqualung', modello: 'i770R', famiglia: 'oceanic_atom2', numeri: [18001] },
  { marca: 'Cressi', modello: 'Cartesio', famiglia: 'cressi_goa', numeri: [1] },
  { marca: 'Cressi', modello: 'Donatello', famiglia: 'cressi_goa', numeri: [4] },
  { marca: 'Cressi', modello: 'Goa', famiglia: 'cressi_goa', numeri: [2] },
  { marca: 'Cressi', modello: 'Leonardo 2.0', famiglia: 'cressi_goa', numeri: [3] },
  { marca: 'Cressi', modello: 'Michelangelo', famiglia: 'cressi_goa', numeri: [5] },
  { marca: 'Cressi', modello: 'Neon', famiglia: 'cressi_goa', numeri: [9] },
  { marca: 'Cressi', modello: 'Nepto', famiglia: 'cressi_goa', numeri: [10] },
  { marca: 'Crest', modello: 'CR-4', famiglia: 'deepsix_excursion', numeri: [0] },
  { marca: 'Deep Six', modello: 'Excursion', famiglia: 'deepsix_excursion', numeri: [0] },
  { marca: 'Deepblu', modello: 'Cosmiq+', famiglia: 'deepblu_cosmiq', numeri: [0] },
  { marca: 'Divesoft', modello: 'Freedom', famiglia: 'divesoft_freedom', numeri: [19] },
  { marca: 'Divesoft', modello: 'Liberty', famiglia: 'divesoft_freedom', numeri: [10] },
  { marca: 'Genesis', modello: 'Centauri', famiglia: 'deepsix_excursion', numeri: [0] },
  { marca: 'Halcyon', modello: 'Symbios Handset', famiglia: 'halcyon_symbios', numeri: [7] },
  { marca: 'Halcyon', modello: 'Symbios HUD', famiglia: 'halcyon_symbios', numeri: [1] },
  { marca: 'Heinrichs Weikamp', modello: 'OSTC 2', famiglia: 'hw_ostc3', numeri: [17, 19, 27] },
  { marca: 'Heinrichs Weikamp', modello: 'OSTC 2 TR', famiglia: 'hw_ostc3', numeri: [51] },
  { marca: 'Heinrichs Weikamp', modello: 'OSTC 4', famiglia: 'hw_ostc3', numeri: [59] },
  { marca: 'Heinrichs Weikamp', modello: 'OSTC 5', famiglia: 'hw_ostc3', numeri: [59] },
  { marca: 'Heinrichs Weikamp', modello: 'OSTC Plus', famiglia: 'hw_ostc3', numeri: [19, 26] },
  { marca: 'Heinrichs Weikamp', modello: 'OSTC Sport', famiglia: 'hw_ostc3', numeri: [18, 19] },
  { marca: 'Mares', modello: 'Genius', famiglia: 'mares_iconhd', numeri: [28] },
  { marca: 'Mares', modello: 'Puck 4', famiglia: 'mares_iconhd', numeri: [53] },
  { marca: 'Mares', modello: 'Puck Air 2', famiglia: 'mares_iconhd', numeri: [45] },
  { marca: 'Mares', modello: 'Puck Lite', famiglia: 'mares_iconhd', numeri: [53] },
  { marca: 'Mares', modello: 'Puck Pro', famiglia: 'mares_iconhd', numeri: [24] },
  { marca: 'Mares', modello: 'Puck Pro +', famiglia: 'mares_iconhd', numeri: [24] },
  { marca: 'Mares', modello: 'Quad', famiglia: 'mares_iconhd', numeri: [41] },
  { marca: 'Mares', modello: 'Quad Air', famiglia: 'mares_iconhd', numeri: [35] },
  { marca: 'Mares', modello: 'Quad Ci', famiglia: 'mares_iconhd', numeri: [49] },
  { marca: 'Mares', modello: 'Sirius', famiglia: 'mares_iconhd', numeri: [47] },
  { marca: 'Mares', modello: 'Smart', famiglia: 'mares_iconhd', numeri: [16] },
  { marca: 'Mares', modello: 'Smart Air', famiglia: 'mares_iconhd', numeri: [36] },
  { marca: 'Mares', modello: 'Smart Apnea', famiglia: 'mares_iconhd', numeri: [65552] },
  { marca: 'McLean', modello: 'Extreme', famiglia: 'mclean_extreme', numeri: [0] },
  { marca: 'Oceanic', modello: 'Geo 4.0', famiglia: 'oceanic_atom2', numeri: [18003] },
  { marca: 'Oceanic', modello: 'Geo Air', famiglia: 'oceanic_atom2', numeri: [18251] },
  { marca: 'Oceanic', modello: 'Pro Plus 4', famiglia: 'oceanic_atom2', numeri: [18006] },
  { marca: 'Oceanic', modello: 'Pro Plus X', famiglia: 'oceanic_atom2', numeri: [17746] },
  { marca: 'Oceanic', modello: 'Veo 4.0', famiglia: 'oceanic_atom2', numeri: [18004] },
  { marca: 'Oceans', modello: 'S1', famiglia: 'oceans_s1', numeri: [0] },
  { marca: 'Ratio', modello: 'ATOM', famiglia: 'divesystem_idive', numeri: [150] },
  { marca: 'Ratio', modello: 'iDive 2 Deep', famiglia: 'divesystem_idive', numeri: [132] },
  { marca: 'Ratio', modello: 'iDive 2 Easy', famiglia: 'divesystem_idive', numeri: [130] },
  { marca: 'Ratio', modello: 'iDive 2 Fancy', famiglia: 'divesystem_idive', numeri: [129] },
  { marca: 'Ratio', modello: 'iDive 2 Free', famiglia: 'divesystem_idive', numeri: [128] },
  { marca: 'Ratio', modello: 'iDive 2 Pro', famiglia: 'divesystem_idive', numeri: [131] },
  { marca: 'Ratio', modello: 'iDive 2 Reb', famiglia: 'divesystem_idive', numeri: [134] },
  { marca: 'Ratio', modello: 'iDive 2 Tech', famiglia: 'divesystem_idive', numeri: [133] },
  { marca: 'Ratio', modello: 'iX3M 2 Deep', famiglia: 'divesystem_idive', numeri: [259] },
  { marca: 'Ratio', modello: 'iX3M 2 Easy', famiglia: 'divesystem_idive', numeri: [257] },
  { marca: 'Ratio', modello: 'iX3M 2 Gauge', famiglia: 'divesystem_idive', numeri: [256] },
  { marca: 'Ratio', modello: 'iX3M 2 GPS Deep', famiglia: 'divesystem_idive', numeri: [147] },
  { marca: 'Ratio', modello: 'iX3M 2 GPS Easy', famiglia: 'divesystem_idive', numeri: [145] },
  { marca: 'Ratio', modello: 'iX3M 2 GPS Gauge', famiglia: 'divesystem_idive', numeri: [144] },
  { marca: 'Ratio', modello: 'iX3M 2 GPS Pro', famiglia: 'divesystem_idive', numeri: [146] },
  { marca: 'Ratio', modello: 'iX3M 2 GPS Reb', famiglia: 'divesystem_idive', numeri: [149] },
  { marca: 'Ratio', modello: 'iX3M 2 GPS Tech', famiglia: 'divesystem_idive', numeri: [148] },
  { marca: 'Ratio', modello: 'iX3M 2 Pro', famiglia: 'divesystem_idive', numeri: [258] },
  { marca: 'Ratio', modello: 'iX3M 2 Tech+', famiglia: 'divesystem_idive', numeri: [260] },
  { marca: 'Ratio', modello: 'iX3M 2021 GPS Deep', famiglia: 'divesystem_idive', numeri: [99] },
  { marca: 'Ratio', modello: 'iX3M 2021 GPS Easy', famiglia: 'divesystem_idive', numeri: [97] },
  { marca: 'Ratio', modello: 'iX3M 2021 GPS Fancy', famiglia: 'divesystem_idive', numeri: [96] },
  { marca: 'Ratio', modello: 'iX3M 2021 GPS Pro ', famiglia: 'divesystem_idive', numeri: [98] },
  { marca: 'Ratio', modello: 'iX3M 2021 GPS Reb', famiglia: 'divesystem_idive', numeri: [101] },
  { marca: 'Ratio', modello: 'iX3M 2021 GPS Tech+', famiglia: 'divesystem_idive', numeri: [100] },
  { marca: 'Scorpena', modello: 'Alpha', famiglia: 'deepsix_excursion', numeri: [0] },
  { marca: 'Scubapro', modello: 'Aladin A1', famiglia: 'uwatec_smart', numeri: [37] },
  { marca: 'Scubapro', modello: 'Aladin A2', famiglia: 'uwatec_smart', numeri: [40] },
  { marca: 'Scubapro', modello: 'Aladin H Matrix', famiglia: 'uwatec_smart', numeri: [23] },
  { marca: 'Scubapro', modello: 'Aladin Sport Matrix', famiglia: 'uwatec_smart', numeri: [23] },
  { marca: 'Scubapro', modello: 'G2', famiglia: 'uwatec_smart', numeri: [50] },
  { marca: 'Scubapro', modello: 'G2 Console', famiglia: 'uwatec_smart', numeri: [50] },
  { marca: 'Scubapro', modello: 'G2 HUD', famiglia: 'uwatec_smart', numeri: [66] },
  { marca: 'Scubapro', modello: 'G2 TEK', famiglia: 'uwatec_smart', numeri: [49] },
  { marca: 'Scubapro', modello: 'G3', famiglia: 'uwatec_smart', numeri: [52] },
  { marca: 'Scubapro', modello: 'Luna 2.0', famiglia: 'uwatec_smart', numeri: [81] },
  { marca: 'Scubapro', modello: 'Luna 2.0 AI', famiglia: 'uwatec_smart', numeri: [80] },
  { marca: 'Shearwater', modello: 'Nerd 2', famiglia: 'shearwater_petrel', numeri: [7] },
  { marca: 'Shearwater', modello: 'Perdix', famiglia: 'shearwater_petrel', numeri: [5] },
  { marca: 'Shearwater', modello: 'Perdix 2', famiglia: 'shearwater_petrel', numeri: [11] },
  { marca: 'Shearwater', modello: 'Perdix AI', famiglia: 'shearwater_petrel', numeri: [6] },
  { marca: 'Shearwater', modello: 'Peregrine', famiglia: 'shearwater_petrel', numeri: [9] },
  { marca: 'Shearwater', modello: 'Peregrine TX', famiglia: 'shearwater_petrel', numeri: [13] },
  { marca: 'Shearwater', modello: 'Petrel 2', famiglia: 'shearwater_petrel', numeri: [3] },
  { marca: 'Shearwater', modello: 'Petrel 3', famiglia: 'shearwater_petrel', numeri: [10] },
  { marca: 'Shearwater', modello: 'Teric', famiglia: 'shearwater_petrel', numeri: [8] },
  { marca: 'Shearwater', modello: 'Tern', famiglia: 'shearwater_petrel', numeri: [12] },
  { marca: 'Shearwater', modello: 'Tern TX', famiglia: 'shearwater_petrel', numeri: [12] },
  { marca: 'Sherwood', modello: 'Beacon', famiglia: 'oceanic_atom2', numeri: [18242] },
  { marca: 'Sherwood', modello: 'Sage', famiglia: 'oceanic_atom2', numeri: [17991] },
  { marca: 'Sherwood', modello: 'Wisdom 4', famiglia: 'oceanic_atom2', numeri: [18005] },
  { marca: 'Suunto', modello: 'D5', famiglia: 'suunto_eonsteel', numeri: [2] },
  { marca: 'Suunto', modello: 'EON Core', famiglia: 'suunto_eonsteel', numeri: [1] },
  { marca: 'Suunto', modello: 'EON Steel', famiglia: 'suunto_eonsteel', numeri: [0] },
  { marca: 'Suunto', modello: 'EON Steel Black', famiglia: 'suunto_eonsteel', numeri: [3] },
];
