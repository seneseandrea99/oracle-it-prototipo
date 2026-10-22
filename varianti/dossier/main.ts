// Variante "Dossier": il briefing dell'analista. Cornice chiara tipografica, globo satellitare come tavola,
// annotazioni con linee di richiamo direttamente sulle immagini. Dati: src/data.ts (tutti inventati).
import "./style.css";
import { EVENTI, ORA, type Evento, type Tipo, type FonteTipo } from "../../src/data";

declare const maplibregl: any;

const ITALIA: [[number, number], [number, number]] = [[6.4, 36.4], [18.8, 47.1]];
const TIPI: Record<Tipo, { label: string; plur: string; forma: "quadrato" | "rombo" | "triangolo" | "cerchio" }> = {
  blocco: { label: "Blocco", plur: "Blocchi", forma: "quadrato" },
  presidio: { label: "Presidio", plur: "Presìdi", forma: "cerchio" },
  corteo: { label: "Corteo", plur: "Cortei", forma: "triangolo" },
  sciopero: { label: "Sciopero", plur: "Scioperi", forma: "rombo" },
};
const ORDINE_TIPI: Tipo[] = ["blocco", "presidio", "corteo", "sciopero"];
const STATI = { in_corso: "In corso", annunciato: "Annunciato", concluso: "Concluso" } as const;
const FONTE: Record<FonteTipo, string> = { ufficiale: "Ente ufficiale", agenzia: "Agenzia di stampa", testata: "Testata", parte: "Organizzazione promotrice" };
const PESO: Record<FonteTipo, number> = { ufficiale: 1, agenzia: 0.6, testata: 0.5, parte: 0.3 };
const SOGLIA = 0.8, SCALA = 1.2;
const MARK = "#ffe04a", INK = "#15171a", BIANCO = "#ffffff", SPENTO = "#a3a7ad";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const giorno = (d: string) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const ora = (d: string) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dataOra = (d: string) => `${giorno(d)} ${ora(d)}`;
const num = (n: number, d = 2) => n.toFixed(d).replace(".", ",").replace("-", "−");
const coord = ([lng, lat]: [number, number]) => `${num(lat, 3)}° N  ${num(lng, 3)}° E`;
function fa(d: string) {
  const m = Math.round((+ORA - +new Date(d)) / 60000);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h fa` : `${Math.round(h / 24)} g fa`;
}
const titolo = (e: Evento) => `${TIPI[e.tipo].label} a ${e.comune}`;
const desktop = () => matchMedia("(min-width: 1000px)").matches;
const calmo = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function credibilita(e: Evento) {
  if (e.contraddittorio) return { label: "Fonti discordanti", cls: "warn" };
  if (!e.fonti.length) return { label: `${e.segnalatori} segnalazioni, nessuna fonte`, cls: "user" };
  if (e.fonti.some((f) => f.tipo === "ufficiale")) return { label: "Comunicato ufficiale", cls: "cred" };
  const n = e.fonti.filter((f) => !f.smentisce).length;
  return { label: n === 1 ? "1 fonte" : `${n} fonti indipendenti`, cls: "cred" };
}
function pacchetti(e: Evento) {
  const r = e.fonti.map((f) => ({ nome: f.nome, tipo: FONTE[f.tipo] + (f.smentisce ? ", smentisce" : f.annuncio ? ", annuncio" : ""), quando: dataOra(f.pubblicata),
    w: f.smentisce ? -0.6 : f.tipo === "parte" && f.annuncio ? 0.6 : PESO[f.tipo] }));
  if (e.segnalatori) {
    let u = 0;
    for (let i = 0; i < e.segnalatori; i++) u += 0.1 * Math.pow(0.85, i);
    r.push({ nome: `${e.segnalatori} segnalatori diversi`, tipo: "Segnalazioni anonime, peso decrescente", quando: dataOra(e.aggiornato), w: Math.min(0.6, +u.toFixed(2)) });
  }
  return r;
}
function variante(e: Evento) {
  if (e.stato === "concluso") return "concluso";
  if (!e.fonti.length) return "utenti";
  return e.stato === "annunciato" ? "vuoto" : "pieno";
}

// simboli: forma per tipo, pieno/vuoto per stato, tratteggio per sole segnalazioni
function forma(f: string, s = 6.5) {
  return f === "quadrato" ? `<rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}"/>` : f === "rombo" ? `<polygon points="0,${-s - 1.5} ${s + 1.5},0 0,${s + 1.5} ${-s - 1.5},0"/>`
    : f === "triangolo" ? `<polygon points="0,${-s - 1} ${s + .8},${s - .2} ${-s - .8},${s - .2}"/>` : `<circle r="${s}"/>`;
}
// su carta: pieno = evidenziatore giallo con bordo inchiostro, vuoto = solo bordo, tratteggio = segnalazioni, grigio = concluso
function simbolo(tipo: Tipo, v: string, size = 16) {
  const fill = v === "pieno" ? MARK : v === "concluso" ? SPENTO : "none", stroke = v === "concluso" ? SPENTO : INK;
  return `<svg viewBox="-10 -10 20 20" width="${size}" height="${size}" aria-hidden="true"><g fill="${fill}" stroke="${stroke}" stroke-width="1.8" ${v === "utenti" ? 'stroke-dasharray="2.6 2"' : ""}>${forma(TIPI[tipo].forma)}</g></svg>`;
}
function percorso(ctx: CanvasRenderingContext2D, f: string, c: number, r: number) {
  ctx.beginPath();
  if (f === "quadrato") ctx.rect(c - r * 0.8, c - r * 0.8, r * 1.6, r * 1.6);
  else if (f === "rombo") { ctx.moveTo(c, c - r * 1.05); ctx.lineTo(c + r * 1.05, c); ctx.lineTo(c, c + r * 1.05); ctx.lineTo(c - r * 1.05, c); ctx.closePath(); }
  else if (f === "triangolo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r * 0.95, c + r * 0.72); ctx.lineTo(c - r * 0.95, c + r * 0.72); ctx.closePath(); }
  else ctx.arc(c, c, r * 0.84, 0, Math.PI * 2);
}
// sulle immagini: stessa grammatica, ma bordo bianco su alone scuro per leggersi su qualsiasi suolo
function icona(tipo: Tipo, v: string, px = 64) {
  const cv = document.createElement("canvas"); cv.width = cv.height = px;
  const ctx = cv.getContext("2d")!, c = px / 2, r = px * (v === "concluso" ? 0.2 : 0.27);
  ctx.lineJoin = "round";
  percorso(ctx, TIPI[tipo].forma, c, r);
  ctx.lineWidth = px * 0.16; ctx.strokeStyle = "rgba(8,10,12,.55)"; ctx.stroke();
  if (v === "pieno") { ctx.fillStyle = MARK; ctx.fill(); }
  if (v === "concluso") { ctx.fillStyle = SPENTO; ctx.fill(); }
  if (v === "vuoto" || v === "utenti") { ctx.fillStyle = "rgba(8,10,12,.35)"; ctx.fill(); }
  ctx.lineWidth = px * 0.055; ctx.strokeStyle = v === "pieno" ? INK : v === "concluso" ? "#2a2d31" : BIANCO;
  if (v === "utenti") ctx.setLineDash([px * 0.07, px * 0.05]);
  ctx.stroke();
  return ctx.getImageData(0, 0, px, px);
}
function cerchio([lng, lat]: [number, number], km: number) {
  const p: [number, number][] = [];
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; p.push([lng + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 110.57) * Math.sin(a)]); }
  return p;
}

