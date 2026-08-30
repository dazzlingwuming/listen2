package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Map;

public final class AndroidRpcContractTest {
    @Test
    public void neteaseSearchUsesAClosedPayloadAndNativeOwnedRoute() throws Exception {
        String raw = "{\"version\":2,\"operation\":\"netease.search\","
                + "\"requestId\":\"netease-1\",\"pageEpoch\":7,"
                + "\"payload\":{\"keyword\":\"Listen2\",\"page\":3}}";

        AndroidRpcContract.ParseResult parsed = AndroidRpcContract.parseRequest(raw);

        assertTrue(parsed.isValid());
        assertEquals(AndroidRpcContract.Operation.NETEASE_SEARCH, parsed.request.operation);
        assertEquals("https://music.163.com/api/search/get/web?s=Listen2&type=1&offset=40&limit=20",
                NetEaseProviderClient.buildSearchUri(parsed.request).toASCIIString());
        assertFalse(AndroidRpcContract.parseRequest(raw.replace("\"page\":3",
                "\"page\":3,\"url\":\"https://evil.example\"")).isValid());
        assertFalse(AndroidRpcContract.parseRequest(raw.replace("\"page\":3",
                "\"page\":3,\"headers\":{}")).isValid());
    }

    @Test
    public void neteaseSearchProjectsOnlySafeRowsAndPreservesTypedFailures() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.neteaseSearch(
                "netease-1", 7, "Listen2", 1);
        NetEaseResponseMapper.MappingResult mapped = NetEaseResponseMapper.mapSearch(request,
                "{\"code\":200,\"result\":{\"songCount\":2,\"songs\":["
                        + "{\"id\":1,\"name\":\"Safe title\",\"artists\":[{\"name\":\"Artist\"}],"
                        + "\"duration\":1234},{\"id\":\"bad\",\"name\":\"ignored\"}]}}");

