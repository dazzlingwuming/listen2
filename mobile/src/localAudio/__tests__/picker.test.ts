const mockImportAudio = jest.fn();
jest.mock('react-native', () => ({ NativeModules: { Listen2LocalAudio: { importAudio: (...args: unknown[]) => mockImportAudio(...args) } } }));
import { pickLocalAudio } from '../picker';

describe('opaque native local picker', () => {
  it('accepts only a matching safe native receipt', async () => {
    mockImportAudio.mockImplementationOnce((requestId: string) => Promise.resolve({ requestId, status: 'success', imported: 2, unsupported: 1 }));
    const result = await pickLocalAudio();
    expect(result).toEqual({ status: 'success', imported: 2, rejected: 1 });
  });
});
