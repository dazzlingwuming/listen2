const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_PROVIDER = "deepseek";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEEPSEEK_PROMPT_VERSION = "deepseek-lyrics-v1";

class MachineTranslationError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "MachineTranslationError";
    this.code = code;
    this.status = status;
  }
}

function extractTimedLyricLines(lyric) {
  const timestampPrefix = /^(?:(?:\[\d{2,}:\d{2}(?:\.\d{1,3})?\]))+/;
  return String(lyric || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = timestampPrefix.exec(line);
      if (!match) {
        return null;
      }
      const text = line.slice(match[0].length).trim();
      if (!text) {
        return null;
      }
      return { timestamps: match[0], text };
    })
    .filter(Boolean)
    .map((line, index) => ({
      ...line,
      id: `L${String(index + 1).padStart(4, "0")}`,
    }));
}

function normalizeTargetLanguage(language) {
  const normalized = String(language || "zh-CN").trim().toLowerCase();
  if (!normalized || normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") {
    return "zh-CN";
  }
  return String(language).trim();
}

function targetLanguageInstruction(targetLanguage) {
  return normalizeTargetLanguage(targetLanguage) === "zh-CN"
    ? "简体中文（zh-CN）"
    : normalizeTargetLanguage(targetLanguage);
}

function buildDeepSeekLyricPrompt({ lines, targetLanguage, title, artist }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new MachineTranslationError(
      "no-timed-lines",
      "The lyric does not contain translatable timed lines."
    );
  }

  return [
    "You are an expert lyric translator.",
    `Translate this complete song into ${targetLanguageInstruction(targetLanguage)}.`,
    "Write elegant, natural lyrics while remaining faithful to the original meaning.",
    "Preserve imagery, emotional tone, voice, and repeated phrases.",
    "Never merge, split, reorder, omit, or add lyric lines.",
    "Return only one JSON object. Its keys must be exactly the supplied line IDs, and every value must be a non-empty translated string. Do not include markdown or any extra keys.",
    `Song title: ${String(title || "").trim() || "(unknown)"}`,
    `Artist: ${String(artist || "").trim() || "(unknown)"}`,
    "Lyrics (each object key is a fixed line ID):",
    JSON.stringify(
      Object.fromEntries(lines.map((line) => [line.id, line.text]))
    ),
  ].join("\n");
}

function buildTranslatedLrc(lines) {
  return lines
    .map((line) => `${line.timestamps}${line.translatedText}`)
    .join("\n");
}

function readJsonStringEnd(value, start) {
  let index = start + 1;
  while (index < value.length) {
    if (value[index] === "\\") {
      index += 2;
    } else if (value[index] === '"') {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return -1;
}

function parseTopLevelJsonObjectKeys(content) {
  const value = String(content || "");
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(value[index] || "")) {
      index += 1;
    }
  };
  const keys = [];
  skipWhitespace();
  if (value[index] !== "{") {
    return keys;
  }
  index += 1;
  skipWhitespace();
  if (value[index] === "}") {
    return keys;
  }

  while (index < value.length) {
    if (value[index] !== '"') {
      return keys;
    }
    const keyEnd = readJsonStringEnd(value, index);
    if (keyEnd < 0) {
      return keys;
    }
    keys.push(JSON.parse(value.slice(index, keyEnd)));
    index = keyEnd;
    skipWhitespace();
    if (value[index] !== ":") {
      return keys;
    }
    index += 1;
    skipWhitespace();

    let nesting = 0;
    while (index < value.length) {
      if (value[index] === '"') {
        index = readJsonStringEnd(value, index);
        if (index < 0) {
          return keys;
        }
        continue;
      }
      if (value[index] === "{" || value[index] === "[") {
        nesting += 1;
      } else if (value[index] === "}" || value[index] === "]") {
        if (nesting === 0) {
          break;
        }
        nesting -= 1;
      } else if (value[index] === "," && nesting === 0) {
        break;
      }
      index += 1;
    }
    skipWhitespace();
    if (value[index] === ",") {
      index += 1;
      skipWhitespace();
      continue;
    }
    return keys;
  }
  return keys;
}

function parseDeepSeekLineMap(content, expectedLines) {
  let translations;
  try {
    translations = JSON.parse(String(content || ""));
  } catch (error) {
    throw new MachineTranslationError(
      "invalid-json",
      "DeepSeek returned invalid JSON."
    );
  }

  if (
    !translations ||
    Array.isArray(translations) ||
    Object.getPrototypeOf(translations) !== Object.prototype
  ) {
    throw new MachineTranslationError(
      "invalid-alignment",
      "DeepSeek returned an invalid lyric line map."
    );
  }

  const expectedIds = expectedLines.map((line) => line.id);
  const receivedIds = Object.keys(translations);
  const rawIds = parseTopLevelJsonObjectKeys(content);
  if (
    receivedIds.length !== expectedIds.length ||
    receivedIds.some((id) => !expectedIds.includes(id)) ||
    rawIds.length !== expectedIds.length ||
    new Set(rawIds).size !== rawIds.length
  ) {
    throw new MachineTranslationError(
      "invalid-alignment",
      "DeepSeek returned lyric IDs that do not exactly match the source."
    );
  }

  return expectedLines.map((line) => {
    const translation = translations[line.id];
    if (typeof translation !== "string" || !translation.trim()) {
      throw new MachineTranslationError(
        "invalid-alignment",
        "DeepSeek returned an empty or invalid lyric translation line."
      );
    }
    return { ...line, translatedText: translation.trim() };
  });
}

