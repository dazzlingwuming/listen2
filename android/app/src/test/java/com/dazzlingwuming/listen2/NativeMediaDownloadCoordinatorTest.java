package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.platform.AndroidMediaCache;

import org.junit.Test;

import java.lang.reflect.Field;
import java.net.URI;
import java.util.Collections;

/** Coordinator tests use fake ports only; no provider or media transport is contacted. */
public final class NativeMediaDownloadCoordinatorTest {
    private static final String DIGEST = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test
    public void recordsOnlyVerifiedCacheCompletionAndReturnsPageSafeFields() {
        FakeCache cache = new FakeCache(new NativeMediaDownloadCoordinator.CacheResult(
                AndroidMediaCache.COMPLETED, 42L, DIGEST));
        FakeCatalog catalog = new FakeCatalog(true);
        NativeMediaDownloadCoordinator coordinator = coordinator(available(), cache, catalog);

        NativeMediaDownloadCoordinator.DownloadResult result = coordinator.download("op-1", descriptor(),
                NativeMediaDownloadCoordinator.Retention.DOWNLOAD);

        assertEquals(NativeMediaDownloadCoordinator.COMPLETED, result.status);
        assertEquals("bilibili", result.source);
        assertEquals("BV1abcDE1234", result.providerTrackId);
        assertEquals(42L, result.byteCount);
        assertEquals(DIGEST, result.digest);
        assertEquals("download", result.retention);
        assertEquals(1, cache.calls);
        assertEquals(1, catalog.calls);
        assertTrue(catalog.last.opaqueContentKey.matches("media\\.[0-9a-f]{64}"));
    }

    @Test
    public void cancellationRegistryStopsTheActiveOperationBeforeCataloguing() {
        FakeCache cache = new FakeCache(new NativeMediaDownloadCoordinator.CacheResult(
                AndroidMediaCache.CANCELLED, 0L, ""));
        FakeCatalog catalog = new FakeCatalog(true);
        final NativeMediaDownloadCoordinator[] holder = new NativeMediaDownloadCoordinator[1];
        cache.beforeResult = () -> {
            assertTrue(holder[0].cancel("op-cancel"));
            assertTrue(cache.cancellation.isCancelled());
        };
        holder[0] = coordinator(available(), cache, catalog);

        NativeMediaDownloadCoordinator.DownloadResult result = holder[0].download("op-cancel", descriptor(),
                NativeMediaDownloadCoordinator.Retention.TEMPORARY);

        assertEquals(NativeMediaDownloadCoordinator.CANCELLED, result.status);
        assertEquals(0, catalog.calls);
        assertFalse(holder[0].cancel("op-cancel"));
    }

    @Test
    public void unavailableCandidateNeverInvokesCacheOrCatalog() {
        FakeCache cache = new FakeCache(null);
        FakeCatalog catalog = new FakeCatalog(true);
        NativeMediaDownloadCoordinator coordinator = coordinator(
                ignored -> NativeMediaDownloadCoordinator.CandidateResolution.unavailable(), cache, catalog);

        assertEquals(NativeMediaDownloadCoordinator.CANDIDATE_UNAVAILABLE,
                coordinator.download("op-none", descriptor(), NativeMediaDownloadCoordinator.Retention.TEMPORARY).status);
        assertEquals(0, cache.calls);
        assertEquals(0, catalog.calls);
    }

    @Test
    public void sameTrackIsDeduplicatedWhileFirstOperationIsActive() {
        FakeCache cache = new FakeCache(new NativeMediaDownloadCoordinator.CacheResult(
                AndroidMediaCache.NETWORK_FAILED, 0L, ""));
        FakeCatalog catalog = new FakeCatalog(true);
        final NativeMediaDownloadCoordinator[] holder = new NativeMediaDownloadCoordinator[1];
        NativeMediaDownloadCoordinator.CandidateSource source = ignored -> {
            NativeMediaDownloadCoordinator.DownloadResult duplicate = holder[0].download("op-two", descriptor(),
                    NativeMediaDownloadCoordinator.Retention.TEMPORARY);
            assertEquals(NativeMediaDownloadCoordinator.DUPLICATE_TRACK, duplicate.status);
            return available().resolve(descriptor());
        };
        holder[0] = coordinator(source, cache, catalog);

        assertEquals(NativeMediaDownloadCoordinator.CACHE_FAILED,
                holder[0].download("op-one", descriptor(), NativeMediaDownloadCoordinator.Retention.TEMPORARY).status);
        assertEquals(1, cache.calls);
    }

