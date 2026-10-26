/* global module globalThis */
/* eslint-disable no-param-reassign */
(function dailyThemeModule(root) {
  function localDate(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }
  function createDailyTheme({
    request,
    cancel,
    prepare,
    onChange,
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    windowTarget = root,
    documentTarget = root.document,
    retryMs = 30 * 60 * 1000,
  }) {
    let active = false;
    let disposed = false;
    let generation = 0;
    let timer;
    let pending = false;
    let checkedDate = '';
    let retryAt = Infinity;
    let sourceImage = '';
    let state = { status: 'idle', wallpaper: null, palette: null };
    const publish = (next) => {
      state = { ...state, ...next };
      onChange(state);
    };
    const current = (token) => active && !disposed && token === generation;
    function schedule() {
      clearTimer(timer);
      if (!active || disposed) return;
      const date = now();
      const midnight = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1
      );
      // Recheck the local calendar after clock/time-zone changes, without HTTP
      // while the date is unchanged and the last refresh succeeded.
      const delay = Math.max(
        100,
        Math.min(
          60000,
          midnight.getTime() - date.getTime(),
          retryAt - date.getTime()
        )
      );
      timer = setTimer(() => {
        // eslint-disable-next-line no-use-before-define
        check();
        schedule();
      }, delay);
    }
    async function accept(result, token) {
      if (!current(token)) return;
      if (!result || !result.ok || !result.wallpaper) {
        publish({
          status: state.wallpaper ? 'stale' : 'unavailable',
          errorCode: result && result.errorCode,
        });
        return;
      }
      let prepared = { wallpaper: state.wallpaper, palette: state.palette };
      if (
        !state.wallpaper ||
        sourceImage !== result.wallpaper.image ||
        state.wallpaper.date !== result.wallpaper.date
      ) {
        prepared = await prepare(result.wallpaper);
      } else {
        prepared.wallpaper = {
          ...result.wallpaper,
          image: state.wallpaper.image,
        };
      }
      if (!current(token)) return;
      sourceImage = result.wallpaper.image;
      publish({
        ...prepared,
        status: result.status,
        requestedDate: result.requestedDate,
        errorCode: result.errorCode,
      });
    }
    async function refresh(hydrate) {
      if (!active || disposed || pending) return;
      const token = generation;
      pending = true;
      retryAt = Infinity;
      checkedDate = localDate(now());
      publish({ status: 'loading' });
      try {
        if (hydrate) {
          try {
            await accept(await request({ refresh: false }), token);
          } catch (_) {
            // A bad local record must not prevent a fresh, bounded request.
          }
        }
        if (!current(token)) return;
        publish({ status: 'loading' });
        await accept(await request({ refresh: true }), token);
      } catch (_) {
        if (current(token))
          publish({ status: state.wallpaper ? 'stale' : 'unavailable' });
      } finally {
        if (current(token)) {
          pending = false;
          retryAt = ['fresh', 'cached'].includes(state.status)
            ? Infinity
            : now().getTime() + retryMs;
          schedule();
        }
      }
    }
    function check() {
      if (!active || disposed || pending) return;
      if (checkedDate !== localDate(now()) || now().getTime() >= retryAt)
        refresh(false);
    }
    const onVisible = () => {
      if (!documentTarget || !documentTarget.hidden) check();
    };
    if (windowTarget.addEventListener)
      windowTarget.addEventListener('focus', check);
    if (documentTarget && documentTarget.addEventListener)
      documentTarget.addEventListener('visibilitychange', onVisible);
    function select(value) {
      if (disposed || active === Boolean(value)) return;
      active = Boolean(value);
      generation += 1;
      pending = false;
      clearTimer(timer);
      if (active) refresh(true);
      else {
        try {
          Promise.resolve(cancel()).catch(() => {});
        } catch (_) {
          // A closing window may already have removed its IPC handler.
        }
      }
    }
    return {
      select,
      check,
      dispose() {
        select(false);
        disposed = true;
        if (windowTarget.removeEventListener)
          windowTarget.removeEventListener('focus', check);
        if (documentTarget && documentTarget.removeEventListener)
          documentTarget.removeEventListener('visibilitychange', onVisible);
      },
    };
  }
  const api = { createDailyTheme, localDate };
  if (root.document) root.Listen2DailyTheme = api;
  else if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
