package com.dazzlingwuming.listen2;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.Set;

/** Native equivalent of player_thread.js buildShuffleQueue: Fisher-Yates, complete rounds,
 * no boundary repeat, and no identical consecutive rounds when there are > 2 tracks. */
final class PlaylistShuffleOrder {
    private final Random random;
    private List<String> order = new ArrayList<>();
    private int cursor;

    PlaylistShuffleOrder(Random random) { this.random = random; }

    void reset(Set<String> playable, String current) {
        order = new ArrayList<>(playable);
        order.remove(current); // The currently playing song counts toward the first round.
        shuffle(order);
        cursor = 0;
    }

    String next(Set<String> playable, String current) {
        while (cursor < order.size()) {
            String candidate = order.get(cursor++);
            if (playable.contains(candidate)) return candidate;
        }
        List<String> previous = order;
        order = new ArrayList<>(playable);
        shuffle(order);
        if (order.size() > 1 && order.get(0).equals(current)) {
            Collections.swap(order, 0, 1 + random.nextInt(order.size() - 1));
        }
        if (order.size() > 2 && order.equals(previous)) Collections.swap(order, order.size() - 1, order.size() - 2);
        cursor = 0;
        return order.isEmpty() ? null : order.get(cursor++);
    }

    List<String> remaining(Set<String> playable) {
        List<String> result = new ArrayList<>();
        for (int i = cursor; i < order.size(); i++) if (playable.contains(order.get(i))) result.add(order.get(i));
        return result;
    }

    List<String> checkpointOrder() { return new ArrayList<>(order); }
    int checkpointCursor() { return cursor; }
    void restore(List<String> saved, int nextIndex) {
        order = new ArrayList<>(saved);
        cursor = Math.max(0, Math.min(nextIndex, order.size()));
    }

    private void shuffle(List<String> values) {
        for (int i = values.size() - 1; i > 0; i--) Collections.swap(values, i, random.nextInt(i + 1));
    }
}