// stato
const st = { tipi: new Set<Tipo>(ORDINE_TIPI), quando: "tutto" as "tutto" | "ora" | "7g", nazionale: false, sel: null as string | null };
const filtrati = () => EVENTI.filter((e) => st.tipi.has(e.tipo)
  && (st.quando === "tutto" || (st.quando === "ora" ? e.stato === "in_corso" : e.stato !== "concluso" && +new Date(e.inizio) - +ORA < 7 * 864e5))
  && (!st.nazionale || e.nazionale));

// la tavola: globo con immagini satellitari, sopra solo strade, confini e nomi
const SATELLITE = {
  eox: { tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"], maxzoom: 15,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX IT Services GmbH</a> (dati Copernicus Sentinel 2020)' },
  esri: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], maxzoom: 18,
    attribution: "Immagini: Esri, Maxar, Earthstar Geographics" },
};
const map = new maplibregl.Map({
  container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0d10" } }] },
  center: [12.6, 41.8], zoom: calmo() ? 5 : 2.3, minZoom: 1.6, maxZoom: 17.5, maxPitch: 60,
  attributionControl: { compact: true }, dragRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

function satellite(style: any) {
  const strade = ["match", ["get", "class"], ["motorway"], "rgba(255,246,214,.6)", ["trunk", "primary"], "rgba(255,255,255,.38)", ["secondary", "tertiary"], "rgba(255,255,255,.2)", "rgba(255,255,255,.1)"];
  const tenute = style.layers.filter((l: any) => {
    const id = String(l.id), sl = String(l["source-layer"] || "");
    if (l.type === "line" && sl === "transportation") { l.paint = { ...(l.paint || {}), "line-color": strade }; delete l.paint["line-gradient"]; delete l.paint["line-dasharray"]; return !/casing|tunnel|rail|path|ferry/.test(id); }
    if (l.type === "line" && sl === "boundary") { l.paint = { ...(l.paint || {}), "line-color": "rgba(255,255,255,.5)" }; return true; }
    if (l.type === "symbol" && /place|city|town|village|capital|state|country/.test(id)) {
      l.paint = { ...(l.paint || {}), "text-color": "rgba(255,255,255,.86)", "text-halo-color": "rgba(0,0,0,.8)", "text-halo-width": 1.3, "icon-opacity": 0 };
      return true;
    }
    return false;
  });
  style.sources.satellite = { type: "raster", tileSize: 256, ...SATELLITE.eox };
  style.layers = [
    { id: "spazio", type: "background", paint: { "background-color": "#0b0d10" } },
    { id: "satellite", type: "raster", source: "satellite", paint: { "raster-brightness-max": 0.72, "raster-saturation": -0.45, "raster-contrast": 0.12, "raster-fade-duration": 200 } },
    ...tenute,
  ];
  style.projection = { type: "globe" };
  style.sky = { "sky-color": "#0d1a26", "horizon-color": "#9fb6c9", "fog-color": "#0b0d10", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.35,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 0.9, 8, 0] };
  return style;
}
let erroriSat = 0;
map.on("error", (e: any) => {
  if (e?.sourceId === "satellite" && ++erroriSat === 4) { const src = map.getSource("satellite"); src?.setTiles?.(SATELLITE.esri.tiles); }
  else if (e?.sourceId === "satellite" && erroriSat > 30) $("#maperr").hidden = false;
  else console.warn("mappa:", e?.error?.message);
});
function paddingVista() {
  if (desktop()) return { top: 50, bottom: 50, left: 50, right: 50 };
  return { top: 30, bottom: Math.max(60, window.innerHeight - brief.getBoundingClientRect().top + 10), left: 20, right: 20 };
}
// inquadratura dell'Italia calcolata in Mercatore: fitBounds sul globo a basso zoom sbaglia di qualche decimo
function inquadra(durata: number) {
  const pad = paddingVista(), c = map.getContainer(), W = c.clientWidth - pad.left - pad.right, H = c.clientHeight - pad.top - pad.bottom;
  const mx = (lng: number) => ((lng + 180) / 360) * 512, my = (lat: number) => (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)) * 512;
  const [[w, s], [e, n]] = ITALIA, zoom = Math.log2(Math.min(W / (mx(e) - mx(w)), H / (my(s) - my(n)))) - 0.05;
  const cy = (my(s) + my(n)) / 2, lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / 512))) * 180) / Math.PI;
  map.flyTo({ center: [(w + e) / 2, lat], zoom, pitch: 0, padding: pad, duration: durata, essential: true });
}
(async () => {
  map.once("style.load", () => {
    map.once("idle", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    setTimeout(() => inquadra(calmo() ? 0 : 2400), calmo() ? 0 : 350);
  });
  try {
    const r = await fetch("https://tiles.openfreemap.org/styles/liberty");
    if (!r.ok) throw new Error(String(r.status));
    map.setStyle(satellite(await r.json()));
  } catch {
    map.setStyle(satellite({ version: 8, sources: {}, layers: [] }));
  }
})();

function geo() {
  const ev = filtrati();
  return {
    punti: { type: "FeatureCollection", features: ev.map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: e.lngLat }, properties: { id: e.id, icon: `${e.tipo}-${variante(e)}`, attivo: e.stato === "in_corso" ? 1 : 0 } })) },
    aree: { type: "FeatureCollection", features: ev.filter((e) => e.precisione === "comune").map((e) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [cerchio(e.lngLat, 3)] }, properties: {} })) },
    tratti: { type: "FeatureCollection", features: ev.filter((e) => e.tratto).map((e) => ({ type: "Feature", geometry: { type: "LineString", coordinates: e.tratto }, properties: {} })) },
  };
}
let regioniGeo: any = null;
function attiveRegioni() { const l = filtrati().filter((e) => e.stato === "in_corso"); return { ...regioniGeo, features: regioniGeo.features.map((f: any) => ({ ...f, properties: { ...f.properties, n: l.filter((e) => e.regione === f.properties.regione).length } })) }; }
let pronta = false;
map.on("style.load", () => {
  if (map.getSource("punti")) return;
  for (const t of ORDINE_TIPI) for (const v of ["pieno", "vuoto", "utenti", "concluso"]) if (!map.hasImage(`${t}-${v}`)) map.addImage(`${t}-${v}`, icona(t, v), { pixelRatio: 2 });
  const d = geo();
  map.addSource("aree", { type: "geojson", data: d.aree }); map.addSource("tratti", { type: "geojson", data: d.tratti }); map.addSource("punti", { type: "geojson", data: d.punti });
  // regioni: nessun riempimento, solo un contorno più marcato dove c'è qualcosa in corso
  fetch("../../regioni.json").then((r) => r.json()).then((rg) => {
    regioniGeo = rg; map.addSource("regioni", { type: "geojson", data: attiveRegioni() });
    map.addLayer({ id: "regioni-line", type: "line", source: "regioni", paint: { "line-color": ["case", [">", ["get", "n"], 0], "rgba(255,224,74,.75)", "rgba(255,255,255,.18)"], "line-width": ["case", [">", ["get", "n"], 0], 1.2, 0.6], "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 0.3] } }, "aree-fill");
  }).catch(() => {});
  map.addLayer({ id: "aree-fill", type: "fill", source: "aree", paint: { "fill-color": "#ffffff", "fill-opacity": 0.06 } });
  map.addLayer({ id: "aree-line", type: "line", source: "aree", paint: { "line-color": "#ffffff", "line-opacity": 0.8, "line-width": 1, "line-dasharray": [3, 3] } });
  map.addLayer({ id: "tratti-alone", type: "line", source: "tratti", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "rgba(8,10,12,.6)", "line-width": 7 } });
  map.addLayer({ id: "tratti", type: "line", source: "tratti", layout: { "line-join": "round" }, paint: { "line-color": MARK, "line-width": 3, "line-dasharray": [2, 1] } });
  map.addLayer({ id: "onda", type: "circle", source: "punti", filter: ["==", ["get", "attivo"], 1], paint: { "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": MARK, "circle-stroke-width": 1, "circle-stroke-opacity": 0.5, "circle-pitch-alignment": "map" } });
  map.addLayer({ id: "icone", type: "symbol", source: "punti", layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 9, 1, 14, 1.2], "icon-allow-overlap": true } });
  map.on("click", "icone", (ev: any) => apri(ev.features[0].properties.id, false));
  map.on("mouseenter", "icone", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "icone", () => (map.getCanvas().style.cursor = ""));
  if (!calmo()) { const t0 = performance.now(); const step = (t: number) => { const p = ((t - t0) % 2800) / 2800; if (map.getLayer("onda")) { map.setPaintProperty("onda", "circle-radius", 12 + p * 22); map.setPaintProperty("onda", "circle-stroke-opacity", 0.55 * (1 - p)); } requestAnimationFrame(step); }; requestAnimationFrame(step); }
  pronta = true; annota();
});
function aggiornaMappa() { if (regioniGeo) map.getSource("regioni")?.setData(attiveRegioni()); const d = geo(); map.getSource("punti")?.setData(d.punti); map.getSource("aree")?.setData(d.aree); map.getSource("tratti")?.setData(d.tratti); annota(); }

