/* eslint-env node */
/*
 * Native behavioral regression. Optional in ordinary Node-only runs; execute
 * with LISTEN2_AUDIO_TEST_ELECTRON pointing to an existing Electron executable
 * and LISTEN2_AUDIO_TEST_RUNTIME to a registered task workspace. Only synthetic
 * audio is rendered in OfflineAudioContext; no live destination or network.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const runtime = process.env.LISTEN2_AUDIO_TEST_RUNTIME;

if (process.versions.electron && process.type === 'browser') {
  const { app, BrowserWindow, session } = require('electron');
  assert.ok(
    runtime && fs.statSync(runtime).isDirectory(),
    'registered runtime required'
  );
  const extension = path.resolve(__dirname, '..');
  app.setPath('userData', path.join(runtime, 'native-user-data'));
  app
    .whenReady()
    .then(async () => {
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (_details, callback) => callback({ cancel: true })
      );
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false,
        },
      });
      win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 3) console.error(message);
      });
      const base = pathToFileURL(path.join(extension, 'listen1.html')).href;
      const fixture = path.join(runtime, 'native-behavior-fixture.html');
      fs.writeFileSync(fixture, `<base href="${base}">`);
      let exitCode = 0;
      try {
        await win.loadFile(fixture);
        const renderer = fs.readFileSync(
          path.join(__dirname, 'audio_effects_native_renderer.js'),
          'utf8'
        );
        const code = `const NIGHT_ONLY=${
          process.env.LISTEN2_AUDIO_TEST_NIGHT_ONLY === '1'
        };const EXT=${JSON.stringify(extension)};const APP=${JSON.stringify(
          path.dirname(extension)
        )};const OUT=${JSON.stringify(runtime)};const BASE=${JSON.stringify(
          base
        )};${renderer}`;
        const result = await win.webContents.executeJavaScript(code, true);
        fs.writeFileSync(
          path.join(
            runtime,
            process.env.LISTEN2_AUDIO_TEST_NIGHT_ONLY === '1'
              ? 'native-night-results.json'
              : 'native-behavior-results.json'
          ),
          JSON.stringify(
            { electron: process.versions.electron, ...result },
            null,
            2
          )
        );
        console.log('Native preset behavior passed.');
      } catch (error) {
        console.error(error.stack || error);
        exitCode = 1;
      } finally {
        app.exit(exitCode);
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
} else {
  const { test } = require('node:test');
  const { spawnSync } = require('child_process');
  test(
    'native presets alter spectrum, width and dynamics while matching level and bounding peaks',
    {
      skip: !process.env.LISTEN2_AUDIO_TEST_ELECTRON,
      timeout: 90000,
    },
    () => {
      assert.ok(
        runtime && fs.statSync(runtime).isDirectory(),
        'registered runtime required'
      );
      const result = spawnSync(
        process.env.LISTEN2_AUDIO_TEST_ELECTRON,
        [__filename],
        {
          env: process.env,
          encoding: 'utf8',
          timeout: 85000,
        }
      );
      assert.ifError(result.error);
      assert.strictEqual(
        result.status,
        0,
        `${result.stdout}\n${result.stderr}`
      );
    }
  );
}
