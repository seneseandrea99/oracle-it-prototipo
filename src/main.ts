import "./style.css";
import { EVENTI, ORA, type Evento, type Tipo, type FonteTipo } from "./data";

declare const maplibregl: any;

const STILI = ["https://tiles.openfreemap.org/styles/dark", "https://tiles.openfreemap.org/styles/fiord", "https://tiles.openfreemap.org/styles/positron"];
const ITALIA: [[number, number], [number, number]] = [[6.0, 35.3], [19.2, 47.2]];
const SUD: [[number, number], [number, number]] = [[12.2, 36.6], [18.7, 42.2]];
const TIPI: Record<Tipo, { label: string; plur: string; colore: string; forma: "quadrato" | "rombo" | "triangolo" | "cerchio" }> = {
  blocco: { label: "Blocco", plur: "Blocchi", colore: "#ff4b3e", forma: "quadrato" },
  sciopero: { label: "Sciopero", plur: "Scioperi", colore: "#6fb6ff", forma: "rombo" },
  corteo: { label: "Corteo", plur: "Cortei", colore: "#f2d64b", forma: "triangolo" },
  presidio: { label: "Presidio", plur: "Presìdi", colore: "#2fe0b5", forma: "cerchio" },
};
const ORDINE_TIPI: Tipo[] = ["blocco", "presidio", "corteo", "sciopero"];
const STATI = { in_corso: "In corso", annunciato: "Annunciato", concluso: "Concluso" } as const;
const FONTE: Record<FonteTipo, string> = { ufficiale: "Ente ufficiale", agenzia: "Agenzia di stampa", testata: "Testata", parte: "Organizzazione promotrice" };
const PESO: Record<FonteTipo, number> = { ufficiale: 1, agenzia: 0.6, testata: 0.5, parte: 0.3 };
const SOGLIA = 0.8, SCALA = 1.2;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const giorno = (d: string) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const ora = (d: string) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dataOra = (d: string) => `${giorno(d)} ${ora(d)}`;
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
  const r = e.fonti.map((f) => ({ nome: f.nome, tipo: FONTE[f.tipo] + (f.smentisce ? ", smentisce" : ""), quando: dataOra(f.pubblicata),
    w: f.smentisce ? -0.6 : f.tipo === "parte" && f.annuncio ? 0.6 : PESO[f.tipo] }));
  if (e.segnalatori) {
    let u = 0;
    for (let i = 0; i < e.segnalatori; i++) u += 0.1 * Math.pow(0.85, i);
    r.push({ nome: `${e.segnalatori} segnalatori diversi`, tipo: "Segnalazioni utenti, peso decrescente", quando: ora(e.aggiornato), w: Math.min(0.6, +u.toFixed(2)) });
  }
  return r;
}
function variante(e: Evento) {
  if (e.stato === "concluso") return "concluso";
  if (!e.fonti.length) return "utenti";
  return e.stato === "annunciato" ? "vuoto" : "pieno";
}

