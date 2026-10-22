import "./style.css";
import { EVENTI, ORA, type Evento, type Tipo, type FonteTipo } from "./data";

declare const maplibregl: any;

const STILI = [
  "https://tiles.openfreemap.org/styles/dark",
  "https://tiles.openfreemap.org/styles/fiord",
  "https://tiles.openfreemap.org/styles/positron",
];
const ITALIA: [[number, number], [number, number]] = [[6.0, 35.3], [19.2, 47.2]];
const SUD: [[number, number], [number, number]] = [[12.2, 36.6], [18.7, 42.2]];

const TIPI: Record<Tipo, { label: string; colore: string; forma: "quadrato" | "rombo" | "triangolo" | "cerchio" }> = {
  blocco: { label: "Blocco", colore: "#ff4b3e", forma: "quadrato" },
  sciopero: { label: "Sciopero", colore: "#6fb6ff", forma: "rombo" },
  corteo: { label: "Corteo", colore: "#ffb238", forma: "triangolo" },
  presidio: { label: "Presidio", colore: "#2fe0b5", forma: "cerchio" },
};
const STATI = { in_corso: "In corso", annunciato: "Annunciato", concluso: "Concluso" } as const;
const FONTE: Record<FonteTipo, string> = { ufficiale: "Ente ufficiale", agenzia: "Agenzia di stampa", testata: "Testata", parte: "Organizzazione promotrice" };
const PESO: Record<FonteTipo, number> = { ufficiale: 1, agenzia: 0.6, testata: 0.5, parte: 0.3 };
const SOGLIA = 0.8, SCALA = 1.2;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const giorno = (d: string) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const ora = (d: string) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dataOra = (d: string) => `${giorno(d)} ${ora(d)}`;
function fa(d: string | Date) {
  const m = Math.round((+ORA - +new Date(d)) / 60000);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h fa` : `${Math.round(h / 24)} g fa`;
}
const titolo = (e: Evento) => `${TIPI[e.tipo].label} a ${e.comune}`;

function credibilita(e: Evento) {
  if (e.contraddittorio) return { label: "Informazioni discordanti", cls: "warn" };
  if (!e.fonti.length) return { label: `Segnalato da ${e.segnalatori} utenti, nessuna fonte`, cls: "user" };
  if (e.fonti.some((f) => f.tipo === "ufficiale")) return { label: "Comunicato ufficiale", cls: "cred" };
  const n = e.fonti.filter((f) => !f.smentisce).length;
  return { label: n === 1 ? "Riportato da 1 fonte" : `Riportato da ${n} fonti indipendenti`, cls: "cred" };
}
function pacchetti(e: Evento) {
  const r = e.fonti.map((f) => ({ nome: f.nome, tipo: FONTE[f.tipo] + (f.smentisce ? ", smentisce" : ""), quando: `Notizia del ${dataOra(f.pubblicata)}`,
    w: f.smentisce ? -0.6 : f.tipo === "parte" && f.annuncio ? 0.6 : PESO[f.tipo] }));
  if (e.segnalatori) {
    let u = 0;
    for (let i = 0; i < e.segnalatori; i++) u += 0.1 * Math.pow(0.85, i);
    r.push({ nome: `${e.segnalatori} segnalatori diversi`, tipo: "Segnalazioni utenti, peso decrescente", quando: "Ultima alle " + ora(e.aggiornato), w: Math.min(0.6, +u.toFixed(2)) });
  }
  return r;
}
function variante(e: Evento) {
  if (e.stato === "concluso") return "concluso";
  if (!e.fonti.length) return "utenti";
  return e.stato === "annunciato" ? "vuoto" : "pieno";
}

// icone disegnate: forma per tipo, riempimento per stato, tratteggio per sole segnalazioni
function percorso(ctx: CanvasRenderingContext2D, forma: string, c: number, r: number) {
  ctx.beginPath();
  if (forma === "quadrato") ctx.rect(c - r * 0.8, c - r * 0.8, r * 1.6, r * 1.6);
  else if (forma === "rombo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r, c); ctx.lineTo(c, c + r); ctx.lineTo(c - r, c); ctx.closePath(); }
  else if (forma === "triangolo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r * 0.95, c + r * 0.72); ctx.lineTo(c - r * 0.95, c + r * 0.72); ctx.closePath(); }
  else ctx.arc(c, c, r * 0.84, 0, Math.PI * 2);
}
function icona(tipo: Tipo, v: string, px = 60) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const ctx = cv.getContext("2d")!, c = px / 2, r = px * 0.26;
  const col = v === "concluso" ? "#5d6a73" : TIPI[tipo].colore;
  // mirino esterno sottile
  ctx.strokeStyle = "rgba(238,243,246,.55)"; ctx.lineWidth = px * 0.025;
  const a = px * 0.46, l = px * 0.12;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.beginPath(); ctx.moveTo(c + sx * a, c + sy * (a - l)); ctx.lineTo(c + sx * a, c + sy * a); ctx.lineTo(c + sx * (a - l), c + sy * a); ctx.stroke();
  }
  percorso(ctx, TIPI[tipo].forma, c, r + px * 0.05); ctx.fillStyle = "rgba(4,6,7,.9)"; ctx.fill();
  percorso(ctx, TIPI[tipo].forma, c, r);
  ctx.lineWidth = px * 0.065; ctx.strokeStyle = col;
  if (v === "utenti") ctx.setLineDash([px * 0.07, px * 0.05]);
  if (v === "pieno" || v === "concluso") { ctx.fillStyle = col; ctx.fill(); }
  ctx.stroke();
  return ctx.getImageData(0, 0, px, px);
}
function iconaSvg(tipo: Tipo, v: string, size = 18) {
  const col = v === "concluso" ? "#5d6a73" : TIPI[tipo].colore, f = TIPI[tipo].forma;
  const fill = v === "pieno" || v === "concluso" ? col : "none", dash = v === "utenti" ? 'stroke-dasharray="2.5 2"' : "";
  const s = f === "quadrato" ? `<rect x="-7" y="-7" width="14" height="14"/>` : f === "rombo" ? `<polygon points="0,-8 8,0 0,8 -8,0"/>` : f === "triangolo" ? `<polygon points="0,-8 7.6,5.8 -7.6,5.8"/>` : `<circle r="7"/>`;
  return `<svg viewBox="-10 -10 20 20" width="${size}" height="${size}" aria-hidden="true"><g fill="${fill}" stroke="${col}" stroke-width="2.2" ${dash}>${s}</g></svg>`;
}
function cerchio([lng, lat]: [number, number], km: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push([lng + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 110.57) * Math.sin(a)]);
  }
  return pts;
}

// stato dei filtri e della selezione
const st = { tipi: new Set<Tipo>(["blocco", "sciopero", "corteo", "presidio"]), quando: "tutto" as "tutto" | "ora" | "7g", nazionale: false, sel: null as string | null };
function filtrati() {
  return EVENTI.filter((e) => st.tipi.has(e.tipo)
    && (st.quando === "tutto" || (st.quando === "ora" ? e.stato === "in_corso" : e.stato !== "concluso" && +new Date(e.inizio) - +ORA < 7 * 864e5))
    && (!st.nazionale || e.nazionale));
}
const desktop = () => matchMedia("(min-width: 900px)").matches;
const calmo = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// mappa: stile scuro ricolorato in linee bianche, edifici in 3D a fil di ferro
const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#040607" } }] },
  bounds: SUD, maxBounds: [[3.5, 33.5], [21.5, 48.8]], minZoom: 4.6, maxZoom: 17.5,
  pitch: desktop() ? 42 : 30, maxPitch: 60, attributionControl: { compact: true }, dragRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");

function ricolora(style: any) {
  const linee = (cls: string) => ["match", ["get", "class"], ["motorway"], `rgba(238,243,246,${cls === "w" ? .62 : .5})`, ["trunk", "primary"], "rgba(238,243,246,.34)", ["secondary", "tertiary"], "rgba(238,243,246,.2)", "rgba(238,243,246,.11)"];
  for (const l of style.layers) {
    l.paint = l.paint || {};
    const id = String(l.id), sl = String(l["source-layer"] || "");
    if (l.type === "background") l.paint["background-color"] = "#040607";
    else if (l.type === "fill") {
      if (sl === "water" || /water|ocean|lake/.test(id)) { l.paint["fill-color"] = "#06131a"; l.paint["fill-opacity"] = 1; }
      else if (sl === "building") l.layout = { ...(l.layout || {}), visibility: "none" };
      else { l.paint["fill-color"] = "#0b1013"; l.paint["fill-opacity"] = 0.5; delete l.paint["fill-pattern"]; }
      delete l.paint["fill-outline-color"];
    } else if (l.type === "line") {
      if (sl === "transportation") l.paint["line-color"] = linee("");
      else if (sl === "boundary") { l.paint["line-color"] = "rgba(57,215,255,.4)"; }
      else if (sl === "waterway") l.paint["line-color"] = "#0d2a36";
      else l.paint["line-color"] = "rgba(238,243,246,.08)";
      delete l.paint["line-gradient"];
    } else if (l.type === "symbol") {
      l.paint["text-color"] = /place|city|town|capital|state|country/.test(id) ? "#d5dee4" : "#7f8e98";
      l.paint["text-halo-color"] = "#040607"; l.paint["text-halo-width"] = 1.4;
      l.paint["icon-opacity"] = 0;
    } else if (l.type === "fill-extrusion") l.layout = { ...(l.layout || {}), visibility: "none" };
  }
  const src = Object.keys(style.sources).find((k) => style.sources[k].type === "vector");
  if (src) style.layers.push({ id: "edifici-3d", type: "fill-extrusion", source: src, "source-layer": "building", minzoom: 13,
    paint: { "fill-extrusion-color": "#9fb3bf", "fill-extrusion-opacity": 0.14,
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0] } });
  return style;
}
async function caricaStile() {
  for (const url of STILI) {
    try {
      const r = await fetch(url);
      if (r.ok) { map.setStyle(ricolora(await r.json())); return; }
    } catch { /* prova il successivo */ }
  }
  $("#maperr").hidden = false;
}

function dati() {
  const ev = filtrati();
  return {
    punti: { type: "FeatureCollection", features: ev.map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: e.lngLat },
      properties: { id: e.id, icon: `${e.tipo}-${variante(e)}`, nome: e.comune.toUpperCase(), attivo: e.stato === "in_corso" ? 1 : 0 } })) },
    aree: { type: "FeatureCollection", features: ev.filter((e) => e.precisione === "comune").map((e) => ({ type: "Feature",
      geometry: { type: "Polygon", coordinates: [cerchio(e.lngLat, 3)] }, properties: { id: e.id, colore: TIPI[e.tipo].colore } })) },
    tratti: { type: "FeatureCollection", features: ev.filter((e) => e.tratto).map((e) => ({ type: "Feature", geometry: { type: "LineString", coordinates: e.tratto }, properties: { id: e.id } })) },
  };
}
function livelli() {
  if (map.getSource("punti")) return;
  for (const t of Object.keys(TIPI) as Tipo[]) for (const v of ["pieno", "vuoto", "utenti", "concluso"])
    if (!map.hasImage(`${t}-${v}`)) map.addImage(`${t}-${v}`, icona(t, v), { pixelRatio: 2 });
  const d = dati();
  map.addSource("aree", { type: "geojson", data: d.aree });
  map.addSource("tratti", { type: "geojson", data: d.tratti });
  map.addSource("punti", { type: "geojson", data: d.punti });
  map.addLayer({ id: "aree-fill", type: "fill", source: "aree", paint: { "fill-color": ["get", "colore"], "fill-opacity": 0.08 } });
  map.addLayer({ id: "aree-line", type: "line", source: "aree", paint: { "line-color": ["get", "colore"], "line-opacity": 0.8, "line-width": 1.2, "line-dasharray": [3, 3] } });
  map.addLayer({ id: "tratti-alone", type: "line", source: "tratti", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ff4b3e", "line-width": 12, "line-opacity": 0.18, "line-blur": 4 } });
  map.addLayer({ id: "tratti", type: "line", source: "tratti", layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": "#ff4b3e", "line-width": 3.5, "line-dasharray": [2, 1] } });
  map.addLayer({ id: "onda", type: "circle", source: "punti", filter: ["==", ["get", "attivo"], 1], paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#eef3f6", "circle-stroke-width": 1, "circle-stroke-opacity": 0.5, "circle-pitch-alignment": "map" } });
  map.addLayer({ id: "icone", type: "symbol", source: "punti", layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.72, 9, 0.95, 14, 1.2], "icon-allow-overlap": true } });
  map.addLayer({ id: "nomi", type: "symbol", source: "punti", minzoom: 6.2, layout: { "text-field": ["get", "nome"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-letter-spacing": 0.12, "text-offset": [0, 1.7], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": "#eef3f6", "text-halo-color": "#040607", "text-halo-width": 1.6 } });
  map.on("click", "icone", (ev: any) => apri(ev.features[0].properties.id, false));
  map.on("mouseenter", "icone", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "icone", () => (map.getCanvas().style.cursor = ""));
  onda();
}
let raf = 0;
function onda() {
  if (calmo()) return;
  cancelAnimationFrame(raf);
  const t0 = performance.now();
  const step = (t: number) => {
    const p = ((t - t0) % 2600) / 2600;
    if (map.getLayer("onda")) { map.setPaintProperty("onda", "circle-radius", 14 + p * 26); map.setPaintProperty("onda", "circle-stroke-opacity", 0.55 * (1 - p)); }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
map.on("style.load", livelli);
map.on("error", (e: any) => console.warn("mappa:", e?.error?.message));
caricaStile();
function aggiornaMappa() {
  const d = dati();
  map.getSource("punti")?.setData(d.punti);
  map.getSource("aree")?.setData(d.aree);
  map.getSource("tratti")?.setData(d.tratti);
}

// barra di stato e filtri
function contatori() {
  const l = filtrati(), bl = l.filter((e) => e.tipo === "blocco" && e.stato === "in_corso").length;
  $("#counters").innerHTML = [[l.filter((e) => e.stato === "in_corso").length, "In corso", ""], [bl, "Blocchi", bl ? "hot" : ""],
    [l.filter((e) => e.stato === "annunciato").length, "Annunciati", ""], [ora("2026-10-22T20:00"), "Ora sim.", ""]]
    .map(([n, t, c]) => `<div class="counter"><span class="n ${c}">${n}</span><span class="l">${t}</span></div>`).join("");
}
function filtri() {
  const tipi = (Object.keys(TIPI) as Tipo[]).map((t) => `<button class="f" data-tipo="${t}" aria-pressed="${st.tipi.has(t)}">${iconaSvg(t, "pieno", 12)}${TIPI[t].label}</button>`).join("");
  const quando = ([["tutto", "Tutto"], ["ora", "In corso"], ["7g", "Prossimi 7 giorni"]] as const).map(([k, l]) => `<button class="f" data-quando="${k}" aria-pressed="${st.quando === k}">${l}</button>`).join("");
  $("#filters").innerHTML = `${tipi}<span class="f-sep"></span>${quando}<span class="f-sep"></span><button class="f" data-vai="sud">Sud</button><button class="f" data-vai="italia">Italia</button>`;
}
$("#filters").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.dataset.tipo) { const t = b.dataset.tipo as Tipo; if (st.tipi.has(t) && st.tipi.size > 1) st.tipi.delete(t); else st.tipi.add(t); }
  if (b.dataset.quando) st.quando = b.dataset.quando as typeof st.quando;
  if (b.dataset.vai) map.fitBounds(b.dataset.vai === "sud" ? SUD : ITALIA, { padding: 40, duration: 900 });
  aggiorna();
});

// pannello: elenco e scheda
const panel = $("#panel"), body = $("#panel-body");
function elenco() {
  const ord = { in_corso: 0, annunciato: 1, concluso: 2 };
  const l = [...filtrati()].sort((a, b) => ord[a.stato] - ord[b.stato] || +new Date(b.aggiornato) - +new Date(a.aggiornato));
  body.innerHTML = `<div class="head"><h2>${l.length} eventi</h2><span class="data">Italia · 22/10 20:00</span></div>
  <button class="mob" id="naz" aria-pressed="${st.nazionale}"><span class="t">Sciopero nazionale dei trasporti, 30/10</span>
  <span class="s">Mobilitazione su tutta Italia, senza un punto sulla mappa. ${st.nazionale ? "Tocca per tornare a tutti gli eventi." : "Tocca per vedere i 2 eventi locali collegati."}</span></button>
  <div class="rows" role="list">${l.length ? l.map((e) => `<button class="row" role="listitem" data-id="${e.id}" aria-current="${st.sel === e.id}">
    <span class="ic">${iconaSvg(e.tipo, variante(e), 20)}</span><span class="t">${titolo(e)}</span><span class="w data">${fa(e.aggiornato)}</span>
    <span class="m"><span>${STATI[e.stato]}, ${giorno(e.inizio)}</span><span class="cr">${credibilita(e).label}</span></span></button>`).join("")
    : `<p class="none">Nessun evento con questi filtri. Riattiva un tipo o scegli "Tutto".</p>`}</div>`;
  $("#naz").onclick = () => { st.nazionale = !st.nazionale; aggiorna(); };
}
body.addEventListener("click", (ev) => {
  const it = (ev.target as HTMLElement).closest(".row") as HTMLElement | null;
  if (it) apri(it.dataset.id!, true);
});

function decodifica(el: HTMLElement, testo: string) {
  if (calmo()) { el.textContent = testo; return; }
  const segni = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#";
  let i = 0;
  const id = setInterval(() => {
    i += 1;
    el.textContent = testo.split("").map((ch, k) => (k < i || ch === " " ? ch : segni[(Math.random() * segni.length) | 0])).join("");
    if (i >= testo.length) clearInterval(id);
  }, 28);
}

function apri(id: string, daElenco: boolean) {
  st.sel = id;
  const e = EVENTI.find((x) => x.id === id)!, c = credibilita(e), pk = pacchetti(e);
  const tot = pk.reduce((a, x) => a + x.w, 0), seg = 24;
  const pieni = Math.round((Math.max(0, Math.min(tot, SCALA)) / SCALA) * seg), soglia = (SOGLIA / SCALA) * 100;
  const v = variante(e);
  body.innerHTML = `<button class="back" id="back">← Tutti gli eventi</button>
  <h2 class="d-title">${titolo(e)}</h2>
  <p class="d-place">${e.luogo}, ${e.regione}</p>
  <div class="states"><span class="st">${iconaSvg(e.tipo, v, 12)} ${STATI[e.stato]}</span><span class="st ${c.cls}">${c.label}</span><span class="st">${e.categoria}</span></div>
  ${e.contraddittorio ? `<p class="alert warn">Due fonti descrivono la situazione in modo incompatibile. L'evento resta visibile con questo avviso finché una fonte successiva non chiarisce.</p>` : ""}
  ${!e.fonti.length ? `<p class="alert user">Nessuna fonte giornalistica o ufficiale finora. È visibile perché ${e.segnalatori} segnalatori diversi lo hanno indicato nello stesso punto entro 2 ore. Scompare dopo 6 ore senza nuove segnalazioni.</p>` : ""}
  <section class="block"><h3>Integrità</h3><div class="meter">
    <div class="meter-top"><b class="data">${tot.toFixed(2)}</b><span class="data">soglia ${SOGLIA.toFixed(2)}${!e.fonti.length ? " · regola segnalazioni" : ""}</span></div>
    <div class="bar">${Array.from({ length: seg }, (_, i) => `<i class="${i < pieni ? "on" : ""} ${tot < 0 ? "neg" : ""}"></i>`).join("")}<span class="th" style="left:${soglia}%"></span></div>
  </div>
  <ol class="packets">${pk.map((p, i) => `<li class="pk" style="--i:${i}"><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="p">${p.nome}</span><span class="w data ${p.w < 0 ? "neg" : ""}">${p.w > 0 ? "+" : ""}${p.w.toFixed(2)}</span>
    <span class="k">${p.tipo}</span><span class="d">${p.quando}</span></li>`).join("")}</ol></section>
  <section class="block"><h3>Evento</h3><dl class="kv">
    <dt>Precisione</dt><dd>${e.precisione === "comune" ? "Noto solo il comune, area tratteggiata" : "Punto indicato dalle fonti"}</dd>
    <dt>Inizio</dt><dd class="data">${dataOra(e.inizio)}</dd><dt>Fine</dt><dd class="data">${e.fine ? dataOra(e.fine) : "Non indicata"}</dd>
    <dt>Traffico</dt><dd>${e.traffico}</dd><dt>Aggiornato</dt><dd class="data">${dataOra(e.aggiornato)}</dd></dl></section>
  <section class="block"><h3>Cronologia</h3><ol class="tl">${e.cronologia.map(([w, k, t]) => `<li><span class="w">${dataOra(w)}</span><span><span class="k">${k}</span><br>${t}</span></li>`).join("")}</ol></section>
  <div class="acts">${e.stato !== "concluso" ? `<button class="btn primary" id="conf">Sono sul posto, confermo</button>` : ""}<button class="btn" id="err">Segnala un errore</button></div><div id="msg"></div>`;
  $("#back").onclick = chiudi;
  $("#err").onclick = () => ($("#msg").innerHTML = `<p class="msg">Nel sito reale l'evento verrebbe nascosto in via cautelativa e verificato entro 48 ore. Qui non viene inviato nulla.</p>`);
  const cf = document.getElementById("conf");
  if (cf) cf.onclick = () => ($("#msg").innerHTML = `<p class="msg">Nel sito reale la conferma conterebbe come segnalazione, con controllo di vicinanza facoltativo. Qui non viene inviato nulla.</p>`);
  body.scrollTop = 0;
  if (!desktop() && panel.dataset.state === "peek") panel.dataset.state = "half";
  marcaElenco();
  const pad = desktop() ? { left: 430, top: 150, right: 80, bottom: 80 } : { top: 140, bottom: window.innerHeight * 0.55, left: 30, right: 30 };
  map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), e.precisione === "comune" ? 11 : 13.6), pitch: desktop() ? 52 : 40, padding: pad, duration: calmo() ? 0 : daElenco ? 1400 : 800, essential: true });
  aggancia(e);
}
function chiudi() { st.sel = null; sgancia(); aggiorna(); }
function marcaElenco() { body.querySelectorAll(".row").forEach((r) => r.setAttribute("aria-current", String((r as HTMLElement).dataset.id === st.sel))); }

