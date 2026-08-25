const { contextBridge, ipcRenderer } = require("electron");

const READ_CHANNEL = "loudness-analyzer:read-input";
const RESULT_CHANNEL = "loudness-analyzer:result";

contextBridge.exposeInMainWorld("loudnessAnalyzerBridge", {
  async readInput(token) {
    try {
      const response = await ipcRenderer.invoke(READ_CHANNEL, token);
      if (
        response &&
        response.ok === true &&
        response.bytes &&
        Number.isFinite(response.sourceSampleRate)
      ) {
        return response;
      }
      if (
        response &&
        response.ok === false &&
        /^[a-z0-9-]{1,80}$/.test(String(response.errorCode || ""))
      ) {
        return { ok: false, errorCode: response.errorCode };
      }
      return { ok: false, errorCode: "invalid-analyzer-response" };
    } catch (error) {
      return { ok: false, errorCode: "analyzer-ipc-failed" };
    }
  },
  finish(token, payload) {
    ipcRenderer.send(RESULT_CHANNEL, token, payload);
  },
});
