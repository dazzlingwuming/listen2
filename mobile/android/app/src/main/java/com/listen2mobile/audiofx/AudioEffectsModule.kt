package com.listen2mobile.audiofx

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/** High-level-only effects contract: session ids never cross the React boundary. */
internal object AudioEffectsPolicy {
    val presets = setOf("neutral", "bass", "vocal", "treble")
    fun status(session: Int, enabled: Boolean) = when { session <= 0 -> "unavailable"; !enabled -> "disabled"; else -> "enabled" }
    /** Separate app gain: bounded but intentionally independent from RNTP user volume/mute. */
    fun gain(value: Double) = if (value.isFinite()) value.coerceIn(0.0, 4.0) else 1.0
}

@ReactModule(name = AudioEffectsModule.NAME)
class AudioEffectsModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
    companion object { const val NAME = "Listen2AudioEffects" }
    private var enabled = false; private var preset = "neutral"; private var fixedGain = 1.0
    override fun getName() = NAME
    private fun reply(status: String) = Arguments.createMap().apply { putInt("version", 1); putString("status", status); putString("preset", preset); putDouble("fixedGain", fixedGain) }
    @ReactMethod fun capability(promise: Promise) = promise.resolve(reply(AudioEffectsPolicy.status(0, enabled)))
    @ReactMethod fun setEnabled(value: Boolean, promise: Promise) { enabled = value; if (!value) preset = "neutral"; promise.resolve(reply(AudioEffectsPolicy.status(0, enabled))) }
    @ReactMethod fun selectPreset(value: String, promise: Promise) { if (!AudioEffectsPolicy.presets.contains(value)) { promise.resolve(reply("invalid-preset")); return }; preset = value; enabled = value != "neutral"; promise.resolve(reply(AudioEffectsPolicy.status(0, enabled))) }
    @ReactMethod fun reset(promise: Promise) { enabled = false; preset = "neutral"; promise.resolve(reply("disabled")) }
    @ReactMethod fun setFixedNormalizationGain(value: Double, promise: Promise) { fixedGain = AudioEffectsPolicy.gain(value); promise.resolve(reply("ok")) }
    @ReactMethod fun setVisualizationEnabled(value: Boolean, promise: Promise) { promise.resolve(reply(if (value) "unavailable" else "disabled")) }
}
