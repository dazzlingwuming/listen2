jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {},
  Capability: {},
  RepeatMode: {},
  State: {},
}));

import { PLAY_MODE } from '../playerSlice';
import { migratePlayerState, sanitizePlayerState } from '../playerPersistence';

const track = (id: string) => ({
  id,
  source: 'netease',
  title: id,
  artist: 'Listen2',
});

describe('player persistence migration', () => {
  it('upgrades legacy play-next tracks into distinct occurrences and restores paused', () => {
    const legacy = track('ne_1');
    const result = migratePlayerState({
      playlist: [legacy],
      tracks: [legacy],
      queue: [legacy],
      currentTrack: legacy,
      nowPlaying: legacy,
      currentIndex: 0,
      currentSource: 'playlist',
      playNextQueue: [legacy, legacy],
      history: [],
      playMode: PLAY_MODE.SHUFFLE,
      shuffleOrder: [0],
      shuffleCursor: 0,
      isPlaying: true,
      position: 42,
      duration: 99,
      bufferedPosition: 44,
      volume: 0.5,
      muted: false,
      error: null,
    });

    expect(result.playNextQueue.map(item => item.track.id)).toEqual([
      'ne_1',
      'ne_1',
    ]);
    expect(result.playNextQueue[0].occurrenceId).not.toBe(
      result.playNextQueue[1].occurrenceId,
    );
    expect(result.isPlaying).toBe(false);
    expect(result.position).toBe(42);
    expect(result.history).toEqual([]);
  });

  it('preserves the current track after its accepted play-next occurrence was consumed', () => {
    const queued = track('ne_queued');
    const result = sanitizePlayerState({
      playlist: [track('ne_1')],
      currentTrack: queued,
      currentIndex: 0,
      currentSource: 'play-next',
      currentOccurrenceId: 'play-next-accepted',
      playNextQueue: [],
      volume: 1,
    });
    expect(result.currentTrack).toEqual(queued);
    expect(result.nowPlaying).toEqual(queued);
    expect(result.currentSource).toBe('play-next');
    expect(result.currentOccurrenceId).toBe('play-next-accepted');
    expect(result.currentIndex).toBe(0);
  });

  it('drops transport-shaped or malformed state while preserving bounded semantics', () => {
    const result = sanitizePlayerState({
      playlist: [
        {
          ...track('ne_1'),
          url: 'https://signed.example/audio?secret=1',
          headers: { Cookie: 'secret' },
          nativeId: 'rntp-12',
        },
      ],
      currentTrack: track('ne_1'),
      nowPlaying: track('ne_1'),
      currentIndex: 99,
      currentSource: 'invalid',
      currentOccurrenceId: 'not-a-real-occurrence',
      playNextQueue: [
        { occurrenceId: 'safe-a', track: track('ne_2') },
        { occurrenceId: 'safe-a', track: track('ne_3') },
        { occurrenceId: 'bad', track: { id: '', source: 'netease' } },
      ],
      history: [
        {
          track: track('ne_1'),
          playlistIndex: 0,
          source: 'playlist',
          position: 8,
        },
        {
          track: { id: '', source: 'netease' },
          playlistIndex: 1,
          source: 'playlist',
        },
      ],
      playMode: 999,
      shuffleOrder: [0, 0, 8],
      shuffleCursor: 8,
      isPlaying: true,
      position: -10,
      duration: Number.POSITIVE_INFINITY,
      bufferedPosition: -1,
      volume: 10,
      muted: 'yes',
      transitionToken: 100,
      acceptedTransitionToken: 99,
    });

    expect(result.playlist).toEqual([track('ne_1')]);
    expect(JSON.stringify(result)).not.toContain('https://signed.example');
    expect(JSON.stringify(result)).not.toContain('Cookie');
    expect(JSON.stringify(result)).not.toContain('rntp-12');
    expect(result.currentIndex).toBe(-1);
    expect(result.currentTrack).toBeNull();
    expect(result.playNextQueue).toHaveLength(2);
    expect(
      new Set(result.playNextQueue.map(item => item.occurrenceId)).size,
    ).toBe(2);
    expect(result.history).toHaveLength(1);
    expect(result.playMode).toBe(PLAY_MODE.LOOP);
    expect(result.shuffleOrder).toEqual([0]);
    expect(result.shuffleCursor).toBe(-1);
    expect(result.isPlaying).toBe(false);
    expect(result.position).toBe(0);
    expect(result.duration).toBe(0);
    expect(result.volume).toBe(1);
    expect(result.muted).toBe(false);
    expect(result.transitionToken).toBe(0);
  });

  it('preserves play-next history identity even after its FIFO occurrence was consumed', () => {
    const queued = track('ne_queued');
    const result = sanitizePlayerState({
      playlist: [track('ne_1')],
      history: [
        {
          track: queued,
          playlistIndex: -1,
          source: 'play-next',
          occurrenceId: 'play-next-consumed',
          position: 18,
        },
      ],
      playNextQueue: [],
      currentTrack: queued,
      currentIndex: 0,
      currentSource: 'play-next',
      currentOccurrenceId: 'play-next-consumed',
      position: 18,
      shuffleOrder: [0],
      shuffleCursor: 0,
    });

    expect(result.history).toEqual([
      {
        track: queued,
        playlistIndex: -1,
        source: 'play-next',
        occurrenceId: 'play-next-consumed',
        position: 18,
      },
    ]);
    expect(result.currentOccurrenceId).toBe('play-next-consumed');
  });

  it('keeps only finite bounded progress and a cursor that belongs to the restored order', () => {
    const result = sanitizePlayerState({
      playlist: [track('ne_1'), track('ne_2')],
      currentTrack: track('ne_1'),
      nowPlaying: track('ne_1'),
      currentIndex: 0,
      currentSource: 'playlist',
      position: Number.POSITIVE_INFINITY,
      shuffleOrder: [1, 0],
      shuffleCursor: 1,
    });

    expect(result.position).toBe(0);
    expect(Number.isFinite(result.position)).toBe(true);
    expect(result.shuffleOrder).toEqual([1, 0]);
    expect(result.shuffleCursor).toBe(1);
  });
});
