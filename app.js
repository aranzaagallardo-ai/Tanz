/* Tanz — tus apuntes, en audiolibro.
   Motor neuronal Edge vía puente Render · Fish Audio opcional · biblioteca local. */
"use strict";

/* ---------------- código de acceso (4 dígitos) ---------------- */
const PIN_KEY = "tanz-pin-v1";
let pinBuffer = "", pinFase = null, appIniciada = false;

function pinRefrescar() {
  document.querySelectorAll("#pin .dots span").forEach((d, i) => d.classList.toggle("lleno", i < pinBuffer.length));
}
function pinTecla(t) {
  if (t === "borrar") { pinBuffer = pinBuffer.slice(0, -1); pinRefrescar(); return; }
  if (t === "ok" || pinBuffer.length >= 4) return;
  pinBuffer += t; pinRefrescar();
  if (pinBuffer.length === 4) pinResolver();
}
async function pinResolver() {
  const err = document.querySelector("#pin .err");
  const hash = btoa(unescape(encodeURIComponent("tanz." + pinBuffer + ".acceso")));
  if (pinFase === "crear") {
    localStorage.setItem("tanz-pin-borrador", hash);
    pinFase = "confirmar"; pinBuffer = "";
    document.querySelectorAll("#pin .dots span").forEach((d) => d.classList.remove("lleno"));
    document.getElementById("pinTitulo").textContent = "Confírmalo";
    err.textContent = "";
    return;
  }
  if (pinFase === "confirmar") {
    if (localStorage.getItem("tanz-pin-borrador") !== hash) {
      pinBuffer = ""; pinRefrescar();
      err.textContent = "No coincidió. Inténtalo de nuevo.";
      return;
    }
    localStorage.setItem(PIN_KEY, hash);
    localStorage.removeItem("tanz-pin-borrador");
  } else if (pinFase === "entrar") {
    if (localStorage.getItem(PIN_KEY) !== hash) {
      err.textContent = "Código incorrecto.";
      pinBuffer = ""; pinRefrescar();
      return;
    }
  }
  document.getElementById("pin").classList.add("oculto");
  iniciarApp();
}
document.querySelectorAll("#pin .teclado button").forEach((b) => {
  b.addEventListener("click", () => pinTecla(b.dataset.t));
});
function pinIniciar() {
  const guardado = localStorage.getItem(PIN_KEY);
  pinFase = guardado ? "entrar" : "crear";
  pinBuffer = "";
  document.getElementById("pinTitulo").textContent = guardado ? "Tu código de acceso" : "Elige 4 dígitos: serán tu código de acceso";
  document.querySelectorAll("#pin .dots span").forEach((d) => d.classList.remove("lleno"));
  document.getElementById("pin").classList.remove("oculto");
}
function iniciarApp() {
  if (appIniciada) return;
  appIniciada = true;
  document.getElementById("escritorio").classList.remove("oculto");
  pintarBiblio();
}

/* ---------------- configuración ---------------- */
const PUENTE = "https://tanz-y18v.onrender.com";
const VOCES = [
  { id: "es-CL-CatalinaNeural", nombre: "Catalina", pais: "Chile" },
  { id: "es-CL-LorenzoNeural", nombre: "Lorenzo", pais: "Chile" },
  { id: "es-MX-DaliaNeural", nombre: "Dalia", pais: "México" },
  { id: "es-MX-JorgeNeural", nombre: "Jorge", pais: "México" },
  { id: "es-AR-ElenaNeural", nombre: "Elena", pais: "Argentina" },
  { id: "es-UY-ValentinaNeural", nombre: "Valentina", pais: "Uruguay" },
  { id: "es-ES-ElviraNeural", nombre: "Elvira", pais: "España" },
  { id: "es-ES-AlvaroNeural", nombre: "Álvaro", pais: "España" },
];
let vozSel = localStorage.getItem("tanz-voz") || VOCES[0].id;
if (!VOCES.some((v) => v.id === vozSel)) vozSel = VOCES[0].id;
let velocidad = parseFloat(localStorage.getItem("tanz-vel") || "1");

