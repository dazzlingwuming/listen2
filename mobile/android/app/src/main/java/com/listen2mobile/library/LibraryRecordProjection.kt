package com.listen2mobile.library

/** Safe native-to-bridge projection for a local Room row. */
internal fun localRecordSnapshot(record: LocalRecordEntity): SafeLocalRecord = SafeLocalRecord(
    LibraryRecordIds.publicId(record.localRecordId),
    record.title,
    record.artist,
    record.accessState,
    record.album,
    record.durationMs,
    record.hasArtwork,
    record.lyricState,
)

/**
 * Resolves both current public IDs and IDs projected from an older durable row.
 * The stored primary key is intentionally never rewritten during recovery.
 */
internal fun resolveLocalRecord(records: List<LocalRecordEntity>, recordId: String): LocalRecordEntity? =
    records.firstOrNull { it.localRecordId == recordId }
        ?: records.firstOrNull { LibraryRecordIds.publicId(it.localRecordId) == recordId }