// ---- annotazioni sulla tavola: etichette tipografiche con linea di richiamo, posate senza sovrapporsi ----
const plate = $("#plate"), annBox = $("#ann"), annLines = document.getElementById("ann-lines")!, readout = $("#readout");
const etichette = new Map<string, HTMLButtonElement>();
const visti = new Set<string>();
const SEGNI = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function decodifica(el: HTMLElement, testo: string, durata = 220) {
  if (calmo()) { el.textContent = testo; return; }
  const t0 = performance.now();
  const passo = (t: number) => {
    const fatti = Math.floor(((t - t0) / durata) * testo.length);
    el.textContent = testo.split("").map((ch, k) => (k < fatti || ch === " " || ch === "·" ? ch : SEGNI[(Math.random() * SEGNI.length) | 0])).join("");
    if (fatti < testo.length) requestAnimationFrame(passo); else el.textContent = testo;
  };
  requestAnimationFrame(passo);
}
function rigaStato(e: Evento) {
  if (e.stato === "in_corso") return `In corso dalle ${ora(e.inizio)}`;
  if (e.stato === "annunciato") return `Annunciato per il ${giorno(e.inizio)}`;
  return `Concluso il ${giorno(e.fine ?? e.inizio)}`;
}
function contenuto(e: Evento, sel: boolean) {
  const c = credibilita(e);
  const dove = e.precisione === "esatta" ? coord(e.lngLat) : `Area del comune, punto non preciso`;
  return `<span class="a-t">${titolo(e)}</span><span class="a-s">${rigaStato(e)} · ${c.label}</span>${sel ? `<span class="a-c fig">${dove}</span>` : ""}`;
}
function etichetta(e: Evento) {
  let el = etichette.get(e.id);
  if (!el) {
    el = document.createElement("button"); el.className = "a"; el.dataset.id = e.id;
    el.addEventListener("click", () => apri(e.id, false));
    annBox.appendChild(el); etichette.set(e.id, el);
  }
  const sel = st.sel === e.id, chiave = `${sel}`;
  if (el.dataset.k !== chiave) { el.innerHTML = contenuto(e, sel); el.dataset.k = chiave; el.classList.toggle("sel", sel); el.setAttribute("aria-label", `${titolo(e)}, ${STATI[e.stato]}`); }
  return el;
}
type R = { x: number; y: number; w: number; h: number };
const tocca = (a: R, b: R, m = 6) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
let rafAnn = 0;
function annota() { if (!rafAnn) rafAnn = requestAnimationFrame(() => { rafAnn = 0; posa(); }); }
function posa() {
  const W = plate.clientWidth, H = plate.clientHeight;
  const z = map.getZoom(), c = map.getCenter();
  readout.textContent = `${num(c.lat, 2)}° N  ${num(c.lng, 2)}° E  ·  Z ${num(z, 1)}`;
  if (!pronta || z < 3.8) { annBox.querySelectorAll(".a").forEach((a) => ((a as HTMLElement).hidden = true)); annLines.innerHTML = ""; return; }
  const ev = filtrati();
  const ordine = { in_corso: 0, annunciato: 1, concluso: 2 };
  const pri = [...ev].sort((a, b) => (b.id === st.sel ? 1 : 0) - (a.id === st.sel ? 1 : 0) || ordine[a.stato] - ordine[b.stato] || +new Date(b.aggiornato) - +new Date(a.aggiornato));
  const bassoLibero = desktop() ? H : Math.min(H, brief.getBoundingClientRect().top - plate.getBoundingClientRect().top);
  const area = { top: 40, left: 8, right: W - (desktop() ? 56 : 52), bottom: bassoLibero - 30 };
  const pts = new Map(ev.map((e) => [e.id, map.project(e.lngLat) as { x: number; y: number }]));
  const ostacoli: R[] = [...pts.values()].map((p) => ({ x: p.x - 9, y: p.y - 9, w: 18, h: 18 }));
  const posati: R[] = [];
  const max = desktop() ? 9 : 4;
  let linee = "", n = 0;
  for (const e of pri) {
    const el = etichetta(e), p = pts.get(e.id)!, sel = e.id === st.sel;
    const back = map.unproject([p.x, p.y]), fedele = Math.abs(back.lng - e.lngLat[0]) + Math.abs(back.lat - e.lngLat[1]) < 0.05;
    const dentro = fedele && p.x > 4 && p.x < W - 4 && p.y > area.top - 6 && p.y < area.bottom + 20;
    if (!dentro || (!sel && n >= max)) { el.hidden = true; continue; }
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    const cand: [number, number][] = [[26, -30], [-26 - w, -30], [26, 26], [-26 - w, 26], [44, -64], [-44 - w, -64], [44, 60], [-44 - w, 60], [70, -4], [-70 - w, -4], [20, -96], [-20 - w, -96]];
    let r: R | null = null;
    for (const [dx, dy] of cand) {
      const q = { x: p.x + dx, y: p.y + dy - h / 2, w, h };
      if (q.x < area.left || q.x + w > area.right || q.y < area.top || q.y + h > area.bottom) continue;
      if (posati.some((o) => tocca(o, q)) || ostacoli.some((o) => tocca(o, q, 2))) continue;
      r = q; break;
    }
    if (!r && sel) { const dx = p.x + 26 + w < area.right ? 26 : -26 - w; r = { x: Math.max(area.left, Math.min(area.right - w, p.x + dx)), y: Math.max(area.top, Math.min(area.bottom - h, p.y - 30 - h / 2)), w, h }; }
    if (!r) { el.hidden = true; continue; }
    posati.push(r); n++;
    el.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
    if (!visti.has(e.id)) { visti.add(e.id); el.classList.remove("in"); void el.offsetWidth; el.classList.add("in"); const t = el.querySelector(".a-t") as HTMLElement; decodifica(t, titolo(e), 200); }
    // linea di richiamo: dal segno al bordo dell'etichetta, con un gomito orizzontale di 10 px
    const destra = r.x > p.x, ex = destra ? r.x : r.x + w, ey = Math.round(r.y + 14), gx = destra ? ex - 10 : ex + 10;
    const ang = Math.atan2(ey - p.y, gx - p.x), sx = p.x + Math.cos(ang) * 10, sy = p.y + Math.sin(ang) * 10;
    linee += `<polyline class="${sel ? "sel" : ""}" points="${sx.toFixed(1)},${sy.toFixed(1)} ${gx},${ey} ${ex},${ey}"/><circle class="${sel ? "sel" : ""}" cx="${ex}" cy="${ey}" r="2"/>`;
  }
  annLines.innerHTML = linee;
}
map.on("move", () => { annota(); segui(); });
map.on("moveend", () => { visti.clear(); [...etichette.values()].forEach((el) => !el.hidden && visti.add(el.dataset.id!)); });

