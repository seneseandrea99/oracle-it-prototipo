// ORACLE IT · variante "Telescrivente": il notiziario delle fonti guida, il globo risponde.
// Tutti i dati sono inventati (src/data.ts, is_test = true).
import "./style.css";
import { EVENTI, ORA, type Evento, type Tipo, type FonteTipo } from "../../src/data";

declare const maplibregl: any;

type Forma = "quadrato" | "rombo" | "triangolo" | "cerchio";
const TIPI: Record<Tipo, { label: string; plur: string; forma: Forma }> = {
  blocco: { label: "Blocco", plur: "Blocchi", forma: "quadrato" },
  presidio: { label: "Presidio", plur: "Presìdi", forma: "cerchio" },
  corteo: { label: "Corteo", plur: "Cortei", forma: "triangolo" },
  sciopero: { label: "Sciopero", plur: "Scioperi", forma: "rombo" },
};
const ORDINE: Tipo[] = ["blocco", "presidio", "corteo", "sciopero"];
const STATI = { in_corso: "In corso", annunciato: "Annunciato", concluso: "Concluso" } as const;
const FONTE: Record<FonteTipo, string> = { ufficiale: "Ente ufficiale", agenzia: "Agenzia di stampa", testata: "Testata", parte: "Promotori" };
const PESO: Record<FonteTipo, number> = { ufficiale: 1, agenzia: 0.6, testata: 0.5, parte: 0.3 };
const SOGLIA = 0.8;
const ITALIA: [[number, number], [number, number]] = [[6.4, 36.4], [18.8, 47.1]];

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const giorno = (d: string) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const ora = (d: string) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dataOra = (d: string) => `${giorno(d)} ${ora(d)}`;
const num = (n: number) => (n < 0 ? "−" : "") + Math.abs(n).toFixed(2).replace(".", ",");
const desktop = () => matchMedia("(min-width: 1000px)").matches;
const calmo = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const titolo = (e: Evento) => `${TIPI[e.tipo].label} a ${e.comune}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// ---------- credibilità ----------
interface Pezzo { nome: string; tipo: string; quando: string; w: number; neg: boolean; utenti: boolean }
function pezzi(e: Evento): Pezzo[] {
  const r: Pezzo[] = e.fonti.map((f) => ({
    nome: f.nome, tipo: FONTE[f.tipo] + (f.smentisce ? ", smentisce" : f.annuncio ? ", annuncio" : ""), quando: dataOra(f.pubblicata),
    w: f.smentisce ? -0.6 : f.tipo === "parte" && f.annuncio ? 0.6 : PESO[f.tipo], neg: !!f.smentisce, utenti: false,
  }));
  if (e.segnalatori) {
    let u = 0;
    for (let i = 0; i < e.segnalatori; i++) u += 0.1 * Math.pow(0.85, i);
    r.push({ nome: `${e.segnalatori} segnalatori diversi`, tipo: "Segnalazioni, peso decrescente", quando: dataOra(e.aggiornato), w: Math.min(0.6, +u.toFixed(2)), neg: false, utenti: true });
  }
  return r;
}
const totale = (e: Evento) => pezzi(e).reduce((a, p) => a + p.w, 0);
const conferme = (e: Evento) => e.fonti.filter((f) => !f.smentisce).length;
function verdetto(e: Evento) {
  if (e.contraddittorio) return { txt: "Fonti discordanti", cls: "disc" };
  if (!e.fonti.length) return { txt: `Solo segnalazioni (${e.segnalatori})`, cls: "utenti" };
  const n = conferme(e);
  if (e.fonti.some((f) => f.tipo === "ufficiale")) return { txt: n > 1 ? `Ufficiale + ${n - 1}` : "Fonte ufficiale", cls: "ok" };
  return { txt: n === 1 ? "1 fonte" : `${n} fonti indipendenti`, cls: "ok" };
}
const variante = (e: Evento) => (e.stato === "concluso" ? "concluso" : !e.fonti.length ? "utenti" : e.stato === "annunciato" ? "vuoto" : "pieno");

// ---------- segni ----------
function forma(f: Forma, s = 7) {
  return f === "quadrato" ? `<rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}"/>`
    : f === "rombo" ? `<polygon points="0,${-s - 1.5} ${s + 1.5},0 0,${s + 1.5} ${-s - 1.5},0"/>`
    : f === "triangolo" ? `<polygon points="0,${-s - 1.5} ${s + 1},${s - 0.5} ${-s - 1},${s - 0.5}"/>` : `<circle r="${s}"/>`;
}
function glifo(tipo: Tipo, v: string, size = 16) {
  const pieno = v === "pieno" || v === "concluso";
  return `<svg class="gl gl-${v}" viewBox="-11 -11 22 22" width="${size}" height="${size}" aria-hidden="true"><g fill="${pieno ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" ${v === "utenti" ? 'stroke-dasharray="2.6 2.2"' : ""}>${forma(TIPI[tipo].forma)}</g></svg>`;
}
// nastro breve: i pezzi di conferma messi uno dopo l'altro fino alla soglia
function nastrino(e: Evento) {
  const W = 72, max = 1.4, x = (v: number) => (Math.max(0, Math.min(v, max)) / max) * W;
  let acc = 0, s = `<svg class="nn" viewBox="0 -1 ${W} 10" width="${W}" height="10" aria-hidden="true"><rect x="0" y="3" width="${W}" height="2" class="nn-base"/>`;
  for (const p of pezzi(e)) {
    if (p.neg) { s += `<rect x="${x(acc + p.w)}" y="0" width="${Math.max(1, x(acc) - x(acc + p.w))}" height="8" class="nn-neg"/>`; acc += p.w; continue; }
    const a = x(acc), b = x(acc + p.w);
    s += `<rect x="${a}" y="0" width="${Math.max(1, b - a - 1.5)}" height="8" class="${p.utenti ? "nn-ut" : "nn-p"}"/>`;
    acc += p.w;
  }
  return s + `<rect x="${x(SOGLIA) - 0.5}" y="-1" width="1.5" height="10" class="nn-th"/></svg>`;
}

