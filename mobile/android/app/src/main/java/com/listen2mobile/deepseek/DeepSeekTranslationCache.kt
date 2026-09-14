package com.listen2mobile.deepseek

import android.content.Context
import java.io.File
import org.json.JSONObject

/** App-private, track-hash-bound cache. It contains no credential and is never an RN persistence store. */
class DeepSeekTranslationCache private constructor(private val root: File?, private val memory: MutableMap<String, Entry>?) {
    data class Entry(val trackHash: String, val lyricHash: String, val translation: String, val title: String = "", val artist: String = "", val model: String = DeepSeekPolicy.MODEL, val promptVersion: String = DeepSeekPolicy.PROMPT_VERSION, val promptFingerprint: String = "", val target: String = DeepSeekPolicy.TARGET_LANGUAGE)
    class InMemoryStore { private val entries = linkedMapOf<String, Entry>(); fun put(entry: Entry) { entries[entry.trackHash] = entry }; fun get(trackHash: String, lyricHash: String, title: String = "", artist: String = "", promptFingerprint: String = "") = entries[trackHash]?.takeIf { valid(it, trackHash, lyricHash, title, artist, promptFingerprint) } }
    constructor(context: Context) : this(File(context.filesDir, "lyric-cache-v1").also { it.mkdirs() }, null)
    fun get(trackHash: String, lyricHash: String, title: String, artist: String, promptFingerprint: String): Entry? {
        memory?.get(trackHash)?.let { return it.takeIf { entry -> valid(entry, trackHash, lyricHash, title, artist, promptFingerprint) } }
        val file = root?.resolve("$trackHash.json") ?: return null
        return try { val json = JSONObject(file.readText()); val entry = Entry(json.optString("trackHash"), json.optString("lyricHash"), json.optString("translation"), json.optString("title"), json.optString("artist"), json.optString("model"), json.optString("promptVersion"), json.optString("promptFingerprint"), json.optString("target")); entry.takeIf { json.optInt("version", -1) == VERSION && valid(it, trackHash, lyricHash, title, artist, promptFingerprint) } ?: run { file.delete(); null } } catch (_: Exception) { file.delete(); null }
    }
    fun put(entry: Entry): Boolean {
        if (!valid(entry, entry.trackHash, entry.lyricHash, entry.title, entry.artist, entry.promptFingerprint)) return false
        memory?.let { it[entry.trackHash] = entry; return true }
        val destination = root?.resolve("${entry.trackHash}.json") ?: return false
        return try { val temporary = File(destination.parentFile, ".${entry.trackHash}.tmp"); temporary.outputStream().use { output -> output.write(JSONObject().put("version", VERSION).put("trackHash", entry.trackHash).put("lyricHash", entry.lyricHash).put("translation", entry.translation).put("title", entry.title).put("artist", entry.artist).put("model", entry.model).put("promptVersion", entry.promptVersion).put("promptFingerprint", entry.promptFingerprint).put("target", entry.target).toString().toByteArray()); output.fd.sync() }; if (!temporary.renameTo(destination)) { temporary.delete(); false } else { evict(); true } } catch (_: Exception) { false }
    }
    private fun evict() { val files = root?.listFiles { file -> file.name.endsWith(".json") }?.sortedWith(compareBy<File> { it.lastModified() }.thenBy { it.name }) ?: return; var total = files.sumOf { it.length() }; var count = files.size; for (file in files) { if (count <= MAX_ENTRIES && total <= MAX_BYTES) break; total -= file.length(); count -= 1; file.delete() } }
    private companion object { const val VERSION = 1; const val MAX_ENTRIES = 64; const val MAX_BYTES = 2 * 1024 * 1024; fun valid(entry: Entry, trackHash: String, lyricHash: String, title: String, artist: String, promptFingerprint: String) = entry.trackHash == trackHash && entry.lyricHash == lyricHash && entry.title == title && entry.artist == artist && entry.model == DeepSeekPolicy.MODEL && entry.promptVersion == DeepSeekPolicy.PROMPT_VERSION && entry.promptFingerprint == promptFingerprint && entry.target == DeepSeekPolicy.TARGET_LANGUAGE && entry.trackHash.length == 64 && entry.lyricHash.length == 64 && entry.translation.isNotBlank() && entry.translation.length <= DeepSeekPolicy.MAX_RESPONSE_BYTES }
}