const $ = (id) => document.getElementById(id);
function toast(m) {
  let t = document.createElement("div");
  t.className = "aviso-flotante"; t.textContent = m;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---------------- Fish Audio (voz clonada) ---------------- */
function fishActivo() { return !!(localStorage.getItem("tanz-fish-key") && localStorage.getItem("tanz-fish-ref")); }
async function synthFish(trozo, intento = 1) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), intento === 1 ? 90000 : 45000);
  try {
    const r = await fetch(PUENTE + "/fish", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: localStorage.getItem("tanz-fish-key"), reference_id: localStorage.getItem("tanz-fish-ref"), text: trozo }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error("Fish Audio " + r.status);
    return await r.blob();
  } catch (e) { clearTimeout(t); throw e; }
}
async function synthPuente(trozo, voz, rate = "+0%", intento = 1) {
  if (voz === "fish") return synthFish(trozo, intento);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), intento === 1 ? 90000 : 45000);
  try {
    const r = await fetch(PUENTE + "/tts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: trozo, voice: voz, rate }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error("puente " + r.status);
    return await r.blob();
  } catch (e) { clearTimeout(t); throw e; }
}

/* ---------------- limpieza de texto ---------------- */
const UNIDADES = [
  [/\bcm\b/g, "centímetros"], [/\bmm\b/g, "milímetros"], [/\bmL\b/g, "mililitros"],
  [/\bmg\b/g, "miligramos"], [/\bµg\b/g, "microgramos"], [/\bmin\b/g, "minutos"],
  [/\b(\d+)\s*h\b/g, "$1 horas"], [/\biv\b/g, "intravenosa"], [/\bim\b/g, "intramuscular"],
  [/\bvo\b/g, "oral"], [/\bTV\b/g, "tacto vaginal"], [/\bRCF\b/g, "registro cardiovascular fetal"],
];
function limpiar(t) {
  const map = { "➝": ",", "→": " a ", "≥": "mayor o igual que ", "≤": "menor o igual que ", "≈": "aproximadamente ", "×": " por ", "✦": "", "N°": "número ", "n°": "número ", "&": " y ", "%": " por ciento", "↑": "aumenta ", "↓": "disminuye ", "—": " — ", "“": '"', "”": '"', "•": ",", "·": ",", "▪": ",", "‣": ",", "│": " " };
  t = t.replace(/[➝→≥≤≈×✦N°n°&%↑↓—“”•·▪‣│]/g, (c) => map[c] ?? c);
  for (const [re, v] of UNIDADES) t = t.replace(re, v);
  t = t.replace(/(\d)[ \t]+(?=\d)/g, "$1").replace(/[\u2010\u00ad]\s*/g, "");
  t = t.replace(/,\s*—\s*,?\s*/g, " — ").replace(/(?:,\s*){2,}/g, ", ").replace(/\s{2,}/g, " ");
  return t;
}
function limpiarMarkdown(t) {
  t = t.replace(/<img[^>]*>|<figure[^>]*>|<\/figure>/g, " ");
  t = t.replace(/<\/t[dh]>\s*<t[dh][^>]*>/g, " — ").replace(/<\/tr>\s*<tr[^>]*>/g, ".\n");
  t = t.replace(/<\/?(table|thead|tbody|tr|td|th)[^>]*>/g, " ");
  t = t.replace(/^#{1,6} (.+)$/gm, "$1.");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1");
  t = t.replace(/^\s*[-•] /gm, ". ").replace(/^\s*(\d+)\. /gm, ". $1: ");
  return t;
}

/* ---------------- extracción PDF ---------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
async function pdfATexto(arrayBuffer, progreso) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const lineas = new Map();
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!lineas.has(y)) lineas.set(y, []);
      lineas.get(y).push({ x: it.transform[4], w: it.width || 0, s: it.str });
    }
    const orden = [...lineas.entries()].sort((a, b) => b[0] - a[0]).map(([, frags]) => {
      frags.sort((a, b) => a.x - b.x);
      if (frags.length === 1) return frags[0].s.trim();
      const gaps = [];
      for (let i = 1; i < frags.length; i++) gaps.push(Math.max(0, frags[i].x - (frags[i-1].x + frags[i-1].w)));
      const cortas = frags.filter((f) => f.s.trim().length <= 2).length;
      const espaciada = frags.length >= 6 && cortas >= frags.length * 0.5;
      let umbral = 2.2;
      const calcular = (piso) => {
        const base = gaps.filter((g) => g <= 10);
        if (base.length < 2) return piso;
        const media = base.reduce((a, b) => a + b, 0) / base.length;
        const sd = Math.sqrt(base.reduce((a, g) => a + (g - media) ** 2, 0) / base.length);
        return Math.max(piso, media + 0.6 * sd);
      };
      if (espaciada && gaps.length > 1) umbral = calcular(0.4);
      else if (gaps.length >= 3) umbral = calcular(0.9);
      let linea = "", fin = -1e9;
      for (const f of frags) {
        const gap = f.x - fin;
        if (linea === "") linea = f.s;
        else if (gap > 20) linea += " — " + f.s;
        else if (gap > umbral) linea += " " + f.s;
        else {
          if (gap <= 6 && f.s.length === 1 && /[a-záéíóúñü]$/.test(linea) && /^[a-záéíóúñü]/.test(f.s)) linea += f.s;
          else linea += " " + f.s;
        }
        fin = f.x + f.w;
      }
      return linea.trim();
    });
    paginas.push(orden);
    progreso(n, pdf.numPages);
  }
  const norm = (l) => l.replace(/\s?\d{1,3}\s?$/, "").trim();
  const conteo = new Map();
  for (const orden of paginas)
    for (const l of [...orden.slice(0, 3), ...orden.slice(-3)]) {
      const k = norm(l);
      if (k) conteo.set(k, (conteo.get(k) || 0) + 1);
    }
  const umbralR = Math.max(3, paginas.length * 0.6);
  const repetidas = new Set([...conteo.entries()].filter(([l, c]) => c >= umbralR && l.length > 1).map(([l]) => l));
  return paginas
    .map((orden) => orden.filter((l, i) => {
      if (repetidas.has(norm(l))) return false;
      if ((i < 2 || i >= orden.length - 2) && /^\d{1,3}$/.test(l)) return false;
      return true;
    }).join("\n"))
    .join("\n\n");
}

/* ---------------- entrada de documento ---------------- */
const drop = $("drop"), inputArchivo = $("archivo");
drop.addEventListener("click", () => inputArchivo.click());
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("on"); });
drop.addEventListener("dragleave", () => drop.classList.remove("on"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("on"); if (e.dataTransfer.files[0]) cargar(e.dataTransfer.files[0]); });
inputArchivo.addEventListener("change", (e) => { if (e.target.files[0]) cargar(e.target.files[0]); });
$("btnAgregar").addEventListener("click", () => inputArchivo.click());

