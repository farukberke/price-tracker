const { fetchProduct } = require("../src/sites/trendyol");

// Deliberate live check: `npm run check:live [url]`
//
// The test suite runs against saved fixtures and never touches the network. That keeps tests fast,
// offline-safe and polite — but it cannot catch the one failure that actually kills a scraper:
// the site changing its markup. Fixtures are a photograph; this is a phone call.
//
// Run it when tests pass but you want to know the parser still matches reality. If it fails with
// a ParseError, the adapter needs updating and the fixtures need re-saving.

const DEFAULT_URL =
  "https://www.trendyol.com/alice/snob-premium-yetiskin-kedi-mamasi-5x1kg-p-33491694";

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  console.log(`Fetching ${url}\n`);

  const started = Date.now();
  const p = await fetchProduct(url);
  const ms = Date.now() - started;

  console.log(`  name     : ${p.name}`);
  console.log(`  brand    : ${p.brand}`);
  console.log(`  category : ${p.category}`);
  console.log(`  price    : ${p.priceText}  (${p.price} ${p.currency})`);
  console.log(`  original : ${p.originalPrice}`);
  console.log(`  in stock : ${p.inStock}`);
  console.log(`  merchant : ${p.merchant}`);
  console.log(`  rating   : ${p.rating}`);
  console.log(`\nOK — parsed in ${ms} ms, no browser.`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  console.error("\nIf this is a ParseError, Trendyol's page shape changed:");
  console.error("  1. re-save the fixture:  curl <url> > test/fixtures/trendyol-product.html");
  console.error("  2. update src/sites/trendyol.js to match");
  console.error("  3. the fixture tests will then lock the new shape in");
  process.exit(1);
});