// simboli: forma per tipo, pieno/vuoto per stato, tratteggio per sole segnalazioni
function forma(f: string, s = 7) {
  return f === "quadrato" ? `<rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}"/>` : f === "rombo" ? `<polygon points="0,${-s - 1} ${s + 1},0 0,${s + 1} ${-s - 1},0"/>`
    : f === "triangolo" ? `<polygon points="0,${-s - 1} ${s + .6},${s - .6} ${-s - .6},${s - .6}"/>` : `<circle r="${s}"/>`;
}
function simbolo(tipo: Tipo, v: string, size = 16) {
  const col = v === "concluso" ? "#5d6a73" : TIPI[tipo].colore;
  return `<svg viewBox="-10 -10 20 20" width="${size}" height="${size}" aria-hidden="true"><g fill="${v === "pieno" || v === "concluso" ? col : "none"}" stroke="${col}" stroke-width="2.2" ${v === "utenti" ? 'stroke-dasharray="2.5 2"' : ""}>${forma(TIPI[tipo].forma)}</g></svg>`;
}
function percorso(ctx: CanvasRenderingContext2D, f: string, c: number, r: number) {
  ctx.beginPath();
  if (f === "quadrato") ctx.rect(c - r * 0.8, c - r * 0.8, r * 1.6, r * 1.6);
  else if (f === "rombo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r, c); ctx.lineTo(c, c + r); ctx.lineTo(c - r, c); ctx.closePath(); }
  else if (f === "triangolo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r * 0.95, c + r * 0.72); ctx.lineTo(c - r * 0.95, c + r * 0.72); ctx.closePath(); }
  else ctx.arc(c, c, r * 0.84, 0, Math.PI * 2);
}
function icona(tipo: Tipo, v: string, px = 64) {
  const cv = document.createElement("canvas"); cv.width = cv.height = px;
  const ctx = cv.getContext("2d")!, c = px / 2, col = v === "concluso" ? "#5d6a73" : TIPI[tipo].colore;
  const m = px * 0.1, k = px * 0.2, e = px - m;
  ctx.beginPath(); ctx.moveTo(m, m); ctx.lineTo(e, m); ctx.lineTo(e, e - k); ctx.lineTo(e - k, e); ctx.lineTo(m, e); ctx.closePath();
  ctx.fillStyle = "rgba(14,14,16,.88)"; ctx.fill();
  ctx.lineWidth = px * 0.04; ctx.strokeStyle = col; if (v === "utenti") ctx.setLineDash([px * 0.06, px * 0.04]); ctx.stroke(); ctx.setLineDash([]);
  percorso(ctx, TIPI[tipo].forma, c, px * 0.17); ctx.lineWidth = px * 0.05; ctx.strokeStyle = col;
  if (v === "pieno" || v === "concluso") { ctx.fillStyle = col; ctx.fill(); }
  if (v === "utenti") ctx.setLineDash([px * 0.05, px * 0.04]);
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

// mappa: globo con immagini satellitari, sopra solo strade, confini e nomi
const SATELLITE = {
  eox: { tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"], maxzoom: 15,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX IT Services GmbH</a> (dati Copernicus Sentinel 2020)' },
  esri: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], maxzoom: 18,
    attribution: "Immagini: Esri, Maxar, Earthstar Geographics" },
};
const map = new maplibregl.Map({
  container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#05070a" } }] },
  center: [12.6, 41.8], zoom: calmo() ? 5 : 2.4, minZoom: 1.6, maxZoom: 17.5, maxPitch: 60,
  attributionControl: { compact: true }, dragRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");

function satellite(style: any) {
  const strade = ["match", ["get", "class"], ["motorway"], "rgba(255,236,190,.7)", ["trunk", "primary"], "rgba(255,255,255,.45)", ["secondary", "tertiary"], "rgba(255,255,255,.25)", "rgba(255,255,255,.12)"];
  const tenute = style.layers.filter((l: any) => {
    const id = String(l.id), sl = String(l["source-layer"] || "");
    if (l.type === "line" && sl === "transportation") { l.paint = { ...(l.paint || {}), "line-color": strade }; delete l.paint["line-gradient"]; delete l.paint["line-dasharray"]; return !/casing|tunnel|rail|path|ferry/.test(id); }
    if (l.type === "line" && sl === "boundary") { l.paint = { ...(l.paint || {}), "line-color": "rgba(255,255,255,.55)" }; return true; }
    if (l.type === "symbol" && /place|city|town|village|capital|state|country|road|highway|motorway/.test(id)) {
      l.paint = { ...(l.paint || {}), "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,.85)", "text-halo-width": 1.5, "icon-opacity": 0 };
      return true;
    }
    return false;
  });
  style.sources.satellite = { type: "raster", tileSize: 256, ...SATELLITE.eox };
  style.layers = [
    { id: "spazio", type: "background", paint: { "background-color": "#05070a" } },
    { id: "satellite", type: "raster", source: "satellite", paint: { "raster-brightness-max": 0.58, "raster-saturation": -0.65, "raster-contrast": 0.1, "raster-fade-duration": 200 } },
    ...tenute,
  ];
  style.projection = { type: "globe" };
  style.sky = { "sky-color": "#061527", "horizon-color": "#2c5a86", "fog-color": "#05070a", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.4,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0] };
  return style;
}
let erroriSat = 0;
map.on("error", (e: any) => {
  if (e?.sourceId === "satellite" && ++erroriSat === 4) { const src = map.getSource("satellite"); src?.setTiles?.(SATELLITE.esri.tiles); }
  else console.warn("mappa:", e?.error?.message);
});
(async () => {
  map.once("style.load", () => setTimeout(() => { if (!calmo()) map.fitBounds(ITALIA, { padding: desktop() ? 40 : { top: 20, bottom: 240, left: 10, right: 10 }, duration: 2600, essential: true }); }, 500));
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
    punti: { type: "FeatureCollection", features: ev.map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: e.lngLat }, properties: { id: e.id, icon: `${e.tipo}-${variante(e)}`, nome: e.comune, attivo: e.stato === "in_corso" ? 1 : 0 } })) },
    aree: { type: "FeatureCollection", features: ev.filter((e) => e.precisione === "comune").map((e) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [cerchio(e.lngLat, 3)] }, properties: { colore: TIPI[e.tipo].colore } })) },
    tratti: { type: "FeatureCollection", features: ev.filter((e) => e.tratto).map((e) => ({ type: "Feature", geometry: { type: "LineString", coordinates: e.tratto }, properties: {} })) },
  };
}
map.on("style.load", () => {
  if (map.getSource("punti")) return;
  for (const t of ORDINE_TIPI) for (const v of ["pieno", "vuoto", "utenti", "concluso"]) if (!map.hasImage(`${t}-${v}`)) map.addImage(`${t}-${v}`, icona(t, v), { pixelRatio: 2 });
  const d = geo();
  fetch("regioni.json").then((r) => r.json()).then((rg) => { regioniGeo = rg; map.addSource("regioni", { type: "geojson", data: intensita() });
    map.addLayer({ id: "regioni-fill", type: "fill", source: "regioni", paint: { "fill-color": ["step", ["get", "n"], "rgba(255,255,255,0.02)", 1, "rgba(214,58,42,0.22)", 2, "rgba(214,58,42,0.34)", 3, "rgba(214,58,42,0.48)"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, 1, 9, 0.35, 12, 0.12] } }, "aree-fill");
    map.addLayer({ id: "regioni-line", type: "line", source: "regioni", paint: { "line-color": "rgba(255,255,255,.28)", "line-width": 0.7 } }, "aree-fill");
  }).catch(() => {});
  map.addSource("aree", { type: "geojson", data: d.aree }); map.addSource("tratti", { type: "geojson", data: d.tratti }); map.addSource("punti", { type: "geojson", data: d.punti });
  map.addLayer({ id: "aree-fill", type: "fill", source: "aree", paint: { "fill-color": ["get", "colore"], "fill-opacity": 0.08 } });
  map.addLayer({ id: "aree-line", type: "line", source: "aree", paint: { "line-color": ["get", "colore"], "line-opacity": 0.8, "line-width": 1.2, "line-dasharray": [3, 3] } });
  map.addLayer({ id: "tratti", type: "line", source: "tratti", layout: { "line-join": "round" }, paint: { "line-color": "#ff4b3e", "line-width": 3.5, "line-dasharray": [2, 1] } });
  map.addLayer({ id: "onda", type: "circle", source: "punti", filter: ["==", ["get", "attivo"], 1], paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1, "circle-stroke-opacity": 0.45, "circle-pitch-alignment": "map" } });
  map.addLayer({ id: "icone", type: "symbol", source: "punti", layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.72, 9, 0.95, 14, 1.2], "icon-allow-overlap": true } });
  map.addLayer({ id: "nomi", type: "symbol", source: "punti", minzoom: 6.2, layout: { "text-field": ["get", "nome"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.7], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#ffffff", "text-halo-color": "#0c0c0e", "text-halo-width": 1.6 } });
  map.on("click", "icone", (ev: any) => apri(ev.features[0].properties.id, false));
  map.on("mouseenter", "icone", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "icone", () => (map.getCanvas().style.cursor = ""));
  if (!calmo()) { const t0 = performance.now(); const step = (t: number) => { const p = ((t - t0) % 2600) / 2600; if (map.getLayer("onda")) { map.setPaintProperty("onda", "circle-radius", 14 + p * 26); map.setPaintProperty("onda", "circle-stroke-opacity", 0.3 * (1 - p)); } requestAnimationFrame(step); }; requestAnimationFrame(step); }
});
let regioniGeo: any = null;
function intensita() { const l = filtrati().filter((e) => e.stato !== "concluso"); return { ...regioniGeo, features: regioniGeo.features.map((f: any) => ({ ...f, properties: { ...f.properties, n: l.filter((e) => e.regione === f.properties.regione).length } })) }; }
function aggiornaMappa() { if (regioniGeo) map.getSource("regioni")?.setData(intensita()); const d = geo(); map.getSource("punti")?.setData(d.punti); map.getSource("aree")?.setData(d.aree); map.getSource("tratti")?.setData(d.tratti); }

// linea del tempo: le ultime 24 ore occupano il 30% a sinistra, i prossimi 8 giorni il resto
const T0 = +ORA - 24 * 36e5, T1 = +ORA + 8 * 864e5;
function striscia(w: number) {
  const stretto = w < 600, padL = stretto ? 26 : 64, padR = 8, lane = 18, top = 22, h = top + ORDINE_TIPI.length * lane + 4, now = padL + (w - padL - padR) * 0.3;
  const x = (t: number) => t <= +ORA ? padL + ((t - T0) / (+ORA - T0)) * (now - padL) : now + ((t - +ORA) / (T1 - +ORA)) * (w - padR - now);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="group" aria-label="Eventi nel tempo">`;
  const etichette: number[] = [now];
  const libera = (xx: number) => etichette.every((q) => Math.abs(q - xx) > 44) && (etichette.push(xx), true);
  for (const [t, lab] of [[T0, "−24 h"], [+ORA - 12 * 36e5, "−12 h"]] as [number, string][]) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="16" y2="${h}" stroke="#242328" stroke-dasharray="2 3"/>`;
    if (libera(x(t) + (t === T0 ? 18 : 0))) s += `<text class="tick" x="${x(t)}" y="11" text-anchor="${t === T0 ? "start" : "middle"}">${lab}</text>`;
  }
  for (let dd = 1; dd <= 8; dd++) {
    const t = new Date(ORA); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + dd);
    if (+t > T1) break;
    s += `<line x1="${x(+t)}" x2="${x(+t)}" y1="16" y2="${h}" stroke="#242328" stroke-dasharray="2 3"/>`;
    if (libera(x(+t))) s += `<text class="tick" x="${x(+t)}" y="11" text-anchor="middle">${t.getDate()}/${t.getMonth() + 1}</text>`;
  }
  s += `<line x1="${now}" x2="${now}" y1="14" y2="${h}" stroke="#ff8a2b"/><text class="tick now" x="${now}" y="11" text-anchor="middle">ora</text>`;
  ORDINE_TIPI.forEach((t, i) => (s += stretto ? `<g transform="translate(8,${top + i * lane + 8}) scale(.6)" fill="${TIPI[t].colore}" stroke="${TIPI[t].colore}" stroke-width="2"><title>${TIPI[t].plur}</title>${forma(TIPI[t].forma)}</g>` : `<text class="tick" x="0" y="${top + i * lane + 12}">${TIPI[t].plur}</text>`));
  for (const e of filtrati()) {
    if (+new Date(e.fine ?? e.inizio) < T0 && e.stato !== "in_corso") continue;
    const i = ORDINE_TIPI.indexOf(e.tipo), y = top + i * lane + 8;
    const a = Math.max(+new Date(e.inizio), T0), b = Math.min(e.fine ? +new Date(e.fine) : e.stato === "in_corso" ? +ORA : +new Date(e.inizio), T1);
    const xa = x(a), xb = Math.max(x(b), xa), col = e.stato === "concluso" ? "#5d6a73" : TIPI[e.tipo].colore, v = variante(e);
    s += `<g class="mk ${st.sel === e.id ? "sel" : ""}" data-id="${e.id}" tabindex="0" role="button" aria-label="${titolo(e)}, ${STATI[e.stato]}, ${dataOra(e.inizio)}">
      <rect class="hit" x="${xa - 9}" y="${y - 9}" width="${xb - xa + 18}" height="18" rx="3" fill="transparent"/>
      ${xb - xa > 2 ? `<line x1="${xa}" x2="${xb}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="2" ${v === "utenti" ? 'stroke-dasharray="3 2"' : ""} opacity=".8"/>` : ""}
      <g transform="translate(${xa},${y}) scale(.75)" fill="${v === "pieno" || v === "concluso" ? col : "#131217"}" stroke="${col}" stroke-width="2.4" ${v === "utenti" ? 'stroke-dasharray="2.5 2"' : ""}>${forma(TIPI[e.tipo].forma)}</g></g>`;
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

// colonna situazione
const sideBody = $("#side-body"), side = $("#side"), detail = $("#detail");
function situazione() {
  const l = filtrati(), ord = { in_corso: 0, annunciato: 1, concluso: 2 };
  const attivi = l.filter((e) => e.stato === "in_corso"), blocchi = attivi.filter((e) => e.tipo === "blocco"), disc = l.find((e) => e.contraddittorio);
  const regioni = [...new Set(l.map((e) => e.regione))].map((r) => ({ r, a: l.filter((e) => e.regione === r && e.stato === "in_corso").length, p: l.filter((e) => e.regione === r && e.stato !== "in_corso").length }))
    .sort((a, b) => b.a + b.p - (a.a + a.p) || b.a - a.a);
  const max = Math.max(1, ...regioni.map((r) => r.a + r.p));
  const righe = [...l].sort((a, b) => ord[a.stato] - ord[b.stato] || +new Date(b.aggiornato) - +new Date(a.aggiornato));
  const scoperta = blocchi.length
    ? `<p><span class="hot">${blocchi.length} ${blocchi.length === 1 ? "blocco in corso" : "blocchi in corso"}</span> nei porti del Sud: ${blocchi.map((e) => e.comune).join(" e ")}.${disc ? ` A ${disc.comune} le fonti sono discordanti.` : ""}</p>${disc ? `<button class="link" data-apri="${disc.id}">Vedi ${disc.comune}</button>` : ""}`
    : `<p>${attivi.length ? `${attivi.length} eventi in corso, nessun blocco.` : "Nessun evento in corso con questi filtri."}</p>`;
  sideBody.innerHTML = `
  <header class="title"><div class="title-row"><h1>ORACLE<b> IT</b></h1><span class="when fig">22/10 · 20:00</span></div><span class="synth">Dati di prova, non reali</span></header>
  <section class="strip mob-only"><div class="strip-head"><h2>Ultime 24 ore e prossimi 8 giorni</h2></div><div class="strip-svg" id="strip-mob"></div></section>
  <section class="finding" aria-label="In evidenza">${scoperta}</section>
  <div class="figures"><div><span class="n fig">${attivi.length}</span><span class="l">In corso</span></div><div><span class="n fig ${blocchi.length ? "hot" : ""}">${blocchi.length}</span><span class="l">Blocchi attivi</span></div><div><span class="n fig">${l.filter((e) => e.stato === "annunciato").length}</span><span class="l">Annunciati</span></div></div>
  <div class="filters">
    <div class="seg" role="group" aria-label="Periodo">${([["tutto", "Tutto"], ["ora", "In corso"], ["7g", "Prossimi 7 giorni"]] as const).map(([k, t]) => `<button data-quando="${k}" aria-pressed="${st.quando === k}">${t}</button>`).join("")}</div>
    <div class="types" role="group" aria-label="Tipi" style="margin-top:12px">${ORDINE_TIPI.map((t) => `<button class="type" data-tipo="${t}" aria-pressed="${st.tipi.has(t)}">${simbolo(t, "pieno", 14)}${TIPI[t].plur}</button>`).join("")}</div>
  </div>
  <section class="block"><h2>Per regione</h2><div class="regions">${regioni.map((r) => `<button class="reg" data-regione="${r.r}"><span class="name">${r.r}</span><span class="bars">${r.a ? `<i class="a" style="width:${(r.a / max) * 100}%"></i>` : ""}${r.p ? `<i class="p" style="width:${(r.p / max) * 100}%"></i>` : ""}</span><span class="c">${r.a + r.p}</span></button>`).join("")}</div>
    <div class="legend"><span><i style="background:var(--text)"></i>In corso</span><span><i style="background:var(--control)"></i>Annunciati o conclusi</span></div></section>
  <button class="mob" id="naz" aria-pressed="${st.nazionale}"><span class="t">Sciopero nazionale dei trasporti, 30/10</span><span class="s">Riguarda tutta Italia, quindi non ha un punto sulla mappa. ${st.nazionale ? "Tocca per tornare a tutti gli eventi." : "Tocca per vedere i 2 eventi locali collegati."}</span></button>
  <section class="block"><h2>${l.length} eventi</h2><div class="list" role="list">${righe.length ? righe.map((e) => { const c = credibilita(e); return `<button class="row" role="listitem" data-id="${e.id}" aria-current="${st.sel === e.id}">
    <span class="ic">${simbolo(e.tipo, variante(e), 16)}</span><span class="t">${titolo(e)}</span><span class="w">${fa(e.aggiornato)}</span>
    <span class="m"><span>${STATI[e.stato]}, ${giorno(e.inizio)}</span><span class="pill ${c.cls}">${c.label}</span></span></button>`; }).join("") : `<p class="empty">Nessun evento con questi filtri. Scegli "Tutto" o riattiva un tipo.</p>`}</div></section>`;
}
sideBody.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement, b = t.closest("button") as HTMLElement | null;
  if (!b) return;
  if (b.dataset.quando) { st.quando = b.dataset.quando as typeof st.quando; aggiorna(); }
  else if (b.dataset.tipo) { const k = b.dataset.tipo as Tipo; if (st.tipi.has(k) && st.tipi.size > 1) st.tipi.delete(k); else st.tipi.add(k); aggiorna(); }
  else if (b.dataset.regione) { const p = EVENTI.filter((e) => e.regione === b.dataset.regione).map((e) => e.lngLat); const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    map.fitBounds([[Math.min(...xs) - 0.4, Math.min(...ys) - 0.4], [Math.max(...xs) + 0.4, Math.max(...ys) + 0.4]], { padding: 60, duration: 900 }); }
  else if (b.id === "naz") { st.nazionale = !st.nazionale; aggiorna(); }
  else if (b.dataset.apri) apri(b.dataset.apri, true);
  else if (b.dataset.id) apri(b.dataset.id, true);
  else if (b.dataset.back !== undefined) chiudi();
});
detail.addEventListener("click", (ev) => { const b = (ev.target as HTMLElement).closest("button") as HTMLElement | null; if (b?.dataset.back !== undefined) chiudi(); });

