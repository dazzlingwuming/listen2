const assert = require("node:assert/strict");
const { test } = require("node:test");
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
