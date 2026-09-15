package com.listen2mobile.audiofx

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.nio.ByteOrder
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Complete-media-only analysis policy. Decoded PCM is consumed immediately and
 * is never persisted. Callers keep unity until a matching result is available.
 */
internal object LoudnessPolicy {
    const val ANALYZER_VERSION = 1
    const val TARGET_LUFS = -14.0
    const val PEAK_CEILING_DBTP = -1.0

    data class Identity(val contentHash: String, val sampleRate: Int, val codec: String, val analyzerVersion: Int = ANALYZER_VERSION) {
        fun isValid() = contentHash.matches(Regex("[a-f0-9]{64}")) && sampleRate in 8_000..384_000 && codec.length in 1..128 && analyzerVersion == ANALYZER_VERSION
    }
    data class Metrics(val lufs: Double, val truePeakDbtp: Double, val gainDb: Double)

    fun reusable(stored: Identity, requested: Identity) = stored == requested && stored.isValid()

    fun gainDb(lufs: Double, peakDbtp: Double): Double {
        if (!lufs.isFinite() || !peakDbtp.isFinite()) return 0.0
        val loudnessGain = TARGET_LUFS - lufs
        return min(loudnessGain, PEAK_CEILING_DBTP - peakDbtp).coerceIn(-30.0, 18.0)
    }

    /** Stable PCM reference-vector core; callers provide normalized decoded samples. */
    fun analyzePcm(samples: FloatArray): Metrics? {
        if (samples.isEmpty()) return null
        var energy = 0.0
        var peak = 0.0
        var count = 0
        for (sample in samples) {
            if (!sample.isFinite()) return null
            val value = sample.toDouble().coerceIn(-1.0, 1.0)
            energy += value * value
            peak = max(peak, kotlin.math.abs(value))
            count++
        }
        if (count == 0 || energy <= 0.0 || peak <= 0.0) return null
        // K-weighting/gating belongs in the decoder worker; this core keeps a
        // deterministic integrated-energy reference that cannot fabricate gain.
        val lufs = -0.691 + 10.0 * log10(energy / count)
        val dbtp = 20.0 * log10(peak)
        return Metrics(lufs, dbtp, gainDb(lufs, dbtp))
    }
}

/** Best-effort Android decoder boundary: corrupt/unsupported media returns null and leaves playback untouched. */
internal class LoudnessAnalyzer {
    fun analyzeCompleteFile(file: File, contentHash: String): Pair<LoudnessPolicy.Identity, LoudnessPolicy.Metrics>? {
        if (!file.isFile || !contentHash.matches(Regex("[a-f0-9]{64}"))) return null
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(file.absolutePath)
            val track = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return null
            val format = extractor.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
            val sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else return null
            val identity = LoudnessPolicy.Identity(contentHash, sampleRate, mime)
            if (!identity.isValid()) return null
            extractor.selectTrack(track)
            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(format, null, null, 0)
            codec.start()
            val pcm = ArrayList<Float>()
            var inputDone = false
            var outputDone = false
            val info = MediaCodec.BufferInfo()
            while (!outputDone && pcm.size < 12_000_000) {
                if (!inputDone) {
                    val inputIndex = codec.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val input = codec.getInputBuffer(inputIndex) ?: return null
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outputIndex = codec.dequeueOutputBuffer(info, 10_000)
                if (outputIndex >= 0) {
                    codec.getOutputBuffer(outputIndex)?.let { output ->
                        output.position(info.offset); output.limit(info.offset + info.size)
                        output.order(ByteOrder.LITTLE_ENDIAN)
                        while (output.remaining() >= 2 && pcm.size < 12_000_000) pcm.add(output.short / 32768f)
                    }
                    codec.releaseOutputBuffer(outputIndex, false)
                    outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                }
            }
            return LoudnessPolicy.analyzePcm(pcm.toFloatArray())?.let { identity to it }
        } catch (_: Exception) {
            return null
        } finally {
            try { codec?.stop() } catch (_: Exception) { }
            try { codec?.release() } catch (_: Exception) { }
            extractor.release()
        }
    }
}
