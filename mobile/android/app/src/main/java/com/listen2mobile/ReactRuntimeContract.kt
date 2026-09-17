package com.listen2mobile

/** Shared configuration for the bridgeless and compatibility React hosts. */
internal object ReactRuntimeContract {
    const val JS_MAIN_MODULE = "index"
    const val JS_BUNDLE_ASSET = "index.android.bundle"

    /** Preserve object identity so neither host can silently get a divergent package list. */
    fun <T> sharedPackages(packages: List<T>): List<T> = packages
}