        assertTrue(mapped.isValid());
        assertEquals("netease", mapped.value.getString("source"));
        assertEquals(1, mapped.value.getJSONArray("rows").length());
        assertFalse(mapped.value.toString().contains("https://"));
        assertEquals("RATE_LIMIT", NetEaseResponseMapper.errorForStatus(429));
        assertEquals("LOGIN_REQUIRED", NetEaseResponseMapper.errorForStatus(401));
        assertFalse(NetEaseResponseMapper.mapSearch(request, "{\"code\":500}").isValid());
    }
    @Test
    public void acceptsOnlyTheExactTypedSearchEnvelopeAndBuildsItsRouteNatively() throws Exception {
        AndroidRpcContract.TypedRequest request = new AndroidRpcContract.TypedRequest(
                "request-1", 7, AndroidRpcContract.Operation.BILIBILI_SEARCH, "Listen2", 3);
        assertEquals(null, AndroidRpcContract.validateInput(request.requestId, request.pageEpoch,
                request.operation, request.keyword, request.page));
        assertEquals("https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=3"
                        + "&page_size=20&keyword=Listen2&platform=pc",
                AndroidRpcContract.buildSearchUri(request).toASCIIString());
    }

    @Test
    public void rejectsUnknownTransportFieldsAndEveryInvalidIdentityBoundary() {
        assertEquals("INVALID_REQUEST_ID", AndroidRpcContract.validateInput("", 0,
                AndroidRpcContract.Operation.BILIBILI_SEARCH, "x", 1));
        assertEquals("INVALID_PAGE_EPOCH", AndroidRpcContract.validateInput("id", -1,
                AndroidRpcContract.Operation.BILIBILI_SEARCH, "x", 1));
        assertEquals("UNSUPPORTED_OPERATION", AndroidRpcContract.validateInput("id", 0,
                null, "x", 1));
        assertEquals("INVALID_PAYLOAD", AndroidRpcContract.validateInput("id", 0,
                AndroidRpcContract.Operation.BILIBILI_SEARCH, "x", 1001));
    }

    @Test
    public void legacyPolicyRemainsVersionOneAndDoesNotAcceptAdjacentHosts() {
        assertEquals(1, HttpBridgePolicy.PROTOCOL_VERSION);
        assertFalse(HttpBridgePolicy.validateRequest("GET",
                "https://api.bilibili.com.evil.example/x/web-interface/search/type").isValid());
    }

    @Test
    public void detailAndManifestHaveClosedPayloadsAndNativeRoutes() throws Exception {
        AndroidRpcContract.TypedRequest detail = AndroidRpcContract.TypedRequest.videoDetail(
                "detail", 3, "BV1xx411c7mD");
        assertEquals("https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
                AndroidRpcContract.buildVideoDetailUri(detail).toASCIIString());

        AndroidRpcContract.TypedRequest explicit = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 3, "BV1xx411c7mD", "explicit", 123L);
        assertTrue(AndroidRpcContract.buildAudioManifestUri(explicit).toASCIIString()
                .contains("bvid=BV1xx411c7mD&cid=123"));
        assertEquals("INVALID_PAYLOAD", AndroidRpcContract.validateManifestInput(
                "manifest", 3, "BV1xx411c7mD", "explicit", 0L));
        assertEquals("INVALID_PAYLOAD", AndroidRpcContract.validateManifestInput(
                "manifest", 3, "BV1xx411c7mD", "default-first", 123L));
    }

    @Test
    public void retriesOnlyClosedBilibiliMetadataWithoutAnonymousCookie() {
        AndroidRpcContract.TypedReply rejected = AndroidRpcContract.reply(
                AndroidRpcContract.TypedRequest.videoDetail("detail", 3, "BV1xx411c7mD"),
                AndroidRpcContract.Terminal.ERROR, 200, null, "PROVIDER_STATUS");
        assertTrue(AndroidHttpBridge.shouldRetryWithoutAnonymousCookie(
                AndroidRpcContract.TypedRequest.videoDetail("detail", 3, "BV1xx411c7mD"), rejected));
        assertTrue(AndroidHttpBridge.shouldRetryWithoutAnonymousCookie(
                new AndroidRpcContract.TypedRequest("search", 3,
                        AndroidRpcContract.Operation.BILIBILI_SEARCH, "test", 1), rejected));
        assertFalse(AndroidHttpBridge.shouldRetryWithoutAnonymousCookie(
                AndroidRpcContract.TypedRequest.audioManifest(
                        "manifest", 3, "BV1xx411c7mD", "explicit", 123L), rejected));
        assertFalse(AndroidHttpBridge.shouldRetryWithoutAnonymousCookie(
                AndroidRpcContract.TypedRequest.videoDetail("detail", 3, "BV1xx411c7mD"),
                AndroidRpcContract.reply(AndroidRpcContract.TypedRequest.videoDetail(
                        "detail", 3, "BV1xx411c7mD"), AndroidRpcContract.Terminal.ERROR,
                        200, null, "MALFORMED_PROVIDER_RESPONSE")));
    }

    @Test
    public void searchProjectionAllowsOnlyProviderKeywordEmphasisMarkup() throws Exception {
        AndroidRpcContract.TypedRequest request = new AndroidRpcContract.TypedRequest(
                "search", 1, AndroidRpcContract.Operation.BILIBILI_SEARCH, "test", 1);
        String highlighted = "{\"code\":0,\"data\":{\"result\":[{\"bvid\":\"BV1xx411c7mD\","
                + "\"title\":\"<em class=\\\"keyword\\\">Test</em> &amp; More\","
                + "\"author\":\"Author\",\"pic\":\"//i0.hdslb.com/test.jpg\"}],\"numResults\":1}}";
        AndroidRpcContract.ProjectionResult accepted =
                AndroidRpcContract.projectSearchResponse(request, highlighted);
        assertTrue(accepted.isValid());
        assertEquals("Test & More", accepted.result.getJSONArray("rows")
                .getJSONObject(0).getString("title"));

        String unsafe = highlighted.replace("<em class=\\\"keyword\\\">Test</em>",
                "<script>Test</script>");
        assertFalse(AndroidRpcContract.projectSearchResponse(request, unsafe).isValid());
    }

    @Test
    public void searchProjectionSkipsNonVideoRowsWhileRetainingSafeVideoRows() throws Exception {
        AndroidRpcContract.TypedRequest request = new AndroidRpcContract.TypedRequest(
                "search", 1, AndroidRpcContract.Operation.BILIBILI_SEARCH, "live", 1);
        String mixed = "{\"code\":0,\"data\":{\"result\":["
                + "{\"bvid\":\"BV1xx411c7mD\",\"title\":\"Safe video\","
                + "\"author\":\"Author\",\"pic\":\"//i0.hdslb.com/safe.jpg\"},"
                + "{\"bvid\":\"\",\"title\":\"Provider promotion\","
                + "\"author\":\"Provider\",\"pic\":\"//i0.hdslb.com/promotion.jpg\"},"
                + "{\"bvid\":\"not-a-bvid\",\"title\":\"Malformed row\","
                + "\"author\":\"Provider\"}],\"numResults\":3}}";

        AndroidRpcContract.ProjectionResult projected =
                AndroidRpcContract.projectSearchResponse(request, mixed);

        assertTrue(projected.isValid());
        assertEquals(3, projected.result.getInt("total"));
        assertEquals(1, projected.result.getJSONArray("rows").length());
        assertEquals("BV1xx411c7mD", projected.result.getJSONArray("rows")
                .getJSONObject(0).getString("bvid"));
    }

    @Test
    public void playbackUsesTheExistingTypedEnvelopeAndOnlyPassesClosedDomainFields() {
        String raw = "{\"version\":2,\"operation\":\"playback.command\","
                + "\"requestId\":\"playback-1\",\"pageEpoch\":4,\"payload\":{"
                + "\"expectedRevision\":0,\"command\":\"prepareSelection\",\"payload\":{"
                + "\"source\":\"bilibili\",\"providerTrackId\":\"BV1xx411c7mD\","
                + "\"providerPartId\":7,\"title\":\"Title\",\"artist\":\"Artist\","
                + "\"durationMs\":1234,\"mediaKind\":\"audio\"}}}";

        AndroidRpcContract.ParseResult parsed = AndroidRpcContract.parseRequest(raw);
        assertTrue(parsed.isValid());
        assertEquals(AndroidRpcContract.Operation.PLAYBACK_COMMAND, parsed.request.operation);
        Map<String, Object> envelope = AndroidRpcContract.toPlaybackEnvelope(parsed.request);
        assertEquals("playback-1", envelope.get("requestId"));
        assertEquals(4L, envelope.get("pageEpoch"));
        assertEquals("prepareSelection", envelope.get("command"));
        assertFalse(envelope.toString().contains("url"));

        String withArray = raw.replace("\"mediaKind\":\"audio\"",
                "\"mediaKind\":\"audio\",\"candidate\":[\"https://invalid.example\"]");
        AndroidRpcContract.ParseResult malformed = AndroidRpcContract.parseRequest(withArray);
        assertTrue(malformed.isValid());
        assertEquals(null, AndroidRpcContract.toPlaybackEnvelope(malformed.request));
    }

}
