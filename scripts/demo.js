const { fetchProduct } = require("../src/sites/trendyol");
const { openDatabase, recordPrice, lastPrice } = require("../src/db");
const { detectChange } = require("../src/changes");
const { formatChange } = require("../src/watch");

// Live demo: fetch a real product, then drive the whole pipeline — fetch, compare against history,
// detect a change, produce the alert — the way `watch` does, but in one command.
//
// check:live proves fetch/parse works; this shows what the tracker actually *does* with it. The
// "previous price" is seeded on purpose: a real drop would mean waiting for the market. That one
// value is simulated and labelled as such — everything else (the live price, the parse, the
// detection, the alert text) is real.

const DEFAULT_URL =
  "https://www.trendyol.com/alice/snob-premium-yetiskin-kedi-mamasi-5x1kg-p-33491694";

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  const db = openDatabase(":memory:");

  console.log("[1/3] Fetching live price (no browser)...\n");
  const started = Date.now();
  const product = await fetchProduct(url);
  const ms = Date.now() - started;
  console.log(`      ${product.name}`);
  console.log(
    `      ${product.priceText} (${product.price} ${product.currency}) — ${product.merchant} — parsed in ${ms} ms\n`
  );

  // Seed a higher "yesterday" price so a drop is visible. This single value is simulated.
  const pretendOld = Math.round(product.price * 1.09);
  console.log(`[2/3] Simulating an earlier check (pretend it was ${pretendOld} ${product.currency})...\n`);
  recordPrice(db, { ...product, price: pretendOld });

  console.log("[3/3] Running change detection against the live price...\n");
  const change = detectChange(lastPrice(db, product.id), product);

  if (change.changed) {
    console.log(`      >>> ALERT: ${formatChange(product, change)}`);
    console.log(`      (this exact message is what goes to Telegram / Google Sheets)\n`);
  } else {
    console.log("      No change.\n");
  }
  console.log("Done — fetch, store, detect, alert. All live, one command, no browser.");
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
