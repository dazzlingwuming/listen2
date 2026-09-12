const mockPick = jest.fn();

jest.mock('@react-native-documents/picker', () => ({
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: (error: unknown) =>
    Boolean(error && typeof error === 'object' && 'code' in error),
  pick: (...args: unknown[]) => mockPick(...args),
  types: { audio: 'audio/*' },
}));

import {
  MAX_LOCAL_AUDIO_IMPORTS,
  convertPickedLocalAudio,
  isPickerCancellation,
  pickLocalAudio,
} from '../picker';

function picked(overrides: Record<string, unknown> = {}) {
  return {
    uri: 'content://provider/audio-1',
    name: 'Song One.mp3',
    error: null,
    type: 'audio/mpeg',
    nativeType: 'audio/mpeg',
    size: 1,
    isVirtual: false,
    convertibleToMimeTypes: null,
    hasRequestedType: true,
    bookmarkStatus: 'success' as const,
    ...overrides,
  };
}

describe('local audio picker conversion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps only persistable content audio and de-duplicates URI selections', () => {
    const result = convertPickedLocalAudio([
      picked(),
      picked({ name: 'Duplicate.mp3' }),
      picked({ uri: 'file:///tmp/not-persistable.mp3' }),
      picked({ uri: `content://provider/${'a'.repeat(4_100)}` }),
      picked({ uri: 'content://provider/line\nbreak' }),
      picked({ uri: 'content://provider/virtual', isVirtual: true }),
      picked({ uri: 'content://provider/error', error: 'metadata failed' }),
      picked({ uri: 'content://provider/no-access', bookmarkStatus: 'error' }),
      picked({
        uri: 'content://provider/not-audio',
        type: 'text/plain',
        name: 'x.txt',
      }),
    ] as any);

    expect(result).toMatchObject({ rejected: 8 });
    expect(result.tracks).toEqual([
      expect.objectContaining({
        source: 'local',
        contentUri: 'content://provider/audio-1',
        title: 'Song One',
        fileName: 'Song One.mp3',
        mimeType: 'audio/mpeg',
      }),
    ]);
  });

  it('bounds a single picker result to 500 files', () => {
    const documents = Array.from(
      { length: MAX_LOCAL_AUDIO_IMPORTS + 1 },
      (_, index) =>
        picked({
          uri: `content://provider/audio-${index}`,
          name: `Song ${index}.mp3`,
        }),
    );
    const result = convertPickedLocalAudio(documents as any);
    expect(result.tracks).toHaveLength(MAX_LOCAL_AUDIO_IMPORTS);
    expect(result.rejected).toBe(1);
  });

  it('treats picker cancellation as a no-op and uses persistable open mode', async () => {
    const cancelled = Object.assign(new Error('cancelled'), {
      code: 'OPERATION_CANCELED',
    });
    mockPick.mockRejectedValueOnce(cancelled);

    await expect(pickLocalAudio()).resolves.toEqual({
      status: 'cancelled',
      tracks: [],
      rejected: 0,
    });
    expect(mockPick).toHaveBeenCalledWith({
      mode: 'open',
      type: ['audio/*'],
      allowMultiSelection: true,
      requestLongTermAccess: true,
    });
    expect(isPickerCancellation(cancelled)).toBe(true);
  });
});
