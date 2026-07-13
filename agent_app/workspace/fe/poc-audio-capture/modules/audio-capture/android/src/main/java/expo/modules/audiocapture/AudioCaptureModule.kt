package expo.modules.audiocapture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * AudioCapture Expo Native Module (Android)
 *
 * 支持双路采集：
 *  - MIC:   MediaRecorder.AudioSource.MIC（麦克风）
 *  - SYSTEM: AudioPlaybackCapture API（设备内部音频，需 MediaProjection 授权）
 *  - BOTH:   双路并行采集
 */
class AudioCaptureModule : Module() {
  // ── MIC ──
  private var audioRecordMic: AudioRecord? = null
  private var micOutputFile: File? = null

  // ── SYSTEM ──
  private var audioRecordSystem: AudioRecord? = null
  private var systemOutputFile: File? = null
  private var mediaProjection: MediaProjection? = null

  // ── 共享 ──
  @Volatile private var isCapturing = false
  private var captureSource: String = "mic"

  // ── 输出文件路径（configure 时设置，供 JS 侧读取） ──
  @Volatile private var lastMicFilePath: String = ""
  @Volatile private var lastSystemFilePath: String = ""

  // ── 电平（采集线程写入，JS 线程读取） ──
  @Volatile private var lastMicLevel: Float = 0f
  @Volatile private var lastSystemLevel: Float = 0f

  // ── MediaProjection 授权桥 ──
  private var mediaProjectionResult: Boolean? = null
  private val mediaProjectionLock = Object()

  // ── 配置 ──
  private var configuredSampleRate: Int = DEFAULT_SAMPLE_RATE
  private var configuredChannelCount: Int = DEFAULT_CHANNEL_COUNT
  private var configuredEncoding: String = "pcm_16bit"

  companion object {
    private const val TAG = "AudioCapture"
    private const val DEFAULT_SAMPLE_RATE = 16000
    private const val DEFAULT_CHANNEL_COUNT = 1
    private const val MEDIA_PROJECTION_REQUEST_CODE = 1001
  }

