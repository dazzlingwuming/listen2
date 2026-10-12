const { signAsync } = require("@electron/osx-sign");
const {
  loadLocalIdentity,
  unlockLocalIdentity,
  withKeychainSearchListAsync,
} = require("./setupMacSigning");

function createSignOptions(options, appId, localIdentity = null) {
  if (options.platform !== "darwin" || !appId) {
    throw new Error("Signing requires a non-MAS macOS app and app ID");
  }
  return {
    ...options,
    identity: localIdentity ? localIdentity.identity : "-",
    ...(localIdentity ? { keychain: localIdentity.keychain } : {}),
    identityValidation: false,
    // osx-sign enables --strict by default; true becomes invalid --strict=true.
    strictVerify: undefined,
    preAutoEntitlements: false,
    optionsForFile(file) {
      const fileOptions = options.optionsForFile(file);
      return {
        ...fileOptions,
        // Local self-signed and ad-hoc signatures have no timestamp authority.
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
  const localIdentity = loadLocalIdentity();
  if (localIdentity) {
    // Configured identities must be usable; never downgrade them to ad-hoc.
    await withKeychainSearchListAsync(localIdentity.keychain, async () => {
      unlockLocalIdentity(localIdentity);
      await signAsync(
        createSignOptions(options, packager.appInfo.id, localIdentity)
      );
    });
    return;
  }
  await signAsync(
    createSignOptions(options, packager.appInfo.id, localIdentity)
  );
};
exports.createSignOptions = createSignOptions;
