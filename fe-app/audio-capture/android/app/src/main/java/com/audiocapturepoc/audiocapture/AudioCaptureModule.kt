package com.audiocapturepoc.audiocapture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjectionManager
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Environment
import com.facebook.react.bridge.*
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.math.sqrt

class AudioCaptureModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "AudioCapture"
        private const val REQUEST_CODE = 999

        // Default audio config
        private const val DEFAULT_SAMPLE_RATE = 16000
        private const val DEFAULT_CHANNEL_COUNT = 1
    }

    // State
    private var mediaProjection: MediaProjection? = null
    private var captureSource: CaptureSource = CaptureSource.MIC
    private var sampleRate: Int = DEFAULT_SAMPLE_RATE
    private var channelCount: Int = DEFAULT_CHANNEL_COUNT
    private var isCapturing = false

    // Recorders
    private var micRecorder: AudioRecord? = null
    private var systemRecorder: AudioRecord? = null

    // Recording threads
    private var micThread: Thread? = null
    private var systemThread: Thread? = null

    // Output files
    private var micOutputFile: File? = null
    private var systemOutputFile: File? = null
    private var micOutputStream: FileOutputStream? = null
    private var systemOutputStream: FileOutputStream? = null

    // Audio levels (RMS normalized 0.0-1.0)
    @Volatile private var micLevel: Double = 0.0
    @Volatile private var systemLevel: Double = 0.0

    // MediaProjection promise
    private var mediaProjectionPromise: Promise? = null

    // Capture source enum
    private enum class CaptureSource {
        MIC, SYSTEM, BOTH
    }

    override fun getName(): String = NAME

    // ── Context helpers ──
    private val currentAct: Activity?
        get() = reactApplicationContext.currentActivity

    // ── React Methods ──

    @ReactMethod
    fun isSupported(promise: Promise) {
        promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
    }

    @ReactMethod
    fun hasMediaProjection(promise: Promise) {
        promise.resolve(mediaProjection != null)
    }

    @ReactMethod
    fun requestMediaProjection(promise: Promise) {
        val activity = currentAct
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity available")
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            promise.reject("UNSUPPORTED", "System audio capture requires Android 10+")
            return
        }

        try {
            mediaProjectionPromise = promise
            val manager = reactApplicationContext
                .getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val intent = manager.createScreenCaptureIntent()
            activity.startActivityForResult(intent, REQUEST_CODE)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to request MediaProjection: ${e.message}")
            mediaProjectionPromise = null
        }
    }

    @ReactMethod
    fun setCaptureSource(source: String, promise: Promise) {
        captureSource = when (source) {
            "mic" -> CaptureSource.MIC
            "system" -> CaptureSource.SYSTEM
            "both" -> CaptureSource.BOTH
            else -> {
                promise.reject("INVALID_SOURCE", "Unknown source: $source")
                return
            }
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun getCaptureSource(promise: Promise) {
        promise.resolve(captureSource.name.lowercase())
    }

    @ReactMethod
    fun configure(config: ReadableMap, promise: Promise) {
        sampleRate = config.getInt("sampleRate")
        channelCount = config.getInt("channelCount")
        // encoding is ignored for now — always use PCM 16bit
        promise.resolve(null)
    }

    @ReactMethod
    fun start(promise: Promise) {
        if (isCapturing) {
            promise.reject("ALREADY_RUNNING", "Capture is already active")
            return
        }

        val needsMic = captureSource == CaptureSource.MIC || captureSource == CaptureSource.BOTH
        val needsSystem = captureSource == CaptureSource.SYSTEM || captureSource == CaptureSource.BOTH

        if (needsSystem && mediaProjection == null) {
            promise.reject("NO_AUTH", "MediaProjection authorization required for system audio")
            return
        }

        try {
            // Setup output files
            val cacheDir = reactApplicationContext.cacheDir
            val timestamp = System.currentTimeMillis()

            if (needsMic) {
                micOutputFile = File(cacheDir, "mic_$timestamp.pcm")
                micOutputStream = FileOutputStream(micOutputFile)
                micRecorder = createMicRecorder()
            }

            if (needsSystem) {
                systemOutputFile = File(cacheDir, "system_$timestamp.pcm")
                systemOutputStream = FileOutputStream(systemOutputFile)
                systemRecorder = createSystemRecorder()
            }

            // Start recorders
            micRecorder?.startRecording()
            systemRecorder?.startRecording()

            isCapturing = true
            micLevel = 0.0
            systemLevel = 0.0

            // Start recording threads
            micRecorder?.let { recorder ->
                micThread = startReadingThread(recorder, micOutputStream!!, isMic = true)
            }
            systemRecorder?.let { recorder ->
                systemThread = startReadingThread(recorder, systemOutputStream!!, isMic = false)
            }

            promise.resolve(null)
        } catch (e: Exception) {
            cleanup()
            promise.reject("START_ERROR", "Failed to start capture: ${e.message}")
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            isCapturing = false

            // Stop threads
            micThread?.join(1000)
            systemThread?.join(1000)
            micThread = null
            systemThread = null

            // Stop and release recorders
            safeStopRecorder(micRecorder)
            safeStopRecorder(systemRecorder)
            micRecorder = null
            systemRecorder = null

            // Close output streams
            safeClose(micOutputStream)
            safeClose(systemOutputStream)
            micOutputStream = null
            systemOutputStream = null

            micLevel = 0.0
            systemLevel = 0.0

            promise.resolve(null)
        } catch (e: Exception) {
            cleanup()
            promise.reject("STOP_ERROR", "Failed to stop capture: ${e.message}")
        }
    }

    @ReactMethod
    fun getAudioLevels(promise: Promise) {
        val map = WritableNativeMap()
        map.putDouble("mic", micLevel)
        map.putDouble("system", systemLevel)
        promise.resolve(map)
    }

    @ReactMethod
    fun getOutputFiles(promise: Promise) {
        val map = WritableNativeMap()
        map.putString("mic", micOutputFile?.absolutePath ?: "")
        map.putString("system", systemOutputFile?.absolutePath ?: "")
        promise.resolve(map)
    }

    // ── Activity Result Handler ──
    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return

        val promise = mediaProjectionPromise
        mediaProjectionPromise = null

        if (resultCode == Activity.RESULT_OK && data != null) {
            try {
                val manager = reactApplicationContext
                    .getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                mediaProjection = manager.getMediaProjection(resultCode, data)
                promise?.resolve(true)
            } catch (e: Exception) {
                promise?.resolve(false)
            }
        } else {
            mediaProjection = null
            promise?.resolve(false)
        }
    }

    // ── Private Helpers ──

    private fun createMicRecorder(): AudioRecord {
        val channelConfig = if (channelCount == 2) {
            AudioFormat.CHANNEL_IN_STEREO
        } else {
            AudioFormat.CHANNEL_IN_MONO
        }
        val bufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, AudioFormat.ENCODING_PCM_16BIT)

        return AudioRecord.Builder()
            .setAudioSource(android.media.MediaRecorder.AudioSource.MIC)
            .setAudioFormat(AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(channelConfig)
                .build())
            .setBufferSizeInBytes(bufferSize * 2)
            .build()
    }

    private fun createSystemRecorder(): AudioRecord {
        val channelConfig = if (channelCount == 2) {
            AudioFormat.CHANNEL_IN_STEREO
        } else {
            AudioFormat.CHANNEL_IN_MONO
        }
        val bufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, AudioFormat.ENCODING_PCM_16BIT)

        val captureConfig = AudioPlaybackCaptureConfiguration.Builder(mediaProjection!!)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()

        return AudioRecord.Builder()
            .setAudioPlaybackCaptureConfig(captureConfig)
            .setAudioFormat(AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(channelConfig)
                .build())
            .setBufferSizeInBytes(bufferSize * 2)
            .build()
    }

    private fun startReadingThread(
        recorder: AudioRecord,
        outputStream: FileOutputStream,
        isMic: Boolean
    ): Thread {
        val bufferSize = recorder.bufferSizeInFrames * 2 // 16bit = 2 bytes per sample
        val buffer = ShortArray(recorder.bufferSizeInFrames)

        val thread = Thread {
            try {
                while (isCapturing && !Thread.currentThread().isInterrupted) {
                    val read = recorder.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        // Calculate RMS level
                        var sum = 0.0
                        for (i in 0 until read) {
                            val sample = buffer[i].toDouble() / Short.MAX_VALUE.toDouble()
                            sum += sample * sample
                        }
                        val rms = sqrt(sum / read)
                        if (isMic) {
                            micLevel = rms.coerceIn(0.0, 1.0)
                        } else {
                            systemLevel = rms.coerceIn(0.0, 1.0)
                        }

                        // Write PCM to file (convert shorts to bytes, little-endian)
                        val byteBuffer = ByteArray(read * 2)
                        for (i in 0 until read) {
                            val s = buffer[i].toInt()
                            byteBuffer[i * 2] = (s and 0xFF).toByte()
                            byteBuffer[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
                        }
                        outputStream.write(byteBuffer)
                    }
                }
            } catch (e: IOException) {
                // Recording stopped or error
            }
        }

        thread.priority = Thread.MAX_PRIORITY
        thread.start()
        return thread
    }

    private fun safeStopRecorder(recorder: AudioRecord?) {
        try {
            recorder?.stop()
            recorder?.release()
        } catch (_: Exception) {}
    }

    private fun safeClose(stream: FileOutputStream?) {
        try {
            stream?.flush()
            stream?.close()
        } catch (_: Exception) {}
    }

    private fun cleanup() {
        isCapturing = false
        micThread?.interrupt()
        systemThread?.interrupt()
        micThread = null
        systemThread = null
        safeStopRecorder(micRecorder)
        safeStopRecorder(systemRecorder)
        micRecorder = null
        systemRecorder = null
        safeClose(micOutputStream)
        safeClose(systemOutputStream)
        micOutputStream = null
        systemOutputStream = null
        micLevel = 0.0
        systemLevel = 0.0
    }
}
