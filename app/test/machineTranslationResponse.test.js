const assert = require("assert");
const {
  DEEPSEEK_MODEL,
  DEEPSEEK_PROMPT_VERSION,
  sanitizeDeepSeekDiagnostics,
  normalizeDeepSeekJsonContent,
  testDeepSeekApiKey,
  translateWholeLyricWithDeepSeek,
} = require("../machineTranslation");

function completion(content, finishReason = "stop") {
  return { choices: [{ finish_reason: finishReason, message: { content } }] };
}

function mockFetch(values) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(JSON.parse(options.body));
    assert.ok(
      requests.length <= values.length,
      "unexpected additional request"
    );
    const value = values[requests.length - 1];
    if (value instanceof Error) throw value;
    if (typeof value === "function") return value();
    return { ok: true, status: 200, json: async () => value };
  };
  return { fetchImpl, requests };
}

const apiKey = "test-credential-never-in-diagnostics";
const lyric = "[00:01.00]First\n[00:02.00]Second";
const translations = '{"L0001":"第一行","L0002":"第二行"}';

async function rejectsCode(action, code, attempts, mock) {
  let failure;
  await assert.rejects(action, (error) => {
    failure = error;
    return error.code === code;
  });
  assert.strictEqual(mock.requests.length, attempts);
  assert.strictEqual(failure.diagnostics.attempts, attempts);
  const serialized = JSON.stringify(failure.diagnostics);
  assert.ok(!serialized.includes(apiKey));
  assert.ok(!serialized.includes("SECRET"));
  return failure;
}

