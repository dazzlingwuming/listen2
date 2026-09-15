package com.listen2mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
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

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
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
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
