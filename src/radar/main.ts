// ORACLE IT · variante "Radar": il radar meteo delle mobilitazioni.
// Tutti i dati sono di prova (src/data.ts, is_test = true).
import "./style.css";
import { EVENTI, ORA, type Evento, type Tipo, type FonteTipo } from "../data";

declare const maplibregl: any;

// ---------- tempi del movimento (gli stessi valori sono in style.css come --t-*) ----------
const MOTO = {
  press: 120,      // risposta a tocco e passaggio
  lock: 200,       // angoli dell'aggancio e impulso
  decode: 650,     // testo che si decodifica, da sinistra a destra
  decodeChar: 70,  // finestra di disordine per carattere (3-4 fotogrammi)
  stato: 800,      // righe di stato del caricamento
  sheet: 280,      // pannelli e scheda
  fly: 800,        // volo della camera
  reveal: 560,     // comparsa degli echi a dati pronti
  passo: 200,      // un fotogramma dell'animazione nel tempo
};

// ---------- vocabolario ----------
const TIPI: Record<Tipo, { label: string; plur: string; forma: "quadrato" | "rombo" | "triangolo" | "cerchio"; gravita: number }> = {
  blocco: { label: "Blocco", plur: "Blocchi", forma: "quadrato", gravita: 1 },
  sciopero: { label: "Sciopero", plur: "Scioperi", forma: "rombo", gravita: 0.75 },
  corteo: { label: "Corteo", plur: "Cortei", forma: "triangolo", gravita: 0.7 },
  presidio: { label: "Presidio", plur: "Presìdi", forma: "cerchio", gravita: 0.55 },
};
const ORDINE_TIPI: Tipo[] = ["blocco", "sciopero", "corteo", "presidio"];
const STATI = { in_corso: "In corso", annunciato: "Annunciato", concluso: "Concluso" } as const;
const FONTE: Record<FonteTipo, string> = { ufficiale: "Ente ufficiale", agenzia: "Agenzia di stampa", testata: "Testata", parte: "Organizzazione promotrice" };
const PESO: Record<FonteTipo, number> = { ufficiale: 1, agenzia: 0.6, testata: 0.5, parte: 0.3 };
const SOGLIA = 0.8, SCALA = 1.2;
const ITALIA: [[number, number], [number, number]] = [[6.6, 36.4], [18.6, 47.1]];
const SUD = ["Calabria", "Sicilia", "Puglia", "Campania", "Basilicata"];
const H = 36e5;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const giorno = (d: string | number) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const ora = (d: string | number) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dataOra = (d: string | number) => `${giorno(d)} ${ora(d)}`;
const settimana = (d: number) => new Date(d).toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "");
const titolo = (e: Evento) => `${TIPI[e.tipo].label} a ${e.comune}`;
const desktop = () => matchMedia("(min-width: 1000px)").matches;
const calmo = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function fa(d: string) {
  const m = Math.round((+ORA - +new Date(d)) / 60000);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h fa` : `${Math.round(h / 24)} g fa`;
}

// ---------- credibilità e intensità dell'eco ----------
function pacchetti(e: Evento) {
  const r = e.fonti.map((f) => ({ nome: f.nome, tipo: FONTE[f.tipo] + (f.smentisce ? ", smentisce" : ""), quando: dataOra(f.pubblicata),
    w: f.smentisce ? -0.6 : f.tipo === "parte" && f.annuncio ? 0.6 : PESO[f.tipo] }));
  if (e.segnalatori) {
    let u = 0;
    for (let i = 0; i < e.segnalatori; i++) u += 0.1 * Math.pow(0.85, i);
    r.push({ nome: `${e.segnalatori} segnalatori diversi`, tipo: "Segnalazioni utenti, peso decrescente", quando: ora(e.aggiornato), w: Math.min(0.6, +u.toFixed(2)) });
  }
  return r;
}
const totale = (e: Evento) => pacchetti(e).reduce((a, x) => a + x.w, 0);
function conferma(e: Evento) { return e.contraddittorio ? 0.35 : Math.max(0.3, Math.min(1, totale(e))); }
function intensita(e: Evento) { return +(TIPI[e.tipo].gravita * conferma(e)).toFixed(2); }
function banda(v: number) { return v <= 0 ? { k: 0, label: "assente" } : v >= 0.7 ? { k: 3, label: "forte" } : v >= 0.45 ? { k: 2, label: "moderata" } : { k: 1, label: "debole" }; }
function credibilita(e: Evento) {
  if (e.contraddittorio) return { label: "Fonti discordanti", cls: "warn" };
  if (!e.fonti.length) return { label: `${e.segnalatori} segnalazioni, nessuna fonte`, cls: "user" };
  if (e.fonti.some((f) => f.tipo === "ufficiale")) return { label: "Comunicato ufficiale", cls: "cred" };
  const n = e.fonti.filter((f) => !f.smentisce).length;
  return { label: n === 1 ? "1 fonte" : `${n} fonti indipendenti`, cls: "cred" };
}
function variante(e: Evento) {
  if (e.stato === "concluso") return "concluso";
  if (e.contraddittorio) return "discorde";
  if (!e.fonti.length) return "utenti";
  return e.stato === "annunciato" ? "vuoto" : "pieno";
}

// ---------- tempo: 24 fotogrammi orari osservati, poi 32 da 6 ore di previsione ----------
// Ogni fotogramma è un intervallo: l'ora che finisce a t (osservato) o le 6 ore che iniziano a t (previsione).
interface Foto { a: number; b: number; prev: boolean }
const FOTO: Foto[] = [];
for (let i = 0; i <= 24; i++) { const b = +ORA - (24 - i) * H; FOTO.push({ a: b - H, b, prev: false }); }
for (let k = 1; k <= 32; k++) FOTO.push({ a: +ORA + (k - 1) * 6 * H, b: +ORA + k * 6 * H, prev: true });
const I_ORA = 24, N = FOTO.length;
function finestra(e: Evento) {
  const a = +new Date(e.inizio);
  if (e.fine) return { a, b: +new Date(e.fine), aperta: false };
  if (e.stato === "in_corso") return { a, b: +ORA + 24 * H, aperta: true };
  return { a, b: a + 3 * H, aperta: false };
}
function peso(e: Evento, f: Foto) {
  const w = finestra(e);
  if (w.b <= f.a || w.a > f.b) return 0;
  const mezzo = (f.a + f.b) / 2, decad = w.aperta && mezzo > +ORA ? Math.max(0, 1 - (mezzo - +ORA) / (24 * H)) : 1;
  return +(intensita(e) * decad).toFixed(3);
}
const etichettaFoto = (f: Foto) => f.prev ? `${settimana(f.a)} ${giorno(f.a)} ${ora(f.a)}–${ora(f.b)}` : `${settimana(f.b)} ${dataOra(f.b)}`;

// ---------- stato ----------
const st = { regione: null as string | null, tipi: new Set<Tipo>(ORDINE_TIPI), i: I_ORA, sel: null as string | null, play: false, vista: "elenco" as "elenco" | "metodo" | "segnala" };
const filtrati = () => EVENTI.filter((e) => st.tipi.has(e.tipo) && (!st.regione || e.regione === st.regione));
const foto = () => FOTO[st.i];
const futuro = () => FOTO[st.i].prev;
const attivi = (f: Foto) => filtrati().filter((e) => peso(e, f) > 0).sort((a, b) => peso(b, f) - peso(a, f));

// ---------- testo che si decodifica: da sinistra a destra, breve disordine per carattere ----------
const SEGNI = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>#·";
const inCorso = new WeakMap<Element, number>();
function decodifica(el: Element, testo: string, durata = MOTO.decode) {
  inCorso.set(el, (inCorso.get(el) || 0) + 1);
  const io = inCorso.get(el);
  if (calmo()) { el.textContent = testo; return; }
  const n = testo.length, fin = MOTO.decodeChar, passo = Math.max(8, (durata - fin) / Math.max(1, n)), t0 = performance.now();
  let fot = 0;
  const giro = (t: number) => {
    if (inCorso.get(el) !== io) return;
    const dt = t - t0; fot++;
    let fatto = "", mischia = "", k = 0;
    for (; k < n; k++) {
      const da = k * passo;
      if (dt >= da + fin || testo[k] === " ") fatto += testo[k];
      else if (dt >= da) { const c = SEGNI[(k * 7 + (fot >> 1) * 13 + ((fot >> 1) * k) % 11) % SEGNI.length]; mischia += testo[k] === testo[k].toLowerCase() ? c.toLowerCase() : c; }
      else break;
    }
    // la parte non ancora rivelata resta nel flusso, invisibile: la riga non cambia larghezza
    el.innerHTML = `${esc(fatto)}<span class="scr">${esc(mischia)}</span><span class="rest">${esc(testo.slice(fatto.length + mischia.length))}</span>`;
    if (dt < durata + fin) requestAnimationFrame(giro); else el.textContent = testo;
  };
  requestAnimationFrame(giro);
}

// ---------- radar come indicatore di caricamento ----------
function radar(size: number, cls = "") {
  return `<span class="spin ${cls}" style="--s:${size}px" aria-hidden="true"><svg viewBox="-26 -26 52 52">
    <circle class="ring" r="24"/><circle class="ring" r="16"/><circle class="ring" r="8"/>
    <g class="beam"><path class="wedge" d="M0 0L0-24A24 24 0 0 1 16.97-16.97Z"/><line x1="0" y1="0" x2="0" y2="-24"/></g>
    <circle class="blip b1" cx="11" cy="-14" r="2"/><circle class="blip b2" cx="-15" cy="6" r="1.6"/><circle class="blip b3" cx="5" cy="19" r="1.6"/>
  </svg></span>`;
}
let occupati = 0;
function occupato(on: boolean) { occupati = Math.max(0, occupati + (on ? 1 : -1)); document.body.classList.toggle("busy", occupati > 0); }

// ---------- simboli: forma per tipo, pieno/vuoto per stato ----------
function forma(f: string, s = 7) {
  return f === "quadrato" ? `<rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}"/>` : f === "rombo" ? `<polygon points="0,${-s - 1.5} ${s + 1.5},0 0,${s + 1.5} ${-s - 1.5},0"/>`
    : f === "triangolo" ? `<polygon points="0,${-s - 1} ${s + .8},${s - .4} ${-s - .8},${s - .4}"/>` : `<circle r="${s}"/>`;
}
function simbolo(tipo: Tipo, v: string, size = 16) {
  const col = v === "concluso" ? "var(--concluso)" : "currentColor";
  const fill = v === "pieno" || v === "concluso" ? col : "none";
  return `<svg class="sym" viewBox="-10 -10 20 20" width="${size}" height="${size}" aria-hidden="true">
    ${v === "discorde" ? `<defs><clipPath id="mezzo"><rect x="-10" y="-10" width="10" height="20"/></clipPath></defs><g clip-path="url(#mezzo)" fill="${col}">${forma(TIPI[tipo].forma)}</g>` : ""}
    <g fill="${fill}" stroke="${col}" stroke-width="2" ${v === "utenti" ? 'stroke-dasharray="2.6 2"' : ""}>${forma(TIPI[tipo].forma)}</g></svg>`;
}
function tracciato(ctx: CanvasRenderingContext2D, f: string, c: number, r: number) {
  ctx.beginPath();
  if (f === "quadrato") ctx.rect(c - r * 0.8, c - r * 0.8, r * 1.6, r * 1.6);
  else if (f === "rombo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r, c); ctx.lineTo(c, c + r); ctx.lineTo(c - r, c); ctx.closePath(); }
  else if (f === "triangolo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r * 0.95, c + r * 0.72); ctx.lineTo(c - r * 0.95, c + r * 0.72); ctx.closePath(); }
  else ctx.arc(c, c, r * 0.84, 0, Math.PI * 2);
}
function icona(tipo: Tipo, v: string, px = 56) {
  const cv = document.createElement("canvas"); cv.width = cv.height = px;
  const ctx = cv.getContext("2d")!, c = px / 2, r = px * 0.25, ink = v === "concluso" ? "#9a8f7e" : "#fbf4e8";
  tracciato(ctx, TIPI[tipo].forma, c, r); ctx.lineWidth = px * 0.16; ctx.strokeStyle = "rgba(8,6,3,.75)"; ctx.lineJoin = "round"; ctx.stroke();
  tracciato(ctx, TIPI[tipo].forma, c, r); ctx.fillStyle = "rgba(8,6,3,.7)"; ctx.fill();
  if (v === "pieno" || v === "concluso") { ctx.fillStyle = ink; ctx.fill(); }
  if (v === "discorde") { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, c, px); ctx.clip(); tracciato(ctx, TIPI[tipo].forma, c, r); ctx.fillStyle = ink; ctx.fill(); ctx.restore(); }
  tracciato(ctx, TIPI[tipo].forma, c, r); ctx.lineWidth = px * 0.06; ctx.strokeStyle = ink;
  if (v === "utenti") ctx.setLineDash([px * 0.07, px * 0.05]);
  ctx.stroke();
  return ctx.getImageData(0, 0, px, px);
}
function cerchio([lng, lat]: [number, number], km: number) {
  const p: [number, number][] = [];
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; p.push([lng + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 110.57) * Math.sin(a)]); }
  return p;
}

