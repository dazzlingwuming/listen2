const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadLocalIdentity } = require("../../build/setupMacSigning");
const { createSignOptions } = require("../../build/macosSign");
const config = require("../../package.json");

test("macOS builds always use the complete signing hook", () => {
  assert.equal(config.build.mac.sign, "build/macosSign.js");
});

test("ad-hoc signing preserves nested Electron entitlements and binary policy", () => {
  const options = {
    app: "/build/Listen1.app",
    platform: "darwin",
    binaries: ["extra-binary"],
    ignore: () => false,
    optionsForFile: () => ({
      entitlements: "electron-entitlements.plist",
      hardenedRuntime: true,
      additionalArguments: ["--some-existing-option"],
    }),
  };
  const signing = createSignOptions(options, config.build.appId);
  assert.equal(signing.identity, "-");
  assert.equal(signing.identityValidation, false);
  assert.equal(signing.strictVerify, undefined);
  assert.equal(signing.binaries, options.binaries);
  assert.equal(signing.ignore, options.ignore);
  const main = signing.optionsForFile(options.app);
  assert.equal(main.entitlements, "electron-entitlements.plist");
  assert.equal(main.hardenedRuntime, true);
  assert.equal(main.timestamp, "none");
  assert.deepEqual(main.additionalArguments, [
    "--some-existing-option",
    "--identifier",
    config.build.appId,
  ]);
  assert.deepEqual(
    signing.optionsForFile("/build/Listen1.app/Contents/Frameworks/Helper.app")
      .additionalArguments,
    ["--some-existing-option"]
  );
});

test("ad-hoc signing refuses Mac App Store and missing app identifier", () => {
  assert.throws(() =>
    createSignOptions({ platform: "mas" }, "com.example.app")
  );
  assert.throws(() => createSignOptions({ platform: "darwin" }));
});

test("persistent signing preserves the certificate identity and dedicated keychain", () => {
  const localIdentity = {
    identity: "A".repeat(40),
    keychain: "/private/build-only.keychain-db",
  };
  const signing = createSignOptions(
    {
      app: "/build/Listen1.app",
      platform: "darwin",
      optionsForFile: () => ({ hardenedRuntime: true }),
    },
    config.build.appId,
    localIdentity
  );
  assert.equal(signing.identity, localIdentity.identity);
  assert.equal(signing.keychain, localIdentity.keychain);
  assert.equal(
    signing.optionsForFile("/build/Listen1.app").hardenedRuntime,
    true
  );
});

test("local configuration fails closed for partial, malformed, or public material", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "listen2-signing-config-test-")
  );
  fs.chmodSync(directory, 0o700);
  try {
    assert.equal(loadLocalIdentity(directory), null);
    const state = path.join(directory, "setup-state.json");
    fs.writeFileSync(state, "{}", { mode: 0o600 });
    assert.throws(() => loadLocalIdentity(directory), /incomplete/);
    fs.unlinkSync(state);
    const filename = path.join(directory, "identity.json");
    fs.writeFileSync(
      filename,
      JSON.stringify({ version: 1, identity: "A".repeat(40) }),
      { mode: 0o600 }
    );
    assert.deepEqual(loadLocalIdentity(directory), {
      identity: "A".repeat(40),
      keychain: path.join(directory, "build.keychain-db"),
      directory,
    });
    fs.writeFileSync(filename, JSON.stringify({ version: 1, identity: "-" }));
    assert.throws(() => loadLocalIdentity(directory), /Invalid/);
    fs.writeFileSync(
      filename,
      JSON.stringify({ version: 1, identity: "A".repeat(40) })
    );
    fs.chmodSync(filename, 0o644);
    assert.throws(() => loadLocalIdentity(directory), /owner-only/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
