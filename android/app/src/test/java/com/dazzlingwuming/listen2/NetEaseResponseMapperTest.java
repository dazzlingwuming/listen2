package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class NetEaseResponseMapperTest {
    @Test
    public void mapsEachActionableProviderStatusWithoutLeakingProviderData() {
        assertEquals("MEMBERSHIP_REQUIRED", NetEaseResponseMapper.errorForStatus(402));
        assertEquals("ENTITLEMENT_REQUIRED", NetEaseResponseMapper.errorForStatus(403));
        assertEquals("REGION_RESTRICTED", NetEaseResponseMapper.errorForStatus(451));
        assertEquals("DRM_RESTRICTED", NetEaseResponseMapper.errorForStatus(423));
        assertEquals("RATE_LIMIT", NetEaseResponseMapper.errorForStatus(429));
    }

    @Test
    public void projectsValidRowsIndependentlyAndDropsUnsafeOptionalData() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.neteaseSearch(
                "search", 1, "title", 1);
        NetEaseResponseMapper.MappingResult result = NetEaseResponseMapper.mapSearch(request,
                "{\"code\":200,\"result\":{\"songs\":["
                        + "{\"id\":1,\"name\":\"one\",\"artists\":[{\"name\":\"artist\"}],"
                        + "\"cover\":\"https://secret.example/signed\"},"
                        + "{\"id\":2,\"name\":\"<bad>\",\"artists\":[{\"name\":\"artist\"}]}"
                        + "]}}");
        assertTrue(result.isValid());
        assertEquals(1, result.value.getJSONArray("rows").length());
        assertFalse(result.value.toString().contains("secret.example"));
        assertFalse(result.value.toString().contains("signed"));
    }
}
