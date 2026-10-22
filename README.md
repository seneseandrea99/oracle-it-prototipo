# oracle-it-prototipo

Prototipo **usa e getta** dell'interfaccia di [ORACLE IT](https://github.com/seneseandrea99/oracle_it). Tutti gli eventi e le fonti sono **inventati**; i luoghi sono reali solo per dare un riferimento sulla mappa.

- Mappa: MapLibre GL con tile OpenFreeMap (© OpenStreetMap contributors).
- Avvio locale: `npm install && npm run dev`.
- Pubblicazione: a ogni push su `main` la GitHub Action costruisce il sito e lo pubblica sul branch `gh-pages` (GitHub Pages).

## Varianti
- **Principale: Radar** (`./`, codice in `src/radar/`): echi radar sul globo satellitare con rilievo 3D, palette ambra, vetro satinato, caricamento a tutto schermo.
- Sala operativa (versione precedente): `./varianti/sala-operativa/`
- Telescrivente (team A): `./varianti/telescrivente/`
- Dossier (team C): `./varianti/dossier/`

Dati di terzi usati dal prototipo: immagini Sentinel-2 cloudless di EOX (uso non commerciale), rilievo Mapzen/AWS Open Data, confini regionali ISTAT via openpolis (CC BY 4.0), elenco comuni da opendatasicilia/comuni-italiani (licenza non dichiarata, solo prototipo).
