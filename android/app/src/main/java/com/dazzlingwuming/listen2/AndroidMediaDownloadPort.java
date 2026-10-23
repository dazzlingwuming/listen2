package com.dazzlingwuming.listen2;

import com.dazzlingwuming.listen2.data.LocalDataRepository;
import com.dazzlingwuming.listen2.platform.AndroidMediaCache;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

/** Production owner for explicit Android downloads and page-safe operation state. */
final class AndroidMediaDownloadPort implements AndroidHttpBridge.MediaDownloadPort {
    private static final int MAX_RETAINED_OPERATIONS = 128;

    private final NativeMediaDownloadCoordinator coordinator;
    private final LocalDataRepository repository;
    private final Executor executor;
    private final Map<String, Operation> operations = Collections.synchronizedMap(
            new LinkedHashMap<String, Operation>(16, 0.75f, true) {
                @Override protected boolean removeEldestEntry(Map.Entry<String, Operation> eldest) {
                    return size() > MAX_RETAINED_OPERATIONS && eldest.getValue().terminal;
                }
            });

    AndroidMediaDownloadPort(AndroidMediaCache cache, LocalDataRepository repository,
            BilibiliPlaybackResolver bilibili, NetEasePlaybackResolver netease, Executor executor) {
        if (cache == null || repository == null || bilibili == null || netease == null || executor == null) {
            throw new IllegalArgumentException("native download dependencies required");
        }
        this.repository = repository;
        this.executor = executor;
        coordinator = new NativeMediaDownloadCoordinator(candidateSource(bilibili, netease),
                new NativeMediaDownloadCoordinator.AndroidCachePort(cache), record -> {
                    LocalDataRepository.Track track = new LocalDataRepository.Track(
                            record.descriptor.getSource(), record.descriptor.getProviderTrackId(),
                            record.descriptor.getTitle(), record.descriptor.getArtist(),
                            record.descriptor.getDurationMs());
                    LocalDataRepository.Result<LocalDataRepository.CacheView> result = repository.recordCache(
                            new LocalDataRepository.CacheRequest(record.cacheId, track,
                                    record.opaqueContentKey, record.byteCount,
                                    record.retention.wireValue));
                    return result != null && result.ok
                            ? NativeMediaDownloadCoordinator.CatalogResult.accepted()
                            : NativeMediaDownloadCoordinator.CatalogResult.rejected();
                }, 2L * 1024L * 1024L * 1024L);
    }

    @Override public AndroidHttpBridge.MediaDownloadReply start(String operationId,
            PlaybackMediaResolver.Descriptor descriptor, NativeMediaDownloadCoordinator.Retention retention) {
        if (!validOperation(operationId) || descriptor == null || !descriptor.isSafe() || retention == null) {
            return AndroidHttpBridge.MediaDownloadReply.invalid(operationId, descriptor, retention);
        }
        Operation operation = new Operation(operationId, descriptor, retention);
        synchronized (operations) {
            if (operations.containsKey(operationId)) return operations.get(operationId).reply();
            operations.put(operationId, operation);
        }
        try {
            executor.execute(() -> run(operation));
        } catch (RuntimeException ignored) {
            operation.complete(NativeMediaDownloadCoordinator.CACHE_FAILED, 0L);
        }
        return operation.reply();
    }

    @Override public AndroidHttpBridge.MediaDownloadReply status(String operationId) {
        if (!validOperation(operationId)) return AndroidHttpBridge.MediaDownloadReply.invalid(operationId, null, null);
        synchronized (operations) {
            Operation operation = operations.get(operationId);
            return operation == null ? AndroidHttpBridge.MediaDownloadReply.notFound(operationId) : operation.reply();
        }
    }

    @Override public AndroidHttpBridge.MediaDownloadReply cancel(String operationId) {
        if (!validOperation(operationId)) return AndroidHttpBridge.MediaDownloadReply.invalid(operationId, null, null);
        synchronized (operations) {
            Operation operation = operations.get(operationId);
            if (operation == null) return AndroidHttpBridge.MediaDownloadReply.notFound(operationId);
            operation.cancelled = true;
            coordinator.cancel(operationId);
            if ("queued".equals(operation.status)) operation.complete(NativeMediaDownloadCoordinator.CANCELLED, 0L);
            return operation.reply();
        }
    }