// ---------- caricamento iniziale ----------
const loader = $("#loader"), loaderTxt = $("#loader-txt");
$("#hud-mark").innerHTML = radar(20, "brand");
(() => {
  const fonti = EVENTI.reduce((a, e) => a + e.fonti.length, 0);
  const righe = calmo() ? ["Caricamento…"] : [`ACQUISIZIONE ${fonti} FONTI · ${EVENTI.length} EVENTI`, "IMMAGINI SATELLITARI", `SOGLIA DI PUBBLICAZIONE ${SOGLIA.toFixed(2)}`];
  loaderTxt.innerHTML = righe.map(() => `<span></span>`).join("");
  const spans = loaderTxt.querySelectorAll("span");
  righe.forEach((r, k) => setTimeout(() => decodifica(spans[k], r, MOTO.stato), k * 260));
})();
occupato(true);

// ---------- mappa: globo satellitare notturno ----------
const TERRENO = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const SATELLITE = {
  eox: { tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"], maxzoom: 15,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX IT Services GmbH</a> (dati Copernicus Sentinel 2020)' },
  esri: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], maxzoom: 18,
    attribution: "Immagini: Esri, Maxar, Earthstar Geographics" },
};
const padMappa = () => desktop() ? { top: 90, bottom: 110, left: 430, right: (document.getElementById("detail") as HTMLElement).hidden ? 40 : 440 } : { top: 130, bottom: 240, left: 14, right: 14 };
const CENTRO_RADAR: [number, number] = [12.9, 41.7];
function erroreMappa(msg: string) {
  const box = $("#maperr");
  box.hidden = false;
  box.innerHTML = `<p><b>La mappa non si è caricata.</b> ${msg} L'elenco degli eventi resta utilizzabile.</p><button class="btn" id="riprova">Riprova</button>`;
  box.querySelector("#riprova")!.addEventListener("click", () => location.reload());
  fermaRadar(); occupati = 1; occupato(false);
}
// se la libreria della mappa non arriva, l'app resta usabile come elenco
const senzaMappa = typeof maplibregl === "undefined";
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === "project" ? () => ({ x: -999, y: -999 }) : noop), apply: () => noop });
const map: any = senzaMappa ? noop : new maplibregl.Map({
  container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a0805" } }] },
  bounds: ITALIA, fitBoundsOptions: { padding: padMappa() }, minZoom: 1.6, maxZoom: 17.5, maxPitch: 60,
  attributionControl: { compact: true }, dragRotate: false,
});
if (senzaMappa) setTimeout(() => erroreMappa("Controlla la connessione."), 0);
else {
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
}

function satellite(style: any) {
  const strade = ["match", ["get", "class"], ["motorway"], "rgba(255,236,200,.38)", ["trunk", "primary"], "rgba(255,236,200,.22)", "rgba(255,236,200,.1)"];
  const tenute = style.layers.filter((l: any) => {
    const id = String(l.id), sl = String(l["source-layer"] || "");
    if (l.type === "line" && sl === "transportation") { l.paint = { ...(l.paint || {}), "line-color": strade }; delete l.paint["line-gradient"]; delete l.paint["line-dasharray"]; return !/casing|tunnel|rail|path|ferry/.test(id); }
    if (l.type === "line" && sl === "boundary") { l.paint = { ...(l.paint || {}), "line-color": "rgba(255,236,200,.4)" }; return true; }
    if (l.type === "symbol" && /place|city|town|capital|state|country/.test(id)) {
      l.paint = { ...(l.paint || {}), "text-color": "#efe4d0", "text-halo-color": "rgba(6,4,2,.9)", "text-halo-width": 1.4, "icon-opacity": 0 };
      return true;
    }
    return false;
  });
  style.sources.satellite = { type: "raster", tileSize: 256, ...SATELLITE.eox };
  // rilievo: due sorgenti dagli stessi dati aperti (consigliato da MapLibre: una per l'ombreggiatura, una per il 3D)
  const dem = { type: "raster-dem", tiles: [TERRENO], tileSize: 256, maxzoom: 15, encoding: "terrarium", attribution: "Terrain: Mapzen / AWS Open Data, SRTM, GMTED" };
  style.sources["dem-ombre"] = { ...dem };
  const { attribution: _a, ...demSenzaCrediti } = dem; void _a;
  style.sources["dem-rilievo"] = demSenzaCrediti;
  style.layers = [
    { id: "spazio", type: "background", paint: { "background-color": "#0a0805" } },
    { id: "satellite", type: "raster", source: "satellite", paint: { "raster-brightness-max": 0.84, "raster-brightness-min": 0.07, "raster-saturation": -0.26, "raster-contrast": 0.04, "raster-fade-duration": 200 } },
    // luce radente da nord-ovest: ombre profonde ma trasparenti, luci appena ambrate
    { id: "rilievo", type: "hillshade", source: "dem-ombre", paint: {
      "hillshade-illumination-direction": 315, "hillshade-illumination-anchor": "map",
      "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 4, 0.65, 9, 0.5, 13, 0.35],
      "hillshade-shadow-color": "rgba(10,6,2,0.26)", "hillshade-highlight-color": "rgba(255,226,170,0.3)", "hillshade-accent-color": "rgba(40,26,8,0.22)",
    } },
    ...tenute,
  ];
  // il 3D si accende da zoom 7 (vedi rilievo3D): a bassa quota sul globo non serve e MapLibre 5.24 lo segnala
  style.projection = { type: "globe" };
  style.sky = { "sky-color": "#0c0804", "horizon-color": "#3a2810", "fog-color": "#2e2619", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.4, "fog-ground-blend": 0.12,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0] };
  return style;
}
let erroriSat = 0;
if (!senzaMappa) {
  map.on("error", (e: any) => {
    if (e?.sourceId === "satellite" && ++erroriSat === 4) map.getSource("satellite")?.setTiles?.(SATELLITE.esri.tiles);
    else console.warn("mappa:", e?.error?.message);
  });
  (async () => {
    try {
      const r = await fetch("https://tiles.openfreemap.org/styles/liberty");
      if (!r.ok) throw new Error(String(r.status));
      map.setStyle(satellite(await r.json()), { diff: false });
    } catch {
      map.setStyle(satellite({ version: 8, sources: {}, layers: [] }), { diff: false });
    }
  })();
}
const regioniPronte = fetch("regioni.json").then((r) => r.json()).catch(() => null);

