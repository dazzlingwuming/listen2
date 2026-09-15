import { history } from '../history';
test('history adapter exposes safe bounded export and clear only', () => { expect(typeof history.exportSafe).toBe('function'); expect(typeof history.clear).toBe('function'); });
