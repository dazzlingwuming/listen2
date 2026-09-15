package com.listen2mobile.deepseek

import android.content.Context
import java.io.File
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native no-backup cache containing only validated translation projections.
 * Provider request/response material and credentials are never serialized.
 */
class DeepSeekTranslationCache private constructor(
    private val root: File?,
    private val memory: MutableMap<String, Entry>?,
) {
    data class Entry(
        val trackHash: String,
        val lyricHash: String,
        val revision: Long,
        val lines: List<DeepSeekPolicy.TranslationLine>,
        val title: String = "",
        val artist: String = "",
        val model: String = DeepSeekPolicy.MODEL,
        val promptVersion: String = DeepSeekPolicy.PROMPT_VERSION,
        val promptFingerprint: String = "",
        val target: String = DeepSeekPolicy.TARGET_LANGUAGE,
    ) {
        /** Safe display projection generated only from already validated lines. */
        val translation: String
            get() = lines.joinToString("\n") { "${it.timestamps}${it.text}" }
    }

    /** Test-only memory cache; no Android storage or backup path is involved. */
    class InMemoryStore {
        internal val entries = linkedMapOf<String, Entry>()

        fun put(entry: Entry): Boolean {
            if (!valid(entry, entry.trackHash, entry.lyricHash, entry.revision, entry.title, entry.artist, entry.promptFingerprint)) return false
            entries[entry.trackHash] = entry
            return true
        }

        fun get(
            trackHash: String,
            lyricHash: String,
            revision: Long = 0,
            title: String = "",
            artist: String = "",
            promptFingerprint: String = "",
        ): Entry? = entries[trackHash]?.takeIf {
            valid(it, trackHash, lyricHash, revision, title, artist, promptFingerprint)
        }

        fun size(): Int = entries.size
    }

    constructor(context: Context) : this(
        File(context.noBackupFilesDir, "deepseek-translation-v2").also { it.mkdirs() },
        null,
    )

    fun get(
        trackHash: String,
        lyricHash: String,
        revision: Long,
        title: String,
        artist: String,
        promptFingerprint: String,
    ): Entry? {
        memory?.get(trackHash)?.let {
            return it.takeIf { entry -> valid(entry, trackHash, lyricHash, revision, title, artist, promptFingerprint) }
        }
        val file = root?.resolve("$trackHash.json") ?: return null
        return try {
            val entry = decode(JSONObject(file.readText(StandardCharsets.UTF_8)))
            entry.takeIf {
                valid(it, trackHash, lyricHash, revision, title, artist, promptFingerprint)
            } ?: run {
                file.delete()
                null
            }
        } catch (_: Exception) {
            file.delete()
            null
        }
    }

    fun put(entry: Entry): Boolean {
        if (!valid(entry, entry.trackHash, entry.lyricHash, entry.revision, entry.title, entry.artist, entry.promptFingerprint)) return false
        memory?.let {
            if (it.size >= MAX_ENTRIES && !it.containsKey(entry.trackHash)) it.keys.firstOrNull()?.let(it::remove)
            it[entry.trackHash] = entry
            return true
        }
        val destination = root?.resolve("${entry.trackHash}.json") ?: return false
        return try {
            val temporary = File(destination.parentFile, ".${entry.trackHash}.tmp")
            temporary.outputStream().use { output ->
                output.write(encode(entry).toString().toByteArray(StandardCharsets.UTF_8))
                output.fd.sync()
            }
            if (!temporary.renameTo(destination)) {
                temporary.delete()
                false
            } else {
                evict()
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    /** Clear is called with key removal to avoid retaining translation data. */
    fun clear(): Boolean {
        memory?.clear()
        val files = root?.listFiles() ?: return true
        var success = true
        files.filter { it.name.endsWith(".json") || it.name.endsWith(".tmp") }.forEach {
            if (it.exists() && !it.delete()) success = false
        }
        return success
    }

    private fun decode(json: JSONObject): Entry {
        require(json.optInt("version", -1) == VERSION)
        val keys = linkedSetOf<String>()
        val iterator = json.keys()
        while (iterator.hasNext()) keys += iterator.next()
        require(keys == ENTRY_KEYS)
        val rows = json.getJSONArray("lines")
        val lines = ArrayList<DeepSeekPolicy.TranslationLine>(rows.length())
        for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index)
            val rowKeys = linkedSetOf<String>()
            val rowIterator = row.keys()
            while (rowIterator.hasNext()) rowKeys += rowIterator.next()
            require(rowKeys == LINE_KEYS)
            lines += DeepSeekPolicy.TranslationLine(
                row.getString("id"),
                row.getString("timestamp"),
                row.getString("text"),
            )
        }
        return Entry(
            json.getString("trackHash"),
            json.getString("lyricHash"),
            json.getLong("revision"),
            lines,
            json.getString("title"),
            json.getString("artist"),
            json.getString("model"),
            json.getString("promptVersion"),
            json.getString("promptFingerprint"),
            json.getString("target"),
        )
    }

    private fun encode(entry: Entry) = JSONObject()
        .put("version", VERSION)
        .put("trackHash", entry.trackHash)
        .put("lyricHash", entry.lyricHash)
        .put("revision", entry.revision)
        .put("lines", JSONArray().apply {
            entry.lines.forEach { line ->
                put(JSONObject().put("id", line.id).put("timestamp", line.timestamps).put("text", line.text))
            }
        })
        .put("title", entry.title)
        .put("artist", entry.artist)
        .put("model", entry.model)
        .put("promptVersion", entry.promptVersion)
        .put("promptFingerprint", entry.promptFingerprint)
        .put("target", entry.target)

    private fun evict() {
        val files = root?.listFiles { file -> file.name.endsWith(".json") }
            ?.sortedWith(compareBy<File> { it.lastModified() }.thenBy { it.name })
            ?: return
        var total = files.sumOf { it.length() }
        var count = files.size
        for (file in files) {
            if (count <= MAX_ENTRIES && total <= MAX_BYTES) break
            total -= file.length()
            count -= 1
            file.delete()
        }
    }

    companion object {
        private const val VERSION = 2
        private const val MAX_ENTRIES = 64
        private const val MAX_BYTES = 2 * 1024 * 1024
        private val ENTRY_KEYS = linkedSetOf(
            "version",
            "trackHash",
            "lyricHash",
            "revision",
            "lines",
            "title",
            "artist",
            "model",
            "promptVersion",
            "promptFingerprint",
            "target",
        )
        private val LINE_KEYS = linkedSetOf("id", "timestamp", "text")
        private val HASH = Regex("[a-f0-9]{64}")
        private val ID = Regex("E[0-9]{4}")
        private val TIMESTAMP = Regex("(?:\\[[0-9]{1,3}:[0-5][0-9](?:\\.[0-9]{1,3})?\\])+")

        internal fun forTesting(store: InMemoryStore): DeepSeekTranslationCache =
            DeepSeekTranslationCache(null, store.entries)

        private fun valid(
            entry: Entry,
            trackHash: String,
            lyricHash: String,
            revision: Long,
            title: String,
            artist: String,
            promptFingerprint: String,
        ): Boolean {
            if (
                entry.trackHash != trackHash ||
                entry.lyricHash != lyricHash ||
                entry.revision != revision ||
                entry.title != title ||
                entry.artist != artist ||
                entry.model != DeepSeekPolicy.MODEL ||
                entry.promptVersion != DeepSeekPolicy.PROMPT_VERSION ||
                entry.promptFingerprint != promptFingerprint ||
                entry.target != DeepSeekPolicy.TARGET_LANGUAGE ||
                !HASH.matches(entry.trackHash) ||
                !HASH.matches(entry.lyricHash) ||
                entry.revision !in 0..DeepSeekPolicy.MAX_REVISION ||
                entry.title.length > DeepSeekPolicy.MAX_METADATA_CHARS ||
                entry.artist.length > DeepSeekPolicy.MAX_METADATA_CHARS ||
                entry.lines.isEmpty() ||
                entry.lines.size > DeepSeekPolicy.MAX_TIMED_LINES
            ) return false
            var total = 0
            entry.lines.forEachIndexed { index, line ->
                if (
                    line.id != "E${(index + 1).toString().padStart(4, '0')}" ||
                    !ID.matches(line.id) ||
                    !TIMESTAMP.matches(line.timestamps) ||
                    line.text.isBlank() ||
                    line.text.length > DeepSeekPolicy.MAX_TRANSLATION_CHARS ||
                    line.text.contains('\n') ||
                    line.text.contains('\r') ||
                    line.text.any { it.code < 32 || it.code == 127 }
                ) return false
                total += line.text.toByteArray(StandardCharsets.UTF_8).size + line.timestamps.toByteArray(StandardCharsets.UTF_8).size
            }
            return total <= MAX_BYTES
        }
    }
}