// ---------- stato ----------
const st = { tipi: new Set<Tipo>(ORDINE), quando: "tutto" as "tutto" | "ora" | "7g", nazionale: false, sel: null as string | null, vista: "filo" as "filo" | "metodo" | "segnala" };
const filtrati = () => EVENTI.filter((e) => st.tipi.has(e.tipo)
  && (st.quando === "tutto" || (st.quando === "ora" ? e.stato === "in_corso" : e.stato !== "concluso" && +new Date(e.inizio) - +ORA < 7 * 864e5))
  && (!st.nazionale || e.nazionale));

// ---------- mappa ----------
const SATELLITE = {
  eox: { tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"], maxzoom: 15,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX IT Services GmbH</a> (dati Copernicus Sentinel 2020)' },
  esri: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], maxzoom: 18,
    attribution: "Immagini: Esri, Maxar, Earthstar Geographics" },
};
let map: any = null;
try {
  map = new maplibregl.Map({
    container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#070b12" } }] },
    center: [12.8, 41.6], zoom: calmo() ? 4.6 : 2.1, minZoom: 1.6, maxZoom: 17.5, maxPitch: 60,
    attributionControl: { compact: true }, dragRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
} catch {
  $("#maperr").hidden = false;
}

function satellite(style: any) {
  const strade = ["match", ["get", "class"], ["motorway"], "rgba(232,237,244,.55)", ["trunk", "primary"], "rgba(232,237,244,.32)", ["secondary", "tertiary"], "rgba(232,237,244,.18)", "rgba(232,237,244,.08)"];
  const tenute = (style.layers || []).filter((l: any) => {
    const id = String(l.id), sl = String(l["source-layer"] || "");
    if (l.type === "line" && sl === "transportation") { l.paint = { ...(l.paint || {}), "line-color": strade }; delete l.paint["line-gradient"]; delete l.paint["line-dasharray"]; return !/casing|tunnel|rail|path|ferry/.test(id); }
    if (l.type === "line" && sl === "boundary") { l.paint = { ...(l.paint || {}), "line-color": "rgba(232,237,244,.4)" }; return true; }
    if (l.type === "symbol" && /place|city|town|village|capital|state|country/.test(id)) {
      l.paint = { ...(l.paint || {}), "text-color": "#c9d3e0", "text-halo-color": "rgba(4,7,12,.9)", "text-halo-width": 1.4, "icon-opacity": 0 };
      return true;
    }
    return false;
  });
  style.sources = style.sources || {};
  style.sources.satellite = { type: "raster", tileSize: 256, ...SATELLITE.eox };
  style.layers = [
    { id: "spazio", type: "background", paint: { "background-color": "#0b1a2c" } },
    { id: "satellite", type: "raster", source: "satellite", paint: { "raster-opacity": 0.86, "raster-brightness-max": 0.62, "raster-saturation": -0.82, "raster-contrast": 0.18, "raster-fade-duration": 200 } },
    ...tenute,
  ];
  style.projection = { type: "globe" };
  style.sky = { "sky-color": "#04070d", "horizon-color": "#4f7fa8", "fog-color": "#070b12", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.35,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0] };
  return style;
}
function padding() {
  if (desktop()) return { top: 40, bottom: 150, left: 40, right: 40 };
  return { top: 70, bottom: Math.round(window.innerHeight * 0.36) + 10, left: 14, right: 14 };
}
if (map) {
  let erroriSat = 0;
  map.on("error", (e: any) => {
    if (e?.sourceId === "satellite") { if (++erroriSat === 4) map.getSource("satellite")?.setTiles?.(SATELLITE.esri.tiles); }
    else console.warn("mappa:", e?.error?.message);
  });
  map.once("style.load", () => { if (!st.sel) map.fitBounds(ITALIA, { padding: padding(), duration: calmo() ? 0 : 2200, essential: true }); });
  (async () => {
    try {
      const r = await fetch("https://tiles.openfreemap.org/styles/liberty");
      if (!r.ok) throw new Error(String(r.status));
      map.setStyle(satellite(await r.json()));
    } catch {
      map.setStyle(satellite({ version: 8, sources: {}, layers: [] }));
    }
  })();
  map.on("style.load", strati);
  map.on("zoom", () => $("#map").classList.toggle("vicino", map.getZoom() >= 6.4));
}

function cerchio([lng, lat]: [number, number], km: number) {
  const p: [number, number][] = [];
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; p.push([lng + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 110.57) * Math.sin(a)]); }
  return p;
}
let regioniGeo: any = null;
function intensita() {
  const l = filtrati().filter((e) => e.stato !== "concluso");
  return { ...regioniGeo, features: regioniGeo.features.map((f: any) => ({ ...f, properties: { ...f.properties, n: l.filter((e) => e.regione === f.properties.regione).length } })) };
}
function geo() {
  const ev = filtrati();
  return {
    aree: { type: "FeatureCollection", features: ev.filter((e) => e.precisione === "comune").map((e) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [cerchio(e.lngLat, 3)] }, properties: { id: e.id } })) },
    tratti: { type: "FeatureCollection", features: ev.filter((e) => e.tratto).map((e) => ({ type: "Feature", geometry: { type: "LineString", coordinates: e.tratto }, properties: {} })) },
  };
}
function strati() {
  if (map.getSource("aree")) return;
  const d = geo();
  map.addSource("aree", { type: "geojson", data: d.aree });
  map.addSource("tratti", { type: "geojson", data: d.tratti });
  map.addLayer({ id: "aree-fill", type: "fill", source: "aree", paint: { "fill-color": "#8fd3ff", "fill-opacity": 0.07 } });
  map.addLayer({ id: "aree-line", type: "line", source: "aree", paint: { "line-color": "#e8edf4", "line-opacity": 0.75, "line-width": 1.1, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "tratti", type: "line", source: "tratti", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#8fd3ff", "line-width": 3, "line-dasharray": [1.5, 1] } });
  fetch("../../regioni.json").then((r) => r.json()).then((rg) => {
    regioniGeo = rg;
    map.addSource("regioni", { type: "geojson", data: intensita() });
    map.addLayer({ id: "regioni-fill", type: "fill", source: "regioni", paint: { "fill-color": "#8fd3ff", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, ["step", ["get", "n"], 0, 1, 0.07, 2, 0.11, 3, 0.16], 9, ["step", ["get", "n"], 0, 1, 0.015, 2, 0.02, 3, 0.03]] } }, "aree-fill");
    map.addLayer({ id: "regioni-line", type: "line", source: "regioni", paint: { "line-color": "rgba(232,237,244,.22)", "line-width": 0.6 } }, "aree-fill");
  }).catch(() => {});
}

// segnaposti HTML: forma per tipo, pieno o vuoto per stato, tacche per le conferme
const segni = new Map<string, any>();
function segnaposti() {
  if (!map) return;
  const vis = new Set(filtrati().map((e) => e.id));
  for (const e of EVENTI) {
    let m = segni.get(e.id);
    if (!m) {
      const el = document.createElement("button");
      el.className = `pt v-${variante(e)} ${e.contraddittorio ? "disc" : ""} ${e.stato === "in_corso" ? "vivo" : ""}`;
      el.dataset.id = e.id;
      el.setAttribute("aria-label", `${titolo(e)}, ${STATI[e.stato]}, ${verdetto(e).txt}`);
      const n = e.fonti.length ? conferme(e) : 0;
      el.innerHTML = `${glifo(e.tipo, variante(e), 20)}<span class="pt-tac" aria-hidden="true">${"<i></i>".repeat(n)}${e.segnalatori ? "<i class=u></i>" : ""}</span><span class="pt-nome">${e.comune}</span>`;
      el.addEventListener("click", (ev) => { ev.stopPropagation(); apri(e.id, "mappa"); });
      m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(e.lngLat);
      segni.set(e.id, m);
    }
    const el = m.getElement() as HTMLElement;
    el.classList.toggle("sel", st.sel === e.id);
    if (vis.has(e.id)) { if (!el.isConnected) m.addTo(map); } else m.remove();
  }
}
function aggiornaMappa() {
  if (!map) return;
  segnaposti();
  const d = geo();
  map.getSource("aree")?.setData(d.aree); map.getSource("tratti")?.setData(d.tratti);
  if (regioniGeo) map.getSource("regioni")?.setData(intensita());
}

// ---------- decodifica rapida ----------
const SEGNI = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/·";
function decodifica(el: HTMLElement, testo: string, durata = 220, ritardo = 0) {
  if (calmo()) { el.textContent = testo; return; }
  const t0 = performance.now() + ritardo;
  el.textContent = testo.replace(/\S/g, " ");
  const passo = (t: number) => {
    if (t < t0) { requestAnimationFrame(passo); return; }
    const k = Math.min(1, (t - t0) / durata), fatti = Math.floor(k * testo.length), fronte = Math.min(testo.length, fatti + 4);
    el.textContent = testo.slice(0, fatti) + testo.slice(fatti, fronte).replace(/\S/g, () => SEGNI[(Math.random() * SEGNI.length) | 0]) + testo.slice(fronte).replace(/\S/g, " ");
    if (k < 1) requestAnimationFrame(passo); else el.textContent = testo;
  };
  requestAnimationFrame(passo);
}

// ---------- notiziario ----------
const corpo = $("#corpo"), filo = $("#filo");
function giornoEtichetta(d: string) {
  const g = new Date(d); g.setHours(0, 0, 0, 0);
  const oggi = new Date(ORA); oggi.setHours(0, 0, 0, 0);
  const diff = Math.round((+oggi - +g) / 864e5);
  const lab = g.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  return diff === 0 ? `Oggi, ${lab}` : diff === 1 ? `Ieri, ${lab}` : lab[0].toUpperCase() + lab.slice(1);
}
function lead() {
  const l = filtrati(), attivi = l.filter((e) => e.stato === "in_corso"), blocchi = attivi.filter((e) => e.tipo === "blocco"), disc = l.find((e) => e.contraddittorio);
  if (!attivi.length) return `<p class="lead">Nessun evento in corso con questi filtri.</p>`;
  return `<p class="lead"><span class="fig">${attivi.length}</span> eventi in corso${blocchi.length ? `, di cui <strong>${blocchi.length} ${blocchi.length === 1 ? "blocco" : "blocchi"}</strong> ai porti del Sud (${blocchi.map((e) => e.comune).join(", ")})` : ""}.${disc ? ` A <button class="inl" data-id="${disc.id}">${disc.comune}</button> le fonti si contraddicono.` : ""}</p>`;
}
function filtri() {
  return `<div class="filtri" role="group" aria-label="Filtri">
    <div class="seg" role="group" aria-label="Periodo">${([["tutto", "Tutto"], ["ora", "In corso"], ["7g", "Prossimi 7 giorni"]] as const).map(([k, t]) => `<button data-quando="${k}" aria-pressed="${st.quando === k}">${t}</button>`).join("")}</div>
    <div class="tipi" role="group" aria-label="Tipi di evento">${ORDINE.map((t) => `<button data-tipo="${t}" aria-pressed="${st.tipi.has(t)}">${glifo(t, "pieno", 12)}${TIPI[t].plur}</button>`).join("")}</div>
  </div>`;
}
function riga(e: Evento) {
  const v = verdetto(e), ultima = e.cronologia[e.cronologia.length - 1];
  const fonti = e.fonti.length ? e.fonti.map((f) => `<span class="${f.smentisce ? "neg" : ""}">${esc(f.nome.replace(/ \(esempio\)$/, ""))}${f.smentisce ? " (smentisce)" : ""}</span>`).join("") : `<span>${e.segnalatori} segnalatori, nessuna fonte</span>`;
  const slug = `${e.comune.toUpperCase()} — ${TIPI[e.tipo].label.toUpperCase()}`;
  const aperto = st.sel === e.id;
  return `<li class="dsp ${aperto ? "aperto" : ""} s-${e.stato}" data-ev="${e.id}">
    <button class="dsp-btn" data-id="${e.id}" aria-expanded="${aperto}" aria-label="${esc(`${titolo(e)}. ${STATI[e.stato]}. ${v.txt}. Aggiornato ${dataOra(e.aggiornato)}`)}">
      <span class="dsp-ora fig">${ora(e.aggiornato)}</span>
      <span class="dsp-gl">${glifo(e.tipo, variante(e), 14)}</span>
      <span class="dsp-slug" data-slug="${esc(slug)}">${esc(slug)}</span>
      <span class="stato st-${variante(e)}">${STATI[e.stato]}${e.stato === "annunciato" ? ` ${giorno(e.inizio)}` : ""}</span>
      <span class="dsp-testo">${esc(e.luogo)}. ${esc(ultima[2])}</span>
      <span class="dsp-fonti"><span class="ver v-${v.cls}">${nastrino(e)}${v.txt}</span><span class="nomi">${fonti}</span></span>
    </button>
    ${aperto ? esteso(e) : ""}
  </li>`;
}
function notiziario() {
  const l = [...filtrati()].sort((a, b) => +new Date(b.aggiornato) - +new Date(a.aggiornato));
  let html = "", ultimo = "";
  for (const e of l) {
    const g = giornoEtichetta(e.aggiornato);
    if (g !== ultimo) { if (ultimo) html += `</ol></section>`; html += `<section class="giorno"><h2>${g}</h2><ol class="dispacci">`; ultimo = g; }
    html += riga(e);
  }
  if (ultimo) html += `</ol></section>`;
  return html || `<p class="vuoto">Nessun dispaccio con questi filtri. Scegli «Tutto» o riattiva un tipo.</p>`;
}
function nazionale() {
  return `<button class="naz" data-naz aria-pressed="${st.nazionale}"><span class="naz-a fig">30.10</span><span class="naz-t"><b>Sciopero nazionale dei trasporti</b><span>Riguarda tutta Italia, quindi non ha un punto sul globo. ${st.nazionale ? "Tocca per tornare a tutti i dispacci." : "Tocca per vedere i 2 eventi locali collegati."}</span></span></button>`;
}
function render() {
  if (st.vista !== "filo") return;
  corpo.innerHTML = `${lead()}${filtri()}<div class="feed" role="region" aria-label="Dispacci, i più recenti in alto">${notiziario()}</div>${nazionale()}
    <footer class="piede"><button class="btn" data-vista="segnala">Segnala un evento</button><button class="lnk" data-vista="metodo">Come decidiamo cosa mostrare</button></footer>`;
}

// dispaccio aperto: la scheda completa dentro il notiziario
function esteso(e: Evento) {
  const p = pezzi(e), tot = totale(e);
  let acc = 0; const cum = p.map((x) => { const a = acc; acc += x.w; return [a, acc]; });
  const lo = Math.min(0, ...cum.flat()), hi = Math.max(1.2, ...cum.flat());
  const X = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const sopra = tot >= SOGLIA;
  const esito = !e.fonti.length ? "Visibile con la regola delle segnalazioni: più persone diverse, stesso punto, entro 2 ore."
    : e.contraddittorio ? "Sotto la soglia, ma resta visibile con l'avviso perché la prima fonte lo aveva già fatto pubblicare."
    : sopra ? "Sopra la soglia: per questo è pubblico." : "Sotto la soglia.";
  return `<article class="esteso" aria-label="Dispaccio completo: ${esc(titolo(e))}">
    <header class="es-head">
      <h3>${esc(titolo(e))}</h3>
      <p>${esc(e.luogo)}, ${e.regione} · ${esc(e.categoria)}</p>
    </header>
    ${e.contraddittorio ? `<p class="avviso disc"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.5l7 12.5H1z M8 6v4 M8 11.6v.8"/></svg>Due fonti descrivono la situazione in modo incompatibile. Resta visibile con questo avviso finché una fonte successiva non chiarisce.</p>` : ""}
    ${!e.fonti.length ? `<p class="avviso utenti"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke-dasharray="2.4 2"/><path d="M8 5v3.5 M8 10.6v.8"/></svg>Nessuna fonte giornalistica o ufficiale finora. Scompare dopo 6 ore senza nuove segnalazioni.</p>` : ""}
    <section class="perche">
      <h4>Perché è visibile <span class="fig">${num(tot)} su soglia ${num(SOGLIA)}</span></h4>
      <ol class="cascata" style="--th:${X(SOGLIA)}%">
        ${p.map((x, i) => `<li style="--i:${i}"><span class="ca-n"><b>${esc(x.nome)}</b><span>${x.tipo} · ${x.quando}</span></span><span class="ca-w fig ${x.neg ? "neg" : ""}">${x.w > 0 ? "+" : "−"}${num(Math.abs(x.w))}</span>
          <span class="ca-t"><i class="${x.neg ? "neg" : x.utenti ? "ut" : ""}" style="left:${X(Math.min(cum[i][0], cum[i][1]))}%;width:${Math.abs(X(cum[i][1]) - X(cum[i][0]))}%"></i></span></li>`).join("")}
        <li class="ca-tot"><span class="ca-n"><b>Totale</b><span>${esito}</span></span><span class="ca-w fig">${num(tot)}</span><span class="ca-t"><i class="tot ${tot < 0 ? "neg" : ""}" style="left:${X(Math.min(0, tot))}%;width:${Math.abs(X(tot) - X(0))}%"></i></span></li>
      </ol>
      <p class="ca-leg"><span><i class="k-th"></i>Soglia di pubblicazione ${num(SOGLIA)}</span><span>Riprese della stessa notizia contano una volta</span></p>
    </section>
    <dl class="kv">
      <dt>Inizio</dt><dd class="fig">${dataOra(e.inizio)}</dd>
      <dt>Fine</dt><dd class="fig">${e.fine ? dataOra(e.fine) : "non indicata"}</dd>
      <dt>Posizione</dt><dd>${e.precisione === "comune" ? "Solo il comune (area tratteggiata)" : "Punto indicato dalle fonti"}</dd>
      <dt>Traffico</dt><dd>${esc(e.traffico)}</dd>
    </dl>
    <section class="crono"><h4>Cronologia</h4><ol>${e.cronologia.map(([w, k, t]) => `<li><span class="fig">${dataOra(w)}</span><span><b>${k}.</b> ${esc(t)}</span></li>`).join("")}</ol></section>
    <div class="azioni">${e.stato !== "concluso" ? `<button class="btn" data-msg="conf">Sono sul posto, confermo</button>` : ""}<button class="btn sec" data-msg="err">Segnala un errore</button><button class="lnk" data-chiudi>Chiudi dispaccio</button></div>
    <p class="msg" role="status"></p>
  </article>`;
}

function vista(v: "metodo" | "segnala") {
  st.vista = v; chiudiAggancio();
  corpo.innerHTML = v === "metodo"
    ? `<div class="pagina"><button class="lnk indietro" data-vista="filo">← Torna alla telescrivente</button><h2>Come decidiamo cosa mostrare</h2>
      <p>Un evento diventa pubblico quando le fonti indipendenti, sommate, superano la soglia di ${num(SOGLIA)}. Le riprese della stessa notizia contano una volta sola. Una smentita sottrae peso.</p>
      <dl class="kv"><dt>Ente ufficiale</dt><dd class="fig">${num(1)}</dd><dt>Agenzia di stampa</dt><dd class="fig">${num(0.6)}</dd><dt>Testata</dt><dd class="fig">${num(0.5)}</dd><dt>Promotori</dt><dd class="fig">${num(0.3)}</dd><dt>Segnalazioni</dt><dd class="fig">fino a ${num(0.6)}</dd></dl>
      <p>Mostriamo solo eventi e infrastrutture, mai persone. La posizione è precisa quanto le fonti: un punto, oppure solo il comune.</p></div>`
    : `<div class="pagina"><button class="lnk indietro" data-vista="filo">← Torna alla telescrivente</button><h2>Segnala un evento</h2>
      <p>Nel sito reale: posa il segnaposto sul punto, scegli tipo, ora e l'effetto sul traffico. Niente foto e niente testo libero pubblico.</p>
      <p>Prima di inviare ti mostriamo gli eventi già noti vicino a te: se il tuo è uno di questi, basta confermarlo. In questo prototipo non viene inviato nulla.</p></div>`;
  if (!desktop()) filo.dataset.state = "half";
}

corpo.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button") as HTMLElement | null;
  if (!b) return;
  if (b.dataset.quando) { st.quando = b.dataset.quando as typeof st.quando; aggiorna(); }
  else if (b.dataset.tipo) { const k = b.dataset.tipo as Tipo; if (st.tipi.has(k) && st.tipi.size > 1) st.tipi.delete(k); else st.tipi.add(k); aggiorna(); }
  else if (b.dataset.naz !== undefined) { st.nazionale = !st.nazionale; aggiorna(); }
  else if (b.dataset.chiudi !== undefined) chiudi();
  else if (b.dataset.msg) {
    const m = b.closest(".esteso")?.querySelector(".msg") as HTMLElement;
    m.textContent = b.dataset.msg === "conf" ? "Nel sito reale la conferma conterebbe come segnalazione. Qui non viene inviato nulla." : "Nel sito reale l'evento verrebbe nascosto in via cautelativa e verificato entro 48 ore. Qui non viene inviato nulla.";
  }
  else if (b.dataset.vista) { if (b.dataset.vista === "filo") { st.vista = "filo"; render(); } else vista(b.dataset.vista as "metodo" | "segnala"); }
  else if (b.dataset.id) { if (st.sel === b.dataset.id && b.classList.contains("dsp-btn")) chiudi(); else apri(b.dataset.id, "filo"); }
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && st.sel) chiudi(); });

function apri(id: string, da: "filo" | "mappa" | "nastro") {
  const e = EVENTI.find((x) => x.id === id)!;
  st.vista = "filo"; st.sel = id;
  if (!filtrati().includes(e)) { st.quando = "tutto"; st.nazionale = false; st.tipi.add(e.tipo); }
  render(); segnaposti(); disegnaNastro();
  if (!desktop() && filo.dataset.state === "peek") filo.dataset.state = "half";
  const li = corpo.querySelector(`[data-ev="${id}"]`) as HTMLElement | null;
  if (li) {
    const top = corpo.scrollTop + li.getBoundingClientRect().top - corpo.getBoundingClientRect().top - 30;
    corpo.scrollTo({ top, behavior: calmo() || da === "filo" ? "auto" : "smooth" });
    const s = li.querySelector(".dsp-slug") as HTMLElement; decodifica(s, s.dataset.slug!, 200);
  }
  if (map) {
    const pad = desktop() ? { top: 60, bottom: 160, left: 60, right: 60 } : { top: 80, bottom: Math.round(window.innerHeight * 0.62), left: 30, right: 30 };
    map.flyTo({ center: e.lngLat, zoom: e.precisione === "comune" ? 10.5 : 12.8, pitch: desktop() ? 40 : 30, padding: pad, duration: calmo() ? 0 : 1300, essential: true });
  }
  aggancia(e);
}
function chiudi() {
  st.sel = null; chiudiAggancio(); render(); segnaposti(); disegnaNastro();
  if (map) map.flyTo({ center: [12.8, 41.6], zoom: Math.min(map.getZoom(), desktop() ? 5.3 : 4.6), pitch: 0, padding: padding(), duration: calmo() ? 0 : 900, essential: true });
}

// ---------- aggancio: mirino sul punto e filo dal dispaccio ----------
const lock = $("#lock"), tag = $("#lock-tag"), line = document.getElementById("leader-line")!, la = document.getElementById("leader-a")!, lb = document.getElementById("leader-b")!;
let preso: Evento | null = null;
function aggancia(e: Evento) {
  preso = e; lock.hidden = false; lock.classList.remove("on"); void lock.offsetWidth;
  requestAnimationFrame(() => lock.classList.add("on"));
  decodifica(tag, `${TIPI[e.tipo].label} · ${e.comune}\n${e.lngLat[1].toFixed(3)}N ${e.lngLat[0].toFixed(3)}E · ${e.precisione === "comune" ? "AREA COMUNE" : "PUNTO"}`.toUpperCase(), 240);
  segui();
}
function chiudiAggancio() { preso = null; lock.hidden = true; line.setAttribute("points", ""); la.setAttribute("r", "0"); lb.setAttribute("r", "0"); }
function segui() {
  if (!preso || !map) return;
  const p = map.project(preso.lngLat), box = $(".globo").getBoundingClientRect();
  lock.style.transform = `translate(${p.x}px, ${p.y}px)`; lock.classList.toggle("flip", p.x > box.width - 260);
  const gx = box.left + p.x, gy = box.top + p.y;
  const fuori = gx < box.left || gx > box.right || gy < box.top || gy > box.bottom;
  const li = corpo.querySelector(".dsp.aperto") as HTMLElement | null;
  const coperto = !desktop() && gy > filo.getBoundingClientRect().top - 8;
  if (fuori || coperto || !li) { line.setAttribute("points", ""); la.setAttribute("r", "0"); lb.setAttribute("r", "0"); return; }
  let ax: number, ay: number, mid: string;
  const f = filo.getBoundingClientRect();
  if (desktop()) {
    const r = (li.querySelector(".dsp-btn") as HTMLElement).getBoundingClientRect();
    ax = f.right; ay = Math.min(Math.max(r.top + 18, f.top + 20), f.bottom - 20);
    mid = `${ax + 24},${ay}`;
  } else {
    ax = Math.min(Math.max(gx, 28), window.innerWidth - 28); ay = f.top; mid = `${ax},${ay - 16}`;
  }
  line.setAttribute("points", `${ax},${ay} ${mid} ${gx},${gy}`);
  la.setAttribute("cx", String(ax)); la.setAttribute("cy", String(ay)); la.setAttribute("r", "3");
  lb.setAttribute("cx", String(gx)); lb.setAttribute("cy", String(gy)); lb.setAttribute("r", "2");
}
if (map) map.on("move", segui);
corpo.addEventListener("scroll", segui, { passive: true });
filo.addEventListener("transitionend", segui);
window.addEventListener("resize", () => { disegnaNastro(); segui(); });

// ---------- nastro del tempo (desktop): ultime 24 ore a sinistra, prossimi 8 giorni a destra ----------
const T0 = +ORA - 24 * 36e5, T1 = +ORA + 8 * 864e5;
function disegnaNastro() {
  const el = $("#nastro");
  if (!desktop()) { el.innerHTML = ""; return; }
  const w = Math.max(320, el.clientWidth - 32), padL = 70, padR = 10, lane = 15, top = 20, h = top + ORDINE.length * lane + 2, now = padL + (w - padL - padR) * 0.3;
  const x = (t: number) => t <= +ORA ? padL + ((t - T0) / (+ORA - T0)) * (now - padL) : now + ((t - +ORA) / (T1 - +ORA)) * (w - padR - now);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="group" aria-label="Eventi nel tempo">`;
  const tick = (t: number, lab: string, anchor = "middle") => (s += `<line x1="${x(t)}" x2="${x(t)}" y1="14" y2="${h}" class="nt-g"/><text class="nt-t" x="${x(t)}" y="10" text-anchor="${anchor}">${lab}</text>`);
  tick(T0, "−24 h", "start"); tick(+ORA - 12 * 36e5, "−12 h");
  for (let dd = 1; dd <= 8; dd++) { const t = new Date(ORA); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + dd); if (+t < T1 && x(+t) - now > 30) tick(+t, `${t.getDate()}/${t.getMonth() + 1}`); }
  s += `<line x1="${now}" x2="${now}" y1="12" y2="${h}" class="nt-ora"/><text class="nt-t nt-adesso" x="${now}" y="10" text-anchor="middle">ora 20:00</text>`;
  ORDINE.forEach((t, i) => (s += `<text class="nt-t nt-l" x="0" y="${top + i * lane + 11}">${TIPI[t].plur}</text>`));
  for (const e of filtrati()) {
    if (+new Date(e.fine ?? e.inizio) < T0 && e.stato !== "in_corso") continue;
    const i = ORDINE.indexOf(e.tipo), y = top + i * lane + 7, v = variante(e);
    const a = Math.max(+new Date(e.inizio), T0), b = Math.min(e.fine ? +new Date(e.fine) : e.stato === "in_corso" ? +ORA : +new Date(e.inizio), T1);
    const xa = x(a), xb = Math.max(x(b), xa);
    s += `<g class="nt-mk ${st.sel === e.id ? "sel" : ""} v-${v}" data-id="${e.id}" tabindex="0" role="button" aria-label="${esc(`${titolo(e)}, ${STATI[e.stato]}, ${dataOra(e.inizio)}`)}">
      <rect class="hit" x="${xa - 8}" y="${y - 7}" width="${xb - xa + 16}" height="14" fill="transparent"/>
      ${xb - xa > 2 ? `<line x1="${xa}" x2="${xb}" y1="${y}" y2="${y}" class="nt-bar" ${v === "utenti" ? 'stroke-dasharray="3 2"' : ""}/>` : ""}
      <g transform="translate(${xa},${y}) scale(.6)" class="nt-gl">${forma(TIPI[e.tipo].forma)}</g></g>`;
  }
  el.innerHTML = s + "</svg>";
}
$("#nastro").addEventListener("click", (ev) => { const m = (ev.target as Element).closest(".nt-mk") as HTMLElement | null; if (m) apri(m.dataset.id!, "nastro"); });
$("#nastro").addEventListener("keydown", (ev) => { const m = (ev.target as Element).closest(".nt-mk") as HTMLElement | null; if (m && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); apri(m.dataset.id!, "nastro"); } });