  override fun definition() = ModuleDefinition {
    Name("AudioCapture")

    // ═══════════════════════════════════════════
    // Activity Result Handler
    // ═══════════════════════════════════════════
    OnActivityResult { _, payload ->
      if (payload.requestCode == MEDIA_PROJECTION_REQUEST_CODE) {
        val data: Intent? = payload.data
        if (payload.resultCode == Activity.RESULT_OK && data != null) {
          val ctx = appContext.reactContext ?: run {
            Log.e(TAG, "React context is null — 无法获取 MediaProjection")
            synchronized(mediaProjectionLock) {
              mediaProjectionResult = false
              mediaProjectionLock.notifyAll()
            }
            return@OnActivityResult
          }

          val manager = ctx.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
          mediaProjection = manager.getMediaProjection(payload.resultCode, data)
          Log.d(TAG, "✅ MediaProjection 授权成功")
          synchronized(mediaProjectionLock) {
            mediaProjectionResult = true
            mediaProjectionLock.notifyAll()
          }
        } else {
          Log.w(TAG, "❌ MediaProjection 授权被拒绝")
          synchronized(mediaProjectionLock) {
            mediaProjectionResult = false
            mediaProjectionLock.notifyAll()
          }
        }
      }
    }

    // ═══════════════════════════════════════════
    // 设备能力检测
    // ═══════════════════════════════════════════
    AsyncFunction("isSupported") {
      val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
      Log.d(TAG, "isSupported: $supported (SDK ${Build.VERSION.SDK_INT})")
      supported
    }

    AsyncFunction("hasMediaProjection") {
      mediaProjection != null
    }

    // ═══════════════════════════════════════════
    // MediaProjection 授权（弹系统对话框）
    // ═══════════════════════════════════════════
    AsyncFunction("requestMediaProjection") {
      val activity = appContext.currentActivity
        ?: return@AsyncFunction false

      // ── Android 14+: 在弹授权对话框前先启动前台服务 ──
      // 这样当 OnActivityResult 拿到 MediaProjection 时，服务已经在运行
      startMediaProjectionService(activity)

      // Wait up to 3 seconds for the service's startForeground() to complete.
      // Without this the system may reject the MediaProjection because
      // startForegroundService() is async and startForeground() may not have run yet.
      val deadline = System.currentTimeMillis() + 3000
      while (!MediaProjectionService.isRunning && System.currentTimeMillis() < deadline) {
        Thread.sleep(50)
      }
      if (!MediaProjectionService.isRunning) {
        Log.e(TAG, "MediaProjectionService failed to start within deadline")
        stopMediaProjectionService()
        return@AsyncFunction false
      }
      Log.d(TAG, "MediaProjectionService confirmed running, showing dialog")

      val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      activity.startActivityForResult(
        manager.createScreenCaptureIntent(),
        MEDIA_PROJECTION_REQUEST_CODE
      )
      Log.d(TAG, "📺 MediaProjection 授权对话框已弹出")
      synchronized(mediaProjectionLock) {
        mediaProjectionLock.wait()
      }
      // 如果用户拒绝授权，停止前台服务
      if (mediaProjectionResult != true) {
        stopMediaProjectionService()
      }
      mediaProjectionResult ?: false
    }

    // ═══════════════════════════════════════════
    // 采集源选择
    // ═══════════════════════════════════════════
    AsyncFunction("setCaptureSource") { source: String ->
      require(source in listOf("mic", "system", "both")) {
        "illegal source: $source. Must be 'mic' | 'system' | 'both'"
      }
      captureSource = source
      Log.d(TAG, "captureSource → $source")
    }

    AsyncFunction("getCaptureSource") {
      captureSource
    }

    // ═══════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════
    AsyncFunction("configure") { config: Map<String, Any> ->
      configuredSampleRate = (config["sampleRate"] as? Number)?.toInt() ?: DEFAULT_SAMPLE_RATE
      configuredChannelCount = (config["channelCount"] as? Number)?.toInt() ?: DEFAULT_CHANNEL_COUNT
      configuredEncoding = config["encoding"] as? String ?: "pcm_16bit"

      val appContext2 = appContext.reactContext
        ?: throw IllegalStateException("React context is null")

      // 为每个源准备独立 PCM 文件
      val ts = System.currentTimeMillis()
      micOutputFile = File(appContext2.cacheDir, "mic_${ts}.pcm")
      systemOutputFile = File(appContext2.cacheDir, "system_${ts}.pcm")

      lastMicFilePath = micOutputFile?.absolutePath ?: ""
      lastSystemFilePath = systemOutputFile?.absolutePath ?: ""

      Log.d(TAG, "configure: sr=$configuredSampleRate ch=$configuredChannelCount enc=$configuredEncoding")
      Log.d(TAG, "  mic → ${micOutputFile?.absolutePath}")
      Log.d(TAG, "  sys → ${systemOutputFile?.absolutePath}")
    }

    // ═══════════════════════════════════════════
    // 开始采集
    // ═══════════════════════════════════════════
    AsyncFunction("start") {
      if (isCapturing) {
        Log.w(TAG, "已在采集中，忽略重复 start")
      } else {
        val needsMic = captureSource == "mic" || captureSource == "both"
        val needsSystem = captureSource == "system" || captureSource == "both"

        if (!needsMic && !needsSystem) {
          throw IllegalStateException("captureSource 未设置")
        }

        if (needsSystem && mediaProjection == null) {
          throw IllegalStateException("系统音频采集需要先授权 MediaProjection，请调用 requestMediaProjection()")
        }

        isCapturing = true

        // ── 启动 MIC 采集线程 ──
        if (needsMic) {
          startMicCapture()
        }

        // ── 启动 SYSTEM 采集线程 ──
        if (needsSystem) {
          startSystemCapture()
        }

        Log.d(TAG, "✅ 采集已启动: source=$captureSource")
      }
    }

    // ═══════════════════════════════════════════
    // 停止采集
    // ═══════════════════════════════════════════
    AsyncFunction("stop") {
      Log.d(TAG, "停止采集")
      isCapturing = false

      try { audioRecordMic?.stop(); audioRecordMic?.release() } catch (_: Exception) {}
      try { audioRecordSystem?.stop(); audioRecordSystem?.release() } catch (_: Exception) {}

      audioRecordMic = null
      audioRecordSystem = null
      lastMicLevel = 0f
      lastSystemLevel = 0f

      // ── 停止 MediaProjection 前台服务 ──
      // Brief delay to let capture threads finish before killing the foreground service
      Thread.sleep(200)
      stopMediaProjectionService()

      Log.d(TAG, "已停止。MIC PCM: ${micOutputFile?.absolutePath}, SYSTEM PCM: ${systemOutputFile?.absolutePath}")
    }

    // ═══════════════════════════════════════════
    // 音量电平
    // ═══════════════════════════════════════════
    AsyncFunction("getAudioLevels") {
      mapOf("mic" to lastMicLevel, "system" to lastSystemLevel)
    }

    // ═══════════════════════════════════════════
    // 输出文件路径
    // ═══════════════════════════════════════════
    AsyncFunction("getOutputFiles") {
      mapOf("mic" to lastMicFilePath, "system" to lastSystemFilePath)
    }
  }

