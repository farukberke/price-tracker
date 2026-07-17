const fs = require("fs");
const { google } = require("googleapis");

// Google Sheets sink. sqlite already holds the full history; a Sheet is the shareable, human-facing
// view — a change log someone can open, filter, and chart without touching the database. So this
// appends one row per change, nothing more.
//
// Like notify.js, this file is transport only: it takes an array of cell values and appends it. The
// mapping from a price change to those cells lives in watch.js (changeRow), which keeps this file
// from knowing what a "change" looks like.
//
// Auth follows the sibling project's pattern (GoogleAuth + keyFile). The service account can be
// copied from ../pet_shop_project/credentials/service-account.json — it is the same Google Cloud
// project; enabling the Sheets API there is enough. See CLAUDE.md.

const KEY_FILE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./credentials/service-account.json";
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const TAB = process.env.GOOGLE_SHEET_TAB || "Changes";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// Configured only when we know which sheet to write AND the key file is actually on disk. Checking
// the file (not just the env var) means a half-set-up install logs to the console instead of
// throwing an auth error on the first change.
function isConfigured({ sheetId = SHEET_ID, keyFile = KEY_FILE } = {}) {
  return Boolean(sheetId) && fs.existsSync(keyFile);
}

// Built once and reused. GoogleAuth does no network here; the token is fetched lazily on the first
// API call, so constructing this is cheap and safe even when nothing will be sent.
let cached;
function getClient() {
  if (cached) return cached;
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: SCOPES });
  cached = google.sheets({ version: "v4", auth });
  return cached;
}

// Appends one row to the change-log tab. Throws on an API error (a lost row should be loud, not
// swallowed here — the caller in watch decides that a failed sink must not sink the pass).
// `client` is injectable so tests never build a real Google client or hit the network.
async function appendRow(values, { sheetId = SHEET_ID, tab = TAB, client } = {}) {
  if (!sheetId) {
    throw new Error("Google Sheet is not configured (set GOOGLE_SHEET_ID; see .env.example).");
  }
  const api = client || getClient();
  await api.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A:Z`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

module.exports = { appendRow, isConfigured, getClient };
