/* eslint-env node */

const BVID = 'BV1xx411c7mD';

const SEARCH_SUCCESS = {
  source: 'bilibili',
  total: 1,
  rows: [
    {
      provider: 'bilibili',
      source: 'bilibili',
      id: `bitrack_v_${BVID}`,
      bvid: BVID,
      title: 'Android fixture song',
      author: 'Fixture artist',
      authorId: 7,
      cover: 'https://i0.hdslb.com/fixture-cover.jpg',
      duration: '03:21',
      type: 'video',
      capability: 'part-selection-required',
    },
  ],
};

const DETAIL_MULTIPART = {
  bvid: BVID,
  title: 'Android fixture video',
  duration: 240,
  pages: [
    { cid: 101, page: 1, part: 'Part one', duration: 100 },
    { cid: 202, page: 2, part: 'Part two', duration: 140 },
  ],
};

const MANIFEST_SUCCESS = {
  bvid: BVID,
  cid: 202,
  duration: 140,
  mime: 'audio/mp4',
  codec: 'mp4a.40.2',
  bitrate: 128000,
  quality: '128K',
  expiry: 2147483647,
  candidates: [
    'https://upos-sz-mirrorcos.bilivideo.com/fixture-audio.m4s?deadline=2147483647',
    'https://upos-sz-mirrorcos.bilivideo.com/fixture-audio-backup.m4s?deadline=2147483647',
  ],
};

const ERROR_FIXTURES = {
  CANCELLED: 'CANCELLED',
  INVALID_PART: 'INVALID_PART',
  MALFORMED: 'MALFORMED_PROVIDER_RESPONSE',
  NETWORK: 'NETWORK_IO_ERROR',
  PERMISSION: 'PERMISSION_DENIED',
  UNSUPPORTED_CODEC: 'UNSUPPORTED_CODEC',
};

module.exports = {
  BVID,
  SEARCH_SUCCESS,
  DETAIL_MULTIPART,
  MANIFEST_SUCCESS,
  ERROR_FIXTURES,
};