// ---- linea del tempo: le ultime 24 ore occupano il 30% a sinistra, i prossimi 8 giorni il resto ----
const T0 = +ORA - 24 * 36e5, T1 = +ORA + 8 * 864e5;
function striscia(w: number) {
  const stretto = w < 600, padL = stretto ? 24 : 70, padR = 8, lane = 18, top = 22, h = top + ORDINE_TIPI.length * lane + 4, now = padL + (w - padL - padR) * 0.3;
  const x = (t: number) => t <= +ORA ? padL + ((t - T0) / (+ORA - T0)) * (now - padL) : now + ((t - +ORA) / (T1 - +ORA)) * (w - padR - now);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="group" aria-label="Eventi nel tempo">`;
  const occ: number[] = [now];
  const libera = (xx: number) => occ.every((q) => Math.abs(q - xx) > 40) && (occ.push(xx), true);
  for (const [t, lab] of [[T0, "−24 h"], [+ORA - 12 * 36e5, "−12 h"]] as [number, string][]) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="16" y2="${h}" class="grid"/>`;
    if (libera(x(t) + (t === T0 ? 18 : 0))) s += `<text class="tick" x="${x(t)}" y="11" text-anchor="${t === T0 ? "start" : "middle"}">${lab}</text>`;
  }
  for (let dd = 1; dd <= 8; dd++) {
    const t = new Date(ORA); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + dd);
    if (+t > T1) break;
    s += `<line x1="${x(+t)}" x2="${x(+t)}" y1="16" y2="${h}" class="grid"/>`;
    if (libera(x(+t))) s += `<text class="tick" x="${x(+t)}" y="11" text-anchor="middle">${t.getDate()}/${t.getMonth() + 1}</text>`;
  }
  s += `<line x1="${now}" x2="${now}" y1="14" y2="${h}" class="now"/><text class="tick now" x="${now}" y="11" text-anchor="middle">ora</text>`;
  ORDINE_TIPI.forEach((t, i) => (s += stretto ? `<g transform="translate(8,${top + i * lane + 8}) scale(.62)" fill="none" stroke="${INK}" stroke-width="2"><title>${TIPI[t].plur}</title>${forma(TIPI[t].forma)}</g>` : `<text class="tick lane" x="0" y="${top + i * lane + 12}">${TIPI[t].plur}</text>`));
  for (const e of filtrati()) {
    if (+new Date(e.fine ?? e.inizio) < T0 && e.stato !== "in_corso") continue;
    const i = ORDINE_TIPI.indexOf(e.tipo), y = top + i * lane + 8;
    const a = Math.max(+new Date(e.inizio), T0), b = Math.min(e.fine ? +new Date(e.fine) : e.stato === "in_corso" ? +ORA : +new Date(e.inizio), T1);
    const xa = x(a), xb = Math.max(x(b), xa), v = variante(e);
    const fill = v === "pieno" ? MARK : v === "concluso" ? SPENTO : "#fafaf8", stroke = v === "concluso" ? SPENTO : INK;
    s += `<g class="mk ${st.sel === e.id ? "sel" : ""}" data-id="${e.id}" tabindex="0" role="button" aria-label="${titolo(e)}, ${STATI[e.stato]}, ${dataOra(e.inizio)}">
      <rect class="hit" x="${xa - 9}" y="${y - 9}" width="${xb - xa + 18}" height="18" rx="2" fill="transparent"/>
      ${xb - xa > 2 ? `<line x1="${xa}" x2="${xb}" y1="${y}" y2="${y}" stroke="${v === "pieno" ? INK : stroke}" stroke-width="${v === "pieno" ? 3 : 1.5}" ${v === "utenti" ? 'stroke-dasharray="3 2"' : ""}/>` : ""}
      <g transform="translate(${xa},${y}) scale(.72)" fill="${fill}" stroke="${stroke}" stroke-width="2.2" ${v === "utenti" ? 'stroke-dasharray="2.5 2"' : ""}>${forma(TIPI[e.tipo].forma)}</g></g>`;
  }
  return s + "</svg>";
}
function disegnaStrisce() {
  const desk = $("#strip-desk"), mob = document.getElementById("strip-mob");
  if (desktop()) desk.innerHTML = striscia(Math.max(320, desk.clientWidth));
  else if (mob) mob.innerHTML = striscia(Math.max(300, mob.clientWidth));
}
document.addEventListener("click", (ev) => { const m = (ev.target as Element).closest?.(".mk") as HTMLElement | null; if (m) apri(m.dataset.id!, true); });
document.addEventListener("keydown", (ev) => { const m = (ev.target as Element).closest?.(".mk") as HTMLElement | null; if (m && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); apri(m.dataset.id!, true); } });

