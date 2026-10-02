#!/usr/bin/env python3
"""
Le librerie native del pacchetto Android reggono le pagine da 16 KB?

    python3 scripts/pagine-16k.py PACCHETTO.aab [PACCHETTO.apk ...]

Per ogni `.so` dentro il pacchetto, due cose:

  - ogni segmento `PT_LOAD` deve avere `p_align` di almeno 16384: è
    l'allineamento con cui il linker ha scritto la libreria, e un telefono con
    pagine da 16 KB la mappa a pezzi di 16 KB;
  - nell'APK, una libreria salvata SENZA compressione deve cominciare, dentro
    lo zip, a un multiplo di 16384: Android la mappa direttamente da lì.

Esce con 1 al primo guaio, e se non ha guardato nessuna libreria.

► PERCHÉ ESISTE: GOOGLE PLAY HA FERMATO LA 1.8.32. ◄ Il 2 ottobre 2026, poche
ore dopo il rifiuto per l'icona: *«Your app does not support 16 KB memory page
sizes»*. Misurato qui: `libmydivelog_lib.so`, l'unica libreria nativa, aveva i
quattro segmenti allineati a 4 KB (0x1000), nell'`.aab` e nell'APK; lo zip
dell'APK invece era già allineato (gradle lo fa da sé). La cura sta in
`src-tauri/build.rs` (`pagine_da_16_kb`). Visto rosso sui pacchetti della
1.8.32.

*La seconda volta nello stesso giorno che Play guarda dentro il pacchetto una
cosa che noi non guardavamo.* Adesso la guardiamo prima noi.
"""

import struct
import sys
import zipfile
from pathlib import Path

PAGINA = 16384


def allineamenti(dati):
    """Il p_align di ogni segmento PT_LOAD di un ELF, a 32 o a 64 bit."""
    if dati[:4] != b"\x7fELF":
        raise ValueError("non è un ELF")
    classe, ordine = dati[4], dati[5]
    e = "<" if ordine == 1 else ">"
    if classe == 2:  # 64 bit
        phoff = struct.unpack_from(e + "Q", dati, 0x20)[0]
        phentsize, phnum = struct.unpack_from(e + "HH", dati, 0x36)
        formato, campo_align, campo_tipo = e + "IIQQQQQQ", 7, 0
    else:  # 32 bit
        phoff = struct.unpack_from(e + "I", dati, 0x1C)[0]
        phentsize, phnum = struct.unpack_from(e + "HH", dati, 0x2A)
        formato, campo_align, campo_tipo = e + "IIIIIIII", 7, 0
    segmenti = []
    for i in range(phnum):
        voce = struct.unpack_from(formato, dati, phoff + i * phentsize)
        if voce[campo_tipo] == 1:  # PT_LOAD
            segmenti.append(voce[campo_align])
    return segmenti


def inizio_dati(archivio, info):
    """Dove cominciano, dentro lo zip, i byte di una voce."""
    archivio.fp.seek(info.header_offset)
    intestazione = archivio.fp.read(30)
    lunghezza_nome, lunghezza_extra = struct.unpack_from("<HH", intestazione, 26)
    return info.header_offset + 30 + lunghezza_nome + lunghezza_extra


def controlla(pacchetto):
    archivio = zipfile.ZipFile(pacchetto)
    guai, guardate = [], 0
    for info in archivio.infolist():
        if not info.filename.endswith(".so"):
            continue
        guardate += 1
        segmenti = allineamenti(archivio.read(info.filename))
        if not segmenti:
            guai.append(f"{info.filename}: nessun segmento PT_LOAD")
        piccoli = [hex(a) for a in segmenti if a < PAGINA]
        compressa = info.compress_type != zipfile.ZIP_STORED
        posto = None if compressa else inizio_dati(archivio, info) % PAGINA
        stato = "✓" if not piccoli and not posto else "✗"
        print(
            f"  {stato} {info.filename}: PT_LOAD p_align {[hex(a) for a in segmenti]}"
            + (", compressa" if compressa else f", nello zip a +{posto} da un multiplo di 16 KB")
        )
        if piccoli:
            guai.append(f"{info.filename}: segmenti allineati a {', '.join(piccoli)}, non a 16 KB")
        if posto and pacchetto.endswith(".apk"):
            guai.append(f"{info.filename}: salvata senza compressione fuori da un multiplo di 16 KB nello zip")
    return guardate, guai


def main(pacchetti):
    if not pacchetti:
        print("::error::nessun pacchetto da guardare: il controllo non ha guardato niente")
        return 1
    tutti = []
    for pacchetto in pacchetti:
        print(pacchetto)
        guardate, guai = controlla(pacchetto)
        if guardate == 0:
            guai.append("nessuna libreria .so: il controllo non ha guardato niente")
        tutti += [f"{Path(pacchetto).name}: {g}" for g in guai]
    if tutti:
        print("\n".join("::error::" + g for g in tutti))
        return 1
    print(f"pagine da 16 KB: {len(pacchetti)} pacchetti, ogni libreria nativa a posto.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
