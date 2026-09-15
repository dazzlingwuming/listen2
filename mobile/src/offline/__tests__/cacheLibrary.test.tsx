import { filterCache } from '../../screens/CacheLibraryScreen';
test('filters owner/status and sorts latest cache entry first', () => {
  const entries: any[] = [{ operationId: 'one', source: 'netease', trackId: 'netrack_1', title: 'First', artist: 'A', owners: ['temporary'], status: 'ready', downloadedBytes: 1, totalBytes: 1, errorCode: null, updatedAt: 1 }, { operationId: 'two', source: 'kugou', trackId: 'kgtrack_abcdefgh', title: 'Second', artist: 'B', owners: ['explicit'], status: 'ready', downloadedBytes: 1, totalBytes: 1, errorCode: null, updatedAt: 2 }];
  expect(filterCache(entries, '', 'explicit', 'ready').map(entry => entry.operationId)).toEqual(['two']);
});
