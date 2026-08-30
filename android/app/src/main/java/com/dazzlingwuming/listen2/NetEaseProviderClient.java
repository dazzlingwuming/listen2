package com.dazzlingwuming.listen2;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Native-owned NetEase request seam. The packaged page supplies only a named
 * operation and semantic values; this class constructs every route itself.
 * No approved live route is configured yet, so default execution fails closed.
 */
final class NetEaseProviderClient {
    static final String HOST = "music.163.com";
    static final String SEARCH_PATH = "/api/search/get/web";
    private static final int PAGE_SIZE = 20;

    interface Transport {
        ProviderResponse execute(URI uri) throws Exception;
    }

    private final Transport transport;

    NetEaseProviderClient() {
        this(null);
    }

    NetEaseProviderClient(Transport transport) {
        this.transport = transport;
    }

    AndroidRpcContract.TypedReply executeSearch(AndroidRpcContract.TypedRequest request) {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_SEARCH) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "UNSUPPORTED_OPERATION");
        }
        if (transport == null) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "NETEASE_ROUTE_UNAVAILABLE");
        }
        try {
            ProviderResponse response = transport.execute(buildSearchUri(request));
            if (response == null) return AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.ERROR, 0, null, "NETWORK_IO_ERROR");
            if (response.status < 200 || response.status >= 300) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR,
                        response.status, null, NetEaseResponseMapper.errorForStatus(response.status));
            }
            NetEaseResponseMapper.MappingResult mapped = NetEaseResponseMapper.mapSearch(request,
                    response.body);
            return mapped.isValid() ? AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.OK, response.status, mapped.value, null)
                    : AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR,
                    response.status, null, mapped.errorCode);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.CANCELLED, 0,
                    null, "CANCELLED");
        } catch (URISyntaxException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "INVALID_PAYLOAD");
        } catch (Exception ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "NETWORK_IO_ERROR");
        }
    }

    static URI buildSearchUri(AndroidRpcContract.TypedRequest request) throws URISyntaxException {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_SEARCH) {
            throw new URISyntaxException("", "Unsupported operation");
        }
        long offset = ((long) request.page - 1L) * PAGE_SIZE;
        String query = "s=" + URLEncoder.encode(request.keyword, StandardCharsets.UTF_8)
                + "&type=1&offset=" + offset + "&limit=" + PAGE_SIZE;
        return new URI("https", null, HOST, -1, SEARCH_PATH, query, null);
    }

    static final class ProviderResponse {
        final int status;
        final String body;
        ProviderResponse(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }
}
