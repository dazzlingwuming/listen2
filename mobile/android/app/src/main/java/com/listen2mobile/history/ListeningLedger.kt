package com.listen2mobile.history

import com.listen2mobile.library.HistoryAggregateEntity
import com.listen2mobile.library.HistoryEventEntity
import com.listen2mobile.library.HistorySessionEntity
import com.listen2mobile.library.HistoryStateEntity
import com.listen2mobile.library.Listen2Database
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

internal data class SafeHistoryTrack(val source: String, val trackId: String, val title: String, val artist: String)
internal data class PlaybackStart(val playbackInstanceId: String, val clearGeneration: Long, val track: SafeHistoryTrack, val durationMs: Long, val startedElapsedMs: Long)
internal data class PlaybackObservation(val playbackInstanceId: String, val clearGeneration: Long, val sequence: Long, val kind: String, val positionMs: Long?, val observedElapsedMs: Long)
internal data class ListeningCommit(val eventId: String, val playbackInstanceId: String, val committedLocalDate: String, val committedLocalYear: Int, val committedLocalMonth: Int, val listenedForwardMs: Long, val thresholdMs: Long)
internal data class HistoryRecap(
    val year: Int,
    val totalListenedMs: Long,
    val playCount: Int,
    val distinctTracks: Int,
    val distinctArtists: Int,
    val topTracks: List<Map<String, Any>>,
    val topArtists: List<Map<String, Any>>,
    val monthly: List<Map<String, Any>>,
)

internal data class LocalHistoryDate(val value: String, val year: Int, val month: Int)

internal fun localHistoryDate(wallClockMs: Long, zone: TimeZone): LocalHistoryDate {
    val calendar = Calendar.getInstance(zone, Locale.ROOT).apply { timeInMillis = wallClockMs }
    val year = calendar.get(Calendar.YEAR)
    val month = calendar.get(Calendar.MONTH) + 1
    val day = calendar.get(Calendar.DAY_OF_MONTH)
    return LocalHistoryDate(String.format(Locale.ROOT, "%04d-%02d-%02d", year, month, day), year, month)
}

