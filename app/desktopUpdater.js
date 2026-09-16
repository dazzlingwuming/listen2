const UPDATE_FEED = Object.freeze({
  provider: "github",
  owner: "dazzlingwuming",
  repo: "listen2",
});

const RELEASE_TAG_PREFIX = "https://github.com/dazzlingwuming/listen2/releases/tag/v";
const RELEASE_NOTES_FALLBACK = "本次更新的详细内容请查看 GitHub Release 页面。";

function decodeNumericEntity(match, value, radix) {
  const codePoint = parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : match;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) =>
      decodeNumericEntity(match, hex, 16)
    )
    .replace(/&#([0-9]+);/g, (match, decimal) =>
      decodeNumericEntity(match, decimal, 10)
    );
}

function normalizeReleaseNote(value) {
  if (typeof value !== "string") {
    return "";
  }

  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li(?:\s[^>]*)?>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatReleaseNotes(releaseNotes) {
  const notes = Array.isArray(releaseNotes)
    ? releaseNotes
        .map((entry) => {
          const note = normalizeReleaseNote(entry && entry.note);
          const version = normalizeReleaseNote(entry && entry.version);
          if (!note) {
            return "";
          }
          return version ? `v${version}\n${note}` : note;
        })
        .filter(Boolean)
        .join("\n\n")
    : normalizeReleaseNote(releaseNotes);

  return notes || RELEASE_NOTES_FALLBACK;
}

function buildReleaseUrl(version) {
  return `${RELEASE_TAG_PREFIX}${encodeURIComponent(String(version || "").trim())}`;
}

function createDesktopUpdater({
  updater,
  dialog,
  shell,
  platform,
  getParentWindow,
}) {
  let started = false;
  let discoveryPromptVisible = false;
  let discoveryActionChosen = false;
  let downloadedPromptVisible = false;
  let downloadedPromptHandled = false;

  function getWindow() {
    return typeof getParentWindow === "function" ? getParentWindow() : undefined;
  }

  function showMessageBox(options) {
    const parentWindow = getWindow();
    return parentWindow
      ? dialog.showMessageBox(parentWindow, options)
      : dialog.showMessageBox(options);
  }

  function buildDiscoveryDialog(updateInfo) {
    const version = String((updateInfo && updateInfo.version) || "未知版本").trim();
    const releaseNotes = formatReleaseNotes(updateInfo && updateInfo.releaseNotes);

    return {
      type: "info",
      title: "发现新版本",
      message: `发现新版本 v${version}`,
      detail: `更新内容：\n${releaseNotes}`,
      buttons: ["立即更新", "稍后"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
  }

  async function handleUpdateAvailable(updateInfo) {
    if (discoveryPromptVisible || discoveryActionChosen) {
      return;
    }

    discoveryPromptVisible = true;
    try {
      const result = await showMessageBox(buildDiscoveryDialog(updateInfo));
      if (!result || result.response !== 0) {
        return;
      }

      discoveryActionChosen = true;
      const version = String((updateInfo && updateInfo.version) || "").trim();
      if (platform === "win32") {
        await updater.downloadUpdate();
      } else if (platform === "darwin") {
        await shell.openExternal(buildReleaseUrl(version));
      }
    } catch (error) {
      // An update failure must not prevent normal startup or expose updater internals.
    } finally {
      discoveryPromptVisible = false;
    }
  }

  async function handleUpdateDownloaded(updateInfo) {
    if (
      platform !== "win32" ||
      downloadedPromptVisible ||
      downloadedPromptHandled
    ) {
      return;
    }

    downloadedPromptVisible = true;
    downloadedPromptHandled = true;
    try {
      const version = String((updateInfo && updateInfo.version) || "未知版本").trim();
      const result = await showMessageBox({
        type: "info",
        title: "更新已下载",
        message: `新版本 v${version} 已下载完成`,
        detail: "重启应用以安装更新。",
        buttons: ["重启并安装", "稍后"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result && result.response === 0) {
        updater.quitAndInstall();
      }
    } catch (error) {
      // A late dialog or install error leaves the downloaded update inert.
    } finally {
      downloadedPromptVisible = false;
    }
  }

  function start() {
    if (started) {
      return Promise.resolve();
    }
    started = true;

    try {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.fullChangelog = false;
      updater.setFeedURL(UPDATE_FEED);
      updater.on("update-available", (updateInfo) => {
        void handleUpdateAvailable(updateInfo);
      });
      updater.on("update-downloaded", (updateInfo) => {
        void handleUpdateDownloaded(updateInfo);
      });

      if (platform !== "win32" && platform !== "darwin") {
        return Promise.resolve();
      }
      return Promise.resolve(updater.checkForUpdates()).catch(() => undefined);
    } catch (error) {
      return Promise.resolve();
    }
  }

  return {
    start,
  };
}

module.exports = {
  UPDATE_FEED,
  buildReleaseUrl,
  createDesktopUpdater,
  formatReleaseNotes,
};
