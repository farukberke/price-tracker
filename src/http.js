const https = require("https");
const zlib = require("zlib");

// Minimal GET built on node:https — deliberately NOT global fetch().
//
// Trendyol answers https.request with 200 and fetch() with 403, same URL, same headers, same IP,
// same machine, same second. It is not TLS fingerprinting: Node's default TLS stack passes fine.
// The difference is undici (what fetch() runs on) rewriting the request — it lowercases and
// reorders headers, and bot protection of the Akamai family fingerprints HTTP/1.1 header order.
// https.request sends headers in the order given, which reads as an ordinary client.
//
// This is the whole reason the project needs no headless browser. Reaching for Puppeteer here
// would have cost ~300 MB and seconds per check to work around a header-ordering quirk.

const DEFAULT_HEADERS = {
  // Order matters (see above); this mirrors what a browser sends.
  // Host is not listed: node emits it first on its own, and passing it explicitly as undefined
  // throws ("Invalid value 'undefined' for header 'Host'").
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9",
  "Accept-Encoding": "gzip, deflate",
  Connection: "close",
};

function decompress(res, buffer) {
  const encoding = (res.headers["content-encoding"] || "").toLowerCase();
  if (encoding === "gzip") return zlib.gunzipSync(buffer);
  if (encoding === "deflate") return zlib.inflateSync(buffer);
  if (encoding === "br") return zlib.brotliDecompressSync(buffer);
  return buffer;
}

// Returns a fetch-shaped result ({ ok, status, text() }) so callers and tests can swap in
// anything with the same shape.
function get(url, { timeoutMs = 15000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: "GET", headers: { ...DEFAULT_HEADERS, ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let body;
          try {
            body = decompress(res, Buffer.concat(chunks)).toString("utf8");
          } catch (err) {
            reject(new Error(`Could not decode response body: ${err.message}`));
            return;
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => body,
          });
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out after ${timeoutMs} ms: ${url}`));
    });
    req.end();
  });
}

module.exports = { get, DEFAULT_HEADERS };