let docActual = null; // {id, nombre, frases[], trozos[{texto,desde,hasta}], partes[], blobTotal}

async function cargar(file) {
  const nombre = file.name.replace(/\.(pdf|md|txt|markdown)$/i, "");
  let texto = "";
  toast("Leyendo " + nombre + "…");
  try {
    if (/\.pdf$/i.test(file.name)) texto = await pdfATexto(await file.arrayBuffer(), (n, tot) => toast(`Leyendo página ${n} de ${tot}…`));
    else {
      texto = await file.text();
      if (/\.md|\.markdown$/i.test(file.name)) texto = limpiarMarkdown(texto);
    }
  } catch (e) { toast("No pude leer el archivo: " + e.message); return; }
  texto = limpiar(texto).replace(/\n{3,}/g, "\n\n").trim();
  if (texto.length < 40) { toast("El documento no tiene texto legible (¿es un escaneo sin OCR?)."); return; }
  abrirLectura(nombre, texto);
}

/* ---------------- vista lectura ---------------- */
function dividirFrases(texto) {
  const frases = [];
  for (const parrafo of texto.split(/\n{2,}|\n/)) {
    const limpio = parrafo.trim();
    if (!limpio) continue;
    const partes = limpio.split(/(?<=[.!?;:])\s+/).map((x) => x.trim()).filter(Boolean);
    partes.forEach((f, i) => frases.push({ literal: f, nuevoParrafo: i === 0 }));
  }
  return frases;
}
function trocearPorFrases(frases, max = 2000) {
  const trozos = [];
  let actual = "", desde = null;
  frases.forEach((f, i) => {
    if ((actual + " " + f.texto).length > max && actual) {
      trozos.push({ texto: actual.trim(), desde, hasta: i - 1 });
      actual = ""; desde = null;
    }
    if (!actual) desde = i;
    actual += (actual ? " " : "") + f.texto;
  });
  if (actual.trim()) trozos.push({ texto: actual.trim(), desde, hasta: frases.length - 1 });
  return trozos;
}
function abrirLectura(nombre, texto) {
  const frases = dividirFrases(texto);
  if (!frases.length) { toast("El documento no tiene contenido legible."); return; }
  const cont = $("textoLectura");
  cont.innerHTML = "";
  let p = null;
  frases.forEach((f, i) => {
    if (f.nuevoParrafo || !p) { p = document.createElement("p"); cont.appendChild(p); }
    const span = document.createElement("span");
    span.className = "frase"; span.dataset.i = i;
    span.textContent = (p.childElementCount ? " " : "") + f.literal;
    p.appendChild(span);
  });
  $("tituloLectura").textContent = nombre;
  $("vistaHome").classList.add("oculto");
  $("vistaLectura").classList.remove("oculto");
  $("playerPill").classList.add("oculto");
  $("menuVoz").classList.add("oculto");
  window.scrollTo({ top: 0 });

  urlsActivas = [];
  const id = nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) + "-" + texto.length.toString(36);
  const frasesAudio = frases.map((f) => ({ texto: limpiar(f.literal), nuevoParrafo: f.nuevoParrafo }));
  const trozos = trocearPorFrases(frasesAudio, 2000);
  docActual = { id, nombre, texto, frases, trozos, partes: null, blobTotal: null, trozoActual: -1, sonando: false };

  // botón empezar / retomar
  const pos = JSON.parse(localStorage.getItem("tanz-pos-" + id) || "null");
  const btn = document.createElement("button");
  btn.className = "btn-empezar";
  btn.id = "btnEmpezar";
  btn.textContent = pos ? `▶ Continuar donde quedaste (parte ${pos.trozo + 1} de ${trozos.length})` : `▶ Escuchar (${Math.max(1, Math.round(texto.length / 14.5 / 60))} min)`;
  btn.onclick = () => empezarAudio(pos ? pos.trozo : 0);
  cont.before(btn);
}
function volverHome() {
  detener();
  $("vistaLectura").classList.add("oculto");
  $("playerPill").classList.add("oculto");
  $("menuVoz").classList.add("oculto");
  $("vistaHome").classList.remove("oculto");
  pintarBiblio();
  window.scrollTo({ top: 0 });
}
$("btnVolver").addEventListener("click", volverHome);

