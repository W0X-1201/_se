import assert from "node:assert/strict";
import {
  worker,
  handleApi,
  json,
  hashPassword,
  signSession,
  verifySession,
  isValidEmail,
  isValidDate,
  parseIntStrict,
  todayString,
  getTemplate,
  listTemplates,
} from "./index.js";

const AUTH_SECRET = "test-secret-please-change-1234567890";
const SALT_A = "00112233445566778899aabbccddeeff";
const SALT_B = "ffeeddccbbaa99887766554433221100";

let checks = 0;

function ok(label) {
  checks += 1;
  console.log(`  PASS  ${label}`);
}

function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  section("1. Shop templates");
  const templates = listTemplates();
  assert.equal(templates.length, 4);
  assert.deepEqual(
    templates.map((template) => template.key),
    ["bubble_tea", "barber", "grocery", "coffee"]
  );
  assert.equal(getTemplate("coffee").label, "咖啡");
  assert.equal(getTemplate("coffee").products.length, 6);
  assert.equal(getTemplate("does-not-exist"), null);
  ok("listTemplates() returns 4 templates");
  ok("getTemplate() returns the coffee template with 6 products");
  ok("getTemplate() returns null for unknown keys");

  section("2. Validation helpers");
  assert.equal(isValidEmail("student@nqu.edu.tw"), true);
  assert.equal(isValidEmail("student@nqu"), false);
  assert.equal(isValidEmail("not an email"), false);
  ok("isValidEmail() accepts valid and rejects invalid emails");

  assert.equal(isValidDate("2026-11-13"), true);
  assert.equal(isValidDate("2024-02-29"), true);
  assert.equal(isValidDate("2025-02-29"), false);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("2026/11/13"), false);
  ok("isValidDate() validates YYYY-MM-DD and leap years");

  assert.equal(parseIntStrict(12), 12);
  assert.equal(parseIntStrict("12"), 12);
  assert.equal(parseIntStrict("1.5"), null);
  assert.equal(parseIntStrict(-1), -1);
  assert.equal(parseIntStrict("abc"), null);
  ok("parseIntStrict() only accepts integers");

  assert.match(todayString(), /^\d{4}-\d{2}-\d{2}$/);
  ok("todayString() returns a YYYY-MM-DD string");

  section("3. Password hashing and session signing");
  const hashA = await hashPassword("hunter22", SALT_A);
  const hashA2 = await hashPassword("hunter22", SALT_A);
  const hashB = await hashPassword("hunter22", SALT_B);
  assert.equal(hashA, hashA2);
  assert.notEqual(hashA, hashB);
  assert.match(hashA, /^[0-9a-f]{64}$/);
  ok("hashPassword() is deterministic per salt and uses PBKDF2-SHA256");

  const token = await signSession(7, AUTH_SECRET);
  assert.deepEqual(await verifySession(token, AUTH_SECRET), { userId: 7 });
  assert.equal(await verifySession(token, `${AUTH_SECRET}-wrong`), null);

  const [userIdPart, expiryPart, signaturePart] = token.split(".");
  const flipped = signaturePart[0] === "0" ? "1" : "0";
  const tampered = `${userIdPart}.${expiryPart}.${flipped}${signaturePart.slice(1)}`;
  assert.equal(await verifySession(tampered, AUTH_SECRET), null);
  assert.equal(await verifySession(null, AUTH_SECRET), null);
  ok("signSession() / verifySession() round-trip and reject tampering");

  section("4. JSON response helper");
  const response = json({ ok: true }, 201, { "x-test": "yes" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-test"), "yes");
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { ok: true });
  ok("json() builds a JSON Response with status and headers");

  section("5. API router (handleApi)");
  const env = { AUTH_SECRET };

  const templatesRes = await handleApi(
    new Request("https://myshop.test/api/templates"),
    env
  );
  assert.equal(templatesRes.status, 200);
  assert.equal((await templatesRes.json()).templates.length, 4);
  ok("GET /api/templates returns all templates without login");

  const meRes = await handleApi(new Request("https://myshop.test/api/auth/me"), env);
  assert.equal(meRes.status, 401);
  ok("GET /api/auth/me requires a session");

  const badRegister = await handleApi(
    new Request("https://myshop.test/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "this-is-not-json",
    }),
    env
  );
  assert.equal(badRegister.status, 400);
  ok("POST /api/auth/register rejects malformed JSON before touching D1");

  const missingRoute = await handleApi(
    new Request("https://myshop.test/api/nope"),
    env
  );
  assert.equal(missingRoute.status, 404);
  ok("Unknown API routes return 404");

  const missingSecret = await handleApi(
    new Request("https://myshop.test/api/templates"),
    {}
  );
  assert.equal(missingSecret.status, 500);
  ok("Missing AUTH_SECRET returns 500");

  section("6. Cloudflare Worker fetch handler");
  const assetResponse = () => new Response("static-asset", { status: 200 });
  const workerEnv = { AUTH_SECRET, ASSETS: { fetch: assetResponse } };

  const apiViaWorker = await worker.fetch(
    new Request("https://myshop.test/api/templates"),
    workerEnv
  );
  assert.equal(apiViaWorker.status, 200);
  assert.equal((await apiViaWorker.json()).templates.length, 4);
  ok("worker.fetch() routes /api/* to the API handler");

  const assetViaWorker = await worker.fetch(
    new Request("https://myshop.test/"),
    workerEnv
  );
  assert.equal(await assetViaWorker.text(), "static-asset");
  ok("worker.fetch() delegates non-API requests to env.ASSETS");

  console.log(`\nAll ${checks} checks passed.`);
}

main().catch((error) => {
  console.error("\nTest failed:");
  console.error(error);
  process.exitCode = 1;
});
