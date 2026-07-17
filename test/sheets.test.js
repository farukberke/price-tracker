const assert = require("node:assert/strict");
const test = require("node:test");

const { appendRow, isConfigured } = require("../src/sheets");

// A fake Sheets client shaped like googleapis' sheets.spreadsheets.values.append.
function fakeClient(onAppend) {
  return { spreadsheets: { values: { append: async (params) => { onAppend(params); return {}; } } } };
}

test("isConfigured needs both a sheet id and an existing key file", () => {
  // __filename is a file that definitely exists; a bogus path stands in for a missing key.
  assert.equal(isConfigured({ sheetId: "S", keyFile: __filename }), true);
  assert.equal(isConfigured({ sheetId: "", keyFile: __filename }), false);
  assert.equal(isConfigured({ sheetId: "S", keyFile: "no-such-key.json" }), false);
});

test("appendRow targets the configured sheet and tab with the row values", async () => {
  let seen = null;
  await appendRow(["a", "b", "c"], {
    sheetId: "SHEET123",
    tab: "Changes",
    client: fakeClient((p) => { seen = p; }),
  });

  assert.equal(seen.spreadsheetId, "SHEET123");
  assert.match(seen.range, /^Changes!/);
  assert.deepEqual(seen.requestBody.values, [["a", "b", "c"]]);
  assert.equal(seen.valueInputOption, "USER_ENTERED");
});

test("appendRow refuses to write when no sheet id is configured", async () => {
  await assert.rejects(
    () => appendRow(["a"], { sheetId: "", client: fakeClient(() => {}) }),
    /not configured/
  );
});