/* ---------------- síntesis en paralelo ---------------- */
async function sintetizarTodo(enProgreso) {
  const { trozos } = docActual;
  const partes = new Array(trozos.length);
  let hechos = 0;
  const t0 = Date.now();
  const cola = [...trozos.keys()];
  const voz = fishActivo() ? "fish" : vozSel;
  async function obrera() {
    while (cola.length) {
      const i = cola.shift();
      let err = null;
      for (const reintento of [1, 2, 3]) {
        try { partes[i] = await synthPuente(trozos[i].texto, voz, "+0%", reintento); hechos++; err = null; break; }
        catch (e) { err = e; if (reintento < 3) await new Promise((r) => setTimeout(r, 1500 * reintento)); }
      }
      if (err) throw err;
      const restante = hechos ? ((Date.now() - t0) / hechos) * (trozos.length - hechos) / 1000 : 0;
      enProgreso(hechos, trozos.length, restante);
    }
  }
  await Promise.all([obrera(), obrera(), obrera()]);
  docActual.partes = partes;
  docActual.blobTotal = new Blob(partes, { type: "audio/mpeg" });
  prepararDescarga();
}

async function empezarAudio(trozoInicial = 0) {
  const btn = $("btnEmpezar");
  if (btn) { btn.disabled = true; btn.textContent = "Preparando la voz…"; }
  $("genBox").classList.remove("oculto");
  try {
    if (!docActual.partes) {
      await sintetizarTodo((hechos, total, restante) => {
        $("genTexto").textContent = `Generando audio — parte ${hechos} de ${total}`;
        $("genPct").textContent = `~${Math.max(1, Math.round(restante / 60))} min`;
        $("genFill").style.width = (100 * hechos / total) + "%";
      });
    }
    if (btn) btn.remove();
    $("genBox").classList.add("oculto");
    $("playerPill").classList.remove("oculto");
    guardarLocal(docActual.nombre, docActual.texto, docActual.frases, docActual.trozos);
    pintarBiblio();
    $("vozActual").textContent = fishActivo() ? "Tu voz" : (VOCES.find((v) => v.id === vozSel) || VOCES[0]).nombre;
    reproducirTrozo(trozoInicial);
  } catch (e) {
    $("genBox").classList.add("oculto");
    if (btn) { btn.disabled = false; btn.textContent = "▶ Intentar de nuevo"; }
    toast("El servidor de voces no respondió. Intenta de nuevo en un minuto.");
  }
}

