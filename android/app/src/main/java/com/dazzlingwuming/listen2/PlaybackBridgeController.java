package com.dazzlingwuming.listen2;

import java.util.Map;

/**
 * Disposable packaged-page authority around the service-owned playback port.
 *
 * <p>This class owns neither an Android player nor a service lifetime. Its only
 * state is the current packaged-page epoch, bounded command validation, and a
 * monotonically delivered sanitized snapshot. Detaching a renderer deliberately
 * leaves the service untouched so Activity/WebView teardown cannot pause or
 * release background audio.</p>
 */
public final class PlaybackBridgeController {
    /** The sole playback owner implements this process-local port. */
    public interface ServicePort {
        void dispatch(PlaybackCommand command, PlaybackSnapshot snapshot);
        void rendererDetached();
        PlaybackSnapshot latestSnapshot();
    }

    /** AndroidHttpBridge adapts this callback to the existing reply proxy. */
    public interface PageSink {
        void publish(PlaybackSnapshot snapshot);
    }

    public static final class Reply {
        private final boolean accepted;
        private final PlaybackSnapshot snapshot;
        private final String errorCode;

        private Reply(boolean accepted, PlaybackSnapshot snapshot, String errorCode) {
            this.accepted = accepted;
            this.snapshot = snapshot;
            this.errorCode = errorCode;
        }

        static Reply accepted(PlaybackSnapshot snapshot) {
            return new Reply(true, snapshot, null);
        }

        static Reply error(String errorCode) {
            return new Reply(false, null, errorCode);
        }

        public boolean isAccepted() { return accepted; }
        public PlaybackSnapshot getSnapshot() { return snapshot; }
        public String getErrorCode() { return errorCode; }
    }

    private final ServicePort service;
    private PlaybackBridgePolicy policy;
    private PageSink pageSink;
    private long pageEpoch = -1L;
    private long deliveredRevision = -1L;

    public PlaybackBridgeController(ServicePort service) {
        if (service == null) throw new IllegalArgumentException("service required");
        this.service = service;
    }

    /** Binds a newly committed packaged page without changing the service. */
    public synchronized void attach(long nextPageEpoch, PageSink nextPageSink) {
        if (nextPageEpoch < 0L || nextPageEpoch > Integer.MAX_VALUE || nextPageSink == null) {
            throw new IllegalArgumentException("bounded page required");
        }
        pageEpoch = nextPageEpoch;
        PlaybackSnapshot latest = service.latestSnapshot();
        long initialRevision = latest == null ? 0L : latest.getRevision();
        policy = new PlaybackBridgePolicy(nextPageEpoch, initialRevision);
        pageSink = nextPageSink;
        deliveredRevision = -1L;
        if (latest != null) publish(latest);
    }

    /** Old-page authority is removed; it intentionally does not touch the service/player. */
    public synchronized void detach(long retiringPageEpoch) {
        if (pageEpoch != retiringPageEpoch) return;
        pageSink = null;
        policy = null;
        pageEpoch = -1L;
        deliveredRevision = -1L;
    }

    /**
     * Validates one allow-listed command and forwards only the immutable command
     * plus sanitized projection to the native owner. The caller posts its terminal
     * acknowledgement before invoking {@link #publish(PlaybackSnapshot)}, so a
     * page settles command UI only from the newer snapshot.
     */
    public synchronized Reply handle(Map<String, Object> envelope) {
        if (policy == null || pageSink == null) return Reply.error("PAGE_DETACHED");
        PlaybackBridgePolicy.Result result = policy.parseAndApply(envelope);
        if (!result.isAccepted()) return Reply.error(result.getErrorCode());
        PlaybackSnapshot snapshot = result.getSnapshot();
        try {
            service.dispatch(result.getCommand(), snapshot);
        } catch (RuntimeException ignored) {
            return Reply.error("SERVICE_UNAVAILABLE");
        }
        return Reply.accepted(snapshot);
    }

    /** Delivers only current-page, strictly newer sanitized snapshots. */
    public synchronized void publish(PlaybackSnapshot snapshot) {
        if (snapshot == null || pageSink == null || policy == null) return;
        if (snapshot.getRevision() <= deliveredRevision) return;
        deliveredRevision = snapshot.getRevision();
        pageSink.publish(snapshot);
    }

    /** Allows the bridge to decide whether a page epoch can still receive a reply. */
    synchronized boolean isAttached(long candidateEpoch) {
        return policy != null && pageSink != null && pageEpoch == candidateEpoch;
    }

    synchronized void detachCurrentPage() {
        detach(pageEpoch);
    }
}
