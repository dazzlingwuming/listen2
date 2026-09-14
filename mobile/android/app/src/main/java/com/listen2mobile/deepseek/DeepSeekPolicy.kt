package com.listen2mobile.deepseek

import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.text.Normalizer

/** Fixed, transport-free policy. React Native callers cannot control endpoint, prompt, or headers. */
object DeepSeekPolicy {
    const val MAX_TIMED_LINES = 400
    const val MAX_LYRIC_BYTES = 64 * 1024
    const val MAX_LINE_CHARS = 500
    const val MAX_METADATA_CHARS = 256
    const val MAX_STYLE_CHARS = 1_200
    const val MAX_REQUEST_BYTES = 256 * 1024
    const val MAX_RESPONSE_BYTES = 128 * 1024
    const val MAX_TRANSLATION_CHARS = 1_024
    const val ENDPOINT = "https://api.deepseek.com/chat/completions"
    const val MODEL = "deepseek-v4-flash"
    const val PROMPT_VERSION = "deepseek-lyrics-v2"
    const val TARGET_LANGUAGE = "zh-CN"

    data class Outcome<T>(val value: T? = null, val errorCode: String? = null) {
        val isSuccess get() = value != null && errorCode == null
    }
    data class Consent(
        val lyrics: Boolean,
        val title: Boolean,
        val artist: Boolean,
        val possibleCost: Boolean,
        val cancellation: Boolean,
        val failureImpact: Boolean,
        val acceptedAtEpochMs: Long,
    ) {
        fun complete() = lyrics && title && artist && possibleCost && cancellation && failureImpact && acceptedAtEpochMs > 0
        companion object { fun explicit(epoch: Long) = Consent(true, true, true, true, true, true, epoch) }
    }
    data class Input(val lyric: String, val title: String, val artist: String, val style: String, val consent: Consent)
    data class TimedLine(val id: String, val timestamps: String, val text: String)
    data class Normalized(val lyric: String, val title: String, val artist: String, val style: String, val lines: List<TimedLine>, val lyricHash: String, val promptFingerprint: String)
    data class RequestSpec(val endpoint: String, val model: String, val promptVersion: String, val body: String, val headerNames: List<String>)
    data class ParsedTranslation(val translation: String, val lineMap: Map<String, String>)

    fun normalize(input: Input?): Outcome<Normalized> {
        if (input == null) return Outcome(errorCode = "INVALID_REQUEST")
        if (!input.consent.complete()) return Outcome(errorCode = "CONSENT_REQUIRED")
        val lyric = Normalizer.normalize(input.lyric, Normalizer.Form.NFC).replace("\r\n", "\n").trim()
        if (bytes(lyric) > MAX_LYRIC_BYTES) return Outcome(errorCode = "LYRIC_TOO_LARGE")
        val title = metadata(input.title, MAX_METADATA_CHARS) ?: return Outcome(errorCode = "INVALID_REQUEST")
        val artist = metadata(input.artist, MAX_METADATA_CHARS) ?: return Outcome(errorCode = "INVALID_REQUEST")
        val style = metadata(input.style, MAX_STYLE_CHARS) ?: return Outcome(errorCode = "INVALID_REQUEST")
        val lines = ArrayList<TimedLine>()
        lyric.split('\n').forEach { raw ->
            val match = TIMED_LINE.matchEntire(raw) ?: return@forEach
            val text = match.groupValues[2].trim()
            if (text.isEmpty() || text.length > MAX_LINE_CHARS || unsafe(text)) return Outcome(errorCode = "INVALID_REQUEST")
            if (lines.size == MAX_TIMED_LINES) return Outcome(errorCode = "TOO_MANY_TIMED_LINES")
            lines += TimedLine("E${(lines.size + 1).toString().padStart(4, '0')}", match.groupValues[1], text)
        }
        if (lines.isEmpty()) return Outcome(errorCode = "NO_TIMED_LINES")
        return Outcome(Normalized(lyric, title, artist, style, lines, lyricHash(lyric), sha256("$PROMPT_VERSION\n$TARGET_LANGUAGE\n$style")))
    }

