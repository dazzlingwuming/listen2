package com.dazzlingwuming.listen2.provider;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native truth for the small provider matrix exposed to the packaged page.
 * A field becomes true only when the corresponding native route is installed;
 * page code cannot turn a capability on by supplying a URL or credential.
 */
public final class ProviderCapabilityFacade {
    public static final int VERSION = 1;

    private final Capability bilibili;
    private final Capability netease;
    private final boolean deepSeekTranslation;

    public ProviderCapabilityFacade(boolean netEaseSearchAvailable) {
        this(netEaseSearchAvailable, false);
    }

    public ProviderCapabilityFacade(boolean netEaseSearchAvailable, boolean bilibiliLoginAvailable) {
        bilibili = new Capability(true, true, true, true, true, false, false, bilibiliLoginAvailable, false);
        netease = new Capability(netEaseSearchAvailable, false, false, false, false, false,
                false, false, false);
        deepSeekTranslation = false;
    }

    private ProviderCapabilityFacade(Capability netease, boolean bilibiliLoginAvailable,
            boolean deepSeekTranslation) {
        bilibili = new Capability(true, true, true, true, true, false, false, bilibiliLoginAvailable, false);
        this.netease = netease == null ? Capability.unavailable() : netease;
        this.deepSeekTranslation = deepSeekTranslation;
    }

    /** Current production shape: all four closed NetEase operations are installed. */
    public static ProviderCapabilityFacade production() {
        return new ProviderCapabilityFacade(
                new Capability(true, true, true, true, true, false, false, false, false), false,
                false);
    }

    public ProviderCapabilityFacade withBilibiliAccount(boolean available) {
        return new ProviderCapabilityFacade(netease, available, deepSeekTranslation);
    }

    /** DeepSeek is advertised only after the Activity injects a usable native port. */
    public ProviderCapabilityFacade withDeepSeekTranslation(boolean available) {
        return new ProviderCapabilityFacade(netease, bilibili.login, available);
    }

    public Capability get(String provider) {
        if ("bilibili".equals(provider)) return bilibili;
        if ("netease".equals(provider)) return netease;
        return Capability.unavailable();
    }

    /** A bounded, credential-free handshake payload. */
    public JSONObject toJson() {
        JSONObject result = new JSONObject();
        try {
            result.put("version", VERSION);
            result.put("bilibili", bilibili.toJson());
            result.put("netease", netease.toJson());
            result.put("deepSeekTranslation", deepSeekTranslation);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return result;
    }

    public static final class Capability {
        private final boolean search;
        private final boolean directory;
        private final boolean detail;
        private final boolean media;
        private final boolean lyric;
        private final boolean manualLyric;
        private final boolean fallback;
        private final boolean login;
        private final boolean permission;

        Capability(boolean search, boolean directory, boolean detail, boolean media, boolean lyric,
                boolean manualLyric, boolean fallback, boolean login, boolean permission) {
            this.search = search;
            this.directory = directory;
            this.detail = detail;
            this.media = media;
            this.lyric = lyric;
            this.manualLyric = manualLyric;
            this.fallback = fallback;
            this.login = login;
            this.permission = permission;
        }

        static Capability unavailable() {
            return new Capability(false, false, false, false, false, false, false, false, false);
        }

        public boolean isSearchAvailable() { return search; }

        JSONObject toJson() {
            JSONObject value = new JSONObject();
            try {
                value.put("search", search);
                value.put("directory", directory);
                value.put("detail", detail);
                value.put("media", media);
                value.put("lyric", lyric);
                value.put("manualLyric", manualLyric);
                value.put("fallback", fallback);
                value.put("login", login);
                value.put("permission", permission);
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
            return value;
        }
    }
}