// ---- il briefing ----
const briefBody = $("#brief-body"), brief = $("#brief"), detail = $("#detail");
let primaVolta = true;
function situazione() {
  const l = filtrati(), ord = { in_corso: 0, annunciato: 1, concluso: 2 };
  const attivi = l.filter((e) => e.stato === "in_corso"), blocchi = attivi.filter((e) => e.tipo === "blocco"), disc = l.find((e) => e.contraddittorio);
  const annunciati = l.filter((e) => e.stato === "annunciato"), soloUtenti = l.filter((e) => !e.fonti.length);
  const righe = [...l].sort((a, b) => ord[a.stato] - ord[b.stato] || +new Date(b.aggiornato) - +new Date(a.aggiornato));
  const lede = blocchi.length
    ? `<mark>${blocchi.length === 1 ? "Un blocco portuale in corso" : `${blocchi.length === 2 ? "Due" : blocchi.length} blocchi portuali in corso`}</mark> al Sud, a ${blocchi.map((e) => e.comune).join(" e ")}.${disc ? ` Su ${disc.comune} le fonti si contraddicono.` : ""}`
    : attivi.length ? `<mark>${attivi.length} eventi in corso</mark>, nessun blocco.` : "Nessun evento in corso con questi filtri.";
  const red = primaVolta && !calmo() ? "redact" : "";
  briefBody.innerHTML = `
  <section class="lede-box" aria-label="In sintesi">
    <p class="lede ${red}" style="--d:0">${lede}</p>
    ${disc ? `<button class="link ${red}" style="--d:1" data-apri="${disc.id}">Leggi le fonti su ${disc.comune}</button>` : ""}
  </section>
  <dl class="figures ${red}" style="--d:2">
    <div><dt>In corso</dt><dd class="fig">${attivi.length}</dd></div>
    <div><dt>Annunciati</dt><dd class="fig">${annunciati.length}</dd></div>
    <div><dt>Solo segnalazioni</dt><dd class="fig">${soloUtenti.length}</dd></div>
  </dl>
  <section class="strip mob-only" aria-label="Linea del tempo"><div class="strip-head"><h2>Ultime 24 ore e prossimi 8 giorni</h2></div><div class="strip-svg" id="strip-mob"></div></section>
  <div class="filters ${red}" style="--d:3">
    <div class="seg" role="group" aria-label="Periodo">${([["tutto", "Tutto"], ["ora", "In corso"], ["7g", "Prossimi 7 giorni"]] as const).map(([k, t]) => `<button data-quando="${k}" aria-pressed="${st.quando === k}">${t}</button>`).join("")}</div>
    <div class="types" role="group" aria-label="Tipi di evento">${ORDINE_TIPI.map((t) => `<button class="type" data-tipo="${t}" aria-pressed="${st.tipi.has(t)}">${simbolo(t, "vuoto", 14)}${TIPI[t].plur}</button>`).join("")}</div>
  </div>
  <button class="mob" id="naz" aria-pressed="${st.nazionale}"><span class="t">Sciopero nazionale dei trasporti, 30/10</span><span class="s">Riguarda tutta Italia, quindi non ha un punto sulla tavola. ${st.nazionale ? "Tocca per tornare a tutti gli eventi." : "Tocca per vedere i 2 eventi locali collegati."}</span></button>
  <section class="entries" aria-label="Eventi"><h2>${l.length === 1 ? "1 evento" : `${l.length} eventi`} nel briefing</h2>
    <div class="list" role="list">${righe.length ? righe.map((e, i) => { const c = credibilita(e); return `<button class="row ${red}" style="--d:${4 + Math.min(i, 6) * 0.5}" role="listitem" data-id="${e.id}" aria-current="${st.sel === e.id}">
      <span class="ic">${simbolo(e.tipo, variante(e), 18)}</span><span class="t">${titolo(e)}</span><span class="w fig">${fa(e.aggiornato)}</span>
      <span class="m"><span>${STATI[e.stato]} · ${e.stato === "annunciato" ? giorno(e.inizio) : e.regione}</span><span class="pill ${c.cls}">${c.label}</span></span></button>`; }).join("") : `<p class="empty">Nessun evento con questi filtri. Scegli "Tutto" o riattiva un tipo.</p>`}</div></section>
  <nav class="mob-only foot-nav" aria-label="Altre sezioni"><button class="link" data-vista="metodo">Come decidiamo cosa mostrare</button><button class="link" data-vista="segnala">Segnala un evento</button></nav>`;
  primaVolta = false;
}
briefBody.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button") as HTMLElement | null;
  if (!b) return;
  if (b.dataset.quando) { st.quando = b.dataset.quando as typeof st.quando; aggiorna(); }
  else if (b.dataset.tipo) { const k = b.dataset.tipo as Tipo; if (st.tipi.has(k) && st.tipi.size > 1) st.tipi.delete(k); else st.tipi.add(k); aggiorna(); }
  else if (b.id === "naz") { st.nazionale = !st.nazionale; aggiorna(); }
  else if (b.dataset.apri) apri(b.dataset.apri, true);
  else if (b.dataset.id) apri(b.dataset.id, true);
  else if (b.dataset.back !== undefined) chiudi();
});
detail.addEventListener("click", (ev) => { const b = (ev.target as HTMLElement).closest("button") as HTMLElement | null; if (b?.dataset.back !== undefined) chiudi(); });

