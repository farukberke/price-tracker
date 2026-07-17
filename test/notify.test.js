const assert = require("node:assert/strict");
const test = require("node:test");

const { sendMessage, isConfigured } = require("../src/notify");

const creds = { token: "T", chatId: "42" };

test("isConfigured is false when either half is missing", () => {
  assert.equal(isConfigured({ token: "", chatId: "42" }), false);
  assert.equal(isConfigured({ token: "T", chatId: "" }), false);
  assert.equal(isConfigured({ token: "T", chatId: "42" }), true);
});

test("sendMessage refuses to send when unconfigured — a send that goes nowhere is the worst case", async () => {
  await assert.rejects(
    () => sendMessage("hi", { token: "", chatId: "" }),
    /not configured/
  );
});

test("sendMessage posts to the token's URL with chat_id and text", async () => {
  let seen = null;
  const postImpl = async (url, payload) => {
    seen = { url, payload };
    return { ok: true, status: 200 };
  };

  await sendMessage("price dropped", { ...creds, postImpl });

  assert.match(seen.url, /\/botT\/sendMessage$/);
  assert.equal(seen.payload.chat_id, "42");
  assert.equal(seen.payload.text, "price dropped");
});

test("sendMessage surfaces Telegram's error description instead of failing silently", async () => {
  const postImpl = async () => ({ ok: false, status: 400, description: "chat not found" });

  await assert.rejects(
    () => sendMessage("x", { ...creds, postImpl }),
    /chat not found/
  );
});
