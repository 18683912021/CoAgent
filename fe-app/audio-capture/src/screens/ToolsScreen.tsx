/**
 * ToolsScreen — 文档格式转换
 */

import React, {useCallback, useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme, space, radius, type} from '../theme';
import {useAppAlert} from '../components/AppAlert';
import {API_BASE} from '../config';
import {getProgLang} from '../config';
import {AudioCapture} from '../native';
import {getToken} from '../utils/token';

type Phase = 'idle' | 'converting' | 'done';

const QUESTIONS: Record<string, string[]> = {
  JavaScript: ['闭包的原理和实际应用场景', '原型链是什么，prototype 和 __proto__ 的区别', '事件循环机制：宏任务与微任务', 'Promise.all 和 Promise.race 的实现', '防抖和节流的区别及手写实现', '深拷贝的实现思路及注意事项', '跨域方案详解', 'React Hooks 底层实现原理', 'Vue 3 响应式系统 Proxy vs defineProperty', 'Webpack loader 和 plugin 的区别'],
  Java: ['HashMap 底层实现，JDK 8 的优化', 'JVM 内存模型和垃圾回收机制', 'Spring AOP 和 IOC 的实现原理', 'MySQL 索引 B+树优化', 'Redis 缓存穿透/击穿/雪崩', '线程池核心参数和工作原理', '分布式锁的三种实现', '消息队列如何保证消息不丢失', '微服务架构服务注册与发现', '数据库分库分表后跨库查询'],
  Python: ['GIL 是什么，对多线程的影响', '装饰器的实现原理及常用场景', 'Django 中间件的执行流程', 'Python 的内存管理机制', 'asyncio 的工作原理', 'Pandas 处理大数据的性能优化', 'Django ORM N+1 查询问题', 'Flask 和 FastAPI 的区别', '*args 和 **kwargs 的作用', '垃圾回收分代回收机制'],
  'C#': ['.NET Core 依赖注入生命周期', 'Entity Framework Core 性能优化', 'async/await 底层实现', 'LINQ 延迟执行原理'],
  'C++': ['虚函数表的工作原理', '智能指针的使用场景与实现', 'RAII 资源管理', 'move 语义和完美转发'],
  Go: ['goroutine 调度原理 GMP 模型', 'channel 底层实现', 'Go GC 优化经验', 'interface 底层结构'],
};

