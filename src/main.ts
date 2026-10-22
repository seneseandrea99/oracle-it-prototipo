import "./style.css";
import { EVENTI, ORA, type Evento, type Tipo, type FonteTipo } from "./data";

declare const maplibregl: any;

const STILI = [
  "https://tiles.openfreemap.org/styles/dark",
  "https://tiles.openfreemap.org/styles/fiord",
  "https://tiles.openfreemap.org/styles/positron",
];
const ITALIA: [[number, number], [number, number]] = [[6.0, 35.3], [19.2, 47.2]];
const SUD: [[number, number], [number, number]] = [[12.2, 36.5], [18.7, 42.2]];

const TIPI: Record<Tipo, { label: string; colore: string; forma: "quadrato" | "rombo" | "triangolo" | "cerchio" }> = {
  blocco: { label: "Blocco", colore: "#ff5d52", forma: "quadrato" },
  sciopero: { label: "Sciopero", colore: "#5aa9ff", forma: "rombo" },
  corteo: { label: "Corteo", colore: "#f0a83c", forma: "triangolo" },
  presidio: { label: "Presidio", colore: "#33d1ad", forma: "cerchio" },
};
const STATI = { in_corso: "In corso", annunciato: "Annunciato", concluso: "Concluso" } as const;
const FONTE: Record<FonteTipo, string> = { ufficiale: "Ente ufficiale", agenzia: "Agenzia di stampa", testata: "Testata", parte: "Organizzazione promotrice" };
const PESO: Record<FonteTipo, number> = { ufficiale: 1, agenzia: 0.6, testata: 0.5, parte: 0.3 };

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const giorno = (d: string) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const dataOra = (d: string) => giorno(d) + " " + new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
function fa(d: string | Date) {
  const m = Math.round((+ORA - +new Date(d)) / 60000);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h fa` : `${Math.round(h / 24)} giorni fa`;
}
const titolo = (e: Evento) => `${TIPI[e.tipo].label} – ${e.comune}, ${giorno(e.inizio)}`;

function credibilita(e: Evento) {
  if (e.contraddittorio) return { label: "Informazioni discordanti", cls: "warn" };
  if (!e.fonti.length) return { label: `Segnalato da ${e.segnalatori} utenti · nessuna fonte`, cls: "user" };
  if (e.fonti.some((f) => f.tipo === "ufficiale")) return { label: "Comunicato ufficiale", cls: "cred" };
  const n = e.fonti.filter((f) => !f.smentisce).length;
  return { label: n === 1 ? "Riportato da 1 fonte" : `Riportato da ${n} fonti indipendenti`, cls: "cred" };
}
function pesi(e: Evento) {
  const r = e.fonti.map((f) => ({ nome: f.nome, tipo: FONTE[f.tipo] + (f.smentisce ? " · smentisce" : ""), w: f.smentisce ? -0.6 : f.tipo === "parte" && f.annuncio ? 0.6 : PESO[f.tipo] }));
  if (e.segnalatori) {
    let u = 0;
    for (let i = 0; i < e.segnalatori; i++) u += 0.1 * Math.pow(0.85, i);
    r.push({ nome: `${e.segnalatori} segnalatori diversi`, tipo: "Segnalazioni utenti, peso decrescente", w: Math.min(0.6, +u.toFixed(2)) });
  }
  return r;
}
function variante(e: Evento) {
  if (e.stato === "concluso") return "concluso";
  if (!e.fonti.length) return "utenti";
  return e.stato === "annunciato" ? "vuoto" : "pieno";
}

// icone: forma + stato, mai solo colore
function percorso(ctx: CanvasRenderingContext2D, forma: string, c: number, r: number) {
  ctx.beginPath();
  if (forma === "quadrato") ctx.rect(c - r * 0.82, c - r * 0.82, r * 1.64, r * 1.64);
  else if (forma === "rombo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r, c); ctx.lineTo(c, c + r); ctx.lineTo(c - r, c); ctx.closePath(); }
  else if (forma === "triangolo") { ctx.moveTo(c, c - r); ctx.lineTo(c + r * 0.95, c + r * 0.72); ctx.lineTo(c - r * 0.95, c + r * 0.72); ctx.closePath(); }
  else ctx.arc(c, c, r * 0.86, 0, Math.PI * 2);
}
function icona(tipo: Tipo, v: string, px = 56) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const ctx = cv.getContext("2d")!, c = px / 2, r = px * 0.34;
  const col = v === "concluso" ? "#6b7787" : TIPI[tipo].colore;
  percorso(ctx, TIPI[tipo].forma, c, r + 3);
  ctx.fillStyle = "rgba(5,8,12,.85)";
  ctx.fill();
  percorso(ctx, TIPI[tipo].forma, c, r);
  ctx.lineWidth = px * 0.08;
  ctx.strokeStyle = col;
  if (v === "utenti") ctx.setLineDash([px * 0.08, px * 0.06]);
  if (v === "pieno" || v === "concluso") { ctx.fillStyle = col; ctx.fill(); }
  ctx.stroke();
  return ctx.getImageData(0, 0, px, px);
}
function iconaSvg(e: Pick<Evento, "tipo"> & { v: string }, size = 18) {
  const col = e.v === "concluso" ? "#6b7787" : TIPI[e.tipo].colore, f = TIPI[e.tipo].forma;
  const fill = e.v === "pieno" || e.v === "concluso" ? col : "none", dash = e.v === "utenti" ? 'stroke-dasharray="2.5 2"' : "";
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

// stato
const st = { tipi: new Set<Tipo>(["blocco", "sciopero", "corteo", "presidio"]), quando: "tutto" as "tutto" | "ora" | "7g", nazionale: false, sel: null as string | null };
function filtrati() {
  return EVENTI.filter((e) => st.tipi.has(e.tipo)
    && (st.quando === "tutto" || (st.quando === "ora" ? e.stato === "in_corso" : e.stato !== "concluso" && +new Date(e.inizio) - +ORA < 7 * 864e5))
    && (!st.nazionale || e.nazionale));
}

// mappa
const map = new maplibregl.Map({ container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1016" } }] },
  bounds: SUD, maxBounds: [[3.5, 33.5], [21.5, 48.8]], minZoom: 4.6, maxZoom: 17, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, showAccuracyCircle: true }), "top-right");

async function caricaStile() {
  for (const url of STILI) {
    try {
      const r = await fetch(url);
      if (r.ok) { const s = await r.json(); map.setStyle(s); return; }
    } catch { /* prova il prossimo */ }
  }
  $("#maperr").hidden = false;
}

function dati() {
  const ev = filtrati();
  return {
    punti: { type: "FeatureCollection", features: ev.map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: e.lngLat },
      properties: { id: e.id, icon: `${e.tipo}-${variante(e)}`, nome: e.comune, attivo: e.stato === "in_corso" ? 1 : 0 } })) },
    aree: { type: "FeatureCollection", features: ev.filter((e) => e.precisione === "comune").map((e) => ({ type: "Feature",
      geometry: { type: "Polygon", coordinates: [cerchio(e.lngLat, 3)] }, properties: { id: e.id, colore: TIPI[e.tipo].colore } })) },
    tratti: { type: "FeatureCollection", features: ev.filter((e) => e.tratto).map((e) => ({ type: "Feature",
      geometry: { type: "LineString", coordinates: e.tratto }, properties: { id: e.id } })) },
  };
}

function aggiungiLivelli() {
  if (map.getSource("punti")) return;
  for (const t of Object.keys(TIPI) as Tipo[]) for (const v of ["pieno", "vuoto", "utenti", "concluso"])
    if (!map.hasImage(`${t}-${v}`)) map.addImage(`${t}-${v}`, icona(t, v), { pixelRatio: 2 });
  const d = dati();
  map.addSource("aree", { type: "geojson", data: d.aree });
  map.addSource("tratti", { type: "geojson", data: d.tratti });
  map.addSource("punti", { type: "geojson", data: d.punti });
  map.addLayer({ id: "aree-fill", type: "fill", source: "aree", paint: { "fill-color": ["get", "colore"], "fill-opacity": 0.1 } });
  map.addLayer({ id: "aree-line", type: "line", source: "aree", paint: { "line-color": ["get", "colore"], "line-opacity": 0.7, "line-width": 1.4, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "tratti-casing", type: "line", source: "tratti", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#05080c", "line-width": 9 } });
  map.addLayer({ id: "tratti", type: "line", source: "tratti", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ff5d52", "line-width": 5, "line-dasharray": [1.2, 0.8] } });
  map.addLayer({ id: "pulse", type: "circle", source: "punti", filter: ["==", ["get", "attivo"], 1], paint: { "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#f0a83c", "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.6 } });
  map.addLayer({ id: "sel", type: "circle", source: "punti", filter: ["==", ["get", "id"], ""], paint: { "circle-radius": 22, "circle-color": "rgba(255,255,255,.08)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  map.addLayer({ id: "icone", type: "symbol", source: "punti", layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.75, 9, 1, 13, 1.25], "icon-allow-overlap": true } });
  map.addLayer({ id: "nomi", type: "symbol", source: "punti", minzoom: 6.3, layout: { "text-field": ["get", "nome"], "text-font": ["Noto Sans Regular"], "text-size": 12.5, "text-offset": [0, 1.5], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": "#e3e9f0", "text-halo-color": "#05080c", "text-halo-width": 1.6 } });
  map.on("click", "icone", (ev: any) => apri(ev.features[0].properties.id, false));
  map.on("mouseenter", "icone", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "icone", () => (map.getCanvas().style.cursor = ""));
  animaPulse();
}
let raf = 0;
function animaPulse() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  cancelAnimationFrame(raf);
  const t0 = performance.now();
  const step = (t: number) => {
    const p = ((t - t0) % 2200) / 2200;
    if (map.getLayer("pulse")) {
      map.setPaintProperty("pulse", "circle-radius", 12 + p * 22);
      map.setPaintProperty("pulse", "circle-stroke-opacity", 0.7 * (1 - p));
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
map.on("style.load", aggiungiLivelli);
map.on("error", (e: any) => console.warn("mappa:", e?.error?.message));
caricaStile();

function aggiornaMappa() {
  const d = dati();
  map.getSource("punti")?.setData(d.punti);
  map.getSource("aree")?.setData(d.aree);
  map.getSource("tratti")?.setData(d.tratti);
  if (map.getLayer("sel")) map.setFilter("sel", ["==", ["get", "id"], st.sel ?? ""]);
}

// barra
function contatori() {
  const l = filtrati(), last = l.map((e) => +new Date(e.aggiornato)).sort((a, b) => b - a)[0];
  $("#counters").innerHTML = [[l.filter((e) => e.stato === "in_corso").length, "In corso"], [l.filter((e) => e.tipo === "blocco" && e.stato === "in_corso").length, "Blocchi"],
    [l.filter((e) => e.stato === "annunciato").length, "Annunciati"], [last ? fa(new Date(last)) : "–", "Agg."]]
    .map(([n, l2]) => `<div class="counter"><span class="n">${n}</span><span class="l">${l2}</span></div>`).join("");
}
function chips() {
  const tipi = (Object.keys(TIPI) as Tipo[]).map((t) => `<button class="chip" data-tipo="${t}" aria-pressed="${st.tipi.has(t)}">${iconaSvg({ tipo: t, v: "pieno" }, 13)}${TIPI[t].label}</button>`).join("");
  const quando = ([["tutto", "Tutto"], ["ora", "In corso"], ["7g", "Prossimi 7 giorni"]] as const).map(([k, l]) => `<button class="chip" data-quando="${k}" aria-pressed="${st.quando === k}">${l}</button>`).join("");
  $("#chips").innerHTML = `${tipi}<span class="sep"></span>${quando}<span class="sep"></span><button class="chip" data-vai="sud">Sud</button><button class="chip" data-vai="italia">Tutta Italia</button>`;
}
$("#chips").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.dataset.tipo) { const t = b.dataset.tipo as Tipo; if (st.tipi.has(t) && st.tipi.size > 1) st.tipi.delete(t); else st.tipi.add(t); }
  if (b.dataset.quando) st.quando = b.dataset.quando as typeof st.quando;
  if (b.dataset.vai) map.fitBounds(b.dataset.vai === "sud" ? SUD : ITALIA, { padding: 40, duration: 900 });
  aggiorna();
});

// pannello
const sheet = $("#sheet"), body = $("#sheet-body");
const desktop = () => matchMedia("(min-width: 900px)").matches;
function elenco() {
  const ord = { in_corso: 0, annunciato: 1, concluso: 2 };
  const l = [...filtrati()].sort((a, b) => ord[a.stato] - ord[b.stato] || +new Date(b.aggiornato) - +new Date(a.aggiornato));
  body.innerHTML = `<div class="sum"><h2>${l.length} eventi</h2><span class="mono">Ora simulata: ${dataOra("2026-10-22T20:00")}</span></div>
  <button class="national" id="naz" aria-pressed="${st.nazionale}"><div class="k">MOBILITAZIONE NAZIONALE</div><div class="t">Sciopero nazionale trasporti · 30/10</div>
  <div class="s">Riguarda tutta Italia, quindi non ha un punto sulla mappa. ${st.nazionale ? "Tocca per tornare a tutti gli eventi." : "Tocca per vedere i 2 eventi locali collegati."}</div></button>
  <div class="list" role="list">${l.length ? l.map((e) => `<button class="item" role="listitem" data-id="${e.id}" aria-current="${st.sel === e.id}">
    <span class="ic">${iconaSvg({ tipo: e.tipo, v: variante(e) }, 20)}</span><span class="t">${titolo(e)}</span><span class="w">${fa(e.aggiornato)}</span>
    <span class="m">${STATI[e.stato]} · ${credibilita(e).label}</span></button>`).join("") : `<p class="empty">Nessun evento con questi filtri.</p>`}</div>`;
  $("#naz").onclick = () => { st.nazionale = !st.nazionale; aggiorna(); };
}
body.addEventListener("click", (ev) => {
  const it = (ev.target as HTMLElement).closest(".item") as HTMLElement | null;
  if (it) apri(it.dataset.id!, true);
});
function apri(id: string, daElenco: boolean) {
  st.sel = id;
  const e = EVENTI.find((x) => x.id === id)!, c = credibilita(e), r = pesi(e), tot = r.reduce((a, x) => a + x.w, 0);
  body.innerHTML = `<button class="back" id="back">← Tutti gli eventi</button>
  <h2 class="d-title">${titolo(e)}</h2>
  <div class="badges"><span class="badge">${iconaSvg({ tipo: e.tipo, v: variante(e) }, 12)} ${STATI[e.stato]}</span><span class="badge ${c.cls}">${c.label}</span><span class="badge">${e.categoria}</span></div>
  ${e.contraddittorio ? `<p class="note warn">Due fonti descrivono la situazione in modo incompatibile. L'evento resta visibile con questa avvertenza finché una fonte successiva non chiarisce.</p>` : ""}
  ${!e.fonti.length ? `<p class="note user">Nessuna fonte giornalistica o ufficiale finora. È visibile perché ${e.segnalatori} segnalatori diversi lo hanno indicato nello stesso punto entro 2 ore. Scompare dopo 6 ore senza nuove segnalazioni.</p>` : ""}
  <div class="sec"><h3>L'evento</h3><dl class="kv"><dt>Luogo</dt><dd>${e.luogo}, ${e.comune} (${e.regione})</dd>
    <dt>Precisione</dt><dd>${e.precisione === "comune" ? "Noto solo il comune (area tratteggiata)" : "Punto indicato dalle fonti"}</dd>
    <dt>Inizio</dt><dd class="mono">${dataOra(e.inizio)}</dd><dt>Fine</dt><dd class="mono">${e.fine ? dataOra(e.fine) : "Non indicata"}</dd>
    <dt>Traffico</dt><dd>${e.traffico}</dd><dt>Aggiornato</dt><dd class="mono">${dataOra(e.aggiornato)} · ${fa(e.aggiornato)}</dd></dl></div>
  <div class="sec why"><h3>Perché è visibile</h3>${r.map((x) => `<div class="r"><span>${x.nome}<br><span class="k">${x.tipo}</span></span><span class="mono">${x.w > 0 ? "+" : ""}${x.w.toFixed(2)}</span>
    <div class="bar ${x.w < 0 ? "neg" : ""}"><i style="width:${Math.min(100, Math.abs(x.w) * 100)}%"></i></div></div>`).join("")}
    <div class="tot mono">Totale ${tot.toFixed(2)} · soglia 0,80${!e.fonti.length ? " · eventi con sole segnalazioni: regola a parte" : ""}</div></div>
  ${e.fonti.length ? `<div class="sec"><h3>Fonti</h3><ul class="src">${e.fonti.map((f) => `<li><div class="k">${FONTE[f.tipo]}${f.smentisce ? " · smentisce" : ""}</div><div class="p">${f.nome}</div><div class="d mono">Notizia pubblicata il ${dataOra(f.pubblicata)}</div></li>`).join("")}</ul></div>` : ""}
  <div class="sec"><h3>Cronologia</h3><ol class="tl">${e.cronologia.map(([w, k, t]) => `<li><span class="w">${dataOra(w)} · ${k}</span><br>${t}</li>`).join("")}</ol></div>
  <div class="actions">${e.stato !== "concluso" ? `<button class="btn primary" id="conf">Sono sul posto: confermo</button>` : ""}<button class="btn" id="err">Segnala un errore</button></div><div id="msg"></div>`;
  $("#back").onclick = () => { st.sel = null; aggiorna(); };
  $("#err").onclick = () => ($("#msg").innerHTML = `<p class="note">Nel sito reale l'evento verrebbe nascosto in via cautelativa e verificato entro 48 ore. Qui non viene inviato nulla.</p>`);
  const cf = document.getElementById("conf");
  if (cf) cf.onclick = () => ($("#msg").innerHTML = `<p class="note">Nel sito reale la conferma conterebbe come segnalazione, con controllo di vicinanza facoltativo. Qui non viene inviato nulla.</p>`);
  body.scrollTop = 0;
  if (!desktop() && sheet.dataset.state === "peek") sheet.dataset.state = "half";
  aggiornaMappa();
  const pad = desktop() ? { left: 420, top: 140, right: 60, bottom: 60 } : { top: 150, bottom: window.innerHeight * 0.5, left: 30, right: 30 };
  map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), e.precisione === "comune" ? 10.5 : 12.5), padding: pad, duration: daElenco ? 1200 : 700 });
}
function aggiorna() { chips(); contatori(); aggiornaMappa(); if (st.sel) apri(st.sel, false); else elenco(); }