function scheda(e: Evento) {
  const c = credibilita(e), pk = pacchetti(e), tot = pk.reduce((a, x) => a + x.w, 0), seg = 24;
  const pieni = Math.round((Math.max(0, Math.min(Math.abs(tot), SCALA)) / SCALA) * seg);
  return `<div class="d">
  <div class="d-top"><button class="back" data-back>← Tutti gli eventi</button><span class="synth">Dati di prova</span></div>
  <header class="d-head"><h2>${titolo(e)}</h2><p>${e.luogo}, ${e.regione}</p>
    <div class="pills"><span class="pill neutral">${STATI[e.stato]}</span><span class="pill ${c.cls}">${c.label}</span><span class="pill neutral">${e.categoria}</span></div></header>
  ${e.contraddittorio ? `<p class="alert warn">Due fonti descrivono la situazione in modo incompatibile. L'evento resta visibile con questo avviso finché una fonte successiva non chiarisce.</p>` : ""}
  ${!e.fonti.length ? `<p class="alert user">Nessuna fonte giornalistica o ufficiale finora. È visibile perché ${e.segnalatori} segnalatori diversi lo hanno indicato nello stesso punto entro 2 ore; scompare dopo 6 ore senza nuove segnalazioni.</p>` : ""}
  <section class="card"><h3>Perché è visibile</h3>
    <div class="meter-top"><b>${tot.toFixed(2)}</b><span>soglia di pubblicazione ${SOGLIA.toFixed(2)}${!e.fonti.length ? ", regola a parte per le segnalazioni" : ""}</span></div>
    <div class="bar">${Array.from({ length: seg }, (_, i) => `<i class="${i < pieni ? "on" : ""} ${tot < 0 ? "neg" : ""}"></i>`).join("")}<span class="th" style="left:${(SOGLIA / SCALA) * 100}%"></span></div>
    <div class="bar-cap"><span>0</span><span>${SCALA.toFixed(1)}</span></div>
    <ol class="packets">${pk.map((p, i) => `<li class="pk" style="--i:${i}"><span class="p">${p.nome}</span><span class="w ${p.w < 0 ? "neg" : ""}">${p.w > 0 ? "+" : "−"}${Math.abs(p.w).toFixed(2)}</span><span class="k">${p.tipo}</span><span class="d2">${p.quando}</span></li>`).join("")}</ol></section>
  <section class="card"><h3>Quando e dove</h3><dl class="kv">
    <dt>Inizio</dt><dd class="fig">${dataOra(e.inizio)}</dd><dt>Fine</dt><dd class="fig">${e.fine ? dataOra(e.fine) : "—"}</dd>
    <dt>Precisione</dt><dd>${e.precisione === "comune" ? "Solo il comune" : "Punto dalle fonti"}</dd><dt>Traffico</dt><dd>${e.traffico}</dd>
    <dt>Aggiornato</dt><dd class="fig">${dataOra(e.aggiornato)}</dd></dl></section>
  <section class="card"><h3>Cronologia</h3><ol class="tl">${e.cronologia.map(([w, k, t]) => `<li><span class="w">${dataOra(w)}</span><span><b>${k}.</b> ${t}</span></li>`).join("")}</ol></section>
  <div class="acts">${e.stato !== "concluso" ? `<button class="btn primary" id="conf">Sono sul posto, confermo</button>` : ""}<button class="btn" id="err">Segnala un errore</button></div><div id="msg"></div></div>`;
}
function apri(id: string, daElenco: boolean) {
  st.sel = id;
  const e = EVENTI.find((x) => x.id === id)!;
  if (desktop()) { detail.hidden = false; $("#app").classList.add("with-detail"); detail.innerHTML = scheda(e); detail.scrollTop = 0; situazione(); }
  else { sideBody.innerHTML = scheda(e); sideBody.scrollTop = 0; if (side.dataset.state === "peek") side.dataset.state = "half"; }
  const box = desktop() ? detail : sideBody;
  box.querySelector("#err")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale l'evento verrebbe nascosto in via cautelativa e verificato entro 48 ore. Qui non viene inviato nulla.</p>`));
  box.querySelector("#conf")?.addEventListener("click", () => ((box.querySelector("#msg") as HTMLElement).innerHTML = `<p class="msg">Nel sito reale la conferma conterebbe come segnalazione, con controllo di vicinanza facoltativo. Qui non viene inviato nulla.</p>`));
  requestAnimationFrame(() => {
    map.resize(); disegnaStrisce();
    const pad = desktop() ? { left: 60, top: 60, right: 60, bottom: 60 } : { top: 40, bottom: window.innerHeight * 0.5, left: 30, right: 30 };
    map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), e.precisione === "comune" ? 11 : 13.6), pitch: desktop() ? 45 : 35, padding: pad, duration: calmo() ? 0 : daElenco ? 1400 : 800, essential: true });
    aggancia(e);
  });
}
function chiudi() {
  st.sel = null; sgancia();
  detail.hidden = true; $("#app").classList.remove("with-detail");
  aggiorna(); requestAnimationFrame(() => map.resize());
}

