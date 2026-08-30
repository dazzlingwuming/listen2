package com.dazzlingwuming.listen2;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Deterministic product queue semantics that deliberately stay above the
 * Media3 timeline. This class is Android-free so every accepted transition can
 * be replayed from its checkpoint before a player projection is attempted.
 */
public final class PlaybackQueueEngine {
    static final int MAX_BASE_OCCURRENCES = 1_000;
    static final int MAX_QUEUE_OCCURRENCES = 500;
    private static final int MAX_TOKEN_LENGTH = 96;
    private static final int MAX_RECORDED_TOKENS = 64;

    public enum Mode { SEQUENTIAL, SHUFFLE, REPEAT_ONE, REPEAT_ALL }

    public interface OccurrenceIdSource {
        String nextId();
    }

    public interface Clock {
        long nowMs();
    }

    public interface RandomSource {
        int nextInt(int bound);
    }

    private final OccurrenceIdSource idSource;
    private final Clock clock;
    private final RandomSource random;
    private State state;

    public PlaybackQueueEngine(List<Track> baseTracks, int initialBaseIndex, Mode initialMode,
            OccurrenceIdSource idSource, Clock clock, RandomSource random) {
        if (baseTracks == null || baseTracks.isEmpty() || baseTracks.size() > MAX_BASE_OCCURRENCES
                || initialMode == null || idSource == null || clock == null || random == null) {
            throw new IllegalArgumentException("invalid queue engine input");
        }
        this.idSource = idSource;
        this.clock = clock;
        this.random = random;
        List<Occurrence> base = new ArrayList<>();
        for (Track track : baseTracks) base.add(newOccurrence("base", track));
        if (initialBaseIndex < 0 || initialBaseIndex >= base.size()
                || !base.get(initialBaseIndex).isPlayable()) {
            throw new IllegalArgumentException("initial occurrence must be playable");
        }
        Occurrence initial = base.get(initialBaseIndex);
        List<HistoryEntry> history = Collections.singletonList(new HistoryEntry(initial, clock.nowMs()));
        this.state = new State(0L, base, initial, initial, Collections.<Occurrence>emptyList(), initialMode,
                initialMode, false, history, 0, Collections.<Occurrence>emptyList(), 0,
                Collections.<String, Long>emptyMap());
    }

    private PlaybackQueueEngine(State restored, OccurrenceIdSource idSource, Clock clock,
            RandomSource random) {
        if (restored == null || idSource == null || clock == null || random == null) {
            throw new IllegalArgumentException("invalid restored queue engine");
        }
        this.state = restored;
        this.idSource = idSource;
        this.clock = clock;
        this.random = random;
    }

    public static PlaybackQueueEngine restore(Checkpoint checkpoint, OccurrenceIdSource idSource,
            Clock clock, RandomSource random) {
        if (checkpoint == null) throw new IllegalArgumentException("checkpoint required");
        return new PlaybackQueueEngine(checkpoint.toState(), idSource, clock, random);
    }

    public State getState() {
        return state;
    }

    public Checkpoint checkpoint() {
        return new Checkpoint(state);
    }

    public Transition enqueueNext(long expectedRevision, Track track) {
        Transition validation = validateRevision(expectedRevision);
        if (validation != null) return validation;
        if (track == null || !track.isValid()) return rejected("INVALID_TRACK");
        if (state.queue.size() >= MAX_QUEUE_OCCURRENCES) return rejected("QUEUE_FULL");
        List<Occurrence> queue = copy(state.queue);
        queue.add(newOccurrence("queue", track));
        return accept(state.with(state.revision + 1L, null, queue, null, null, null, null, null,
                null, null, null));
    }

    public Transition reorder(long expectedRevision, String occurrenceId, int targetIndex) {
        Transition validation = validateRevision(expectedRevision);
        if (validation != null) return validation;
        int fromIndex = indexOf(state.queue, occurrenceId);
        if (fromIndex < 0) return rejected("UNKNOWN_OCCURRENCE");
        if (targetIndex < 0 || targetIndex >= state.queue.size()) return rejected("INVALID_TARGET_INDEX");
        List<Occurrence> queue = copy(state.queue);
        Occurrence moved = queue.remove(fromIndex);
        queue.add(targetIndex, moved);
        return accept(state.with(state.revision + 1L, null, queue, null, null, null, null, null,
                null, null, null));
    }

