#!/usr/bin/env python3
"""
L'icona dentro il pacchetto Android costruito è la nostra?

    python3 scripts/icona-nel-pacchetto.py PACCHETTO.aab [PACCHETTO.apk ...]

Per ogni densità confronta, pixel per pixel, le immagini dell'icona che stanno
DENTRO il pacchetto con quelle di `src-tauri/icons/android/`: i due strati
dell'icona adattiva e l'icona di una volta. Esce con 1 se una manca o è
diversa, e se non ha guardato niente.

► PERCHÉ ESISTE: GOOGLE PLAY HA RIFIUTATO LA 1.8.31. ◄ Il 2 ottobre 2026, norma
*Misleading Claims*: «l'icona installata è diversa da quella della scheda».
Dentro l'`.aab` c'era l'icona di fabbrica di Tauri, e c'era in tutti i pacchetti
Android costruiti fino ad allora, APK del sito compreso: il workflow rigenera il
progetto con `tauri android init` e nessun passo ci copiava le nostre. Nessun
comando falliva, il workflow era verde. *Un esito zero dice che il comando non è
morto, non che abbia fatto quello che doveva* — la stessa lezione della firma
che mancava, e la stessa cura: si apre il pacchetto e si guarda.

Pixel e non byte: gradle ricomprime i PNG (in modo esatto, ma i byte cambiano).
I pixel del tutto trasparenti si confrontano senza il colore, che un
compressore è libero di azzerare perché non si vede.

Nell'`.aab` le risorse hanno il loro nome (`base/res/mipmap-xxxhdpi-v4/...`);
nell'APK di rilascio gradle li accorcia (`res/-B.png`), quindi lì si cerca
un'immagine con gli stessi pixel fra quelle della stessa misura.

Visto rosso sui pacchetti della 1.8.31 — tutti e due, ogni densità.
"""

import struct
import sys
import zipfile
import zlib
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
NOSTRE = RADICE / "src-tauri" / "icons" / "android"
DENSITA = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]
# I due strati dell'icona adattiva, e l'icona di una volta.
NOMI = ["ic_launcher_foreground.png", "ic_launcher_background.png", "ic_launcher.png"]


