package com.dazzlingwuming.listen2;

/**
 * Narrow native lyric-selection seam. The deliberately small value objects
 * prevent the durable layer from receiving page-owned transport data.
 */
public interface LyricPersistencePort {
    enum Operation { GET, SET, CLEAR, OFFSET }

    Result execute(Intent intent);

    static LyricPersistencePort unavailable() {
        return intent -> Result.error("LYRIC_PERSISTENCE_UNAVAILABLE");
    }

    final class Intent {
        public final Operation operation;
        public final String source;
        public final String providerTrackId;
        public final String providerPartId;
        public final String lyricRevision;
        public final long expectedRevision;
        public final String transitionToken;
        public final String selectedSourceId;
        public final long offsetMs;

        public Intent(Operation operation, String source, String providerTrackId, String providerPartId,
                String lyricRevision, long expectedRevision, String transitionToken,
                String selectedSourceId, long offsetMs) {
            this.operation = operation;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.providerPartId = providerPartId;
            this.lyricRevision = lyricRevision;
            this.expectedRevision = expectedRevision;
            this.transitionToken = transitionToken;
            this.selectedSourceId = selectedSourceId;
            this.offsetMs = offsetMs;
        }
    }

    final class Result {
        public final String status;
        public final long revision;
        public final String mode;
        public final String selectedSourceId;
        public final long offsetMs;
        public final String errorCode;

        private Result(String status, long revision, String mode, String selectedSourceId,
                long offsetMs, String errorCode) {
            this.status = status;
            this.revision = revision;
            this.mode = mode;
            this.selectedSourceId = selectedSourceId;
            this.offsetMs = offsetMs;
            this.errorCode = errorCode;
        }

        public static Result accepted(long revision, String mode, String selectedSourceId,
                long offsetMs) {
            return new Result("accepted", revision, mode, selectedSourceId, offsetMs, null);
        }

        public static Result idempotent(long revision, String mode, String selectedSourceId,
                long offsetMs) {
            return new Result("idempotent", revision, mode, selectedSourceId, offsetMs, null);
        }

        public static Result notFound() {
            return new Result("not-found", 0L, "automatic", null, 0L, null);
        }

        public static Result stale(long revision) {
            return new Result("stale", revision, null, null, 0L, "STALE_REVISION");
        }

        public static Result error(String errorCode) {
            return new Result("invalid", 0L, null, null, 0L, errorCode);
        }
    }
}
