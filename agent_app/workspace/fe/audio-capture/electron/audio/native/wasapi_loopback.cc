/**
 * WASAPI Loopback 音频采集 —— Node.js N-API addon
 *
 * 捕获 Windows 系统混音输出，不受 VoIP App 限制。
 * 编译：cd electron/audio/native && npx node-gyp rebuild
 */
#include <napi.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <ksmedia.h>
#include <functiondiscoverykeys_devpkey.h>
#include <windows.h>
#include <vector>
#include <thread>
#include <atomic>
#include <mutex>

#pragma comment(lib, "ole32.lib")

// ── REFERENCE_TIME 转换 ──
#define REFTIMES_PER_SEC  10000000
#define REFTIMES_PER_MILLISEC 10000

class WasapiLoopback : public Napi::ObjectWrap<WasapiLoopback> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  WasapiLoopback(const Napi::CallbackInfo& info);

private:
  Napi::Value Start(const Napi::CallbackInfo& info);
  Napi::Value Stop(const Napi::CallbackInfo& info);
  Napi::Value GetSampleRate(const Napi::CallbackInfo& info);
  Napi::Value GetChannels(const Napi::CallbackInfo& info);
  Napi::Value GetBitsPerSample(const Napi::CallbackInfo& info);
  Napi::Value GetIsFloat(const Napi::CallbackInfo& info);

  void CaptureLoop();

  IMMDeviceEnumerator* _enumerator = nullptr;
  IMMDevice* _device = nullptr;
  IAudioClient* _client = nullptr;
  IAudioCaptureClient* _captureClient = nullptr;
  WAVEFORMATEX* _waveFormat = nullptr;

  std::thread _captureThread;
  std::atomic<bool> _running{false};
  std::atomic<bool> _threadDone{false};
  Napi::ThreadSafeFunction _tsfn;
  UINT32 _bufferFrames = 0;
  bool _comInitialized = false; // 主线程 COM 是否由本对象初始化（配对 Uninitialize 用）
};

// ── 模块注册 ──
Napi::Object WasapiLoopback::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "WasapiLoopback", {
    InstanceMethod("start", &WasapiLoopback::Start),
    InstanceMethod("stop", &WasapiLoopback::Stop),
    InstanceAccessor("sampleRate", &WasapiLoopback::GetSampleRate, nullptr),
    InstanceAccessor("channels", &WasapiLoopback::GetChannels, nullptr),
    InstanceAccessor("bitsPerSample", &WasapiLoopback::GetBitsPerSample, nullptr),
    InstanceAccessor("isFloat", &WasapiLoopback::GetIsFloat, nullptr),
  });
  exports.Set("WasapiLoopback", func);
  return exports;
}

// ── 格式属性（JS 侧据此做 PCM 归一化） ──
Napi::Value WasapiLoopback::GetSampleRate(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), _waveFormat ? _waveFormat->nSamplesPerSec : 48000);
}

Napi::Value WasapiLoopback::GetChannels(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), _waveFormat ? _waveFormat->nChannels : 2);
}

Napi::Value WasapiLoopback::GetBitsPerSample(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), _waveFormat ? _waveFormat->wBitsPerSample : 16);
}

Napi::Value WasapiLoopback::GetIsFloat(const Napi::CallbackInfo& info) {
  bool isFloat = false;
  if (_waveFormat) {
    if (_waveFormat->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
      isFloat = true;
    } else if (_waveFormat->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
      // WAVEFORMATEXTENSIBLE 的 SubFormat 指向真实类型
      const WAVEFORMATEXTENSIBLE* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(_waveFormat);
      isFloat = (ext->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
    }
  }
  return Napi::Boolean::New(info.Env(), isFloat);
}

// ── 构造函数 ──
WasapiLoopback::WasapiLoopback(const Napi::CallbackInfo& info) : Napi::ObjectWrap<WasapiLoopback>(info) {
  Napi::Env env = info.Env();

  // 初始化 COM。注意：Electron 主进程（Chromium UI 线程）已是 STA，MTA 初始化
  // 会返回 RPC_E_CHANGED_MODE —— 此时复用现有线程模型继续，属正常路径；
  // WASAPI 的 MMDeviceEnumerator/IAudioClient 均为 free-threaded，跨公寓调用安全。
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    Napi::Error::New(env, "CoInitializeEx failed").ThrowAsJavaScriptException();
    return;
  }
  _comInitialized = (hr == S_OK); // RPC_E_CHANGED_MODE 时 COM 归 Chromium 管，不得 Uninitialize

  // 创建设备枚举器
  hr = CoCreateInstance(
    __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
    __uuidof(IMMDeviceEnumerator), (void**)&_enumerator
  );
  if (FAILED(hr) || !_enumerator) {
    Napi::Error::New(env, "Failed to create MMDeviceEnumerator").ThrowAsJavaScriptException();
    return;
  }

  // 获取默认渲染设备（扬声器）
  hr = _enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &_device);
  if (FAILED(hr) || !_device) {
    Napi::Error::New(env, "Failed to get default audio render device").ThrowAsJavaScriptException();
    return;
  }

  // 激活 IAudioClient（Loopback 模式）
  hr = _device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&_client);
  if (FAILED(hr) || !_client) {
    Napi::Error::New(env, "Failed to activate IAudioClient").ThrowAsJavaScriptException();
    return;
  }

  // 获取混音格式
  hr = _client->GetMixFormat(&_waveFormat);
  if (FAILED(hr)) {
    Napi::Error::New(env, "GetMixFormat failed").ThrowAsJavaScriptException();
    return;
  }
}

