// ORACLE IT · variante "Radar": il radar meteo delle mobilitazioni.
// Tutti i dati sono di prova (src/data.ts, is_test = true).
import "./style.css";
import { EVENTI, ORA, type Evento, type Tipo, type FonteTipo } from "../../src/data";

declare const maplibregl: any;

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
const CENTRO_RADAR: [number, number] = [12.9, 41.7];
const H = 36e5;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const giorno = (d: string | number) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const ora = (d: string | number) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dataOra = (d: string | number) => `${giorno(d)} ${ora(d)}`;
const settimana = (d: number) => new Date(d).toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "");
const titolo = (e: Evento) => `${TIPI[e.tipo].label} a ${e.comune}`;
const desktop = () => matchMedia("(min-width: 1000px)").matches;
const calmo = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
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
function banda(v: number) { return v >= 0.7 ? { k: 3, label: "forte" } : v >= 0.45 ? { k: 2, label: "moderata" } : { k: 1, label: "debole" }; }
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

// ---------- tempo: 24 fotogrammi orari nel passato, 64 da 3 ore nel futuro ----------
const FOTO: number[] = [];
for (let i = 0; i <= 24; i++) FOTO.push(+ORA - (24 - i) * H);
for (let i = 1; i <= 64; i++) FOTO.push(+ORA + i * 3 * H);
const I_ORA = 24;
function finestra(e: Evento) {
  const a = +new Date(e.inizio);
  if (e.fine) return { a, b: +new Date(e.fine), aperta: false };
  if (e.stato === "in_corso") return { a, b: +ORA + 24 * H, aperta: true };
  return { a, b: a + 3 * H, aperta: false };
}
function peso(e: Evento, t: number) {
  const f = finestra(e);
  if (t < f.a || t > f.b) return 0;
  const decad = f.aperta && t > +ORA ? Math.max(0, 1 - (t - +ORA) / (24 * H)) : 1;
  return intensita(e) * decad;
}

// ---------- stato ----------
const st = { tipi: new Set<Tipo>(ORDINE_TIPI), i: I_ORA, sel: null as string | null, play: false, vista: "elenco" as "elenco" | "metodo" | "segnala" };
const filtrati = () => EVENTI.filter((e) => st.tipi.has(e.tipo));
const tempo = () => FOTO[st.i];
const futuro = () => st.i > I_ORA;
const attiviA = (t: number) => filtrati().filter((e) => peso(e, t) > 0).sort((a, b) => peso(b, t) - peso(a, t));

// ---------- testo che si decodifica ----------
const SEGNI = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/·";
function decodifica(el: Element, testo: string, durata = 240) {
  if (calmo()) { el.textContent = testo; return; }
  const t0 = performance.now();
  const passo = (t: number) => {
    const fatti = Math.floor(((t - t0) / durata) * testo.length);
    el.textContent = testo.split("").map((ch, k) => (k < fatti || ch === " " ? ch : SEGNI[(Math.random() * SEGNI.length) | 0])).join("");
    if (fatti < testo.length) requestAnimationFrame(passo); else el.textContent = testo;
  };
  requestAnimationFrame(passo);
}

