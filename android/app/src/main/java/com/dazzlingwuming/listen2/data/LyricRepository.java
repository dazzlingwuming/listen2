package com.dazzlingwuming.listen2.data;

import android.content.Context;

import androidx.room.Room;

import com.dazzlingwuming.listen2.LyricPersistencePort;

import java.nio.charset.StandardCharsets;

/** Transactional exact-identity lyric selection and offset persistence. */
public final class LyricRepository implements LyricPersistencePort, AutoCloseable {
    private static final long MIN_OFFSET_MS = -10_000L;
    private static final long MAX_OFFSET_MS = 10_000L;
    private static final long OFFSET_STEP_MS = 500L;
    private static final int MAX_ID_LENGTH = 128;
    private static final int MAX_SINGLE_TEXT_BYTES = 256 * 1024;
    private static final int MAX_COMBINED_TEXT_BYTES = 512 * 1024;
    private final Listen2Database database;
    private final LyricRecord.Dao dao;

    public static LyricRepository open(Context context) {
        Listen2Database database = Room.databaseBuilder(context.getApplicationContext(),
                        Listen2Database.class, "listen2.db")
                .addMigrations(Listen2Database.MIGRATION_1_2)
                .build();
        return new LyricRepository(database);
    }

    public LyricRepository(Listen2Database database) {
        this.database = database;
        this.dao = database.lyricDao();
    }

    @Override
    public Result execute(Intent intent) {
        if (!isValidIntent(intent)) return Result.error("INVALID_LYRIC_INTENT");
        final Result[] result = new Result[1];
        database.runInTransaction(() -> result[0] = executeInTransaction(intent));
        return result[0] == null ? Result.error("LYRIC_PERSISTENCE_UNAVAILABLE") : result[0];
    }

    private Result executeInTransaction(Intent intent) {
        LyricRecord.Entity current = dao.get(intent.source, intent.providerTrackId,
                normalizedPart(intent.providerPartId), intent.lyricRevision);
        if (current != null && !isStoredRecordValid(current)) {
            dao.delete(intent.source, intent.providerTrackId, normalizedPart(intent.providerPartId),
                    intent.lyricRevision);
            return Result.error("CORRUPT_LYRIC_RECORD");
        }
        if (intent.operation == Operation.GET) return current == null ? Result.notFound() : result(current, false);
        if (current != null && intent.transitionToken.equals(current.transitionToken)) {
            return result(current, true);
        }
        long currentRevision = current == null ? 0L : current.semanticRevision;
        if (intent.expectedRevision != currentRevision) return Result.stale(currentRevision);
        if (intent.operation == Operation.CLEAR) {
            if (current == null) return Result.notFound();
            LyricRecord.Entity automatic = copy(current, "automatic", null, current.offsetMs,
                    currentRevision + 1L, intent.transitionToken);
            dao.upsert(automatic);
            return result(automatic, false);
        }
        if (intent.operation == Operation.SET) {
            LyricRecord.Entity next = current == null
                    ? new LyricRecord.Entity(intent.source, intent.providerTrackId,
                            normalizedPart(intent.providerPartId), intent.lyricRevision, "manual",
                            intent.selectedSourceId, 0, 0L, null, null, 0L, 1L,
                            intent.transitionToken, System.currentTimeMillis())
                    : copy(current, "manual", intent.selectedSourceId, current.offsetMs,
                            currentRevision + 1L, intent.transitionToken);
            dao.upsert(next);
            return result(next, false);
        }
        if (intent.operation == Operation.OFFSET) {
            LyricRecord.Entity next = current == null
                    ? new LyricRecord.Entity(intent.source, intent.providerTrackId,
                            normalizedPart(intent.providerPartId), intent.lyricRevision, "automatic",
                            null, 0, 0L, null, null, intent.offsetMs, 1L,
                            intent.transitionToken, System.currentTimeMillis())
                    : copy(current, current.mode, current.selectedSourceId, intent.offsetMs,
                            currentRevision + 1L, intent.transitionToken);
            dao.upsert(next);
            return result(next, false);
        }
        return Result.error("INVALID_LYRIC_INTENT");
    }

    private static LyricRecord.Entity copy(LyricRecord.Entity current, String mode,
            String selectedSourceId, long offsetMs, long semanticRevision, String transitionToken) {
        return new LyricRecord.Entity(current.source, current.providerTrackId, current.providerPartId,
                current.lyricRevision, mode, selectedSourceId, current.matchQuality, current.matchedAtMs,
                current.originalText, current.translationText, offsetMs, semanticRevision, transitionToken,
                System.currentTimeMillis());
    }

