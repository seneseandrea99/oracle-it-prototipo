// ORACLE IT · variante "Radar": il radar meteo delle mobilitazioni.
// Tutti i dati sono di prova (src/data.ts, is_test = true).
import "./style.css";
import { EVENTI, ORA, type Evento, type Tipo, type FonteTipo } from "../../src/data";

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
const st = { tipi: new Set<Tipo>(ORDINE_TIPI), i: I_ORA, sel: null as string | null, play: false, vista: "elenco" as "elenco" | "metodo" | "segnala" };
const filtrati = () => EVENTI.filter((e) => st.tipi.has(e.tipo));
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
  const ctx = cv.getContext("2d")!, c = px / 2, r = px * 0.25, ink = v === "concluso" ? "#8a9799" : "#f1fbf8";
  tracciato(ctx, TIPI[tipo].forma, c, r); ctx.lineWidth = px * 0.16; ctx.strokeStyle = "rgba(4,8,10,.75)"; ctx.lineJoin = "round"; ctx.stroke();
  tracciato(ctx, TIPI[tipo].forma, c, r); ctx.fillStyle = "rgba(4,8,10,.7)"; ctx.fill();
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
const SATELLITE = {
  eox: { tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"], maxzoom: 15,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX IT Services GmbH</a> (dati Copernicus Sentinel 2020)' },
  esri: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], maxzoom: 18,
    attribution: "Immagini: Esri, Maxar, Earthstar Geographics" },
};
const padMappa = () => desktop() ? { top: 80, bottom: 30, left: 30, right: 30 } : { top: 130, bottom: 240, left: 14, right: 14 };
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
  container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#04070a" } }] },
  bounds: ITALIA, fitBoundsOptions: { padding: padMappa() }, minZoom: 1.6, maxZoom: 17.5, maxPitch: 60,
  attributionControl: { compact: true }, dragRotate: false,
});
if (senzaMappa) setTimeout(() => erroreMappa("Controlla la connessione."), 0);
else {
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
}