function deepSeekErrorCode(status) {
  return {
    400: "bad-request",
    401: "invalid-api-key",
    402: "quota-exceeded",
    422: "invalid-request",
    429: "rate-limited",
    500: "server-error",
    503: "service-unavailable",
  }[status] || "request-failed";
}

async function readErrorResponse(response) {
  try {
    const payload = await response.json();
    return String(
      (payload && payload.error && payload.error.message) ||
        (payload && payload.message) ||
        `DeepSeek request failed with status ${response.status}.`
    );
  } catch (error) {
    return `DeepSeek request failed with status ${response.status}.`;
  }
}

async function requestDeepSeek({ fetchImpl, apiKey, body, signal }) {
  if (typeof fetchImpl !== "function") {
    throw new MachineTranslationError(
      "fetch-unavailable",
      "No network implementation is available."
    );
  }
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new MachineTranslationError(
      "missing-api-key",
      "A DeepSeek API key is required."
    );
  }

  const response = await fetchImpl(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${normalizedApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response || !response.ok) {
    const status = Number((response && response.status) || 0);
    throw new MachineTranslationError(
      deepSeekErrorCode(status),
      response ? await readErrorResponse(response) : "DeepSeek request failed.",
      status
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new MachineTranslationError(
      "invalid-json",
      "DeepSeek returned invalid JSON."
    );
  }
}

function getDeepSeekMessageContent(payload) {
  if (!payload || !Array.isArray(payload.choices) || payload.choices.length !== 1) {
    throw new MachineTranslationError(
      "invalid-response",
      "DeepSeek returned an invalid response."
    );
  }
  const choice = payload.choices[0];
  if (!choice || choice.finish_reason !== "stop") {
    throw new MachineTranslationError(
      "unexpected-finish-reason",
      "DeepSeek did not finish the translation normally."
    );
  }
  if (!choice.message || typeof choice.message.content !== "string") {
    throw new MachineTranslationError(
      "invalid-response",
      "DeepSeek returned no translation content."
    );
  }
  return choice.message.content;
}

function usageFromPayload(payload) {
  const usage = (payload && payload.usage) || {};
  return {
    promptTokens: Number(usage.prompt_tokens || 0),
    completionTokens: Number(usage.completion_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
  };
}

async function translateWholeLyricWithDeepSeek({
  fetchImpl,
  apiKey,
  lyric,
  targetLanguage,
  title,
  artist,
  signal,
}) {
  const lines = extractTimedLyricLines(lyric);
  const normalizedTargetLanguage = normalizeTargetLanguage(targetLanguage);
  const payload = await requestDeepSeek({
    fetchImpl,
    apiKey,
    signal,
    body: {
      model: DEEPSEEK_MODEL,
      thinking: { type: "disabled" },
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Follow the requested lyric translation format exactly.",
        },
        {
          role: "user",
          content: buildDeepSeekLyricPrompt({
            lines,
            targetLanguage: normalizedTargetLanguage,
            title,
            artist,
          }),
        },
      ],
    },
  });
  const translatedLines = parseDeepSeekLineMap(
    getDeepSeekMessageContent(payload),
    lines
  );
  return {
    tlyric: buildTranslatedLrc(translatedLines),
    provider: DEEPSEEK_PROVIDER,
    model: DEEPSEEK_MODEL,
    promptVersion: DEEPSEEK_PROMPT_VERSION,
    targetLanguage: normalizedTargetLanguage,
    lineCount: translatedLines.length,
    ...usageFromPayload(payload),
  };
}

async function testDeepSeekApiKey({ fetchImpl, apiKey, signal }) {
  const payload = await requestDeepSeek({
    fetchImpl,
    apiKey,
    signal,
    body: {
      model: DEEPSEEK_MODEL,
      thinking: { type: "disabled" },
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: 'Return only this JSON object: {"ok":true}',
        },
      ],
    },
  });
  const content = getDeepSeekMessageContent(payload);
  try {
    const result = JSON.parse(content);
    if (!result || result.ok !== true) {
      throw new Error("Unexpected test response.");
    }
  } catch (error) {
    throw new MachineTranslationError(
      "invalid-json",
      "DeepSeek returned invalid JSON for the test request."
    );
  }
  return {
    provider: DEEPSEEK_PROVIDER,
    model: DEEPSEEK_MODEL,
    usage: usageFromPayload(payload),
  };
}

module.exports = {
  DEEPSEEK_ENDPOINT,
  DEEPSEEK_MODEL,
  DEEPSEEK_PROMPT_VERSION,
  DEEPSEEK_PROVIDER,
  MachineTranslationError,
  buildDeepSeekLyricPrompt,
  buildTranslatedLrc,
  deepSeekErrorCode,
  extractTimedLyricLines,
  normalizeTargetLanguage,
  parseDeepSeekLineMap,
  parseTopLevelJsonObjectKeys,
  testDeepSeekApiKey,
  translateWholeLyricWithDeepSeek,
};
