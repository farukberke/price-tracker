const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");

const { checkOne, watchOnce, formatChange, changeRow, makeOnChange, loadConfig } = require("../src/watch");
const { openDatabase, recordPrice, lastPrice } = require("../src/db");

const URL = "https://www.trendyol.com/alice/x-p-33491694";
const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const serve = (html) => async () => ({ ok: true, status: 200, text: async () => html });
const silent = { log() {}, error() {} };

test("checkOne records a first sighting and does not report it as a change", async () => {
  const db = openDatabase(":memory:");
  const change = await checkOne(db, URL, { fetchImpl: serve(fixture("trendyol-product.html")), log: silent });

  assert.equal(change.firstSeen, true);
  assert.equal(change.changed, false);
  // The observation must have been stored, so the next run has something to compare against.
  assert.ok(lastPrice(db, "33491694"), "first check must persist the price");
});

test("checkOne reports a change and calls onChange when the stored price differs", async () => {
  const db = openDatabase(":memory:");
  // Plant a lower previous price for the same product id, then let checkOne fetch the real (higher)
  // fixture price. The difference must surface as an upward change.
  recordPrice(db, { id: "33491694", url: URL, name: "x", price: 1, currency: "TRY", inStock: true });

  let captured = null;
  const change = await checkOne(db, URL, {
    fetchImpl: serve(fixture("trendyol-product.html")),
    onChange: (product, ch) => { captured = { product, ch }; },
    log: silent,
  });

  assert.equal(change.changed, true);
  assert.equal(change.price.direction, "up");
  assert.ok(captured, "onChange must fire on a real change");
  assert.equal(captured.product.id, "33491694");
});

test("checkOne swallows a fetch failure — one bad product does not throw", async () => {
  const db = openDatabase(":memory:");
  const boom = async () => ({ ok: false, status: 503, text: async () => "" });
  let logged = "";
  const log = { log() {}, error: (m) => { logged = m; } };

  const change = await checkOne(db, URL, { fetchImpl: boom, log });

  assert.equal(change, null, "a failed check returns null, it does not throw");
  assert.match(logged, /503/);
});

test("watchOnce spaces requests and counts how many changed", async () => {
  const db = openDatabase(":memory:");
  const urls = [URL, "https://www.trendyol.com/b/y-p-2"];
  let sleeps = 0;

  const changed = await watchOnce(db, urls, {
    fetchImpl: serve(fixture("trendyol-product.html")),
    sleepFn: async () => { sleeps++; },
    log: silent,
  });

  // Both are first sightings -> zero changes. And exactly one gap (between the two products), not
  // a trailing wait after the last one.
  assert.equal(changed, 0);
  assert.equal(sleeps, 1, "one delay between two products, none after the last");
});

test("formatChange renders a price drop with an arrow and signed delta", () => {
  const line = formatChange(
    { name: "Kedi Maması", currency: "TRY" },
    { price: { old: 1379, new: 1299, delta: -80, direction: "down" }, stock: null }
  );
  assert.match(line, /Kedi Maması/);
  assert.match(line, /↓/);
  assert.match(line, /1379 → 1299/);
  assert.match(line, /-80/);
});

const dropChange = { price: { old: 1379, new: 1299, delta: -80, direction: "down" }, stock: null };
const dropProduct = { id: "1", name: "Kedi Maması", url: "https://www.trendyol.com/x-p-1", currency: "TRY", inStock: true };

test("makeOnChange sends the change text and url to the Telegram sink", async () => {
  let sent = null;
  const onChange = makeOnChange({ telegram: true, sheet: false, sendImpl: async (t) => { sent = t; } });
  await onChange(dropProduct, dropChange, silent);

  assert.match(sent, /Kedi Maması/);
  assert.match(sent, /1379 → 1299/);
  assert.match(sent, /trendyol\.com\/x-p-1/);
});

test("makeOnChange appends a row to the Sheets sink", async () => {
  let row = null;
  const onChange = makeOnChange({ telegram: false, sheet: true, appendImpl: async (r) => { row = r; } });
  await onChange(dropProduct, dropChange, silent);

  assert.ok(Array.isArray(row));
  assert.equal(row[1], "1");            // product id
  assert.equal(row[5], 1379);           // old price
  assert.equal(row[6], 1299);           // new price
  assert.equal(row[7], -80);            // delta
});

test("a sink failure is swallowed and logged — one channel never sinks the pass", async () => {
  let errored = "";
  const log = { log() {}, error: (m) => { errored = m; } };
  const onChange = makeOnChange({
    telegram: true,
    sheet: true,
    sendImpl: async () => { throw new Error("chat not found"); },
    appendImpl: async () => {}, // sheet still succeeds
  });

  // Must not reject even though the Telegram sink blows up.
  await onChange(dropProduct, dropChange, log);
  assert.match(errored, /telegram sink failed/);
  assert.match(errored, /chat not found/);
});

test("makeOnChange with no channels only logs to the console", async () => {
  let logged = "";
  let sent = false;
  const log = { log: (m) => { logged = m; }, error() {} };
  const onChange = makeOnChange({
    telegram: false,
    sheet: false,
    sendImpl: async () => { sent = true; },
  });
  await onChange(dropProduct, dropChange, log);

  assert.match(logged, /CHANGE/);
  assert.equal(sent, false, "no send when Telegram is not configured");
});

test("changeRow records new price and blanks the old one on a first sighting", () => {
  // A first-seen product has no price change block; the row should still carry the current price.
  const row = changeRow({ id: "9", name: "n", url: "u", currency: "TRY", price: 500, inStock: false }, {
    price: null,
    stock: null,
  });
  assert.equal(row[5], "");             // no old price
  assert.equal(row[6], 500);            // current price still recorded
  assert.equal(row[8], "out of stock");
});

test("loadConfig throws a helpful error when the file is missing", () => {
  assert.throws(
    () => loadConfig(path.join(os.tmpdir(), "definitely-not-here-price-tracker.json")),
    /Copy products.example.json/
  );
});

test("loadConfig rejects a config with no urls", () => {
  const p = path.join(os.tmpdir(), `pt-empty-${Date.now()}.json`);
  fs.writeFileSync(p, JSON.stringify({ urls: [] }));
  try {
    assert.throws(() => loadConfig(p), /no "urls"/);
  } finally {
    fs.unlinkSync(p);
  }
});
