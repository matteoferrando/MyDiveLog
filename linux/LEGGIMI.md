# MyDiveLog su Arch, Manjaro e derivate

Il progetto pubblica per Linux **un solo pacchetto**, il `.deb` per amd64. Arch e
le sue derivate — Manjaro, EndeavourOS, Garuda — non hanno `dpkg`, e un `.deb`
non si installa. Ma dentro un `.deb` c'è solo un tar con l'albero di `/usr`, e
`makepkg` sa travasarlo in un pacchetto di `pacman`: installabile e
disinstallabile come tutti gli altri, **senza ricompilare niente**. Il binario è
lo stesso che scarica chi usa Debian.

```
sudo pacman -S --needed base-devel
mkdir ~/mydivelog && cd ~/mydivelog
curl -LO https://raw.githubusercontent.com/matteoferrando/MyDiveLog/main/linux/PKGBUILD
makepkg -si
```

`makepkg` scarica il `.deb` della versione scritta nel file, **si ferma se
l'impronta non è quella dichiarata**, tira `webkit2gtk-4.1` e `gtk3` e installa.
Si toglie con `sudo pacman -R mydivelog-bin`.

Per lo scarico via Bluetooth serve BlueZ acceso:

```
sudo pacman -S --needed bluez bluez-utils
sudo systemctl enable --now bluetooth
```

## Il file è generato, come la cask

`PKGBUILD` lo scrive `npm run cask` — lo stesso comando che scrive la cask di
Homebrew — e per la stessa ragione: **un file che dichiara una versione e
un'impronta non si scrive a mano**, perché prima o poi si alza la versione e
resta l'impronta di quella prima, e se ne accorge chi installa. L'impronta viene
dall'API di GitHub, cioè dal file che GitHub serve davvero; con `--deb <file>` si
pretende che combaci anche con quello costruito in locale.

`tests/pkgbuild.test.ts` difende quello che si può difendere senza rete.

## Su Linux non si aggiorna da sola

L'aggiornatore di Tauri funziona con l'AppImage, non col `.deb`, ed è spento alla
compilazione (vedi `altre-piattaforme.yml`). A ogni versione nuova: rigenerare il
`PKGBUILD` — o riscaricarlo da qui — e rilanciare `makepkg -si`.

## Provato

**3 settembre 2026, Manjaro, dal proprietario**: si installa, si apre, importa,
e lo scarico Bluetooth funziona. È la prima volta che MyDiveLog gira su Linux
con un computer subacqueo davanti — fino a quel giorno il Bluetooth su Linux era
scritto fra i limiti noti come «mai provato». *Il PKGBUILD è stato scritto a
mano quella mattina e ha funzionato al primo colpo; il giorno stesso è passato
nel generatore.*

## Il passo dopo: l'AUR

Questo file è già un pacchetto AUR completo. Pubblicarlo lì vorrebbe dire che su
Arch e Manjaro MyDiveLog si installa con `yay -S mydivelog-bin`, e che gli
aggiornamenti arrivano dal gestore dei pacchetti come per tutto il resto — senza
nemmeno un workflow da tenere in vita, al contrario del tap di Homebrew. Non è
stato ancora fatto.