function satellite(style: any) {
  const strade = ["match", ["get", "class"], ["motorway"], "rgba(220,240,236,.38)", ["trunk", "primary"], "rgba(220,240,236,.22)", "rgba(220,240,236,.1)"];
  const tenute = style.layers.filter((l: any) => {
    const id = String(l.id), sl = String(l["source-layer"] || "");
    if (l.type === "line" && sl === "transportation") { l.paint = { ...(l.paint || {}), "line-color": strade }; delete l.paint["line-gradient"]; delete l.paint["line-dasharray"]; return !/casing|tunnel|rail|path|ferry/.test(id); }
    if (l.type === "line" && sl === "boundary") { l.paint = { ...(l.paint || {}), "line-color": "rgba(220,240,236,.4)" }; return true; }
    if (l.type === "symbol" && /place|city|town|capital|state|country/.test(id)) {
      l.paint = { ...(l.paint || {}), "text-color": "#d9e6e3", "text-halo-color": "rgba(2,6,8,.9)", "text-halo-width": 1.4, "icon-opacity": 0 };
      return true;
    }
    return false;
  });
  style.sources.satellite = { type: "raster", tileSize: 256, ...SATELLITE.eox };
  style.layers = [
    { id: "spazio", type: "background", paint: { "background-color": "#04070a" } },
    { id: "satellite", type: "raster", source: "satellite", paint: { "raster-brightness-max": 0.42, "raster-saturation": -0.82, "raster-contrast": 0.12, "raster-fade-duration": 200 } },
    ...tenute,
  ];
  style.projection = { type: "globe" };
  style.sky = { "sky-color": "#04121a", "horizon-color": "#1d4d55", "fog-color": "#04070a", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.4,
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
      map.setStyle(satellite(await r.json()));
    } catch {
      map.setStyle(satellite({ version: 8, sources: {}, layers: [] }));
    }
  })();
}
const regioniPronte = fetch("../../regioni.json").then((r) => r.json()).catch(() => null);

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
      const p: Record<string, any> = { id: e.id, icon: `${e.tipo}-${variante(e)}`, nome: e.comune, sel: st.sel === e.id ? 1 : 0 };
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
  oss: ["rgba(18,96,104,0.38)", "rgba(24,148,146,0.56)", "rgba(72,212,186,0.74)", "rgba(170,247,224,0.88)", "rgba(240,255,251,0.96)"],
  prev: ["rgba(36,62,112,0.38)", "rgba(58,104,176,0.54)", "rgba(110,160,228,0.7)", "rgba(182,210,250,0.85)", "rgba(236,244,255,0.94)"],
};
const ANELLI = { oss: ["#18948f", "#48d4ba", "#aaf7e0"], prev: ["#3a68b0", "#6ea0e4", "#b6d2fa"] };
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
  map.addLayer({ id: "impulso", type: "circle", source: "punti", paint: { "circle-radius": 0, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#aaf7e0", "circle-stroke-width": 1.5, "circle-stroke-opacity": 0 } });
  map.addLayer({ id: "aree-line", type: "line", source: "aree", minzoom: 8, paint: { "line-color": "#f1fbf8", "line-opacity": 0, "line-width": 1.2, "line-dasharray": [3, 3] } });
  map.addLayer({ id: "tratti", type: "line", source: "tratti", layout: { "line-join": "round" }, paint: { "line-color": "#f1fbf8", "line-opacity": 0, "line-width": 3, "line-dasharray": [2, 1] } });
  map.addLayer({ id: "icone", type: "symbol", source: "punti", layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.56, 7, 0.75, 10, 0.95, 14, 1.15], "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-opacity": 0, "icon-opacity-transition": { duration: 0 } } });
  if (map.getStyle().glyphs) map.addLayer({ id: "nomi", type: "symbol", source: "punti", minzoom: 6, filter: ["==", ["get", `o${I_ORA}`], 1],
    layout: { "text-field": ["get", "nome"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": "#f1fbf8", "text-halo-color": "#04070a", "text-halo-width": 1.5 } });
  map.on("click", (ev: any) => {
    const p = ev.point, f = map.queryRenderedFeatures([[p.x - 22, p.y - 22], [p.x + 22, p.y + 22]], { layers: ["icone"] }).filter((x: any) => x.properties[`o${st.i}`] === 1);
    if (f.length) apri(f[0].properties.id, false);
  });
  map.on("mousemove", (ev: any) => { const p = ev.point; map.getCanvas().style.cursor = map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: ["icone"] }).length ? "pointer" : ""; });
  dipingi();
  const rg = await regioniPronte;
  if (rg) { map.addSource("regioni", { type: "geojson", data: rg }); map.addLayer({ id: "regioni-line", type: "line", source: "regioni", paint: { "line-color": "rgba(200,232,226,.2)", "line-width": 0.6 } }, "eco"); }
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
  map.setPaintProperty("eco", "heatmap-weight", ["*", ["get", `w${i}`], R()]);
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
const sweep = $("#sweep") as unknown as HTMLCanvasElement;
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
  const ctx = sweep.getContext("2d")!, c = centroRadar(), cx = c.x * dpr, cy = c.y * dpr, Rm = Math.hypot(Math.max(cx, sweep.width - cx), Math.max(cy, sweep.height - cy));
  const dt = tPrec ? t - tPrec : 0; tPrec = t;
  if (!calmo()) angolo += (dt / (ultimoGiro ? GIRO_FINALE : GIRO_ATTESA)) * Math.PI * 2;
  ctx.clearRect(0, 0, sweep.width, sweep.height);
  ctx.fillStyle = `rgba(4,7,10,${ultimoGiro ? 0.35 * (1 - Math.min(1, (t - ultimoGiro) / GIRO_FINALE)) : 0.35})`; ctx.fillRect(0, 0, sweep.width, sweep.height);
  // anelli di distanza su tutto lo schermo
  ctx.lineWidth = dpr; ctx.strokeStyle = "rgba(150,240,214,.16)"; ctx.setLineDash([2 * dpr, 5 * dpr]);
  for (let r = 120 * dpr; r < Rm; r += 120 * dpr) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(150,240,214,.6)"; ctx.beginPath(); ctx.arc(cx, cy, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
  if (!calmo()) {
    const coda = 0.9, a = angolo;
    const g = ctx.createConicGradient(a - coda, cx, cy);
    g.addColorStop(0, "rgba(97,232,198,0)"); g.addColorStop(coda / (Math.PI * 2), "rgba(97,232,198,0.22)"); g.addColorStop(coda / (Math.PI * 2) + 0.001, "rgba(97,232,198,0)"); g.addColorStop(1, "rgba(97,232,198,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, Rm, a - coda, a); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(190,255,236,.85)"; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * Rm, cy + Math.sin(a) * Rm); ctx.stroke();
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
  sweep.classList.add("off"); loader.classList.add("off");
  setTimeout(() => sweep.getContext("2d")!.clearRect(0, 0, sweep.width, sweep.height), 300);
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
  const quando = st.i === I_ORA ? "Ora" : f.prev ? `Previsti ${settimana(f.a)} ${giorno(f.a)}, ${ora(f.a)}–${ora(f.b)}` : `Alle ${ora(f.b)} del ${giorno(f.b)}`;
  if (!att.length) return `<p><b>${quando}</b>: nessuna eco con questi filtri.</p>`;
  const top = att[0], sud = att.filter((e) => SUD.includes(e.regione)).length;
  const dove = sud ? (sud === att.length ? (att.length > 1 ? ", tutti al Sud" : ", al Sud") : `, ${sud} al Sud`) : "";
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
function situazione() {
  const f = foto();
  st.vista = "elenco"; panel.classList.remove("evento");
  body.innerHTML = `
  <header class="title"><div class="title-row"><h1><span class="mark">${radar(22, "brand")}</span>ORACLE IT</h1><span class="test">Dati di prova</span></div>
    <p class="sub">Radar delle mobilitazioni in Italia. Eventi e fonti di questa pagina sono inventati.</p></header>
  <section class="finding" id="finding">${scoperta(f)}</section>
  <div class="figures" id="figures">${cifre(f)}</div>
  <div class="types" role="group" aria-label="Tipi di evento">${ORDINE_TIPI.map((k) => `<button class="type" data-tipo="${k}" aria-pressed="${st.tipi.has(k)}">${simbolo(k, "pieno", 13)}${TIPI[k].plur}</button>`).join("")}</div>
  <section class="block" id="lista">${lista(f)}</section>
  ${legenda()}
  <div class="foot"><button class="btn" data-vista="metodo">Come calcoliamo l'eco</button><button class="btn" data-vista="segnala">Segnala un evento</button></div>`;
}
function vicini() {
  let c: [number, number] = CENTRO_RADAR;
  try { const m = map.getCenter(); if (m && typeof m.lng === "number") c = [m.lng, m.lat]; } catch { /* senza mappa */ }
  const km = (a: [number, number], b: [number, number]) => { const x = (b[0] - a[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), y = (b[1] - a[1]) * 110.57; return Math.hypot(x, y); };
  return EVENTI.filter((e) => e.stato !== "concluso").map((e) => ({ e, d: km(c, e.lngLat) })).sort((a, b) => a.d - b.d).slice(0, 3);
}
function segnalaHTML() {
  const v = vicini();
  return `<div class="d"><div class="d-top"><button class="back" data-back>← Indietro</button></div>
    <header class="d-head"><h2>Segnala un evento</h2><p>Nel sito reale una segnalazione richiede meno di un minuto. In questo prototipo non viene inviato nulla.</p></header>
    <section class="card"><h3>È uno di questi?</h3><p class="plain small">Eventi già noti vicino al centro della mappa. Se è lo stesso, basta confermarlo: non serve una nuova segnalazione.</p>
      <div class="near">${v.map(({ e, d }) => `<button class="row near-row" data-id="${e.id}"><span class="ic">${simbolo(e.tipo, variante(e), 16)}</span><span class="t">${titolo(e)}</span><span class="eco fig">${d < 10 ? d.toFixed(1) : Math.round(d)} km</span><span class="m"><span>${STATI[e.stato]}, ${dataOra(e.inizio)}</span></span></button>`).join("")}</div></section>
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
  else if (b.dataset.vista) metodo(b.dataset.vista as "metodo" | "segnala");
  else if (b.dataset.back !== undefined) chiudi();
  else if (b.dataset.id) apri(b.dataset.id, true);
});
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
    // inquadra l'Italia da dritto: con la camera inclinata il calcolo dei margini sul globo può fallire
    const cam = (() => { try { return map.cameraForBounds(ITALIA, { padding: padMappa(), pitch: 0, bearing: 0 }); } catch { return null; } })();
    map.flyTo({ ...(cam && cam.center ? cam : { center: [12.6, 41.8], zoom: desktop() ? 5 : 4.1, padding: padMappa() }), pitch: 0, bearing: 0, duration: calmo() ? 0 : MOTO.fly, essential: true });
  } else {
    if (!desktop()) panel.dataset.state = "full";
    requestAnimationFrame(() => $("#lista")?.scrollIntoView({ behavior: calmo() ? "auto" : "smooth", block: "start" }));
  }
}));
$("#rail-mark").innerHTML = radar(22, "brand");
$("#rail-mark").addEventListener("click", (ev) => { ev.preventDefault(); (document.querySelector('.nav[data-vista="mappa"]') as HTMLElement).click(); });

function scheda(e: Evento) {
  const c = credibilita(e), pk = pacchetti(e), tot = pk.reduce((a, x) => a + x.w, 0), seg = 24, I = intensita(e), b = banda(I);
  const pieni = Math.round((Math.max(0, Math.min(Math.abs(tot), SCALA)) / SCALA) * seg);
  return `<div class="d">
  <div class="d-top"><button class="back" data-back>← Tutti gli eventi</button></div>
  <header class="d-head"><div class="d-sym">${simbolo(e.tipo, variante(e), 18)}<span class="fig">${e.regione.toUpperCase()} · ${e.categoria.toUpperCase()}</span></div><h2 class="dec">${titolo(e)}</h2><p>${e.luogo}</p>
    <div class="pills"><span class="pill neutral">${STATI[e.stato]}</span><span class="pill ${c.cls}">${c.label}</span><span class="pill eco-pill">${barre(b.k)}Eco ${b.label}</span></div></header>
  ${e.contraddittorio ? `<p class="alert warn">Due fonti descrivono la situazione in modo incompatibile. L'evento resta visibile con questo avviso finché una fonte successiva non chiarisce.</p>` : ""}
  ${!e.fonti.length ? `<p class="alert user">Nessuna fonte giornalistica o ufficiale finora. È visibile perché ${e.segnalatori} segnalatori diversi lo hanno indicato nello stesso punto entro 2 ore; scompare dopo 6 ore senza nuove segnalazioni.</p>` : ""}
  <section class="card"><h3>Perché è visibile</h3>
    <div class="meter-top"><b class="fig">${tot.toFixed(2)}</b><span>soglia di pubblicazione ${SOGLIA.toFixed(2)}${!e.fonti.length ? ", regola a parte per le segnalazioni" : ""}</span></div>
    <div class="bar">${Array.from({ length: seg }, (_, i) => `<i class="${i < pieni ? "on" : ""} ${tot < 0 ? "neg" : ""}"></i>`).join("")}<span class="th" style="left:${(SOGLIA / SCALA) * 100}%"><em>soglia</em></span></div>
    <div class="bar-cap fig"><span>0</span><span>${SCALA.toFixed(1)}</span></div>
    <ol class="packets">${pk.map((p, i) => `<li class="pk" style="--i:${i}"><span class="p">${p.nome}</span><span class="w fig ${p.w < 0 ? "neg" : ""}">${p.w > 0 ? "+" : "−"}${Math.abs(p.w).toFixed(2)}</span><span class="k">${p.tipo}</span><span class="d2 fig">${p.quando}</span></li>`).join("")}</ol></section>
  <section class="card"><h3>Eco sul radar</h3><div class="ecoline">${barre(b.k)}<b>Eco ${b.label}</b><span class="fig">${TIPI[e.tipo].gravita.toFixed(2)} × ${conferma(e).toFixed(2)} = ${I.toFixed(2)}</span></div><p class="plain small">Gravità del tipo per conferma delle fonti${e.contraddittorio ? ", ridotta perché le fonti sono discordanti" : ""}.</p></section>
  <section class="card"><h3>Quando e dove</h3><dl class="kv">
    <dt>Inizio</dt><dd class="fig">${dataOra(e.inizio)}</dd><dt>Fine</dt><dd class="fig">${e.fine ? dataOra(e.fine) : "non comunicata"}</dd>
    <dt>Precisione</dt><dd>${e.precisione === "comune" ? "Solo il comune" : "Punto indicato dalle fonti"}</dd><dt>Traffico</dt><dd>${e.traffico}</dd>
    <dt>Aggiornato</dt><dd class="fig">${dataOra(e.aggiornato)} · ${fa(e.aggiornato)}</dd></dl></section>
  <section class="card"><h3>Cronologia</h3><ol class="tl">${e.cronologia.map(([w, k, t]) => `<li><span class="w fig">${dataOra(w)}</span><span><b>${k}.</b> ${t}</span></li>`).join("")}</ol></section>
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
    const pad = desktop() ? { left: 60, top: 90, right: 60, bottom: 60 } : { top: 110, bottom: window.innerHeight * 0.58, left: 30, right: 30 };
    aggancia(e);
    map.flyTo({ center: e.lngLat, zoom: e.precisione === "comune" ? 10 : 11, pitch: desktop() ? 35 : 25, padding: pad, duration: calmo() ? 0 : MOTO.fly, curve: 1.3, essential: true });
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
  lock.style.transform = `translate(${p.x}px, ${p.y}px)`; lock.classList.toggle("flip", p.x > box.width - 250);
}
map.on("move", segui);

// ---------- impaginazione ----------
function collocaLoop() {
  const loop = $("#loop"), dest = desktop() ? $("#loop-slot-desk") : $("#loop-slot-mob");
  if (loop.parentElement !== dest) dest.appendChild(loop);
}
let eraDesk = desktop();
addEventListener("resize", () => {
  collocaLoop(); traccia(); segui();
  if (eraDesk !== desktop()) { eraDesk = desktop(); if (st.sel) apri(st.sel, false); else situazione(); }
});
function aggiorna() { ricarica(); situazione(); traccia(); }

collocaLoop();
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
