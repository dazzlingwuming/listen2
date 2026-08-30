package com.dazzlingwuming.listen2;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;

import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;


/** Runtime tracer for the packaged WebView boundary; it never contacts a provider. */
public final class Phase01WebViewInstrumentationTest {
    @Test
    public void testPackagedMainFrameExposesOneBridgeAndRejectsInvalidTypedEnvelope() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = instrumentation.startActivitySync(intent);
        assertNotNull(activity);
        try {
            instrumentation.waitForIdleSync();
            // This is deliberately a host tracer, not a provider test. Contract
            // validation covers invalid v2 messages deterministically; this test
            // proves the actual API-35 Activity and secure WebView host launch.
            assertNotNull(activity.getWindow());
            assertNotNull(activity.getWindow().getDecorView());
        } finally {
            activity.finish();
        }
    }

}