// ---------- reticolo di meridiani e paralleli: 1° sull'Italia, 10° sul globo ----------
function reticolo() {
  const f: any[] = [], linea = (c: [number, number][], passo: number) => f.push({ type: "Feature", properties: { passo }, geometry: { type: "LineString", coordinates: c } });
  for (let lon = 2; lon <= 24; lon++) { const c: [number, number][] = []; for (let lat = 33; lat <= 50; lat += 0.5) c.push([lon, lat]); linea(c, 1); }
  for (let lat = 33; lat <= 50; lat++) { const c: [number, number][] = []; for (let lon = 2; lon <= 24; lon += 0.5) c.push([lon, lat]); linea(c, 1); }
  for (let lon = -180; lon < 180; lon += 10) { const c: [number, number][] = []; for (let lat = -80; lat <= 80; lat += 2) c.push([lon, lat]); linea(c, 10); }
  for (let lat = -80; lat <= 80; lat += 10) { const c: [number, number][] = []; for (let lon = -180; lon <= 180; lon += 2) c.push([lon, lat]); linea(c, 10); }
  return { type: "FeatureCollection", features: f };
}
// etichette dei gradi lungo i bordi: in basso i meridiani, a destra i paralleli; mai sopra i dati
let gradiRaf = 0;
function etichetteGradi() {
  if (gradiRaf) return;
  gradiRaf = requestAnimationFrame(() => {
    gradiRaf = 0;
    const el = $("#gradi"), box = $("#mapbox"), w = box.clientWidth, h = box.clientHeight;
    if (senzaMappa || !pronta) { el.innerHTML = ""; return; }
    const z = map.getZoom(), passo = z >= 5 ? 1 : 10;
    const basso = desktop() ? h - 104 : h - 244, sinistra = desktop() ? 420 : 40, destra = w - (desktop() && !(document.getElementById("detail") as HTMLElement).hidden ? 430 : 8);
    let html = "";
    try {
      const sx = map.unproject([0, basso]), dx = map.unproject([w, basso]);
      const usati: number[] = [];
      for (let lon = Math.ceil(Math.min(sx.lng, dx.lng) / passo) * passo; lon <= Math.max(sx.lng, dx.lng); lon += passo) {
        const lat = map.unproject([w / 2, basso]).lat, p = map.project([lon, lat]);
        if (p.x < sinistra || p.x > destra - 50 || usati.some((u) => Math.abs(u - p.x) < 44)) continue;
        usati.push(p.x); html += `<span class="g-lon" style="left:${p.x}px;top:${basso}px">${Math.abs(lon)}°${lon >= 0 ? "E" : "O"}</span>`;
      }
      const su = map.unproject([destra, 120]), giu = map.unproject([destra, basso - 20]);
      const usatiY: number[] = [];
      for (let lat = Math.ceil(Math.min(su.lat, giu.lat) / passo) * passo; lat <= Math.max(su.lat, giu.lat); lat += passo) {
        const p = map.project([map.unproject([destra, (120 + basso) / 2]).lng, lat]);
        if (p.y < 120 || p.y > basso - 24 || usatiY.some((u) => Math.abs(u - p.y) < 28)) continue;
        usatiY.push(p.y); html += `<span class="g-lat" style="top:${p.y}px;right:${w - destra}px">${Math.abs(lat)}°${lat >= 0 ? "N" : "S"}</span>`;
      }
    } catch { /* fuori dal globo */ }
    el.innerHTML = html;
  });
}
map.on("move", etichetteGradi);

// rilievo in 3D solo da vicino: sul globo intero il terreno non si vede e MapLibre 5.24 avvisa (calculateFogMatrix)
let terreno3D = false;
function rilievo3D() {
  if (senzaMappa || !map.getSource?.("dem-rilievo")) return;
  const vuole = map.getZoom() >= 7;
  if (vuole === terreno3D) return;
  terreno3D = vuole;
  try { map.setTerrain(vuole ? { source: "dem-rilievo", exaggeration: 1.4 } : null); } catch { terreno3D = false; }
}
map.on("zoomend", rilievo3D); map.on("moveend", rilievo3D);

// ---------- echi che respirano: solo gli eventi in corso, 3,6 s, appena percettibile ----------
let respiro = 1;
setInterval(() => {
  if (calmo() || st.play || document.hidden || !pronta || !map.getLayer?.("eco") || !EVENTI.every((e) => riv[e.id] >= 1)) return;
  respiro = 1 + 0.14 * Math.sin((performance.now() / 3600) * Math.PI * 2);
  map.setPaintProperty("eco", "heatmap-weight", pesoEco(st.i));
}, 90);
function pesoEco(i: number): any { return ["*", ["get", `w${i}`], R(), ["case", ["==", ["get", "vivo"], 1], respiro, 1]]; }

// ---------- strati: eco a bassa quota, anelli netti da vicino ----------
// Ogni punto porta i valori di tutti i fotogrammi (w0…, b0…, o0…): cambiare fotogramma cambia solo la pittura, senza ricaricare i dati.
// rivelazione per evento (0…1): il fascio scopre ogni eco quando lo attraversa
const riv: Record<string, number> = {};
for (const e of EVENTI) riv[e.id] = calmo() ? 1 : 0;
const impulso: Record<string, number> = {};
function R(scala = 1): any {
  const v = EVENTI.map((e) => Math.min(1, riv[e.id] * scala));
  if (v.every((x) => x === v[0])) return v[0];
  return ["match", ["get", "id"], ...EVENTI.flatMap((e, k) => [e.id, v[k]]), 0];
}
function punti() {
  const ev = filtrati();
  return {
    type: "FeatureCollection", features: ev.map((e) => {
      const p: Record<string, any> = { id: e.id, icon: `${e.tipo}-${variante(e)}`, nome: e.comune, sel: st.sel === e.id ? 1 : 0, vivo: e.stato === "in_corso" ? 1 : 0 };
      FOTO.forEach((f, i) => {
        const w = peso(e, f);
        p[`w${i}`] = w; p[`b${i}`] = banda(w).k;
        p[`o${i}`] = w > 0 || st.sel === e.id || (i === I_ORA && e.stato === "annunciato" && +new Date(e.inizio) - +ORA < 3 * 864e5) ? 1 : 0;
      });
      return { type: "Feature", geometry: { type: "Point", coordinates: e.lngLat }, properties: p };
    }),
  };
}
function contorni() {
  const ev = filtrati(), pr = (e: Evento) => { const p: Record<string, number> = { sel: st.sel === e.id ? 1 : 0 }; FOTO.forEach((f, i) => (p[`w${i}`] = peso(e, f))); return p; };
  return {
    aree: { type: "FeatureCollection", features: ev.filter((e) => e.precisione === "comune").map((e) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [cerchio(e.lngLat, 3)] }, properties: pr(e) })) },
    tratti: { type: "FeatureCollection", features: ev.filter((e) => e.tratto).map((e) => ({ type: "Feature", geometry: { type: "LineString", coordinates: e.tratto }, properties: pr(e) })) },
  };
}
const RAMPA = {
  oss: ["rgba(120,70,14,0.40)", "rgba(176,108,26,0.58)", "rgba(255,180,60,0.76)", "rgba(255,216,143,0.9)", "rgba(255,246,222,0.96)"],
  prev: ["rgba(60,78,100,0.40)", "rgba(92,118,150,0.56)", "rgba(140,168,200,0.72)", "rgba(196,214,234,0.86)", "rgba(240,246,252,0.94)"],
};
const ANELLI = { oss: ["#b06c1a", "#ffb43c", "#ffd88f"], prev: ["#5c7696", "#8ca8c8", "#c4d6ea"] };
const rampa = (k: "oss" | "prev") => ["step", ["heatmap-density"], "rgba(0,0,0,0)", 0.05, RAMPA[k][0], 0.2, RAMPA[k][1], 0.42, RAMPA[k][2], 0.66, RAMPA[k][3], 0.88, RAMPA[k][4]];
const visibile = (i: number) => ["any", ["==", ["get", "sel"], 1], [">", ["get", `w${i}`], 0]];

