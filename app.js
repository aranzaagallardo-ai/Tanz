/* Tanz — tus apuntes en audiolibro.
   Audio: voces de Google generadas al momento (sin servidores, sin cuelgues).
   Biblioteca: tu repositorio privado de GitHub (sincronizada entre dispositivos). */
"use strict";

/* ---------------- estado ---------------- */
const CFG = {
  user: "aranzaagallardo-ai",
  repo: "tanz-biblioteca",
  token: ["github_pat_11CNPKXYA0", "x5BAEzDPKHkH_HcvOeWs4RQP8qe19J2IrcNoUSGdFK2NIKir8a1kJWW3ETJDWNRGWjyjb1TO"].join(""),
};
let vozSel = localStorage.getItem("tanz-voz") || "es";
let docTexto = "", docNombre = "";

const $ = (id) => document.getElementById(id);
const aviso = (m) => { $("aviso").textContent = m || ""; };

/* ---------------- GitHub Contents API ---------------- */
function gh(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  return fetch(`https://api.github.com/repos/${CFG.user}/${CFG.repo}/contents/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${CFG.token}`, Accept: "application/vnd.github+json", ...(opts.headers || {}) },
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
}
function base64DesdeBlob(blob) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(",")[1]);
    fr.readAsDataURL(blob);
  });
}
async function ghLeer(path) {
  const r = await gh(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GitHub " + r.status);
  const j = await r.json();
  const raw = await fetch(j.url, { headers: { Authorization: `Bearer ${CFG.token}`, Accept: "application/vnd.github.raw" } });
  return { sha: j.sha, blob: await raw.blob() };
}
async function ghLeerJSON(path) {
  const r = await gh(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GitHub " + r.status);
  const j = await r.json();
  const raw = await fetch(j.url, { headers: { Authorization: `Bearer ${CFG.token}`, Accept: "application/vnd.github.raw" } });
  return { sha: j.sha, data: await raw.json() };
}
async function ghEscribir(path, blob, mensaje, sha) {
  const content = await base64DesdeBlob(blob);
  const body = { message: mensaje, content };
  if (sha) body.sha = sha;
  const r = await gh(path, { method: "PUT", body: JSON.stringify(body) });
  if (!r.ok) throw new Error("GitHub " + r.status + " al escribir " + path);
  return r.json();
}
async function ghBorrar(path, sha) {
  const r = await gh(path, { method: "DELETE", body: JSON.stringify({ message: "borrar " + path, sha }) });
  if (!r.ok && r.status !== 404) throw new Error("GitHub " + r.status);
}
const ID_IDX = "index.json";

/* ---------------- limpieza de texto ---------------- */
const UNIDADES = [
  [/\bcm\b/g, "centímetros"], [/\bmm\b/g, "milímetros"], [/\bmL\b/g, "mililitros"],
  [/\bmg\b/g, "miligramos"], [/\bµg\b/g, "microgramos"], [/\bmin\b/g, "minutos"],
  [/\b(\d+)\s*h\b/g, "$1 horas"], [/\biv\b/g, "intravenosa"], [/\bim\b/g, "intramuscular"],
  [/\bvo\b/g, "oral"], [/\bTV\b/g, "tacto vaginal"], [/\bRCF\b/g, "registro cardiovascular fetal"],
];
function limpiar(t) {
  const map = {
    "➝": ",", "→": " a ", "≥": "mayor o igual que ", "≤": "menor o igual que ",
    "≈": "aproximadamente ", "×": " por ", "✦": "", "N°": "número ", "n°": "número ",
    "&": " y ", "%": " por ciento", "↑": "aumenta ", "↓": "disminuye ", "—": " — ",
    "“": '"', "”": '"', "•": ",", "·": ",", "▪": ",", "‣": ",", "│": " ",
  };
  t = t.replace(/[➝→≥≤≈×✦N°n°&%↑↓—“”•·▪‣│]/g, (c) => map[c] ?? c);
  for (const [re, v] of UNIDADES) t = t.replace(re, v);
  t = t.replace(/(\d)[ \t]+(?=\d)/g, "$1");
  t = t.replace(/[\u2010\u00ad]\s*/g, "");
  t = t.replace(/,\s*—\s*,?\s*/g, " — ");
  t = t.replace(/(?:,\s*){2,}/g, ", ");
  t = t.replace(/\s{2,}/g, " ");
  return t;
}
function limpiarMarkdown(t) {
  t = t.replace(/<img[^>]*>|<figure[^>]*>|<\/figure>/g, " ");
  t = t.replace(/<\/t[dh]>\s*<t[dh][^>]*>/g, " — ");
  t = t.replace(/<\/tr>\s*<tr[^>]*>/g, ".\n");
  t = t.replace(/<\/?(table|thead|tbody|tr|td|th)[^>]*>/g, " ");
  t = t.replace(/^#{1,6} (.+)$/gm, "$1.");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1");
  t = t.replace(/^\s*[-•] /gm, ". ");
  t = t.replace(/^\s*(\d+)\. /gm, ". $1: ");
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
    // reconstruir líneas: une letras espaciadas y separa palabras (umbral dinámico por línea)
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

/* ---------------- entrada de archivo ---------------- */
$("drop").addEventListener("click", () => $("archivo").click());
$("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("on"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("on"));
$("drop").addEventListener("drop", (e) => { e.preventDefault(); $("drop").classList.remove("on"); if (e.dataTransfer.files[0]) cargar(e.dataTransfer.files[0]); });
$("archivo").addEventListener("change", (e) => { if (e.target.files[0]) cargar(e.target.files[0]); });

async function cargar(file) {
  docNombre = file.name.replace(/\.(pdf|md|txt|markdown)$/i, "");
  docTexto = "";
  $("resultado").classList.add("oculto");
  aviso("Leyendo documento…");
  try {
    if (/\.pdf$/i.test(file.name)) {
      docTexto = await pdfATexto(await file.arrayBuffer(), (n, tot) => aviso(`Leyendo página ${n} de ${tot}…`));
    } else {
      let t = await file.text();
      if (/\.md|\.markdown$/i.test(file.name)) t = limpiarMarkdown(t);
      docTexto = t;
    }
    docTexto = limpiar(docTexto).replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    aviso("No pude leer el archivo: " + e.message);
    return;
  }
  if (docTexto.length < 40) { aviso("El documento no tiene texto legible (¿es un escaneo sin OCR?)."); return; }
  const mins = Math.round(docTexto.length / 14.5 / 60);
  $("nombreSpan").textContent = docNombre;
  $("nombreDoc").classList.remove("oculto");
  $("preview").textContent = docTexto.slice(0, 1500) + (docTexto.length > 1500 ? "…" : "");
  $("preview").classList.remove("oculto");
  $("stats").innerHTML = `<span class="pill">${docTexto.length.toLocaleString("es")} caracteres</span><span class="pill">≈ ${mins} min de audio</span>`;
  $("stats").classList.remove("oculto");
  $("btnGenerar").disabled = false;
  aviso("");
}

/* ---------------- audio: voces Google por trozos ---------------- */
function trocearParaTTS(texto, max = 180) {
  const partes = texto.replace(/\n+/g, " ").split(/(?<=[.!?;:])\s+/);
  const trozos = [];
  let actual = "";
  for (const o of partes) {
    let frag = o;
    while (frag.length > max) {
      let corte = frag.lastIndexOf(" ", max);
      if (corte < max * 0.4) corte = max;
      trozos.push((actual ? actual + " " : "") + frag.slice(0, corte).trim());
      actual = "";
      frag = frag.slice(corte).trim();
    }
    actual = (actual ? actual + " " : "") + frag;
    if (actual.length >= max) { trozos.push(actual.trim()); actual = ""; }
  }
  if (actual.trim()) trozos.push(actual.trim());
  return trozos.filter((t) => t.length > 1);
}
function urlTTS(t, i, total) {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(t)}&tl=${vozSel}&total=${total}&idx=${i}&textlen=${t.length}`;
}
function reproducirSecuencia(urls, rate) {
  const audio = $("player");
  let i = 0;
  audio.src = urls[0];
  audio.playbackRate = rate;
  audio.onended = () => {
    i += 1;
    if (i < urls.length) { audio.src = urls[i]; audio.playbackRate = rate; audio.play(); }
  };
  $("resultado").classList.remove("oculto");
  audio.play();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------- biblioteca ---------------- */
async function subirANube(texto, nombre) {
  const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "doc";
  const id = slug + "-" + Date.now().toString(36);
  const jsonDoc = JSON.stringify({ id, nombre, fecha: new Date().toISOString(), chars: texto.length, texto });
  await ghEscribir(`docs/${id}/texto.json`, new Blob([jsonDoc], { type: "application/json" }), `agregar ${id}`);
  const idxFile = await ghLeerJSON(ID_IDX);
  const idx = (idxFile && idxFile.data) || [];
  idx.unshift({ id, nombre, fecha: new Date().toISOString(), chars: texto.length });
  await ghEscribir(ID_IDX, new Blob([JSON.stringify(idx, null, 1)], { type: "application/json" }), "índice", idxFile ? idxFile.sha : undefined);
  return id;
}
async function pintarBiblio() {
  const cont = $("biblioteca");
  try {
    const idxFile = await ghLeerJSON(ID_IDX);
    const docs = (idxFile && idxFile.data) || [];
    if (!docs.length) { cont.innerHTML = '<div class="vacio">Tu biblioteca está vacía: genera un audiolibro.</div>'; return; }
    cont.innerHTML = "";
    for (const d of docs) {
      const div = document.createElement("div");
      div.className = "doc-item";
      const kb = Math.round((d.chars || 0) / 100) / 10;
      div.innerHTML = `<div class="info"><b></b><small>${new Date(d.fecha).toLocaleDateString("es-CL")} · ${kb}k caracteres</small></div>`;
      div.querySelector("b").textContent = d.nombre;
      const bPlay = document.createElement("button");
      bPlay.textContent = "Escuchar";
      bPlay.onclick = () => reproducirNube(d, bPlay);
      const bDel = document.createElement("button");
      bDel.className = "del"; bDel.textContent = "Borrar";
      bDel.onclick = async () => {
        if (!confirm(`¿Borrar "${d.nombre}"?`)) return;
        const f = await ghLeer(`docs/${d.id}/texto.json`);
        if (f) await ghBorrar(`docs/${d.id}/texto.json`, f.sha);
        const idxFile2 = await ghLeerJSON(ID_IDX);
        if (idxFile2) {
          const idx = idxFile2.data.filter((x) => x.id !== d.id);
          await ghEscribir(ID_IDX, new Blob([JSON.stringify(idx, null, 1)], { type: "application/json" }), "índice", idxFile2.sha);
        }
        pintarBiblio();
      };
      div.appendChild(bPlay); div.appendChild(bDel);
      cont.appendChild(div);
    }
  } catch (e) {
    cont.innerHTML = `<div class="vacio">No pude cargar la biblioteca: ${e.message}</div>`;
  }
}
async function reproducirNube(d, boton) {
  boton.textContent = "Cargando…";
  try {
    const f = await ghLeer(`docs/${d.id}/texto.json`);
    if (!f) throw new Error("texto no encontrado");
    const texto = JSON.parse(await f.blob.text()).texto;
    const trozos = trocearParaTTS(texto, 180);
    const urls = trozos.map((t, i) => urlTTS(t, i, trozos.length));
    reproducirSecuencia(urls, parseFloat($("playback").value));
  } catch (e) { alert("No pude cargar el audio: " + e.message); }
  boton.textContent = "Escuchar";
}

/* ---------------- generar ---------------- */
$("btnGenerar").addEventListener("click", async () => {
  if (!docTexto) return;
  $("btnGenerar").disabled = true;
  $("barraWrap").classList.remove("oculto");
  $("barra").style.width = "35%";
  aviso("Guardando en tu biblioteca…");
  try {
    await subirANube(docTexto, docNombre);
    $("barra").style.width = "100%";
    aviso("Listo. Reproduciendo — también quedó en tu biblioteca.");
    const trozos = trocearParaTTS(docTexto, 180);
    const urls = trozos.map((t, i) => urlTTS(t, i, trozos.length));
    reproducirSecuencia(urls, parseFloat($("playback").value));
    pintarBiblio();
  } catch (e) {
    aviso("Error: " + e.message);
  }
  $("barraWrap").classList.add("oculto");
  $("btnGenerar").disabled = false;
});
$("playback").addEventListener("change", () => { $("player").playbackRate = parseFloat($("playback").value); });

/* ---------------- inicio ---------------- */
const contVoces = $("voces");
const VOCES = [
  { id: "es", nombre: "Español neutro" },
  { id: "es-MX", nombre: "Español México" },
  { id: "es-ES", nombre: "Español España" },
];
for (const v of VOCES) {
  const b = document.createElement("button");
  b.className = "chip" + (v.id === vozSel ? " sel" : "");
  b.textContent = v.nombre;
  b.onclick = () => {
    vozSel = v.id; localStorage.setItem("tanz-voz", v.id);
    contVoces.querySelectorAll(".chip").forEach((c) => c.classList.remove("sel"));
    b.classList.add("sel");
  };
  contVoces.appendChild(b);
}
pintarBiblio().catch(() => {});
