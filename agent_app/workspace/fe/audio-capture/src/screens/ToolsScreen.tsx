/**
 * 工具箱页 —— 左栏卡片列表 + 右栏操作区
 */
import { useState, useEffect, useCallback, useRef } from 'react';

type ToolKey = 'question' | 'word2pdf' | 'pdf2word' | 'resume';

interface Tool {
  key: ToolKey;
  icon: string;
  title: string;
  subtitle: string;
}

const tools: Tool[] = [
  { key: 'question', icon: '🎲', title: '随机出题', subtitle: '按赛道生成面试题目' },
  { key: 'word2pdf', icon: '📄', title: 'Word → PDF', subtitle: '支持 .docx' },
  { key: 'pdf2word', icon: '📝', title: 'PDF → Word', subtitle: '支持 .pdf' },
  { key: 'resume', icon: '📐', title: '简历优化', subtitle: '智能分析简历' },
];

const QUESTIONS: Record<string, string[]> = {
  JavaScript: ['闭包的原理和实际应用场景', '原型链是什么', '事件循环机制：宏任务与微任务', 'Promise.all 和 Promise.race 的实现', '防抖和节流的区别及手写实现'],
  Java: ['HashMap 底层实现', 'JVM 内存模型和垃圾回收', 'Spring AOP 和 IOC 原理', 'MySQL B+树索引优化', 'Redis 缓存穿透/击穿/雪崩'],
  Python: ['GIL 及多线程影响', '装饰器原理及场景', 'Django 中间件流程', 'Python 内存管理', 'asyncio 工作原理'],
  'C#': ['DI 生命周期', 'EF Core 性能优化', 'async/await 实现', 'LINQ 延迟执行'],
  'C++': ['虚函数表原理', '智能指针实现', 'RAII 资源管理', 'move 语义'],
  Go: ['GMP 调度模型', 'channel 底层', 'GC 优化', 'interface 结构'],
};