async function run() {
  assert.strictEqual(
    normalizeDeepSeekJsonContent('\ufeff{"ok":\u200btrue}'),
    '{"ok": true}'
  );
  assert.strictEqual(
    normalizeDeepSeekJsonContent('```json\n{"ok":true}\n```'),
    '{"ok":true}'
  );
  assert.strictEqual(
    normalizeDeepSeekJsonContent('{"a\u200b":"b\u200d\ufeff"}'),
    '{"a\u200b":"b\u200d\ufeff"}'
  );
  assert.strictEqual(
    normalizeDeepSeekJsonContent('{"x":"escaped \\" quote\u200b"}'),
    '{"x":"escaped \\" quote\u200b"}'
  );
  let repaired = mockFetch([completion('{"ok": \u200btrue}')]);
  await testDeepSeekApiKey({ ...repaired, apiKey });
  assert.strictEqual(repaired.requests.length, 1);
  repaired = mockFetch([completion('{"ok":NAME}'), completion('{"ok":NAME}')]);
  await rejectsCode(
    () => testDeepSeekApiKey({ ...repaired, apiKey }),
    "invalid-json",
    2,
    repaired
  );
  repaired = mockFetch([completion('{"ok":"true"}')]);
  await rejectsCode(
    () => testDeepSeekApiKey({ ...repaired, apiKey }),
    "unexpected-test-result",
    1,
    repaired
  );
  repaired = mockFetch([
    completion('{"L0001\u200b":"一","L0002":"二"}'),
    completion('{"L0001\u200b":"一","L0002":"二"}'),
  ]);
  await rejectsCode(
    () => translateWholeLyricWithDeepSeek({ ...repaired, apiKey, lyric }),
    "invalid-alignment",
    2,
    repaired
  );
  repaired = mockFetch([
    completion('{"ok":tr\u200bue}'),
    completion('{"ok":tr\u200bue}'),
  ]);
  const malformedToken = await rejectsCode(
    () => testDeepSeekApiKey({ ...repaired, apiKey }),
    "invalid-json",
    2,
    repaired
  );
  assert.strictEqual(malformedToken.status, 200);
  assert.strictEqual(
    malformedToken.diagnostics.httpStatus,
    undefined,
    "internal HTTP metadata stays out of public diagnostics"
  );
  assert.deepStrictEqual(
    sanitizeDeepSeekDiagnostics({ finishReason: "aborted" }),
    { finishReason: "aborted" }
  );
  assert.deepStrictEqual(
    sanitizeDeepSeekDiagnostics({ finishReason: "function_call" }),
    { finishReason: "function_call" }
  );
  let mock = mockFetch([completion('{"ok":true}')]);
  const success = await testDeepSeekApiKey({ ...mock, apiKey });
  assert.strictEqual(success.model, "deepseek-flash");
  assert.strictEqual(DEEPSEEK_MODEL, "deepseek-flash");
  assert.strictEqual(mock.requests[0].max_tokens, 256);
  assert.deepStrictEqual(mock.requests[0].thinking, { type: "disabled" });

  mock = mockFetch([completion(""), completion('{"ok":true}')]);
  await testDeepSeekApiKey({ ...mock, apiKey });
  assert.strictEqual(mock.requests.length, 2);

  mock = mockFetch([completion(" "), completion(null)]);
  let error = await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "empty-content",
    2,
    mock
  );
  assert.strictEqual(error.diagnostics.operation, "test");
  assert.strictEqual(error.diagnostics.stage, "content");
  assert.strictEqual(error.diagnostics.contentBytes, 0);

  mock = mockFetch([completion('{"ok":false,"reason":"SECRET"}')]);
  error = await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "unexpected-test-result",
    1,
    mock
  );
  assert.strictEqual(error.diagnostics.stage, "test-result");

  mock = mockFetch([
    () => ({
      ok: true,
      json: async () => {
        throw new Error("SECRET envelope");
      },
    }),
  ]);
  error = await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "invalid-response-json",
    1,
    mock
  );
  assert.strictEqual(error.diagnostics.stage, "response");
  assert.ok(!error.message.includes("SECRET"));

  mock = mockFetch([
    completion("SECRET invalid JSON"),
    completion('{"ok":true}'),
  ]);
  await testDeepSeekApiKey({ ...mock, apiKey });
  assert.strictEqual(mock.requests.length, 2);

  mock = mockFetch([
    completion("SECRET invalid JSON"),
    completion("still invalid"),
  ]);
  await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "invalid-json",
    2,
    mock
  );

  mock = mockFetch([
    completion('{"L0001":"第一行"}'),
    completion(translations),
  ]);
  const translated = await translateWholeLyricWithDeepSeek({
    ...mock,
    apiKey,
    lyric,
  });
  assert.strictEqual(translated.tlyric, "[00:01.00]第一行\n[00:02.00]第二行");
  assert.strictEqual(translated.lineCount, 2);
  assert.strictEqual(mock.requests.length, 2);
  assert.ok(
    mock.requests[0].max_tokens >= 2048 && mock.requests[0].max_tokens <= 32768
  );

  assert.strictEqual(DEEPSEEK_PROMPT_VERSION, "deepseek-lyrics-v3");
  const originalMessages = mock.requests[0].messages;
  const retryMessages = mock.requests[1].messages;
  assert.strictEqual(retryMessages.length, originalMessages.length + 1);
  assert.match(
    retryMessages[retryMessages.length - 1].content,
    /previous response failed validation \(invalid-alignment\)/
  );
  assert.ok(
    !retryMessages[retryMessages.length - 1].content.includes("第一行"),
    "retry must not echo prior model output"
  );
  assert.match(originalMessages[0].content, /exactly 2 top-level keys/);
  assert.ok(originalMessages[0].content.includes('["L0001","L0002"]'));
  const finalPromptLines = originalMessages[1].content.split("\n");
  const skeleton = JSON.parse(finalPromptLines[finalPromptLines.length - 2]);
  assert.deepStrictEqual(
    Object.keys(skeleton),
    ["L0001", "L0002"],
    "actual output skeleton must contain no example or metadata IDs"
  );
  assert.match(
    finalPromptLines[finalPromptLines.length - 1],
    /no markdown or extra keys/
  );

  mock = mockFetch([
    completion('{"L0001":"一","L0002":"二","type":"object"}'),
    completion(translations),
  ]);
  await translateWholeLyricWithDeepSeek({ ...mock, apiKey, lyric });
  assert.strictEqual(
    mock.requests.length,
    2,
    "extra schema metadata must trigger correction rather than acceptance"
  );
  assert.match(
    mock.requests[1].messages[2].content,
    /Do not output type, properties/
  );

  const placeholderResponse = completion(JSON.stringify(skeleton));
  mock = mockFetch([placeholderResponse, completion(translations)]);
  const correctedPlaceholder = await translateWholeLyricWithDeepSeek({
    ...mock,
    apiKey,
    lyric,
  });
  assert.strictEqual(
    correctedPlaceholder.tlyric,
    "[00:01.00]第一行\n[00:02.00]第二行"
  );
  assert.strictEqual(
    mock.requests.length,
    2,
    "literal skeleton placeholders must be rejected and retried"
  );
  mock = mockFetch([placeholderResponse, placeholderResponse]);
  await rejectsCode(
    () => translateWholeLyricWithDeepSeek({ ...mock, apiKey, lyric }),
    "invalid-alignment",
    2,
    mock
  );

  // Equal key count with an incorrect ID and duplicate IDs both remain fatal;
  // the caller never receives a partially aligned LRC after either response.
  mock = mockFetch([
    completion('{"L0001":"一","L0003":"三"}'),
    completion('{"L0001":"一","L0001":"二","L0002":"三"}'),
  ]);
  error = await rejectsCode(
    () => translateWholeLyricWithDeepSeek({ ...mock, apiKey, lyric }),
    "invalid-alignment",
    2,
    mock
  );
  assert.strictEqual(error.diagnostics.stage, "alignment");
  assert.strictEqual(error.diagnostics.expectedLineCount, 2);
  assert.strictEqual(error.diagnostics.receivedLineCount, 2);

  mock = mockFetch([{ choices: [] }]);
  await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "invalid-response",
    1,
    mock
  );

  mock = mockFetch([completion('{"L0001":', "length")]);
  error = await rejectsCode(
    () => translateWholeLyricWithDeepSeek({ ...mock, apiKey, lyric }),
    "unexpected-finish-reason",
    1,
    mock
  );
  assert.strictEqual(error.diagnostics.finishReason, "length");

  mock = mockFetch([
    {
      choices: [
        {
          finish_reason: "stop",
          message: { content: null, refusal: "SECRET" },
        },
      ],
    },
  ]);
  await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "refused",
    1,
    mock
  );

  mock = mockFetch([
    () => ({
      ok: false,
      status: 401,
      json: async () => {
        throw new Error("must not read error body");
      },
    }),
  ]);
  error = await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "invalid-api-key",
    1,
    mock
  );
  assert.strictEqual(error.status, 401);

  const abort = new Error("SECRET cancellation");
  abort.name = "AbortError";
  mock = mockFetch([abort]);
  await assert.rejects(() => testDeepSeekApiKey({ ...mock, apiKey }), {
    name: "AbortError",
  });
  assert.strictEqual(mock.requests.length, 1);

  const controller = new AbortController();
  mock = mockFetch([
    () => {
      controller.abort();
      return { ok: true, json: async () => completion("") };
    },
  ]);
  await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey, signal: controller.signal }),
    "empty-content",
    1,
    mock
  );

  let cancelled = false;
  mock = mockFetch([
    () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({
            done: false,
            value: Buffer.alloc(128 * 1024 + 1),
          }),
          cancel: async () => {
            cancelled = true;
          },
          releaseLock() {},
        }),
      },
    }),
  ]);
  await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "response-too-large",
    1,
    mock
  );
  assert.strictEqual(cancelled, true);

  mock = mockFetch([() => new Response("SECRET invalid outer JSON")]);
  await rejectsCode(
    () => testDeepSeekApiKey({ ...mock, apiKey }),
    "invalid-response-json",
    1,
    mock
  );
  mock = mockFetch([
    () => new Response(JSON.stringify(completion('{"ok":true}'))),
  ]);
  await testDeepSeekApiKey({ ...mock, apiKey });

  assert.deepStrictEqual(
    sanitizeDeepSeekDiagnostics({
      operation: "test",
      stage: "content",
      finishReason: "SECRET",
      contentBytes: 2 ** 30,
      expectedLineCount: 800,
      receivedLineCount: -1,
      attempts: 30,
      text: "SECRET",
      apiKey,
    }),
    {
      operation: "test",
      stage: "content",
      contentBytes: 131073,
      expectedLineCount: 400,
      attempts: 2,
    }
  );
  console.log("DeepSeek response reliability tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
