const assert = require("node:assert/strict");
const test = require("node:test");

const { openDatabase, recordPrice, lastPrice } = require("../src/db");

// Every test gets its own in-memory database, so they never touch disk and never share state.
const freshDb = () => openDatabase(":memory:");

const sampleProduct = (overrides = {}) => ({
  id: "33491694",
  url: "https://www.trendyol.com/alice/x-p-33491694",
  name: "Snob Premium Yetişkin Kedi Maması 5x1kg",
  merchant: "Petmama",
  price: 1379,
  currency: "TRY",
  inStock: true,
  ...overrides,
});

test("lastPrice is null before anything is recorded — a first run must not read as a change", () => {
  const db = freshDb();
  assert.equal(lastPrice(db, "33491694"), null);
});

test("recordPrice stores the observation and returns it back", () => {
  const db = freshDb();
  const stored = recordPrice(db, sampleProduct());

  assert.equal(stored.price, 1379);
  assert.equal(stored.merchant, "Petmama");
  assert.equal(stored.currency, "TRY");
  assert.equal(stored.inStock, true, "in_stock must round-trip back to a boolean, not 1");
});

test("lastPrice returns the most recent row, not the first", () => {
  const db = freshDb();
  recordPrice(db, sampleProduct({ price: 1379 }), "2026-07-15T10:00:00.000Z");
  recordPrice(db, sampleProduct({ price: 1299 }), "2026-07-16T10:00:00.000Z");

  const latest = lastPrice(db, "33491694");
  assert.equal(latest.price, 1299);
  assert.equal(latest.checked_at, "2026-07-16T10:00:00.000Z");
});

test("ordering is by insert order, not timestamp — same-millisecond checks still order correctly", () => {
  // Two checks that tie on checked_at must still resolve to the one inserted last. Ordering by id
  // (autoincrement) guarantees that; ordering by checked_at would be a coin flip.
  const db = freshDb();
  const ts = "2026-07-17T12:00:00.000Z";
  recordPrice(db, sampleProduct({ price: 1000 }), ts);
  recordPrice(db, sampleProduct({ price: 900 }), ts);

  assert.equal(lastPrice(db, "33491694").price, 900);
});

test("history is kept per product — one product's checks never mask another's", () => {
  const db = freshDb();
  recordPrice(db, sampleProduct({ id: "1", price: 100 }));
  recordPrice(db, sampleProduct({ id: "2", price: 200 }));

  assert.equal(lastPrice(db, "1").price, 100);
  assert.equal(lastPrice(db, "2").price, 200);
});

test("optional fields tolerate nulls — a product with no merchant still records", () => {
  const db = freshDb();
  const stored = recordPrice(db, sampleProduct({ merchant: null }));
  assert.equal(stored.merchant, null);
});
