/* Tanz — documentos → audiolibro. Voz: Edge TTS desde el navegador.
   Biblioteca sincronizada: un repositorio privado de GitHub (Contents API). */
"use strict";

/* ---------------- configuración (horneada: no hay nada que escribir) ---------------- */
const CFG = {
  user: "aranzaagallardo-ai",
  repo: "tanz-biblioteca",
  token: ["github_pat_11CNPKXYA0", "x5BAEzDPKHkH_HcvOeWs4RQP8qe19J2IrcNoUSGdFK2NIKir8a1kJWW3ETJDWNRGWjyjb1TO"].join(""),
};
let vozSel = localStorage.getItem("tanz-voz") || "es-CL-CatalinaNeural";
let docTexto = "", docNombre = "", docBlobAudio = null;

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
  // devuelve {sha, blob} o null si 404
  const r = await gh(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GitHub " + r.status);
  const j = await r.json();
  const raw = await fetch(j.url, {
    headers: { Authorization: `Bearer ${CFG.token}`, Accept: "application/vnd.github.raw" },
  });
  return { sha: j.sha, blob: await raw.blob() };
}
async function ghEscribir(path, blob, mensaje, sha) {
  const content = await base64DesdeBlob(blob);
  const body = { message, content };
  if (sha) body.sha = sha;
  const r = await gh(path, { method: "PUT", body: JSON.stringify(body) });
  if (!r.ok) throw new Error("GitHub " + r.status + " al escribir " + path);
  return r.json();
}
async function ghBorrar(path, sha) {
  const r = await gh(path, { method: "DELETE", body: JSON.stringify({ message: "borrar " + path, sha }) });
  if (!r.ok && r.status !== 404) throw new Error("GitHub " + r.status + " al borrar " + path);
}
async function ghLeerJSON(path) {
  const r = await gh(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GitHub " + r.status);
  const j = await r.json();
  const raw = await fetch(j.url, {
    headers: { Authorization: `Bearer ${CFG.token}`, Accept: "application/vnd.github.raw" },
  });
  return { sha: j.sha, data: await raw.json() };
}

/* ---------------- síntesis Edge TTS en el navegador ---------------- */
const TRUST = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const GEC_VERSION = "1-143.0.3650.75";

async function gecToken() {
  let t = Date.now() / 1000 + 11644473600;
  t -= t % 300;
  const ticks = BigInt(Math.round(t)) * 10000000n;
  const data = new TextEncoder().encode(ticks.toString() + TRUST);
  const h = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function synthChunk(texto, voz, rate) {
  return new Promise(async (resolve, reject) => {
    const lang = (VOCES.find((v) => v.id === voz) || VOCES[0]).id.slice(0, 5);
    const esc = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
      `<voice name='${voz}'><prosody rate='${rate}' volume='+0%' pitch='+0Hz'>${esc}</prosody></voice></speak>`;
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
      `?TrustedClientToken=${TRUST}&ConnectionId=${crypto.randomUUID()}` +
      `&Sec-MS-GEC=${await gecToken()}&Sec-MS-GEC-Version=${GEC_VERSION}`;
    const trozos = [];
    let ok = false;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const timeout = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("timeout")); }, 30000);
    ws.onopen = () => {
      const ts = new Date().toUTCString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},` +
        `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
      ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}\r\nPath:ssml\r\n\r\n${ssml}`);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) { ok = true; try { ws.close(); } catch {} }
      } else {
        const len = (ev.data[0] << 8) | ev.data[1];
        const hdr = new TextDecoder().decode(new Uint8Array(ev.data, 2, len));
        if (hdr.includes("Path:audio")) trozos.push(new Uint8Array(ev.data, 2 + len).slice());
      }
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (ok && trozos.length) resolve(new Blob(trozos, { type: "audio/mpeg" }));
      else reject(new Error("sin audio"));
    };
    ws.onerror = () => { clearTimeout(timeout); try { ws.close(); } catch {} };
  });
}
async function synthConReintento(texto, voz, rate) {
  for (let i = 0; i < 3; i++) {
    try { return await synthChunk(texto, voz, rate); }
    catch (e) { if (i === 2) throw e; await new Promise((r) => setTimeout(r, 900 * (i + 1))); }
  }
}

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
  t = t.replace(/(\d)-(\d)/g, "$1 a $2");
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
    // reconstruir líneas: une letras espaciadas y separa palabras (umbral adaptativo)
    const orden = [...lineas.entries()].sort((a, b) => b[0] - a[0]).map(([, frags]) => {
      frags.sort((a, b) => a.x - b.x);
      if (frags.length === 1) return frags[0].s.trim();
      const gaps = [];
      for (let i = 1; i < frags.length; i++) gaps.push(Math.max(0, frags[i].x - (frags[i-1].x + frags[i-1].w)));
      const cortas = frags.filter((f) => f.s.trim().length <= 2).length;
      const espaciada = frags.length >= 6 && cortas >= frags.length * 0.5;
      let umbral = 2.2;
      if (espaciada && gaps.length > 1) {
        const chicos = gaps.filter((g) => g <= 15);   // ignorar saltos de columnas
        const base = chicos.length >= 3 ? chicos : gaps;
        const media = base.reduce((a, b) => a + b, 0) / base.length;
        const sd = Math.sqrt(base.reduce((a, g) => a + (g - media) ** 2, 0) / base.length);
        umbral = Math.max(0.4, media + 0.6 * sd);
      }
      let linea = "", fin = -1e9;
      for (const f of frags) {
        const gap = f.x - fin;
        if (linea === "") linea = f.s;
        else if (gap > 20) linea += " — " + f.s;
        else if (gap > umbral) linea += " " + f.s;
        else linea += f.s;
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
  const umbral = Math.max(3, paginas.length * 0.6);
  const repetidas = new Set([...conteo.entries()].filter(([l, c]) => c >= umbral && l.length > 1).map(([l]) => l));
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
  docTexto = ""; docBlobAudio = null;
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

/* ---------------- generación ---------------- */
$("btnGenerar").addEventListener("click", async () => {
  if (!docTexto) return;
  $("btnGenerar").disabled = true;
  $("btnGenerar").textContent = "Generando…";
  $("barraWrap").classList.remove("oculto");
  $("resultado").classList.add("oculto");
  const rate = $("rate").value;
  const voz = vozSel;

  const trozos = [];
  let actual = "";
  for (const oracion of docTexto.replace(/\n+/g, " ").split(/(?<=[.!?;:])\s+/)) {
    if ((actual + " " + oracion).length > 550 && actual) { trozos.push(actual.trim()); actual = oracion; }
    else actual += " " + oracion;
  }
  if (actual.trim()) trozos.push(actual.trim());

  const partes = [];
  let fallo = null;
  try {
    let enviadas = 0;
    const siguiente = async (i) => {
      partes[i] = await synthConReintento(trozos[i], voz, rate);
      enviadas++;
      $("barra").style.width = (100 * enviadas / trozos.length) + "%";
      aviso(`Sintetizando parte ${enviadas} de ${trozos.length}…`);
    };
    const COLA = 2;
    const promesas = [];
    for (let i = 0; i < Math.min(COLA, trozos.length); i++) promesas.push(siguiente(i));
    for (let i = 0; i < trozos.length; i++) { await promesas[i]; if (i + COLA < trozos.length) promesas.push(siguiente(i + COLA)); }
  } catch (e) {
    fallo = e.message;
  }
  if (fallo) {
    aviso("Error de conexión con el servicio de voz: " + fallo);
    $("btnGenerar").disabled = false;
    $("btnGenerar").textContent = "Generar audiolibro";
    return;
  }

  docBlobAudio = new Blob(partes, { type: "audio/mpeg" });
  const url = URL.createObjectURL(docBlobAudio);
  $("player").src = url;
  $("player").playbackRate = parseFloat($("playback").value);
  $("btnDescargar").href = url;
  $("btnDescargar").download = docNombre + " - audiolibro.mp3";
  $("resultado").classList.remove("oculto");
  $("btnGenerar").disabled = false;
  $("btnGenerar").textContent = "Generar audiolibro";

  if ($("aNube").checked) {
    aviso("Subiendo a tu biblioteca…");
    try {
      await subirANube(docBlobAudio, docNombre, voz);
      aviso("Listo: guardado y sincronizado en todos tus dispositivos.");
      pintarBiblio();
    } catch (e) {
      aviso("Audio listo, pero falló la subida: " + e.message);
    }
  } else {
    aviso("Listo.");
  }
});

/* ---------------- biblioteca en GitHub ---------------- */
const ID_IDX = "index.json";

async function subirANube(blob, nombre, voz) {
  const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "doc";
  const id = slug + "-" + Date.now().toString(36);
  const PARTE = 900_000; // Contents API admite hasta ~1 MB por archivo
  const nPartes = Math.max(1, Math.ceil(blob.size / PARTE));
  for (let p = 1; p <= nPartes; p++) {
    aviso(`Subiendo a la biblioteca (parte ${p} de ${nPartes})…`);
    const parte = blob.slice((p - 1) * PARTE, p * PARTE);
    await ghEscribir(`docs/${id}/p${p}.mp3`, parte, `agregar ${id} parte ${p}`);
  }
  const idxFile = (await ghLeerJSON(ID_IDX)) || { sha: null, data: [] };
  const meta = { id, nombre, voz, fecha: new Date().toISOString(), partes: nPartes, bytes: blob.size };
  const idx = idxFile.data.filter((d) => d.id !== id);
  idx.unshift(meta);
  await ghEscribir(ID_IDX, new Blob([JSON.stringify(idx, null, 1)], { type: "application/json" }),
    "actualizar índice", idxFile.sha);
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
      const vozN = (VOCES.find((v) => v.id === d.voz) || {}).nombre || d.voz;
      const mb = ((d.bytes || 0) / 1e6).toFixed(1);
      div.innerHTML = `<div class="info"><b></b><small>${vozN} · ${new Date(d.fecha).toLocaleDateString("es-CL")} · ${mb} MB</small></div>`;
      div.querySelector("b").textContent = d.nombre;
      const bPlay = document.createElement("button");
      bPlay.textContent = "Escuchar";
      bPlay.onclick = () => reproducirNube(d, bPlay);
      const bDesc = document.createElement("button");
      bDesc.textContent = "MP3";
      bDesc.onclick = () => descargarNube(d);
      const bDel = document.createElement("button");
      bDel.className = "del"; bDel.textContent = "Borrar";
      bDel.onclick = async () => {
        if (!confirm(`¿Borrar "${d.nombre}"?`)) return;
        for (let p = 1; p <= (d.partes || 1); p++) {
          const f = await ghLeer(`docs/${d.id}/p${p}.mp3`);
          if (f) await ghBorrar(`docs/${d.id}/p${p}.mp3`, f.sha);
        }
        const idxFile = await ghLeerJSON(ID_IDX);
        if (idxFile) {
          const idx = idxFile.data.filter((x) => x.id !== d.id);
          await ghEscribir(ID_IDX, new Blob([JSON.stringify(idx, null, 1)], { type: "application/json" }),
            "actualizar índice", idxFile.sha);
        }
        pintarBiblio();
      };
      div.appendChild(bPlay); div.appendChild(bDesc); div.appendChild(bDel);
      cont.appendChild(div);
    }
  } catch (e) {
    cont.innerHTML = `<div class="vacio">No pude cargar la biblioteca: ${e.message}</div>`;
  }
}

async function traerPartes(d) {
  const urls = [];
  for (let p = 1; p <= (d.partes || 1); p++) {
    const f = await ghLeer(`docs/${d.id}/p${p}.mp3`);
    if (f) urls.push(URL.createObjectURL(f.blob));
  }
  return urls;
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

async function reproducirNube(d, boton) {
  boton.textContent = "Cargando…";
  try { reproducirSecuencia(await traerPartes(d), parseFloat($("playback").value)); }
  catch (e) { alert("No pude cargar el audio: " + e.message); }
  boton.textContent = "Escuchar";
}

async function descargarNube(d) {
  const urls = await traerPartes(d);
  const blobs = [];
  for (const u of urls) blobs.push(await (await fetch(u)).blob());
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(blobs, { type: "audio/mpeg" }));
  a.download = d.nombre + " - audiolibro.mp3";
  a.click();
}

$("playback").addEventListener("change", () => { $("player").playbackRate = parseFloat($("playback").value); });

/* ---------------- inicio ---------------- */
const contVoces = $("voces");
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
