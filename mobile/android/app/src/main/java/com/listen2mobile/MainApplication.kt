package com.listen2mobile

import android.app.Application
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.listen2mobile.offline.OfflineAudioPackage
import com.listen2mobile.bilibili.BilibiliPackage
import com.listen2mobile.deepseek.DeepSeekPackage
import com.listen2mobile.qq.QqPlaybackPackage
import com.listen2mobile.kuwo.KuwoPlaybackPackage
import com.listen2mobile.library.LibraryPackage
import com.listen2mobile.local.LocalAudioPackage
import com.listen2mobile.history.HistoryPackage
import com.listen2mobile.netease.NeteasePlaybackPackage
import com.listen2mobile.kugou.KugouPlaybackPackage
import com.listen2mobile.audiofx.AudioEffectsPackage

class MainApplication : Application(), ReactApplication {

  private val reactPackages by lazy {
    PackageList(this).packages.apply {
      add(OfflineAudioPackage())
      add(BilibiliPackage())
      add(DeepSeekPackage())
      add(QqPlaybackPackage())
      add(KuwoPlaybackPackage())
      add(NeteasePlaybackPackage())
      add(KugouPlaybackPackage())
      add(LibraryPackage())
      add(LocalAudioPackage())
      add(HistoryPackage())
      add(AudioEffectsPackage())
    }
  }

  /**
   * React Native's HeadlessJsTaskService can request the legacy host before
   * its bridgeless feature flag is observed. Track Player uses that service,
   * so both host entry points must share the exact same package composition.
   */
  override val reactNativeHost: ReactNativeHost = object : DefaultReactNativeHost(this@MainApplication) {
    override fun getPackages() = ReactRuntimeContract.sharedPackages(reactPackages)
    override fun getJSMainModuleName() = ReactRuntimeContract.JS_MAIN_MODULE
    override fun getBundleAssetName() = ReactRuntimeContract.JS_BUNDLE_ASSET
    override fun getUseDeveloperSupport() = BuildConfig.DEBUG
  }

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      reactNativeHost = reactNativeHost,
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    // Fixed lifecycle state only; this deliberately contains no media, URL,
    // header, cookie, or user data. It proves which host branch is available
    // before Track Player starts its foreground service.
    Log.i("Listen2Runtime", "bridgeless-initialized=${ReactNativeFeatureFlags.enableBridgelessArchitecture()}")
  }
}