// aggancio: mirino sul punto e filo fino al pannello
const lock = $("#lock"), tag = $("#lock-tag"), line = document.getElementById("leader-line")!, dot = document.getElementById("leader-dot")!;
let agganciato: Evento | null = null;
function aggancia(e: Evento) {
  agganciato = e;
  lock.hidden = false; lock.classList.remove("on");
  void lock.offsetWidth;
  requestAnimationFrame(() => lock.classList.add("on"));
  decodifica(tag, `${TIPI[e.tipo].label} · ${e.comune}`.toUpperCase());
  segui();
}
function sgancia() { agganciato = null; lock.hidden = true; line.setAttribute("points", ""); dot.setAttribute("r", "0"); }
function segui() {
  if (!agganciato) return;
  const p = map.project(agganciato.lngLat);
  lock.style.transform = `translate(${p.x}px, ${p.y}px)`;
  lock.classList.toggle("flip", p.x > window.innerWidth - 240);
  const pr = panel.getBoundingClientRect();
  const [ax, ay] = desktop() ? [pr.right, Math.min(Math.max(p.y, 120), window.innerHeight - 40)] : [Math.min(Math.max(p.x, 24), window.innerWidth - 24), pr.top];
  const mid = desktop() ? `${ax + 28},${ay}` : `${ax},${ay - 22}`;
  line.setAttribute("points", `${p.x},${p.y} ${mid} ${ax},${ay}`);
  dot.setAttribute("cx", String(ax)); dot.setAttribute("cy", String(ay)); dot.setAttribute("r", "3");
}
map.on("move", segui);
window.addEventListener("resize", segui);
panel.addEventListener("transitionend", segui);

