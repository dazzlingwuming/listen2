const { signAsync } = require("@electron/osx-sign");

function createSignOptions(options, appId) {
  if (options.platform !== "darwin" || !appId) {
    throw new Error("Ad-hoc signing requires a non-MAS macOS app and app ID");
  }
  return {
    ...options,
    identity: "-",
    identityValidation: false,
    // osx-sign enables --strict by default; true becomes invalid --strict=true.
    strictVerify: undefined,
    preAutoEntitlements: false,
    optionsForFile(file) {
      const fileOptions = options.optionsForFile(file);
      return {
        ...fileOptions,
        // Ad-hoc signatures have no timestamp authority or Apple team ID.
        timestamp: "none",
        additionalArguments: [
          ...(fileOptions.additionalArguments || []),
          // Electron's original signature can retain Identifier=Electron.
          ...(file === options.app ? ["--identifier", appId] : []),
        ],
      };
    },
  };
}

// electron-builder 25 skips signing when no certificate exists. Its custom
// sign hook runs after universal merging and before DMG/blockmap generation.
exports.sign = async (options, packager) => {
  await signAsync(createSignOptions(options, packager.appInfo.id));
};
exports.createSignOptions = createSignOptions;