    @Override public AndroidHttpBridge.MediaDownloadReply delete(PlaybackMediaResolver.Descriptor descriptor) {
        if (descriptor == null || !descriptor.isSafe()) {
            return AndroidHttpBridge.MediaDownloadReply.invalid("", descriptor, null);
        }
        LocalDataRepository.Result<Void> result = repository.deleteCache(
                NativeMediaDownloadCoordinator.cacheIdFor(descriptor),
                NativeMediaDownloadCoordinator.contentKeyFor(descriptor));
        return AndroidHttpBridge.MediaDownloadReply.cacheAction(
                result != null && result.ok ? "deleted" : safeRepositoryStatus(result), descriptor);
    }

    @Override public AndroidHttpBridge.MediaDownloadReply cleanup() {
        LocalDataRepository.Result<LocalDataRepository.CacheSummary> result = repository.trimCache();
        return AndroidHttpBridge.MediaDownloadReply.cacheAction(
                result != null && result.ok ? "cleaned" : safeRepositoryStatus(result), null);
    }

    private void run(Operation operation) {
        if (operation.cancelled) {
            operation.complete(NativeMediaDownloadCoordinator.CANCELLED, 0L);
            return;
        }
        operation.status = "downloading";
        NativeMediaDownloadCoordinator.DownloadResult result = coordinator.download(operation.operationId,
                operation.descriptor, operation.retention);
        operation.complete(result == null ? NativeMediaDownloadCoordinator.CACHE_FAILED : result.status,
                result == null ? 0L : result.byteCount);
    }

    static NativeMediaDownloadCoordinator.CandidateSource candidateSource(
            BilibiliPlaybackResolver bilibili, NetEasePlaybackResolver netease) {
        return descriptor -> {
            PlaybackMediaResolver.ManifestPort resolver = "bilibili".equals(descriptor.getSource())
                    ? bilibili : "netease".equals(descriptor.getSource()) ? netease : null;
            if (resolver == null) return NativeMediaDownloadCoordinator.CandidateResolution.unavailable();
            List<String> resolved = resolver.resolve(descriptor);
            if (resolved == null || resolved.isEmpty() || resolved.size() > 4) {
                return NativeMediaDownloadCoordinator.CandidateResolution.unavailable();
            }
            AndroidMediaCache.Source source = "bilibili".equals(descriptor.getSource())
                    ? AndroidMediaCache.Source.BILIBILI : AndroidMediaCache.Source.NETEASE;
            List<AndroidMediaCache.Candidate> candidates = new ArrayList<>();
            for (String value : resolved) {
                try {
                    AndroidMediaCache.Candidate candidate = AndroidMediaCache.Candidate.fromPlaybackCandidate(
                            source, new URI(value));
                    if (candidate != null) candidates.add(candidate);
                } catch (URISyntaxException | RuntimeException ignored) {
                    return NativeMediaDownloadCoordinator.CandidateResolution.unavailable();
                }
            }
            return NativeMediaDownloadCoordinator.CandidateResolution.available(candidates);
        };
    }

    private static String safeRepositoryStatus(LocalDataRepository.Result<?> result) {
        if (result == null || result.status == null) return "failed";
        if (LocalDataRepository.NOT_FOUND.equals(result.status)) return "not-found";
        if (LocalDataRepository.IO_UNAVAILABLE.equals(result.status)) return "storage-unavailable";
        return "failed";
    }

    private static boolean validOperation(String value) {
        return value != null && value.matches("[A-Za-z0-9._-]{1,96}");
    }

    private static final class Operation {
        final String operationId;
        final PlaybackMediaResolver.Descriptor descriptor;
        final NativeMediaDownloadCoordinator.Retention retention;
        volatile String status = "queued";
        volatile long byteCount;
        volatile boolean terminal;
        volatile boolean cancelled;
        Operation(String operationId, PlaybackMediaResolver.Descriptor descriptor,
                NativeMediaDownloadCoordinator.Retention retention) {
            this.operationId = operationId;
            this.descriptor = descriptor;
            this.retention = retention;
        }
        void complete(String nativeStatus, long bytes) {
            byteCount = Math.max(0L, bytes);
            if (NativeMediaDownloadCoordinator.COMPLETED.equals(nativeStatus)) status = "completed";
            else if (NativeMediaDownloadCoordinator.CANCELLED.equals(nativeStatus)) status = "cancelled";
            else status = "failed";
            terminal = true;
        }
        AndroidHttpBridge.MediaDownloadReply reply() {
            return AndroidHttpBridge.MediaDownloadReply.operation(operationId, status, descriptor,
                    byteCount, retention);
        }
    }
}
