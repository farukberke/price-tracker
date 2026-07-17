const assert = require("node:assert/strict");
const test = require("node:test");

const { detectChange } = require("../src/changes");

const observed = (over = {}) => ({ price: 1379, inStock: true, ...over });
const parsed = (over = {}) => ({ price: 1379, inStock: true, ...over });

test("first sight is never a change — no previous price means nothing to compare", () => {
  const result = detectChange(null, parsed());
  assert.equal(result.firstSeen, true);
  assert.equal(result.changed, false);
  assert.equal(result.price, null);
});

test("same price, same stock: no change", () => {
  const result = detectChange(observed(), parsed());
  assert.equal(result.changed, false);
  assert.equal(result.price, null);
  assert.equal(result.stock, null);
});

test("price drop is reported with direction and delta", () => {
  const result = detectChange(observed({ price: 1379 }), parsed({ price: 1299 }));
  assert.equal(result.changed, true);
  assert.equal(result.price.direction, "down");
  assert.equal(result.price.old, 1379);
  assert.equal(result.price.new, 1299);
  assert.equal(result.price.delta, -80);
});

test("price rise is reported as up", () => {
  const result = detectChange(observed({ price: 1299 }), parsed({ price: 1499 }));
  assert.equal(result.price.direction, "up");
  assert.equal(result.price.delta, 200);
});

test("delta does not carry floating-point dust", () => {
  const result = detectChange(observed({ price: 1299.9 }), parsed({ price: 1299.8 }));
  assert.equal(result.price.delta, -0.1);
});

test("going out of stock is a change even when the price is unchanged", () => {
  const result = detectChange(observed({ inStock: true }), parsed({ inStock: false }));
  assert.equal(result.changed, true);
  assert.deepEqual(result.stock, { old: true, new: false });
  assert.equal(result.price, null);
});

test("price and stock can change together", () => {
  const result = detectChange(
    observed({ price: 1379, inStock: true }),
    parsed({ price: 0, inStock: false })
  );
  assert.equal(result.changed, true);
  assert.ok(result.price);
  assert.ok(result.stock);
});
