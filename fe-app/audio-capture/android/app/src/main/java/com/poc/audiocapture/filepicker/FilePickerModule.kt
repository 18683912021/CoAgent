package com.poc.audiocapture.filepicker

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

class FilePickerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FilePicker"

    private var pickPromise: Promise? = null
    private val PICK_PDF = 9001

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity, requestCode: Int, resultCode: Int, data: Intent?
        ) {
            if (requestCode != PICK_PDF) return
            val promise = pickPromise ?: return
            pickPromise = null

            if (resultCode != Activity.RESULT_OK || data?.data == null) {
                promise.resolve(null)
                return
            }

            val uri = data.data!!
            // 复制到应用缓存目录，确保后续可读取
            try {
                val contentResolver = reactApplicationContext.contentResolver
                val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"
                val fileName = "resume_${System.currentTimeMillis()}.pdf"
                val destFile = java.io.File(reactApplicationContext.cacheDir, fileName)

                contentResolver.openInputStream(uri)?.use { input ->
                    destFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }

                val result: WritableMap = Arguments.createMap().apply {
                    putString("uri", "file://${destFile.absolutePath}")
                    putString("name", data.dataString?.let {
                        it.substringAfterLast("/").substringBefore("?")
                    } ?: fileName)
                    putString("type", mimeType)
                    putInt("size", destFile.length().toInt())
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("FILE_ERROR", e.message ?: "读取文件失败")
            }
        }
    }

    init {
        reactApplicationContext.addActivityEventListener(activityEventListener)
    }

    @ReactMethod
    fun pickPDF(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "无法启动文件选择器")
            return
        }
        pickPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/pdf"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
        }
        activity.startActivityForResult(intent, PICK_PDF)
    }
}
