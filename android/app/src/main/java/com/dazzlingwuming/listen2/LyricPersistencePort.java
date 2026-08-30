package com.dazzlingwuming.listen2;

/** Narrow native lyric selection seam. Phase 4 supplies the Room implementation. */
interface LyricPersistencePort {
    AndroidRpcContract.TypedReply execute(AndroidRpcContract.TypedRequest request);

    static LyricPersistencePort unavailable() {
        return request -> AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                null, "LYRIC_PERSISTENCE_UNAVAILABLE");
    }
}
