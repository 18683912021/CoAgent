package com.audiocapturepoc.audiocapture

import android.app.Activity
import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AudioCapturePackage : ReactPackage {

    private var module: AudioCaptureModule? = null

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        val audioModule = AudioCaptureModule(reactContext)
        module = audioModule

        // Register activity result listener
        reactContext.addActivityEventListener(object :
            com.facebook.react.bridge.ActivityEventListener {
            override fun onActivityResult(
                activity: Activity?,
                requestCode: Int,
                resultCode: Int,
                data: Intent?
            ) {
                audioModule.handleActivityResult(requestCode, resultCode, data)
            }

            override fun onNewIntent(intent: Intent?) {}
        })

        return listOf(audioModule)
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
