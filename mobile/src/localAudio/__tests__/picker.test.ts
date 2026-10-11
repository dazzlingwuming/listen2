const mockImportAudio = jest.fn();
const mockRepairLocalAudio = jest.fn();
const mockRemoveLocalAudio = jest.fn();
const mockPrepareLocalPlayback = jest.fn();
const mockVerifyLocalPlayback = jest.fn();
const mockEndLocalPlayback = jest.fn();
jest.mock('react-native', () => ({ NativeModules: { Listen2LocalAudio: { importAudio: (...args: unknown[]) => mockImportAudio(...args), repairLocalAudio: (...args: unknown[]) => mockRepairLocalAudio(...args), removeLocalAudio: (...args: unknown[]) => mockRemoveLocalAudio(...args), prepareLocalPlayback: (...args: unknown[]) => mockPrepareLocalPlayback(...args), verifyLocalPlayback: (...args: unknown[]) => mockVerifyLocalPlayback(...args), endLocalPlayback: (...args: unknown[]) => mockEndLocalPlayback(...args) } } }));
import { pickLocalAudio, removeLocalAudio, repairLocalAudio, prepareLocalPlayback, verifyLocalPlayback, endLocalPlayback } from '../picker';

describe('opaque native local picker', () => {
  it('accepts only a matching safe native receipt', async () => {
    mockImportAudio.mockImplementationOnce((requestId: string) => Promise.resolve({ requestId, status: 'success', imported: 2, duplicates: 0, unsupported: 1, unreadable: 0, cancelled: 0, records: [] }));
    const result = await pickLocalAudio();
    expect(result).toEqual({ status: 'success', imported: 2, rejected: 1 });
  });

  it('accepts only the matching opaque repair and removal receipts', async () => {
    const recordId = '11111111-1111-4111-8111-111111111111';
    mockRepairLocalAudio.mockImplementationOnce((id: string, requestId: string) => Promise.resolve({ requestId, recordId: id, status: 'repaired' }));
    mockRemoveLocalAudio.mockImplementationOnce((id: string, requestId: string) => Promise.resolve({ requestId, recordId: id, status: 'repaired' }));

    await expect(repairLocalAudio(recordId)).resolves.toBe('repaired');
    await expect(removeLocalAudio(recordId)).resolves.toBe('repaired');
  });

  it('verifies access without preparing or ending a playback lease and rejects extra private fields', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    mockVerifyLocalPlayback.mockImplementationOnce((recordId: string, playbackRequestId: string) => Promise.resolve({ recordId, playbackRequestId, status: 'success' }));
    await expect(verifyLocalPlayback(id)).resolves.toBe(true);
    expect(mockPrepareLocalPlayback).not.toHaveBeenCalled();
    expect(mockEndLocalPlayback).not.toHaveBeenCalled();
    mockVerifyLocalPlayback.mockImplementationOnce((recordId: string, playbackRequestId: string) => Promise.resolve({ recordId, playbackRequestId, status: 'success', privatePlaybackUri: 'must-not-cross-probe' }));
    await expect(verifyLocalPlayback(id)).resolves.toBe(false);
    await expect(verifyLocalPlayback('foreign-content-id')).resolves.toBe(false);
  });

  it('accepts only exact native-owned playback receipts and fixed release status', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const uri = 'content://com.dazzlingwuming.listen2.local-media/play/' + 'a'.repeat(48);
    mockPrepareLocalPlayback.mockImplementationOnce((recordId: string, playbackRequestId: string) => Promise.resolve({ recordId, playbackRequestId, status: 'success', privatePlaybackUri: uri, seekable: true }));
    await expect(prepareLocalPlayback(id)).resolves.toEqual({ privatePlaybackUri: uri, playbackRequestId: expect.stringMatching(/^local_play_/), seekable: true });
    mockPrepareLocalPlayback.mockImplementationOnce((recordId: string, playbackRequestId: string) => Promise.resolve({ recordId, playbackRequestId, status: 'success', privatePlaybackUri: 'content://foreign/private', seekable: true }));
    await expect(prepareLocalPlayback(id)).rejects.toMatchObject({ code: 'local-media-unavailable' });
    mockPrepareLocalPlayback.mockImplementationOnce((recordId: string) => Promise.resolve({ recordId, playbackRequestId: 'wrong-request', status: 'success', privatePlaybackUri: uri, seekable: true }));
    await expect(prepareLocalPlayback(id)).rejects.toMatchObject({ code: 'local-media-unavailable' });
    mockEndLocalPlayback.mockResolvedValueOnce('released');
    await expect(endLocalPlayback()).resolves.toBeUndefined();
    expect(mockEndLocalPlayback).toHaveBeenLastCalledWith(null);
    mockEndLocalPlayback.mockResolvedValueOnce({ status: 'released', uri: 'unexpected' });
    await expect(endLocalPlayback()).rejects.toMatchObject({ code: 'local-media-unavailable' });
    const count = mockEndLocalPlayback.mock.calls.length;
    await expect(endLocalPlayback('content://arbitrary')).rejects.toMatchObject({ code: 'local-media-unavailable' });
    expect(mockEndLocalPlayback).toHaveBeenCalledTimes(count);
  });
});
