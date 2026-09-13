import { isOfflineDownloadEligible } from '../offlineAudio';

describe('offline download eligibility', () => {
  const track = (source: string, id: string) =>
    ({ source, id, title: '歌', artist: '艺人' } as any);
  it('allows only explicit semantic NetEase and Kugou tracks', () => {
    expect(isOfflineDownloadEligible(track('netease', 'netrack_123'))).toBe(
      true,
    );
    expect(isOfflineDownloadEligible(track('kugou', 'kgtrack_abcdefgh'))).toBe(
      true,
    );
  });
  it('excludes Bilibili, other sources, and local SAF tracks', () => {
    expect(isOfflineDownloadEligible(track('bilibili', 'bitrack_1'))).toBe(
      false,
    );
    expect(isOfflineDownloadEligible(track('qq', 'qqtrack_1'))).toBe(false);
    expect(
      isOfflineDownloadEligible({
        ...track('local', 'local_1'),
        contentUri: 'content://documents/1',
        fileName: 'a.mp3',
      }),
    ).toBe(false);
  });
});
