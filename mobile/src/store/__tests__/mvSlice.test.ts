import reducer, { mvActions } from '../mvSlice';

describe('MV volatile semantic state', () => {
  it('contains only semantic recovery fields and never a handle or transport value', () => {
    const value = reducer(undefined, mvActions.setSnapshot({ bvid: 'BV1xx411c7mD', cid: '12', qualityId: '80', positionMs: 2000, playIntent: true }));
    expect(value).toEqual({ snapshot: { bvid: 'BV1xx411c7mD', cid: '12', qualityId: '80', positionMs: 2000, playIntent: true } });
    expect(JSON.stringify(value)).not.toMatch(/handle|url|deadline|cookie|header/i);
  });
});
