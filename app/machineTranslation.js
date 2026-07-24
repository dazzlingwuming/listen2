const DEEPL_FREE_ENDPOINT = "https://api-free.deepl.com";
const DEEPL_PRO_ENDPOINT = "https://api.deepl.com";
const MAX_DEEPL_REQUEST_BYTES = 128 * 1024;

class MachineTranslationError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "MachineTranslationError";
    this.code = code;
    this.status = status;
  }
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (match, code) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (match, code) =>
      String.fromCodePoint(parseInt(code, 10))
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
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
      return {
        timestamps: match[0],
        text,
      };
    })
    .filter(Boolean)
    .map((line, index) => ({
      ...line,
      id: index,
    }));
}

function buildWholeLyricDocument(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new MachineTranslationError(
      "no-timed-lines",
      "The lyric does not contain translatable timed lines."
    );
  }
  const content = lines
    .map((line) => `<line id="${line.id}">${escapeXml(line.text)}</line>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?><lyrics>\n${content}\n</lyrics>`;
}

function parseWholeLyricDocument(document, expectedLines) {
  const translations = new Map();
  const linePattern =
    /<line\b[^>]*\bid\s*=\s*(["'])(\d+)\1[^>]*>([\s\S]*?)<\/line>/gi;
  let match = linePattern.exec(String(document || ""));
  while (match) {
    const id = Number(match[2]);
    if (!Number.isInteger(id) || translations.has(id)) {
      throw new MachineTranslationError(
        "invalid-line-map",
        "The translation response contains duplicate or invalid line IDs."
      );
    }
    translations.set(id, decodeXml(match[3]).trim());
    match = linePattern.exec(String(document || ""));
  }

  if (translations.size !== expectedLines.length) {
    throw new MachineTranslationError(
      "line-count-mismatch",
      "The translation response does not match the source lyric line count."
    );
  }

  return expectedLines.map((line) => {
    if (!translations.has(line.id) || !translations.get(line.id)) {
      throw new MachineTranslationError(
        "missing-line",
        `The translation response is missing lyric line ${line.id}.`
      );
    }
    return {
      ...line,
      translatedText: translations.get(line.id),
    };
  });
}

function buildTranslatedLrc(lines) {
  return lines
    .map((line) => `${line.timestamps}${line.translatedText}`)
    .join("\n");
}

function mapDeepLTargetLanguage(language) {
  const normalized = String(language || "zh-CN")
    .trim()
    .toLowerCase();
  const targetLanguages = {
    "zh-cn": "ZH-HANS",
    "zh-hans": "ZH-HANS",
    zh: "ZH-HANS",
    "zh-tw": "ZH-HANT",
    "zh-hk": "ZH-HANT",
    "zh-hant": "ZH-HANT",
    "zh-tc": "ZH-HANT",
    "en-us": "EN-US",
    en: "EN-US",
    "en-gb": "EN-GB",
    fr: "FR",
    "fr-fr": "FR",
    ko: "KO",
    "ko-kr": "KO",
    pt: "PT-BR",
    "pt-br": "PT-BR",
    "pt-pt": "PT-PT",
  };
  return targetLanguages[normalized] || "ZH-HANS";
}

function getLanguageFamily(language) {
  return String(language || "")
    .toUpperCase()
    .split("-")[0];
}

function getDeepLEndpoint(apiKey) {
  return String(apiKey || "")
    .trim()
    .endsWith(":fx")
    ? DEEPL_FREE_ENDPOINT
    : DEEPL_PRO_ENDPOINT;
}

async function readErrorResponse(response) {
  try {
    const payload = await response.json();
    return payload && payload.message
      ? String(payload.message)
      : `DeepL request failed with status ${response.status}.`;
  } catch (error) {
    return `DeepL request failed with status ${response.status}.`;
  }
}

async function translateWholeLyricWithDeepL({
  fetchImpl,
  apiKey,
  lyric,
  targetLanguage,
  title,
  artist,
  signal,
}) {
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
      "A DeepL API key is required."
    );
  }

  const lines = extractTimedLyricLines(lyric);
  const document = buildWholeLyricDocument(lines);
  const targetLang = mapDeepLTargetLanguage(targetLanguage);
  const contextParts = [
    "This is one complete song lyric. Translate it coherently as a whole, preserving repeated motifs, pronouns, tone, and imagery.",
  ];
  if (title) {
    contextParts.push(`Song title: ${String(title).trim()}.`);
  }
  if (artist) {
    contextParts.push(`Artist: ${String(artist).trim()}.`);
  }
  const body = {
    text: [document],
    target_lang: targetLang,
    context: contextParts.join(" "),
    tag_handling: "xml",
    tag_handling_version: "v2",
    outline_detection: false,
    non_splitting_tags: ["line"],
    split_sentences: "nonewlines",
    preserve_formatting: true,
    show_billed_characters: true,
  };
  const serializedBody = JSON.stringify(body);
  if (Buffer.byteLength(serializedBody, "utf8") > MAX_DEEPL_REQUEST_BYTES) {
    throw new MachineTranslationError(
      "lyric-too-large",
      "The complete lyric exceeds DeepL's request size limit."
    );
  }

  const response = await fetchImpl(
    `${getDeepLEndpoint(normalizedApiKey)}/v2/translate`,
    {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${normalizedApiKey}`,
        "Content-Type": "application/json",
      },
      body: serializedBody,
      signal,
    }
  );
  if (!response.ok) {
    const message = await readErrorResponse(response);
    const code =
      response.status === 403
        ? "invalid-api-key"
        : response.status === 429
        ? "rate-limited"
        : response.status === 456
        ? "quota-exceeded"
        : "request-failed";
    throw new MachineTranslationError(code, message, response.status);
  }

  const payload = await response.json();
  const translation =
    payload && Array.isArray(payload.translations) && payload.translations[0];
  if (!translation || typeof translation.text !== "string") {
    throw new MachineTranslationError(
      "invalid-response",
      "DeepL returned an invalid translation response."
    );
  }

  const detectedSourceLanguage = String(
    translation.detected_source_language || ""
  ).toUpperCase();
  if (
    detectedSourceLanguage &&
    getLanguageFamily(detectedSourceLanguage) === getLanguageFamily(targetLang)
  ) {
    return {
      tlyric: "",
      provider: "DeepL",
      targetLanguage: targetLang,
      detectedSourceLanguage,
      sameLanguage: true,
      billedCharacters: Number(translation.billed_characters || 0),
      lineCount: lines.length,
    };
  }

  const translatedLines = parseWholeLyricDocument(translation.text, lines);
  return {
    tlyric: buildTranslatedLrc(translatedLines),
    provider: "DeepL",
    targetLanguage: targetLang,
    detectedSourceLanguage,
    sameLanguage: false,
    billedCharacters: Number(translation.billed_characters || 0),
    lineCount: translatedLines.length,
  };
}

async function testDeepLApiKey({ fetchImpl, apiKey, signal }) {
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new MachineTranslationError(
      "missing-api-key",
      "A DeepL API key is required."
    );
  }
  const response = await fetchImpl(
    `${getDeepLEndpoint(normalizedApiKey)}/v2/usage`,
    {
      method: "GET",
      headers: {
        Authorization: `DeepL-Auth-Key ${normalizedApiKey}`,
      },
      signal,
    }
  );
  if (!response.ok) {
    const message = await readErrorResponse(response);
    throw new MachineTranslationError(
      response.status === 403 ? "invalid-api-key" : "request-failed",
      message,
      response.status
    );
  }
  const payload = await response.json();
  return {
    characterCount: Number(payload.character_count || 0),
    characterLimit: Number(payload.character_limit || 0),
  };
}

module.exports = {
  MachineTranslationError,
  buildTranslatedLrc,
  buildWholeLyricDocument,
  extractTimedLyricLines,
  getDeepLEndpoint,
  mapDeepLTargetLanguage,
  parseWholeLyricDocument,
  testDeepLApiKey,
  translateWholeLyricWithDeepL,
};
