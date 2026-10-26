package com.dazzlingwuming.listen2;

import androidx.room.Room;
import androidx.test.platform.app.InstrumentationRegistry;
import com.dazzlingwuming.listen2.data.Listen2Database;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import org.junit.Test;
import static org.junit.Assert.*;

public final class PlaylistShufflePersistenceInstrumentationTest {
    @Test public void largePlaylistRetainsPlayedAndUnplayedRowsAndExactShuffleCursor() {
        Listen2Database database = Room.inMemoryDatabaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(), Listen2Database.class)
                .allowMainThreadQueries().build();
        try {
            Set<String> ids = new LinkedHashSet<>();
            List<PlaybackCheckpointRepository.OccurrenceState> rows = new ArrayList<>();
            for (int i = 0; i < 746; i++) {
                ids.add("occ-" + i);
                rows.add(new PlaybackCheckpointRepository.OccurrenceState("occ-" + i, "track-" + i,
                        "bilibili", "BV1xx411c7mD", i % 2 == 0 ? 0 : 22, "歌曲 " + i, "歌手", 120000,
                        "audio", i < 10 ? "base" : "queue", i < 10 ? i : i - 10, true));
            }
            PlaylistShuffleOrder shuffle = new PlaylistShuffleOrder(new Random(42));
            shuffle.reset(ids, "occ-0");
            String current = "occ-0";
            for (int i = 0; i < 10; i++) current = shuffle.next(ids, current);
            PlaybackCheckpointRepository repository = new PlaybackCheckpointRepository(database);
            PlaybackCheckpointRepository.DurableState checkpoint = new PlaybackCheckpointRepository.DurableState(
                    1, "fixture-shuffle", "android-context", current, current,
                    PlaybackQueueEngine.Mode.SHUFFLE, PlaybackQueueEngine.Mode.SHUFFLE, false, 1, 23000,
                    rows, Arrays.asList(new PlaybackCheckpointRepository.HistoryState(0, "occ-0", 1000),
                            new PlaybackCheckpointRepository.HistoryState(1, current, 2000)),
                    shuffle.checkpointOrder(), shuffle.checkpointCursor());
            assertEquals(PlaybackCheckpointRepository.Status.ACCEPTED, repository.applyTransition(0, checkpoint).getStatus());
            PlaybackCheckpointRepository.RestoredState restored = repository.restore();
            assertEquals(746, restored.getOccurrenceStates().size());
            assertEquals(736, restored.getQueueOccurrenceIds().size());
            assertEquals(0, restored.getOccurrenceState("occ-0").getProviderPartId());
            PlaylistShuffleOrder resumed = new PlaylistShuffleOrder(new Random(99));
            resumed.restore(restored.getShuffleOccurrenceIds(), restored.getShuffleNextIndex());
            assertEquals(shuffle.next(ids, current), resumed.next(ids, current));
        } finally { database.close(); }
    }
}
