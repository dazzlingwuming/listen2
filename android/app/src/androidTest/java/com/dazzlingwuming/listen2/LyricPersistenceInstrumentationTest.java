package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;

import androidx.room.Room;
import androidx.test.platform.app.InstrumentationRegistry;

import com.dazzlingwuming.listen2.data.Listen2Database;
import com.dazzlingwuming.listen2.data.LyricRepository;

import org.junit.Test;

/** API-35 proof for exact-key lyric writes, revision conflicts, and durable restore. */
public final class LyricPersistenceInstrumentationTest {
    @Test
    public void manualSelectionAndOffsetRoundTripWithoutCrossIdentityMutation() {
        Listen2Database database = Room.inMemoryDatabaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(), Listen2Database.class)
                .allowMainThreadQueries().build();
        try {
            LyricRepository repository = new LyricRepository(database);
            LyricPersistencePort.Intent set = intent(LyricPersistencePort.Operation.SET, 0L, "select-1",
                    "source-1", 0L);
            assertEquals("accepted", repository.execute(set).status);
            LyricPersistencePort.Intent offset = intent(LyricPersistencePort.Operation.OFFSET, 1L, "offset-1",
                    null, 1_500L);
            assertEquals("accepted", repository.execute(offset).status);
            LyricPersistencePort.Result restored = repository.execute(
                    intent(LyricPersistencePort.Operation.GET, 2L, "get-1", null, 0L));
            assertEquals("manual", restored.mode);
            assertEquals("source-1", restored.selectedSourceId);
            assertEquals(1_500L, restored.offsetMs);
            assertEquals("idempotent", repository.execute(offset).status);
            assertEquals("stale", repository.execute(intent(LyricPersistencePort.Operation.SET, 1L,
                    "stale", "source-2", 0L)).status);
            LyricPersistencePort.Intent otherSet = new LyricPersistencePort.Intent(
                    LyricPersistencePort.Operation.SET, "netease", "1001", "part-2", "identity-1",
                    0L, "other-set", "source-other", 0L);
            assertEquals("accepted", repository.execute(otherSet).status);
            assertEquals("accepted", repository.execute(intent(LyricPersistencePort.Operation.SET, 2L,
                    "other-set", "source-2", 0L)).status);
            assertEquals("accepted", repository.execute(intent(LyricPersistencePort.Operation.CLEAR, 3L,
                    "clear-1", null, 0L)).status);
            assertEquals("automatic", repository.execute(
                    intent(LyricPersistencePort.Operation.GET, 4L, "get-after-clear", null, 0L)).mode);
            assertEquals("manual", repository.execute(new LyricPersistencePort.Intent(
                    LyricPersistencePort.Operation.GET, "netease", "1001", "part-2", "identity-1",
                    1L, "other-get", null, 0L)).mode);
        } finally {
            database.close();
        }
    }

    @Test
    public void invalidAndCorruptRecordsCannotResurrect() {
        Listen2Database database = Room.inMemoryDatabaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(), Listen2Database.class)
                .allowMainThreadQueries().build();
        try {
            LyricRepository repository = new LyricRepository(database);
            assertEquals("invalid", repository.execute(intent(LyricPersistencePort.Operation.OFFSET, 0L,
                    "bad-offset", null, 250L)).status);
            database.lyricDao().upsert(new com.dazzlingwuming.listen2.data.LyricRecord.Entity(
                    "netease", "1001", "", "identity-1", "manual", null, 0, 0L, null, null,
                    0L, 1L, "corrupt", 1L));
            assertEquals("invalid", repository.execute(intent(LyricPersistencePort.Operation.GET, 0L,
                    "get-corrupt", null, 0L)).status);
            assertEquals("not-found", repository.execute(intent(LyricPersistencePort.Operation.GET, 0L,
                    "get-after-corrupt", null, 0L)).status);
        } finally {
            database.close();
        }
    }

    private static LyricPersistencePort.Intent intent(LyricPersistencePort.Operation operation,
            long expectedRevision, String token, String lyricId, long offsetMs) {
        return new LyricPersistencePort.Intent(operation, "netease", "1001", "", "identity-1",
                expectedRevision, token, lyricId, offsetMs);
    }
}