function aggiorna() { filtri(); contatori(); aggiornaMappa(); if (st.sel) apri(st.sel, false); else elenco(); }

// trascinamento del pannello su telefono
const stati = ["peek", "half", "full"] as const;
let y0 = 0, t0 = 0, mosso = false;
const grip = $("#grip");
grip.addEventListener("click", () => { if (mosso) return; const i = stati.indexOf(panel.dataset.state as any); panel.dataset.state = stati[(i + 1) % 3]; });
grip.addEventListener("pointerdown", (ev) => { y0 = ev.clientY; mosso = false; t0 = panel.getBoundingClientRect().top; panel.classList.add("dragging"); grip.setPointerCapture(ev.pointerId); });
grip.addEventListener("pointermove", (ev) => {
  if (!panel.classList.contains("dragging")) return;
  const dy = ev.clientY - y0; if (Math.abs(dy) > 4) mosso = true;
  panel.style.transform = `translateY(${Math.max(window.innerHeight * 0.14, t0 + dy) - window.innerHeight * 0.14}px)`;
  segui();
});
grip.addEventListener("pointerup", () => {
  panel.classList.remove("dragging"); panel.style.transform = "";
  if (mosso) { const top = panel.getBoundingClientRect().top / window.innerHeight; panel.dataset.state = top < 0.32 ? "full" : top < 0.72 ? "half" : "peek"; }
  setTimeout(() => (mosso = false), 0);
});

aggiorna();
