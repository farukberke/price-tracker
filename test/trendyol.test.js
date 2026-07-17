const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");

const { fetchProduct, parseProduct, extractState, ParseError } = require("../src/sites/trendyol");

// Fixtures are real pages, saved once. Tests never hit the network:
//   - a test that scrapes live fails when the price changes, when Trendyol is slow, or on a plane;
//   - and a test suite that hammers a live site during every `npm test` is abuse, not testing.
// The tradeoff is that fixtures go stale. That is what `npm run check:live` is for (one request,
// run deliberately) — it answers "did their schema change?", which is the only question a live
// call can answer that a fixture cannot.
const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

test("parses a real product page", () => {
  const p = parseProduct(fixture("trendyol-product.html"));

  assert.equal(p.name, "Snob Premium Yetişkin Kedi Maması 5x1kg");
  assert.equal(p.brand, "Alice");
  assert.equal(p.currency, "TRY");
  assert.equal(typeof p.price, "number");
  assert.ok(p.price > 0, `price should be positive, got ${p.price}`);
  assert.equal(p.inStock, true);
  // Seller comes from merchantListing.merchant, not winnerVariant.merchant (which does not exist).
  assert.equal(p.merchant, "Petmama");
});

test("parses a second product — parser is not tuned to one page", () => {
  const p = parseProduct(fixture("trendyol-product-2.html"));

  assert.equal(p.brand, "Long Feng");
  assert.equal(typeof p.price, "number");
  assert.ok(p.price > 0);
});

test("price is a number, not a formatted string", () => {
  // "1.379 TL" parsed naively with parseFloat gives 1.379 — a 1000x error that looks plausible.
  // Turkish formatting uses "." for thousands, so this is a real trap, not a hypothetical one.
  const p = parseProduct(fixture("trendyol-product.html"));

  assert.equal(typeof p.price, "number");
  assert.ok(Number.isInteger(p.price) || p.price % 1 !== 0);
  assert.ok(p.price > 100, `price ${p.price} looks like a thousands-separator bug`);
  assert.match(p.priceText, /TL/);
});

test("extractState ignores braces inside strings", () => {
  const html = `<script>window["__envoy__SHARED_PROPS"]={"product":{"name":"a } b","ok":1}};</script>`;
  const raw = extractState(html);

  assert.ok(raw, "should find the object");
  assert.equal(JSON.parse(raw).product.name, "a } b");
  assert.equal(JSON.parse(raw).product.ok, 1);
});

test("extractState handles escaped quotes", () => {
  const html = `<script>window["__envoy__SHARED_PROPS"]={"product":{"name":"5\\" ekran","ok":1}};</script>`;
  const raw = extractState(html);

  assert.equal(JSON.parse(raw).product.name, '5" ekran');
});

test("throws when the page has no product state", () => {
  assert.throws(() => parseProduct("<html><body>404</body></html>"), ParseError);
});

test("throws when state exists but fields are gone — schema drift must be loud", () => {
  // The failure that matters: Trendyol renames a field, the price silently becomes undefined,
  // and the tracker reports "no change" forever while the real price moves.
  const html = `<script>window["__envoy__SHARED_PROPS"]={"product":{"id":1,"name":"x"}};</script>`;

  assert.throws(() => parseProduct(html), ParseError);
});

test("rejects non-Trendyol URLs before making a request", async () => {
  let called = false;
  const spy = async () => { called = true; };

  await assert.rejects(() => fetchProduct("https://example.com/x", { fetchImpl: spy }), /Not a Trendyol URL/);
  assert.equal(called, false, "must not fetch a URL it cannot parse");
});

test("surfaces HTTP errors instead of parsing an error page", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "" });

  await assert.rejects(
    () => fetchProduct("https://www.trendyol.com/a/b-p-1", { fetchImpl }),
    /HTTP 503/
  );
});

test("fetchProduct returns the url alongside the product", async () => {
  const url = "https://www.trendyol.com/alice/x-p-33491694";
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => fixture("trendyol-product.html") });

  const p = await fetchProduct(url, { fetchImpl });

  assert.equal(p.url, url);
  assert.equal(p.id, "33491694");
});
