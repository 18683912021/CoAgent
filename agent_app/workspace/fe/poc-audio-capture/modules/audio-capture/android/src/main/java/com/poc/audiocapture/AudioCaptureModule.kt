package com.poc.audiocapture

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = AudioCaptureModule.NAME)
class AudioCaptureModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  override fun getName(): String = NAME

  init {
    reactContext.addActivityEventListener(this)
  }

  // ═══════════════════════════════════════════════
  // ActivityEventListener
  // ═══════════════════════════════════════════════
  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != MEDIA_PROJECTION_REQUEST_CODE) return
    if (resultCode == Activity.RESULT_OK && data != null) {
      val ctx = reactApplicationContext
      val manager = ctx.getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE)
          as android.media.projection.MediaProjectionManager
      mediaProjection = manager.getMediaProjection(resultCode, data)
      android.util.Log.d(TAG, "✅ MediaProjection 授权成功")
      synchronized(mediaProjectionLock) {
        mediaProjectionResult = true
        mediaProjectionLock.notifyAll()
      }
    } else {
      android.util.Log.w(TAG, "❌ MediaProjection 授权被拒绝")
      synchronized(mediaProjectionLock) {
        mediaProjectionResult = false
        mediaProjectionLock.notifyAll()
      }
    }
  }

  override fun onNewIntent(intent: Intent?) {}

  // ═══════════════════════════════════════════════
  // React 方法
  // ═══════════════════════════════════════════════

  @ReactMethod
  fun isSupported(promise: Promise) {
    val supported = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q
    android.util.Log.d(TAG, "isSupported: $supported (SDK ${android.os.Build.VERSION.SDK_INT})")
    promise.resolve(supported)
  }

  @ReactMethod
  fun hasMediaProjection(promise: Promise) {
    promise.resolve(mediaProjection != null)
  }

  @ReactMethod
  fun requestMediaProjection(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }

    startMediaProjectionService(activity)

    val deadline = System.currentTimeMillis() + 3000
    while (!MediaProjectionService.isRunning && System.currentTimeMillis() < deadline) {
      Thread.sleep(50)
    }
    if (!MediaProjectionService.isRunning) {
      android.util.Log.e(TAG, "MediaProjectionService failed to start within deadline")
      stopMediaProjectionService()
      promise.resolve(false)
      return
    }
    android.util.Log.d(TAG, "MediaProjectionService confirmed running, showing dialog")

    val manager = activity.getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE)
        as android.media.projection.MediaProjectionManager
    pendingMediaProjectionPromise = promise

    activity.startActivityForResult(
      manager.createScreenCaptureIntent(),
      MEDIA_PROJECTION_REQUEST_CODE
    )
    android.util.Log.d(TAG, "📺 MediaProjection 授权对话框已弹出")

    // 在后台线程等待结果
    Thread {
      synchronized(mediaProjectionLock) {
        try { mediaProjectionLock.wait() } catch (_: InterruptedException) {}
      }
      val result = mediaProjectionResult
      // 如果用户拒绝，停止前台服务
      if (result != true) {
        stopMediaProjectionService()
      }
      // resolve on JS thread
      reactApplicationContext.runOnUiQueueThread {
        pendingMediaProjectionPromise?.resolve(result ?: false)
        pendingMediaProjectionPromise = null
        mediaProjectionResult = null
      }
    }.start()
  }

  @ReactMethod
  fun setCaptureSource(source: String, promise: Promise) {
    require(source in listOf("mic", "system", "both")) {
      "illegal source: $source. Must be 'mic' | 'system' | 'both'"
    }
    captureSource = source
    android.util.Log.d(TAG, "captureSource → $source")
    promise.resolve(null)
  }

  @ReactMethod
  fun getCaptureSource(promise: Promise) {
    promise.resolve(captureSource)
  }

  @ReactMethod
  fun configure(config: ReadableMap, promise: Promise) {
    configuredSampleRate = if (config.hasKey("sampleRate")) config.getInt("sampleRate") else DEFAULT_SAMPLE_RATE
    configuredChannelCount = if (config.hasKey("channelCount")) config.getInt("channelCount") else DEFAULT_CHANNEL_COUNT
    configuredEncoding = if (config.hasKey("encoding")) config.getString("encoding") ?: "pcm_16bit" else "pcm_16bit"

    val ts = System.currentTimeMillis()
    micOutputFile = java.io.File(reactApplicationContext.cacheDir, "mic_${ts}.pcm")
    systemOutputFile = java.io.File(reactApplicationContext.cacheDir, "system_${ts}.pcm")

    lastMicFilePath = micOutputFile?.absolutePath ?: ""
    lastSystemFilePath = systemOutputFile?.absolutePath ?: ""

    android.util.Log.d(TAG, "configure: sr=$configuredSampleRate ch=$configuredChannelCount enc=$configuredEncoding")
    android.util.Log.d(TAG, "  mic → ${micOutputFile?.absolutePath}")
    android.util.Log.d(TAG, "  sys → ${systemOutputFile?.absolutePath}")
    promise.resolve(null)
  }

  @ReactMethod
  fun start(promise: Promise) {
    if (isCapturing) {
      android.util.Log.w(TAG, "已在采集中，忽略重复 start")
      promise.resolve(null)
      return
    }

    val needsMic = captureSource == "mic" || captureSource == "both"
    val needsSystem = captureSource == "system" || captureSource == "both"

    if (!needsMic && !needsSystem) {
      promise.reject("E_NOT_CONFIGURED", "captureSource 未设置")
      return
    }

    if (needsSystem && mediaProjection == null) {
      promise.reject("E_NO_PERMISSION", "系统音频采集需要先授权 MediaProjection，请调用 requestMediaProjection()")
      return
    }

    isCapturing = true

    if (needsMic) startMicCapture()
    if (needsSystem) startSystemCapture()

    android.util.Log.d(TAG, "✅ 采集已启动: source=$captureSource")
    promise.resolve(null)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    android.util.Log.d(TAG, "停止采集")
    isCapturing = false

    try { audioRecordMic?.stop(); audioRecordMic?.release() } catch (_: Exception) {}
    try { audioRecordSystem?.stop(); audioRecordSystem?.release() } catch (_: Exception) {}

    audioRecordMic = null
    audioRecordSystem = null
    lastMicLevel = 0f
    lastSystemLevel = 0f

    Thread.sleep(200)
    stopMediaProjectionService()

    android.util.Log.d(TAG, "已停止。MIC PCM: ${micOutputFile?.absolutePath}, SYSTEM PCM: ${systemOutputFile?.absolutePath}")
    promise.resolve(null)
  }

  @ReactMethod
  fun getAudioLevels(promise: Promise) {
    val map = Arguments.createMap()
    map.putDouble("mic", lastMicLevel.toDouble())
    map.putDouble("system", lastSystemLevel.toDouble())
    promise.resolve(map)
  }

  @ReactMethod
  fun getOutputFiles(promise: Promise) {
    val map = Arguments.createMap()
    map.putString("mic", lastMicFilePath)
    map.putString("system", lastSystemFilePath)
    promise.resolve(map)
  }

  // ═══════════════════════════════════════════════
  // Private state
  // ═══════════════════════════════════════════════

  private var audioRecordMic: android.media.AudioRecord? = null
  private var micOutputFile: java.io.File? = null
  private var audioRecordSystem: android.media.AudioRecord? = null
  private var systemOutputFile: java.io.File? = null
  private var mediaProjection: android.media.projection.MediaProjection? = null

  @Volatile private var isCapturing = false
  private var captureSource: String = "mic"

  @Volatile private var lastMicFilePath: String = ""
  @Volatile private var lastSystemFilePath: String = ""

  @Volatile private var lastMicLevel: Float = 0f
  @Volatile private var lastSystemLevel: Float = 0f

  private var mediaProjectionResult: Boolean? = null
  private val mediaProjectionLock = Object()
  private var pendingMediaProjectionPromise: Promise? = null

  private var configuredSampleRate: Int = DEFAULT_SAMPLE_RATE
  private var configuredChannelCount: Int = DEFAULT_CHANNEL_COUNT
  private var configuredEncoding: String = "pcm_16bit"

  companion object {
    const val NAME = "AudioCapture"
    private const val TAG = "AudioCapture"
    private const val DEFAULT_SAMPLE_RATE = 16000
    private const val DEFAULT_CHANNEL_COUNT = 1
    private const val MEDIA_PROJECTION_REQUEST_CODE = 1001
  }

  // ═══════════════════════════════════════════════
  // Private: MIC capture
  // ═══════════════════════════════════════════════
  private fun startMicCapture() {
    val sampleRates = listOf(configuredSampleRate, 44100, 48000, 8000)
    var lastErr: Exception? = null

    for (sr in sampleRates) {
      try {
        val chCfg = if (configuredChannelCount == 2) android.media.AudioFormat.CHANNEL_IN_STEREO
                    else android.media.AudioFormat.CHANNEL_IN_MONO
        val fmt = parseAudioFormat()

        val minBuf = android.media.AudioRecord.getMinBufferSize(sr, chCfg, fmt)
        if (minBuf <= 0) { lastErr = UnsupportedOperationException("不支持 $sr Hz"); continue }
        val bufSize = maxOf(minBuf, sr * 2)

        val rec = android.media.AudioRecord.Builder()
          .setAudioSource(android.media.MediaRecorder.AudioSource.MIC)
          .setAudioFormat(android.media.AudioFormat.Builder()
            .setEncoding(fmt).setSampleRate(sr).setChannelMask(chCfg).build())
          .setBufferSizeInBytes(bufSize)
          .build()

        if (rec.state != android.media.AudioRecord.STATE_INITIALIZED) {
          rec.release(); lastErr = IllegalStateException("MIC AudioRecord init fail @ $sr Hz"); continue
        }

        rec.startRecording()
        audioRecordMic = rec
        android.util.Log.d(TAG, "🎤 MIC: sr=$sr buf=$bufSize")

        val buf = ByteArray(bufSize)
        val fos = micOutputFile?.let { java.io.FileOutputStream(it) }
        Thread({ captureLoop(rec, buf, fos, isMic = true) }, "mic-capture").start()
        return
      } catch (e: Exception) {
        lastErr = e; android.util.Log.w(TAG, "MIC sr=$sr fail: ${e.message}")
      }
    }
    throw lastErr ?: IllegalStateException("MIC: 无可用采样率")
  }

  // ═══════════════════════════════════════════════
  // Private: SYSTEM capture
  // ═══════════════════════════════════════════════
  private fun startSystemCapture() {
    val mp = mediaProjection ?: throw IllegalStateException("MediaProjection is null")
    val sampleRates = listOf(configuredSampleRate, 44100, 48000, 8000)
    var lastErr: Exception? = null

    for (sr in sampleRates) {
      try {
        val chCfg = android.media.AudioFormat.CHANNEL_IN_STEREO
        val fmt = parseAudioFormat()

        val minBuf = android.media.AudioRecord.getMinBufferSize(sr, chCfg, fmt)
        val bufSize = if (minBuf > 0) maxOf(minBuf, sr * 4) else sr * 4

        val captureCfg = android.media.AudioPlaybackCaptureConfiguration.Builder(mp)
          .addMatchingUsage(android.media.AudioAttributes.USAGE_MEDIA)
          .addMatchingUsage(android.media.AudioAttributes.USAGE_GAME)
          .addMatchingUsage(android.media.AudioAttributes.USAGE_UNKNOWN)
          .addMatchingUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
          .build()

        val rec = android.media.AudioRecord.Builder()
          .setAudioPlaybackCaptureConfig(captureCfg)
          .setAudioFormat(android.media.AudioFormat.Builder()
            .setEncoding(fmt).setSampleRate(sr).setChannelMask(chCfg).build())
          .setBufferSizeInBytes(bufSize)
          .build()

        if (rec.state != android.media.AudioRecord.STATE_INITIALIZED) {
          rec.release(); lastErr = IllegalStateException("SYSTEM AudioRecord init fail @ $sr Hz"); continue
        }

        rec.startRecording()
        audioRecordSystem = rec
        android.util.Log.d(TAG, "🔊 SYSTEM: sr=$sr buf=$bufSize")

        val buf = ByteArray(bufSize)
        val fos = systemOutputFile?.let { java.io.FileOutputStream(it) }
        Thread({ captureLoop(rec, buf, fos, isMic = false) }, "system-capture").start()
        return
      } catch (e: Exception) {
        lastErr = e; android.util.Log.w(TAG, "SYSTEM sr=$sr fail: ${e.message}")
      }
    }
    throw lastErr ?: IllegalStateException("SYSTEM: 无可用采样率")
  }

  // ═══════════════════════════════════════════════
  // Private: capture loop
  // ═══════════════════════════════════════════════
  private fun captureLoop(
    recorder: android.media.AudioRecord,
    buffer: ByteArray,
    fos: java.io.FileOutputStream?,
    isMic: Boolean
  ) {
    val rmsBuf = ShortArray(256)

    try {
      while (isCapturing) {
        val rec = if (isMic) audioRecordMic else audioRecordSystem
        if (rec == null || rec.recordingState != android.media.AudioRecord.RECORDSTATE_RECORDING) break

        val read = rec.read(buffer, 0, buffer.size)
        if (read > 0) {
          fos?.write(buffer, 0, read)

          val shortCount = minOf(read / 2, rmsBuf.size)
          var sum = 0L
          for (i in 0 until shortCount) {
            val lo = buffer[i * 2].toInt() and 0xFF
            val hi = buffer[i * 2 + 1].toInt()
            val sample = (hi shl 8) or lo
            sum += (sample * sample).toLong()
          }
          val rms = if (shortCount > 0) {
            kotlin.math.sqrt(sum.toDouble() / shortCount).toFloat() / 32768f
          } else 0f

          if (isMic) lastMicLevel = rms else lastSystemLevel = rms

        } else if (read < 0) {
          android.util.Log.e(TAG, "${if (isMic) "MIC" else "SYSTEM"} read error: $read")
          break
        }
      }
    } catch (e: Exception) {
      android.util.Log.e(TAG, "${if (isMic) "MIC" else "SYSTEM"} thread: ${e.message}", e)
    } finally {
      fos?.close()
      android.util.Log.d(TAG, "${if (isMic) "MIC" else "SYSTEM"} thread exit")
    }
  }

  private fun parseAudioFormat(): Int = when (configuredEncoding) {
    "pcm_8bit" -> android.media.AudioFormat.ENCODING_PCM_8BIT
    "pcm_float" -> android.media.AudioFormat.ENCODING_PCM_FLOAT
    else -> android.media.AudioFormat.ENCODING_PCM_16BIT
  }

  // ═══════════════════════════════════════════════
  // Foreground service helpers
  // ═══════════════════════════════════════════════
  private fun startMediaProjectionService(context: android.content.Context) {
    val intent = Intent(context, MediaProjectionService::class.java)
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
    android.util.Log.d(TAG, "🔔 MediaProjection 前台服务已启动")
  }

  private fun stopMediaProjectionService() {
    val intent = Intent(reactApplicationContext, MediaProjectionService::class.java)
    reactApplicationContext.stopService(intent)
    android.util.Log.d(TAG, "🔕 MediaProjection 前台服务已停止")
  }
}