// ---------- simboli: forma per tipo, pieno/vuoto per stato ----------
function forma(f: string, s = 7) {
  return f === "quadrato" ? `<rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}"/>` : f === "rombo" ? `<polygon points="0,${-s - 1.5} ${s + 1.5},0 0,${s + 1.5} ${-s - 1.5},0"/>`
    : f === "triangolo" ? `<polygon points="0,${-s - 1} ${s + .8},${s - .4} ${-s - .8},${s - .4}"/>` : `<circle r="${s}"/>`;
}
function simbolo(tipo: Tipo, v: string, size = 16) {
  const col = v === "concluso" ? "var(--concluso)" : "var(--ink)";
  const fill = v === "pieno" || v === "concluso" ? col : v === "discorde" ? "url(#mezzo)" : "none";
  return `<svg viewBox="-10 -10 20 20" width="${size}" height="${size}" aria-hidden="true"><defs><clipPath id="mezzo-c"><rect x="-10" y="-10" width="10" height="20"/></clipPath></defs>
    ${v === "discorde" ? `<g clip-path="url(#mezzo-c)" fill="${col}">${forma(TIPI[tipo].forma)}</g>` : ""}
    <g fill="${v === "discorde" ? "none" : fill}" stroke="${col}" stroke-width="2" ${v === "utenti" ? 'stroke-dasharray="2.6 2"' : ""}>${forma(TIPI[tipo].forma)}</g></svg>`;
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
  // alone scuro per leggere la forma sopra l'eco
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

// ---------- mappa: globo satellitare notturno ----------
const SATELLITE = {
  eox: { tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"], maxzoom: 15,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX IT Services GmbH</a> (dati Copernicus Sentinel 2020)' },
  esri: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], maxzoom: 18,
    attribution: "Immagini: Esri, Maxar, Earthstar Geographics" },
};
const map = new maplibregl.Map({
  container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#04070a" } }] },
  center: [12.6, 41.8], zoom: calmo() ? 5 : 2.2, minZoom: 1.6, maxZoom: 17.5, maxPitch: 60,
  attributionControl: { compact: true }, dragRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

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
map.on("error", (e: any) => {
  if (e?.sourceId === "satellite" && ++erroriSat === 4) map.getSource("satellite")?.setTiles?.(SATELLITE.esri.tiles);
  else console.warn("mappa:", e?.error?.message);
});
const padMappa = () => desktop() ? { top: 70, bottom: 30, left: 30, right: 30 } : { top: 70, bottom: 250, left: 12, right: 12 };
(async () => {
  map.once("style.load", () => setTimeout(() => {
    if (calmo()) { map.fitBounds(ITALIA, { padding: padMappa(), duration: 0 }); return; }
    map.fitBounds(ITALIA, { padding: padMappa(), duration: 1500, essential: true });
    map.once("moveend", scansione);
  }, 150));
  try {
    const r = await fetch("https://tiles.openfreemap.org/styles/liberty");
    if (!r.ok) throw new Error(String(r.status));
    map.setStyle(satellite(await r.json()));
  } catch {
    map.setStyle(satellite({ version: 8, sources: {}, layers: [] }));
  }
})();

// rivelazione degli echi durante la scansione (1 = visibile)
const rivelato: Record<string, number> = {};
let scansionato = calmo();

const RAMPA_OSS = ["step", ["heatmap-density"], "rgba(0,0,0,0)", 0.05, "rgba(18,96,104,0.38)", 0.2, "rgba(24,148,146,0.56)", 0.42, "rgba(72,212,186,0.74)", 0.66, "rgba(170,247,224,0.88)", 0.88, "rgba(240,255,251,0.96)"];
const RAMPA_PREV = ["step", ["heatmap-density"], "rgba(0,0,0,0)", 0.05, "rgba(36,62,112,0.38)", 0.2, "rgba(58,104,176,0.54)", 0.42, "rgba(110,160,228,0.7)", 0.66, "rgba(182,210,250,0.85)", 0.88, "rgba(236,244,255,0.94)"];

function geo() {
  const t = tempo(), ev = filtrati();
  return {
    punti: { type: "FeatureCollection", features: ev.map((e) => {
      const w = peso(e, t), r = rivelato[e.id] ?? (scansionato ? 1 : 0);
      const visibile = w > 0 || (st.i === I_ORA && e.stato === "annunciato" && +new Date(e.inizio) - +ORA < 3 * 864e5);
      return { type: "Feature", geometry: { type: "Point", coordinates: e.lngLat },
        properties: { id: e.id, w: w * Math.min(1, r), icon: `${e.tipo}-${variante(e)}`, nome: e.comune, op: visibile ? Math.min(1, r) : 0, sel: st.sel === e.id ? 1 : 0 } };
    }) },
    aree: { type: "FeatureCollection", features: ev.filter((e) => e.precisione === "comune" && (peso(e, t) > 0 || st.sel === e.id)).map((e) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [cerchio(e.lngLat, 3)] }, properties: {} })) },
    tratti: { type: "FeatureCollection", features: ev.filter((e) => e.tratto && (peso(e, t) > 0 || st.sel === e.id)).map((e) => ({ type: "Feature", geometry: { type: "LineString", coordinates: e.tratto }, properties: {} })) },
  };
}
map.on("style.load", () => {
  if (map.getSource("punti")) return;
  for (const t of ORDINE_TIPI) for (const v of ["pieno", "vuoto", "utenti", "concluso", "discorde"]) if (!map.hasImage(`${t}-${v}`)) map.addImage(`${t}-${v}`, icona(t, v), { pixelRatio: 2 });
  const d = geo();
  map.addSource("aree", { type: "geojson", data: d.aree }); map.addSource("tratti", { type: "geojson", data: d.tratti }); map.addSource("punti", { type: "geojson", data: d.punti });
  fetch("../../regioni.json").then((r) => r.json()).then((rg) => {
    map.addSource("regioni", { type: "geojson", data: rg });
    map.addLayer({ id: "regioni-line", type: "line", source: "regioni", paint: { "line-color": "rgba(200,232,226,.2)", "line-width": 0.6 } }, "eco");
  }).catch(() => {});
  map.addLayer({ id: "eco", type: "heatmap", source: "punti", maxzoom: 14, paint: {
    "heatmap-weight": ["get", "w"],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 2.2, 6, 3, 9, 2],
    "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 2, 11, 5, 36, 8, 120, 11, 300],
    "heatmap-color": RAMPA_OSS,
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 0.3],
  } });
  map.addLayer({ id: "aree-line", type: "line", source: "aree", minzoom: 8, paint: { "line-color": "#f1fbf8", "line-opacity": 0.7, "line-width": 1.2, "line-dasharray": [3, 3] } });
  map.addLayer({ id: "tratti", type: "line", source: "tratti", layout: { "line-join": "round" }, paint: { "line-color": "#f1fbf8", "line-width": 3, "line-dasharray": [2, 1] } });
  map.addLayer({ id: "icone", type: "symbol", source: "punti", layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.56, 7, 0.75, 10, 0.95, 14, 1.15], "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-opacity": ["get", "op"] } });
  if (map.getStyle().glyphs) map.addLayer({ id: "nomi", type: "symbol", source: "punti", minzoom: 5.4, filter: [">", ["get", "op"], 0.5],
    layout: { "text-field": ["get", "nome"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": "#f1fbf8", "text-halo-color": "#04070a", "text-halo-width": 1.5 } });
  map.on("click", (ev: any) => {
    const p = ev.point, f = map.queryRenderedFeatures([[p.x - 18, p.y - 18], [p.x + 18, p.y + 18]], { layers: ["icone"] }).filter((x: any) => x.properties.op > 0.5);
    if (f.length) apri(f[0].properties.id, false);
  });
  map.on("mousemove", (ev: any) => { const p = ev.point; map.getCanvas().style.cursor = map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: ["icone"] }).length ? "pointer" : ""; });
  aggiornaMappa();
});
function aggiornaMappa() {
  const d = geo();
  map.getSource("punti")?.setData(d.punti); map.getSource("aree")?.setData(d.aree); map.getSource("tratti")?.setData(d.tratti);
  if (map.getLayer("eco")) map.setPaintProperty("eco", "heatmap-color", futuro() ? RAMPA_PREV : RAMPA_OSS);
}

