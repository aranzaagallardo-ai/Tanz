import express from "express";
import WebSocket from "ws";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.set("access-control-allow-origin", "*");
  if (req.method === "OPTIONS") { res.set("access-control-allow-headers", "content-type"); return res.sendStatus(204); }
  next();
});

const TRUST = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const GEC_VERSION = "1-143.0.3650.75";
const ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

function gec() {
  let t = Date.now() / 1000 + 11644473600;
  t -= t % 300;
  const s = (BigInt(Math.round(t)) * 10000000n).toString();
  return crypto.createHash("sha256").update(s + TRUST).digest("hex").toUpperCase();
}

function synth(texto, voice, rate) {
  return new Promise((resolve, reject) => {
    const lang = (voice || "es-ES").slice(0, 5);
    const esc = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody rate='${rate}' volume='+0%' pitch='+0Hz'>${esc}</prosody></voice></speak>`;
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
      `?TrustedClientToken=${TRUST}&ConnectionId=${crypto.randomUUID()}` +
      `&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=${GEC_VERSION}`;
    const ws = new WebSocket(url, {
      perMessageDeflate: true,
      headers: {
        Pragma: "no-cache", "Cache-Control": "no-cache", Origin: ORIGIN,
        "Accept-Encoding": "gzip, deflate, br, zstd", "Accept-Language": "es-CL,es;q=0.9",
        "User-Agent": UA, Cookie: "muid=" + crypto.randomBytes(16).toString("hex").toUpperCase() + ";",
      },
    });
    const trozos = [];
    const words = [];
    const timeout = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("timeout")); }, 25000);
    ws.on("open", () => {
      const ts = new Date().toUTCString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},` +
        `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
      ws.send(`X-RequestId:${crypto.randomBytes(16).toString("hex")}\r\nContent-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}\r\nPath:ssml\r\n\r\n${ssml}`);
    });
    ws.on("message", (data, isBin) => {
      if (!isBin) {
        const s = data.toString();
        if (s.includes("Path:audio.metadata")) {
          try {
            const body = s.slice(s.indexOf("\r\n\r\n") + 4);
            const meta = JSON.parse(body);
            for (const m of meta.Metadata || []) {
              if (m.Type === "WordBoundary" && m.Data) {
                words.push({ o: m.Data.Offset / 1e7, w: (m.Data.text && m.Data.text.Text) || "" });
              }
            }
          } catch {}
        }
        if (s.includes("Path:turn.end")) { clearTimeout(timeout); ws.close(); }
        return;
      }
      const len = (data[0] << 8) | data[1];
      const header = data.slice(2, 2 + len).toString();
      if (header.includes("Path:audio")) trozos.push(data.slice(2 + len));
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      if (trozos.length) resolve({ audio: Buffer.concat(trozos), words });
      else reject(new Error("sin audio"));
    });
    ws.on("error", (e) => { clearTimeout(timeout); reject(e); });
  });
}

app.get("/ping", (req, res) => res.json({ ok: true, ver: 2 }));

app.post("/tts", async (req, res) => {
  const { text, voice, rate, words } = req.body || {};
  if (!text || text.length > 2500) return res.status(400).json({ error: "texto inválido" });
  try {
    const r = await synth(text, voice || "es-CL-CatalinaNeural", rate || "+0%");
    if (words) {
      res.set("cache-control", "no-store");
      return res.json({ a: r.audio.toString("base64"), w: r.words });
    }
    res.set("content-type", "audio/mpeg");
    res.set("cache-control", "public, max-age=86400");
    res.send(r.audio);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 7860;
// Fish Audio (voz clonada del usuario) — proxy hacia api.fish.audio
app.get("/fish/ping", (req, res) => res.json({ ok: true }));
app.post("/fish", async (req, res) => {
  const { key, reference_id, text } = req.body || {};
  if (!key || !text) return res.status(400).json({ status: 400, message: "falta key o text" });
  try {
    const r = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        authorization: "Bearer " + key,
        "content-type": "application/json",
        model: "s2.1-pro-free",
      },
      body: JSON.stringify({ text, reference_id: reference_id || undefined, format: "mp3", normalize: true }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(() => "");
      return res.status(r.status).json({ status: r.status, message: detalle.slice(0, 300) });
    }
    res.set("content-type", r.headers.get("content-type") || "audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ status: 502, message: String(e.message || e).slice(0, 300) });
  }
});

app.listen(PORT, () => console.log("Tanz puente en puerto " + PORT));
