/* global isElectron require playlistBackup */
/* eslint-disable global-require */
function github() {
  const OAUTH_URL = 'https://github.com/login/oauth';
  const API_URL = 'https://api.github.com';

  const client_id = 'e099a4803bb1e2e773a3';
  const client_secret = '81fbfc45c65af8c0fbf2b4dae6f23f22e656cfb8';

  const GithubAPI = axios.create({
    baseURL: API_URL,
    headers: { accept: 'application/json' },
  });
  GithubAPI.interceptors.request.use((config) => {
    const accessToken = localStorage.getObject('githubOauthAccessKey');
    // eslint-disable-next-line no-param-reassign
    config.headers.Authorization = `token ${accessToken}`;
    return config;
  });

  const Github = {
    status: 0,
    username: '',
  };

  function gistError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) {
      error.cause = cause;
    }
    return error;
  }

  function parseGistBackupContent(content) {
    if (typeof content === 'string') {
      try {
        return JSON.parse(content);
      } catch (error) {
        throw gistError('BACKUP_JSON_INVALID', '备份文件 JSON 格式错误', error);
      }
    }
    if (content && typeof content === 'object') {
      return content;
    }
    throw gistError('BACKUP_JSON_INVALID', '备份文件内容为空或格式错误');
  }

  window.GithubClient = {
    github: {
      handleCallback: (code, cb) => {
        const url = `${OAUTH_URL}/access_token`;
        const params = {
          client_id,
          client_secret,
          code,
        };
        axios
          .post(url, '', {
            params,
            headers: { accept: 'application/json' },
          })
          .then((res) => {
            const ak = res.data.access_token;
            if (ak)
              localStorage.setItem('githubOauthAccessKey', JSON.stringify(ak));
            if (cb !== undefined) {
              cb(ak);
            }
          });
      },
      openAuthUrl: () => {
        Github.status = 1;
        const url = `${OAUTH_URL}/authorize?client_id=${client_id}&scope=gist`;
        if (isElectron()) {
          // normal window for link
          const { BrowserWindow } = require('@electron/remote'); // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies
          let win = new BrowserWindow({
            width: 1000,
            height: 670,
          });
          win.on('closed', () => {
            win = null;
          });
          win.loadURL(url);
          return;
        }
        window.open(url, '_blank');
      },
      getStatus: () => Github.status,
      getStatusText: () => {
        switch (Github.status) {
          case 0:
            return '未连接';
          case 1:
            return '连接中';
          case 2:
            return `${Github.username}已登录`;
          default:
            return '???';
        }
      },
      updateStatus: async (callback) => {
        const access_token = localStorage.getObject('githubOauthAccessKey');
        if (access_token == null) {
          Github.status = 0;
        } else {
          const { data } = await GithubAPI.get('/user');
          if (data.login === undefined) {
            Github.status = 1;
          } else {
            Github.status = 2;
            Github.username = data.login;
          }
        }
        if (callback != null) {
          callback(Github.status);
        }
      },
      logout: () => {
        localStorage.removeItem('githubOauthAccessKey');
        Github.status = 0;
      },
    },

    gist: {
      json2gist(jsonObject) {
        const result = {};

        result['listen1_backup.json'] = {
          content: JSON.stringify(jsonObject),
        };
        // const markdown = '# My Listen1 Playlists\n';
        const backupSummary =
          typeof playlistBackup !== 'undefined' &&
          typeof playlistBackup.getGistSummaryData === 'function'
            ? playlistBackup.getGistSummaryData(jsonObject)
            : { playlists: [], songsCount: 0 };
        const playlists = Array.isArray(backupSummary.playlists)
          ? backupSummary.playlists
          : [];
        const songsCount = playlists.reduce((count, playlist, index) => {
          const info = playlist && playlist.info ? playlist.info : {};
          const tracks = Array.isArray(playlist && playlist.tracks)
            ? playlist.tracks
            : [];
          const cover = `<img src="${
            info.cover_img_url || ''
          }" width="140" height="140"><br/>`;
          const { title = '未命名歌单' } = info;
          let tableHeader = '\n| 音乐标题 | 歌手 | 专辑 |\n';
          tableHeader += '| --- | --- | --- |\n';
          const tableBody = tracks.reduce(
            (r, track) =>
              `${r} | ${(track && track.title) || ''} | ${
                (track && track.artist) || ''
              } | ${(track && track.album) || ''} | \n`,
            ''
          );
          const content = `<details>\n  <summary>${cover}   ${title}</summary><p>\n${tableHeader}${tableBody}</p></details>`;
          const playlistId =
            (info && typeof info.id === 'string' && info.id) ||
            `playlist_${index + 1}`;
          const filename = `listen1_${playlistId}.md`;
          result[filename] = {
            content,
          };
          return count + tracks.length;
        }, 0);
        const summary = `本歌单由[Listen1](https://listen1.github.io/listen1/)创建, 歌曲数：${songsCount}，歌单数：${playlists.length}，点击查看更多`;
        result['listen1_aha_playlist.md'] = {
          content: summary,
        };

        return result;
      },

      gist2json(gistFiles, callback) {
        const backupFile = gistFiles && gistFiles['listen1_backup.json'];
        let promise;
        if (!backupFile) {
          promise = Promise.reject(
            gistError('BACKUP_FILE_MISSING', '未找到 listen1_backup.json')
          );
        } else if (!backupFile.truncated) {
          promise = Promise.resolve().then(() =>
            parseGistBackupContent(backupFile.content)
          );
        } else if (!backupFile.raw_url) {
          promise = Promise.reject(
            gistError('BACKUP_FILE_MISSING', '备份文件缺少下载地址')
          );
        } else {
          promise = GithubAPI.get(backupFile.raw_url)
            .then((res) => parseGistBackupContent(res && res.data))
            .catch((error) => {
              if (error && error.code === 'BACKUP_JSON_INVALID') {
                throw error;
              }
              throw gistError(
                'BACKUP_GIST_REQUEST_FAILED',
                '下载备份文件失败',
                error
              );
            });
        }
        if (typeof callback === 'function') {
          promise.then(callback).catch(() => {});
        }
        return promise;
      },

      listExistBackup() {
        return GithubAPI.get('/gists').then((res) => {
          const result = res.data;
          return result.filter((backupObject) =>
            backupObject.description.startsWith('updated by Listen1')
          );
        });
      },

      backupMySettings2Gist(files, gistId, isPublic) {
        let method = '';
        let url = '';
        if (gistId != null) {
          method = 'patch';
          url = `/gists/${gistId}`;
        } else {
          method = 'post';
          url = '/gists';
        }
        return GithubAPI.request({
          method,
          url,
          data: {
            description: `updated by Listen1(https://listen1.github.io/listen1/) at ${new Date().toLocaleString()}`,
            public: isPublic,
            files,
          },
        });
      },

      importMySettingsFromGist(gistId) {
        return GithubAPI.get(`/gists/${gistId}`).then((res) => res.data.files);
      },
    },
  };
}

github();
