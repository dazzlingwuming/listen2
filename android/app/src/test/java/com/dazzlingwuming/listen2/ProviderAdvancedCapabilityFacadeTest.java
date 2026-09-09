package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.provider.AdvancedPlaybackCapabilities;
import com.dazzlingwuming.listen2.provider.BilibiliAccountSession;
import com.dazzlingwuming.listen2.provider.ProviderCapabilityFacade;
import com.dazzlingwuming.listen2.library.AndroidLocalDataFacade;

import org.junit.Test;
import org.json.JSONObject;

import java.net.URI;
import java.util.Collections;

/** Contract coverage for the Android-only provider/account/advanced-media seams. */
public final class ProviderAdvancedCapabilityFacadeTest {
    @Test
    public void capabilityHandshakeIsClosedAndTracksNativeNeteaseTruth() throws Exception {
        ProviderCapabilityFacade unavailable = ProviderCapabilityFacade.production();
        assertTrue(unavailable.get("bilibili").isSearchAvailable());
        assertTrue(unavailable.get("netease").isSearchAvailable());
        assertTrue(unavailable.toJson().getJSONObject("netease").getBoolean("directory"));
        assertTrue(unavailable.toJson().getJSONObject("netease").getBoolean("media"));
        assertTrue(unavailable.toJson().getJSONObject("netease").getBoolean("lyric"));
        assertFalse(unavailable.toJson().getJSONObject("netease").getBoolean("manualLyric"));
        assertFalse(unavailable.toJson().toString().contains("http"));
        assertEquals(Boolean.FALSE, unavailable.toJson().getBoolean("deepSeekTranslation"));
        assertEquals(Boolean.TRUE, unavailable.withDeepSeekTranslation(true).toJson()
                .getBoolean("deepSeekTranslation"));

        ProviderCapabilityFacade routed = new ProviderCapabilityFacade(true);
        assertTrue(routed.toJson().getJSONObject("netease").getBoolean("search"));
        assertFalse(routed.toJson().getJSONObject("netease").getBoolean("directory"));

        AndroidRpcContract.ParseResult parsed = AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"provider.capabilities\",\"requestId\":\"caps-1\","
                        + "\"pageEpoch\":1,\"payload\":{}}");
        assertTrue(parsed.isValid());
        assertEquals(AndroidRpcContract.Operation.PROVIDER_CAPABILITIES, parsed.request.operation);
        assertFalse(AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"provider.capabilities\",\"requestId\":\"caps-1\","
                        + "\"pageEpoch\":1,\"payload\":{\"url\":\"https://evil.example\"}}").isValid());
    }

    @Test
    public void localDataOperationsAcceptOnlyNamedActionsWithAnObjectPayload() {
        assertTrue(AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"local.data.query\",\"requestId\":\"local-1\","
                        + "\"pageEpoch\":1,\"payload\":{\"action\":\"cache\",\"payload\":{}}}").isValid());
        assertTrue(AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"local.data.command\",\"requestId\":\"local-2\","
                        + "\"pageEpoch\":1,\"payload\":{\"action\":\"history.clear\",\"payload\":{}}}").isValid());
        assertFalse(AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"local.data.query\",\"requestId\":\"local-3\","
                        + "\"pageEpoch\":1,\"payload\":{\"action\":\"url.fetch\",\"payload\":{}}}").isValid());
        assertFalse(AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"local.data.command\",\"requestId\":\"local-4\","
                        + "\"pageEpoch\":1,\"payload\":{\"action\":\"cache.directory\",\"payload\":[],\"url\":\"x\"}}").isValid());
        assertTrue(AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"local.data.command\",\"requestId\":\"local-5\","
                        + "\"pageEpoch\":1,\"payload\":{\"action\":\"saf.pickAudio\",\"payload\":{}}}").isValid());
        assertTrue(AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"local.data.command\",\"requestId\":\"local-6\","
                        + "\"pageEpoch\":1,\"payload\":{\"action\":\"saf.pickTree\",\"payload\":{}}}").isValid());
    }

    @Test
    public void backupPageDtoAcceptsExportShapeAndRejectsPathLikeMetadata() throws Exception {
        String safe = "{\"version\":1,\"playlists\":[{\"playlistId\":\"p-1\",\"name\":\"Road trip\","
                + "\"ordinal\":0,\"revision\":1,\"tracks\":[{\"source\":\"bilibili\","
                + "\"providerTrackId\":\"BV1abcDE1234\",\"title\":\"Song\",\"artist\":\"Artist\","
                + "\"durationMs\":1234}]}],\"favorites\":[{\"source\":\"netease\","
                + "\"providerTrackId\":\"123\",\"title\":\"Fav\",\"artist\":\"Artist\",\"addedAtMs\":1}]}";
        AndroidLocalDataFacade.PageBackupInput parsed = AndroidHttpBridge.pageBackupFromJson(new JSONObject(safe));
        assertNotNull(parsed);
        assertTrue(AndroidLocalDataFacade.buildPageSafeBackup(parsed).ok);

        String evil = safe.replace("\"Song\"", "\"/Users/private/song.mp3\"");
        assertEquals(null, AndroidHttpBridge.pageBackupFromJson(new JSONObject(evil)));
        String unknownField = safe.replace("\"addedAtMs\":1", "\"addedAtMs\":1,\"uri\":\"content://x\"");
        assertEquals(null, AndroidHttpBridge.pageBackupFromJson(new JSONObject(unknownField)));
    }

    @Test
    public void accountStateMachineNeverProjectsChallengeOrCredential() {
        RecordingVault vault = new RecordingVault();
        BilibiliAccountSession session = new BilibiliAccountSession(new BilibiliAccountSession.QrGateway() {
            @Override public BilibiliAccountSession.QrChallenge begin() {
                return new BilibiliAccountSession.QrChallenge("gateway-only-challenge",
                        "https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=renderOnly_1",
                        2_000L);
            }
            @Override public BilibiliAccountSession.PollResult poll(String opaqueChallenge) {
                assertEquals("gateway-only-challenge", opaqueChallenge);
                return new BilibiliAccountSession.PollResult(
                        BilibiliAccountSession.Status.AUTHENTICATED, "refresh-material");
            }
            @Override public void logout() { }
        }, vault);

        BilibiliAccountSession.PublicState waiting = session.begin(1_000L);
        assertEquals(BilibiliAccountSession.Status.WAITING, waiting.getStatus());
        assertEquals("https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=renderOnly_1",
                waiting.getQrUrl());
        BilibiliAccountSession.PublicState authenticated = session.poll(waiting.getSessionId(), 1_100L);
        assertEquals(BilibiliAccountSession.Status.AUTHENTICATED, authenticated.getStatus());
        assertEquals("refresh-material", vault.saved);
        assertFalse(authenticated.getSessionId().contains("challenge"));
        assertFalse(authenticated.getSessionId().contains("refresh"));
        assertEquals("", authenticated.getQrUrl());

        BilibiliAccountSession unavailable = new BilibiliAccountSession(null, null);
        assertEquals(BilibiliAccountSession.Status.UNAVAILABLE, unavailable.begin(1_000L).getStatus());

        assertUnsafeQr(vault, "https://passport.bilibili.com.evil.example/h5-app/passport/login/scan?qrcode_key=key");
        assertUnsafeQr(vault, "https://passport.bilibili.com/h5-app/passport/login/other?qrcode_key=key");
        assertUnsafeQr(vault, "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=key&token=no");
        assertUnsafeQr(vault, "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=key&qrcode_key=again");

        AndroidRpcContract.ParseResult poll = AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"bilibili.account.qr.poll\",\"requestId\":\"account-1\","
                        + "\"pageEpoch\":1,\"payload\":{\"sessionId\":\"safe-id-1\"}}");
        assertTrue(poll.isValid());
        assertFalse(AndroidRpcContract.parseRequest(
                "{\"version\":2,\"operation\":\"bilibili.account.qr.poll\",\"requestId\":\"account-1\","
                        + "\"pageEpoch\":1,\"payload\":{\"sessionId\":\"safe-id-1\",\"cookie\":\"no\"}}").isValid());
    }

    @Test
    public void cacheUriSeamKeepsProviderCandidateOutOfSnapshot() {
        PlaybackMediaResolver resolver = new PlaybackMediaResolver(
                descriptor -> Collections.singletonList(
                        "https://a.bilivideo.com/audio.m4s?deadline=9999999999"),
                new PlaybackMediaResolver.IncrementingHandleSource("cache"), () -> 1_000L,
                (descriptor, candidate) -> URI.create("content://com.dazzlingwuming.listen2.cache/item-1"));
        PlaybackMediaResolver.Prepared prepared = resolver.prepare(new PlaybackMediaResolver.Descriptor(
                "bilibili", "BV1abcDE1234", 7L, "title", "artist", 1_000L, "audio"));
        assertNotNull(prepared);
        assertTrue(resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 2L,
                "replace-current", true).isAccepted());
        PlaybackMediaResolver.Resolution result = resolver.resolveCurrent(prepared.getOccurrenceId(), 2L);
        assertTrue(result.isReady());
        assertEquals("content", result.mediaUris().get(0).getScheme());
        assertFalse(result.toSnapshotFields().toString().contains("candidate"));
    }

    @Test
    public void advancedCapabilitiesAreExplicitlyUnavailableUntilNativeOwnersExist() {
        PlaybackSnapshot snapshot = new PlaybackSnapshot(1, 1L, 1L, PlaybackSnapshot.State.PAUSED,
                new PlaybackSnapshot.Metadata("title", "artist", 1_000L, "bundled-placeholder"),
                0L, 1_000L, 100, false, PlaybackSnapshot.Mode.SEQUENTIAL,
                new PlaybackSnapshot.ActionAvailability(true, false, false, false, true, true),
                Collections.<PlaybackSnapshot.QueueOccurrence>emptyList(), null,
                new PlaybackSnapshot.RecoveryStatus("ready", false), PlaybackSnapshot.LyricContext.unavailable(),
                AdvancedPlaybackCapabilities.unavailable());
        assertEquals(Boolean.FALSE, ((java.util.Map<?, ?>) snapshot.toMap().get("advancedPlayback"))
                .get("deepSeekTranslation"));
        assertFalse(snapshot.toMap().toString().contains("url"));
    }

    private static final class RecordingVault implements BilibiliAccountSession.CredentialVault {
        String saved;
        @Override public boolean isAvailable() { return true; }
        @Override public void save(String refreshMaterial) { saved = refreshMaterial; }
        @Override public void clear() { saved = null; }
    }

    private static void assertUnsafeQr(RecordingVault vault, String url) {
        BilibiliAccountSession unsafeQr = new BilibiliAccountSession(new BilibiliAccountSession.QrGateway() {
            @Override public BilibiliAccountSession.QrChallenge begin() {
                return new BilibiliAccountSession.QrChallenge("opaque", url, 2_000L);
            }
            @Override public BilibiliAccountSession.PollResult poll(String ignored) { return null; }
            @Override public void logout() { }
        }, vault);
        assertEquals(BilibiliAccountSession.Status.ERROR, unsafeQr.begin(1_000L).getStatus());
    }
}
