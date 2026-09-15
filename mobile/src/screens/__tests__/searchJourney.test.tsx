import type { SearchResult } from '../../types';
import {
  createSearchJourneyState,
  reduceSearchJourney,
} from '../../search/searchJourneyState';

const track = (id: string): SearchResult => ({
  kind: 'track',
  track: {
    id,
    source: 'netease',
    title: `歌曲 ${id}`,
    artist: '测试歌手',
  },
});

describe('search journey state', () => {
  it('keeps a semantic NetEase scope and exposes exact operation capability', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: ' 青花瓷 ',
      kind: 'track',
      requestId: 'request-1',
      generation: 1,
    });
    const ready = reduceSearchJourney(state, {
      type: 'success',
      requestId: 'request-1',
      generation: 1,
      page: 1,
      cursor: '2',
      hasMore: true,
      results: [track('netease_1')],
    });

    expect(ready.scope).toMatchObject({
      source: 'netease',
      query: '青花瓷',
      kind: 'track',
      requestId: 'request-1',
      generation: 1,
    });
    expect(ready.rows).toHaveLength(1);
    expect(ready.rows[0]).toMatchObject({ kind: 'track' });
  });

  it('suppresses duplicate pages and stale generations', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: '青花瓷',
      kind: 'track',
      requestId: 'request-2',
      generation: 2,
    });
    const first = reduceSearchJourney(state, {
      type: 'success',
      requestId: 'request-2',
      generation: 2,
      page: 1,
      results: [track('netease_1')],
    });
    const duplicate = reduceSearchJourney(first, {
      type: 'success',
      requestId: 'request-2',
      generation: 2,
      page: 2,
      results: [track('netease_1'), track('netease_2')],
    });
    const stale = reduceSearchJourney(duplicate, {
      type: 'success',
      requestId: 'request-1',
      generation: 1,
      page: 1,
      results: [track('stale')],
    });

    expect(
      duplicate.rows.map(item => item.kind === 'track' && item.track.id),
    ).toEqual(['netease_1', 'netease_2']);
    expect(stale).toBe(duplicate);
  });

  it('retains prior rows and scope after loading-more cancellation', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: '青花瓷',
      kind: 'track',
      requestId: 'request-3',
      generation: 3,
    });
    const ready = reduceSearchJourney(state, {
      type: 'success',
      requestId: 'request-3',
      generation: 3,
      page: 1,
      cursor: '2',
      hasMore: true,
      results: [track('netease_1')],
    });
    const cancelled = reduceSearchJourney(ready, {
      type: 'cancelled',
      requestId: 'request-3',
      generation: 3,
      page: 2,
    });

    expect(cancelled.rows).toHaveLength(1);
    expect(cancelled.scope).toMatchObject({
      source: 'netease',
      query: '青花瓷',
    });
    expect(cancelled.terminal).toBe('cancelled-more');
  });

  it('restores semantic rows, selected identity, cursor, and scroll anchor without a request', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: '青花瓷',
      kind: 'track',
      requestId: 'request-4',
      generation: 4,
      rows: [track('netease_1')],
      page: 2,
      cursor: '3',
      selectedIdentity: 'track:netease:netease_1',
      scrollAnchor: 96,
    });

    expect(state).toMatchObject({
      page: 2,
      cursor: '3',
      selectedIdentity: 'track:netease:netease_1',
      scrollAnchor: 96,
    });
    expect(state.rows).toHaveLength(1);
  });
});
