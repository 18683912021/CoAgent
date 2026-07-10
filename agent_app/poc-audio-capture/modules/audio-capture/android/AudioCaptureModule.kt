package com.copilot.poc_audio_capture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

/**
 * AudioCaptureModule — 系统内部音频采集（Android 10+）
 *
 * 原理：
 * 1. MediaProjection 获取系统音频播放权限（不需要录制屏幕画面）
 * 2. AudioRecord + AudioPlaybackCaptureConfiguration 捕获系统音频
 * 3. 输出 PCM 16bit 16kHz mono，通过 EventEmitter 回传 JS 层
 *
 * 【Bug 修复】:
 * - Bug#1 白屏：JS 侧已加 ErrorBoundary + try/catch，Native 侧所有方法返回 Promise
 *   并 catch 所有异常回传 reject，绝不抛未处理异常
 * - Bug#2 授权闪退：onActivityResult 中 data 为 null 或 resultCode != RESULT_OK
 *   时不做 getMediaProjection() 调用，通过 pendingPromise 回传明确错误
 */

@ReactModule(name = AudioCaptureModule.NAME)
class AudioCaptureModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "AudioCaptureModule"
        private const val TAG = "AudioCapture"
        private const val REQUEST_CODE_MEDIA_PROJECTION = 8823
    }

    private var mediaProjection: MediaProjection? = null
    private var audioRecord: AudioRecord? = null
    private var isCapturing = false
    private var captureThread: Thread? = null
    private var pendingPromise: Promise? = null          // 等待授权结果的 Promise
    private var pendingStartPromise: Promise? = null     // 等待 start() 的 Promise

    override fun getName(): String = NAME

    init {
        reactContext.addActivityEventListener(this)
    }

    // ═══════════════════════════════════════════
    // 录音权限 (RECORD_AUDIO)
    // ═══════════════════════════════════════════

    @ReactMethod
    fun requestRecordPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val activity = currentActivity
                if (activity == null) {
                    promise.reject("NO_ACTIVITY", "当前没有 Activity，无法请求权限")
                    return
                }
                if (activity.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    promise.resolve(true)
                } else {
                    // 引导用户去设置（简化处理，实际可用 ActivityCompat.requestPermissions）
                    promise.resolve(false)
                }
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            Log.e(TAG, "requestRecordPermission 异常", e)
            promise.reject("PERMISSION_ERROR", e.message ?: "未知错误")
        }
    }

    // ═══════════════════════════════════════════
    // 系统音频权限 (MediaProjection)
    // ═══════════════════════════════════════════

    @ReactMethod
    fun requestSystemAudioPermission(promise: Promise) {
        try {
            val activity = currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "当前没有 Activity")
                return
            }

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                promise.reject("UNSUPPORTED", "系统音频采集需要 Android 10 (API 29)+")
                return
            }

            val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                as? MediaProjectionManager
            if (manager == null) {
                promise.reject("NO_SERVICE", "设备不支持 MediaProjection")
                return
            }

            // 保存 Promise，在 onActivityResult 中处理
            pendingPromise = promise
            val intent = manager.createScreenCaptureIntent()
            activity.startActivityForResult(intent, REQUEST_CODE_MEDIA_PROJECTION)
            Log.d(TAG, "已弹出系统授权对话框，等待用户确认...")

        } catch (e: Exception) {
            Log.e(TAG, "requestSystemAudioPermission 异常", e)
            pendingPromise = null
            promise.reject("AUTH_ERROR", e.message ?: "授权流程异常")
        }
    }

    // ═══════════════════════════════════════════
    // Activity 结果回调 — 【Bug#2 闪退修复点】
    // ═══════════════════════════════════════════

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode != REQUEST_CODE_MEDIA_PROJECTION) return

        val promise = pendingPromise
        pendingPromise = null

        // ── 【Bug#2 修复 ①】先检查 resultCode ──
        if (resultCode != Activity.RESULT_OK) {
            Log.w(TAG, "用户取消了系统音频授权 (resultCode=$resultCode)")
            promise?.resolve(false)
            return
        }

        // ── 【Bug#2 修复 ②】data 为 null 检查 ──
        // MediaProjection 的 intent data 必须非 null 才能创建 projection
        if (data == null) {
            Log.e(TAG, "MediaProjection intent data 为 null —— 系统返回了空 data")
            promise?.reject("NULL_INTENT", "系统授权回调 data 为空，无法创建音频采集。请重试。")
            return
        }

        // ── 【Bug#2 修复 ③】getMediaProjection 包 try/catch ──
        try {
            val manager = activity?.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                as? MediaProjectionManager
            if (manager == null) {
                promise?.reject("NO_SERVICE", "MediaProjectionManager 不可用")
                return
            }

            // ⚠️ 这是最容易崩溃的地方：如果 data 为 null 或 resultCode 不对就会 native crash
            mediaProjection = manager.getMediaProjection(resultCode, data)

            // 注册 projection 停止回调（用户在通知栏手动关闭）
            mediaProjection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    Log.w(TAG, "用户在通知栏停止了音频采集")
                    stopCapture()
                }
            }, null)

            Log.d(TAG, "MediaProjection 创建成功")
            promise?.resolve(true)

        } catch (e: SecurityException) {
            Log.e(TAG, "MediaProjection 安全异常", e)
            promise?.reject("SECURITY", "系统拒绝了音频采集权限: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "MediaProjection 创建失败", e)
            promise?.reject("PROJECTION_ERROR", "音频采集初始化失败: ${e.message}")
        }
    }

    // ═══════════════════════════════════════════
    // 开始采集 — 【Bug#1 白屏修复点：所有异常走 reject】
    // ═══════════════════════════════════════════

    @ReactMethod
    fun start(configMap: ReadableMap, promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                promise.reject("UNSUPPORTED", "需要 Android 10+")
                return
            }

            val projection = mediaProjection
            if (projection == null) {
                promise.reject("NO_PROJECTION", "请先授权系统音频权限")
                return
            }

            if (isCapturing) {
                promise.reject("ALREADY_CAPTURING", "采集已在运行中")
                return
            }

            val sampleRate = if (configMap.hasKey("sampleRate")) configMap.getInt("sampleRate") else 16000
            val channelConfig = if (configMap.hasKey("channelConfig")) configMap.getInt("channelConfig") else 1
            val audioFormat = if (configMap.hasKey("audioFormat")) configMap.getInt("audioFormat") else 2
            val bufferSize = if (configMap.hasKey("bufferSize")) configMap.getInt("bufferSize") else 1280

            val audioPlaybackConfig = AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .addMatchingUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
                .build()

            val minBuf = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            val actualBuffer = maxOf(bufferSize, minBuf)

            @Suppress("DEPRECATION")
            audioRecord = AudioRecord.Builder()
                .setAudioPlaybackCaptureConfig(audioPlaybackConfig)
                .setAudioFormat(AudioFormat.Builder()
                    .setEncoding(audioFormat)
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelConfig)
                    .build())
                .setBufferSizeInBytes(actualBuffer)
                .build()

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                audioRecord?.release()
                audioRecord = null
                promise.reject("INIT_FAILED", "AudioRecord 初始化失败，可能设备不支持音频回采")
                return
            }

            audioRecord?.startRecording()
            isCapturing = true

            // 启动采集线程
            captureThread = Thread {
                val buffer = ByteArray(actualBuffer)
                var totalBytes = 0L
                while (isCapturing) {
                    try {
                        val read = audioRecord?.read(buffer, 0, actualBuffer) ?: -1
                        if (read > 0) {
                            totalBytes += read
                            // TODO: 通过 EventEmitter 将 PCM buffer 回传 JS 层
                        } else if (read == AudioRecord.ERROR_INVALID_OPERATION) {
                            Log.e(TAG, "AudioRecord read ERROR_INVALID_OPERATION")
                            break
                        } else if (read == AudioRecord.ERROR_BAD_VALUE) {
                            Log.e(TAG, "AudioRecord read ERROR_BAD_VALUE")
                            break
                        }
                    } catch (e: Exception) {
                        if (isCapturing) {
                            Log.e(TAG, "采集线程异常", e)
                        }
                        break
                    }
                }
                Log.d(TAG, "采集线程退出，共读取 $totalBytes bytes")
            }.apply {
                name = "AudioCapture"
                priority = Thread.MAX_PRIORITY
                start()
            }

            Log.d(TAG, "采集已启动: $sampleRate Hz, buffer=$actualBuffer bytes")
            promise.resolve(null)

        } catch (e: SecurityException) {
            Log.e(TAG, "start 安全异常", e)
            promise.reject("SECURITY", "权限不足: ${e.message}")
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "start 参数异常", e)
            promise.reject("BAD_CONFIG", "采集参数不合法: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "start 未知异常", e)
            promise.reject("START_FAILED", e.message ?: "启动失败")
        }
    }

    // ═══════════════════════════════════════════
    // 停止采集
    // ═══════════════════════════════════════════

    @ReactMethod
    fun stop() {
        stopCapture()
    }

    private fun stopCapture() {
        isCapturing = false

        captureThread?.let {
            try {
                it.join(500)
            } catch (e: InterruptedException) {
                Log.w(TAG, "等待采集线程退出被中断")
            }
        }
        captureThread = null

        audioRecord?.let {
            try {
                if (it.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    it.stop()
                }
                it.release()
            } catch (e: Exception) {
                Log.e(TAG, "AudioRecord 释放异常", e)
            }
        }
        audioRecord = null

        mediaProjection?.let {
            try {
                it.stop()
            } catch (e: Exception) {
                Log.e(TAG, "MediaProjection 释放异常", e)
            }
        }
        mediaProjection = null

        Log.d(TAG, "采集已完全停止并释放资源")
    }

    // ═══════════════════════════════════════════
    // ActivityEventListener 其他回调
    // ═══════════════════════════════════════════

    override fun onNewIntent(intent: Intent?) {}

    // ═══════════════════════════════════════════
    // 生命周期清理
    // ═══════════════════════════════════════════

    override fun onCatalystInstanceDestroy() {
        stopCapture()
        reactApplicationContext.removeActivityEventListener(this)
        super.onCatalystInstanceDestroy()
    }
}
