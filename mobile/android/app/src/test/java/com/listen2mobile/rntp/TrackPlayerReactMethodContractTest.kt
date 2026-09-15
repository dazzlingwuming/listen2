package com.listen2mobile.rntp

import com.doublesymmetry.trackplayer.module.MusicModule
import com.facebook.react.bridge.ReactMethod
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackPlayerReactMethodContractTest {
    @Test
    fun exportedMethodsMatchReactNativeTurboModuleReturnContract() {
        val violations = MusicModule::class.java.declaredMethods
            .mapNotNull { method ->
                method.getAnnotation(ReactMethod::class.java)?.let { annotation ->
                    method to annotation
                }
            }
            .filter { (method, annotation) ->
                (method.returnType == Void.TYPE) != !annotation.isBlockingSynchronousMethod
            }
            .map { (method, annotation) ->
                "${method.name}: return=${method.returnType.name}, synchronous=${annotation.isBlockingSynchronousMethod}"
            }

        assertTrue(
            "React Native requires async @ReactMethod methods to return void and synchronous methods to return a value: $violations",
            violations.isEmpty(),
        )
    }
}
