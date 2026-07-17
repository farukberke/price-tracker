// Trendyol product adapter.
//
// The price is NOT scraped from the rendered DOM. Trendyol embeds the whole product as JSON in a
// <script> tag (`window["__envoy__SHARED_PROPS"]`), so a plain fetch is enough — no headless
// browser. That matters: Puppeteer would add ~300 MB, seconds per check, and a bot-detection
// surface, to read a number that is already sitting in the HTML.
//
// Why JSON and not a regex over the HTML: the page contains dozens of price-shaped strings (list
// price, installments, similar products, ads). A regex picks one of them and, when the layout
// shifts, silently starts reporting the wrong number. Wrong prices are worse than no prices —
// nobody notices until a customer acts on one.

const { get: httpGet } = require("../http");

const STATE_KEY = 'window["__envoy__SHARED_PROPS"]';

class ParseError extends Error {}

// Pulls the first balanced {...} that follows `key`.
//
// Brace counting has to ignore braces inside strings: product descriptions contain "}" and a naive
// counter closes the object early, then JSON.parse fails on a truncated blob. Escapes matter too —
// a \" inside a string would otherwise be read as the string's end.
function extractState(html, key = STATE_KEY) {
  const start = html.indexOf(key);
  if (start < 0) return null;
  const open = html.indexOf("{", start);
  if (open < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const c = html[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return html.slice(open, i + 1);
    }
  }
  return null; // unbalanced: truncated response
}

// Reads product fields out of the embedded state.
//
// Price lives under `merchantListing.winnerVariant` — the offer that currently wins the buy box.
// A Trendyol product can have many sellers; the winner's price is the one a customer actually
// pays, and the one worth tracking.
function parseProduct(html) {
  const raw = extractState(html);
  if (!raw) {
    throw new ParseError(
      "Product state not found. Either the page shape changed, or the response is not a product page."
    );
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch (cause) {
    throw new ParseError(`Product state is not valid JSON: ${cause.message}`);
  }

  const product = state.product;
  const price = product?.merchantListing?.winnerVariant?.price;
  if (!product?.name || !price?.sellingPrice) {
    // Fail loud. A tracker that reports `undefined` as a price is worse than one that stops:
    // silent nulls look like "no change" and the alert never fires.
    throw new ParseError(
      `Product state found but fields are missing (name=${product?.name}, price=${!!price}). Trendyol's schema likely changed.`
    );
  }

  return {
    id: String(product.id),
    name: product.name,
    brand: product.brand?.name ?? null,
    category: product.category?.name ?? null,
    currency: price.currency ?? "TRY",
    price: price.sellingPrice.value,
    priceText: price.sellingPrice.text,
    originalPrice: price.originalPrice?.value ?? null,
    inStock: Boolean(product.inStock),
    // Seller lives on merchantListing itself, not the winnerVariant. The winnerVariant carries the
    // winning *offer* (price, stock); merchantListing.merchant is who is behind it.
    merchant: product.merchantListing?.merchant?.name ?? null,
    rating: product.ratingScore?.averageRating ?? null,
  };
}

// One product page -> normalized product.
//
// Uses src/http.js, not global fetch(): Trendyol returns 403 to fetch() and 200 to node:https for
// the same request (see the note in http.js). `fetchImpl` stays injectable so tests never go out
// to the network.
//
// No retries here on purpose: the caller decides the policy. A tracker that retries hard on its own
// turns a site hiccup into a hammering loop.
async function fetchProduct(url, { timeoutMs = 15000, fetchImpl = httpGet } = {}) {
  if (!/^https:\/\/(www\.)?trendyol\.com\//.test(url)) {
    throw new Error(`Not a Trendyol URL: ${url}`);
  }

  const res = await fetchImpl(url, { timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { ...parseProduct(await res.text()), url };
}

module.exports = { fetchProduct, parseProduct, extractState, ParseError, STATE_KEY };
