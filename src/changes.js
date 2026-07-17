// Change detection: given the previous observation and a freshly parsed product, decide whether
// anything worth alerting on happened.
//
// The one rule that matters most (see CLAUDE.md): on the very first check there is no previous
// price, and that must read as "nothing to report", never as "changed". A tracker that alerts on
// first sight cries wolf on every new product and gets muted.
//
// This module is pure — no db, no network, no clock. It takes two plain objects and returns a plain
// object, which is what makes the "first run stays quiet" guarantee easy to test.

// previous: a row from db.lastPrice() (or null), current: a product from the adapter.
function detectChange(previous, current) {
  if (!previous) {
    return { firstSeen: true, changed: false, price: null, stock: null };
  }

  const price =
    previous.price !== current.price
      ? {
          old: previous.price,
          new: current.price,
          delta: round2(current.price - previous.price),
          direction: current.price < previous.price ? "down" : "up",
        }
      : null;

  const stock =
    previous.inStock !== current.inStock
      ? { old: previous.inStock, new: current.inStock }
      : null;

  return {
    firstSeen: false,
    changed: Boolean(price || stock),
    price,
    stock,
  };
}

// Prices are money; subtracting floats can leave 0.1 + 0.2 style dust (1299.9 - 1299.8 = 0.099...).
// A delta is only ever shown to a human, so two decimals is both correct and enough.
function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { detectChange };