// aggancio: mirino sul punto e filo fino alla scheda
const lock = $("#lock"), tag = $("#lock-tag"), line = document.getElementById("leader-line")!, dot = document.getElementById("leader-dot")!;
let preso: Evento | null = null;
function decodifica(el: HTMLElement, testo: string) {
  if (calmo()) { el.textContent = testo; return; }
  const segni = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let i = 0;
  const id = setInterval(() => { i++; el.textContent = testo.split("").map((ch, k) => (k < i || ch === " " ? ch : segni[(Math.random() * segni.length) | 0])).join(""); if (i >= testo.length) clearInterval(id); }, 26);
}
function aggancia(e: Evento) { preso = e; lock.hidden = false; lock.classList.remove("on"); void lock.offsetWidth; requestAnimationFrame(() => lock.classList.add("on")); tag.textContent = `${TIPI[e.tipo].label} · ${e.comune}`; segui(); }
function sgancia() { preso = null; lock.hidden = true; line.setAttribute("points", ""); dot.setAttribute("r", "0"); }
function segui() {
  if (!preso) return;
  const p = map.project(preso.lngLat), box = $(".mapbox").getBoundingClientRect();
  lock.style.transform = `translate(${p.x}px, ${p.y}px)`; lock.classList.toggle("flip", p.x > box.width - 220);
  const gx = box.left + p.x, gy = box.top + p.y;
  let ax: number, ay: number, mid: string;
  if (desktop()) { const r = detail.getBoundingClientRect(); ax = r.left; ay = Math.min(Math.max(gy, r.top + 80), r.bottom - 40); mid = `${ax - 28},${ay}`; }
  else { const r = side.getBoundingClientRect(); ax = Math.min(Math.max(gx, 24), window.innerWidth - 24); ay = r.top; mid = `${ax},${ay - 18}`; }
  line.setAttribute("points", `${gx},${gy} ${mid} ${ax},${ay}`); dot.setAttribute("cx", String(ax)); dot.setAttribute("cy", String(ay)); dot.setAttribute("r", "3");
}
map.on("move", segui);
window.addEventListener("resize", () => { disegnaStrisce(); segui(); });
side.addEventListener("transitionend", segui);

