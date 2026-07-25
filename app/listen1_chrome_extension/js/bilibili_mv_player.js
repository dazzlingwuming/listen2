/* global MediaService */
(function initBilibiliMvPlayer(global) {
  const DRIFT_IGNORE_SECONDS = 0.12;
  const DRIFT_HARD_SEEK_SECONDS = 0.5;
  const DRIFT_ADJUST_INTERVAL_MS = 180;
  const LOAD_TIMEOUT_MS = 15000;

  function parseTrackId(track) {
    const raw = String((track && track.id) || '');
    if (!raw.startsWith('bitrack_v_')) {
      return null;
    }
    const [bvid, cid] = raw.slice('bitrack_v_'.length).split('-');
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) {
      return null;
    }
    return {
      id: raw,
      bvid,
      cid: Number(cid || 0),
    };
  }

  function getVariantKey(variant) {
    return `${Number(variant.id || 0)}:${String(variant.codecs || '')}`;
  }

  function getCodecRank(codecs) {
    const value = String(codecs || '').toLowerCase();
    if (/^(avc|avc1)/.test(value)) {
      return 3;
    }
    if (/^(hev|hvc|hevc)/.test(value)) {
      return 2;
    }
    if (/^(av01|av1)/.test(value)) {
      return 1;
    }
    return 0;
  }

  function getPublicVariant(variant) {
    return {
      key: getVariantKey(variant),
      id: Number(variant.id || 0),
      label: String(variant.label || '视频'),
      codecs: String(variant.codecs || ''),
      width: Number(variant.width || 0),
      height: Number(variant.height || 0),
      frameRate: String(variant.frameRate || ''),
    };
  }

  class BilibiliMvPlayer {
    constructor(onStateChange) {
      this.onStateChange = onStateChange;
      this.track = null;
      this.manifest = null;
      this.variant = null;
      this.loadToken = 0;
      this.lastPosition = 0;
      this.lastPlaying = false;
      this.lastDriftAdjustmentAt = 0;
      this.videoElement = null;
      this.recoveryAttempted = false;
      this.state = {
        available: false,
        active: false,
        loading: false,
        error: '',
        selectedVariantKey: '',
        videoVariants: [],
      };
      this.handleVideoError = this.handleVideoError.bind(this);
    }

    getVideoElement() {
      if (typeof document === 'undefined') {
        return null;
      }
      if (this.videoElement && this.videoElement.isConnected) {
        return this.videoElement;
      }
      this.videoElement = document.querySelector(
        '.bilibili-mv-primary-video'
      );
      return this.videoElement;
    }

    setState(next) {
      this.state = { ...this.state, ...next };
      if (typeof this.onStateChange === 'function') {
        this.onStateChange({ ...this.state });
      }
    }

    isAvailableFor(track) {
      return Boolean(parseTrackId(track));
    }

    getCanPlayType(variant) {
      const video = this.getVideoElement();
      if (!video) {
        return '';
      }
      const mimeType = String(variant.mimeType || 'video/mp4');
      const codecs = String(variant.codecs || '');
      return video.canPlayType(
        codecs ? `${mimeType}; codecs="${codecs}"` : mimeType
      );
    }

    selectVariant(variantKey) {
      const variants = Array.isArray(
        this.manifest && this.manifest.videoVariants
      )
        ? this.manifest.videoVariants
        : [];
      const requested = variantKey
        ? variants.find((variant) => getVariantKey(variant) === variantKey)
        : null;
      if (requested && this.getCanPlayType(requested) !== '') {
        return requested;
      }
      const supported = variants
        .filter((variant) => this.getCanPlayType(variant) !== '')
        .sort((left, right) => {
          const quality = Number(right.id || 0) - Number(left.id || 0);
          if (quality !== 0) {
            return quality;
          }
          return getCodecRank(right.codecs) - getCodecRank(left.codecs);
        });
      return supported[0] || null;
    }

    async waitForVideo(video, token) {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        return;
      }
      await new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
        };
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('video-load-failed'));
        };
        timer = setTimeout(() => {
          cleanup();
          reject(new Error('video-load-timeout'));
        }, LOAD_TIMEOUT_MS);
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
        if (token !== this.loadToken) {
          cleanup();
          resolve();
        }
      });
    }

    async loadVariant(variant, position, playing) {
      const video = this.getVideoElement();
      if (!video || !variant || !variant.url) {
        throw new Error('video-unavailable');
      }
      const token = ++this.loadToken;
      video.removeEventListener('error', this.handleVideoError);
      video.pause();
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = variant.url;
      video.addEventListener('error', this.handleVideoError);
      video.load();
      await this.waitForVideo(video, token);
      if (token !== this.loadToken) {
        return;
      }
      this.seekVideo(video, position);
      this.variant = variant;
      this.setState({
        active: true,
        loading: false,
        error: '',
        selectedVariantKey: getVariantKey(variant),
      });
      if (playing) {
        await video.play().catch(() => undefined);
      }
    }

    seekVideo(video, position) {
      const target = Math.max(0, Number(position || 0));
      try {
        const duration = Number(video.duration || 0);
        video.currentTime =
          duration > 0 ? Math.min(target, duration - 0.05) : target;
      } catch (error) {
        // Media metadata can briefly be unavailable while a quality switch settles.
      }
    }

    async open(track, position, playing) {
      const parsedTrack = parseTrackId(track);
      if (!parsedTrack) {
        this.close();
        return false;
      }
      this.track = parsedTrack;
      this.lastPosition = Number(position || 0);
      this.lastPlaying = Boolean(playing);
      this.recoveryAttempted = false;
      this.setState({
        available: true,
        active: false,
        loading: true,
        error: '',
        selectedVariantKey: '',
        videoVariants: [],
      });
      try {
        // Angular applies the loading state asynchronously. Yield once so the
        // one full-window video surface is visible before loading its stream.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const response = await MediaService.getBilibiliMediaManifest({
          bvid: parsedTrack.bvid,
          cid: parsedTrack.cid,
        });
        if (!response || response.ok !== true || !response.manifest) {
          throw new Error((response && response.status) || 'manifest-failed');
        }
        if (!this.track || this.track.id !== parsedTrack.id) {
          return false;
        }
        this.manifest = response.manifest;
        const variant = this.selectVariant();
        if (!variant) {
          throw new Error('unsupported-video-codec');
        }
        this.setState({
          videoVariants: this.manifest.videoVariants.map(getPublicVariant),
        });
        await this.loadVariant(variant, this.lastPosition, this.lastPlaying);
        return true;
      } catch (error) {
        if (this.track && this.track.id === parsedTrack.id) {
          this.setState({
            active: false,
            loading: false,
            error: error && error.message ? error.message : 'mv-unavailable',
          });
        }
        return false;
      }
    }

    async switchQuality(variantKey) {
      if (!this.track || !this.manifest) {
        return false;
      }
      const variant = this.selectVariant(variantKey);
      if (!variant) {
        this.setState({ error: 'unsupported-video-codec' });
        return false;
      }
      this.setState({ loading: true, error: '' });
      try {
        await this.loadVariant(variant, this.lastPosition, this.lastPlaying);
        return true;
      } catch (error) {
        this.setState({
          loading: false,
          error:
            error && error.message ? error.message : 'quality-switch-failed',
        });
        return false;
      }
    }

    sync(track, position, playing) {
      const parsedTrack = parseTrackId(track);
      this.lastPosition = Number(position || 0);
      this.lastPlaying = Boolean(playing);
      if (
        !this.state.active ||
        !this.track ||
        !parsedTrack ||
        parsedTrack.id !== this.track.id
      ) {
        if (
          this.state.active &&
          (!parsedTrack || !this.track || parsedTrack.id !== this.track.id)
        ) {
          this.close();
        }
        return;
      }
      const video = this.getVideoElement();
      if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
        return;
      }
      if (!playing) {
        if (!video.paused) {
          video.pause();
        }
        return;
      }
      if (video.paused) {
        video.play().catch(() => undefined);
      }
      const drift = Number(video.currentTime || 0) - this.lastPosition;
      const absoluteDrift = Math.abs(drift);
      if (absoluteDrift > DRIFT_HARD_SEEK_SECONDS) {
        this.seekVideo(video, this.lastPosition);
        video.playbackRate = 1;
        this.lastDriftAdjustmentAt = Date.now();
      } else if (
        Date.now() - this.lastDriftAdjustmentAt >= DRIFT_ADJUST_INTERVAL_MS
      ) {
        if (absoluteDrift > DRIFT_IGNORE_SECONDS) {
          video.playbackRate = drift > 0 ? 0.97 : 1.03;
        } else if (video.playbackRate !== 1) {
          video.playbackRate = 1;
        }
        this.lastDriftAdjustmentAt = Date.now();
      }
    }

    async handleVideoError() {
      if (!this.state.active || this.recoveryAttempted || !this.track) {
        this.setState({
          active: false,
          loading: false,
          error: 'video-playback-failed',
        });
        return;
      }
      this.recoveryAttempted = true;
      try {
        const response = await MediaService.getBilibiliMediaManifest({
          bvid: this.track.bvid,
          cid: this.track.cid,
          forceRefresh: true,
        });
        if (!response || response.ok !== true || !response.manifest) {
          throw new Error('manifest-refresh-failed');
        }
        this.manifest = response.manifest;
        const preferredKey = this.variant ? getVariantKey(this.variant) : '';
        const variant = this.selectVariant(preferredKey);
        if (!variant) {
          throw new Error('unsupported-video-codec');
        }
        await this.loadVariant(variant, this.lastPosition, this.lastPlaying);
      } catch (error) {
        this.setState({
          active: false,
          loading: false,
          error:
            error && error.message ? error.message : 'video-playback-failed',
        });
      }
    }

    toggleFullscreen() {
      const video = this.getVideoElement();
      if (!video) {
        return;
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      } else if (typeof video.requestFullscreen === 'function') {
        video.requestFullscreen().catch(() => undefined);
      }
    }

    close() {
      this.loadToken += 1;
      const video = this.getVideoElement();
      if (video) {
        if (
          typeof document !== 'undefined' &&
          document.fullscreenElement === video &&
          typeof document.exitFullscreen === 'function'
        ) {
          document.exitFullscreen().catch(() => undefined);
        }
        video.removeEventListener('error', this.handleVideoError);
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      this.track = null;
      this.manifest = null;
      this.variant = null;
      this.lastDriftAdjustmentAt = 0;
      this.recoveryAttempted = false;
      this.setState({
        active: false,
        loading: false,
        error: '',
        selectedVariantKey: '',
        videoVariants: [],
      });
    }

    destroy() {
      this.close();
      this.videoElement = null;
    }
  }

  global.BilibiliMvPlayer = BilibiliMvPlayer;
})(window);
