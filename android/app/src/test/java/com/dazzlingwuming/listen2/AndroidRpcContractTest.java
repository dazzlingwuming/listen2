package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class AndroidRpcContractTest {
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

}
