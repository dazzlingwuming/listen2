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
    public void everyNeteaseAndLyricOperationHasOnlyItsSemanticPayload() {
        assertOperation("netease.directory.detail", "{\"trackId\":\"123\"}");
        assertOperation("netease.rendition.default",
                "{\"trackId\":\"123\",\"selectionRevision\":4}");
        assertOperation("netease.lyric.primary", lyricIdentityPayload(""));
        assertOperation("netease.lyric.search", lyricIdentityPayload(",\"keyword\":\"title\""));
        assertOperation("lyric.selection.get", lyricIdentityPayload(""));
        assertOperation("lyric.selection.set", lyricIdentityPayload(",\"lyricId\":\"candidate-1\""));
        assertOperation("lyric.selection.clear", lyricIdentityPayload(""));
        assertOperation("lyric.offset.set", lyricIdentityPayload(",\"offsetMs\":500"));

        assertFalse(AndroidRpcContract.parseRequest(request("netease.rendition.default",
                "{\"trackId\":\"123\",\"selectionRevision\":4,\"quality\":\"lossless\"}"))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.offset.set",
                lyricIdentityPayload(",\"offsetMs\":500,\"cookie\":\"no\""))).isValid());
    }

    @Test
    public void mediaDownloadOperationsAcceptOnlySemanticDescriptorsAndOpaqueOperationIds() {
        String descriptor = "{\"source\":\"bilibili\",\"providerTrackId\":\"BV1xx411c7mD\","
                + "\"providerPartId\":7,\"title\":\"Title\",\"artist\":\"Artist\","
                + "\"durationMs\":120000,\"mediaKind\":\"audio\"}";
        assertOperation("media.download.start", "{\"operationId\":\"download-1\","
                + "\"descriptor\":" + descriptor + ",\"retention\":\"download\"}");
        assertOperation("media.download.status", "{\"operationId\":\"download-1\"}");
        assertOperation("media.download.cancel", "{\"operationId\":\"download-1\"}");
        assertOperation("media.download.delete", "{\"descriptor\":" + descriptor + "}");
        assertOperation("media.download.cleanup", "{}");
        assertFalse(AndroidRpcContract.parseRequest(request("media.download.start",
                "{\"operationId\":\"download-1\",\"descriptor\":" + descriptor
                        + ",\"retention\":\"download\",\"url\":\"https://evil.example\"}"))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("media.download.start",
                "{\"operationId\":\"download-1\",\"descriptor\":" + descriptor.replace(
                        "\"mediaKind\":\"audio\"", "\"mediaKind\":\"audio\",\"headers\":{}")
                        + ",\"retention\":\"download\"}"))
                .isValid());
    }

    @Test
    public void bilibiliDirectoryAndLyricRejectFractionalSemanticNumbers() {
        assertOperation("bilibili.directory.page", "{\"page\":1}");
        assertOperation("bilibili.directory.detail", "{\"playlistId\":\"42\"}");
        String lyric = "{\"bvid\":\"BV1xx411c7mD\",\"cid\":101,"
                + "\"title\":\"Title\",\"artist\":\"Artist\",\"durationSeconds\":201,"
                + "\"selectionIdentity\":\"bitrack_v_BV1xx411c7mD-101\","
                + "\"selectionRevision\":0,\"selectionToken\":\"bili.BV1xx411c7mD.101\"}";
        assertOperation("bilibili.lyric.primary", lyric);
        assertFalse(AndroidRpcContract.parseRequest(request("bilibili.directory.page",
                "{\"page\":1.5}")).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("bilibili.lyric.primary",
                lyric.replace("\"cid\":101", "\"cid\":101.5"))).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("bilibili.lyric.primary",
                lyric.replace("\"selectionRevision\":0", "\"selectionRevision\":0.5"))).isValid());
    }

    @Test
    public void lyricContentOperationsUseClosedIdentityAndContentFieldSets() {
        String getPayload = lyricContentGetPayload();
        String putPayload = lyricContentPutPayload("[00:01.00]Original", "[00:01.00]译文");

        assertOperation("lyric.content.get", getPayload);
        assertOperation("lyric.content.put", putPayload);
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"transitionToken\":\"read.v1\"",
                        "\"transitionToken\":\"read.v1\",\"originalText\":\"forbidden\"")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.put",
                putPayload.replace("\"translationText\":\"[00:01.00]译文\"",
                        "\"translationText\":\"[00:01.00]译文\",\"url\":\"https://evil.example\"")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace(",\"transitionToken\":\"read.v1\"", ""))).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.put",
                putPayload.replace(",\"translationText\":\"[00:01.00]译文\"", ""))).isValid());
    }

    @Test
    public void lyricContentIdentityAcceptsOnlyApprovedSourcesAndBoundedRevisionTokens() {
        String getPayload = lyricContentGetPayload();
        String putPayload = lyricContentPutPayload("original", "translation");
        String localTrackId = "local.track." + repeat('a', 64);

        assertOperation("lyric.content.get", getPayload);
        assertOperation("lyric.content.get", getPayload
                .replace("\"source\":\"netease\"", "\"source\":\"bilibili\"")
                .replace("\"providerTrackId\":\"123\"", "\"providerTrackId\":\"BV1xx411c7mD\"")
                .replace("\"providerPartId\":0", "\"providerPartId\":7"));
        assertOperation("lyric.content.get", getPayload
                .replace("\"source\":\"netease\"", "\"source\":\"local\"")
                .replace("\"providerTrackId\":\"123\"", "\"providerTrackId\":\"" + localTrackId + "\""));

        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"source\":\"netease\"", "\"source\":\"spotify\"")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.put",
                putPayload.replace("\"source\":\"netease\"", "\"source\":\"spotify\"")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"providerTrackId\":\"123\"", "\"providerTrackId\":\"0\"")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"providerTrackId\":\"123\"",
                        "\"providerTrackId\":\"1234567890123456789\""))).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"providerPartId\":0", "\"providerPartId\":-1")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"providerPartId\":0", "\"providerPartId\":1.5")))
                .isValid());

        assertOperation("lyric.content.get", getPayload.replace("\"expectedRevision\":0",
                "\"expectedRevision\":2147483647"));
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"expectedRevision\":0", "\"expectedRevision\":-1")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"expectedRevision\":0", "\"expectedRevision\":1.5")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.put",
                putPayload.replace("\"expectedRevision\":0", "\"expectedRevision\":1.5")))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"lyricRevision\":\"content.v1\"",
                        "\"lyricRevision\":\"content/v1\""))).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"transitionToken\":\"read.v1\"",
                        "\"transitionToken\":\"read/v1\""))).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.get",
                getPayload.replace("\"transitionToken\":\"read.v1\"",
                        "\"transitionToken\":\"" + repeat('t', 129) + "\""))).isValid());
    }

    @Test
    public void lyricContentPutRejectsBlankAndOversizedText() {
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.put",
                lyricContentPutPayload("", "translation"))).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.put",
                lyricContentPutPayload("original", "   "))).isValid());

        String oversized = repeat('x', AndroidRpcContract.MAX_LYRIC_CONTENT_BYTES + 1);
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.put",
                lyricContentPutPayload(oversized, "translation"))).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("lyric.content.put",
                lyricContentPutPayload("original", oversized))).isValid());
    }

    private static void assertOperation(String operation, String payload) {
        AndroidRpcContract.ParseResult parsed = AndroidRpcContract.parseRequest(request(operation, payload));
        assertTrue(operation, parsed.isValid());
        assertEquals(operation, parsed.request.operation.wireName);
    }

    private static String request(String operation, String payload) {
        return "{\"version\":2,\"operation\":\"" + operation + "\",\"requestId\":\"op-1\","
                + "\"pageEpoch\":3,\"payload\":" + payload + "}";
    }

    private static String lyricIdentityPayload(String extra) {
        return "{\"trackId\":\"123\",\"selectionIdentity\":\"netease:123\","
                + "\"selectionRevision\":4,\"selectionToken\":\"token-1\"" + extra + "}";
    }

    private static String lyricContentGetPayload() {
        return "{\"source\":\"netease\",\"providerTrackId\":\"123\","
                + "\"providerPartId\":0,\"lyricRevision\":\"content.v1\","
                + "\"expectedRevision\":0,\"transitionToken\":\"read.v1\"}";
    }

    private static String lyricContentPutPayload(String originalText, String translationText) {
        return "{\"source\":\"netease\",\"providerTrackId\":\"123\","
                + "\"providerPartId\":0,\"lyricRevision\":\"content.v1\","
                + "\"expectedRevision\":0,\"transitionToken\":\"put.v1\","
                + "\"originalText\":\"" + originalText + "\","
                + "\"translationText\":\"" + translationText + "\"}";
    }

    private static String repeat(char value, int length) {
        StringBuilder builder = new StringBuilder(length);
        for (int index = 0; index < length; index += 1) builder.append(value);
        return builder.toString();
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
        assertFalse("The page cannot request a manifest or observe CDN candidates",
                AndroidRpcContract.parseRequest(request("bilibili.audio.manifest",
                        "{\"bvid\":\"BV1xx411c7mD\",\"selectionMode\":\"explicit\",\"cid\":123}"))
                .isValid());
    }

    @Test
    public void deepSeekOperationsHaveClosedSemanticPayloadsAndFullConsent() {
        assertOperation("deepseek.translation.status", "{}");
        assertOperation("deepseek.translation.test", "{}");
        assertOperation("deepseek.translation.delete", "{}");
        assertOperation("deepseek.translation.configure", "{\"apiKey\":\"fixture-secret\"}");
        String consent = "\"consent\":{\"lyrics\":true,\"title\":true,\"artist\":true,"
                + "\"possibleCost\":true,\"cancellation\":true,\"failureImpact\":true,"
                + "\"acceptedAtEpochMs\":1725000000000}";
        assertOperation("deepseek.translation.translate", "{\"lyric\":\"[00:01.00]One\","
                + "\"title\":\"Title\",\"artist\":\"Artist\",\"styleHint\":\"\","
                + consent + "}");
        assertFalse(AndroidRpcContract.parseRequest(request("deepseek.translation.status",
                "{\"url\":\"https://evil.example\"}")).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("deepseek.translation.translate",
                "{\"lyric\":\"[00:01.00]One\",\"title\":\"Title\","
                        + "\"artist\":\"Artist\",\"styleHint\":\"\","
                        + "\"consent\":{\"lyrics\":true}}" )).isValid());
    }

    @Test
    public void localTrackQueryAndMaintenanceCommandsHaveClosedSemanticPayloads() {
        String query = request("local.data.query",
                "{\"action\":\"localTracks\",\"payload\":{}}");
        AndroidRpcContract.ParseResult queryResult = AndroidRpcContract.parseRequest(query);
        assertTrue(queryResult.isValid());
        assertEquals(AndroidRpcContract.Operation.LOCAL_DATA_QUERY, queryResult.request.operation);

        AndroidRpcContract.ParseResult refresh = AndroidRpcContract.parseRequest(request(
                "local.data.command", "{\"action\":\"localTracks.refresh\",\"payload\":{}}"));
        assertTrue(refresh.isValid());

        AndroidRpcContract.ParseResult repair = AndroidRpcContract.parseRequest(request(
                "local.data.command",
                "{\"action\":\"localTracks.repair\",\"payload\":{\"grantReferenceId\":\"saf.tree.1\"}}"));
        assertTrue(repair.isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("local.data.query",
                "{\"action\":\"localTracks\"}"))
                .isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("local.data.command",
                "{\"action\":\"localTracks.repair\",\"payload\":null}"))
                .isValid());
    }

    @Test
    public void localLyricPrimaryAcceptsOnlyOneOpaqueLocalTrackIdentity() {
        String localTrackId = "local.track.0123456789abcdef0123456789abcdef"
                + "0123456789abcdef0123456789abcdef";
        AndroidRpcContract.ParseResult valid = AndroidRpcContract.parseRequest(request(
                "local.lyric.primary", "{\"localTrackId\":\"" + localTrackId + "\"}"));
        assertTrue(valid.isValid());
        assertEquals(AndroidRpcContract.Operation.LOCAL_LYRIC_PRIMARY, valid.request.operation);
        assertFalse(AndroidRpcContract.parseRequest(request("local.lyric.primary",
                "{\"localTrackId\":\"content://provider/tree/private\"}")).isValid());
        assertFalse(AndroidRpcContract.parseRequest(request("local.lyric.primary",
                "{\"localTrackId\":\"" + localTrackId + "\",\"uri\":\"content://x\"}"))
                .isValid());
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