/* ---------------- reproducción con resaltado ---------------- */
const player = $("player");
let urlsActivas = [];
function detener() {
  player.pause();
  player.removeAttribute("src");
  urlsActivas.forEach((u) => URL.revokeObjectURL(u));
  urlsActivas = [];
  docActual && (docActual.trozoActual = -1);
  limpiarResaltado();
  $("playerPill").classList.add("oculto");
}
function limpiarResaltado() {
  document.querySelectorAll(".frase.actual,.frase.pasada").forEach((x) => x.classList.remove("actual", "pasada"));
}
function resaltarTrozo(i, progreso = 0) {
  const { trozos } = docActual;
  const t = trozos[i];
  document.querySelectorAll(".frase").forEach((sp) => {
    const idx = +sp.dataset.i;
    sp.classList.toggle("actual", idx >= t.desde && idx <= t.hasta);
    sp.classList.toggle("pasada", idx < t.desde);
  });
  // frase dentro del trozo según avance
  const nFrases = t.hasta - t.desde + 1;
  const actual = t.desde + Math.min(nFrases - 1, Math.floor(progreso * nFrases));
  const span = document.querySelector(`.frase[data-i="${actual}"]`);
  if (span) {
    document.querySelectorAll(".frase.actual").forEach((x) => x.classList.toggle("actual", x === span));
    span.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const pct = 100 * ((i + progreso) / trozos.length);
  $("fill").style.width = pct + "%";
}
function reproducirTrozo(i) {
  if (i >= docActual.trozos.length) { finDocumento(); return; }
  docActual.trozoActual = i;
  localStorage.setItem("tanz-pos-" + docActual.id, JSON.stringify({ trozo: i }));
  if (urlsActivas[i]) player.src = urlsActivas[i];
  else {
    urlsActivas[i] = URL.createObjectURL(docActual.partes[i]);
    player.src = urlsActivas[i];
  }
  player.playbackRate = velocidad;
  player.ontimeupdate = () => {
    const p = player.duration ? player.currentTime / player.duration : 0;
    resaltarTrozo(i, p);
    $("tPos").textContent = `Parte ${i + 1} de ${docActual.trozos.length}`;
  };
  player.onended = () => reproducirTrozo(i + 1);
  player.play().catch(() => {});
  refrescarPlay();
}
function finDocumento() {
  docActual.trozoActual = -1;
  limpiarResaltado();
  localStorage.removeItem("tanz-pos-" + docActual.id);
  $("btnPlay").textContent = "▶";
}
function refrescarPlay() { $("btnPlay").textContent = player.paused ? "▶" : "⏸"; }

$("btnPlay").addEventListener("click", () => {
  if (!player.src) return;
  player.paused ? player.play() : player.pause();
  refrescarPlay();
});
$("btnAtras").addEventListener("click", () => {
  if (player.currentTime > 3) player.currentTime = Math.max(0, player.currentTime - 15);
  else if (docActual && docActual.trozoActual > 0) reproducirTrozo(docActual.trozoActual - 1);
});
$("btnAdelante").addEventListener("click", () => {
  if (player.currentTime < player.duration - 3) player.currentTime = Math.min(player.duration || 0, player.currentTime + 15);
  else if (docActual && docActual.trozoActual < docActual.trozos.length - 1) reproducirTrozo(docActual.trozoActual + 1);
});
const VELOCIDADES = [0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3];
$("btnVel").addEventListener("click", () => {
  const i = VELOCIDADES.indexOf(velocidad);
  velocidad = VELOCIDADES[(i + 1) % VELOCIDADES.length];
  localStorage.setItem("tanz-vel", velocidad);
  player.playbackRate = velocidad;
  $("btnVel").textContent = velocidad + "×";
});
let sleepTimer = null, sleepMin = 0;
const SLEEP_OPCIONES = [0, 5, 15, 30];
$("btnSleep").addEventListener("click", () => {
  sleepMin = SLEEP_OPCIONES[(SLEEP_OPCIONES.indexOf(sleepMin) + 1) % SLEEP_OPCIONES.length];
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  if (sleepMin) {
    $("btnSleep").textContent = "🌙" + sleepMin;
    toast("El audio se pausará en " + sleepMin + " minutos.");
    sleepTimer = setTimeout(() => { player.pause(); refrescarPlay(); toast("Pausa programada ✓"); }, sleepMin * 60000);
  } else {
    $("btnSleep").textContent = "🌙";
    toast("Temporizador apagado.");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !$("playerPill").classList.contains("oculto") && player.src &&
      !/input|textarea/i.test(document.activeElement.tagName)) {
    e.preventDefault();
    player.paused ? player.play() : player.pause();
    refrescarPlay();
  }
});

/* pegar texto */
$("btnPegar").addEventListener("click", () => $("pegarBox").classList.toggle("oculto"));
$("btnPegarListo").addEventListener("click", () => {
  const t = $("pegarTexto").value.trim();
  if (t.length < 40) { toast("Pega un texto más largo para escucharlo."); return; }
  abrirLectura("Texto pegado", t);
});
$("progresoGlobal").addEventListener("click", (e) => {
  if (!docActual) return;
  const r = e.currentTarget.getBoundingClientRect();
  const i = Math.floor(docActual.trozos.length * (e.clientX - r.left) / r.width);
  reproducirTrozo(Math.min(i, docActual.trozos.length - 1));
});
$("btnCerrar").addEventListener("click", detener);

/* menú de voz en el pill */
$("vozActual").addEventListener("click", () => {
  const menu = $("menuVoz");
  if (!menu.classList.contains("oculto")) { menu.classList.add("oculto"); return; }
  menu.innerHTML = "";
  for (const v of VOCES) {
    const b = document.createElement("button");
    b.className = "chip" + (v.id === vozSel ? " sel" : "");
    b.innerHTML = `<span class="nombre"></span><span class="pais">${v.pais}</span>`;
    b.querySelector(".nombre").textContent = v.nombre;
    b.onclick = () => {
      vozSel = v.id; localStorage.setItem("tanz-voz", v.id);
      $("vozActual").textContent = v.nombre;
      menu.classList.add("oculto");
      toast("Voz cambiada a " + v.nombre + ". Se aplica en la próxima generación.");
    };
    menu.appendChild(b);
  }
  menu.classList.remove("oculto");
});

/* ---------------- biblioteca local ---------------- */
const BIBLIO_KEY = "tanz-biblio";
function biblioLeer() { try { return JSON.parse(localStorage.getItem(BIBLIO_KEY) || "[]"); } catch (e) { return []; } }
function guardarLocal(nombre, texto, frases, trozos) {
  const lista = biblioLeer();
  const id = docActual.id;
  lista.unshift({ id, nombre, fecha: new Date().toISOString(), chars: texto.length });
  while (lista.length > 12) lista.pop();
  localStorage.setItem(BIBLIO_KEY, JSON.stringify(lista));
  localStorage.setItem("tanz-doc-" + id, JSON.stringify({ nombre, texto }));
}
function pintarBiblio() {
  const cont = $("biblioteca");
  const docs = biblioLeer();
  if (!docs.length) {
    cont.innerHTML = '<div style="color:var(--gris); font-size:.85rem; padding:8px 2px">Todavía no tienes audiolibros. Sube tu primer documento arriba.</div>';
    return;
  }
  cont.innerHTML = "";
  for (const d of docs) {
    const card = document.createElement("div");
    card.className = "doc-card";
    const kb = Math.round((d.chars || 0) / 100) / 10;
    const pos = JSON.parse(localStorage.getItem("tanz-pos-" + d.id) || "null");
    card.innerHTML = `<b></b><small>${new Date(d.fecha).toLocaleDateString("es-CL")} · ${kb}k caracteres</small>
      ${pos ? '<div class="progreso-mini"><div style="width:' + Math.min(100, (pos.trozo + 1) * 8) + '%"></div></div>' : ""}`;
    card.querySelector("b").textContent = d.nombre;
    card.onclick = () => abrirDeBiblio(d);
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "✕"; del.title = "Borrar";
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirm(`¿Borrar "${d.nombre}"?`)) return;
      localStorage.setItem(BIBLIO_KEY, JSON.stringify(biblioLeer().filter((x) => x.id !== d.id)));
      localStorage.removeItem("tanz-doc-" + d.id);
      localStorage.removeItem("tanz-pos-" + d.id);
      pintarBiblio();
    };
    card.appendChild(del);
    cont.appendChild(card);
  }
}
function abrirDeBiblio(d) {
  const guardado = JSON.parse(localStorage.getItem("tanz-doc-" + d.id) || "null");
  if (!guardado) { toast("Este documento ya no está en este dispositivo."); return; }
  const frases = dividirFrases(guardado.texto);
  const cont = $("textoLectura");
  cont.innerHTML = "";
  let p = null;
  frases.forEach((f, i) => {
    if (f.nuevoParrafo || !p) { p = document.createElement("p"); cont.appendChild(p); }
    const span = document.createElement("span");
    span.className = "frase"; span.dataset.i = i;
    span.textContent = (p.childElementCount ? " " : "") + f.literal;
    p.appendChild(span);
  });
  $("tituloLectura").textContent = d.nombre;
  $("vistaHome").classList.add("oculto");
  $("vistaLectura").classList.remove("oculto");
  $("playerPill").classList.remove("oculto");
  urlsActivas = [];
  window.scrollTo({ top: 0 });
  const pos = JSON.parse(localStorage.getItem("tanz-pos-" + d.id) || "null");
  const frasesAudio = frases.map((f) => ({ texto: limpiar(f.literal), nuevoParrafo: f.nuevoParrafo }));
  const trozos = trocearPorFrases(frasesAudio, 2000);
  const btn = document.createElement("button");
  btn.className = "btn-empezar"; btn.id = "btnEmpezar";
  btn.textContent = pos ? `▶ Continuar (parte ${pos.trozo + 1} de ${trozos.length})` : "▶ Escuchar";
  btn.onclick = () => empezarAudio(pos ? pos.trozo : 0);
  cont.before(btn);
}

