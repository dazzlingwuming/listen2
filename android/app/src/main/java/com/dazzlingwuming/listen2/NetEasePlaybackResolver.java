package com.dazzlingwuming.listen2;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Native-only default-rendition resolver for NetEase.
 *
 * <p>The resolver consumes the provider response on the native playback path
 * and returns a short-lived candidate only to the existing Media3 resolver.
 * No candidate is placed in an RPC reply, playback snapshot, or page DTO.</p>
 */
final class NetEasePlaybackResolver implements PlaybackMediaResolver.ManifestPort {
    private final NetEaseNativeProvider provider;
    private final List<String> deterministicCandidates;
    private volatile String lastStatus = "route-unavailable";

    NetEasePlaybackResolver() {
        this(new NetEaseNativeProvider(), Collections.<String>emptyList());
    }

    NetEasePlaybackResolver(NetEaseNativeProvider provider) {
        this(provider == null ? new NetEaseNativeProvider() : provider, Collections.<String>emptyList());
    }

    private NetEasePlaybackResolver(List<String> deterministicCandidates) {
        this(null, deterministicCandidates == null
                ? Collections.<String>emptyList() : deterministicCandidates);
    }

    private NetEasePlaybackResolver(NetEaseNativeProvider provider, List<String> deterministicCandidates) {
        this.provider = provider;
        this.deterministicCandidates = Collections.unmodifiableList(new ArrayList<>(deterministicCandidates));
    }

    static NetEasePlaybackResolver forDeterministicFixture(List<String> candidates) {
        return new NetEasePlaybackResolver(candidates);
    }

    @Override
    public List<String> resolve(PlaybackMediaResolver.Descriptor descriptor) {
        if (descriptor == null || !"netease".equals(descriptor.getSource())) {
            lastStatus = "invalid-selection";
            return Collections.emptyList();
        }
        if (provider == null) {
            lastStatus = "route-unavailable";
            return safeFixtureCandidates();
        }
        String trackId = descriptor.getProviderTrackId();
        if (trackId == null || !trackId.matches("[1-9][0-9]{0,17}")) {
            lastStatus = "invalid-selection";
            return Collections.emptyList();
        }
        try {
            NetEaseNativeProvider.Response response = provider.execute(
                    provider.buildDefaultRenditionRequest(Long.parseLong(trackId)));
            if (!response.isHttpSuccess()) {
                lastStatus = normalizeStatus(response.errorCode == null
                        ? NetEaseResponseMapper.errorForStatus(response.status) : response.errorCode);
                return Collections.emptyList();
            }
            NetEaseResponseMapper.RenditionResult mapped = NetEaseResponseMapper.mapDefaultRendition(
                    trackId, response.body);
            if (!mapped.isValid()) {
                lastStatus = normalizeStatus(mapped.errorCode);
                return Collections.emptyList();
            }
            lastStatus = "ready";
            return Collections.singletonList(mapped.url);
        } catch (Exception ignored) {
            lastStatus = "malformed-provider-response";
            return Collections.emptyList();
        }
    }

    @Override
    public String unavailableStatus() {
        return lastStatus;
    }

    private List<String> safeFixtureCandidates() {
        return deterministicCandidates;
    }

    private static String normalizeStatus(String code) {
        if ("ENTITLEMENT_REQUIRED".equals(code) || "MEMBERSHIP_REQUIRED".equals(code)) {
            return "permission-required";
        }
        if ("LOGIN_REQUIRED".equals(code)) return "login-required";
        if ("REGION_RESTRICTED".equals(code)) return "region-restricted";
        if ("DRM_RESTRICTED".equals(code)) return "drm-restricted";
        if ("IDENTITY_MISMATCH".equals(code) || "MALFORMED_PROVIDER_RESPONSE".equals(code)) {
            return "malformed-provider-response";
        }
        if ("CANCELLED".equals(code)) return "cancelled";
        if ("TIMEOUT".equals(code) || "NETWORK_TIMEOUT".equals(code)) return "timeout";
        if ("NETWORK_IO_ERROR".equals(code)) return "network-unavailable";
        return "route-unavailable";
    }
}
