const https = require("https");

// Telegram notifier. One HTTP request per alert — no SDK, no dependency (Telegram's Bot API is a
// plain HTTPS endpoint). This is the transport only: it sends a piece of text. Turning a price
// change into that text is watch.js's job (formatChange), which keeps this file agnostic about what
// a "change" looks like and avoids an import cycle with watch.
//
// Config comes from the environment (.env in dev, real env vars in prod). Node 22 loads .env
// natively via process.loadEnvFile(), so there is still zero dependency here — see CLAUDE.md.

// Load .env if one exists. Missing file is fine: in production the vars come from the real
// environment, and loadEnvFile() throws rather than no-ops when the file is absent.
try {
  process.loadEnvFile();
} catch {
  // no .env — rely on process.env as-is
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// True only when both halves are present. watch.js checks this before wiring the notifier in, so an
// unconfigured install logs to the console instead of throwing on every change.
function isConfigured({ token = BOT_TOKEN, chatId = CHAT_ID } = {}) {
  return Boolean(token && chatId);
}

// Sends one message. Throws if not configured (a silent send that goes nowhere is the worst
// outcome — it looks like the alert fired). postImpl is injectable so tests never hit Telegram.
async function sendMessage(text, { token = BOT_TOKEN, chatId = CHAT_ID, postImpl = postJson } = {}) {
  if (!token || !chatId) {
    throw new Error(
      "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (see .env.example)."
    );
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await postImpl(url, { chat_id: chatId, text });
  if (!res.ok) {
    // Telegram puts the reason in `description` (e.g. "chat not found", "bot was blocked").
    throw new Error(`Telegram sendMessage failed (${res.status}): ${res.description ?? "unknown"}`);
  }
  return res;
}

// Minimal JSON POST on node:https, matching the project's no-fetch stance in http.js. Returns
// { ok, status, description } parsed from Telegram's response envelope.
function postJson(url, payload, { timeoutMs = 15000 } = {}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = {};
          try {
            parsed = JSON.parse(raw);
          } catch {
            // Telegram always returns JSON; a non-JSON body means an infra error page.
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300 && parsed.ok === true,
            status: res.statusCode,
            description: parsed.description,
            result: parsed.result,
          });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out after ${timeoutMs} ms: ${url}`));
    });
    req.end(body);
  });
}

module.exports = { sendMessage, isConfigured, postJson };