  // ═══════════════════════════════════════════════
  // Private: MIC 采集
  // ═══════════════════════════════════════════════
  private fun startMicCapture() {
    val sampleRates = listOf(configuredSampleRate, 44100, 48000, 8000)
    var lastErr: Exception? = null

    for (sr in sampleRates) {
      try {
        val chCfg = if (configuredChannelCount == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
        val fmt = parseAudioFormat()

        val minBuf = AudioRecord.getMinBufferSize(sr, chCfg, fmt)
        if (minBuf <= 0) { lastErr = UnsupportedOperationException("不支持 $sr Hz"); continue }
        val bufSize = maxOf(minBuf, sr * 2)

        val rec = AudioRecord.Builder()
          .setAudioSource(MediaRecorder.AudioSource.MIC)
          .setAudioFormat(AudioFormat.Builder().setEncoding(fmt).setSampleRate(sr).setChannelMask(chCfg).build())
          .setBufferSizeInBytes(bufSize)
          .build()

        if (rec.state != AudioRecord.STATE_INITIALIZED) {
          rec.release(); lastErr = IllegalStateException("MIC AudioRecord init fail @ $sr Hz"); continue
        }

        rec.startRecording()
        audioRecordMic = rec
        Log.d(TAG, "🎤 MIC: sr=$sr buf=$bufSize")

        val buf = ByteArray(bufSize)
        val fos = micOutputFile?.let { FileOutputStream(it) }
        Thread({ captureLoop(rec, buf, fos, isMic = true) }, "mic-capture").start()
        return
      } catch (e: Exception) {
        lastErr = e; Log.w(TAG, "MIC sr=$sr fail: ${e.message}")
      }
    }
    throw lastErr ?: IllegalStateException("MIC: 无可用采样率")
  }

  // ═══════════════════════════════════════════════
  // Private: SYSTEM 采集 (AudioPlaybackCapture)
  // ═══════════════════════════════════════════════
  private fun startSystemCapture() {
    val mp = mediaProjection ?: throw IllegalStateException("MediaProjection is null")
    val sampleRates = listOf(configuredSampleRate, 44100, 48000, 8000)
    var lastErr: Exception? = null

    for (sr in sampleRates) {
      try {
        // 系统音频通常是立体声
        val chCfg = AudioFormat.CHANNEL_IN_STEREO
        val fmt = parseAudioFormat()

        val minBuf = AudioRecord.getMinBufferSize(sr, chCfg, fmt)
        val bufSize = if (minBuf > 0) maxOf(minBuf, sr * 4) else sr * 4

        val captureCfg = AudioPlaybackCaptureConfiguration.Builder(mp)
          .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
          .addMatchingUsage(AudioAttributes.USAGE_GAME)
          .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
          .addMatchingUsage(AudioAttributes.USAGE_NOTIFICATION)
          .build()

        val rec = AudioRecord.Builder()
          .setAudioPlaybackCaptureConfig(captureCfg)
          .setAudioFormat(AudioFormat.Builder().setEncoding(fmt).setSampleRate(sr).setChannelMask(chCfg).build())
          .setBufferSizeInBytes(bufSize)
          .build()

        if (rec.state != AudioRecord.STATE_INITIALIZED) {
          rec.release(); lastErr = IllegalStateException("SYSTEM AudioRecord init fail @ $sr Hz"); continue
        }

        rec.startRecording()
        audioRecordSystem = rec
        Log.d(TAG, "🔊 SYSTEM: sr=$sr buf=$bufSize")

        val buf = ByteArray(bufSize)
        val fos = systemOutputFile?.let { FileOutputStream(it) }
        Thread({ captureLoop(rec, buf, fos, isMic = false) }, "system-capture").start()
        return
      } catch (e: Exception) {
        lastErr = e; Log.w(TAG, "SYSTEM sr=$sr fail: ${e.message}")
      }
    }
    throw lastErr ?: IllegalStateException("SYSTEM: 无可用采样率")
  }

  // ═══════════════════════════════════════════════
  // Private: 采集循环（MIC & SYSTEM 共用）
  // ═══════════════════════════════════════════════
  private fun captureLoop(
    recorder: AudioRecord,
    buffer: ByteArray,
    fos: FileOutputStream?,
    isMic: Boolean
  ) {
    val rmsBuf = ShortArray(256)

    try {
      while (isCapturing) {
        val rec = if (isMic) audioRecordMic else audioRecordSystem
        if (rec == null || rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) break

        val read = rec.read(buffer, 0, buffer.size)
        if (read > 0) {
          fos?.write(buffer, 0, read)

          // 计算 RMS 电平
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
          Log.e(TAG, "${if (isMic) "MIC" else "SYSTEM"} read error: $read")
          break
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "${if (isMic) "MIC" else "SYSTEM"} thread: ${e.message}", e)
    } finally {
      fos?.close()
      Log.d(TAG, "${if (isMic) "MIC" else "SYSTEM"} thread exit")
    }
  }

  // ── helper ──
  private fun parseAudioFormat(): Int = when (configuredEncoding) {
    "pcm_8bit" -> AudioFormat.ENCODING_PCM_8BIT
    "pcm_float" -> AudioFormat.ENCODING_PCM_FLOAT
    else       -> AudioFormat.ENCODING_PCM_16BIT
  }

  // ═══════════════════════════════════════════════
  // Foreground Service 管理（Android 14+ 要求）
  // ═══════════════════════════════════════════════

  private fun startMediaProjectionService(context: Context) {
    val intent = Intent(context, MediaProjectionService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
    Log.d(TAG, "🔔 MediaProjection 前台服务已启动")
  }

  private fun stopMediaProjectionService() {
    val ctx = appContext.reactContext ?: return
    val intent = Intent(ctx, MediaProjectionService::class.java)
    ctx.stopService(intent)
    Log.d(TAG, "🔕 MediaProjection 前台服务已停止")
  }
}
