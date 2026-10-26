package com.dazzlingwuming.listen2;

import java.net.URI;
import java.net.URISyntaxException;

import org.json.JSONObject;

/**
 * Typed-operation facade for the native NetEase provider.
 *
 * <p>This class is deliberately independent from AndroidHttpBridge. The
 * bridge can dispatch its named operations to these methods without giving the
 * page any route, form body, cookie, or transient media URL.</p>
 */
final class NetEaseProviderClient {
    static final String HOST = NetEaseNativeProvider.MUSIC_HOST;
    static final String SEARCH_PATH = NetEaseNativeProvider.SEARCH_PATH;

    /** Compatibility seam for old search-only JVM fixtures. */
    interface Transport {
        ProviderResponse execute(URI uri) throws Exception;
    }

    private final NetEaseNativeProvider provider;

    NetEaseProviderClient() {
        this(new NetEaseNativeProvider());
    }

    NetEaseProviderClient(NetEaseNativeProvider provider) {
        this.provider = provider == null ? new NetEaseNativeProvider() : provider;
    }

    /** Keeps the pre-typed search fixture seam while all production requests use the closed provider. */
    NetEaseProviderClient(Transport transport) {
        this(new NetEaseNativeProvider(new CompatibilityTransport(transport)));
    }

    AndroidRpcContract.TypedReply executeSearch(AndroidRpcContract.TypedRequest request) {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_SEARCH) {
            return error(request, "UNSUPPORTED_OPERATION");
        }
        try {
            NetEaseNativeProvider.Request route = provider.buildSearchRequest(request.keyword, request.page);
            NetEaseNativeProvider.Response response = provider.execute(route);
            if (!response.isHttpSuccess()) return responseError(request, response);
            NetEaseResponseMapper.MappingResult mapped = NetEaseResponseMapper.mapSearch(request, response.body);
            return mapped.isValid() ? AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK,
                    response.status, mapped.value, null) : error(request, mapped.errorCode);
        } catch (Exception ignored) {
            return error(request, "INVALID_PAYLOAD");
        }
    }

    AndroidRpcContract.TypedReply executeDirectoryDetail(AndroidRpcContract.TypedRequest request) {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_DIRECTORY_DETAIL) {
            return error(request, "UNSUPPORTED_OPERATION");
        }
        String playlistId = operationString(request, "trackId");
        if (!isProviderId(playlistId)) return error(request, "INVALID_PAYLOAD");
        try {
            NetEaseNativeProvider.Response playlist = provider.execute(
                    provider.buildPlaylistDetailRequest(Long.parseLong(playlistId)));
            if (!playlist.isHttpSuccess()) return responseError(request, playlist);
            NetEaseResponseMapper.TrackIdsResult ids = NetEaseResponseMapper.extractPlaylistTrackIds(
                    playlistId, playlist.body);
            if (!ids.isValid()) return error(request, ids.errorCode);
            NetEaseNativeProvider.Response songs = provider.execute(provider.buildSongDetailRequest(ids.ids));
            if (!songs.isHttpSuccess()) return responseError(request, songs);
            NetEaseResponseMapper.MappingResult mapped = NetEaseResponseMapper.mapDirectoryDetail(
                    playlistId, playlist.body, songs.body);
            return mapped.isValid() ? AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK,
                    songs.status, mapped.value, null) : error(request, mapped.errorCode);
        } catch (Exception ignored) {
            return error(request, "MALFORMED_PROVIDER_RESPONSE");
        }
    }

    /**
     * Probes one default rendition and returns only a logical prepared result.
     * The returned provider URL is intentionally discarded here; Media3 gets a
     * fresh native-only resolution through NetEasePlaybackResolver.
     */
    AndroidRpcContract.TypedReply executeDefaultRendition(AndroidRpcContract.TypedRequest request) {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_RENDITION_DEFAULT) {
            return error(request, "UNSUPPORTED_OPERATION");
        }
        String trackId = operationString(request, "trackId");
        if (!isProviderId(trackId)) return error(request, "INVALID_PAYLOAD");
        try {
            NetEaseNativeProvider.Response response = provider.execute(
                    provider.buildDefaultRenditionRequest(Long.parseLong(trackId)));
            if (!response.isHttpSuccess()) return responseError(request, response);
            NetEaseResponseMapper.RenditionResult mapped = NetEaseResponseMapper.mapDefaultRendition(
                    trackId, response.body);
            if (!mapped.isValid()) return error(request, mapped.errorCode);
            JSONObject result = new JSONObject();
            result.put("source", AndroidRpcContract.NETEASE_SOURCE);
            result.put("provider", AndroidRpcContract.NETEASE_SOURCE);
            result.put("prepared", true);
            result.put("capability", "default-rendition");
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK,
                    response.status, result, null);
        } catch (Exception ignored) {
            return error(request, "MALFORMED_PROVIDER_RESPONSE");
        }
    }

    AndroidRpcContract.TypedReply executePrimaryLyric(AndroidRpcContract.TypedRequest request) {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_LYRIC_PRIMARY) {
            return error(request, "UNSUPPORTED_OPERATION");
        }
        String trackId = operationString(request, "trackId");
        if (!isProviderId(trackId)) return error(request, "INVALID_PAYLOAD");
        try {
            NetEaseNativeProvider.Response response = provider.execute(
                    provider.buildPrimaryLyricRequest(Long.parseLong(trackId)));
            if (!response.isHttpSuccess()) return responseError(request, response);
            NetEaseResponseMapper.MappingResult mapped = NetEaseResponseMapper.mapPrimaryLyric(response.body);
            return mapped.isValid() ? AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK,
                    response.status, mapped.value, null) : error(request, mapped.errorCode);
        } catch (Exception ignored) {
            return error(request, "MALFORMED_PROVIDER_RESPONSE");
        }
    }

    static URI buildSearchUri(AndroidRpcContract.TypedRequest request) throws URISyntaxException {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_SEARCH) {
            throw new URISyntaxException("", "Unsupported operation");
        }
        return new NetEaseNativeProvider().buildSearchRequest(request.keyword, request.page).uri;
    }

    private static AndroidRpcContract.TypedReply responseError(AndroidRpcContract.TypedRequest request,
            NetEaseNativeProvider.Response response) {
        if (response == null) return error(request, "NETWORK_IO_ERROR");
        if (response.errorCode != null) {
            if ("NETWORK_TIMEOUT".equals(response.errorCode)) return error(request, "TIMEOUT");
            if ("CANCELLED".equals(response.errorCode)) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.CANCELLED, 0,
                        null, "CANCELLED");
            }
            return error(request, response.errorCode);
        }
        return error(request, NetEaseResponseMapper.errorForStatus(response.status));
    }

    private static AndroidRpcContract.TypedReply error(AndroidRpcContract.TypedRequest request,
            String code) {
        return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0, null,
                code == null ? "NETWORK_IO_ERROR" : code);
    }

    private static String operationString(AndroidRpcContract.TypedRequest request, String key) {
        if (request == null || request.operationPayload == null) return null;
        Object value = request.operationPayload.opt(key);
        return value instanceof String ? (String) value : null;
    }

    private static boolean isProviderId(String value) {
        return value != null && value.matches("[1-9][0-9]{0,17}");
    }

    static final class ProviderResponse {
        final int status;
        final String body;

        ProviderResponse(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private static final class CompatibilityTransport implements NetEaseNativeProvider.Transport {
        private final Transport delegate;

        CompatibilityTransport(Transport delegate) {
            this.delegate = delegate;
        }

        @Override
        public NetEaseNativeProvider.Response execute(NetEaseNativeProvider.Request request) throws Exception {
            if (delegate == null || request == null) return NetEaseNativeProvider.Response.error("NETWORK_IO_ERROR");
            ProviderResponse response = delegate.execute(request.uri);
            return response == null ? NetEaseNativeProvider.Response.error("NETWORK_IO_ERROR")
                    : new NetEaseNativeProvider.Response(response.status, response.body);
        }
    }
}
