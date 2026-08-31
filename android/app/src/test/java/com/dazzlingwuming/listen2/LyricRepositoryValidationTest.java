package com.dazzlingwuming.listen2.data;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.LyricPersistencePort;

import org.junit.Test;

/** Pure boundary tests keep hostile page lyric intents out of Room before transactions begin. */
public final class LyricRepositoryValidationTest {
    @Test
    public void acceptsOnlyExactBoundedSemanticIntents() {
        assertNull(LyricRepository.validationError(intent(LyricPersistencePort.Operation.OFFSET, 10_000L)));
        assertNotNull(LyricRepository.validationError(intent(LyricPersistencePort.Operation.OFFSET, 10_500L)));
        assertNotNull(LyricRepository.validationError(intent(LyricPersistencePort.Operation.OFFSET, 250L)));
        assertNotNull(LyricRepository.validationError(new LyricPersistencePort.Intent(
                LyricPersistencePort.Operation.SET, "netease", "1001", "", "revision", 0L,
                "transition", "not safe/identity", 0L)));
    }

    @Test
    public void boundsAuthorizedTextBeforePersistence() {
        assertTrue(LyricRepository.isValidContent("original", "translation"));
        assertFalse(LyricRepository.isValidContent(repeat('a', 256 * 1024 + 1), null));
        assertFalse(LyricRepository.isValidContent(repeat('a', 256 * 1024), repeat('b', 256 * 1024 + 1)));
    }

    private static LyricPersistencePort.Intent intent(LyricPersistencePort.Operation operation, long offsetMs) {
        return new LyricPersistencePort.Intent(operation, "netease", "1001", "", "revision", 0L,
                "transition", operation == LyricPersistencePort.Operation.SET ? "source-1" : null, offsetMs);
    }

    private static String repeat(char value, int length) {
        StringBuilder builder = new StringBuilder(length);
        for (int index = 0; index < length; index += 1) builder.append(value);
        return builder.toString();
    }
}
