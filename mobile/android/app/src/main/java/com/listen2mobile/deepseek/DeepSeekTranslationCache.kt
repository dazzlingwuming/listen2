package com.listen2mobile.deepseek

import android.content.Context
import java.io.File
import org.json.JSONObject

/** App-private, track-hash-bound cache. It contains no credential and is never an RN persistence store. */
class DeepSeekTranslationCache private constructor(private val root: File?, private val memory: MutableMap<String, Entry>?) {
    data class Entry(val trackHash: String, val lyricHash: String, val translation: String, val model: String = DeepSeekPolicy.MODEL, val promptFingerprint: String = "", val target: String = DeepSeekPolicy.TARGET_LANGUAGE)
    class InMemoryStore { private val entries = linkedMapOf<String, Entry>(); fun put(entry: Entry) { entries[entry.trackHash] = entry }; fun get(trackHash: String, lyricHash: String) = entries[trackHash]?.takeIf { it.lyricHash == lyricHash } }
    constructor(context: Context) : this(File(context.filesDir, "lyric-cache-v1").also { it.mkdirs() }, null)
    fun get(trackHash: String, lyricHash: String): Entry? {
        memory?.get(trackHash)?.let { return it.takeIf { entry -> entry.lyricHash == lyricHash } }
        val file = root?.resolve("$trackHash.json") ?: return null
        return try { val json = JSONObject(file.readText()); val entry = Entry(json.optString("trackHash"), json.optString("lyricHash"), json.optString("translation"), json.optString("model"), json.optString("promptFingerprint"), json.optString("target")); entry.takeIf { it.trackHash == trackHash && it.lyricHash == lyricHash && it.translation.isNotBlank() && it.translation.length <= DeepSeekPolicy.MAX_RESPONSE_BYTES } } catch (_: Exception) { file.delete(); null }
    }
    fun put(entry: Entry): Boolean {
        if (entry.trackHash.length != 64 || entry.lyricHash.length != 64 || entry.translation.isBlank() || entry.translation.length > DeepSeekPolicy.MAX_RESPONSE_BYTES) return false
        memory?.let { it[entry.trackHash] = entry; return true }
        val destination = root?.resolve("${entry.trackHash}.json") ?: return false
        return try { val temporary = File(destination.parentFile, ".${entry.trackHash}.tmp"); temporary.outputStream().use { output -> output.write(JSONObject().put("version", 1).put("trackHash", entry.trackHash).put("lyricHash", entry.lyricHash).put("translation", entry.translation).put("model", entry.model).put("promptFingerprint", entry.promptFingerprint).put("target", entry.target).toString().toByteArray()); output.fd.sync() }; temporary.renameTo(destination) } catch (_: Exception) { false }
    }
}