    @Test
    public void catalogFailureDoesNotPretendTheDownloadCompleted() {
        FakeCache cache = new FakeCache(new NativeMediaDownloadCoordinator.CacheResult(
                AndroidMediaCache.ALREADY_CACHED, 42L, DIGEST));
        FakeCatalog catalog = new FakeCatalog(false);
        NativeMediaDownloadCoordinator coordinator = coordinator(available(), cache, catalog);

        NativeMediaDownloadCoordinator.DownloadResult result = coordinator.download("op-catalog", descriptor(),
                NativeMediaDownloadCoordinator.Retention.PLAYLIST);

        assertEquals(NativeMediaDownloadCoordinator.CATALOG_FAILED, result.status);
        assertEquals(42L, result.byteCount);
        assertEquals(DIGEST, result.digest);
        assertEquals(1, catalog.calls);
    }

    @Test
    public void terminalShapeHasNoTransportOrFilesystemField() {
        for (Field field : NativeMediaDownloadCoordinator.DownloadResult.class.getFields()) {
            String name = field.getName().toLowerCase(java.util.Locale.ROOT);
            assertFalse(name.contains("url"));
            assertFalse(name.contains("uri"));
            assertFalse(name.contains("path"));
            assertFalse(name.contains("header"));
            assertFalse(name.contains("candidate"));
            assertFalse(name.contains("file"));
        }
    }

    private static NativeMediaDownloadCoordinator coordinator(
            NativeMediaDownloadCoordinator.CandidateSource source, FakeCache cache, FakeCatalog catalog) {
        return new NativeMediaDownloadCoordinator(source, cache, catalog, 1_024L * 1_024L);
    }

    private static NativeMediaDownloadCoordinator.CandidateSource available() {
        return ignored -> NativeMediaDownloadCoordinator.CandidateResolution.available(Collections.singletonList(
                AndroidMediaCache.Candidate.fromPlaybackCandidate(AndroidMediaCache.Source.BILIBILI,
                        URI.create("https://audio.bilivideo.com/track.m4s?token=secret"))));
    }

    private static PlaybackMediaResolver.Descriptor descriptor() {
        return new PlaybackMediaResolver.Descriptor("bilibili", "BV1abcDE1234", 4L,
                "Track", "Artist", 2_000L, "audio");
    }

    private static final class FakeCache implements NativeMediaDownloadCoordinator.CachePort {
        final NativeMediaDownloadCoordinator.CacheResult result;
        int calls;
        Runnable beforeResult;
        AndroidMediaCache.Cancellation cancellation;
        FakeCache(NativeMediaDownloadCoordinator.CacheResult result) { this.result = result; }
        @Override public NativeMediaDownloadCoordinator.CacheResult cache(String key,
                AndroidMediaCache.Candidate candidate, long maxBytes, AndroidMediaCache.Cancellation cancellation) {
            calls++;
            this.cancellation = cancellation;
            if (beforeResult != null) beforeResult.run();
            return result;
        }
    }

    private static final class FakeCatalog implements NativeMediaDownloadCoordinator.CatalogPort {
        final boolean accepted;
        int calls;
        NativeMediaDownloadCoordinator.CatalogRecord last;
        FakeCatalog(boolean accepted) { this.accepted = accepted; }
        @Override public NativeMediaDownloadCoordinator.CatalogResult record(
                NativeMediaDownloadCoordinator.CatalogRecord record) {
            calls++;
            last = record;
            return accepted ? NativeMediaDownloadCoordinator.CatalogResult.accepted()
                    : NativeMediaDownloadCoordinator.CatalogResult.rejected();
        }
    }
}