// trascinamento del pannello (telefono)
const stati = ["peek", "half", "full"] as const;
$("#grip").addEventListener("click", () => { if (moved) return; const i = stati.indexOf(sheet.dataset.state as any); sheet.dataset.state = stati[(i + 1) % 3]; });
let y0 = 0, t0 = 0, moved = false;
$("#grip").addEventListener("pointerdown", (ev) => {
  y0 = ev.clientY; moved = false; t0 = sheet.getBoundingClientRect().top; sheet.classList.add("dragging");
  ($("#grip") as HTMLElement).setPointerCapture(ev.pointerId);
});
$("#grip").addEventListener("pointermove", (ev) => {
  if (!sheet.classList.contains("dragging")) return;
  const dy = ev.clientY - y0; if (Math.abs(dy) > 4) moved = true;
  const top = Math.max(window.innerHeight * 0.12, t0 + dy);
  sheet.style.transform = `translateY(${top - window.innerHeight * 0.12}px)`;
});
$("#grip").addEventListener("pointerup", () => {
  sheet.classList.remove("dragging"); sheet.style.transform = "";
  if (!moved) return;
  const top = sheet.getBoundingClientRect().top / window.innerHeight;
  sheet.dataset.state = top < 0.3 ? "full" : top < 0.72 ? "half" : "peek";
  setTimeout(() => (moved = false), 0);
});

aggiorna();
