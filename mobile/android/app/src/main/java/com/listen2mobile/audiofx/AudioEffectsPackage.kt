package com.listen2mobile.audiofx
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
class AudioEffectsPackage : ReactPackage { override fun createNativeModules(context: ReactApplicationContext) = listOf(AudioEffectsModule(context)); override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList() }