function aggiorna() {
  aggiornaMappa();
  if (st.sel && !desktop()) apri(st.sel, false);
  else situazione();
  requestAnimationFrame(disegnaStrisce);
}

// rail
document.querySelectorAll<HTMLButtonElement>(".nav").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".nav").forEach((n) => n.setAttribute("aria-current", String(n === b)));
  const v = b.dataset.vista;
  if (v === "elenco") { if (!desktop()) side.dataset.state = "full"; sideBody.querySelector(".list")?.scrollIntoView({ behavior: calmo() ? "auto" : "smooth" }); }
  else if (v === "mappa") { if (!desktop()) side.dataset.state = "peek"; map.fitBounds(SUD, { padding: 40, duration: 900 }); }
  else { const box = desktop() ? detail : sideBody;
    if (desktop()) { detail.hidden = false; $("#app").classList.add("with-detail"); requestAnimationFrame(() => map.resize()); } else side.dataset.state = "half";
    sgancia();
    box.innerHTML = v === "segnala"
      ? `<div class="d"><div class="d-top"><button class="back" data-back>← Indietro</button></div><header class="d-head"><h2>Segnala un evento</h2><p>Nel sito reale: posa il segnaposto sul punto, scegli tipo, ora, quante persone e l'effetto sul traffico. Niente foto e niente testo libero pubblico.</p></header><section class="card"><h3>Prima di inviare</h3><p style="margin:0;color:var(--text-2)">Ti mostriamo gli eventi già noti vicino a te: se il tuo è uno di questi, basta confermarlo.</p></section></div>`
      : `<div class="d"><div class="d-top"><button class="back" data-back>← Indietro</button></div><header class="d-head"><h2>Come decidiamo cosa mostrare</h2><p>Un evento diventa pubblico quando le fonti indipendenti superano la soglia di 0,80. Le riprese della stessa notizia contano una volta sola.</p></header><section class="card"><h3>Pesi di partenza</h3><dl class="kv"><dt>Ente ufficiale</dt><dd class="fig">1.00</dd><dt>Agenzia di stampa</dt><dd class="fig">0.60</dd><dt>Testata</dt><dd class="fig">0.50</dd><dt>Promotori</dt><dd class="fig">0.30</dd><dt>Segnalazioni</dt><dd class="fig">fino a 0.60</dd></dl></section></div>`;
  }
}));

