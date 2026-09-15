package com.listen2mobile.acceptance

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Self-contained runner for the sealed releaseLike acceptance artifact. */
class Phase08Instrumentation : Instrumentation() {
    private var requestedClass: String? = null

    override fun onCreate(arguments: Bundle) {
        super.onCreate(arguments)
        requestedClass = arguments.getString("class")
        start()
    }

    override fun onStart() {
        val status = Bundle().apply {
            putString("class", requestedClass ?: "<missing>")
            putString("stream", "Phase08Instrumentation started")
        }
        sendStatus(1, status)

        var failure: Throwable? = null
        val completed = CountDownLatch(1)
        val worker = Thread {
            try {
                when (requestedClass) {
                    "com.listen2mobile.acceptance.UpgradeSeedTest" -> UpgradeSeedTest.run(this@Phase08Instrumentation)
                    "com.listen2mobile.acceptance.IntegratedJourneyTest" -> IntegratedJourneyTest.run(this@Phase08Instrumentation)
                    else -> throw IllegalArgumentException("unapproved Phase 8 instrumentation class")
                }
            } catch (error: Throwable) {
                failure = error
            } finally {
                completed.countDown()
            }
        }.apply {
            name = "phase08-acceptance"
            isDaemon = true
            start()
        }

        if (!completed.await(90, TimeUnit.SECONDS)) {
            worker.interrupt()
            failure = AssertionError("Phase 8 scenario exceeded its 90-second bound")
        }

        val result = Bundle().apply {
            putString("class", requestedClass ?: "<missing>")
            if (failure == null) {
                putString("stream", "Phase08Instrumentation completed")
            } else {
                putString("shortMsg", "Phase 8 scenario failed: ${failure!!.javaClass.simpleName}")
            }
        }
        if (failure == null) {
            sendStatus(0, result)
            finish(Activity.RESULT_OK, result)
        } else {
            // AssertionError and every other scenario failure remain terminal
            // instrumentation failures; no catch path can promote them.
            sendStatus(-1, result)
            finish(Activity.RESULT_CANCELED, result)
        }
    }
}