def misura(dati):
    """Larghezza e altezza dall'intestazione, senza decomprimere niente."""
    if dati[:8] != b"\x89PNG\r\n\x1a\n" or dati[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", dati[16:24])


def pixel(dati):
    """Il PNG in RGBA a 8 bit, riga per riga. Solo quello che serve qui."""
    if dati[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("non è un PNG")
    pos, idat, tavolozza, trasparenze = 8, [], None, None
    while pos < len(dati):
        (lunghezza,) = struct.unpack(">I", dati[pos : pos + 4])
        tipo = dati[pos + 4 : pos + 8]
        corpo = dati[pos + 8 : pos + 8 + lunghezza]
        pos += 12 + lunghezza
        if tipo == b"IHDR":
            larghezza, altezza, profondita, colore, _, _, interlacciato = struct.unpack(">IIBBBBB", corpo)
        elif tipo == b"PLTE":
            tavolozza = [tuple(corpo[i : i + 3]) for i in range(0, len(corpo), 3)]
        elif tipo == b"tRNS":
            trasparenze = corpo
        elif tipo == b"IDAT":
            idat.append(corpo)
        elif tipo == b"IEND":
            break
    if interlacciato:
        raise ValueError("PNG interlacciato: non gestito")
    if profondita == 16:
        raise ValueError("PNG a 16 bit: non gestito")
    canali = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colore]
    bit_per_pixel = canali * profondita
    passo = max(1, bit_per_pixel // 8)
    per_riga = (larghezza * bit_per_pixel + 7) // 8
    grezzo = zlib.decompress(b"".join(idat))
    righe, prima = [], bytearray(per_riga)
    for y in range(altezza):
        inizio = y * (per_riga + 1)
        filtro, riga = grezzo[inizio], bytearray(grezzo[inizio + 1 : inizio + 1 + per_riga])
        for x in range(per_riga):
            a = riga[x - passo] if x >= passo else 0
            b = prima[x]
            c = prima[x - passo] if x >= passo else 0
            if filtro == 1:
                riga[x] = (riga[x] + a) & 255
            elif filtro == 2:
                riga[x] = (riga[x] + b) & 255
            elif filtro == 3:
                riga[x] = (riga[x] + (a + b) // 2) & 255
            elif filtro == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                riga[x] = (riga[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        righe.append(riga)
        prima = riga
    uscita = bytearray()
    for riga in righe:
        if profondita < 8:
            valori = []
            for byte in riga:
                for spostamento in range(8 - profondita, -1, -profondita):
                    valori.append((byte >> spostamento) & ((1 << profondita) - 1))
            valori = valori[:larghezza]
        else:
            valori = riga
        for x in range(larghezza):
            if colore == 6:
                r, g, b, a = valori[4 * x : 4 * x + 4]
            elif colore == 2:
                r, g, b = valori[3 * x : 3 * x + 3]
                a = 255
            elif colore == 3:
                indice = valori[x]
                r, g, b = tavolozza[indice]
                a = trasparenze[indice] if trasparenze and indice < len(trasparenze) else 255
            elif colore == 0:
                v = valori[x] * (255 // ((1 << profondita) - 1))
                r = g = b = v
                a = 255
            else:  # 4: grigio e alfa
                r = g = b = valori[2 * x]
                a = valori[2 * x + 1]
            # Il colore di un pixel invisibile non conta: un compressore lo azzera.
            uscita += bytes((r, g, b, a)) if a else b"\0\0\0\0"
    return (larghezza, altezza), bytes(uscita)


def controlla(pacchetto):
    """Restituisce (guardati, guai) per un .aab o un .apk."""
    archivio = zipfile.ZipFile(pacchetto)
    nomi = set(archivio.namelist())
    guai, guardati = [], 0
    bundle = pacchetto.endswith(".aab")
    if bundle and "base/res/mipmap-anydpi-v26/ic_launcher.xml" not in nomi:
        guai.append("manca mipmap-anydpi-v26/ic_launcher.xml: Android non usa l'icona adattiva")
    # Per l'APK: tutte le immagini, divise per misura, decodificate solo se serve.
    per_misura = {}
    if not bundle:
        for nome in nomi:
            if nome.startswith("res/") and nome.endswith(".png") and not nome.endswith(".9.png"):
                m = misura(archivio.read(nome))
                if m:
                    per_misura.setdefault(m, []).append(nome)
    decodificate = {}
    for densita in DENSITA:
        for nome in NOMI:
            nostra = NOSTRE / f"mipmap-{densita}" / nome
            if not nostra.exists():
                guai.append(f"{nostra.relative_to(RADICE)} non c'è nel repository")
                continue
            guardati += 1
            attesa = pixel(nostra.read_bytes())
            if bundle:
                dentro = f"base/res/mipmap-{densita}-v4/{nome}"
                trovata = dentro in nomi and pixel(archivio.read(dentro)) == attesa
                dove = dentro if dentro in nomi else "assente"
            else:
                trovata, dove = False, "nessuna con gli stessi pixel"
                for candidata in per_misura.get(attesa[0], []):
                    if candidata not in decodificate:
                        decodificate[candidata] = pixel(archivio.read(candidata))
                    if decodificate[candidata] == attesa:
                        trovata, dove = True, candidata
                        break
            segno = "✓" if trovata else "✗"
            print(f"  {segno} mipmap-{densita}/{nome} {attesa[0][0]}×{attesa[0][1]} → {dove}")
            if not trovata:
                guai.append(f"mipmap-{densita}/{nome}: nel pacchetto non c'è la nostra ({dove})")
    return guardati, guai


def main(pacchetti):
    if not pacchetti:
        print("::error::nessun pacchetto da guardare: il controllo non ha guardato niente")
        return 1
    tutti = []
    for pacchetto in pacchetti:
        print(pacchetto)
        guardati, guai = controlla(pacchetto)
        if guardati == 0:
            guai.append("nessuna icona confrontata: il controllo non ha guardato niente")
        tutti += [f"{Path(pacchetto).name}: {g}" for g in guai]
    if tutti:
        print("\n".join("::error::" + g for g in tutti))
        return 1
    print(f"icona nostra: {len(pacchetti)} pacchetti, ogni densità, pixel per pixel.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
