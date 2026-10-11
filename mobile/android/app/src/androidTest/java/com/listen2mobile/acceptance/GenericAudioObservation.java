package com.listen2mobile.acceptance;

import java.io.StringReader;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/** Public-UI/session preconditions only; never claims exact provider track identity. */
final class GenericAudioObservation {
    enum Precondition { NO_SESSION, PLAYING, PAUSED, UNKNOWN }
    static Precondition precondition(String raw, boolean getterObserved) {
        if (raw == null || raw.length() > 1_048_576) return Precondition.UNKNOWN;
        String selected = null;
        for (String section : raw.split("\\bpackage=")) {
            if (!section.matches("(?s)^com\\.dazzlingwuming\\.listen2(?:\\s|$).*")) continue;
            if (selected != null) return Precondition.UNKNOWN;
            selected = section;
        }
        if (selected == null) return !getterObserved && raw.contains("MEDIA SESSION SERVICE") ? Precondition.NO_SESSION : Precondition.UNKNOWN;
        Matcher state = Pattern.compile("PlaybackState\\s*\\{\\s*state=(2|PAUSED\\(2\\)|3|PLAYING\\(3\\))(?=,|\\s|\\})").matcher(selected);
        if (!state.find()) return Precondition.UNKNOWN;
        String value = state.group(1);
        if (state.find()) return Precondition.UNKNOWN;
        if (value.equals("3") || value.equals("PLAYING(3)")) return Precondition.PLAYING;
        return getterObserved ? Precondition.PAUSED : Precondition.UNKNOWN;
    }
    private static NodeList nodes(String xml) {
        if (xml == null || xml.length() > 1_048_576 || Pattern.compile("<!\\s*(?:DOCTYPE|ENTITY)\\b", Pattern.CASE_INSENSITIVE).matcher(xml).find()) return null;
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setExpandEntityReferences(false);
            return factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml))).getElementsByTagName("node");
        } catch (Exception ignored) { return null; }
    }
    static boolean uniqueControl(String xml, String label) {
        NodeList rows = nodes(xml); if (rows == null) return false;
        int count = 0;
        for (int i = 0; i < rows.getLength(); i++) {
            Element row = (Element) rows.item(i);
            if (label.equals(row.getAttribute("content-desc")) && "true".equals(row.getAttribute("enabled")) && "true".equals(row.getAttribute("clickable"))) count++;
        }
        return count == 1;
    }
    static boolean fullPlayerTitle(String xml, String title) {
        if (!uniqueControl(xml, "关闭播放器")) return false;
        NodeList rows = nodes(xml); if (rows == null) return false;
        int count = 0;
        for (int i = 0; i < rows.getLength(); i++) if (title.equals(((Element) rows.item(i)).getAttribute("text"))) count++;
        return count == 1;
    }
    static boolean exactMetadataTitle(String metadata, String title) {
        // MediaDescription's title/artist separator is ambiguous when title contains commas.
        if (metadata == null || title == null || title.isEmpty() || title.indexOf(',') >= 0 || title.indexOf('\n') >= 0 || title.indexOf('\r') >= 0) return false;
        return metadata.matches("size=[0-9]+, description=" + Pattern.quote(title) + ", [^\\r\\n]*");
    }
}
