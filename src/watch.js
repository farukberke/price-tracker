const fs = require("fs");
const path = require("path");
const { fetchProduct, ParseError } = require("./sites/trendyol");
const { openDatabase, recordPrice, lastPrice } = require("./db");
const { detectChange } = require("./changes");

// The loop that ties the pieces together: fetch each product, compare against the last stored
// price, record the new one, and hand any change to a callback.
//
// Design choices worth stating:
//   - Read the previous price BEFORE recording the new one. Record after. detectChange compares the
//     two; if we recorded first, "previous" would be the current price and nothing would ever look
//     changed.
//   - One product's failure must not sink the run. A network blip is transient and a ParseError is
//     schema drift — both are logged loudly and the loop moves on to the next product, so a single
//     bad page never blinds the tracker to the others.
//   - Wait between requests (CLAUDE.md: be gentle). One product, one request, spaced out.
//   - onChange is injectable. Today it logs; wiring in Telegram or Sheets later is just passing a
//     different callback — the loop itself does not change.

const DEFAULTS = {
  intervalMs: 30 * 60 * 1000, // 30 min between full passes
  delayBetweenMs: 4000, // between products within a pass
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One product through the whole pipeline. Returns the change (or null on failure) so callers/tests
// can assert on it. Never throws: failures are reported through the return value and the logger.
async function checkOne(db, url, { fetchImpl, onChange = logChange, log = console } = {}) {
  let product;
  try {
    product = await fetchProduct(url, fetchImpl ? { fetchImpl } : {});
  } catch (err) {
    // ParseError means Trendyol's schema moved — the fixtures and adapter need refreshing. Say so
    // explicitly instead of burying it as a generic failure.
    const hint =
      err instanceof ParseError
        ? " (schema drift — re-save the fixture and update the adapter)"
        : "";
    log.error(`[watch] ${url} failed: ${err.message}${hint}`);
    return null;
  }

  const previous = lastPrice(db, product.id);
  const change = detectChange(previous, product);
  recordPrice(db, product);

  if (change.changed) onChange(product, change, log);
  else if (change.firstSeen) {
    log.log(`[watch] first check: ${product.name} — ${product.priceText ?? product.price}`);
  }
  return change;
}

// One full pass over every url, spaced out. Returns how many changed.
async function watchOnce(db, urls, opts = {}) {
  const { delayBetweenMs = DEFAULTS.delayBetweenMs, sleepFn = sleep } = opts;
  let changed = 0;
  for (let i = 0; i < urls.length; i++) {
    const change = await checkOne(db, urls[i], opts);
    if (change?.changed) changed++;
    // No trailing wait after the last product — nothing follows it.
    if (i < urls.length - 1) await sleepFn(delayBetweenMs);
  }
  return changed;
}

// The forever loop. Kept separate from watchOnce so a single pass stays easy to test without a
// timer. `stop` lets a caller (or a signal handler) break out cleanly.
async function watch(db, urls, opts = {}) {
  const { intervalMs = DEFAULTS.intervalMs, sleepFn = sleep, log = console } = opts;
  const control = { stopped: false };
  while (!control.stopped) {
    await watchOnce(db, urls, opts);
    if (control.stopped) break;
    await sleepFn(intervalMs);
  }
  return control;
}

// Default onChange: a human-readable line. Same text a notifier would send later.
function logChange(product, change, log = console) {
  log.log(`[watch] CHANGE: ${formatChange(product, change)}`);
}

function formatChange(product, change) {
  const parts = [product.name];
  if (change.price) {
    const arrow = change.price.direction === "down" ? "↓" : "↑";
    const sign = change.price.delta > 0 ? "+" : "";
    parts.push(
      `${arrow} ${change.price.old} → ${change.price.new} ${product.currency} (${sign}${change.price.delta})`
    );
  }
  if (change.stock) {
    parts.push(change.stock.new ? "back in stock" : "out of stock");
  }
  return parts.join(" | ");
}

// Reads products.json (see products.example.json). Fails loudly if it is missing or shaped wrong:
// a watcher started against no config would otherwise sit in a silent no-op loop.
function loadConfig(configPath = path.join(__dirname, "..", "products.json")) {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config not found: ${configPath}. Copy products.example.json to products.json and add your URLs.`
    );
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!Array.isArray(config.urls) || config.urls.length === 0) {
    throw new Error(`${configPath} has no "urls" array to watch.`);
  }
  return config;
}

async function main() {
  const config = loadConfig();
  const db = openDatabase();
  console.log(`[watch] watching ${config.urls.length} product(s), every ${(config.intervalMs ?? DEFAULTS.intervalMs) / 60000} min`);

  const stop = (sig) => {
    console.log(`\n[watch] ${sig} — stopping after current pass.`);
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  await watch(db, config.urls, {
    intervalMs: config.intervalMs,
    delayBetweenMs: config.delayBetweenMs,
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[watch] fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { checkOne, watchOnce, watch, formatChange, loadConfig };