    public Transition remove(long expectedRevision, String occurrenceId) {
        Transition validation = validateRevision(expectedRevision);
        if (validation != null) return validation;
        int index = indexOf(state.queue, occurrenceId);
        if (index < 0) return rejected("UNKNOWN_OCCURRENCE");
        List<Occurrence> queue = copy(state.queue);
        queue.remove(index);
        return accept(state.with(state.revision + 1L, null, queue, null, null, null, null, null,
                null, null, null));
    }

    public Transition clear(long expectedRevision) {
        Transition validation = validateRevision(expectedRevision);
        if (validation != null) return validation;
        Mode restoredMode = state.queueContextActive ? state.modeBeforeQueue : state.mode;
        return accept(state.with(state.revision + 1L, null, Collections.<Occurrence>emptyList(), restoredMode,
                state.modeBeforeQueue, false, null, null, null, null, null));
    }

    public Transition setMode(long expectedRevision, Mode mode) {
        Transition validation = validateRevision(expectedRevision);
        if (validation != null) return validation;
        if (mode == null) return rejected("INVALID_MODE");
        List<Occurrence> freshShuffle = Collections.emptyList();
        if (mode == Mode.SHUFFLE) freshShuffle = shuffledInitialRound(state.current);
        Mode savedMode = state.queueContextActive ? state.modeBeforeQueue : mode;
        return accept(state.with(state.revision + 1L, null, null, mode, savedMode, null, null,
                freshShuffle, 0, null, null));
    }

    /** All next-capable surfaces call this same token-idempotent transition. */
    public Transition next(long expectedRevision, String transitionToken) {
        if (!isToken(transitionToken)) return rejected("INVALID_TRANSITION_TOKEN");
        Long acceptedRevision = state.acceptedTokens.get(transitionToken);
        if (acceptedRevision != null) return Transition.idempotent(acceptedRevision.longValue(), state);
        Transition validation = validateRevision(expectedRevision);
        if (validation != null) return validation;
        if (state.mode == Mode.REPEAT_ONE) return recordTokenWithoutMovement(transitionToken);

        if (state.historyCursor + 1 < state.history.size()) {
            Occurrence historical = state.history.get(state.historyCursor + 1).occurrence;
            State advanced = state.with(state.revision + 1L, historical, null, null, null, null,
                    state.history, state.shuffleOrder, state.shuffleNextIndex, state.historyCursor + 1,
                    recordToken(transitionToken, state.revision + 1L));
            return accept(advanced);
        }

        if (!state.queue.isEmpty()) return consumeQueue(transitionToken);
        return advanceBase(transitionToken);
    }

    public Transition onNaturalEnd(long expectedRevision, String transitionToken) {
        return next(expectedRevision, transitionToken);
    }

    public Transition previous(long expectedRevision) {
        Transition validation = validateRevision(expectedRevision);
        if (validation != null) return validation;
        if (state.historyCursor <= 0) return rejected("NO_PREVIOUS_HISTORY");
        Occurrence previous = state.history.get(state.historyCursor - 1).occurrence;
        return accept(state.with(state.revision + 1L, previous, null, null, null, null, state.history,
                state.shuffleOrder, state.shuffleNextIndex, state.historyCursor - 1, null));
    }

    /** A retry is a new accepted state revision but never advances queue or history. */
    public Transition retry(long expectedRevision) {
        Transition validation = validateRevision(expectedRevision);
        if (validation != null) return validation;
        return accept(state.with(state.revision + 1L, null, null, null, null, null, null, null,
                null, null, null));
    }

    /** A terminal media failure remains actionable on the same occurrence; it never auto-skips. */
    public Transition onTerminalFailure(long expectedRevision) {
        return retry(expectedRevision);
    }

    private Transition recordTokenWithoutMovement(String transitionToken) {
        long nextRevision = state.revision + 1L;
        return accept(state.with(nextRevision, null, null, null, null, null, null, null, null, null,
                recordToken(transitionToken, nextRevision)));
    }

    private Transition consumeQueue(String transitionToken) {
        List<Occurrence> queue = copy(state.queue);
        Occurrence selected = queue.remove(0);
        boolean lastQueueOccurrence = queue.isEmpty();
        Mode restoredMode = lastQueueOccurrence ? state.modeBeforeQueue : state.mode;
        boolean queueContextActive = !lastQueueOccurrence;
        Mode rememberedMode = state.queueContextActive ? state.modeBeforeQueue : state.mode;
        List<HistoryEntry> history = appendHistory(selected);
        long nextRevision = state.revision + 1L;
        return accept(state.with(nextRevision, selected, queue, restoredMode, rememberedMode,
                queueContextActive, history, null, null, history.size() - 1,
                recordToken(transitionToken, nextRevision)));
    }