// la prova: il saldo delle fonti su un righello, con la soglia segnata
function prova(e: Evento) {
  const pk = pacchetti(e), tot = pk.reduce((a, x) => a + x.w, 0), pct = (v: number) => (Math.max(0, Math.min(v, SCALA)) / SCALA) * 100;
  let acc = 0;
  const pos = pk.filter((p) => p.w > 0).map((p, i) => { const s = `<i class="seg-pk ${i % 2 ? "b" : ""}" style="left:${pct(acc)}%;width:${pct(acc + p.w) - pct(acc)}%;--i:${i}" title="${p.nome}: +${num(p.w)}"></i>`; acc += p.w; return s; }).join("");
  const somma = acc, neg = pk.filter((p) => p.w < 0).reduce((a, p) => a + p.w, 0);
  const negSeg = neg < 0 ? `<i class="seg-neg" style="left:${pct(Math.max(0, somma + neg))}%;width:${pct(somma) - pct(Math.max(0, somma + neg))}%" title="Smentita: ${num(neg)}"></i>` : "";
  const sopra = tot >= SOGLIA;
  const esito = !e.fonti.length ? `Sotto la soglia: è visibile solo come evento segnalato dagli utenti, con regola a parte.`
    : e.contraddittorio ? `Saldo ${tot < 0 ? "negativo" : "sotto la soglia"} per una smentita. Resta visibile con l'avviso di fonti discordanti finché una fonte successiva non chiarisce.`
    : sopra ? `Sopra la soglia di pubblicazione di ${num(SOGLIA)}.` : `Sotto la soglia di ${num(SOGLIA)}.`;
  return `<section class="proof" aria-label="Perché è visibile"><h3>Perché è visibile</h3>
    <div class="score"><b class="fig">${num(tot)}</b><p>${esito}</p></div>
    <div class="ruler" role="img" aria-label="Saldo ${num(tot)} su una scala da 0 a ${num(SCALA, 1)}, soglia ${num(SOGLIA)}">
      <div class="track">${pos}${negSeg}<span class="th" style="left:${pct(SOGLIA)}%"><em>soglia ${num(SOGLIA)}</em></span></div>
      <div class="ticks fig"><span>0</span><span>0,4</span><span>0,8</span><span>1,2</span></div>
    </div>
    <ol class="sources">${pk.map((p, i) => `<li class="src ${p.w < 0 ? "neg" : ""}" style="--i:${i}"><span class="sw ${p.w < 0 ? "neg" : i % 2 ? "b" : ""}"></span><span class="n">${p.nome}</span><span class="w fig">${p.w > 0 ? "+" : ""}${num(p.w)}</span><span class="k">${p.tipo}</span><span class="d fig">pubbl. ${p.quando}</span></li>`).join("")}
    ${!pk.length ? `<li class="empty">Nessuna fonte.</li>` : ""}</ol>
    <p class="fine">Pesi: ente ufficiale 1,00 · agenzia 0,60 · testata 0,50 · promotori 0,30 · segnalazioni fino a 0,60. Le riprese della stessa notizia contano una volta.</p>
  </section>`;
}
function scheda(e: Evento) {
  const c = credibilita(e);
  return `<article class="d">
  <div class="d-top"><button class="back" data-back>← Torna al briefing</button><span class="stamp small">Dati di prova</span></div>
  <header class="d-head">
    <p class="d-kind">${simbolo(e.tipo, variante(e), 18)}<span>${STATI[e.stato]} · ${e.categoria}</span></p>
    <h2 class="dec" data-testo="${titolo(e)}">${titolo(e)}</h2>
    <p class="d-place">${e.luogo}, ${e.regione}</p>
    <p class="d-coord fig">${e.precisione === "esatta" ? `${coord(e.lngLat)} · punto indicato dalle fonti` : "Solo il comune: le fonti non indicano un punto preciso"}</p>
  </header>
  ${e.contraddittorio ? `<p class="alert warn"><b>Fonti discordanti.</b> Due fonti descrivono la situazione in modo incompatibile.</p>` : ""}
  ${!e.fonti.length ? `<p class="alert user"><b>Nessuna fonte giornalistica o ufficiale.</b> È visibile perché ${e.segnalatori} segnalatori diversi lo hanno indicato nello stesso punto entro 2 ore; scompare dopo 6 ore senza nuove segnalazioni.</p>` : ""}
  ${prova(e)}
  <section class="facts"><h3>Quando e dove</h3><dl class="kv">
    <dt>Inizio</dt><dd class="fig">${dataOra(e.inizio)}</dd><dt>Fine</dt><dd class="fig">${e.fine ? dataOra(e.fine) : "non indicata"}</dd>
    <dt>Effetti sul traffico</dt><dd>${e.traffico}</dd><dt>Ultimo aggiornamento</dt><dd class="fig">${dataOra(e.aggiornato)}</dd><dt>Stato della credibilità</dt><dd>${c.label}</dd></dl></section>
  <section class="facts"><h3>Cronologia</h3><ol class="tl">${e.cronologia.map(([w, k, t]) => `<li><span class="w fig">${dataOra(w)}</span><span><b>${k}.</b> ${t}</span></li>`).join("")}</ol></section>
  <div class="acts">${e.stato !== "concluso" ? `<button class="btn primary" id="conf">Sono sul posto, confermo</button>` : ""}<button class="btn" id="err">Segnala un errore</button></div><div id="msg" aria-live="polite"></div></article>`;
}
function apri(id: string, daElenco: boolean) {
  st.sel = id;
  const e = EVENTI.find((x) => x.id === id)!;
  if (desktop()) { detail.hidden = false; $("#app").classList.add("with-detail"); detail.innerHTML = scheda(e); detail.scrollTop = 0; situazione(); }
  else { briefBody.innerHTML = scheda(e); briefBody.scrollTop = 0; if (brief.dataset.state === "peek") brief.dataset.state = "half"; }
  const box = desktop() ? detail : briefBody;
  const h = box.querySelector(".dec") as HTMLElement; decodifica(h, h.dataset.testo!, 240);
  box.querySelector("#err")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale l'evento verrebbe nascosto in via cautelativa e verificato entro 48 ore. Qui non viene inviato nulla.</p>`));
  box.querySelector("#conf")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale la conferma conterebbe come segnalazione, con controllo di vicinanza facoltativo. Qui non viene inviato nulla.</p>`));
  etichette.forEach((el) => (el.dataset.k = ""));
  requestAnimationFrame(() => {
    map.resize(); disegnaStrisce();
    const pad = desktop() ? { left: 60, top: 60, right: 260, bottom: 60 } : { top: 60, bottom: window.innerHeight * 0.52, left: 30, right: 30 };
    map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), e.precisione === "comune" ? 10.5 : 13), pitch: desktop() ? 40 : 30, padding: pad, duration: calmo() ? 0 : daElenco ? 1400 : 800, essential: true });
    aggancia(e); annota();
  });
}
function chiudi() {
  st.sel = null; sgancia(); etichette.forEach((el) => (el.dataset.k = ""));
  detail.hidden = true; $("#app").classList.remove("with-detail");
  aggiorna(); requestAnimationFrame(() => map.resize());
}

// aggancio: quattro angoli che si chiudono sul punto in 220 ms
const lock = $("#lock");
let preso: Evento | null = null;
function aggancia(e: Evento) { preso = e; lock.hidden = false; lock.classList.remove("on"); void lock.offsetWidth; requestAnimationFrame(() => lock.classList.add("on")); segui(); }
function sgancia() { preso = null; lock.hidden = true; }
function segui() {
  if (!preso) return;
  const p = map.project(preso.lngLat);
  lock.style.transform = `translate(${p.x}px, ${p.y}px)`;
}
window.addEventListener("resize", () => { disegnaStrisce(); segui(); annota(); });
brief.addEventListener("transitionend", () => { segui(); annota(); });

function aggiorna() {
  aggiornaMappa();
  if (st.sel && !desktop()) apri(st.sel, false);
  else situazione();
  requestAnimationFrame(disegnaStrisce);
}

// testata: metodo e segnalazione
$("#brand").addEventListener("click", (ev) => { ev.preventDefault(); if (st.sel) chiudi(); if (!desktop()) brief.dataset.state = "peek"; inquadra(calmo() ? 0 : 1000); });
document.addEventListener("click", (ev) => { const b = (ev.target as Element).closest?.("[data-vista]") as HTMLElement | null; if (b) vista(b.dataset.vista!); });
function vista(v: string) {
  const box = desktop() ? detail : briefBody;
  if (desktop()) { detail.hidden = false; $("#app").classList.add("with-detail"); requestAnimationFrame(() => map.resize()); } else brief.dataset.state = "full";
  sgancia(); st.sel = null; annota();
  box.innerHTML = v === "segnala"
    ? `<article class="d"><div class="d-top"><button class="back" data-back>← Torna al briefing</button></div><header class="d-head"><h2>Segnala un evento</h2><p class="d-place">Nel sito reale: posa il segnaposto sul punto, scegli tipo, ora, quante persone e l'effetto sul traffico. Niente foto e niente testo libero pubblico.</p></header><section class="facts"><h3>Prima di inviare</h3><p>Ti mostriamo gli eventi già noti vicino a te: se il tuo è uno di questi, basta confermarlo. Le segnalazioni da sole rendono visibile un evento solo come "segnalato da N utenti".</p></section></article>`
    : `<article class="d"><div class="d-top"><button class="back" data-back>← Torna al briefing</button></div><header class="d-head"><h2>Come decidiamo cosa mostrare</h2><p class="d-place">Un evento diventa pubblico quando le fonti indipendenti superano la soglia di 0,80. Le riprese della stessa notizia contano una volta sola.</p></header><section class="facts"><h3>Pesi di partenza</h3><dl class="kv"><dt>Ente ufficiale</dt><dd class="fig">1,00</dd><dt>Agenzia di stampa</dt><dd class="fig">0,60</dd><dt>Testata</dt><dd class="fig">0,50</dd><dt>Organizzazione promotrice</dt><dd class="fig">0,30</dd><dt>Segnalazioni anonime</dt><dd class="fig">fino a 0,60</dd><dt>Smentita</dt><dd class="fig">−0,60</dd></dl></section><section class="facts"><h3>Solo eventi e infrastrutture</h3><p>Non tracciamo persone. La posizione è precisa solo quanto le fonti lo consentono: punto esatto, oppure solo il comune.</p></section></article>`;
}

