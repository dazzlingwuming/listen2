package com.dazzlingwuming.listen2;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Future;

import javax.net.ssl.HttpsURLConnection;

/**
 * Owns typed bridge request lifetimes. The only observable terminal transition is
 * the first one for a key; every later transport or cancellation callback is ignored.
 */
final class BridgeRequestRegistry {
    enum SettleResult {
        OK,
        CANCELLED,
        TIMEOUT,
        DESTROYED,
        ALREADY_SETTLED,
        NOT_FOUND
    }

    static final class RequestKey {
        final int pageEpoch;
        final String requestId;

        RequestKey(int pageEpoch, String requestId) {
            this.pageEpoch = pageEpoch;
            this.requestId = requestId;
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof RequestKey)) return false;
            RequestKey key = (RequestKey) other;
            return pageEpoch == key.pageEpoch && requestId.equals(key.requestId);
        }

        @Override
        public int hashCode() {
            return 31 * pageEpoch + requestId.hashCode();
        }
    }

    static final class CallHandle {
        private boolean terminal;
        private Future<?> future;
        private HttpsURLConnection connection;
        private TerminalListener terminalListener;

        private void cancelTransport() {
            if (future != null) future.cancel(true);
            if (connection != null) connection.disconnect();
        }
    }

    interface TerminalListener {
        void onTerminal(SettleResult result);
    }

    private final Map<RequestKey, CallHandle> handles = new HashMap<>();
    private boolean destroyed;

    synchronized CallHandle register(RequestKey key) {
        if (destroyed || key == null || handles.containsKey(key)) return null;
        CallHandle handle = new CallHandle();
        handles.put(key, handle);
        return handle;
    }

    synchronized boolean attachFuture(RequestKey key, Future<?> future) {
        CallHandle handle = handles.get(key);
        if (handle == null || handle.terminal || destroyed) {
            if (future != null) future.cancel(true);
            return false;
        }
        handle.future = future;
        return true;
    }

    synchronized boolean attachConnection(RequestKey key, HttpsURLConnection connection) {
        CallHandle handle = handles.get(key);
        if (handle == null || handle.terminal || destroyed) {
            if (connection != null) connection.disconnect();
            return false;
        }
        handle.connection = connection;
        return true;
    }

    synchronized boolean attachTerminalListener(RequestKey key, TerminalListener listener) {
        CallHandle handle = handles.get(key);
        if (handle == null || handle.terminal || destroyed) return false;
        handle.terminalListener = listener;
        return true;
    }

    synchronized void detachConnection(RequestKey key, HttpsURLConnection connection) {
        CallHandle handle = handles.get(key);
        if (handle != null && handle.connection == connection) handle.connection = null;
    }

    synchronized SettleResult cancel(RequestKey key) {
        CallHandle handle = handles.get(key);
        if (destroyed) return SettleResult.DESTROYED;
        if (handle == null) return SettleResult.NOT_FOUND;
        if (handle.terminal) return SettleResult.ALREADY_SETTLED;
        handle.terminal = true;
        handle.cancelTransport();
        notifyListener(handle, SettleResult.CANCELLED);
        return SettleResult.CANCELLED;
    }

    synchronized SettleResult timeout(RequestKey key) {
        CallHandle handle = handles.get(key);
        if (destroyed) return SettleResult.DESTROYED;
        if (handle == null) return SettleResult.NOT_FOUND;
        if (handle.terminal) return SettleResult.ALREADY_SETTLED;
        handle.terminal = true;
        handle.cancelTransport();
        notifyListener(handle, SettleResult.TIMEOUT);
        return SettleResult.TIMEOUT;
    }

    synchronized SettleResult settle(RequestKey key, AndroidRpcContract.Terminal terminal) {
        CallHandle handle = handles.get(key);
        if (destroyed) return SettleResult.DESTROYED;
        if (handle == null) return SettleResult.NOT_FOUND;
        if (handle.terminal) return SettleResult.ALREADY_SETTLED;
        handle.terminal = true;
        return terminal == AndroidRpcContract.Terminal.CANCELLED
                ? SettleResult.CANCELLED : SettleResult.OK;
    }

    synchronized int cancelAll() {
        int cancelled = 0;
        destroyed = true;
        for (CallHandle handle : handles.values()) {
            if (!handle.terminal) {
                handle.terminal = true;
                handle.cancelTransport();
                cancelled += 1;
            }
        }
        return cancelled;
    }

    synchronized boolean hasActive(RequestKey key) {
        CallHandle handle = handles.get(key);
        return handle != null && !handle.terminal && !destroyed;
    }

    synchronized boolean isDestroyed() { return destroyed; }

    synchronized boolean canPostReplies() { return !destroyed; }

    private void notifyListener(CallHandle handle, SettleResult result) {
        if (!destroyed && handle.terminalListener != null) handle.terminalListener.onTerminal(result);
    }
}
