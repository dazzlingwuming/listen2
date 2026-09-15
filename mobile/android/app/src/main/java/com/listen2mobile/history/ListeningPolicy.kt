package com.listen2mobile.history

/** Pure, clock-free evidence policy. Playback callbacks are reduced to bounded semantic state. */
internal object ListeningPolicy {
    const val MIN_FORWARD_MS = 30_000L
    const val MAX_THRESHOLD_MS = 240_000L
    private const val MAX_SEGMENT_MS = 15_000L
    private val kinds = setOf("play", "progress", "pause", "buffer", "seek", "failure", "stop", "browse")

    data class Session(
        val sequence: Long,
        val positionMs: Long,
        val elapsedMs: Long,
        val listenedForwardMs: Long,
        val tracking: Boolean,
    )
    data class Step(val session: Session, val commit: Boolean)

    fun threshold(durationMs: Long): Long? = if (durationMs <= 0) null else minOf(durationMs / 2, MAX_THRESHOLD_MS)
    fun validKind(kind: String) = kind in kinds
    fun initial(startedElapsedMs: Long) = Session(0, 0, startedElapsedMs, 0, true)

    fun observe(current: Session, durationMs: Long, sequence: Long, kind: String, positionMs: Long?, elapsedMs: Long): Step {
        if (!validKind(kind) || sequence <= current.sequence || elapsedMs < current.elapsedMs) return Step(current, false)
        val position = positionMs?.takeIf { it >= 0 } ?: current.positionMs
        val base = current.copy(sequence = sequence, positionMs = position, elapsedMs = elapsedMs)
        if (kind != "progress") return Step(base.copy(tracking = kind == "play"), false)
        if (!current.tracking || positionMs == null) return Step(base, false)
        val positionDelta = position - current.positionMs
        val elapsedDelta = elapsedMs - current.elapsedMs
        // Reject seeks, buffering gaps, preload and impossible clock/position leaps instead of
        // crediting their apparent movement as listening.
        val forward = if (positionDelta in 0..MAX_SEGMENT_MS && elapsedDelta in 0..MAX_SEGMENT_MS && positionDelta <= elapsedDelta + 1_000L) minOf(positionDelta, elapsedDelta) else 0L
        val next = base.copy(listenedForwardMs = current.listenedForwardMs + forward, tracking = true)
        val needed = threshold(durationMs)
        return Step(next, needed != null && next.listenedForwardMs > MIN_FORWARD_MS && next.listenedForwardMs >= needed)
    }
}