// ── Start ──
Napi::Value WasapiLoopback::Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (_running) {
    return Napi::Boolean::New(env, false);
  }

  // 需要回调函数：(err, buffer) => void
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::Error::New(env, "Expected callback function").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  HRESULT hr;

  // 初始化音频客户端（Loopback 模式，共享）
  hr = _client->Initialize(
    AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK,
    REFTIMES_PER_SEC, // 1 秒缓冲区
    0,
    _waveFormat,
    nullptr
  );
  if (FAILED(hr)) {
    Napi::Error::New(env, "IAudioClient::Initialize failed").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  // 获取缓冲区大小
  hr = _client->GetBufferSize(&_bufferFrames);
  if (FAILED(hr)) {
    Napi::Error::New(env, "GetBufferSize failed").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  // 获取 IAudioCaptureClient
  hr = _client->GetService(__uuidof(IAudioCaptureClient), (void**)&_captureClient);
  if (FAILED(hr)) {
    Napi::Error::New(env, "GetService IAudioCaptureClient failed").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  // 创建 ThreadSafeFunction 用于回调
  _tsfn = Napi::ThreadSafeFunction::New(
    env,
    info[0].As<Napi::Function>(),
    "WASAPI Callback",
    0,  // unlimited queue
    1   // single thread
  );

  // 启动音频客户端
  hr = _client->Start();
  if (FAILED(hr)) {
    Napi::Error::New(env, "IAudioClient::Start failed").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  // 启动采集线程
  _running = true;
  _captureThread = std::thread(&WasapiLoopback::CaptureLoop, this);

  return Napi::Boolean::New(env, true);
}

// ── Capture Loop ──
void WasapiLoopback::CaptureLoop() {
  UINT32 packetLength = 0;
  BYTE* data = nullptr;
  UINT32 framesAvailable = 0;
  DWORD flags = 0;
  HRESULT hr;

  // 采集线程独立初始化 COM（MTA，新线程不会 RPC_E_CHANGED_MODE）；
  // 跨公寓（主线程 STA → 本线程 MTA）调用依赖对象 free-threaded 特性
  hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    _threadDone = true;
    _tsfn.Release();
    return;
  }

  while (_running) {
    // 等待下一批数据（10ms 超时）
    Sleep(10);

    hr = _captureClient->GetNextPacketSize(&packetLength);
    if (FAILED(hr)) continue;

    while (packetLength > 0) {
      hr = _captureClient->GetBuffer(&data, &framesAvailable, &flags, nullptr, nullptr);
      if (FAILED(hr)) break;

      if (framesAvailable > 0 && !(flags & AUDCLNT_BUFFERFLAGS_SILENT)) {
        UINT32 bytesToCopy = framesAvailable * _waveFormat->nBlockAlign;

        // 通过 ThreadSafeFunction 回调到 JS
        auto callback = [bytesToCopy, data](Napi::Env env, Napi::Function jsCallback) {
          Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::Copy(env, data, bytesToCopy);
          jsCallback.Call({ env.Null(), buf });
        };

        _tsfn.BlockingCall(callback);
      }

      hr = _captureClient->ReleaseBuffer(framesAvailable);
      if (FAILED(hr)) break;

      hr = _captureClient->GetNextPacketSize(&packetLength);
      if (FAILED(hr)) break;
    }
  }

  CoUninitialize(); // 线程 COM 与主线程公寓独立，互不影响

  _threadDone = true;
  _tsfn.Release();
}

// ── Stop ──
Napi::Value WasapiLoopback::Stop(const Napi::CallbackInfo& info) {
  _running = false;

  // 不能直接 join：采集线程可能正阻塞在 ThreadSafeFunction.BlockingCall 等待 JS
  // 回调，主线程 join 会与回调执行互相等待造成死锁。先短等待线程自行退出
  // （_running=false 后循环检查跳出），超时再 detach 兜底（避免进程退出时
  // detach 线程访问已销毁的 v8/napi 状态导致崩溃）。
  if (_captureThread.joinable()) {
    for (int i = 0; i < 100 && !_threadDone.load(); i++) {
      Sleep(1);
    }
    if (_threadDone.load()) {
      _captureThread.join();
    } else {
      _captureThread.detach();
    }
  }

  if (_client) {
    _client->Stop();
  }

  // 清理
  if (_captureClient) { _captureClient->Release(); _captureClient = nullptr; }
  if (_client) { _client->Release(); _client = nullptr; }
  if (_device) { _device->Release(); _device = nullptr; }
  if (_enumerator) { _enumerator->Release(); _enumerator = nullptr; }

  if (_waveFormat) {
    CoTaskMemFree(_waveFormat);
    _waveFormat = nullptr;
  }

  // 仅撤销本对象成功发起的初始化；RPC_E_CHANGED_MODE 路径不动 Chromium 的 COM 状态
  if (_comInitialized) {
    CoUninitialize();
  }

  return Napi::Boolean::New(info.Env(), true);
}

// ── 模块初始化 ──
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  return WasapiLoopback::Init(env, exports);
}

NODE_API_MODULE(wasapi_loopback, InitModule)
