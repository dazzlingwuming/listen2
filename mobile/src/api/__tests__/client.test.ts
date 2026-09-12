import { providerClient, ProviderClientError } from '../client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('providerClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses the fixed NetEase endpoint and normalizes source-prefixed tracks', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        result: {
          songCount: 1,
          songs: [
            {
              id: 42,
              name: 'Song',
              artists: [{ name: 'Artist' }],
              album: { name: 'Album', picUrl: 'https://img.example/cover.jpg' },
              dt: 123000,
            },
          ],
        },
      }),
    );

    await expect(
      providerClient.search('netease', 'hello world', 2),
    ).resolves.toEqual({
      source: 'netease',
      query: 'hello world',
      page: 2,
      total: 1,
      kind: 'track',
      results: [
        {
          kind: 'track',
          track: {
            id: 'netrack_42',
            source: 'netease',
            title: 'Song',
            artist: 'Artist',
            album: 'Album',
            durationMs: 123000,
            artworkUrl: 'https://img.example/cover.jpg',
          },
        },
      ],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://music.163.com/api/search/get/web?'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain(
      's=hello+world',
    );
  });

  it('uses the fixed public NetEase playlist search route and returns a discriminated summary', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        result: {
          playlistCount: 1,
          playlists: [
            {
              id: 77,
              name: 'My playlist',
              coverImgUrl: 'https://img.example/playlist.jpg',
              trackCount: 12,
              creator: { nickname: 'Creator' },
            },
          ],
        },
      }),
    );

    await expect(
      providerClient.search('netease', 'hello world', 2, {
        kind: 'playlist',
      }),
    ).resolves.toEqual({
      source: 'netease',
      query: 'hello world',
      page: 2,
      total: 1,
      kind: 'playlist',
      results: [
        {
          kind: 'playlist',
          playlist: {
            id: 'neplaylist_77',
            source: 'netease',
            title: 'My playlist',
            artworkUrl: 'https://img.example/playlist.jpg',
            trackCount: 12,
            author: 'Creator',
          },
        },
      ],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://music.163.com/api/search/get/web?'),
      expect.objectContaining({ method: 'GET' }),
    );
    const url = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('type=1000');
    expect(url).toContain('s=hello+world');
    expect(url).toContain('offset=20');
    expect(url).toContain('limit=20');
  });

  it('uses the Android-proven Bilibili search query and removes display markup', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          numResults: 1,
          result: [
            {
              bvid: 'BV1xx411c7mD',
              title: '<em>Live</em> Song',
              author: 'Uploader',
              duration: '03:02',
              pic: 'https://i0.hdslb.com/cover.jpg',
            },
          ],
        },
      }),
    );

    await expect(
      providerClient.search('bilibili', 'live', 1),
    ).resolves.toMatchObject({
      source: 'bilibili',
      results: [
        expect.objectContaining({
          kind: 'track',
          track: expect.objectContaining({
            id: 'bitrack_v_BV1xx411c7mD',
            title: 'Live Song',
            durationMs: 182000,
          }),
        }),
      ],
    });
    const url = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain(
      'https://api.bilibili.com/x/web-interface/search/type?',
    );
    expect(url).toContain('search_type=video');
    expect(url).toContain('page_size=20');
  });

  it('rejects oversized or malformed provider payloads with a safe typed error', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ result: { songs: new Array(51).fill({}) } }),
      );
    await expect(providerClient.search('netease', 'x')).rejects.toMatchObject({
      name: 'ProviderClientError',
      code: 'INVALID_RESPONSE',
      source: 'netease',
      operation: 'search',
    });
  });

  it('rejects an invalid runtime source or malformed query before fetch', async () => {
    globalThis.fetch = jest.fn();
    await expect(
      providerClient.search('other' as any, 'x'),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SOURCE' });
    await expect(providerClient.search('qq', '\ud800')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      source: 'qq',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('aborts an active request when the caller aborts', async () => {
    globalThis.fetch = jest.fn().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          init.signal.addEventListener('abort', () => reject(error));
        }),
    );
    const controller = new AbortController();
    const pending = providerClient.search('bilibili', 'x', 1, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: 'CANCELLED',
      source: 'bilibili',
    });
  });

  it('searches Kuwo through its fixed cookie-free HTTPS route', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        HIT: '1',
        abslist: [
          {
            DC_TARGETID: '228908',
            NAME: '晴天',
            ARTIST: '周杰伦',
            ALBUM: '叶惠美',
            DURATION: '269',
            hts_MVPIC: 'https://img3.kuwo.cn/cover.jpg',
          },
        ],
      }),
    );
    await expect(providerClient.search('kuwo', '晴天', 2)).resolves.toEqual({
      source: 'kuwo',
      query: '晴天',
      page: 2,
      total: 1,
      kind: 'track',
      results: [
        {
          kind: 'track',
          track: {
            id: 'kwtrack_228908',
            source: 'kuwo',
            title: '晴天',
            artist: '周杰伦',
            album: '叶惠美',
            durationMs: 269000,
            artworkUrl: 'https://img3.kuwo.cn/cover.jpg',
          },
        },
      ],
    });
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('https://www.kuwo.cn/search/searchMusicBykeyWord?');
    expect(url).toContain('pn=1');
    expect(url).toContain('rn=20');
    expect(url).toContain('all=%E6%99%B4%E5%A4%A9');
    expect(init).toMatchObject({ method: 'GET', headers: {} });
  });

  it('keeps QQ and Kugou search on their fixed HTTPS adapter routes', async () => {
    const qqPayload = {
      req: {
        data: {
          meta: { sum: 1 },
          body: {
            song: {
              list: [
                {
                  mid: 'qq-mid',
                  name: 'QQ Song',
                  singer: [{ name: 'QQ Artist' }],
                },
              ],
            },
          },
        },
      },
    };
    const kugouPayload = {
      data: {
        total: 1,
        lists: [
          {
            FileHash: 'AABBCCDDEEFF0011',
            SongName: 'KG Song',
            SingerName: 'KG Artist',
          },
        ],
      },
    };
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(qqPayload))
      .mockResolvedValueOnce(jsonResponse(kugouPayload));
    await expect(providerClient.search('qq', 'qq')).resolves.toMatchObject({
      results: [
        expect.objectContaining({
          kind: 'track',
          track: expect.objectContaining({ id: 'qqtrack_qq-mid' }),
        }),
      ],
    });
    await expect(providerClient.search('kugou', 'kg')).resolves.toMatchObject({
      results: [
        expect.objectContaining({
          kind: 'track',
          track: expect.objectContaining({ id: 'kgtrack_AABBCCDDEEFF0011' }),
        }),
      ],
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://u.y.qq.com/cgi-bin/musicu.fcg',
    );
    expect((globalThis.fetch as jest.Mock).mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toContain(
      'https://songsearch.kugou.com/song_search_v2?',
    );
  });

  it('resolves Bilibili through validated detail/CID and a bounded audio candidate', async () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 60;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: { bvid: 'BV1xx411c7mD', pages: [{ cid: 456 }] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            dash: {
              audio: [
                {
                  id: 30280,
                  mimeType: 'audio/mp4',
                  codecs: 'mp4a.40.2',
                  baseUrl: `https://upos-sz-mirror.example.bilivideo.com/audio.m4s?deadline=${futureDeadline}`,
                },
              ],
            },
          },
        }),
      );
    await expect(
      providerClient.bootstrapTrack({
        id: 'bitrack_v_BV1xx411c7mD',
        source: 'bilibili',
        title: 'Song',
        artist: 'Uploader',
      }),
    ).resolves.toEqual({
      trackId: 'bitrack_v_BV1xx411c7mD',
      source: 'bilibili',
      url: `https://upos-sz-mirror.example.bilivideo.com/audio.m4s?deadline=${futureDeadline}`,
      headers: {
        Referer: 'https://www.bilibili.com/',
      },
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain(
      '/x/web-interface/view?bvid=BV1xx411c7mD',
    );
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toContain(
      '/x/player/playurl?',
    );
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toContain(
      'cid=456',
    );
    expect((globalThis.fetch as jest.Mock).mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({
        Referer: 'https://www.bilibili.com/',
        'User-Agent': expect.stringContaining('Android'),
      }),
    });
  });

  it('bootstraps a NetEase track through its fixed public media route', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    await expect(
      providerClient.bootstrapTrack({
        id: 'netrack_42',
        source: 'netease',
        title: 'Song',
        artist: 'Artist',
      }),
    ).resolves.toEqual({
      trackId: 'netrack_42',
      source: 'netease',
      url: 'https://music.163.com/song/media/outer/url?id=42.mp3',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://music.163.com/song/media/outer/url?id=42.mp3',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('bootstraps a Kugou track only from its fixed hash route and HTTPS host', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        status: 1,
        url: 'https://sharefs.kugou.com/path/to/audio.mp3?token=provider-minted',
      }),
    );
    await expect(
      providerClient.bootstrapTrack({
        id: 'kgtrack_48C685F679FFC7CF08B8A8341CA9DB44',
        source: 'kugou',
        title: 'Song',
        artist: 'Artist',
      }),
    ).resolves.toEqual({
      trackId: 'kgtrack_48C685F679FFC7CF08B8A8341CA9DB44',
      source: 'kugou',
      url: 'https://sharefs.kugou.com/path/to/audio.mp3?token=provider-minted',
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=48C685F679FFC7CF08B8A8341CA9DB44',
    );
  });

  it('rejects non-Kugou or paid Kugou playback responses with typed errors', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ url: 'https://media.example/audio.mp3' }),
      )
      .mockResolvedValueOnce(jsonResponse({ url: '', pay_type: 1 }));
    const track = {
      id: 'kgtrack_48C685F679FFC7CF08B8A8341CA9DB44',
      source: 'kugou' as const,
      title: 'Song',
      artist: 'Artist',
    };
    await expect(providerClient.bootstrapTrack(track)).rejects.toMatchObject({
      code: 'PLAYBACK_UNAVAILABLE',
      source: 'kugou',
    });
    await expect(providerClient.bootstrapTrack(track)).rejects.toMatchObject({
      code: 'MEMBERSHIP_REQUIRED',
      source: 'kugou',
    });
  });

  it('maps NetEase primary and translated lyrics from the fixed public route', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        lrc: { lyric: '[00:00.00]Original' },
        tlyric: { lyric: '\b[00:00.00]译\u2005文' },
      }),
    );
    await expect(providerClient.getLyric('netrack_42')).resolves.toEqual({
      trackId: 'netrack_42',
      source: 'netease',
      text: '[00:00.00]Original',
      translation: '[00:00.00]译 文',
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://music.163.com/api/song/lyric?id=42&lv=-1&tv=-1',
    );
  });

  it('maps QQ lyrics only from its fixed route and fixed first-party Referer', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        retcode: 0,
        lyric: '[00:00.00]Original',
        trans: '//[00:00.00]译文',
      }),
    );
    await expect(
      providerClient.getLyric('qqtrack_0039MnYb0qxYhV'),
    ).resolves.toEqual({
      trackId: 'qqtrack_0039MnYb0qxYhV',
      source: 'qq',
      text: '[00:00.00]Original',
      translation: '[00:00.00]译文',
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=0039MnYb0qxYhV&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&nobase64=1',
    );
    expect((globalThis.fetch as jest.Mock).mock.calls[0][1]).toMatchObject({
      headers: { Referer: 'https://y.qq.com/' },
    });
  });

  it('maps a bounded NetEase playlist through its fixed detail route', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        code: 200,
        playlist: {
          id: 77,
          name: 'My playlist',
          tracks: [
            {
              id: 42,
              name: 'Song',
              ar: [{ name: 'Artist' }],
              al: { name: 'Album', picUrl: 'https://img.example/cover.jpg' },
              dt: 123000,
            },
            { id: 'bad' },
          ],
        },
      }),
    );
    await expect(providerClient.getPlaylist('neplaylist_77')).resolves.toEqual({
      id: 'neplaylist_77',
      source: 'netease',
      title: 'My playlist',
      tracks: [
        {
          id: 'netrack_42',
          source: 'netease',
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          durationMs: 123000,
          artworkUrl: 'https://img.example/cover.jpg',
        },
      ],
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://music.163.com/api/v3/playlist/detail?id=77&n=1000',
    );
  });

  it('keeps unproven playback, playlist, and lyric transports closed', async () => {
    globalThis.fetch = jest.fn();
    for (const source of ['qq', 'kugou', 'kuwo', 'bilibili'] as const) {
      await expect(
        providerClient.search(source, 'playlist', 1, { kind: 'playlist' }),
      ).rejects.toMatchObject({
        code: 'ROUTE_UNAVAILABLE',
        source,
        operation: 'search',
      });
    }
    await expect(
      providerClient.bootstrapTrack({
        id: 'qqtrack_001',
        source: 'qq',
        title: 'Song',
        artist: 'Artist',
      }),
    ).rejects.toMatchObject({ code: 'PLAYBACK_UNAVAILABLE', source: 'qq' });
    await expect(
      providerClient.getPlaylist('qqplaylist_9'),
    ).rejects.toMatchObject({
      code: 'ROUTE_UNAVAILABLE',
      source: 'qq',
    });
    await expect(
      providerClient.getLyric('kgtrack_AABBCCDDEEFF0011'),
    ).rejects.toMatchObject({ code: 'LYRIC_UNAVAILABLE', source: 'kugou' });
    expect(
      new ProviderClientError('NETWORK_ERROR', 'qq', 'search').action,
    ).toBe('retry');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
