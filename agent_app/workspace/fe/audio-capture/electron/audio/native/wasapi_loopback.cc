/**
 * WASAPI Loopback 音频采集 —— Node.js N-API addon
 *
 * 捕获 Windows 系统混音输出，不受 VoIP App 限制。
 * 编译：cd electron/audio/native && npx node-gyp rebuild
 */
#include <napi.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
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

  void CaptureLoop();

  IMMDeviceEnumerator* _enumerator = nullptr;
  IMMDevice* _device = nullptr;
  IAudioClient* _client = nullptr;
  IAudioCaptureClient* _captureClient = nullptr;
  WAVEFORMATEX* _waveFormat = nullptr;

  std::thread _captureThread;
  std::atomic<bool> _running{false};
  Napi::ThreadSafeFunction _tsfn;
  UINT32 _bufferFrames = 0;
};

// ── 模块注册 ──
Napi::Object WasapiLoopback::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "WasapiLoopback", {
    InstanceMethod("start", &WasapiLoopback::Start),
    InstanceMethod("stop", &WasapiLoopback::Stop),
  });
  exports.Set("WasapiLoopback", func);
  return exports;
}

// ── 构造函数 ──
WasapiLoopback::WasapiLoopback(const Napi::CallbackInfo& info) : Napi::ObjectWrap<WasapiLoopback>(info) {
  Napi::Env env = info.Env();

  // 初始化 COM
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    Napi::Error::New(env, "CoInitializeEx failed").ThrowAsJavaScriptException();
    return;
  }

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

  _tsfn.Release();
}

// ── Stop ──
Napi::Value WasapiLoopback::Stop(const Napi::CallbackInfo& info) {
  _running = false;

  if (_captureThread.joinable()) {
    _captureThread.join();
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

  CoUninitialize();

  return Napi::Boolean::New(info.Env(), true);
}

// ── 模块初始化 ──
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  return WasapiLoopback::Init(env, exports);
}

NODE_API_MODULE(wasapi_loopback, InitModule)
