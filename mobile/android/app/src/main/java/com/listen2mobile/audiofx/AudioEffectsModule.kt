package com.listen2mobile.audiofx

import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.media.audiofx.Visualizer
import android.os.SystemClock
import com.doublesymmetry.kotlinaudio.players.Listen2AudioSessionBridge
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.log10

/** High-level-only effects contract: session ids never cross the React boundary. */
internal object AudioEffectsPolicy {
    val presets = setOf("neutral", "bass", "vocal", "treble")
    fun status(session: Int, enabled: Boolean) = when { session <= 0 -> "unavailable"; !enabled -> "disabled"; else -> "enabled" }
    fun gain(value: Double) = if (value.isFinite()) value.coerceIn(0.0, 4.0) else 1.0
}

@ReactModule(name = AudioEffectsModule.NAME)
class AudioEffectsModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
    companion object { const val NAME = "Listen2AudioEffects"; private const val FRAME_EVENT = "Listen2AudioEffectsFrame" }
    private var enabled = false; private var visualizerEnabled = false; private var preset = "neutral"; private var fixedGain = 1.0
    private var activeSession = 0; private var activeGeneration = -1L
    private var equalizer: Equalizer? = null; private var enhancer: LoudnessEnhancer? = null; private var visualizer: Visualizer? = null
    override fun getName() = NAME
    private fun reply(status: String) = Arguments.createMap().apply { putInt("version", 1); putString("status", status); putString("preset", preset); putDouble("fixedGain", fixedGain) }

    /** Recreate resources on every native RNTP session generation; session id stays native-private. */
    @Synchronized private fun prepareSession(): String {
        val session = Listen2AudioSessionBridge.sessionId(); val generation = Listen2AudioSessionBridge.generation()
        if (session <= 0) { releaseAll(); return "unavailable" }
        if (session != activeSession || generation != activeGeneration) { releaseAll(); activeSession = session; activeGeneration = generation }
        return AudioEffectsPolicy.status(session, enabled || visualizerEnabled)
    }
    @Synchronized private fun applyEffects(): String {
        if (prepareSession() == "unavailable") return "unavailable"
        if (!enabled || preset == "neutral") { releaseEqualizer(); applyGain(); return "disabled" }
        return try {
            val effect = equalizer ?: Equalizer(0, activeSession).also { equalizer = it }; val range = effect.bandLevelRange
            if (range.size != 2 || range[0] > range[1] || effect.numberOfBands <= 0) throw IllegalStateException("equalizer-unsupported")
            for (band in 0 until effect.numberOfBands.toInt()) {
                val boost = when (preset) { "bass" -> if (band < effect.numberOfBands / 2) .72 else .12; "vocal" -> if (band in effect.numberOfBands / 3..(effect.numberOfBands * 2 / 3)) .55 else 0.0; "treble" -> if (band >= effect.numberOfBands / 2) .62 else .08; else -> 0.0 }
                effect.setBandLevel(band.toShort(), (range[1] * boost).toInt().coerceIn(range[0].toInt(), range[1].toInt()).toShort())
            }
            effect.enabled = true; applyGain(); "enabled"
        } catch (_: Exception) { releaseEqualizer(); releaseEnhancer(); "unavailable" }
    }
    @Synchronized private fun applyGain() {
        if (activeSession <= 0) return
        try { val effect = enhancer ?: LoudnessEnhancer(activeSession).also { enhancer = it }; val millibels = if (fixedGain > 1.0) (20.0 * log10(fixedGain) * 100.0).toInt().coerceAtLeast(0) else 0; effect.setTargetGain(millibels); effect.enabled = millibels > 0 } catch (_: Exception) { releaseEnhancer() }
    }
    @Synchronized private fun applyVisualizer(): String {
        if (prepareSession() == "unavailable") return "unavailable"
        if (!visualizerEnabled) { releaseVisualizer(); return "disabled" }
        return try {
            val capture = visualizer ?: Visualizer(activeSession).also { visualizer = it }; val sizes = Visualizer.getCaptureSizeRange()
            if (sizes.size != 2 || sizes[0] <= 0 || sizes[1] < sizes[0]) throw IllegalStateException("visualizer-unsupported")
            capture.captureSize = sizes[0].coerceAtLeast(128).coerceAtMost(sizes[1])
            capture.setDataCaptureListener(object : Visualizer.OnDataCaptureListener { override fun onWaveFormDataCapture(source: Visualizer, waveform: ByteArray, samplingRate: Int) = emitFrame(waveform, activeGeneration); override fun onFftDataCapture(source: Visualizer, fft: ByteArray, samplingRate: Int) = Unit }, (Visualizer.getMaxCaptureRate() / 8).coerceAtLeast(1), true, false)
            capture.enabled = true; "enabled"
        } catch (_: Exception) { releaseVisualizer(); "unavailable" }
    }
    private fun emitFrame(waveform: ByteArray, generation: Long) {
        if (!app.hasActiveReactInstance() || waveform.isEmpty() || generation != Listen2AudioSessionBridge.generation()) return
        val bins = Arguments.createArray(); val step = (waveform.size / 16).coerceAtLeast(1); var index = 0
        while (index < waveform.size && bins.size() < 16) { bins.pushDouble((kotlin.math.abs(waveform[index].toInt()) / 128.0).coerceIn(0.0, 1.0)); index += step }
        app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(FRAME_EVENT, Arguments.createMap().apply { putArray("bins", bins); putDouble("timestampMs", SystemClock.elapsedRealtime().toDouble()); putDouble("generation", generation.toDouble()) })
    }
    @Synchronized private fun releaseEqualizer() { try { equalizer?.release() } catch (_: Exception) { }; equalizer = null }
    @Synchronized private fun releaseEnhancer() { try { enhancer?.release() } catch (_: Exception) { }; enhancer = null }
    @Synchronized private fun releaseVisualizer() { try { visualizer?.release() } catch (_: Exception) { }; visualizer = null }
    @Synchronized private fun releaseAll() { releaseEqualizer(); releaseEnhancer(); releaseVisualizer(); activeSession = 0; activeGeneration = -1L }
    @ReactMethod fun capability(promise: Promise) = promise.resolve(reply(prepareSession()))
    @ReactMethod fun setEnabled(value: Boolean, promise: Promise) { enabled = value; if (!value) preset = "neutral"; promise.resolve(reply(applyEffects())) }
    @ReactMethod fun selectPreset(value: String, promise: Promise) { if (!AudioEffectsPolicy.presets.contains(value)) { promise.resolve(reply("invalid-preset")); return }; preset = value; enabled = value != "neutral"; promise.resolve(reply(applyEffects())) }
    @ReactMethod fun reset(promise: Promise) { enabled = false; preset = "neutral"; releaseEqualizer(); applyGain(); promise.resolve(reply(if (prepareSession() == "unavailable") "unavailable" else "disabled")) }
    @ReactMethod fun setFixedNormalizationGain(value: Double, promise: Promise) { fixedGain = AudioEffectsPolicy.gain(value); val status = prepareSession(); if (status != "unavailable") applyGain(); promise.resolve(reply(status)) }
    @ReactMethod fun setVisualizationEnabled(value: Boolean, promise: Promise) { visualizerEnabled = value; promise.resolve(reply(applyVisualizer())) }
    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit
    override fun invalidate() { releaseAll(); super.invalidate() }
}