    fun translationRequest(input: Normalized): Outcome<RequestSpec> {
        val prompt = "Translate timed lyric lines to $TARGET_LANGUAGE. Return one JSON object with exact ordered IDs only. title=${input.title}; artist=${input.artist}; style=${input.style}; lines=" + input.lines.joinToString("|") { "${it.id}:${it.text}" }
        val body = JSONObject().put("model", MODEL).put("stream", false).put("response_format", JSONObject().put("type", "json_object")).put("messages", org.json.JSONArray().put(JSONObject().put("role", "system").put("content", "${PROMPT_VERSION}: preserve every supplied line ID." )).put(JSONObject().put("role", "user").put("content", prompt))).toString()
        return if (bytes(body) > MAX_REQUEST_BYTES) Outcome(errorCode = "REQUEST_TOO_LARGE") else Outcome(RequestSpec(ENDPOINT, MODEL, PROMPT_VERSION, body, listOf("Authorization", "Content-Type", "Accept", "User-Agent")))
    }

    fun testRequest(): RequestSpec = RequestSpec(ENDPOINT, MODEL, PROMPT_VERSION, JSONObject().put("model", MODEL).put("stream", false).put("messages", org.json.JSONArray().put(JSONObject().put("role", "user").put("content", "Return only {\\\"ok\\\":true}."))).toString(), listOf("Authorization", "Content-Type", "Accept", "User-Agent"))

    fun parseLineMap(body: String?, input: Normalized): Outcome<ParsedTranslation> {
        if (body == null || bytes(body) > MAX_RESPONSE_BYTES) return Outcome(errorCode = "RESPONSE_TOO_LARGE")
        if (unsafe(body)) return Outcome(errorCode = "INVALID_ALIGNMENT")
        val keys = KEY.matcher(body).let { matcher -> buildList { while (matcher.find()) add(matcher.group(1)) } }
        if (keys != input.lines.map { it.id } || keys.toSet().size != keys.size) return Outcome(errorCode = "INVALID_ALIGNMENT")
        return try {
            val objectValue = JSONObject(body)
            val translations = LinkedHashMap<String, String>()
            var emojis = 0
            input.lines.forEach { line ->
                val translated = objectValue.optString(line.id, "").trim()
                if (translated.isBlank() || translated.length > MAX_TRANSLATION_CHARS || unsafe(translated) || translated.contains('\n') || translated.contains('\r')) return Outcome(errorCode = "INVALID_ALIGNMENT")
                emojis += translated.codePoints().filter { code -> code >= 0x1F300 }.count().toInt()
                translations[line.id] = translated
            }
            if (emojis > 1) Outcome(errorCode = "INVALID_ALIGNMENT") else Outcome(ParsedTranslation(input.lines.joinToString("\n") { "${it.timestamps}${translations[it.id]}" }, translations))
        } catch (_: Exception) { Outcome(errorCode = "INVALID_ALIGNMENT") }
    }

    fun lyricHash(normalizedTimedLrc: String) = sha256(Normalizer.normalize(normalizedTimedLrc.replace("\r\n", "\n").trim(), Normalizer.Form.NFC))
    fun trackHash(provider: String, sourceTrackId: String, lyricHash: String) = sha256("$provider\n$sourceTrackId\n$lyricHash")
    fun isEligibleProvider(provider: String) = provider == "netease" || provider == "qq"
    fun fixedHeaders(apiKey: String) = linkedMapOf("Authorization" to "Bearer $apiKey", "Content-Type" to "application/json", "Accept" to "application/json", "User-Agent" to "Listen2Android/1")

    private val TIMED_LINE = Regex("^((?:\\[[0-9]{1,3}:[0-5][0-9](?:\\.[0-9]{1,3})?\\])+)(.*)$")
    private val KEY = Regex("\\\"(E[0-9]{4})\\\"\\s*:")
    private fun metadata(value: String, max: Int): String? { val normalized = Normalizer.normalize(value, Normalizer.Form.NFC).trim(); return if (normalized.length <= max && !unsafe(normalized)) normalized else null }
    private fun unsafe(value: String) = value.any { it.code in 0..8 || it.code in 11..12 || it.code in 14..31 || it.code == 127 }
    private fun bytes(value: String) = value.toByteArray(StandardCharsets.UTF_8).size
    private fun sha256(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
