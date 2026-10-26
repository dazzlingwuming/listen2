package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public final class BridgeRetryPolicyTest {
    @Test public void successfulNativeRepliesAreNeverReplayedBecauseTheyHaveNoHttpStatus() {
        for (AndroidRpcContract.Operation operation : AndroidRpcContract.Operation.values()) {
            assertFalse(BridgeRetryPolicy.canRetryReply(operation, AndroidRpcContract.Terminal.OK, 0, null));
        }
    }

    @Test public void mutationsAreNeverAutomaticallyRepeatedEvenAfterAmbiguousNetworkFailure() {
        AndroidRpcContract.Operation[] writes = {
                AndroidRpcContract.Operation.LOCAL_DATA_COMMAND,
                AndroidRpcContract.Operation.PLAYBACK_COMMAND,
                AndroidRpcContract.Operation.LYRIC_SELECTION_SET,
                AndroidRpcContract.Operation.LYRIC_SELECTION_CLEAR,
                AndroidRpcContract.Operation.LYRIC_OFFSET_SET,
                AndroidRpcContract.Operation.LYRIC_CONTENT_PUT,
                AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_BEGIN,
                AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_POLL,
                AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_CANCEL,
                AndroidRpcContract.Operation.BILIBILI_ACCOUNT_LOGOUT,
                AndroidRpcContract.Operation.GITHUB_SYNC
        };
        for (AndroidRpcContract.Operation operation : writes) {
            assertFalse(BridgeRetryPolicy.canRetryOperation(operation));
            assertFalse(BridgeRetryPolicy.canRetryReply(operation, AndroidRpcContract.Terminal.ERROR,
                    0, "NETWORK_TIMEOUT"));
        }
    }

    @Test public void onlyTransientReadFailuresCanRetry() {
        AndroidRpcContract.Operation read = AndroidRpcContract.Operation.BILIBILI_VIDEO_DETAIL;
        assertTrue(BridgeRetryPolicy.canRetryReply(read, AndroidRpcContract.Terminal.ERROR, 0, "NETWORK_TIMEOUT"));
        assertTrue(BridgeRetryPolicy.canRetryReply(read, AndroidRpcContract.Terminal.ERROR, 503, "PROVIDER_STATUS"));
        assertFalse(BridgeRetryPolicy.canRetryReply(read, AndroidRpcContract.Terminal.ERROR, 0, "INVALID_PART"));
        assertFalse(BridgeRetryPolicy.canRetryReply(read, AndroidRpcContract.Terminal.ERROR, 412, "PROVIDER_STATUS"));
        assertFalse(BridgeRetryPolicy.canRetryReply(read, AndroidRpcContract.Terminal.CANCELLED, 0, "NETWORK_TIMEOUT"));
    }
}