    private Transition advanceBase(String transitionToken) {
        BaseAdvance advance = findBaseAdvance();
        if (advance == null) return rejected("NO_PLAYABLE_NEXT");
        List<HistoryEntry> history = appendHistory(advance.occurrence);
        long nextRevision = state.revision + 1L;
        return accept(state.with(nextRevision, advance.occurrence, null, null, null, false, history,
                advance.shuffleOrder, advance.shuffleNextIndex, history.size() - 1,
                recordToken(transitionToken, nextRevision)));
    }

    private BaseAdvance findBaseAdvance() {
        if (state.mode == Mode.SHUFFLE) return nextShuffle();
        int currentIndex = indexOf(state.basePlaylist, state.current.getOccurrenceId());
        if (currentIndex < 0) currentIndex = indexOf(state.basePlaylist, state.baseCurrent.getOccurrenceId());
        if (currentIndex < 0) currentIndex = 0;
        int candidate = nextPlayableIndex(currentIndex, state.mode == Mode.REPEAT_ALL);
        return candidate < 0 ? null : new BaseAdvance(state.basePlaylist.get(candidate),
                state.shuffleOrder, state.shuffleNextIndex);
    }

    private BaseAdvance nextShuffle() {
        List<Occurrence> order = state.shuffleOrder;
        int nextIndex = state.shuffleNextIndex;
        if (nextIndex >= order.size()) {
            order = shuffledFullRound(state.current);
            nextIndex = 0;
        }
        if (order.isEmpty()) return null;
        Occurrence selected = order.get(nextIndex);
        return new BaseAdvance(selected, order, nextIndex + 1);
    }

    private List<Occurrence> shuffledInitialRound(Occurrence current) {
        List<Occurrence> playable = new ArrayList<>();
        for (Occurrence occurrence : state.basePlaylist) {
            if (occurrence.isPlayable() && !occurrence.getOccurrenceId().equals(current.getOccurrenceId())) {
                playable.add(occurrence);
            }
        }
        fisherYates(playable);
        return playable;
    }

    private List<Occurrence> shuffledFullRound(Occurrence current) {
        List<Occurrence> playable = new ArrayList<>();
        for (Occurrence occurrence : state.basePlaylist) {
            if (occurrence.isPlayable()) playable.add(occurrence);
        }
        fisherYates(playable);
        if (playable.size() > 1 && playable.get(0).getOccurrenceId().equals(current.getOccurrenceId())) {
            for (int index = 1; index < playable.size(); index += 1) {
                if (!playable.get(index).getOccurrenceId().equals(current.getOccurrenceId())) {
                    Occurrence first = playable.get(0);
                    playable.set(0, playable.get(index));
                    playable.set(index, first);
                    break;
                }
            }
        }
        return playable;
    }

    private void fisherYates(List<Occurrence> items) {
        for (int index = items.size() - 1; index > 0; index -= 1) {
            int swapIndex = random.nextInt(index + 1);
            if (swapIndex < 0 || swapIndex > index) throw new IllegalStateException("invalid random source");
            Occurrence item = items.get(index);
            items.set(index, items.get(swapIndex));
            items.set(swapIndex, item);
        }
    }

    private int nextPlayableIndex(int currentIndex, boolean wraps) {
        for (int offset = 1; offset <= state.basePlaylist.size(); offset += 1) {
            int index = currentIndex + offset;
            if (index >= state.basePlaylist.size()) {
                if (!wraps) return -1;
                index %= state.basePlaylist.size();
            }
            if (state.basePlaylist.get(index).isPlayable()) return index;
        }
        return -1;
    }

    private List<HistoryEntry> appendHistory(Occurrence selected) {
        List<HistoryEntry> history = new ArrayList<>();
        for (int index = 0; index <= state.historyCursor; index += 1) history.add(state.history.get(index));
        history.add(new HistoryEntry(selected, clock.nowMs()));
        return history;
    }

    private Transition validateRevision(long expectedRevision) {
        return expectedRevision == state.revision ? null : rejected("STALE_REVISION");
    }

    private Transition accept(State accepted) {
        state = accepted;
        return Transition.accepted(accepted.revision, accepted);
    }