// ---------- scansione iniziale: il fascio del radar rivela gli echi ----------
const sweep = $("#sweep") as unknown as HTMLCanvasElement;
let scansioneViva = false;
function saltaScansione() {
  if (scansionato) return;
  scansioneViva = false; scansionato = true;
  for (const e of EVENTI) rivelato[e.id] = 1;
  sweep.getContext("2d")!.clearRect(0, 0, sweep.width, sweep.height); sweep.classList.remove("on");
  avvio.chiudi(); aggiornaMappa();
}
function scansione() {
  if (scansionato) return;
  const box = $("#mapbox"), dpr = Math.min(2, devicePixelRatio || 1);
  sweep.width = box.clientWidth * dpr; sweep.height = box.clientHeight * dpr; sweep.classList.add("on");
  const ctx = sweep.getContext("2d")!, DUR = 950, t0 = performance.now(), a0 = -Math.PI / 2, coda = 0.9;
  const visti = new Set<string>();
  scansioneViva = true;
  const passo = (now: number) => {
    if (!scansioneViva) return;
    const p = Math.min(1, (now - t0) / DUR), a = a0 + p * Math.PI * 2;
    const c = map.project(CENTRO_RADAR), cx = c.x * dpr, cy = c.y * dpr, R = Math.hypot(sweep.width, sweep.height);
    ctx.clearRect(0, 0, sweep.width, sweep.height);
    // anelli di distanza, solo durante la scansione
    ctx.strokeStyle = `rgba(150,240,214,${0.16 * (1 - p)})`; ctx.lineWidth = dpr; ctx.setLineDash([2 * dpr, 4 * dpr]);
    for (const k of [1, 2, 3, 4]) { ctx.beginPath(); ctx.arc(cx, cy, k * 110 * dpr, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    // fascio con scia
    const g = ctx.createConicGradient(a - coda, cx, cy);
    g.addColorStop(0, "rgba(97,232,198,0)"); g.addColorStop(coda / (Math.PI * 2), "rgba(97,232,198,0.2)"); g.addColorStop(coda / (Math.PI * 2) + 0.001, "rgba(97,232,198,0)"); g.addColorStop(1, "rgba(97,232,198,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - coda, a); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(190,255,236,.85)"; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
    // rivela gli echi appena il fascio li supera
    let cambiato = false;
    for (const e of EVENTI) {
      const q = map.project(e.lngLat);
      let b = Math.atan2(q.y - c.y, q.x - c.x) - a0; while (b < 0) b += Math.PI * 2;
      if (b <= a - a0 && !visti.has(e.id)) { visti.add(e.id); rivelato[e.id] = 0.001; cambiato = true; }
    }
    for (const id of visti) if (rivelato[id] < 1) { rivelato[id] = Math.min(1, rivelato[id] + 0.12); cambiato = true; }
    if (cambiato) aggiornaMappa();
    if (p < 1) requestAnimationFrame(passo);
    else { sweep.classList.remove("on"); setTimeout(() => ctx.clearRect(0, 0, sweep.width, sweep.height), 260); scansionato = true; scansioneViva = false; for (const e of EVENTI) rivelato[e.id] = 1; aggiornaMappa(); avvio.chiudi(); }
  };
  requestAnimationFrame(passo);
}

// ---------- avvio: tre righe che si decodificano, saltabili ----------
const avvio = (() => {
  const hud = $("#hud-time");
  const ev = EVENTI.length, fonti = EVENTI.reduce((a, e) => a + e.fonti.length, 0);
  const righe = [`ACQUISIZIONE ${fonti} FONTI · ${ev} EVENTI`, `SOGLIA DI PUBBLICAZIONE ${SOGLIA.toFixed(2)}`, "SCANSIONE ITALIA"];
  let chiuso = false;
  function chiudi() { if (chiuso) return; chiuso = true; document.body.classList.remove("booting"); orologio(true); }
  if (calmo()) { chiuso = true; return { chiudi }; }
  document.body.classList.add("booting");
  hud.innerHTML = `<div class="boot">${righe.map(() => `<span></span>`).join("")}</div>`;
  const spans = hud.querySelectorAll(".boot span");
  righe.forEach((r, k) => setTimeout(() => !chiuso && decodifica(spans[k], r, 220), k * 260));
  return { chiudi };
})();
for (const t of ["pointerdown", "keydown", "wheel"]) addEventListener(t, () => { if (!scansionato) saltaScansione(); }, { once: true, passive: true });

// ---------- orologio e anello del tempo ----------
function orologio(decod = false) {
  const t = tempo(), hud = $("#hud-time");
  if (document.body.classList.contains("booting")) return;
  const quando = `${settimana(t)} ${dataOra(t)}`.toUpperCase();
  const modo = st.i === I_ORA ? "Osservato · ora" : futuro() ? `Previsione · +${Math.round((t - +ORA) / H)} h` : `Osservato · −${Math.round((+ORA - t) / H)} h`;
  hud.innerHTML = `<span class="hud-when fig"></span><span class="hud-mode ${futuro() ? "prev" : ""}"><i></i>${modo}</span>`;
  const w = hud.querySelector(".hud-when")!;
  if (decod) decodifica(w, quando, 200); else w.textContent = quando;
  $("#loop-time").textContent = st.i === I_ORA ? `Ora · ${dataOra(t)}` : dataOra(t);
  $("#loop-mode").textContent = futuro() ? "Previsione da eventi annunciati" : st.i === I_ORA ? "Ultimo aggiornamento" : "Archivio osservato";
  $("#loop-mode").className = `loop-mode ${futuro() ? "prev" : ""}`;
  $("#now").hidden = st.i === I_ORA;
}
function traccia() {
  const box = $("#track-svg"), w = Math.max(240, box.clientWidth), h = desktop() ? 44 : 38, base = h - 12, n = FOTO.length;
  const x = (i: number) => 6 + (i / (n - 1)) * (w - 12);
  const somme = FOTO.map((t) => filtrati().reduce((a, e) => a + peso(e, t), 0)), max = Math.max(1, ...somme);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">`;
  const bw = Math.max(1.5, (w - 12) / n - 1.2);
  somme.forEach((v, i) => {
    if (v <= 0) return;
    const bh = Math.max(2, (v / max) * (base - 6));
    s += `<rect class="hb ${i > I_ORA ? "prev" : ""} ${i <= st.i ? "past" : ""}" x="${x(i) - bw / 2}" y="${base - bh}" width="${bw}" height="${bh}"/>`;
  });
  // mezzanotti
  const iDa = (t: number) => t <= +ORA ? (t - FOTO[0]) / H : I_ORA + (t - +ORA) / (3 * H);
  const d0 = new Date(FOTO[0]); d0.setHours(24, 0, 0, 0);
  let ultimo = -99;
  for (let t = +d0; t <= FOTO[n - 1]; t += 864e5) {
    const xx = x(iDa(t));
    s += `<line class="tk" x1="${xx}" x2="${xx}" y1="${base}" y2="${base + 4}"/>`;
    if (xx - ultimo > (desktop() ? 46 : 34) && Math.abs(xx - x(I_ORA)) > (desktop() ? 30 : 40)) { s += `<text class="tt" x="${xx}" y="${h - 1}" text-anchor="middle">${new Date(t).getDate()}/${new Date(t).getMonth() + 1}</text>`; ultimo = xx; }
  }
  s += `<line class="base" x1="6" x2="${w - 6}" y1="${base}" y2="${base}"/>`;
  s += `<line class="ora" x1="${x(I_ORA)}" x2="${x(I_ORA)}" y1="2" y2="${base + 4}"/><text class="tt ora" x="${x(I_ORA)}" y="${h - 1}" text-anchor="middle">ora</text>`;
  s += `<g class="thumb" transform="translate(${x(st.i)},0)"><line y1="0" y2="${base}"/><rect x="-4" y="${base - 4}" width="8" height="8" transform="rotate(45 0 ${base})"/></g>`;
  box.innerHTML = s + "</svg>";
}
const scrub = $("#scrub") as HTMLInputElement;
function vaiA(i: number, daUtente = true) {
  st.i = Math.max(0, Math.min(FOTO.length - 1, i));
  scrub.value = String(st.i);
  scrub.setAttribute("aria-valuetext", `${dataOra(tempo())}${futuro() ? ", previsione" : ""}`);
  if (daUtente && !scansionato) saltaScansione();
  aggiornaMappa(); orologio(); traccia(); elencoVivo();
}
scrub.addEventListener("input", () => { ferma(); vaiA(+scrub.value); });
$("#now").addEventListener("click", () => { ferma(); vaiA(I_ORA); });
let timer = 0;
function ferma() { st.play = false; clearTimeout(timer); $("#play").setAttribute("aria-pressed", "false"); $("#play").setAttribute("aria-label", "Avvia l'animazione"); }
function avvia() {
  st.play = true; $("#play").setAttribute("aria-pressed", "true"); $("#play").setAttribute("aria-label", "Metti in pausa l'animazione");
  if (st.i >= FOTO.length - 1 || st.i === I_ORA) vaiA(Math.max(0, FOTO.findIndex((t) => filtrati().some((e) => peso(e, t) > 0)) - 1), false);
  const passo = () => {
    if (!st.play) return;
    if (st.i >= FOTO.length - 1) { ferma(); return; }
    vaiA(st.i + 1, false);
    timer = window.setTimeout(passo, st.i < I_ORA ? 110 : 75);
  };
  timer = window.setTimeout(passo, 60);
}
$("#play").addEventListener("click", () => { if (!scansionato) saltaScansione(); st.play ? ferma() : avvia(); });
addEventListener("keydown", (ev) => {
  const t = ev.target as HTMLElement;
  if (ev.key === "Escape" && st.sel) chiudi();
  if (ev.key === " " && t === document.body) { ev.preventDefault(); st.play ? ferma() : avvia(); }
});

// ---------- pannello ----------
const body = $("#panel-body"), panel = $("#panel"), detail = $("#detail");
function barre(k: number) { return `<span class="bars b${k}" aria-hidden="true"><i></i><i></i><i></i></span>`; }
function riga(e: Evento, t: number) {
  const c = credibilita(e), w = peso(e, t), b = banda(w || intensita(e));
  const quando = w > 0 ? (e.stato === "in_corso" && t === +ORA ? `In corso da ${ora(e.inizio)}` : `Attivo, ${dataOra(e.inizio)}`) : `${STATI[e.stato]}, ${dataOra(e.inizio)}`;
  return `<button class="row" role="listitem" data-id="${e.id}" aria-current="${st.sel === e.id}">
    <span class="ic">${simbolo(e.tipo, variante(e), 16)}</span>
    <span class="t">${titolo(e)}</span>
    <span class="eco ${w > 0 ? "" : "off"}">${barre(w > 0 ? b.k : 0)}<span>${w > 0 ? `Eco ${b.label}` : "Nessuna eco"}</span></span>
    <span class="m"><span>${quando}</span><span class="pill ${c.cls}">${c.label}</span></span></button>`;
}
function scoperta(t: number) {
  const att = attiviA(t);
  const disc = att.find((e) => e.contraddittorio);
  const quando = st.i === I_ORA ? "Ora" : futuro() ? `Previsto per ${settimana(t)} ${dataOra(t)}` : `Alle ${ora(t)} del ${giorno(t)}`;
  if (!att.length) return `<p><b>${quando}</b>: nessuna eco con questi filtri.</p>`;
  const top = att[0], sud = att.filter((e) => ["Calabria", "Sicilia", "Puglia", "Campania", "Basilicata"].includes(e.regione)).length;
  return `<p><b>${quando}</b>: ${att.length} ${att.length === 1 ? "evento attivo" : "eventi attivi"}${sud ? (sud === att.length ? (att.length > 1 ? ", tutti al Sud" : ", al Sud") : `, ${sud} al Sud`) : ""}. Eco più forte: <button class="link" data-id="${top.id}">${titolo(top).toLowerCase()}</button>, ${credibilita(top).label.toLowerCase()}.${disc ? ` A ${disc.comune} le fonti sono discordanti.` : ""}</p>`;
}
let firmaElenco = "";
function elencoVivo() {
  const t = tempo(), ids = attiviA(t).map((e) => e.id).join(",") + "|" + st.i;
  if (st.vista !== "elenco" || (!desktop() && st.sel)) return;
  const f = $("#finding"); if (f) f.innerHTML = scoperta(t);
  const fig = $("#figures"); if (fig) fig.innerHTML = cifre(t);
  if (ids !== firmaElenco) { firmaElenco = ids; const l = $("#lista"); if (l) l.innerHTML = lista(t); }
}
function cifre(t: number) {
  const att = attiviA(t), forti = att.filter((e) => banda(peso(e, t)).k === 3).length;
  const ann = filtrati().filter((e) => e.stato === "annunciato" && +new Date(e.inizio) > t && +new Date(e.inizio) - t < 7 * 864e5).length;
  return `<div><span class="n fig">${att.length}</span><span class="l">Attivi</span></div><div><span class="n fig">${forti}</span><span class="l">Eco forte</span></div><div><span class="n fig">${ann}</span><span class="l">Annunciati, 7 g</span></div>`;
}
function lista(t: number) {
  const att = attiviA(t), resto = filtrati().filter((e) => !att.includes(e)).sort((a, b) => +new Date(a.inizio) - +new Date(b.inizio));
  return `${att.length ? `<h2>Attivi ${st.i === I_ORA ? "ora" : `il ${dataOra(t)}`} <span class="fig">${att.length}</span></h2><div class="list" role="list">${att.map((e) => riga(e, t)).join("")}</div>` : ""}
    ${resto.length ? `<h2>Altri nel periodo <span class="fig">${resto.length}</span></h2><div class="list" role="list">${resto.map((e) => riga(e, t)).join("")}</div>` : ""}
    ${!att.length && !resto.length ? `<p class="empty">Nessun evento con questi filtri. Riattiva un tipo.</p>` : ""}`;
}
function legenda() {
  return `<section class="legend" aria-label="Legenda">
    <div class="scale"><span class="sw s1"></span><span class="sw s2"></span><span class="sw s3"></span><span class="sw s4"></span><span class="sw s5"></span></div>
    <div class="scale-cap"><span>debole</span><span>moderata</span><span>forte</span></div>
    <p>L'eco cresce con la gravità del tipo e con la conferma delle fonti. Nel futuro l'eco diventa <b class="prevtxt">azzurra</b>: è una previsione dagli annunci.</p>
    <div class="shapes">${simbolo("blocco", "pieno", 13)} In corso ${simbolo("blocco", "vuoto", 13)} Annunciato ${simbolo("blocco", "utenti", 13)} Solo segnalazioni ${simbolo("blocco", "discorde", 13)} Discordante</div>
  </section>`;
}
function situazione() {
  const t = tempo();
  st.vista = "elenco"; firmaElenco = "";
  body.innerHTML = `
  <header class="title"><div class="title-row"><h1><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".6"/><path d="M12 12L19 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>ORACLE IT</h1><span class="test">Dati di prova</span></div>
    <p class="sub">Radar delle mobilitazioni in Italia. Eventi e fonti di questa pagina sono inventati.</p></header>
  <section class="finding" id="finding" aria-live="polite">${scoperta(t)}</section>
  <div class="figures" id="figures">${cifre(t)}</div>
  <div class="types" role="group" aria-label="Tipi di evento">${ORDINE_TIPI.map((k) => `<button class="type" data-tipo="${k}" aria-pressed="${st.tipi.has(k)}">${simbolo(k, "pieno", 13)}${TIPI[k].plur}</button>`).join("")}</div>
  <section class="block" id="lista">${lista(t)}</section>
  ${legenda()}
  <div class="foot"><button class="btn" data-vista="metodo">Come calcoliamo l'eco</button><button class="btn" data-vista="segnala">Segnala un evento</button></div>`;
  firmaElenco = attiviA(t).map((e) => e.id).join(",") + "|" + st.i;
}
function metodo(v: "metodo" | "segnala") {
  st.vista = v;
  const box = desktop() ? detail : body;
  if (desktop()) { detail.hidden = false; $("#app").classList.add("with-detail"); requestAnimationFrame(() => { map.resize(); traccia(); }); } else panel.dataset.state = "half";
  sgancia();
  box.innerHTML = v === "segnala"
    ? `<div class="d"><div class="d-top"><button class="back" data-back>← Indietro</button><span class="test">Dati di prova</span></div><header class="d-head"><h2>Segnala un evento</h2><p>Nel sito reale: posa il segnaposto sul punto, scegli tipo, ora e l'effetto sul traffico. Niente foto e niente testo libero pubblico.</p></header><section class="card"><h3>Prima di inviare</h3><p class="plain">Ti mostriamo gli eventi già noti vicino a te: se il tuo è uno di questi, basta confermarlo. Le sole segnalazioni producono un'eco tratteggiata, distinta da quelle con fonti.</p></section></div>`
    : `<div class="d"><div class="d-top"><button class="back" data-back>← Indietro</button><span class="test">Dati di prova</span></div><header class="d-head"><h2>Come calcoliamo l'eco</h2><p>Un evento diventa pubblico quando le fonti indipendenti superano la soglia di 0,80. L'eco sulla mappa è la gravità del tipo moltiplicata per la conferma delle fonti.</p></header>
      <section class="card"><h3>Gravità del tipo</h3><dl class="kv">${ORDINE_TIPI.map((k) => `<dt>${TIPI[k].label}</dt><dd class="fig">${TIPI[k].gravita.toFixed(2)}</dd>`).join("")}</dl></section>
      <section class="card"><h3>Peso delle fonti</h3><dl class="kv"><dt>Ente ufficiale</dt><dd class="fig">1.00</dd><dt>Agenzia di stampa</dt><dd class="fig">0.60</dd><dt>Testata</dt><dd class="fig">0.50</dd><dt>Promotori</dt><dd class="fig">0.30</dd><dt>Segnalazioni</dt><dd class="fig">fino a 0.60</dd><dt>Smentita</dt><dd class="fig">−0.60</dd></dl></section>
      <section class="card"><h3>Previsione</h3><p class="plain">Dopo l'ora attuale l'animazione mostra solo eventi annunciati da fonti, in azzurro. Un evento in corso senza fine comunicata sfuma nelle 24 ore successive.</p></section></div>`;
}
body.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button") as HTMLElement | null;
  if (!b) return;
  if (b.dataset.tipo) { const k = b.dataset.tipo as Tipo; if (st.tipi.has(k) && st.tipi.size > 1) st.tipi.delete(k); else st.tipi.add(k); aggiorna(); }
  else if (b.dataset.vista) metodo(b.dataset.vista as "metodo" | "segnala");
  else if (b.dataset.back !== undefined) chiudi();
  else if (b.dataset.id) apri(b.dataset.id, true);
});
detail.addEventListener("click", (ev) => { const b = (ev.target as HTMLElement).closest("button") as HTMLElement | null; if (b?.dataset.back !== undefined) chiudi(); });

function scheda(e: Evento) {
  const c = credibilita(e), pk = pacchetti(e), tot = pk.reduce((a, x) => a + x.w, 0), seg = 24, I = intensita(e), b = banda(I);
  const pieni = Math.round((Math.max(0, Math.min(Math.abs(tot), SCALA)) / SCALA) * seg);
  return `<div class="d">
  <div class="d-top"><button class="back" data-back>← Tutti gli eventi</button><span class="test">Dati di prova</span></div>
  <header class="d-head"><div class="d-sym">${simbolo(e.tipo, variante(e), 22)}<span class="fig">${e.id.toUpperCase()} · ${e.regione.toUpperCase()}</span></div><h2 class="dec">${titolo(e)}</h2><p>${e.luogo}</p>
    <div class="pills"><span class="pill neutral">${STATI[e.stato]}</span><span class="pill ${c.cls}">${c.label}</span><span class="pill neutral">${e.categoria}</span></div></header>
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
  <div class="acts">${e.stato !== "concluso" ? `<button class="btn primary" id="conf">Sono sul posto, confermo</button>` : ""}<button class="btn" id="err">Segnala un errore</button></div><div id="msg"></div></div>`;
}
function apri(id: string, daElenco: boolean) {
  if (!scansionato) saltaScansione();
  st.sel = id; st.vista = "elenco";
  const e = EVENTI.find((x) => x.id === id)!;
  if (desktop()) { detail.hidden = false; $("#app").classList.add("with-detail"); detail.innerHTML = scheda(e); detail.scrollTop = 0; situazione(); }
  else { body.innerHTML = scheda(e); body.scrollTop = 0; if (panel.dataset.state === "peek") panel.dataset.state = "half"; }
  const box = desktop() ? detail : body;
  const h = box.querySelector(".dec"); if (h) decodifica(h, h.textContent || "", 260);
  box.querySelector("#err")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale l'evento verrebbe nascosto in via cautelativa e verificato entro 48 ore. Qui non viene inviato nulla.</p>`));
  box.querySelector("#conf")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale la conferma conterebbe come segnalazione. Qui non viene inviato nulla.</p>`));
  aggiornaMappa();
  requestAnimationFrame(() => {
    map.resize(); traccia();
    const pad = desktop() ? { left: 60, top: 80, right: 60, bottom: 60 } : { top: 70, bottom: window.innerHeight * 0.55, left: 30, right: 30 };
    map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), e.precisione === "comune" ? 10.5 : 12.5), pitch: desktop() ? 40 : 30, padding: pad, duration: calmo() ? 0 : daElenco ? 1200 : 700, essential: true });
    aggancia(e);
  });
}
function chiudi() {
  st.sel = null; sgancia();
  detail.hidden = true; $("#app").classList.remove("with-detail");
  situazione(); aggiornaMappa();
  requestAnimationFrame(() => { map.resize(); traccia(); });
}

// ---------- aggancio: angoli che si stringono, eco che pulsa una volta, testo che si decodifica ----------
const lock = $("#lock"), tag = $("#lock-tag");
let preso: Evento | null = null;
function aggancia(e: Evento) {
  preso = e; lock.hidden = false; lock.classList.remove("on"); void lock.offsetWidth;
  requestAnimationFrame(() => lock.classList.add("on"));
  decodifica(tag, `${TIPI[e.tipo].label} · ${e.comune} · eco ${banda(intensita(e)).label}`.toUpperCase(), 240); segui();
}
function sgancia() { preso = null; lock.hidden = true; }
function segui() {
  if (!preso) return;
  const p = map.project(preso.lngLat), box = $("#mapbox").getBoundingClientRect();
  lock.style.transform = `translate(${p.x}px, ${p.y}px)`; lock.classList.toggle("flip", p.x > box.width - 240);
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
function aggiorna() { aggiornaMappa(); situazione(); traccia(); }

collocaLoop();
situazione();
orologio();
requestAnimationFrame(traccia);
scrub.setAttribute("aria-valuetext", dataOra(tempo()));
if (calmo()) { scansionato = true; for (const e of EVENTI) rivelato[e.id] = 1; }

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
console.assert(FOTO[I_ORA] === +ORA, "il fotogramma 'ora' deve coincidere con ORA");
