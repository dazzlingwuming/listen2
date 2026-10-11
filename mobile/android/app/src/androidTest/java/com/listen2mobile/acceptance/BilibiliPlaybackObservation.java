package com.listen2mobile.acceptance;

import java.io.StringReader;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/** Pure observation rules. No app state, network, credential or playback bridge access. */
final class BilibiliPlaybackObservation {
    private BilibiliPlaybackObservation() { }

    static String uniqueP1(String xml) {
        // Android's DOM implementation need not support Xerces feature names.
        // Bound the observation and reject all DTD/entity declarations before
        // parsing; built-in XML escapes remain available for visible labels.
        if (xml == null || xml.length() > 1_048_576 ||
            Pattern.compile("<!\\s*(?:DOCTYPE|ENTITY)\\b", Pattern.CASE_INSENSITIVE).matcher(xml).find()) return null;
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setExpandEntityReferences(false);
            NodeList nodes = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml))).getElementsByTagName("node");
            String title = null;
            int parts = 0;
            for (int index = 0; index < nodes.getLength(); index++) {
                Element node = (Element) nodes.item(index);
                String label = node.getAttribute("content-desc");
                if (!label.startsWith("播放") || !"true".equals(node.getAttribute("clickable")) || !"true".equals(node.getAttribute("enabled"))) continue;
                String candidate = label.substring(2);
                NodeList children = node.getElementsByTagName("node");
                boolean p1 = false, mv = false;
                for (int child = 0; child < children.getLength(); child++) {
                    Element descendant = (Element) children.item(child);
                    p1 |= descendant.getAttribute("text").equals("P1 · " + candidate);
                    mv |= descendant.getAttribute("content-desc").equals("打开" + candidate + "MV画面");
                }
                if (mv) { parts++; if (p1) title = candidate; }
            }
            // This establishes only one visible P1 control, never the full
            // provider part count or its cid. Exact-part acceptance is separate.
            return parts == 1 && title != null && !title.isEmpty() ? title : null;
        } catch (Exception ignored) { return null; }
    }

    static Snapshot snapshot(String sessions, String expectedTitle) {
        String selected = null;
        for (String section : sessions.split("\\bpackage=")) {
            if (!section.matches("(?s)^com\\.dazzlingwuming\\.listen2(?:\\s|$).*")) continue;
            if (selected != null) return null; // Multiple target sessions are ambiguous.
            selected = section;
        }
        if (selected == null) return null;
        Matcher state = Pattern.compile("PlaybackState\\s*\\{\\s*state=(?:3|PLAYING\\(3\\))(?=,|\\s|\\})[^\\n]*?\\bposition=([0-9]+)").matcher(selected);
        Matcher metadata = Pattern.compile("metadata:\\s*([^\\n]+)").matcher(selected);
        if (!state.find() || !metadata.find() || !metadata.group(1).contains(expectedTitle)) return null;
        Matcher identity = Pattern.compile("bitrack_v_(BV[A-Za-z0-9]{10})-([1-9][0-9]*)(?![0-9])").matcher(selected);
        String trackId = identity.find() ? identity.group() : null;
        while (identity.find()) if (!identity.group().equals(trackId)) return null;
        return new Snapshot(Long.parseLong(state.group(1)), metadata.group(1), trackId);
    }

    static final class Snapshot {
        final long positionMs;
        final String metadata;
        final String trackId;
        Snapshot(long positionMs, String metadata, String trackId) {
            this.positionMs = positionMs; this.metadata = metadata; this.trackId = trackId;
        }
        boolean sameObservedAdvancingTrack(Snapshot later) {
            return later != null && later.positionMs > positionMs && metadata.equals(later.metadata);
        }
        boolean sameExactAdvancingTrack(Snapshot later) {
            return sameObservedAdvancingTrack(later) && trackId != null && trackId.equals(later.trackId);
        }
    }
}
