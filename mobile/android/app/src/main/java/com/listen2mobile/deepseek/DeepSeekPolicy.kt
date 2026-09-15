package com.listen2mobile.deepseek

import org.json.JSONArray
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
    const val MAX_REVISION = 9_007_199_254_740_991L
    const val ENDPOINT = "https://api.deepseek.com/chat/completions"
    const val MODEL = "deepseek-v4-flash"
    const val PROMPT_VERSION = "deepseek-lyrics-v2"
    const val RESPONSE_SCHEMA = "deepseek-lyrics-lines-v1"
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
        fun complete() = lyrics && title && artist && possibleCost && cancellation && failureImpact && acceptedAtEpochMs in 1..DeepSeekPolicy.MAX_REVISION
        companion object { fun explicit(epoch: Long) = Consent(true, true, true, true, true, true, epoch) }
    }

    data class Input(
        val lyric: String,
        val title: String,
        val artist: String,
        val style: String,
        val revision: Long,
        val consent: Consent,
    )

    data class TimedLine(val id: String, val timestamps: String, val text: String)
    data class Normalized(
        val lyric: String,
        val title: String,
        val artist: String,
        val style: String,
        val revision: Long,
        val lines: List<TimedLine>,
        val lyricHash: String,
        val promptFingerprint: String,
    )

    data class RequestSpec(
        val endpoint: String,
        val model: String,
        val promptVersion: String,
        val body: String,
        val headerNames: List<String>,
    )

    /** Validated projection; provider response text never leaves native code. */
    data class TranslationLine(val id: String, val timestamps: String, val text: String)
    data class ParsedTranslation(val revision: Long, val lines: List<TranslationLine>)

    fun normalize(input: Input?, requireConsent: Boolean = true): Outcome<Normalized> {
        if (input == null) return Outcome(errorCode = "INVALID_REQUEST")
        if (requireConsent && !input.consent.complete()) return Outcome(errorCode = "CONSENT_REQUIRED")
        if (input.revision !in 0..MAX_REVISION) return Outcome(errorCode = "INVALID_REVISION")
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
        return Outcome(
            Normalized(
                lyric,
                title,
                artist,
                style,
                input.revision,
                lines,
                lyricHash(lyric),
                sha256("$PROMPT_VERSION\n$RESPONSE_SCHEMA\n$TARGET_LANGUAGE\n$style"),
            ),
        )
    }

    fun translationRequest(input: Normalized): Outcome<RequestSpec> {
        val linePayload = input.lines.joinToString(",") {
            "{\"id\":\"${jsonEscape(it.id)}\",\"timestamp\":\"${jsonEscape(it.timestamps)}\",\"text\":\"${jsonEscape(it.text)}\"}"
        }
        val prompt = "Translate every timed lyric line to $TARGET_LANGUAGE. Return exact schema $RESPONSE_SCHEMA with revision ${input.revision}; preserve every supplied ID and timestamp, do not omit or summarize lines. title=${input.title}; artist=${input.artist}; style=${input.style}; lines=[$linePayload]"
        val body = JSONObject()
            .put("model", MODEL)
            .put("stream", false)
            .put("response_format", JSONObject().put("type", "json_object"))
            .put(
                "messages",
                JSONArray()
                    .put(JSONObject().put("role", "system").put("content", "$PROMPT_VERSION: return complete aligned JSON only."))
                    .put(JSONObject().put("role", "user").put("content", prompt)),
            )
            .toString()
        return if (bytes(body) > MAX_REQUEST_BYTES) Outcome(errorCode = "REQUEST_TOO_LARGE")
        else Outcome(RequestSpec(ENDPOINT, MODEL, PROMPT_VERSION, body, listOf("Authorization", "Content-Type", "Accept", "User-Agent")))
    }

    fun testRequest(): RequestSpec = RequestSpec(
        ENDPOINT,
        MODEL,
        PROMPT_VERSION,
        JSONObject()
            .put("model", MODEL)
            .put("stream", false)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "Return only {\\\"ok\\\":true}.")))
            .toString(),
        listOf("Authorization", "Content-Type", "Accept", "User-Agent"),
    )

    /**
     * Parse and validate the complete provider projection in native memory.
     * The response has no map shorthand: schema, revision, line count, IDs,
     * timestamps, order, and complete marker are all required.
     */
    fun parseLineMap(body: String?, input: Normalized): Outcome<ParsedTranslation> {
        if (body == null || bytes(body) > MAX_RESPONSE_BYTES) return Outcome(errorCode = "RESPONSE_TOO_LARGE")
        if (unsafe(body)) return Outcome(errorCode = "INVALID_ALIGNMENT")
        return try {
            val objectValue = JSONObject(body)
            if (exactKeys(objectValue, setOf("schema", "revision", "complete", "lines")).not()) return Outcome(errorCode = "INVALID_ALIGNMENT")
            if (objectValue.opt("schema") !is String || objectValue.optString("schema") != RESPONSE_SCHEMA) return Outcome(errorCode = "INVALID_ALIGNMENT")
            if (objectValue.opt("revision") !is Number || objectValue.optLong("revision", -1) != input.revision) return Outcome(errorCode = "STALE_REVISION")
            if (objectValue.opt("complete") !is Boolean || !objectValue.optBoolean("complete", false)) return Outcome(errorCode = "INVALID_ALIGNMENT")
            val rows = objectValue.optJSONArray("lines") ?: return Outcome(errorCode = "INVALID_ALIGNMENT")
            if (rows.length() != input.lines.size || rows.length() > MAX_TIMED_LINES) return Outcome(errorCode = "INVALID_ALIGNMENT")
            val translations = ArrayList<TranslationLine>(rows.length())
            input.lines.forEachIndexed { index, expected ->
                val row = rows.optJSONObject(index) ?: return Outcome(errorCode = "INVALID_ALIGNMENT")
                if (!exactKeys(row, setOf("id", "timestamp", "text"))) return@forEachIndexed
                if (row.opt("id") !is String || row.opt("timestamp") !is String || row.opt("text") !is String) return Outcome(errorCode = "INVALID_ALIGNMENT")
                val id = row.optString("id")
                val timestamps = row.optString("timestamp")
                val translated = row.optString("text").trim()
                if (
                    id != expected.id ||
                    timestamps != expected.timestamps ||
                    translated.isBlank() ||
                    translated.length > MAX_TRANSLATION_CHARS ||
                    bytes(translated) > MAX_TRANSLATION_CHARS * 4 ||
                    unsafe(translated) ||
                    translated.contains('\n') ||
                    translated.contains('\r') ||
                    isTruncated(translated)
                ) return Outcome(errorCode = "INVALID_ALIGNMENT")
                translations += TranslationLine(id, timestamps, translated)
            }
            if (translations.size != input.lines.size) return Outcome(errorCode = "INVALID_ALIGNMENT")
            Outcome(ParsedTranslation(input.revision, translations))
        } catch (_: Exception) {
            Outcome(errorCode = "INVALID_ALIGNMENT")
        }
    }

    fun lyricHash(normalizedTimedLrc: String) = sha256(Normalizer.normalize(normalizedTimedLrc.replace("\r\n", "\n").trim(), Normalizer.Form.NFC))
    fun trackHash(provider: String, sourceTrackId: String, lyricHash: String) = sha256("$provider\n$sourceTrackId\n$lyricHash")

    /** Native checks identity itself: JavaScript provenance is not authority. */
    fun isEligibleProvider(
        provider: String,
        sourceTrackId: String,
        matchedProvider: String? = null,
        matchedCandidateId: String? = null,
    ): Boolean = when (provider) {
        "netease" -> NETEASE_TRACK.matches(sourceTrackId) && matchedProvider == null && matchedCandidateId == null
        "qq" -> QQ_TRACK.matches(sourceTrackId) && matchedProvider == null && matchedCandidateId == null
        "bilibili" -> exactBilibiliTrack(sourceTrackId) &&
            (matchedProvider == "netease" && NETEASE_TRACK.matches(matchedCandidateId ?: "") ||
                matchedProvider == "qq" && QQ_TRACK.matches(matchedCandidateId ?: ""))
        else -> false
    }

    fun fixedHeaders(apiKey: String) = linkedMapOf(
        "Authorization" to "Bearer $apiKey",
        "Content-Type" to "application/json",
        "Accept" to "application/json",
        "User-Agent" to "Listen2Android/1",
    )

    private val TIMED_LINE = Regex("^((?:\\[[0-9]{1,3}:[0-5][0-9](?:\\.[0-9]{1,3})?\\])+)(.*)$")
    private val NETEASE_TRACK = Regex("^netrack_[1-9][0-9]{0,17}$")
    private val QQ_TRACK = Regex("^qqtrack_[A-Za-z0-9_-]{1,128}$")
    private val BILIBILI_TRACK = Regex("^bitrack_v_(BV[0-9A-Za-z]{6,32})-([1-9][0-9]{0,17})$")
    private const val MAX_JS_SAFE_INTEGER = 9_007_199_254_740_991L

    private fun exactBilibiliTrack(value: String): Boolean {
        val match = BILIBILI_TRACK.matchEntire(value) ?: return false
        val cid = match.groupValues[2].toLongOrNull() ?: return false
        return cid in 1..MAX_JS_SAFE_INTEGER && cid.toString() == match.groupValues[2]
    }

    private fun exactKeys(value: JSONObject, expected: Set<String>): Boolean {
        val keys = LinkedHashSet<String>()
        val iterator = value.keys()
        while (iterator.hasNext()) keys += iterator.next()
        return keys == expected
    }

    private fun metadata(value: String, max: Int): String? {
        val normalized = Normalizer.normalize(value, Normalizer.Form.NFC).trim()
        return if (normalized.length <= max && !unsafe(normalized)) normalized else null
    }

    private fun unsafe(value: String) = value.any { it.code in 0..8 || it.code in 11..12 || it.code in 14..31 || it.code == 127 }
    private fun bytes(value: String) = value.toByteArray(StandardCharsets.UTF_8).size
    private fun isTruncated(value: String) = value == "..." || value == "…" || value.endsWith("…") || value.endsWith("...")
    private fun jsonEscape(value: String): String = JSONObject.quote(value).removePrefix("\"").removeSuffix("\"")
    private fun sha256(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