function aggiorna() {
  render(); aggiornaMappa(); disegnaNastro();
  if (st.sel && !filtrati().some((e) => e.id === st.sel)) { st.sel = null; chiudiAggancio(); render(); }
  segui();
}

// ---------- avvio: collegamento della telescrivente (< 1 s, saltabile) ----------
function avvio() {
  const box = $("#avvio"), r = $("#avvio-riga");
  const fine = () => { box.classList.add("via"); setTimeout(() => box.remove(), 220); document.removeEventListener("pointerdown", fine); document.removeEventListener("keydown", fine); };
  if (calmo()) { box.remove(); return; }
  document.addEventListener("pointerdown", fine); document.addEventListener("keydown", fine);
  decodifica(r, `COLLEGAMENTO TELESCRIVENTE · ${EVENTI.length} DISPACCI · DATI DI PROVA`, 380);
  setTimeout(fine, 760);
  // i dispacci arrivano come righe battute a macchina
  corpo.querySelectorAll<HTMLElement>(".dsp-slug").forEach((s, i) => { if (i < 7) decodifica(s, s.dataset.slug!, 200, 420 + i * 45); });
  corpo.classList.add("entra");
}

render(); aggiornaMappa(); avvio();
requestAnimationFrame(() => requestAnimationFrame(disegnaNastro));
if (map) map.once("load", () => { disegnaNastro(); map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"); });

// ---------- pannello trascinabile su telefono ----------
const fasi = ["peek", "half", "full"] as const;
const grip = $("#grip");
let y0 = 0, mosso = false, base = 0;
grip.addEventListener("click", () => { if (mosso) return; const i = fasi.indexOf(filo.dataset.state as (typeof fasi)[number]); filo.dataset.state = fasi[(i + 1) % 3]; });
grip.addEventListener("pointerdown", (ev) => { y0 = ev.clientY; mosso = false; base = filo.getBoundingClientRect().top - filo.offsetTop; filo.classList.add("drag"); grip.setPointerCapture(ev.pointerId); });
grip.addEventListener("pointermove", (ev) => {
  if (!filo.classList.contains("drag")) return;
  const dy = ev.clientY - y0; if (Math.abs(dy) > 4) mosso = true;
  filo.style.transform = `translateY(${Math.max(0, base + dy)}px)`; segui();
});
grip.addEventListener("pointerup", () => {
  filo.classList.remove("drag"); filo.style.transform = "";
  if (mosso) { const t = filo.getBoundingClientRect().top / window.innerHeight; filo.dataset.state = t < 0.3 ? "full" : t < 0.66 ? "half" : "peek"; }
  setTimeout(() => (mosso = false), 0);
});
