const assert = require("assert");
const test = require("node:test");
const { createBilibiliFailure } = require("../bilibiliFailure");

const RETRYABLE_CASES = [
  {
    name: "request timeout",
    error: { code: "request-timeout" },
    kind: "timeout",
  },
  {
    name: "HTTP rate limit",
    error: { code: "request-failed", httpStatus: 429 },
    kind: "rate-limited",
  },
  {
    name: "HTTP server failure",
    error: { code: "request-failed", httpStatus: 503 },
    kind: "server",
  },
  {
    name: "Bilibili WBI rejection",
    error: { code: "bilibili-api-error", bilibiliCode: -412 },
    kind: "request-rejected",
  },
];

const PERMANENT_CASES = [
  {
    name: "missing audio stream",
    error: { code: "no-audio-stream" },
    kind: "no-audio-stream",
  },
  {
    name: "HTTP not found",
    error: { code: "request-failed", httpStatus: 404 },
    kind: "not-found",
  },
  {
    name: "Bilibili not found",
    error: { code: "bilibili-api-error", bilibiliCode: -404 },
    kind: "not-found",
  },
];

for (const { name, error, kind } of RETRYABLE_CASES) {
  test(`${name} is retryable`, () => {
    const result = createBilibiliFailure(error, "manifest");
    assert.strictEqual(result.stage, "manifest");
    assert.strictEqual(result.kind, kind);
    assert.strictEqual(result.retryable, true);
  });
}

for (const { name, error, kind } of PERMANENT_CASES) {
  test(`${name} is permanent`, () => {
    const result = createBilibiliFailure(error, "manifest");
    assert.strictEqual(result.kind, kind);
    assert.strictEqual(result.retryable, false);
  });
}

test("failure contracts do not expose raw signed URLs or error messages", () => {
  const result = createBilibiliFailure(
    {
      code: "https://cdn.example/audio.m4s?token=private",
      message: "https://cdn.example/audio.m4s?token=private",
    },
    "manifest"
  );

  assert.strictEqual(result.status, "request-failed");
  assert.ok(!JSON.stringify(result).includes("token=private"));
  assert.ok(!JSON.stringify(result).includes("cdn.example"));
});