/* ---------------- voces (chips) ---------------- */
const contVoces = $("voces");
for (const v of VOCES) {
  const b = document.createElement("button");
  b.className = "chip" + (v.id === vozSel ? " sel" : "");
  b.innerHTML = `<span class="nombre"></span><span class="pais">${v.pais}</span><span class="prev" title="escuchar muestra">▶</span>`;
  b.querySelector(".nombre").textContent = v.nombre;
  b.onclick = () => {
    vozSel = v.id; localStorage.setItem("tanz-voz", v.id);
    contVoces.querySelectorAll(".chip").forEach((c) => c.classList.remove("sel"));
    b.classList.add("sel");
  };
  b.querySelector(".prev").onclick = (e) => {
    e.stopPropagation();
    const prev = b.querySelector(".prev");
    prev.textContent = "…";
    previsualizar(v).catch(() => {}).finally(() => { prev.textContent = "▶"; });
  };
  contVoces.appendChild(b);
}
async function previsualizar(v) {
  try {
    const blob = await synthPuente(`Hola, soy ${v.nombre}. Voy a leer tus apuntes contigo.`, v.id, "+0%");
    const url = URL.createObjectURL(blob);
    player.src = url;
    player.playbackRate = velocidad;
    $("playerPill").classList.remove("oculto");
    $("menuVoz").classList.add("oculto");
    $("vozActual").textContent = "Muestra · " + v.nombre;
    $("tPos").textContent = "Muestra de voz";
    $("btnDescargar").style.display = "none";
    player.onended = () => { $("btnPlay").textContent = "▶"; };
    refrescarPlay();
    player.play().catch(() => {});
  } catch (e) { toast("No pude conectar con el servidor de voces."); }
}