let pronta = false;
map.on("style.load", async () => {
  // il primo stile è solo lo sfondo provvisorio: si aspetta quello con le immagini satellitari
  if (!map.getSource("satellite") || map.getSource("punti")) return;
  for (const t of ORDINE_TIPI) for (const v of ["pieno", "vuoto", "utenti", "concluso", "discorde"]) if (!map.hasImage(`${t}-${v}`)) map.addImage(`${t}-${v}`, icona(t, v), { pixelRatio: 2 });
  const c = contorni();
  map.addSource("punti", { type: "geojson", data: punti() });
  map.addSource("aree", { type: "geojson", data: c.aree }); map.addSource("tratti", { type: "geojson", data: c.tratti });
  map.addSource("reticolo", { type: "geojson", data: reticolo() });
  map.addLayer({ id: "reticolo-fine", type: "line", source: "reticolo", minzoom: 4.2, filter: ["==", ["get", "passo"], 1],
    paint: { "line-color": "rgba(255,226,170,0.09)", "line-width": 0.6, "line-opacity": ["interpolate", ["linear"], ["zoom"], 4.2, 0, 5, 1, 10, 1, 12, 0.4] } });
  map.addLayer({ id: "reticolo-ampio", type: "line", source: "reticolo", maxzoom: 5, filter: ["==", ["get", "passo"], 10],
    paint: { "line-color": "rgba(255,226,170,0.1)", "line-width": 0.6, "line-opacity": ["interpolate", ["linear"], ["zoom"], 4.2, 1, 5, 0] } });
  map.addLayer({ id: "eco", type: "heatmap", source: "punti", maxzoom: 10, paint: {
    "heatmap-weight": 0,
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 2.2, 6, 3, 9, 2],
    // dimensione in pixel limitata: oltre lo zoom 7 l'eco non cresce più e sfuma
    "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 2, 11, 5, 36, 7, 64, 10, 64],
    "heatmap-color": rampa("oss"),
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 6.5, 1, 8.5, 0],
  } });
  for (const k of [1, 2, 3]) map.addLayer({ id: `anello${k}`, type: "circle", source: "punti", minzoom: 6.3, paint: {
    "circle-radius": 8 + k * 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": k === 3 ? 1.5 : 1.2,
    "circle-stroke-color": ANELLI.oss[k - 1], "circle-stroke-opacity": 0, "circle-pitch-alignment": "map",
  } });
  map.addLayer({ id: "impulso", type: "circle", source: "punti", paint: { "circle-radius": 0, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffd88f", "circle-stroke-width": 1.5, "circle-stroke-opacity": 0 } });
  map.addLayer({ id: "aree-line", type: "line", source: "aree", minzoom: 8, paint: { "line-color": "#fbf4e8", "line-opacity": 0, "line-width": 1.2, "line-dasharray": [3, 3] } });
  map.addLayer({ id: "tratti", type: "line", source: "tratti", layout: { "line-join": "round" }, paint: { "line-color": "#fbf4e8", "line-opacity": 0, "line-width": 3, "line-dasharray": [2, 1] } });
  map.addLayer({ id: "icone", type: "symbol", source: "punti", layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.56, 7, 0.75, 10, 0.95, 14, 1.15], "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-opacity": 0, "icon-opacity-transition": { duration: 0 } } });
  if (map.getStyle().glyphs) map.addLayer({ id: "nomi", type: "symbol", source: "punti", minzoom: 6, filter: ["==", ["get", `o${I_ORA}`], 1],
    layout: { "text-field": ["get", "nome"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": "#fbf4e8", "text-halo-color": "#0a0805", "text-halo-width": 1.5 } });
  map.on("click", (ev: any) => {
    const p = ev.point, f = map.queryRenderedFeatures([[p.x - 22, p.y - 22], [p.x + 22, p.y + 22]], { layers: ["icone"] }).filter((x: any) => x.properties[`o${st.i}`] === 1);
    if (f.length) apri(f[0].properties.id, false);
  });
  map.on("mousemove", (ev: any) => { const p = ev.point; map.getCanvas().style.cursor = map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: ["icone"] }).length ? "pointer" : ""; });
  dipingi();
  const rg = await regioniPronte;
  if (rg) { map.addSource("regioni", { type: "geojson", data: rg }); map.addLayer({ id: "regioni-line", type: "line", source: "regioni", paint: { "line-color": "rgba(255,226,170,.16)", "line-width": 0.6 } }, "eco"); }
  // dati, stile e regioni sono pronti: gli echi non aspettano le immagini satellitari oltre 1 secondo
  let fatto = false;
  const via = () => { if (fatto) return; fatto = true; pronta = true; comparsa(); };
  if (map.loaded()) via(); else { map.once("idle", via); setTimeout(via, 1000); }
});
setTimeout(() => { if (!pronta && !senzaMappa && !map.isStyleLoaded?.()) erroreMappa("Il servizio delle immagini non risponde."); }, 15000);

let modo: "oss" | "prev" | "" = "";
function dipingi() {
  if (!map.getLayer?.("eco")) return;
  const i = st.i, m = futuro() ? "prev" : "oss";
  map.setPaintProperty("eco", "heatmap-weight", pesoEco(i));
  map.setPaintProperty("icone", "icon-opacity", ["*", ["get", `o${i}`], R(1.6)]);
  // lo zoom deve stare al primo livello dell'espressione: da 6.3 a 8 gli anelli sostituiscono l'eco
  for (const k of [1, 2, 3]) map.setPaintProperty(`anello${k}`, "circle-stroke-opacity", ["interpolate", ["linear"], ["zoom"], 6.3, 0, 8, ["*", ["case", [">=", ["get", `b${i}`], k], 0.95 - k * 0.15, 0], R()]]);
  map.setPaintProperty("aree-line", "line-opacity", ["case", visibile(i), 0.7, 0]);
  map.setPaintProperty("tratti", "line-opacity", ["case", visibile(i), 1, 0]);
  if (map.getLayer("nomi")) map.setFilter("nomi", ["==", ["get", `o${i}`], 1]);
  if (m !== modo) {
    modo = m;
    map.setPaintProperty("eco", "heatmap-color", rampa(m));
    for (const k of [1, 2, 3]) map.setPaintProperty(`anello${k}`, "circle-stroke-color", ANELLI[m][k - 1]);
  }
}
function ricarica() {
  if (!map.getSource?.("punti")) return;
  const c = contorni();
  map.getSource("punti").setData(punti()); map.getSource("aree").setData(c.aree); map.getSource("tratti").setData(c.tratti);
  dipingi();
}

// ---------- radar a tutto schermo: gira finché i dati non sono pronti, poi un ultimo giro rivela gli echi ----------
const sweep = $("#sweep") as unknown as HTMLCanvasElement, anelli = $("#sweep-anelli") as unknown as HTMLCanvasElement;
let radarVivo = true, ultimoGiro = 0, angolo = -Math.PI / 2, tPrec = 0, chiudiGiro: (() => void) | null = null;
const GIRO_ATTESA = 1600;           // un giro mentre si carica
const GIRO_FINALE = MOTO.reveal - 160; // l'ultimo giro, più l'accensione dell'ultima eco
const ACCENSIONE = 160;
function centroRadar() {
  const box = $("#mapbox");
  try { const c = map.project(CENTRO_RADAR); if (c && c.x > -500) return c; } catch { /* mappa non pronta */ }
  return { x: box.clientWidth / 2, y: box.clientHeight / 2 };
}
function disegnaRadar(t: number) {
  if (!radarVivo) return;
  const box = $("#mapbox"), dpr = Math.min(2, devicePixelRatio || 1);
  if (sweep.width !== box.clientWidth * dpr || sweep.height !== box.clientHeight * dpr) { sweep.width = box.clientWidth * dpr; sweep.height = box.clientHeight * dpr; }
  if (anelli.width !== sweep.width || anelli.height !== sweep.height) { anelli.width = sweep.width; anelli.height = sweep.height; }
  const ctx = sweep.getContext("2d")!, ca = anelli.getContext("2d")!, c = centroRadar(), cx = c.x * dpr, cy = c.y * dpr, Rm = Math.hypot(Math.max(cx, sweep.width - cx), Math.max(cy, sweep.height - cy));
  const dt = tPrec ? Math.min(100, t - tPrec) : 0; tPrec = t;
  const prima = angolo;
  if (!calmo()) angolo += (dt / (ultimoGiro ? GIRO_FINALE : GIRO_ATTESA)) * Math.PI * 2;
  // velo e anelli di distanza: ridisegnati da capo a ogni fotogramma
  ca.clearRect(0, 0, anelli.width, anelli.height);
  ca.fillStyle = `rgba(6,4,2,${ultimoGiro ? 0.38 * (1 - Math.min(1, (t - ultimoGiro) / GIRO_FINALE)) : 0.38})`; ca.fillRect(0, 0, anelli.width, anelli.height);
  ca.lineWidth = dpr; ca.strokeStyle = "rgba(255,210,140,.16)"; ca.setLineDash([2 * dpr, 5 * dpr]);
  for (let r = 120 * dpr; r < Rm; r += 120 * dpr) { ca.beginPath(); ca.arc(cx, cy, r, 0, Math.PI * 2); ca.stroke(); }
  ca.setLineDash([]);
  ca.fillStyle = "rgba(255,210,140,.6)"; ca.beginPath(); ca.arc(cx, cy, 2.5 * dpr, 0, Math.PI * 2); ca.fill();
  if (!calmo()) {
    // scia: come il fosforo di un PPI, ciò che il fascio ha toccato si spegne piano (mezza vita ~350 ms)
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${1 - Math.pow(0.5, dt / 350)})`; ctx.fillRect(0, 0, sweep.width, sweep.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(255,180,60,0.22)"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, Rm, prima - 0.004, angolo + 0.004); ctx.closePath(); ctx.fill();
    ca.strokeStyle = "rgba(255,226,160,.95)"; ca.lineWidth = 1.5 * dpr; ca.beginPath(); ca.moveTo(cx, cy); ca.lineTo(cx + Math.cos(angolo) * Rm, cy + Math.sin(angolo) * Rm); ca.stroke();
  }
  if (ultimoGiro) passaggio(c, t);
  requestAnimationFrame(disegnaRadar);
}
// durante l'ultimo giro: ogni eco si accende quando il fascio la attraversa
let a0Finale = 0;
function passaggio(c: { x: number; y: number }, t: number) {
  const fatto = angolo - a0Finale;
  let cambiato = false;
  for (const e of EVENTI) {
    if (riv[e.id] >= 1) continue;
    if (impulso[e.id] === undefined) {
      const q = map.project(e.lngLat);
      let b = Math.atan2(q.y - c.y, q.x - c.x) - a0Finale; while (b < 0) b += Math.PI * 2;
      if (b <= fatto) impulso[e.id] = t;
    }
    if (impulso[e.id] !== undefined) { riv[e.id] = Math.min(1, (t - impulso[e.id]) / ACCENSIONE); cambiato = true; }
  }
  if (cambiato) { dipingi(); pulsa(t); }
  if (fatto >= Math.PI * 2 && EVENTI.every((e) => riv[e.id] >= 1)) chiudiGiro?.();
}
function pulsa(t: number) {
  const r = ["match", ["get", "id"], ...EVENTI.flatMap((e) => { const p = impulso[e.id] === undefined ? 0 : Math.min(1, (t - impulso[e.id]) / 360); return [e.id, 4 + (1 - Math.pow(1 - p, 3)) * 22]; }), 0];
  const o = ["match", ["get", "id"], ...EVENTI.flatMap((e) => { const p = impulso[e.id] === undefined ? 1 : Math.min(1, (t - impulso[e.id]) / 360); return [e.id, 0.8 * (1 - p)]; }), 0];
  map.setPaintProperty("impulso", "circle-radius", r);
  map.setPaintProperty("impulso", "circle-stroke-opacity", ["*", ["get", `o${st.i}`], o]);
}
function fermaRadar() {
  radarVivo = false; chiudiGiro = null;
  sweep.classList.add("off"); anelli.classList.add("off"); loader.classList.add("off");
  setTimeout(() => { sweep.getContext("2d")!.clearRect(0, 0, sweep.width, sweep.height); anelli.getContext("2d")!.clearRect(0, 0, anelli.width, anelli.height); etichetteGradi(); }, 300);
}
requestAnimationFrame(disegnaRadar);
function comparsa() {
  occupato(false);
  orologio(true);
  const fine = () => {
    for (const e of EVENTI) riv[e.id] = 1;
    dipingi(); if (map.getLayer?.("impulso")) map.setPaintProperty("impulso", "circle-stroke-opacity", 0);
    fermaRadar();
  };
  if (calmo()) { fine(); return; }
  // un tocco salta l'ultimo giro
  chiudiGiro = fine;
  addEventListener("pointerdown", () => chiudiGiro?.(), { once: true });
  a0Finale = angolo; ultimoGiro = performance.now(); tPrec = 0;
  loader.classList.add("off");
  setTimeout(() => chiudiGiro?.(), MOTO.reveal + 200); // rete di sicurezza
}

// ---------- orologio e anello del tempo ----------
function orologio(decod = false) {
  const f = foto(), hud = $("#hud-time");
  const quando = etichettaFoto(f).toUpperCase();
  const modo = st.i === I_ORA ? "Osservato · ora" : f.prev ? `Previsione · tra ${(f.a - +ORA) / H < 48 ? `${Math.round((f.a - +ORA) / H)} h` : `${Math.round((f.a - +ORA) / 864e5)} g`}` : `Osservato · ${Math.round((+ORA - f.b) / H)} h fa`;
  let w = hud.querySelector(".hud-when");
  if (!w) { hud.innerHTML = `<span class="hud-row"><span class="hud-when fig"></span><span class="hud-spin">${radar(14)}</span></span><span class="hud-mode"><i></i><span></span></span>`; w = hud.querySelector(".hud-when"); }
  if (decod) decodifica(w!, quando); else { inCorso.set(w!, (inCorso.get(w!) || 0) + 1); w!.textContent = quando; }
  const m = hud.querySelector(".hud-mode")!; m.className = `hud-mode ${f.prev ? "prev" : ""}`; m.querySelector("span")!.textContent = modo;
  $("#loop-time").textContent = st.i === I_ORA ? `Ora · ${dataOra(f.b)}` : f.prev ? `${giorno(f.a)} ${ora(f.a)}–${ora(f.b)}` : dataOra(f.b);
  $("#loop-mode").textContent = f.prev ? "Previsione da eventi annunciati" : st.i === I_ORA ? "Ultimo aggiornamento" : "Archivio osservato";
  $("#loop-mode").className = `loop-mode ${f.prev ? "prev" : ""}`;
  $("#now").hidden = st.i === I_ORA;
}
// la mappa sta ancora disegnando? mostra il radar piccolo accanto all'ora, solo se l'attesa si vede
let attesa = 0;
function attendiMappa() {
  clearTimeout(attesa);
  if (senzaMappa || !pronta || st.play) return;
  attesa = window.setTimeout(() => {
    if (map.loaded()) return;
    $("#hud-time").classList.add("loading"); occupato(true);
    map.once("idle", () => { $("#hud-time").classList.remove("loading"); occupato(false); });
  }, 140);
}
const xTraccia = (i: number) => i / (N - 1);
function traccia() {
  const box = $("#track-svg"), w = Math.max(240, box.clientWidth), h = 46, base = 30, pad = 6;
  const x = (i: number) => pad + xTraccia(i) * (w - 2 * pad);
  const somme = FOTO.map((f) => filtrati().reduce((a, e) => a + peso(e, f), 0)), max = Math.max(1, ...somme);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">`;
  const cella = (w - 2 * pad) / (N - 1), bw = Math.max(2, cella - 2);
  somme.forEach((v, i) => {
    if (v <= 0) return;
    const bh = Math.max(2, (v / max) * (base - 8));
    s += `<rect class="hb ${FOTO[i].prev ? "prev" : ""}" data-i="${i}" x="${x(i) - bw / 2}" y="${base - bh}" width="${bw}" height="${bh}" rx="1"/>`;
  });
  // mezzanotti, con un'etichetta solo se non tocca "ora"
  const iDa = (t: number) => t <= +ORA ? 24 - (+ORA - t) / H : I_ORA + (t - +ORA) / (6 * H);
  const d0 = new Date(FOTO[0].b); d0.setHours(24, 0, 0, 0);
  const xOra = x(I_ORA), largo = desktop() ? 44 : 38;
  let ultimo = -99;
  for (let t = +d0; t <= FOTO[N - 1].b; t += 864e5) {
    const xx = x(iDa(t));
    s += `<line class="tk" x1="${xx}" x2="${xx}" y1="${base}" y2="${base + 4}"/>`;
    if (xx - ultimo > largo && Math.abs(xx - xOra) > largo && xx < w - 16) { s += `<text class="tt" x="${xx}" y="${h - 2}" text-anchor="middle">${new Date(t).getDate()}/${new Date(t).getMonth() + 1}</text>`; ultimo = xx; }
  }
  s += `<line class="base" x1="${pad}" x2="${w - pad}" y1="${base}" y2="${base}"/>`;
  s += `<line class="ora" x1="${xOra}" x2="${xOra}" y1="4" y2="${base + 4}"/><text class="tt ora" x="${xOra}" y="${h - 2}" text-anchor="middle">ora</text>`;
  box.innerHTML = s + "</svg>";
  const th = $("#thumb"); th.style.setProperty("--pad", `${pad}px`); th.style.setProperty("--base", `${base}px`);
  segnaTraccia();
}
function segnaTraccia() {
  $("#track-svg").querySelectorAll<SVGRectElement>(".hb").forEach((r) => r.classList.toggle("past", +r.dataset.i! <= st.i));
  $("#thumb").style.setProperty("--x", String(xTraccia(st.i)));
}
const scrub = $("#scrub") as HTMLInputElement;
scrub.max = String(N - 1); scrub.value = String(I_ORA);
function vaiA(i: number) {
  st.i = Math.max(0, Math.min(N - 1, i));
  scrub.value = String(st.i);
  scrub.setAttribute("aria-valuetext", `${etichettaFoto(foto())}${futuro() ? ", previsione" : ""}`);
  dipingi(); orologio(); segnaTraccia(); elencoVivo(); attendiMappa();
}
scrub.addEventListener("input", () => { ferma(); vaiA(+scrub.value); });
$("#now").addEventListener("click", () => { ferma(); vaiA(I_ORA); });
let timer = 0;
function ferma() { st.play = false; clearInterval(timer); document.body.classList.remove("playing"); $("#play").setAttribute("aria-pressed", "false"); $("#play").setAttribute("aria-label", "Avvia l'animazione"); }
function avvia() {
  st.play = true; document.body.classList.add("playing");
  $("#play").setAttribute("aria-pressed", "true"); $("#play").setAttribute("aria-label", "Metti in pausa l'animazione");
  // un radar meteo riparte dal passato: dal primo fotogramma con almeno un'eco
  if (st.i >= N - 1 || st.i === I_ORA) vaiA(Math.max(0, FOTO.findIndex((f) => filtrati().some((e) => peso(e, f) > 0)) - 1));
  timer = window.setInterval(() => {
    if (st.i >= N - 1) { ferma(); return; }
    vaiA(st.i + 1);
  }, MOTO.passo);
}
$("#play").addEventListener("click", () => (st.play ? ferma() : avvia()));
addEventListener("keydown", (ev) => {
  const t = ev.target as HTMLElement;
  if (ev.key === "Escape" && st.sel) chiudi();
  if (ev.key === " " && t === document.body) { ev.preventDefault(); st.play ? ferma() : avvia(); }
});

// ---------- pannello ----------
const body = $("#panel-body"), panel = $("#panel"), detail = $("#detail");
function barre(k: number) { return `<span class="bars b${k}" aria-hidden="true"><i></i><i></i><i></i></span>`; }
function riga(e: Evento, f: Foto) {
  const c = credibilita(e), w = peso(e, f), b = banda(w);
  const quando = w > 0 ? (e.stato === "in_corso" && st.i === I_ORA ? `In corso da ${ora(e.inizio)}` : `Attivo, dal ${dataOra(e.inizio)}`) : `${STATI[e.stato]}, ${dataOra(e.inizio)}`;
  return `<button class="row" role="listitem" data-id="${e.id}" aria-current="${st.sel === e.id}">
    <span class="ic">${simbolo(e.tipo, variante(e), 16)}</span>
    <span class="t">${titolo(e)}</span>
    <span class="eco ${w > 0 ? "" : "off"}">${barre(b.k)}<span>${w > 0 ? `Eco ${b.label}` : "Nessuna eco"}</span></span>
    <span class="m"><span>${quando}</span><span class="pill ${c.cls}">${c.label}</span></span></button>`;
}
function scoperta(f: Foto) {
  const att = attivi(f), disc = att.find((e) => e.contraddittorio);
  const q = st.i === I_ORA ? "ora" : f.prev ? `previsti ${settimana(f.a)} ${giorno(f.a)}, ${ora(f.a)}–${ora(f.b)}` : `alle ${ora(f.b)} del ${giorno(f.b)}`;
  const quando = st.regione ? `In ${st.regione} ${q}` : q[0].toUpperCase() + q.slice(1);
  if (!att.length) return `<p><b>${quando}</b>: nessuna eco con questi filtri.</p>`;
  const top = att[0], sud = att.filter((e) => SUD.includes(e.regione)).length;
  const dove = st.regione ? "" : sud ? (sud === att.length ? (att.length > 1 ? ", tutti al Sud" : ", al Sud") : `, ${sud} al Sud`) : "";
  return `<p><b>${quando}</b>: ${att.length} ${att.length === 1 ? "evento attivo" : "eventi attivi"}${dove}. Eco più forte: <button class="link" data-id="${top.id}">${titolo(top).toLowerCase()}</button>, ${credibilita(top).label.toLowerCase()}.${disc ? ` A ${disc.comune} le fonti sono discordanti.` : ""}</p>`;
}
function cifre(f: Foto) {
  const att = attivi(f), forti = att.filter((e) => banda(peso(e, f)).k === 3).length;
  const ann = filtrati().filter((e) => e.stato === "annunciato" && +new Date(e.inizio) > f.b && +new Date(e.inizio) - f.b < 7 * 864e5).length;
  return `<div><span class="n fig">${att.length}</span><span class="l">Attivi</span></div><div><span class="n fig">${forti}</span><span class="l">Eco forte</span></div><div><span class="n fig">${ann}</span><span class="l">Annunciati, 7 g</span></div>`;
}
function lista(f: Foto) {
  const att = attivi(f), resto = filtrati().filter((e) => !att.includes(e)).sort((a, b) => +new Date(a.inizio) - +new Date(b.inizio));
  const quando = st.i === I_ORA ? "ora" : f.prev ? `${giorno(f.a)}, ${ora(f.a)}–${ora(f.b)}` : `alle ${ora(f.b)} del ${giorno(f.b)}`;
  return `${att.length ? `<h2>Attivi ${quando} <span class="fig">${att.length}</span></h2><div class="list" role="list">${att.map((e) => riga(e, f)).join("")}</div>` : `<h2>Attivi ${quando} <span class="fig">0</span></h2><p class="empty">Nessun evento attivo in questo intervallo. Trascina il tempo o premi «Torna a ora».</p>`}
    ${resto.length ? `<h2>Altri nel periodo <span class="fig">${resto.length}</span></h2><div class="list" role="list">${resto.map((e) => riga(e, f)).join("")}</div>` : ""}`;
}
function elencoVivo() {
  if (st.vista !== "elenco" || (!desktop() && st.sel)) return;
  const f = foto();
  const a = $("#finding"); if (a) a.innerHTML = scoperta(f);
  const b = $("#figures"); if (b) b.innerHTML = cifre(f);
  const l = $("#lista"); if (l) l.innerHTML = lista(f);
}
function legenda() {
  return `<section class="legend" aria-label="Legenda">
    <h2>Come leggere il radar</h2>
    <div class="scale"><span class="sw s1"></span><span class="sw s2"></span><span class="sw s3"></span><span class="sw s4"></span><span class="sw s5"></span></div>
    <div class="scale-cap"><span>debole</span><span>moderata</span><span>forte</span></div>
    <p>L'eco cresce con la gravità del tipo e con la conferma delle fonti. Da vicino diventa uno, due o tre anelli. Nel futuro l'eco è <b class="prevtxt">azzurra</b>: è una previsione dagli annunci.</p>
    <ul class="shapes"><li>${simbolo("blocco", "pieno", 14)}In corso</li><li>${simbolo("blocco", "vuoto", 14)}Annunciato</li><li>${simbolo("blocco", "utenti", 14)}Solo segnalazioni</li><li>${simbolo("blocco", "discorde", 14)}Fonti discordanti</li></ul>
  </section>`;
}
// ---------- filtro per regione ----------
let REGIONI_TUTTE: string[] = [];
const bboxRegione: Record<string, [[number, number], [number, number]]> = {};
regioniPronte.then((rg) => {
  if (!rg) return;
  for (const f of rg.features) {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    const giro = (c: any) => { if (typeof c[0] === "number") { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(giro); };
    giro(f.geometry.coordinates);
    bboxRegione[f.properties.regione] = [[x0, y0], [x1, y1]];
  }
  REGIONI_TUTTE = Object.keys(bboxRegione).sort((a, b) => a.localeCompare(b, "it"));
  if (st.vista === "elenco" && !(st.sel && !desktop())) { const r = $("#regioni"); if (r) r.outerHTML = filtroRegioni(); }
});
function filtroRegioni() {
  const conEventi = [...new Set(EVENTI.map((e) => e.regione))].sort((a, b) => EVENTI.filter((e) => e.regione === b).length - EVENTI.filter((e) => e.regione === a).length);
  const altre = REGIONI_TUTTE.filter((r) => !conEventi.includes(r));
  const n = (r: string) => EVENTI.filter((e) => e.regione === r && st.tipi.has(e.tipo)).length;
  return `<div class="regioni" id="regioni" role="group" aria-label="Regione">
    <button class="chip" data-regione="" aria-pressed="${!st.regione}">Tutta Italia</button>
    ${conEventi.map((r) => `<button class="chip" data-regione="${r}" aria-pressed="${st.regione === r}">${r} <span class="fig">${n(r)}</span></button>`).join("")}
    ${altre.length ? `<label class="chip sel ${st.regione && altre.includes(st.regione) ? "on" : ""}"><span class="sr">Altre regioni</span><select id="altre-regioni"><option value="">Altre regioni…</option>${altre.map((r) => `<option value="${r}" ${st.regione === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>` : ""}
  </div>`;
}
// inquadratura calcolata qui in Mercatore: sul globo cameraForBounds a volte non trova una soluzione
function inquadra(b: [[number, number], [number, number]], maxZoom = 9, pitch = 0) {
  const pad = padMappa(), box = $("#mapbox");
  const W = Math.max(80, box.clientWidth - pad.left - pad.right), Hh = Math.max(80, box.clientHeight - pad.top - pad.bottom);
  const my = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI); // in frazioni di mondo
  const dx = (b[1][0] - b[0][0]) / 360, dy = my(b[1][1]) - my(b[0][1]);
  const zoom = Math.min(maxZoom, Math.log2(Math.min(W / (512 * dx), Hh / (512 * dy))));
  const yc = (my(b[0][1]) + my(b[1][1])) / 2, latc = (360 / Math.PI) * Math.atan(Math.exp(yc * 2 * Math.PI)) - 90;
  map.flyTo({ center: [(b[0][0] + b[1][0]) / 2, latc], zoom, padding: pad, pitch, bearing: 0, duration: calmo() ? 0 : MOTO.fly, essential: true });
}
function scegliRegione(r: string | null) {
  st.regione = r || null;
  if (st.sel && desktop()) { st.sel = null; sgancia(); detail.hidden = true; $("#app").classList.remove("with-detail"); requestAnimationFrame(() => map.resize()); }
  aggiorna();
  if (st.regione && bboxRegione[st.regione]) inquadra(bboxRegione[st.regione], 9, desktop() ? 35 : 30);
  else if (!st.regione) inquadra(ITALIA);
  annuncia(st.regione ? `Filtro: ${st.regione}. ${filtrati().length} ${filtrati().length === 1 ? "evento" : "eventi"} nel periodo.` : "Filtro rimosso: tutta Italia.");
}
const km = (a: [number, number], b: [number, number]) => { const x = (b[0] - a[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), y = (b[1] - a[1]) * 110.57; return Math.hypot(x, y); };
const fmtKm = (d: number) => d < 10 ? `${d.toFixed(1).replace(".", ",")} km` : `${Math.round(d)} km`;

// ---------- avvisi brevi sulla mappa ----------
let toastT = 0;
function annuncia(t: string) {
  const el = $("#toast"); el.textContent = t; el.classList.add("on");
  clearTimeout(toastT); toastT = window.setTimeout(() => el.classList.remove("on"), 3200);
}

function situazione() {
  const f = foto();
  st.vista = "elenco"; panel.classList.remove("evento");
  body.innerHTML = `
  <section class="finding" id="finding">${scoperta(f)}</section>
  ${filtroRegioni()}
  <div class="figures" id="figures">${cifre(f)}</div>
  <div class="types" role="group" aria-label="Tipi di evento">${ORDINE_TIPI.map((k) => `<button class="type" data-tipo="${k}" aria-pressed="${st.tipi.has(k)}">${simbolo(k, "pieno", 13)}${TIPI[k].plur}</button>`).join("")}</div>
  <section class="block" id="lista">${lista(f)}</section>
  ${legenda()}
  <div class="foot"><button class="btn" data-vista="metodo">Come calcoliamo l'eco</button><button class="btn" data-vista="segnala">Segnala un evento</button></div>`;
}
function vicini() {
  let c: [number, number] = CENTRO_RADAR;
  try { const m = map.getCenter(); if (m && typeof m.lng === "number") c = [m.lng, m.lat]; } catch { /* senza mappa */ }
  return EVENTI.filter((e) => e.stato !== "concluso").map((e) => ({ e, d: km(c, e.lngLat) })).sort((a, b) => a.d - b.d).slice(0, 3);
}
function segnalaHTML() {
  const v = vicini();
  return `<div class="d"><div class="d-top"><button class="back" data-back>← Indietro</button></div>
    <header class="d-head"><h2>Segnala un evento</h2><p>Nel sito reale una segnalazione richiede meno di un minuto. In questo prototipo non viene inviato nulla.</p></header>
    <section class="card"><h3>È uno di questi?</h3><p class="plain small">Eventi già noti vicino al centro della mappa. Se è lo stesso, basta confermarlo: non serve una nuova segnalazione.</p>
      <div class="near">${v.map(({ e, d }) => `<button class="row near-row" data-id="${e.id}"><span class="ic">${simbolo(e.tipo, variante(e), 16)}</span><span class="t">${titolo(e)}</span><span class="eco fig">${fmtKm(d)}</span><span class="m"><span>${STATI[e.stato]}, ${dataOra(e.inizio)}</span></span></button>`).join("")}</div></section>
    <section class="card"><h3>Se non c'è, ti chiederemo</h3><ol class="steps">
      <li><b>Il punto.</b> Posi il segnaposto dove succede: l'evento, non dove ti trovi tu.</li>
      <li><b>Il tipo.</b> Blocco, sciopero, corteo o presidio.</li>
      <li><b>Quando.</b> Adesso, oppure l'ora di inizio.</li>
      <li><b>Quante persone, a occhio.</b> Poche decine, centinaia, migliaia.</li>
      <li><b>L'effetto sul traffico.</b> Nessuno, rallentamenti, blocco.</li></ol>
      <p class="plain small">Niente foto e niente testo libero pubblico. Le sole segnalazioni mostrano un'eco tratteggiata e servono più segnalatori diversi nello stesso punto entro 2 ore.</p></section>
    <div class="acts"><button class="btn primary" id="seg-invia">Posa il segnaposto</button></div><div id="msg" aria-live="polite"></div></div>`;
}
function metodo(v: "metodo" | "segnala") {
  st.vista = v; segnaNav(v);
  const box = desktop() ? detail : body;
  if (desktop()) { detail.hidden = false; $("#app").classList.add("with-detail"); requestAnimationFrame(() => { map.resize(); traccia(); }); } else { panel.dataset.state = "half"; panel.classList.add("evento"); }
  sgancia(); st.sel = null;
  box.innerHTML = v === "segnala"
    ? segnalaHTML()
    : `<div class="d"><div class="d-top"><button class="back" data-back>← Indietro</button></div><header class="d-head"><h2>Come calcoliamo l'eco</h2><p>Un evento diventa pubblico quando le fonti indipendenti superano la soglia di 0,80. L'eco sulla mappa è la gravità del tipo moltiplicata per la conferma delle fonti.</p></header>
      <section class="card"><h3>Gravità del tipo</h3><dl class="kv">${ORDINE_TIPI.map((k) => `<dt>${TIPI[k].label}</dt><dd class="fig">${TIPI[k].gravita.toFixed(2)}</dd>`).join("")}</dl></section>
      <section class="card"><h3>Peso delle fonti</h3><dl class="kv"><dt>Ente ufficiale</dt><dd class="fig">1.00</dd><dt>Agenzia di stampa</dt><dd class="fig">0.60</dd><dt>Testata</dt><dd class="fig">0.50</dd><dt>Promotori</dt><dd class="fig">0.30</dd><dt>Segnalazioni</dt><dd class="fig">fino a 0.60</dd><dt>Smentita</dt><dd class="fig">−0.60</dd></dl></section>
      <section class="card"><h3>Previsione</h3><p class="plain">Dopo l'ora attuale l'animazione avanza a blocchi di 6 ore e mostra solo eventi annunciati da fonti, in azzurro. Un evento in corso senza fine comunicata sfuma nelle 24 ore successive.</p></section></div>`;
  box.querySelector("#seg-invia")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale la mappa passerebbe alla modalità segnaposto. Qui non viene inviato nulla.</p>`));
  box.scrollTop = 0;
}
body.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button") as HTMLElement | null;
  if (!b) return;
  if (b.dataset.tipo) { const k = b.dataset.tipo as Tipo; if (st.tipi.has(k) && st.tipi.size > 1) st.tipi.delete(k); else st.tipi.add(k); aggiorna(); }
  else if (b.dataset.regione !== undefined) scegliRegione(b.dataset.regione);
  else if (b.dataset.vista) metodo(b.dataset.vista as "metodo" | "segnala");
  else if (b.dataset.back !== undefined) chiudi();
  else if (b.dataset.id) apri(b.dataset.id, true);
});
body.addEventListener("change", (ev) => { const t = ev.target as HTMLSelectElement; if (t.id === "altre-regioni") scegliRegione(t.value); });
detail.addEventListener("click", (ev) => { const b = (ev.target as HTMLElement).closest("button") as HTMLElement | null; if (b?.dataset.back !== undefined) chiudi(); else if (b?.dataset.id) apri(b.dataset.id, true); });

// ---------- barra di navigazione ----------
function segnaNav(v: string) { document.querySelectorAll(".nav").forEach((n) => n.setAttribute("aria-current", String((n as HTMLElement).dataset.vista === v))); }
document.querySelectorAll<HTMLButtonElement>(".nav").forEach((b) => b.addEventListener("click", () => {
  const v = b.dataset.vista!;
  if (v === "segnala" || v === "metodo") { metodo(v); return; }
  if (st.sel || st.vista !== "elenco") chiudi();
  segnaNav(v);
  if (v === "mappa") {
    if (!desktop()) panel.dataset.state = "peek";
    inquadra(st.regione && bboxRegione[st.regione] ? bboxRegione[st.regione] : ITALIA);
  } else {
    if (!desktop()) panel.dataset.state = "full";
    requestAnimationFrame(() => $("#lista")?.scrollIntoView({ behavior: calmo() ? "auto" : "smooth", block: "start" }));
  }
}));
$("#rail-mark").innerHTML = radar(22, "brand");
$("#title-mark").innerHTML = radar(22, "brand");
$("#rail-mark").addEventListener("click", (ev) => { ev.preventDefault(); (document.querySelector('.nav[data-vista="mappa"]') as HTMLElement).click(); });

// cascata delle conferme: ogni fonte parte dove finisce la precedente, contro la soglia
const num = (v: number) => v.toFixed(2).replace(".", ",");
function cascata(e: Evento) {
  const pk = pacchetti(e), tot = pk.reduce((a, x) => a + x.w, 0);
  let acc = 0; const cum = pk.map((x) => { const a = acc; acc += x.w; return [a, acc]; });
  const lo = Math.min(0, ...cum.flat()), hi = Math.max(SCALA, ...cum.flat());
  const X = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const esito = !e.fonti.length ? { t: "Visibile con la regola delle segnalazioni: più persone diverse, stesso punto, entro 2 ore.", k: "user" }
    : e.contraddittorio ? { t: "Sotto la soglia, ma resta visibile con l'avviso: la prima fonte lo aveva già fatto pubblicare.", k: "warn" }
    : tot >= SOGLIA ? { t: "Sopra la soglia: visibile.", k: "ok" } : { t: "Sotto la soglia: non sarebbe pubblico.", k: "warn" };
  const n = pk.length;
  return `<section class="card perche"><h3>Perché è visibile <span class="fig">${num(tot)} su soglia ${num(SOGLIA)}</span></h3>
    <ol class="cascata" style="--th:${X(SOGLIA)}%">
      ${pk.map((p, i) => { const neg = p.w < 0, ut = p.tipo.startsWith("Segnalazioni"); return `<li style="--i:${i}"><span class="ca-n"><b>${p.nome}</b><span>${p.tipo} · <span class="fig">${p.quando}</span></span></span><span class="ca-w fig ${neg ? "neg" : ""}">${neg ? "−" : "+"}${num(Math.abs(p.w))}</span>
        <span class="ca-t" aria-hidden="true"><i class="${neg ? "neg" : ut ? "ut" : ""}" style="left:${X(Math.min(cum[i][0], cum[i][1]))}%;width:${Math.abs(X(cum[i][1]) - X(cum[i][0]))}%"></i><b class="th"></b></span></li>`; }).join("")}
      <li class="ca-tot" style="--i:${n}"><span class="ca-n"><b>Totale</b><span class="esito ${esito.k}">${esito.t}</span></span><span class="ca-w fig">${num(tot)}</span>
        <span class="ca-t" aria-hidden="true"><i class="tot ${tot < 0 ? "neg" : ""} ${esito.k}" style="left:${X(Math.min(0, tot))}%;width:${Math.abs(X(tot) - X(0))}%"></i><b class="th"></b></span></li>
    </ol>
    <p class="ca-leg"><span><i class="k-th"></i>Soglia di pubblicazione ${num(SOGLIA)}</span><span>Una smentita, tratteggiata, sottrae peso</span></p></section>`;
}
// eventi vicini: stessa regione o entro 60 km, e quelli della stessa mobilitazione
function eventiVicini(e: Evento) {
  const v = EVENTI.filter((x) => x.id !== e.id).map((x) => ({ x, d: km(e.lngLat, x.lngLat), mob: !!(e.nazionale && x.nazionale) }))
    .filter((o) => o.mob || o.d <= 60 || o.x.regione === e.regione).sort((a, b) => a.d - b.d).slice(0, 4);
  return `<section class="card vicini"><h3>Eventi vicini</h3>${v.length ? `<div class="near">${v.map(({ x, d, mob }) => `<button class="row near-row" data-id="${x.id}"><span class="ic">${simbolo(x.tipo, variante(x), 16)}</span><span class="t">${titolo(x)}</span><span class="eco fig">${fmtKm(d)}</span><span class="m"><span>${mob ? "Stessa mobilitazione" : x.regione === e.regione ? x.regione : "Entro 60 km"} · ${STATI[x.stato].toLowerCase()}, ${dataOra(x.inizio)}</span></span></button>`).join("")}</div>`
    : `<p class="plain small">Nessun altro evento nella stessa regione, entro 60 km o della stessa mobilitazione.</p>`}</section>`;
}
function scheda(e: Evento) {
  const c = credibilita(e), I = intensita(e), b = banda(I);
  return `<div class="d">
  <div class="d-top"><button class="back" data-back>← Tutti gli eventi</button></div>
  <header class="d-head"><div class="d-sym">${simbolo(e.tipo, variante(e), 18)}<span class="fig">${e.regione.toUpperCase()} · ${e.categoria.toUpperCase()}</span></div><h2 class="dec">${titolo(e)}</h2><p>${e.luogo}</p>
    <div class="pills"><span class="pill neutral">${STATI[e.stato]}</span><span class="pill ${c.cls}">${c.label}</span><span class="pill eco-pill">${barre(b.k)}Eco ${b.label}</span></div></header>
  ${e.contraddittorio ? `<p class="alert warn">Due fonti descrivono la situazione in modo incompatibile. L'evento resta visibile con questo avviso finché una fonte successiva non chiarisce.</p>` : ""}
  ${!e.fonti.length ? `<p class="alert user">Nessuna fonte giornalistica o ufficiale finora. È visibile perché ${e.segnalatori} segnalatori diversi lo hanno indicato nello stesso punto entro 2 ore; scompare dopo 6 ore senza nuove segnalazioni.</p>` : ""}
  ${cascata(e)}
  <section class="card"><h3>Eco sul radar</h3><div class="ecoline">${barre(b.k)}<b>Eco ${b.label}</b><span class="fig">${TIPI[e.tipo].gravita.toFixed(2)} × ${conferma(e).toFixed(2)} = ${I.toFixed(2)}</span></div><p class="plain small">Gravità del tipo per conferma delle fonti${e.contraddittorio ? ", ridotta perché le fonti sono discordanti" : ""}.</p></section>
  <section class="card"><h3>Quando e dove</h3><dl class="kv">
    <dt>Inizio</dt><dd class="fig">${dataOra(e.inizio)}</dd><dt>Fine</dt><dd class="fig">${e.fine ? dataOra(e.fine) : "non comunicata"}</dd>
    <dt>Precisione</dt><dd>${e.precisione === "comune" ? "Solo il comune" : "Punto indicato dalle fonti"}</dd><dt>Traffico</dt><dd>${e.traffico}</dd>
    <dt>Aggiornato</dt><dd class="fig">${dataOra(e.aggiornato)} · ${fa(e.aggiornato)}</dd></dl></section>
  <section class="card"><h3>Cronologia</h3><ol class="tl">${e.cronologia.map(([w, k, t]) => `<li><span class="w fig">${dataOra(w)}</span><span><b>${k}.</b> ${t}</span></li>`).join("")}</ol></section>
  ${eventiVicini(e)}
  <div class="acts">${e.stato !== "concluso" ? `<button class="btn primary" id="conf">Sono sul posto, confermo</button>` : ""}<button class="btn" id="err">Segnala un errore</button></div><div id="msg" aria-live="polite"></div></div>`;
}
function apri(id: string, daElenco: boolean) {
  st.sel = id; st.vista = "elenco";
  const e = EVENTI.find((x) => x.id === id)!;
  if (desktop()) { detail.hidden = false; $("#app").classList.add("with-detail"); detail.innerHTML = scheda(e); detail.scrollTop = 0; situazione(); }
  else { ferma(); body.innerHTML = scheda(e); body.scrollTop = 0; panel.classList.add("evento"); if (panel.dataset.state === "peek") panel.dataset.state = "half"; }
  const box = desktop() ? detail : body;
  const h = box.querySelector(".dec"); if (h) decodifica(h, h.textContent || "");
  box.querySelector("#err")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale l'evento verrebbe nascosto in via cautelativa e verificato entro 48 ore. Qui non viene inviato nulla.</p>`));
  box.querySelector("#conf")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale la conferma conterebbe come segnalazione. Qui non viene inviato nulla.</p>`));
  ricarica();
  requestAnimationFrame(() => {
    map.resize(); traccia();
    const pad = desktop() ? { left: 450, top: 100, right: 470, bottom: 120 } : { top: 110, bottom: window.innerHeight * 0.58, left: 30, right: 30 };
    aggancia(e);
    map.flyTo({ center: e.lngLat, zoom: e.precisione === "comune" ? 10 : 11, pitch: desktop() ? 48 : 42, padding: pad, duration: calmo() ? 0 : MOTO.fly, curve: 1.3, essential: true });
    // l'etichetta si decodifica quando la camera è arrivata
    if (!calmo()) setTimeout(() => preso === e && etichetta(e), MOTO.fly);
    else etichetta(e);
  });
  void daElenco;
}
function chiudi() {
  st.sel = null; sgancia(); segnaNav("mappa");
  detail.hidden = true; $("#app").classList.remove("with-detail");
  situazione(); ricarica();
  if (!desktop()) panel.dataset.state = "peek";
  requestAnimationFrame(() => { map.resize(); traccia(); });
}

// ---------- aggancio: angoli che si stringono (200 ms), impulso, poi l'etichetta si decodifica ----------
const lock = $("#lock"), tag = $("#lock-tag");
let preso: Evento | null = null;
function aggancia(e: Evento) {
  preso = e; lock.hidden = false; lock.classList.remove("on"); void lock.offsetWidth;
  lock.classList.add("on");
  tag.innerHTML = `${radar(12)}<span>AGGANCIO</span>`; tag.classList.add("wait"); occupato(true);
  segui();
}
function etichetta(e: Evento) {
  tag.classList.remove("wait"); occupato(false);
  tag.innerHTML = "<span></span>";
  decodifica(tag.firstElementChild!, `${TIPI[e.tipo].label} · ${e.comune} · eco ${banda(intensita(e)).label}`.toUpperCase());
}
function sgancia() { if (preso && tag.classList.contains("wait")) occupato(false); preso = null; lock.hidden = true; tag.classList.remove("wait"); }
function segui() {
  if (!preso) return;
  const p = map.project(preso.lngLat), box = $("#mapbox").getBoundingClientRect();
  lock.style.transform = `translate(${p.x}px, ${p.y}px)`; lock.classList.toggle("flip", p.x > box.width - 250 - (desktop() && !detail.hidden ? 412 : 0));
}
map.on("move", segui);

// ---------- ricerca di un comune (elenco ISTAT locale, nessun servizio esterno) ----------
type Comune = [string, string, string, number, number];
let COMUNI: Comune[] | null = null, NORM: string[] = [], caricaComuni: Promise<void> | null = null;
const norma = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "'").toLowerCase().trim();
const q = $("#q") as HTMLInputElement, qList = $("#q-list"), qX = $("#q-x");
let trovati: Comune[] = [], attivo = -1;
function comuni() {
  if (!caricaComuni) {
    caricaComuni = fetch("comuni.json").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: Comune[]) => { COMUNI = d; NORM = d.map((c) => norma(c[0])); })
      .catch(() => { caricaComuni = null; throw new Error("comuni"); });
  }
  return caricaComuni;
}
const vicinoA = (c: Comune) => EVENTI.filter((e) => km([c[3], c[4]], e.lngLat) <= 30).length;
function mostraLista(html: string, aperta: boolean) {
  qList.innerHTML = html; qList.hidden = !aperta; q.setAttribute("aria-expanded", String(aperta));
  if (!aperta) q.removeAttribute("aria-activedescendant");
}
function cerca() {
  const t = norma(q.value);
  attivo = -1;
  if (!t) { mostraLista("", false); return; }
  if (!COMUNI) {
    mostraLista(`<li class="q-stato" role="presentation">${radar(14)}Carico l'elenco dei comuni…</li>`, true);
    comuni().then(cerca, () => mostraLista(`<li class="q-stato err" role="presentation">Elenco dei comuni non disponibile. Riprova più tardi.</li>`, true));
    return;
  }
  const pre: number[] = [], dentro: number[] = [];
  for (let i = 0; i < NORM.length && pre.length < 8; i++) { if (NORM[i].startsWith(t)) pre.push(i); }
  if (pre.length < 8) for (let i = 0; i < NORM.length && pre.length + dentro.length < 8; i++) { if (!NORM[i].startsWith(t) && NORM[i].includes(t)) dentro.push(i); }
  pre.sort((a, b) => NORM[a].length - NORM[b].length || NORM[a].localeCompare(NORM[b]));
  trovati = [...pre, ...dentro].map((i) => COMUNI![i]);
  if (!trovati.length) { mostraLista(`<li class="q-stato" role="presentation">Nessun comune con questo nome.</li>`, true); return; }
  mostraLista(trovati.map((c, k) => { const n = vicinoA(c); return `<li role="option" id="q-o${k}" data-k="${k}" aria-selected="false"><span class="q-n">${esc(c[0])}</span><span class="q-p">${c[1]} · ${c[2]}</span>${n ? `<span class="q-e"><i></i>${n} ${n === 1 ? "evento" : "eventi"} entro 30 km</span>` : ""}</li>`; }).join(""), true);
}
function evidenzia(k: number) {
  const opt = qList.querySelectorAll<HTMLElement>("[role=option]");
  if (!opt.length) return;
  attivo = (k + opt.length) % opt.length;
  opt.forEach((o, i) => o.setAttribute("aria-selected", String(i === attivo)));
  q.setAttribute("aria-activedescendant", opt[attivo].id);
  opt[attivo].scrollIntoView({ block: "nearest" });
}
function scegliComune(c: Comune) {
  q.value = c[0]; mostraLista("", false); chiudiCercaMob();
  const n = vicinoA(c);
  if (!desktop()) panel.dataset.state = "peek";
  map.flyTo({ center: [c[3], c[4]], zoom: 11, pitch: desktop() ? 45 : 40, padding: padMappa(), duration: calmo() ? 0 : MOTO.fly, essential: true });
  const src = map.getSource?.("luogo"), dati = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [c[3], c[4]] }, properties: { nome: c[0] } }] };
  if (src) src.setData(dati);
  else if (map.getLayer?.("icone")) {
    map.addSource("luogo", { type: "geojson", data: dati });
    map.addLayer({ id: "luogo-anello", type: "circle", source: "luogo", paint: { "circle-radius": 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#f6efe3", "circle-stroke-width": 1.5 } }, "icone");
    map.addLayer({ id: "luogo-punto", type: "circle", source: "luogo", paint: { "circle-radius": 2.5, "circle-color": "#f6efe3" } }, "icone");
  }
  annuncia(`${c[0]} (${c[1]}): ${n ? `${n} ${n === 1 ? "evento" : "eventi"} entro 30 km` : "nessun evento entro 30 km"}.`);
}
q.addEventListener("focus", () => { comuni().catch(() => {}); });
q.addEventListener("input", () => { qX.hidden = !q.value && desktop(); cerca(); });
q.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown") { ev.preventDefault(); if (qList.hidden) cerca(); evidenzia(attivo + 1); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); evidenzia(attivo - 1); }
  else if (ev.key === "Enter") { ev.preventDefault(); const c = trovati[attivo >= 0 ? attivo : 0]; if (c && !qList.hidden) scegliComune(c); }
  else if (ev.key === "Escape") { ev.stopPropagation(); if (!qList.hidden) mostraLista("", false); else { q.value = ""; chiudiCercaMob(); } }
});
qList.addEventListener("pointerdown", (ev) => { const li = (ev.target as HTMLElement).closest("[role=option]") as HTMLElement | null; if (li) { ev.preventDefault(); scegliComune(trovati[+li.dataset.k!]); } });
q.addEventListener("blur", () => setTimeout(() => mostraLista("", false), 120));
qX.addEventListener("click", () => { q.value = ""; mostraLista("", false); if (desktop()) { qX.hidden = true; q.focus(); } else chiudiCercaMob(); });
// telefono: la ricerca si apre dal pulsante in alto
const cercaMob = $("#cerca-slot-mob"), cercaApri = $("#cerca-apri");
function chiudiCercaMob() { if (desktop()) return; cercaMob.hidden = true; cercaApri.setAttribute("aria-expanded", "false"); }
cercaApri.addEventListener("click", () => { cercaMob.hidden = false; cercaApri.setAttribute("aria-expanded", "true"); qX.hidden = false; q.focus(); });
function collocaCerca() {
  const c = $("#cerca"), dest = desktop() ? $("#cerca-slot-desk") : cercaMob;
  if (c.parentElement !== dest) dest.appendChild(c);
  if (desktop()) { cercaMob.hidden = true; qX.hidden = !q.value; } else qX.hidden = false;
}