    private Transition rejected(String code) {
        return Transition.rejected(code, state.revision, state);
    }

    private Occurrence newOccurrence(String prefix, Track track) {
        String suffix = idSource.nextId();
        if (!isSafeId(suffix)) throw new IllegalStateException("invalid occurrence id source");
        return new Occurrence(prefix + "-" + suffix, track.getTrackHandle(), track.isPlayable());
    }

    private Map<String, Long> recordToken(String token, long acceptedRevision) {
        Map<String, Long> tokens = new LinkedHashMap<>(state.acceptedTokens);
        tokens.put(token, acceptedRevision);
        while (tokens.size() > MAX_RECORDED_TOKENS) tokens.remove(tokens.keySet().iterator().next());
        return tokens;
    }

    private static boolean isToken(String value) {
        return value != null && value.length() > 0 && value.length() <= MAX_TOKEN_LENGTH && isSafeId(value);
    }

    private static boolean isSafeId(String value) {
        if (value == null || value.length() == 0 || value.length() > 128) return false;
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (!((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z')
                    || (character >= '0' && character <= '9') || character == '-' || character == '_'
                    || character == '.')) return false;
        }
        return true;
    }

    private static int indexOf(List<Occurrence> occurrences, String occurrenceId) {
        if (occurrenceId == null) return -1;
        for (int index = 0; index < occurrences.size(); index += 1) {
            if (occurrenceId.equals(occurrences.get(index).getOccurrenceId())) return index;
        }
        return -1;
    }

    private static List<Occurrence> copy(List<Occurrence> occurrences) {
        return new ArrayList<>(occurrences);
    }

    private static final class BaseAdvance {
        private final Occurrence occurrence;
        private final List<Occurrence> shuffleOrder;
        private final int shuffleNextIndex;

        BaseAdvance(Occurrence occurrence, List<Occurrence> shuffleOrder, int shuffleNextIndex) {
            this.occurrence = occurrence;
            this.shuffleOrder = shuffleOrder;
            this.shuffleNextIndex = shuffleNextIndex;
        }
    }

    public static final class Track {
        private final String trackHandle;
        private final boolean playable;

        public Track(String trackHandle, boolean playable) {
            this.trackHandle = trackHandle;
            this.playable = playable;
        }

        public String getTrackHandle() {
            return trackHandle;
        }

        public boolean isPlayable() {
            return playable;
        }

        boolean isValid() {
            return isSafeId(trackHandle);
        }
    }

    public static final class Occurrence {
        private final String occurrenceId;
        private final String trackHandle;
        private final boolean playable;

        Occurrence(String occurrenceId, String trackHandle, boolean playable) {
            this.occurrenceId = occurrenceId;
            this.trackHandle = trackHandle;
            this.playable = playable;
        }

        public String getOccurrenceId() {
            return occurrenceId;
        }

        public String getTrackHandle() {
            return trackHandle;
        }

        public boolean isPlayable() {
            return playable;
        }
    }

    public static final class HistoryEntry {
        private final Occurrence occurrence;
        private final long acceptedAtMs;

        HistoryEntry(Occurrence occurrence, long acceptedAtMs) {
            this.occurrence = occurrence;
            this.acceptedAtMs = acceptedAtMs;
        }

        public Occurrence getOccurrence() {
            return occurrence;
        }

        public long getAcceptedAtMs() {
            return acceptedAtMs;
        }
    }

    public static final class State {
        private final long revision;
        private final List<Occurrence> basePlaylist;
        private final Occurrence baseCurrent;
        private final Occurrence current;
        private final List<Occurrence> queue;
        private final Mode mode;
        private final Mode modeBeforeQueue;
        private final boolean queueContextActive;
        private final List<HistoryEntry> history;
        private final int historyCursor;
        private final List<Occurrence> shuffleOrder;
        private final int shuffleNextIndex;
        private final Map<String, Long> acceptedTokens;

        State(long revision, List<Occurrence> basePlaylist, Occurrence baseCurrent, Occurrence current,
                List<Occurrence> queue, Mode mode, Mode modeBeforeQueue, boolean queueContextActive,
                List<HistoryEntry> history, int historyCursor, List<Occurrence> shuffleOrder,
                int shuffleNextIndex, Map<String, Long> acceptedTokens) {
            this.revision = revision;
            this.basePlaylist = immutable(basePlaylist);
            this.baseCurrent = baseCurrent;
            this.current = current;
            this.queue = immutable(queue);
            this.mode = mode;
            this.modeBeforeQueue = modeBeforeQueue;
            this.queueContextActive = queueContextActive;
            this.history = Collections.unmodifiableList(new ArrayList<>(history));
            this.historyCursor = historyCursor;
            this.shuffleOrder = immutable(shuffleOrder);
            this.shuffleNextIndex = shuffleNextIndex;
            this.acceptedTokens = Collections.unmodifiableMap(new LinkedHashMap<>(acceptedTokens));
        }

