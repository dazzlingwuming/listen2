package com.dazzlingwuming.listen2;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Native-only default-rendition seam for NetEase. A real route is deliberately
 * absent until its entitlement contract is approved; callers therefore receive
 * one actionable state instead of a page-visible candidate or empty success.
 */
final class NetEasePlaybackResolver implements PlaybackMediaResolver.ManifestPort {
    private final List<String> deterministicCandidates;

    NetEasePlaybackResolver() {
        this(Collections.<String>emptyList());
    }

    private NetEasePlaybackResolver(List<String> deterministicCandidates) {
        this.deterministicCandidates = Collections.unmodifiableList(new ArrayList<>(deterministicCandidates));
    }

    static NetEasePlaybackResolver forDeterministicFixture(List<String> candidates) {
        return new NetEasePlaybackResolver(candidates == null ? Collections.<String>emptyList() : candidates);
    }

    @Override
    public List<String> resolve(PlaybackMediaResolver.Descriptor descriptor) {
        if (descriptor == null || !"netease".equals(descriptor.getSource())) {
            return Collections.emptyList();
        }
        return deterministicCandidates;
    }

    @Override
    public String unavailableStatus() {
        return "route-unavailable";
    }
}