/* ---------------- fish audio panel ---------------- */
$("fishKey").value = localStorage.getItem("tanz-fish-key") || "";
$("fishRef").value = localStorage.getItem("tanz-fish-ref") || "";
$("fishToggle").addEventListener("click", async () => {
  const p = $("fishPanel");
  p.classList.toggle("oculto");
  if (!p.classList.contains("oculto") && !$("fishEstado").dataset.revisado) {
    $("fishEstado").textContent = "Revisando el servidor de voces…";
    try {
      const r = await fetch(PUENTE + "/fish/ping", { signal: AbortSignal.timeout(8000) });
      $("fishEstado").textContent = r.ok ? "" : "Tu servidor de voces todavía no tiene el módulo Fish: falta una actualización.";
    } catch (e) { $("fishEstado").textContent = "No pude contactar el servidor de voces."; }
    $("fishEstado").dataset.revisado = "1";
  }
});
for (const [id, llave] of [["fishKey", "tanz-fish-key"], ["fishRef", "tanz-fish-ref"]]) {
  $(id).addEventListener("input", (e) => {
    if (e.target.value.trim()) localStorage.setItem(llave, e.target.value.trim());
    else localStorage.removeItem(llave);
    $("fishEstado").textContent = fishActivo() ? "Listo: la próxima generación usará tu voz clonada." : "";
  });
}

/* ---------------- descarga ---------------- */
function prepararDescarga() {
  if (!docActual || !docActual.blobTotal) return;
  const dl = $("btnDescargar");
  dl.href = URL.createObjectURL(docActual.blobTotal);
  dl.download = (docActual.nombre || "tanz") + ".mp3";
  dl.onclick = null;
}

pinIniciar();
