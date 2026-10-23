package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class NetEaseCryptoTest {
    @Test
    public void weapiMatchesTheReferenceAlgorithmForAStableSecret() {
        String json = "{\"id\":123,\"offset\":0,\"total\":true,\"limit\":1000,"
                + "\"n\":1000,\"csrf_token\":\"\"}";
        NetEaseCrypto.WeapiPayload payload = NetEaseCrypto.encryptWeapi(json, "0123456789abcdef");

        assertEquals("DGPuV43Kmf8z0bI+EMqg1Fc2HqC+o+kgI/RPLnhydG9aQ01Gwpv7W8wH/a8je+WATJoBBAPmlh167/bEAPZq1bP+u/Cf7/pcNrSH5AY38o9bvzu2DCFHquJZoYMB4FuFDciv67HOZT5qcA11n9oOrw==",
                payload.params);
        assertEquals("35701388baf89fed412e11269b9c76625d095ecaf17f03fa018abe19ea2d38b949debf242ee39a71ca1f6cda71b1b86a45aa909ee27f7e78e267d34e732f0de948206c3340a788d0003372183e2f753c1f78b66ac23d134ac1fc9b993156520ea826b8aa89a962d4491b4b8d7e08738e1da9b07aa39bf4a7ef0b1c210728cd52",
                payload.encSecKey);
    }

    @Test
    public void eapiMatchesTheReferenceAlgorithmForStableInput() {
        String json = "{\"ids\":\"[123]\",\"br\":999000}";
        assertEquals("FA90B329E9614F79E79598F37DC2EDB430F8378D2A2796338F0BFDEAEF824A22975CDA9D96D79E6DC4A59218CDB8199F6E08020A76A50DAED5B74A932D70447E69297106FBA90EEE42CEE9221728150315A0477E7191716D171BA4A6E2607DDE3F86CCEA73C4F59CD7FC35904D9D8995EF2217DB1EEDB6B6FAFC7FD09A358F66",
                NetEaseCrypto.encryptEapi("/api/song/enhance/player/url", json));
    }
}
