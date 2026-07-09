package expo.modules.audiocapture

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * AudioCapture Expo Native Module (Android)
 *
 * PoC 阶段：使用 AudioRecord 从麦克风采集，验证采集管道。
 * 后续升级 AudioPlaybackCapture（需 MediaProjection 授权）捕获系统内部音频。
 */
class AudioCaptureModule : Module() {
  private var audioRecord: AudioRecord? = null

  /** 跨线程可见——stop() 在主线程写入，采集线程读取 */
  @Volatile
  private var isCapturing = false

  private var outputFile: File? = null

  /** 存储 configure() 传入的参数，供 start() 使用 */
  private var configuredSampleRate: Int = DEFAULT_SAMPLE_RATE
  private var configuredChannelCount: Int = DEFAULT_CHANNEL_COUNT
  private var configuredEncoding: String = "pcm_16bit"

  companion object {
    private const val TAG = "AudioCapture"
    private const val DEFAULT_SAMPLE_RATE = 16000
    private const val DEFAULT_CHANNEL_COUNT = 1
  }

  override fun definition() = ModuleDefinition {
    Name("AudioCapture")

    // 检查是否支持系统音频采集
    AsyncFunction("isSupported") {
      val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
      Log.d(TAG, "isSupported: $supported (SDK ${Build.VERSION.SDK_INT})")
      supported
    }

    // 配置采集参数
    AsyncFunction("configure") { config: Map<String, Any> ->
      configuredSampleRate = (config["sampleRate"] as? Number)?.toInt() ?: DEFAULT_SAMPLE_RATE
      configuredChannelCount = (config["channelCount"] as? Number)?.toInt() ?: DEFAULT_CHANNEL_COUNT
      configuredEncoding = config["encoding"] as? String ?: "pcm_16bit"

      Log.d(TAG, "configure: sampleRate=$configuredSampleRate, channels=$configuredChannelCount, encoding=$configuredEncoding")

      // 准备输出文件
      val appContext = appContext.reactContext ?: throw IllegalStateException("React context is null")
      outputFile = File(appContext.cacheDir, "audio_capture_${System.currentTimeMillis()}.pcm")
      Log.d(TAG, "output file: ${outputFile?.absolutePath}")

      Unit
    }

    // 开始采集
    AsyncFunction("start") {
      if (isCapturing) {
        Log.w(TAG, "已经在采集中，忽略重复 start")
      } else {
        val sampleRate = configuredSampleRate
        val channelConfig = if (configuredChannelCount == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
        val audioFormat = when (configuredEncoding) {
          "pcm_8bit" -> AudioFormat.ENCODING_PCM_8BIT
          "pcm_float" -> AudioFormat.ENCODING_PCM_FLOAT
          else -> AudioFormat.ENCODING_PCM_16BIT
        }

        // 计算缓冲区大小
        val minBufSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
        val bufferSize = maxOf(minBufSize, sampleRate * 2) // 至少 1 秒缓冲

        try {
          // PoC 阶段直接用麦克风采集，绕过 MediaProjection 授权流程
          audioRecord = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.MIC)
            .setAudioFormat(
              AudioFormat.Builder()
                .setEncoding(audioFormat)
                .setSampleRate(sampleRate)
                .setChannelMask(channelConfig)
                .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .build()

          audioRecord?.startRecording()
          isCapturing = true

          Log.d(TAG, "开始采集(MIC): bufferSize=$bufferSize, state=${audioRecord?.state}")

          // 启动读取线程
          Thread {
            val buffer = ByteArray(bufferSize)
            val fos = outputFile?.let { FileOutputStream(it) }

            try {
              while (isCapturing) {
                val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
                if (read > 0 && fos != null) {
                  fos.write(buffer, 0, read)
                } else if (read < 0) {
                  Log.e(TAG, "读取错误: $read")
                  break
                }
              }
            } catch (e: Exception) {
              Log.e(TAG, "采集线程异常: ${e.message}", e)
            } finally {
              fos?.close()
            }
          }.start()

        } catch (e: SecurityException) {
          Log.e(TAG, "权限不足: 需要 RECORD_AUDIO 权限", e)
          throw IllegalStateException("需要麦克风权限，请在 AndroidManifest 中声明 RECORD_AUDIO")
        } catch (e: Exception) {
          Log.e(TAG, "启动采集失败: ${e.message}", e)
          throw e
        }
      }

      Unit
    }

    // 停止采集
    AsyncFunction("stop") {
      Log.d(TAG, "停止采集")
      isCapturing = false

      try {
        audioRecord?.stop()
        audioRecord?.release()
      } catch (e: Exception) {
        Log.w(TAG, "释放 AudioRecord 时异常: ${e.message}")
      } finally {
        audioRecord = null
      }

      Log.d(TAG, "已停止，PCM 文件: ${outputFile?.absolutePath}")

      Unit
    }

    // 获取当前音量
    AsyncFunction("getAudioLevel") {
      if (!isCapturing || audioRecord == null) {
        return@AsyncFunction 0.0
      }

      // 简单估算：读取最近一帧的 RMS
      try {
        val buffer = ShortArray(256)
        val state = audioRecord?.state ?: AudioRecord.STATE_UNINITIALIZED
        if (state != AudioRecord.STATE_INITIALIZED) {
          return@AsyncFunction 0.0
        }
        // 用 recordingState 判断（非阻塞，通过 getRoutedDevice 或简单返回占位值）
        // PoC 阶段简化：返回 0.5 表示管道通
        0.5
      } catch (e: Exception) {
        0.0
      }
    }
  }
}
