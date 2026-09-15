const mockImportAudio = jest.fn();
const mockRepairLocalAudio = jest.fn();
const mockRemoveLocalAudio = jest.fn();
jest.mock('react-native', () => ({ NativeModules: { Listen2LocalAudio: { importAudio: (...args: unknown[]) => mockImportAudio(...args), repairLocalAudio: (...args: unknown[]) => mockRepairLocalAudio(...args), removeLocalAudio: (...args: unknown[]) => mockRemoveLocalAudio(...args) } } }));
import { pickLocalAudio, removeLocalAudio, repairLocalAudio } from '../picker';

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
});