        State with(long revision, Occurrence current, List<Occurrence> queue, Mode mode,
                Mode modeBeforeQueue, Boolean queueContextActive, List<HistoryEntry> history,
                List<Occurrence> shuffleOrder, Integer shuffleNextIndex, Integer historyCursor,
                Map<String, Long> acceptedTokens) {
            Occurrence nextCurrent = current == null ? getCurrent() : current;
            return new State(revision, basePlaylist, baseCurrent, nextCurrent,
                    queue == null ? this.queue : queue,
                    mode == null ? this.mode : mode,
                    modeBeforeQueue == null ? this.modeBeforeQueue : modeBeforeQueue,
                    queueContextActive == null ? this.queueContextActive : queueContextActive.booleanValue(),
                    history == null ? this.history : history,
                    historyCursor == null ? this.historyCursor : historyCursor.intValue(),
                    shuffleOrder == null ? this.shuffleOrder : shuffleOrder,
                    shuffleNextIndex == null ? this.shuffleNextIndex : shuffleNextIndex.intValue(),
                    acceptedTokens == null ? this.acceptedTokens : acceptedTokens);
        }

        public long getRevision() {
            return revision;
        }

        public List<Occurrence> getBasePlaylist() {
            return basePlaylist;
        }

        public List<Occurrence> getQueue() {
            return queue;
        }

        public Mode getMode() {
            return mode;
        }

        public boolean isQueueContextActive() {
            return queueContextActive;
        }

        public List<HistoryEntry> getHistory() {
            return history;
        }

        public int getHistoryCursor() {
            return historyCursor;
        }

        public Occurrence getCurrent() {
            return current;
        }

        private static List<Occurrence> immutable(List<Occurrence> values) {
            return Collections.unmodifiableList(new ArrayList<>(values));
        }
    }

    public static final class Transition {
        private final boolean accepted;
        private final boolean idempotent;
        private final String code;
        private final long revision;
        private final State state;

        private Transition(boolean accepted, boolean idempotent, String code, long revision, State state) {
            this.accepted = accepted;
            this.idempotent = idempotent;
            this.code = code;
            this.revision = revision;
            this.state = state;
        }

        static Transition accepted(long revision, State state) {
            return new Transition(true, false, "ACCEPTED", revision, state);
        }

        static Transition idempotent(long revision, State state) {
            return new Transition(true, true, "IDEMPOTENT", revision, state);
        }

        static Transition rejected(String code, long revision, State state) {
            return new Transition(false, false, code, revision, state);
        }

        public boolean isAccepted() {
            return accepted;
        }

        public boolean isIdempotent() {
            return idempotent;
        }

        public String getCode() {
            return code;
        }

        public long getRevision() {
            return revision;
        }

        public State getState() {
            return state;
        }
    }

    public static final class Checkpoint {
        private final State state;

        Checkpoint(State state) {
            this.state = state;
        }

        State toState() {
            return state;
        }
    }

    /** Deterministic test source; production supplies an opaque secure source. */
    public static final class IncrementingIdSource implements OccurrenceIdSource {
        private final String prefix;
        private long sequence;

        public IncrementingIdSource(String prefix) {
            if (!isSafeId(prefix)) throw new IllegalArgumentException("invalid id prefix");
            this.prefix = prefix;
        }

        @Override
        public String nextId() {
            sequence += 1L;
            return prefix + "-" + Long.toString(sequence, 36);
        }
    }

    /** Deterministic test random source; production supplies a bounded random source. */
    public static final class SequenceRandom implements RandomSource {
        private long state;

        public SequenceRandom(long seed) {
            this.state = seed;
        }

        @Override
        public int nextInt(int bound) {
            if (bound <= 0) throw new IllegalArgumentException("bound must be positive");
            state = state * 1_103_515_245L + 12_345L;
            long candidate = state & 0x7fffffffL;
            return (int) (candidate % bound);
        }
    }
}