    private static Result result(LyricRecord.Entity entity, boolean idempotent) {
        return idempotent ? Result.idempotent(entity.semanticRevision, entity.mode,
                entity.selectedSourceId, entity.offsetMs) : Result.accepted(entity.semanticRevision,
                entity.mode, entity.selectedSourceId, entity.offsetMs);
    }

    private static boolean isValidIntent(Intent intent) {
        if (intent == null || intent.operation == null || !safeId(intent.source) || !safeId(intent.providerTrackId)
                || !safeId(intent.lyricRevision) || !safeId(intent.transitionToken)
                || intent.expectedRevision < 0L || intent.expectedRevision > Integer.MAX_VALUE) return false;
        if (intent.providerPartId != null && !intent.providerPartId.isEmpty() && !safeId(intent.providerPartId)) {
            return false;
        }
        if (intent.operation == Operation.SET && !safeId(intent.selectedSourceId)) return false;
        return intent.operation != Operation.OFFSET || (intent.offsetMs >= MIN_OFFSET_MS
                && intent.offsetMs <= MAX_OFFSET_MS && intent.offsetMs % OFFSET_STEP_MS == 0L);
    }

    /** Stores provider-authorized semantic lyric content without any transport material. */
    public Result persistAuthorizedContent(Intent intent, String originalText, String translationText,
            int matchQuality, long matchedAtMs) {
        if (!isValidIntent(intent) || !isValidContent(originalText, translationText)
                || matchQuality < 0 || matchQuality > 100 || matchedAtMs < 0L) {
            return Result.error("INVALID_LYRIC_CONTENT");
        }
        final Result[] result = new Result[1];
        database.runInTransaction(() -> {
            LyricRecord.Entity current = dao.get(intent.source, intent.providerTrackId,
                    normalizedPart(intent.providerPartId), intent.lyricRevision);
            long currentRevision = current == null ? 0L : current.semanticRevision;
            if (current != null && intent.transitionToken.equals(current.transitionToken)) {
                result[0] = result(current, true);
            } else if (intent.expectedRevision != currentRevision) {
                result[0] = Result.stale(currentRevision);
            } else {
                String mode = current == null ? "automatic" : current.mode;
                String selected = current == null ? null : current.selectedSourceId;
                long offset = current == null ? 0L : current.offsetMs;
                LyricRecord.Entity next = new LyricRecord.Entity(intent.source, intent.providerTrackId,
                        normalizedPart(intent.providerPartId), intent.lyricRevision, mode, selected,
                        matchQuality, matchedAtMs, originalText, translationText, offset,
                        currentRevision + 1L, intent.transitionToken, System.currentTimeMillis());
                dao.upsert(next);
                result[0] = result(next, false);
            }
        });
        return result[0] == null ? Result.error("LYRIC_PERSISTENCE_UNAVAILABLE") : result[0];
    }

    private static boolean isStoredRecordValid(LyricRecord.Entity entity) {
        return entity.semanticRevision > 0L && ("automatic".equals(entity.mode) || "manual".equals(entity.mode))
                && entity.offsetMs >= MIN_OFFSET_MS && entity.offsetMs <= MAX_OFFSET_MS
                && entity.offsetMs % OFFSET_STEP_MS == 0L
                && ("automatic".equals(entity.mode) || safeId(entity.selectedSourceId))
                && isValidContent(entity.originalText, entity.translationText)
                && entity.matchQuality >= 0 && entity.matchQuality <= 100 && entity.matchedAtMs >= 0L;
    }

    private static boolean isValidContent(String originalText, String translationText) {
        int originalBytes = byteLength(originalText);
        int translationBytes = byteLength(translationText);
        return originalBytes <= MAX_SINGLE_TEXT_BYTES && translationBytes <= MAX_SINGLE_TEXT_BYTES
                && originalBytes + translationBytes <= MAX_COMBINED_TEXT_BYTES;
    }

    private static int byteLength(String text) {
        return text == null ? 0 : text.getBytes(StandardCharsets.UTF_8).length;
    }

    private static boolean safeId(String value) {
        return value != null && !value.isEmpty() && value.length() <= MAX_ID_LENGTH
                && value.matches("[A-Za-z0-9:._-]+");
    }

    private static String normalizedPart(String part) {
        return part == null ? "" : part;
    }

    @Override
    public void close() {
        database.close();
    }
}