// ---------- impaginazione ----------
function collocaLoop() {
  const loop = $("#loop"), dest = desktop() ? $("#loop-slot-desk") : $("#loop-slot-mob");
  if (loop.parentElement !== dest) dest.appendChild(loop);
}
let eraDesk = desktop();
addEventListener("resize", () => {
  collocaLoop(); collocaCerca(); traccia(); segui();
  if (eraDesk !== desktop()) { eraDesk = desktop(); if (st.sel) apri(st.sel, false); else situazione(); }
});
function aggiorna() { ricarica(); situazione(); traccia(); }

collocaLoop();
collocaCerca();
situazione();
orologio();
requestAnimationFrame(traccia);
scrub.setAttribute("aria-valuetext", etichettaFoto(foto()));

// pannello trascinabile su telefono
const fasi = ["peek", "half", "full"] as const;
const grip = $("#grip");
let y0 = 0, mosso = false;
grip.addEventListener("click", () => { if (mosso) return; const i = fasi.indexOf(panel.dataset.state as any); panel.dataset.state = fasi[(i + 1) % 3]; });
grip.addEventListener("pointerdown", (ev) => { y0 = ev.clientY; mosso = false; grip.setPointerCapture(ev.pointerId); });
grip.addEventListener("pointermove", (ev) => { if (ev.buttons && Math.abs(ev.clientY - y0) > 6) mosso = true; });
grip.addEventListener("pointerup", (ev) => {
  if (mosso) { const dy = ev.clientY - y0, i = fasi.indexOf(panel.dataset.state as any); panel.dataset.state = fasi[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]; }
  setTimeout(() => (mosso = false), 0);
});
panel.addEventListener("transitionend", segui);

// controlli di coerenza dei dati di prova
console.assert(FOTO[I_ORA].b === +ORA, "il fotogramma 'ora' deve finire a ORA");
console.assert(FOTO[N - 1].b === +ORA + 8 * 864e5, "la previsione copre 8 giorni");