/** Room owner for valid-listen evidence. Every public result is semantic and bounded. */
internal class ListeningLedger(
    private val database: Listen2Database,
    private val wallClockMs: () -> Long = System::currentTimeMillis,
    private val zone: () -> TimeZone = TimeZone::getDefault,
) {
    fun generation(): Long = database.runInTransaction<Long> { state().clearGeneration }
    fun revision(): Long = database.runInTransaction<Long> { state().revision }

    fun begin(value: PlaybackStart): Boolean = database.runInTransaction<Boolean> {
        if (!validStart(value) || value.clearGeneration != state().clearGeneration) return@runInTransaction false
        val dao = database.libraryDao()
        if (dao.historyEventForSession(value.playbackInstanceId, value.clearGeneration) != null) return@runInTransaction false
        val existing = dao.historySession(value.playbackInstanceId, value.clearGeneration)
        if (existing != null) return@runInTransaction true
        val initial = ListeningPolicy.initial(value.startedElapsedMs)
        dao.putHistorySession(HistorySessionEntity(value.playbackInstanceId, value.clearGeneration, value.track.source, value.track.trackId, value.track.title, value.track.artist, value.durationMs, value.startedElapsedMs, initial.sequence, initial.positionMs, initial.elapsedMs, initial.listenedForwardMs, initial.tracking))
        true
    }

    fun observe(value: PlaybackObservation): ListeningCommit? = database.runInTransaction<ListeningCommit?> {
        val currentState = state()
        if (!validObservation(value) || value.clearGeneration != currentState.clearGeneration) return@runInTransaction null
        val dao = database.libraryDao()
        if (dao.historyEventForSession(value.playbackInstanceId, value.clearGeneration) != null) return@runInTransaction null
        val row = dao.historySession(value.playbackInstanceId, value.clearGeneration) ?: return@runInTransaction null
        val step = ListeningPolicy.observe(ListeningPolicy.Session(row.lastSequence, row.lastPositionMs, row.lastElapsedMs, row.listenedForwardMs, row.tracking), row.durationMs, value.sequence, value.kind, value.positionMs, value.observedElapsedMs)
        if (step.session == ListeningPolicy.Session(row.lastSequence, row.lastPositionMs, row.lastElapsedMs, row.listenedForwardMs, row.tracking)) return@runInTransaction null
        dao.putHistorySession(row.copy(lastSequence = step.session.sequence, lastPositionMs = step.session.positionMs, lastElapsedMs = step.session.elapsedMs, listenedForwardMs = step.session.listenedForwardMs, tracking = step.session.tracking))
        if (!step.commit) return@runInTransaction null
        val threshold = requireNotNull(ListeningPolicy.threshold(row.durationMs))
        val date = localHistoryDate(wallClockMs(), zone())
        val event = HistoryEventEntity("${row.clearGeneration}:${row.playbackInstanceId}", row.playbackInstanceId, row.clearGeneration, row.source, row.semanticTrackId, row.title, row.artist, date.value, date.year, date.month, step.session.listenedForwardMs, threshold)
        dao.insertHistoryEvent(event)
        val prior = dao.historyAggregate(date.year, row.source, row.semanticTrackId)
        dao.putHistoryAggregate(HistoryAggregateEntity(date.year, row.source, row.semanticTrackId, (prior?.playCount ?: 0) + 1, row.title, row.artist))
        dao.deleteHistorySession(row.playbackInstanceId, row.clearGeneration)
        dao.putHistoryState(currentState.copy(revision = currentState.revision + 1))
        ListeningCommit(event.eventId, row.playbackInstanceId, event.committedLocalDate, date.year, date.month, event.listenedForwardMs, threshold)
    }

    fun clear(): Long = database.runInTransaction<Long> {
        val dao = database.libraryDao(); val current = state()
        dao.clearHistorySessions(); dao.clearHistoryEvents(); dao.clearHistoryAggregates()
        val next = current.copy(clearGeneration = current.clearGeneration + 1, revision = current.revision + 1)
        dao.putHistoryState(next); next.clearGeneration
    }

    fun events(year: Int?, limit: Int = 500): List<HistoryEventEntity> = database.runInTransaction<List<HistoryEventEntity>> {
        val safeLimit = limit.coerceIn(1, 500)
        if (year == null) database.libraryDao().historyEvents(safeLimit) else database.libraryDao().historyEventsForYear(year, safeLimit)
    }

    /**
     * Annual recap is calculated by Room projections instead of the bounded event/export query.
     * The UI event list remains capped, but totals and rankings must include every event in the
     * selected year.
     */
    fun recap(year: Int): HistoryRecap = database.runInTransaction<HistoryRecap> {
        val dao = database.libraryDao()
        val totals = dao.historyTotalsForYear(year)
        val monthly = dao.historyMonthsForYear(year).associateBy { it.month }
        val monthRows = (1..12).map { month ->
            val row = monthly[month]
            mapOf("month" to month, "playCount" to (row?.playCount ?: 0L).toInt(), "listenedForwardMs" to (row?.listenedForwardMs ?: 0L))
        }
        HistoryRecap(
            year = year,
            totalListenedMs = totals.totalListenedMs,
            playCount = totals.playCount.toInt(),
            distinctTracks = totals.distinctTracks.toInt(),
            distinctArtists = totals.distinctArtists.toInt(),
            topTracks = dao.historyTopTracksForYear(year).map { row ->
                mapOf("source" to row.source, "trackId" to row.semanticTrackId, "title" to row.title, "artist" to row.artist, "playCount" to row.playCount.toInt())
            },
            topArtists = dao.historyTopArtistsForYear(year).map { row ->
                mapOf("artist" to row.artist, "playCount" to row.playCount.toInt())
            },
            monthly = monthRows,
        )
    }

    private fun state(): HistoryStateEntity = database.libraryDao().historyState() ?: HistoryStateEntity(clearGeneration = 0, revision = 0).also(database.libraryDao()::putHistoryState)
    private fun validStart(value: PlaybackStart) = value.playbackInstanceId.matches(Regex("^[A-Za-z0-9_-]{1,96}$")) && value.clearGeneration >= 0 && value.track.source in setOf("netease", "kugou", "kuwo", "qq", "bilibili", "local") && value.track.trackId.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) && value.track.title.isNotBlank() && value.track.title.length <= 160 && value.track.artist.isNotBlank() && value.track.artist.length <= 160 && ListeningPolicy.threshold(value.durationMs) != null && value.startedElapsedMs >= 0
    private fun validObservation(value: PlaybackObservation) = value.playbackInstanceId.matches(Regex("^[A-Za-z0-9_-]{1,96}$")) && value.clearGeneration >= 0 && value.sequence in 1..1_000_000L && ListeningPolicy.validKind(value.kind) && (value.positionMs == null || value.positionMs in 0..86_400_000L) && value.observedElapsedMs >= 0
}