export default function ToolsScreen() {
  const [active, setActive] = useState<ToolKey>('question');
  const [loAvailable, setLoAvailable] = useState<boolean | null>(null);
  const [showDownload, setShowDownload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // 检查 LibreOffice 状态
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.fileConvert?.getLibreOfficeStatus) {
      api.fileConvert.getLibreOfficeStatus().then((r: { available: boolean }) => {
        setLoAvailable(r.available);
      });
    }
  }, []);

  const needsLO = active === 'word2pdf' || active === 'pdf2word';
  const btnDisabled = needsLO && loAvailable === false;

  const handlePickFile = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.fileConvert) return;

    if (needsLO && !loAvailable) {
      setShowDownload(true);
      return;
    }

    const exts = active === 'word2pdf' ? ['docx'] : ['pdf'];
    const path = await api.fileConvert.pickFile(exts);
    if (!path) return;

    setSelectedFile(path);
    setError(null);
    setOutputPath(null);
  }, [active, needsLO, loAvailable]);

  const handleConvert = useCallback(async () => {
    if (!selectedFile) return;
    const api = (window as any).electronAPI;
    if (!api?.fileConvert) return;

    setConverting(true);
    setError(null);
    try {
      const format = active === 'word2pdf' ? 'pdf' : 'docx';
      const out = await api.fileConvert.convert(selectedFile, format);
      setOutputPath(out);
    } catch (e: any) {
      setError(e.message || '转换失败');
    } finally {
      setConverting(false);
    }
  }, [selectedFile, active]);

  const handleSave = useCallback(async () => {
    if (!outputPath) return;
    const api = (window as any).electronAPI;
    // 读取转换结果并通过保存对话框保存
    const resp = await fetch(`file://${outputPath}`);
    const blob = await resp.blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    const name = outputPath.split(/[/\\]/).pop() || 'output';
    await api.fileConvert.saveFile(buf, name);
  }, [outputPath]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 工具列表 */}
      <aside className="w-80 shrink-0 bg-bg-surface border-r border-divider p-lg flex flex-col gap-sm">
        <h2 className="text-heading px-sm mb-sm">工具箱</h2>
        {tools.map(tool => (
          <button
            key={tool.key}
            onClick={() => { setActive(tool.key); setSelectedFile(null); setOutputPath(null); setError(null); }}
            className={`flex items-center gap-md p-md rounded-md text-left transition-colors ${
              active === tool.key ? 'bg-accent-light text-accent' : 'hover:bg-bg text-text-primary'
            }`}
          >
            <span className="text-xl">{tool.icon}</span>
            <div>
              <div className="text-body font-semibold">{tool.title}</div>
              <div className="text-caption text-text-tertiary">{tool.subtitle}</div>
            </div>
          </button>
        ))}
      </aside>

      {/* 操作区 */}
      <main className="flex-1 flex flex-col items-center justify-center p-2xl">
        {active === 'question' ? (
          <QuestionPanel />
        ) : (
          <div
            ref={dropRef}
            className={`w-full max-w-lg flex flex-col items-center gap-lg p-2xl border-2 border-dashed rounded-xl transition-colors ${
              selectedFile ? 'border-accent bg-accent-light/20' : 'border-divider'
            }`}
          >
            <div className="text-4xl">{tools.find(t => t.key === active)?.icon}</div>
            <div className="text-heading">{tools.find(t => t.key === active)?.title}</div>

            {selectedFile ? (
              <>
                <div className="text-body-sm text-text-secondary truncate max-w-full">
                  已选：{selectedFile.split(/[/\\]/).pop()}
                </div>
                {outputPath ? (
                  <>
                    <div className="text-success text-body-sm">✅ 转换完成</div>
                    <button
                      onClick={handleSave}
                      className="px-xl py-md bg-accent text-white rounded-md text-body hover:opacity-90"
                    >
                      保存到本地
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleConvert}
                    disabled={converting}
                    className="px-xl py-md bg-accent text-white rounded-md text-body hover:opacity-90 disabled:opacity-50"
                  >
                    {converting ? '转换中...' : '开始转换'}
                  </button>
                )}
                <button
                  onClick={() => { setSelectedFile(null); setOutputPath(null); setError(null); }}
                  className="text-body-sm text-text-tertiary hover:text-text-secondary"
                >
                  重新选择
                </button>
              </>
            ) : (
              <>
                <div className="text-body text-text-secondary text-center">
                  拖拽文件到此处或点击选择
                </div>
                <button
                  onClick={handlePickFile}
                  disabled={btnDisabled}
                  className={`px-xl py-md rounded-md text-body transition-all ${
                    btnDisabled
                      ? 'bg-divider text-text-tertiary cursor-not-allowed'
                      : 'bg-accent text-white hover:opacity-90'
                  }`}
                  title={btnDisabled ? '需要安装 LibreOffice（点击下载）' : ''}
                >
                  {btnDisabled ? '点击下载引擎' : '选择文件'}
                </button>
                {btnDisabled && (
                  <div className="text-caption text-text-tertiary">
                    文件转换需要 LibreOffice 引擎
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="text-body-sm text-red-500">{error}</div>
            )}
          </div>
        )}

        {/* 下载引导弹窗 */}
        {showDownload && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowDownload(false)}>
            <div className="bg-bg-surface rounded-xl p-2xl max-w-sm mx-lg shadow-lg" onClick={e => e.stopPropagation()}>
              <div className="text-heading mb-md">需要 LibreOffice</div>
              <div className="text-body text-text-secondary mb-lg">
                文件转换功能需要 LibreOffice 文档引擎（约 350MB）。下载后将保存在本机，之后无需再次下载。
              </div>
              <div className="flex gap-md justify-end">
                <button
                  onClick={() => setShowDownload(false)}
                  className="px-lg py-sm rounded-md border border-divider text-body-sm"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setShowDownload(false);
                    const api = (window as any).electronAPI;
                    api?.fileConvert?.downloadLibreOffice?.();
                  }}
                  className="px-lg py-sm rounded-md bg-accent text-white text-body-sm"
                >
                  开始下载
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** 随机出题面板 */
function QuestionPanel() {
  const [lang, setLang] = useState('JavaScript');
  const [question, setQuestion] = useState('');

  const roll = () => {
    const pool = QUESTIONS[lang] ?? QUESTIONS['JavaScript']!;
    const q = pool[Math.floor(Math.random() * pool.length)]!;
    setQuestion(q);
  };

  return (
    <div className="flex flex-col items-center gap-lg">
      <div className="text-4xl">🎲</div>
      <div className="text-heading">随机出题</div>
      <select
        value={lang}
        onChange={e => { setLang(e.target.value); setQuestion(''); }}
        className="p-sm rounded-sm border border-divider bg-bg text-body"
      >
        {Object.keys(QUESTIONS).map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button
        onClick={roll}
        className="px-xl py-md bg-accent text-white rounded-md text-body hover:opacity-90"
      >
        抽取题目
      </button>
      {question && (
        <div className="p-lg bg-bg rounded-md text-body max-w-md text-center">{question}</div>
      )}
    </div>
  );
}