export default function ToolsScreen(): React.JSX.Element {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const {showAlert} = useAppAlert();
  const [phase, setPhase] = useState<Phase>('idle');
  const [download, setDownload] = useState<{blob: Blob; name: string} | null>(null);
  const [qIdx, setQIdx] = useState(-1);
  const lang = getProgLang();
  const pool = (QUESTIONS[lang] ?? QUESTIONS['JavaScript'])!;

  const rollQuestion = useCallback(() => {
    let next = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && next === qIdx) { next = (next + 1) % pool.length; }
    setQIdx(next);
  }, [pool, qIdx]);

  const doConvert = useCallback(async (tool: 'word2pdf' | 'pdf2word', acceptType: string) => {
    if (phase !== 'idle') { return; }
    try {
      const result = await AudioCapture.pickDocument();
      if (!result?.uri) { return; }
      console.log('[Tools] picked:', result.name, result.type, result.size, 'bytes');
      const allowed = acceptType === 'pdf'
        ? ['pdf'] : ['docx', 'doc', 'wps', 'odt', 'rtf'];
      const ext = (result.name ?? '').toLowerCase();
      if (!allowed.some(a => ext.endsWith(a))) {
        showAlert({title: '格式错误', message: `仅支持 ${allowed.map(e => '.' + e).join(' / ')} 文件`});
        return;
      }

      setPhase('converting');

      // 原生层读文件为 base64，通过 JSON 传（避免 RN fetch + FormData 对非 PDF 截断）
      const base64Data = await AudioCapture.readFileBase64(result.uri);
      if (!base64Data) { throw new Error('读取文件失败'); }

      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/tools/${tool === 'word2pdf' ? 'word-to-pdf' : 'pdf-to-word'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        body: JSON.stringify({filename: result.name, data: base64Data}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '转换失败');
      }

      const blob = await res.blob();
      const outName = result.name.replace(/\.[^.]+$/, '') + (tool === 'word2pdf' ? '.pdf' : '.docx');
      setDownload({blob, name: outName});
      setPhase('done');
    } catch (err: any) {
      setPhase('idle');
      console.error('[Tools] 转换失败:', err.message || err, err.stack || '');
      showAlert({title: '转换失败', message: err.message || '请检查文件格式'});
    }
  }, [phase, showAlert]);

  const handleDownload = useCallback(async () => {
    if (!download) { return; }
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]!;
        AudioCapture.saveFile?.(download.name, base64);
      };
      reader.readAsDataURL(download.blob);
      setDownload(null);
      setPhase('idle');
    } catch (err: any) {
      console.error('[Tools] 保存失败:', err.message || err);
      showAlert({title: '保存失败', message: '请重试'});
    }
  }, [download, showAlert]);

  const handleRedo = useCallback(() => { setDownload(null); setPhase('idle'); }, []);

  if (phase === 'done' && download) {
    return (
      <SafeAreaView style={[s.container, {backgroundColor: t.bg}]} edges={['top', 'bottom']}>
        <View style={s.doneWrap}>
          <View style={[s.doneIconWrap, {backgroundColor: t.accentLight}]}>
            <Text style={s.doneIcon}>✅</Text>
          </View>
          <Text style={[s.doneTitle, {color: t.textPrimary}]}>转换完成</Text>
          <Text style={[s.doneName, {color: t.textSecondary}]}>{download.name}</Text>
          <Pressable style={[s.dlBtn, {backgroundColor: t.accent}, t.shadowMd]} onPress={handleDownload}>
            <Text style={s.dlBtnText}>保存到本地</Text>
          </Pressable>
          <Pressable style={[s.redoBtn, {borderColor: t.divider}]} onPress={handleRedo}>
            <Text style={[s.redoBtnText, {color: t.textSecondary}]}>重新上传</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.container, {backgroundColor: t.bg}]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <Text style={[s.heroTitle, {color: t.textPrimary}]}>文件工具箱</Text>
          <Text style={[s.heroSub, {color: t.textSecondary}]}>常用格式转换，一键搞定</Text>
        </View>

        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} onPress={rollQuestion} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#10B981'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#10B981' + '15'}]}><Text style={s.icon}>🎲</Text></View>
            <View style={{flex: 1}}>
              <Text style={[s.cardTitle, {color: t.textPrimary}]}>随机出题 · {lang}</Text>
              <Text style={[s.cardDesc, {color: t.textTertiary}]}>{qIdx >= 0 ? pool[qIdx] : '点击抽一道面试题练手'}</Text>
            </View>
            <Text style={[s.arrow, {color: t.textTertiary}]}>🎯</Text>
          </View>
        </Pressable>

        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} onPress={() => doConvert('word2pdf', 'docx')} disabled={phase !== 'idle'} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#6366F1'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#6366F1' + '15'}]}><Text style={s.icon}>📄</Text></View>
            <View style={{flex: 1}}>
              <Text style={[s.cardTitle, {color: t.textPrimary}]}>文档 → PDF</Text>
              <Text style={[s.cardDesc, {color: t.textTertiary}]}>支持 .doc / .docx / .wps / .odt / .rtf</Text>
            </View>
            {phase === 'converting' ? <ActivityIndicator color={t.accent} /> : <Text style={[s.arrow, {color: t.textTertiary}]}>›</Text>}
          </View>
        </Pressable>

        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} onPress={() => doConvert('pdf2word', 'pdf')} disabled={phase !== 'idle'} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#8B5CF6'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#8B5CF6' + '15'}]}><Text style={s.icon}>📝</Text></View>
            <View style={{flex: 1}}>
              <Text style={[s.cardTitle, {color: t.textPrimary}]}>PDF → Word</Text>
              <Text style={[s.cardDesc, {color: t.textTertiary}]}>将 .pdf 文件转换为 .docx</Text>
            </View>
            {phase === 'converting' ? <ActivityIndicator color={t.accent} /> : <Text style={[s.arrow, {color: t.textTertiary}]}>›</Text>}
          </View>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {flex: 1},
  content: {padding: space.lg, paddingBottom: 40, gap: 14},
  hero: {paddingTop: 8, paddingBottom: 4, gap: 4},
  heroTitle: {fontSize: 22, fontWeight: '800', letterSpacing: 0.5},
  heroSub: {...type.body},
  card: {flexDirection: 'row', alignItems: 'center', borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden'},
  accentBar: {width: 4, alignSelf: 'stretch'},
  iconW: {width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginLeft: 16, marginVertical: 18},
  icon: {fontSize: 26},
  cardBody: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 20, paddingVertical: 18},
  cardTitle: {fontSize: 16, fontWeight: '700', marginBottom: 3},
  cardDesc: {...type.bodySm},
  arrow: {fontSize: 22, fontWeight: '300', marginRight: 4},

  // Done state
  doneWrap: {flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36, gap: 16},
  doneIconWrap: {width: 88, height: 88, borderRadius: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 4},
  doneIcon: {fontSize: 40},
  doneTitle: {...type.title},
  doneName: {...type.bodySm, marginBottom: 10},
  dlBtn: {paddingHorizontal: 36, paddingVertical: 15, borderRadius: radius.lg},
  dlBtnText: {fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: 1},
  redoBtn: {paddingHorizontal: 24, paddingVertical: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth},
  redoBtnText: {fontSize: 14, fontWeight: '500'},
});
