const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

// Price history on disk. Without it there is no "changed since last time": each run would only see
// the current price and could never fire an alert. node:sqlite ships with Node 22+, so this adds no
// dependency and no native build step.
//
// One append-only table. Every check writes a row; the latest row for a product is its current
// price, and the row before that is what we compare against. We do NOT keep a separate "products"
// table: the product's name/merchant can change over time (rename, new seller wins the buy box),
// and stamping them on each row keeps that history instead of overwriting it.

// Tests pass ":memory:" and never touch disk.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "prices.db");

function openDatabase(dbPath = DB_PATH) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const database = new DatabaseSync(dbPath);

  // WAL: a reader (e.g. a report script) can read while the watcher writes.
  // A memory database has no file, so WAL is meaningless there.
  if (dbPath !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      url TEXT NOT NULL,
      name TEXT NOT NULL,
      merchant TEXT,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      in_stock INTEGER NOT NULL,          -- 0 | 1 (SQLite has no boolean)
      checked_at TEXT NOT NULL            -- ISO-8601 UTC
    );

    -- "latest row for this product" is the hot query (every check does it); index it.
    CREATE INDEX IF NOT EXISTS idx_price_history_product
      ON price_history (product_id, id);
  `);

  return database;
}

// Appends one observation. Returns the inserted row (with its price shape) so the caller does not
// need a second read to know what was just stored.
function recordPrice(database, product, checkedAt = new Date().toISOString()) {
  database
    .prepare(
      `INSERT INTO price_history
         (product_id, url, name, merchant, price, currency, in_stock, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      product.id,
      product.url, // required: a row we cannot re-fetch is not worth tracking (schema is NOT NULL)
      product.name,
      product.merchant ?? null,
      product.price,
      product.currency,
      product.inStock ? 1 : 0,
      checkedAt
    );
  return lastPrice(database, product.id);
}

// The most recent observation for a product, or null if we have never seen it.
//
// Null is the signal the change detector needs on a first run: "no previous price" must read as
// "nothing to compare", never as "changed". Ordering by id (monotonic) not checked_at, because two
// checks in the same millisecond would tie on the timestamp but never on the autoincrement id.
function lastPrice(database, productId) {
  const row = database
    .prepare(
      `SELECT product_id, url, name, merchant, price, currency, in_stock, checked_at
         FROM price_history
        WHERE product_id = ?
        ORDER BY id DESC
        LIMIT 1`
    )
    .get(productId);
  if (!row) return null;
  return { ...row, inStock: row.in_stock === 1 };
}

module.exports = { openDatabase, recordPrice, lastPrice, DB_PATH };
