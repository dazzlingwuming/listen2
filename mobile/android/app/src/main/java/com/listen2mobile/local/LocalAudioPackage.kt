package com.listen2mobile.local

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LocalAudioPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) = listOf(LocalAudioModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