aggiorna();
// declassificazione: le barre di omissis si ritirano entro 900 ms; un tocco o un tasto le toglie subito
const scopri = () => document.body.classList.add("scoperto");
if (calmo()) scopri(); else { setTimeout(scopri, 320); addEventListener("pointerdown", scopri, { once: true }); addEventListener("keydown", scopri, { once: true }); }

// pannello trascinabile su telefono
const fasi = ["peek", "half", "full"] as const;
const grip = $("#grip");
let y0 = 0, mosso = false, base = 0;
grip.addEventListener("click", () => { if (mosso) return; const i = fasi.indexOf(brief.dataset.state as any); brief.dataset.state = fasi[(i + 1) % 3]; });
grip.addEventListener("pointerdown", (ev) => { y0 = ev.clientY; mosso = false; base = brief.getBoundingClientRect().top - (window.innerHeight - brief.offsetHeight); brief.classList.add("dragging"); grip.setPointerCapture(ev.pointerId); });
grip.addEventListener("pointermove", (ev) => {
  if (!brief.classList.contains("dragging")) return;
  const dy = ev.clientY - y0; if (Math.abs(dy) > 4) mosso = true;
  brief.style.transform = `translateY(${Math.max(0, base + dy)}px)`;
  annota();
});
grip.addEventListener("pointerup", () => {
  brief.classList.remove("dragging"); brief.style.transform = "";
  if (mosso) { const t = brief.getBoundingClientRect().top / window.innerHeight; brief.dataset.state = t < 0.3 ? "full" : t < 0.62 ? "half" : "peek"; }
  setTimeout(() => (mosso = false), 0);
});