aggiorna();

// pannello trascinabile su telefono
const fasi = ["peek", "half", "full"] as const;
const grip = $("#grip");
let y0 = 0, top0 = 0, mosso = false;
grip.addEventListener("click", () => { if (mosso) return; const i = fasi.indexOf(side.dataset.state as any); side.dataset.state = fasi[(i + 1) % 3]; });
grip.addEventListener("pointerdown", (ev) => { y0 = ev.clientY; mosso = false; top0 = side.getBoundingClientRect().top; side.classList.add("dragging"); grip.setPointerCapture(ev.pointerId); });
grip.addEventListener("pointermove", (ev) => {
  if (!side.classList.contains("dragging")) return;
  const dy = ev.clientY - y0; if (Math.abs(dy) > 4) mosso = true;
  const base = side.getBoundingClientRect().top - (side.getBoundingClientRect().top - top0);
  side.style.transform = `translateY(${Math.max(0, base + dy - (window.innerHeight - side.offsetHeight - 60))}px)`;
  segui();
});
grip.addEventListener("pointerup", () => {
  side.classList.remove("dragging"); side.style.transform = "";
  if (mosso) { const t = side.getBoundingClientRect().top / window.innerHeight; side.dataset.state = t < 0.3 ? "full" : t < 0.7 ? "half" : "peek"; }
  setTimeout(() => (mosso = false), 0);
});
