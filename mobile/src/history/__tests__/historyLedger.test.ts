const mockBegin = jest.fn(); const mockObserve = jest.fn();
jest.mock('react-native', () => ({ NativeModules: { Listen2History: { beginPlayback: (...a: unknown[]) => mockBegin(...a), observePlayback: (...a: unknown[]) => mockObserve(...a) } } }));
import { history } from '../history';
describe('history adapter', () => { it('sends safe semantic observations only after begin', () => { history.begin({ id: 'netrack_1', source: 'netease', title: '歌', artist: '人' } as any); history.observe({ id: 'netrack_1', source: 'netease', title: '歌', artist: '人' } as any, 'progress', 31000); expect(mockBegin).toHaveBeenCalled(); expect(mockObserve).toHaveBeenCalled(); expect(JSON.stringify(mockBegin.mock.calls)).not.toContain('http'); }); });
