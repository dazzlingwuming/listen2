package com.dazzlingwuming.listen2;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import org.junit.Test;
import static org.junit.Assert.*;

public final class PlaylistShuffleOrderTest {
    @Test public void firstRoundCountsCurrentAndCompleteRoundsNeverRepeatOrTouchAtTheBoundary() {
        Set<String> tracks = new LinkedHashSet<>();
        for (int i = 0; i < 746; i++) tracks.add("occ-" + i);
        PlaylistShuffleOrder order = new PlaylistShuffleOrder(new Random(42));
        String current = "occ-0";
        order.reset(tracks, current);
        Set<String> first = new LinkedHashSet<>(); first.add(current);
        for (int i = 1; i < tracks.size(); i++) {
            current = order.next(tracks, current); assertTrue(first.add(current));
        }
        assertEquals(tracks, first);
        List<String> previous = null;
        for (int round = 0; round < 4; round++) {
            List<String> cycle = new ArrayList<>();
            for (int i = 0; i < tracks.size(); i++) {
                String next = order.next(tracks, current);
                assertNotEquals(current, next); current = next; cycle.add(next);
            }
            assertEquals(tracks, new LinkedHashSet<>(cycle));
            if (previous != null) assertNotEquals(previous, cycle);
            previous = cycle;
        }
    }

    @Test public void processRestartContinuesTheRemainingRoundInExactlyTheSameOrder() {
        Set<String> tracks = new LinkedHashSet<>(Arrays.asList("a", "b", "c", "d", "e"));
        PlaylistShuffleOrder running = new PlaylistShuffleOrder(new Random(42));
        running.reset(tracks, "a");
        String current = running.next(tracks, "a");
        PlaylistShuffleOrder restored = new PlaylistShuffleOrder(new Random(99));
        restored.restore(running.checkpointOrder(), running.checkpointCursor());
        for (int i = 0; i < 3; i++) {
            String next = running.next(tracks, current);
            assertEquals(next, restored.next(tracks, current)); current = next;
        }
    }

    @Test public void tinyPlaylistsContinueAndDeletedSongsAreSkipped() {
        PlaylistShuffleOrder order = new PlaylistShuffleOrder(new Random(1));
        Set<String> one = new LinkedHashSet<>(Arrays.asList("a"));
        order.reset(one, "a"); assertEquals("a", order.next(one, "a"));
        Set<String> two = new LinkedHashSet<>(Arrays.asList("a", "b"));
        order.reset(two, "a");
        assertEquals("b", order.next(two, "a"));
        assertEquals("a", order.next(two, "b"));
        assertEquals("b", order.next(two, "a"));
        two.remove("a"); assertEquals("b", order.next(two, "b"));
    }

    @Test public void identicalFullRoundIsAdjustedLikeTheDesktopAlgorithm() {
        PlaylistShuffleOrder order = new PlaylistShuffleOrder(new Random() {
            @Override public int nextInt(int bound) { return bound - 1; }
        });
        Set<String> tracks = new LinkedHashSet<>(Arrays.asList("a", "b", "c", "d"));
        order.reset(tracks, "d");
        String current = "d";
        for (int i = 0; i < 3; i++) current = order.next(tracks, current);
        List<String> first = new ArrayList<>(), second = new ArrayList<>();
        for (int i = 0; i < 4; i++) { current = order.next(tracks, current); first.add(current); }
        for (int i = 0; i < 4; i++) { current = order.next(tracks, current); second.add(current); }
        assertNotEquals(first, second);
        assertEquals(tracks, new LinkedHashSet<>(second));
    }
}
