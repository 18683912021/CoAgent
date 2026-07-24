"""ASR 文本纠正引擎。

结构：正确术语 → [ASR 可能输出的变体列表]
  - 按文章方案，正词维度组织，一个术语带多个变体
  - 模块加载时自动展开为变体→正词的查找表
  - Layer 1 精确匹配 + Layer 2 拼音模糊兜底
"""

import re
import logging
from functools import lru_cache
from typing import NamedTuple

from pypinyin import pinyin, Style
from rapidfuzz import fuzz

logger = logging.getLogger("asr_corrector")

# ══════════════════════════════════════════════════════════════════
# 归一化工具
# ══════════════════════════════════════════════════════════════════

def _normalize(text: str) -> str:
    """统一小写、去标点、合并空白、去首尾空格。"""
    text = text.lower().strip()
    text = re.sub(r'[]，。！？、；：""''（）【】《》—…+(){}[]', ' ', text)
    text = text.replace('-', ' ')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def _strip_spaces(text: str) -> str:
    """去所有空白，用于相等比较。"""
    return re.sub(r'\s+', '', text)

def _to_pinyin(text: str) -> str:
    """转拼音字符串。"""
    return ' '.join(p[0] for p in pinyin(text, style=Style.TONE3, neutral_tone_with_five=True))


# ══════════════════════════════════════════════════════════════════
# 变体生成器 —— 对一个正词，自动生成常见 ASR 变体
# ══════════════════════════════════════════════════════════════════

def _generate_variants(term: str) -> list[str]:
    """对单个术语自动生成 ASR 可能的输出变体。

    只生成字母拼读（A B C）和去空格版，不做自动小写（避免 Map→map 吃掉数组方法 map）。
    """
    variants: set[str] = set()

    # 去空白版（用于匹配空格被 ASR 合并或拆分的场景）
    stripped = _strip_spaces(term)
    if stripped and stripped != term:
        variants.add(stripped)

    # 字母拼读：React → R E A C T
    if any(ch.isalpha() for ch in term):
        letters = ' '.join(ch for ch in term if ch.isalpha())
        if len(letters) >= 3:
            variants.add(letters.upper())
            variants.add(letters.lower())

    # 去标点符号
    no_punct = term.replace('-', '').replace('_', '').replace('.', '')
    if no_punct != term and len(no_punct) >= 2:
        variants.add(no_punct)

    return sorted(variants, key=lambda x: -len(x))


# ══════════════════════════════════════════════════════════════════
# 主词典：正确术语 → ASR 可能输出的变体列表
# ══════════════════════════════════════════════════════════════════

_TERM_VARIANTS: dict[str, list[str]] = {

    # ── 框架 ──
    "React": [
        "react", "R E A C T", "r e a c t", "瑞爱的", "瑞艾克特", "锐艾克特",
        "瑞克特", "瑞act", "re act", "re-act",
    ],
    "React Hooks": [
        "react hooks", "react胡克斯", "react hooks", "瑞爱的hooks",
    ],
    "useState": [
        "use state", "us state", "有state", "you state", "use 词day",
        "有词的", "use state",
    ],
    "useEffect": [
        "use effect", "有effect", "you effect", "有e fact", "use e fact",
    ],
    "useCallback": [
        "use callback", "有callback", "use call back", "有call back",
    ],
    "useMemo": ["use memo", "有memo", "you memo", "有mem o"],
    "useRef": ["use ref", "有ref", "you ref", "有ref"],
    "useContext": ["use context", "有context", "you context"],
    "useReducer": ["use reducer", "有reducer", "you reducer"],
    "JSX": ["jsx", "j s x", "js x", "js叉", "j s叉"],
    "Virtual DOM": ["virtual dom", "虚拟dom", "v dom", "虚拟动", "virtual动"],
    "Fiber": ["fiber", "飞博", "favour", "fiber架构"],
    "Suspense": ["suspense", "suspend", "sus喷"],
    "Redux": [
        "redux", "re ducks", "瑞达斯", "re德x", "re大可死", "re大可思",
        "reduce", "瑞大可死",
    ],
    "Redux Toolkit": ["redux toolkit", "rtk", "redux tool kit"],
    "Redux Saga": ["redux saga", "redux 撒加"],
    "Redux Thunk": ["redux thunk", "redux 桑克"],
    "MobX": ["mobx", "mob x", "莫比x", "mobikes"],
    "Zustand": ["zustand", "组stand", "租斯的", "zoo stand"],
    "Recoil": ["recoil", "re coil", "瑞扣"],
    "Immer": ["immer", "因么"],

    "Vue": [
        "vue", "V U E", "v u e", "微优易", "维尤", "微尤", "无e", "view",
    ],
    "Vue 3": ["vue3", "vue三", "view三", "vue 3"],
    "Vuex": ["vuex", "vue x", "vu x", "view x", "Vue X"],
    "Pinia": ["pinia", "皮尼亚", "pina", "pinya"],
    "Nuxt.js": ["nuxt", "nuxt js", "那克斯", "nux js", "nux t"],
    "Composition API": ["composition api", "组合式api", "compose api"],
    "Options API": ["options api", "选项式api"],
    "SFC": ["sfc", "s f c", "单文件组件"],

    "Angular": ["angular", "A N G U L A R", "安哥拉", "安个了", "angle"],
    "Svelte": ["svelte", "svelt", "斯威尔特", "swift"],
    "Next.js": ["nextjs", "next js", "next j s", "耐克斯", "耐克斯js", "next点js"],
    "jQuery": ["jquery", "j query", "j克里", "jQ", "吉酷瑞"],

    # ── TypeScript ──
    "TypeScript": [
        "typescript", "type script", "ts", "泰普脚本", "typeスクリプト",
    ],
    "泛型": ["范型", "泛行", "凡行", "反省"],
    "枚举": ["没举", "美举", "每年"],
    "接口": ["借口"],
    "联合类型": ["联合类行", "连合类型"],
    "交叉类型": ["交叉类行", "交插类型"],
    "类型推断": ["类型推段", "类型推短", "类型推端"],
    "类型守卫": ["类型手位", "类型守位", "类型收尾"],

    # ── 构建工具 ──
    "Webpack": [
        "webpack", "W E B P A C K", "微博pack", "外包", "web pack",
        "微博帕克", "为pack",
    ],
    "Vite": ["vite", "外特", "v eight", "v8", "v 8", "外的"],
    "Babel": ["babel", "B A B E L", "贝宝", "贝bel"],
    "ESLint": ["eslint", "eas lint", "e s lint", "一slint", "eas link"],
    "Prettier": ["prettier", "普瑞帖", "pretty"],
    "PostCSS": ["postcss", "post css", "post c s s"],
    "npm": ["npm", "N P M", "n p m", "恩pm"],
    "yarn": ["yarn", "Y A R N", "羊", "雅恩", "yawn", "yearn"],
    "pnpm": ["pnpm", "pn pm", "p n p m"],
    "npx": ["npx", "n p x", "np x"],
    "Esbuild": ["esbuild", "es build", "es 标的"],
    "SWC": ["swc", "s w c"],
    "Rollup": ["rollup", "roll up"],
    "Turbopack": ["turbopack", "turbo pack"],

    # ── JS 核心概念 ──
    "事件循环": [
        "4件循环", "4键循环", "试卷循环", "时间循环", "事件寻欢",
        "4电箱", "事件询环", "试卷寻环",
    ],
    "事件冒泡": ["4件冒泡", "时间冒泡", "试件冒泡"],
    "事件捕获": ["4件捕获", "时间捕获", "事件捕或"],
    "事件委托": ["4件委托", "时间委托", "试卷委托"],
    "事件驱动": ["4件驱动", "时间驱动"],
    "事件代理": ["4件代理", "时间代理"],
    "微任务": ["为任务", "未任务", "围任务", "微人物", "威任务", "味任务"],
    "宏任务": ["红任务", "鸿任务", "洪任务", "轰任务", "宏人物"],
    "任务队列": ["任务对列", "任务对烈"],
    "消息队列": ["消息对列", "消息对烈"],
    "调用栈": ["调用站", "吊用栈", "调用战"],
    "执行栈": ["执行站", "执行战", "直行栈"],
    "执行上下文": ["执行上下文", "执行上夏文"],
    "词法环境": ["词法环境", "此法环境", "此法还境"],
    "作用域链": ["作用域链", "作于域链", "作用于练"],
    "作用域": ["作用与", "做用语", "左用于", "作于域", "座用于"],
    "词法作用域": ["此法作用域", "此法作用与"],
    "全局作用域": ["全剧作用域", "全菊作用域"],
    "块级作用域": ["块集作用域", "快级作用域"],

    "闭包": [
        "必报", "b包", "闭保", "臂包", "币包", "毕包", "比包",
        "痹包", "臂抱", "必包", "b bao", "b宝",
    ],
    "原型链": [
        "圆形链", "原型练", "圆形练", "原型脸", "圆形脸",
        "远行链", "远行练", "圆形连", "远行连",
    ],
    "原型继承": [
        "圆形记成", "原型记成", "原型集成", "圆形集成",
        "远行继承", "原型计生", "圆形计生", "圆形记承",
    ],
    "构造函数": ["够造函数", "构造函式", "constructor"],
    "实例": ["实力", "事例", "实列"],

    "异步": ["一步", "异部", "已步"],
    "同步": ["同部", "统步", "铜步"],
    "Promise": ["promise", "promise", "普若米斯", "promise（小写）"],
    "async": ["async", "a sync", "阿信科"],
    "await": ["await", "a wait", "额wait", "额未特", "额喂特"],
    "回调": ["回掉"],
    "回调地狱": ["回掉地狱"],
    "Generator": ["generator", "generate函数", "金瑞特", "生成器", "生成气"],
    "Observable": ["observable", "observe able"],
    "RxJS": ["rxjs", "r x j s", "rx js"],

    "柯里化": ["颗粒化", "科里化", "可理化", "客里化", "颗粒花", "科理化"],
    "高阶函数": ["高街函数", "高接函数", "高洁函数"],
    "高阶组件": ["高街组件", "高接组件", "HOC", "h o c"],
    "纯函数": ["存函数", "唇函数", "春函数", "醇函数", "纯韩束"],
    "副作用": ["副作用", "复制用", "负作用", "富作用", "复左右"],
    "防抖": ["房抖", "反抖", "防斗", "房斗", "凡抖", "debounce"],
    "节流": ["节留", "接流", "截流", "结流", "杰流", "throttle"],
    "深拷贝": ["深考贝", "生拷贝", "深靠背", "深耕贝", "深考背"],
    "浅拷贝": ["前考贝", "钱拷贝", "钱靠背", "浅考贝", "前靠背"],
    "不可变性": ["不可变形", "immutability"],

    "Proxy": ["proxy", "p r c", "pro x y", "pro xi", "prorxy"],
    "Reflect": ["reflect", "reflex", "瑞flect"],
    "Symbol": ["symbol", "c博", "c播", "c b o"],
    "WeakMap": ["weakmap", "weak map", "we map", "微map", "弱 map"],
    "WeakSet": ["weakset", "weak set", "we set"],
    "迭代器": ["迭代气", "跌代器", "iterator"],
    "Iterable": ["iterable", "可迭代"],

    # ── CSS / 布局 ──
    "CSS": ["css", "C S S", "c s s", "层叠样式表", "层 叠 样式 表", "级联样式表"],
    "HTML": ["html", "H T M L", "h t m l", "超文本标记语言", "超 文本 标记 语言"],
    "DOM": ["dom", "D O M", "d o m", "文档对象模型", "文档 对象 模型", "动"],
    "CSSOM": ["cssom", "css om", "c s s o m", "样式对象模型", "样式 对象 模型"],
    "BOM": ["bom", "B O M", "浏览 器 对象 模型"],
    "Flexbox": ["flexbox", "flex box", "flex博客", "flesh box"],
    "Grid": ["grid", "g r i d", "贵的", "格的"],
    "盒模型": ["和模型", "合模型", "河模型", "box sizing"],
    "BFC": ["bfc", "b f c", "bf c", "B F C"],
    "重绘": ["重会", "重汇", "重回", "重辉", "虫会"],
    "回流": ["回留", "回六", "回刘", "会流"],
    "重排": ["重牌", "虫排"],
    "合成": ["和成", "合层", "和层"],
    "层叠上下文": ["层叠上下文", "曾叠上下文", "stacking context"],
    "响应式": ["响应4", "相应式", "响应是", "相映式", "想应是"],
    "媒体查询": ["媒体查寻", "每体查询", "媒体查讯", "美体查询"],
    "伪类": ["为类", "未类", "危类"],
    "伪元素": ["为元素", "未元素"],
    "选择器优先级": ["选择器优先集", "选择器权重"],
    "z-index": ["z index", "z indexes", "这index"],
    "Sass": ["sass", "s a s s", "S A S S", "萨斯"],
    "SCSS": ["scss", "s c s s"],
    "渲染引擎": ["宣染引擎", "宣染", "绚染", "render engine"],
    "Shadow DOM": ["shadow dom", "沙都dom", "沙多动", "shallow dom"],
    "will-change": ["will change", "willchange"],
    "骨架屏": ["骨架平", "古架屏", "骨架瓶"],
    "首屏": ["手屏", "首页屏幕", "首屏幕"],

    # ── 浏览器 / 网络 ──
    "HTTP": ["http", "H T T P", "h t t p", "爱吃ttp"],
    "HTTPS": ["https", "H T T P S", "h t t p s", "爱吃ttps"],
    "HTTP/2": ["http二", "http2"],
    "HTTP/3": ["http三", "http3"],
    "TCP": ["tcp", "T C P", "t c p"],
    "UDP": ["udp", "U D P", "u d p"],
    "DNS": ["dns", "D N S", "d n s"],
    "CDN": ["cdn", "C D N", "c d n"],
    "QUIC": ["quic", "quick", "quick协议"],
    "WebSocket": ["websocket", "web socket", "微博socket", "web sockey"],
    "SSE": ["sse", "s s e", "server sent", "server sent events"],
    "CORS": ["cors", "course", "扣斯", "cores", "跨域", "跨越"],
    "XSS": ["xss", "x s s", "叉ss", "跨站脚本"],
    "CSRF": ["csrf", "c s r f", "x s r f", "跨站请求伪造"],
    "CSP": ["csp", "c s p", "内容安全策略"],
    "SRI": ["sri", "s r i", "子资源完整性"],
    "Cookie": ["cookie", "cookies", "库kie", "哭泣", "库k"],
    "Session": ["session", "赛神", "session"],
    "Token": ["token", "偷肯", "托肯"],
    "JWT": ["jwt", "j w t", "杰w t"],
    "OAuth": ["oauth", "o auth", "oAuth"],
    "SSO": ["sso", "s s o", "单点登录", "统一认证"],
    "LocalStorage": ["localstorage", "local storage", "local存储", "本地存储", "本地 存储"],
    "SessionStorage": ["sessionstorage", "session storage", "session存储", "会话存储", "会话 存储"],
    "IndexedDB": ["indexeddb", "index db", "indexed db", "index的db"],
    "requestAnimationFrame": ["request animation frame", "r a f", "raf"],
    "CSP": ["csp", "C S P", "内容安全策略"],
    "FCP": ["fcp", "f c p", "first contentful paint"],
    "LCP": ["lcp", "l c p", "largest contentful paint"],
    "FID": ["fid", "f i d"],

    # ── 数据结构 / 算法 ──
    "数组": ["数祖", "数足", "素组"],
    "链表": ["连表", "脸表", "念表", "链标", "练表", "连标"],
    "栈": ["站", "战", "展"],
    "队列": ["对列", "对烈", "队烈", "堆列"],
    "哈希表": ["哈西表", "hash表", "哈西map", "哈希map"],
    "二叉树": ["二叉数", "二叉书", "二叉叔"],
    "二叉搜索树": ["二叉搜索数", "二叉搜素树", "二插搜索树", "BST"],
    "红黑树": ["红黑数", "红黑叔"],
    "B树": ["b数", "b树"],
    "B+树": ["b加数", "b+数"],
    "前缀树": ["前缀数", "trie数", "trie树", "try树", "踹树"],
    "BFS": ["bfs", "b f s", "广度优先"],
    "DFS": ["dfs", "d f s", "深度优先"],
    "拓扑排序": ["拓扑牌序", "topological sort"],
    "递归": ["地归", "递规", "地规", "递龟", "低归", "第归"],
    "迭代": ["叠代", "跌代", "碟代", "迪代", "迭带"],
    "动态规划": ["动态归划", "动态规化", "动太规划", "DP"],
    "贪心": ["谈心", "贪心算法", "谈心算法"],
    "回溯": ["回速", "回朔", "回素", "恢复", "回苏"],
    "分治": ["分制", "divide and conquer"],
    "双指针": ["双指真", "双纸针", "双指针法"],
    "滑动窗口": ["滑动串口", "华动窗口", "滑动创口", "花动窗口"],
    "二分查找": ["二分查找", "二份查找", "二分收索", "binary search"],
    "时间复杂度": ["时间复杂都", "时间浮渣度", "实践复杂度", "时间复杂读"],
    "空间复杂度": ["空间复杂都", "空间浮渣度", "控件复杂度"],

    # ── 工程化 / 架构 ──
    "微服务": ["为服务", "未服务", "围服务", "威服务", "味服务"],
    "微前端": ["为前端", "未前端", "围前端"],
    "模块联邦": ["模块连邦", "模块联帮", "模块联绑", "module federation"],
    "SSR": ["ssr", "s s r", "服务端宣染", "服务端渲染", "服务 端 渲染"],
    "CSR": ["csr", "c s r", "客户端宣染", "客户端渲染"],
    "SSG": ["ssg", "s s g", "静态站点生成", "静态生成"],
    "Hydration": ["hydration", "水合", "hydrate", "注水"],
    "Docker": ["docker", "doctor", "达克", "dock"],
    "Nginx": ["nginx", "n吉克斯", "engine x", "n jinx", "n金克斯"],
    "Kubernetes": ["kubernetes", "k八s", "k8s"],
    "CI/CD": ["ci cd", "c i c d", "持续集成持续部署", "持续集成"],
    "DevOps": ["devops", "dev ops", "devo ps"],
    "Serverless": ["serverless", "server less"],
    "懒加载": ["懒家在", "蓝加载", "lazy load", "蓝加在"],
    "预加载": ["于加载", "预家在", "preload"],
    "代码分割": ["代码分歌", "code splitting"],
    "Tree Shaking": ["tree shaking", "tree sharking", "去摇树", "树摇", "腰树"],
    "HMR": ["hmr", "h m r", "热模块替换", "模块热替换"],
    "Source Map": ["source map", "sourceMap", "souse map", "源码映射"],

    # ── 浏览器 API / 概念 ──
    "JSON": ["json", "J S O N", "杰森", "jason"],
    "AJAX": ["ajax", "A J A X", "阿贾克斯"],
    "API": ["api", "A P I", "诶批挨", "a p i", "诶批i", "诶p i", "a pi"],
    "URL": ["url", "U R L", "u r l", "you are l", "优艾欧"],
    "SPA": ["spa", "S P A", "单页 应用", "s p a", "单页应用"],
    "MPA": ["mpa", "M P A", "多页应用"],
    "PWA": ["pwa", "P W A", "渐进式web应用", "渐进式应用"],
    "Service Worker": ["service worker", "serviceworker"],
    "JSBridge": ["jsbridge", "js bridge", "js桥", "js briage", "js birdge"],
    "WebView": ["webview", "web view"],
    "SVG": ["svg", "S V G", "s v g"],
    "XML": ["xml", "X M L", "x m l", "叉ml"],

    # ── 通用 / 方言 ──
    "这个": ["则个", "蛰个", "折个"],
    "是不是": ["四不四"],
    "怎么": ["肿么", "zen么", "阵么"],
    "知道": ["资道", "鸡道", "鸡到"],
    "其实": ["奇实", "其次", "奇石"],
    "没有": ["木有", "妹有", "米有"],
    "什么": ["神马"],
    "为什么": ["为神马", "为啥", "为哈"],
    "这样": ["酱", "酱紫"],

    # ── 测试 ──
    "Jest": ["jest", "J E S T", "j e s t"],
    "Cypress": ["cypress", "cy press", "赛pres"],
    "Playwright": ["playwright", "play right"],
    "Vitest": ["vitest", "vi test", "外test"],
    "单元测试": ["单员测试", "单元策试"],
    "集成测试": ["集成策试", "基层测试"],
    "E2E测试": ["e2e测试", "end to end测试", "端到端测试"],
    "TDD": ["tdd", "测试驱动开发", "测试驱动"],
    "BDD": ["bdd", "行为驱动开发"],

    # ── 设计模式 ──
    "MVC": ["mvc", "M V C", "m v c"],
    "MVVM": ["mvvm", "M V V M", "m v v m"],
    "单例模式": ["单立模式", "单利模式"],
    "工厂模式": ["工厂函数"],
    "观察者模式": ["观察折模式"],
    "发布订阅": ["发布定约", "pub sub"],
    "依赖注入": ["依赖主入", "DI", "d i"],
    "控制反转": ["IoC", "i o c"],
    "SOLID": ["solid", "solid原则"],
    "call/apply/bind": ["call apply bind", "call apply bind"],

    # ── Node.js ──
    "Node.js": [
        "nodejs", "node js", "Node js", "node点js", "node j s", "node", "Node",
    ],
    "Express": ["express", "express框架", "一克斯普瑞斯"],
    "Koa": ["koa", "k o a", "koa框架"],
    "Nest.js": ["nestjs", "nest js", "nest框架"],
    "中间件": ["中间键", "中坚件", "middleware", "middle ware"],
    "Stream": ["stream", "stream流", "流式处理"],
    "Buffer": ["buffer", "缓冲区", "缓存区"],
    "EventEmitter": ["event emitter", "事件触发器", "事件发射器"],
    "PM2": ["pm2", "p m 2"],
    "IPC": ["ipc", "i p c", "进程间通信"],

    # ── 操作系统 / 网络 ──
    "OSI": ["osi", "o s i", "OSI模型"],
    "TCP/IP": ["tcp ip", "tcp ip协议"],
    "IP地址": ["ip地址", "ip地质"],
    "IPv4": ["ipv4", "ip v四"],
    "IPv6": ["ipv6", "ip v六"],
    "ARP": ["arp", "a r p"],
    "DHCP": ["dhcp", "d h c p"],
    "NAT": ["nat", "网络地址转换", "网络地质转换"],
    "VPN": ["vpn", "v p n", "虚拟专用网络"],
    "死锁": ["思索", "死所"],
    "互斥锁": ["互赤锁"],
    "读写锁": ["读写索"],
    "自旋锁": ["自选锁", "spin lock"],
    "LRU": ["lru", "l r u"],
    "LFU": ["lfu", "l f u"],
    "虚拟内存": ["虚拟内层", "virtual memory"],

    # ── 安全 ──
    "反射型XSS": ["反射型xss", "反射性xss"],
    "存储型XSS": ["存储型xss", "存储性xss"],
    "DOM型XSS": ["dom型xss", "dom xss"],
    "HTTPS中间人攻击": ["https中间人", "MITM", "中间人攻击"],
    "SQL注入": ["sql注入", "sql注入攻击"],
    "SameSite Cookie": ["same site cookie", "same site"],
    "HttpOnly Cookie": ["http only cookie", "http only"],
    "Access Token": ["access token", "access_token"],
    "Refresh Token": ["refresh token", "refresh_token"],
    "OAuth 2.0": ["o auth二点零", "oauth2"],

    # ── V8 / 引擎 ──
    "V8引擎": ["v八引擎", "微8引擎", "v8引勤"],
    "JIT": ["jit", "j i t", "just in time", "即时编译", "即使编译"],
    "Hidden Class": ["hidden class", "隐藏类", "隐藏雷", "银藏类"],
    "Inline Caching": ["inline caching", "内联缓存", "内连缓存", "内联缓冲"],
    "GC": ["gc", "g c", "垃圾回收", "辣鸡回收"],
    "标记清除": ["标记清楚", "标记青除", "mark and sweep"],
    "引用计数": ["引用记数"],
    "栈内存": ["站内存"],
    "堆内存": ["对内存"],
    "内存泄漏": ["内存泄露", "内存泻露", "内存卸漏", "memory leak", "麦莫瑞 leak"],

    # ═══════════════════════════════════════════════════════════
    # 补充：JS 常用 API 方法（来自对照表）
    # ═══════════════════════════════════════════════════════════
    "map": ["迈普", "买普", "m a p", "妈普"],
    "filter": ["飞奥特", "feel特", "f i l t e r", "fi lter"],
    "reduce": ["瑞丢斯", "re duse", "瑞 du 斯", "re duce"],
    "forEach": ["for 一尺", "for each", "佛瑞尺", "for 义齿"],
    "some": ["萨姆", "桑", "s o m e"],
    "every": ["埃文瑞", "爱瑞", "e v e r y"],
    "find": ["放的", "贩的", "f i n d"],
    "findIndex": ["放的 index", "贩的 index", "find index"],
    "includes": ["因克鲁的", "in clues", "in cludes"],
    "push": ["普式", "扑式", "p u s h"],
    "pop": ["炮普", "破普", "p o p"],
    "shift": ["是一福特", "虚福特", "s h i f t"],
    "unshift": ["安是一福特", "安虚福特", "un shift"],
    "splice": ["斯普拉斯", "s p l i c e", "s plice"],
    "slice": ["斯拉斯", "s l i c e", "s lice"],
    "concat": ["康凯特", "con cat", "c o n c a t"],
    "join": ["救因", "j o i n", "joyn"],
    "split": ["斯普利特", "s p l i t", "斯普利"],
    "indexOf": ["index 奥夫", "index of", "index off"],
    "lastIndexOf": ["last index 奥夫", "last index of"],
    "Object.keys": ["object 金斯", "奥布杰克特 keys", "object keys"],
    "Object.values": ["object 外六斯", "奥布杰克特 values", "object values"],
    "Object.entries": ["object 恩垂斯", "奥布杰克特 entries", "object entries"],
    "Object.assign": ["object 阿赛因", "奥布杰克特 assign", "object assign"],
    "hasOwnProperty": ["has own property", "hasOwnProperty"],
    "toString": ["to string", "to死追应", "two string"],
    "valueOf": ["value of", "外六奥夫"],
    "parseInt": ["parse int", "帕斯int", "parse 因特"],
    "parseFloat": ["parse float", "帕斯float", "parse 福楼特"],
    "isNaN": ["is nan", "is 男", "is n a n"],
    "Number": ["number", "number", "男ber"],
    "String": ["string", "斯追应", "string"],
    "Boolean": ["boolean", "不林", "boolean"],
    "Array": ["array", "阿瑞", "啊ray", "a r r a y"],
    "Object": ["object", "奥布杰克特", "ob ject", "o b j e c t"],
    "Function": ["function", "方格申", "function", "f u n c t i o n"],
    "Date": ["date", "得特", "de特", "d a t e"],
    "RegExp": ["regexp", "regex", "re jex", "瑞杰克斯"],
    "Math": ["math", "马斯", "m a t h"],
    "Error": ["error", "艾弱", "e r r o r"],
    # "Map"/"Set" 大写形式保留在构造成语境的条目中，此处避免与数组方法 map/set 冲突
    "Set": ["赛特", "s e t"],
    "Map": ["迈普", "m a p"],
    "NaN": ["nan", "男", "n a n", "not a number"],
    "undefined": ["undefined", "安迪范的", "un defined"],
    "null": ["null", "闹", "n u l l", "纳尔"],
    "Infinity": ["infinity", "因飞尼提", "in finity"],

    # ═══════════════════════════════════════════════════════════
    # 补充：DOM / BOM API
    # ═══════════════════════════════════════════════════════════
    "document": ["到Q门特", "刀Q门特", "doc门特", "document", "d o c u m e n t"],
    "getElementById": ["get element by id", "给特艾乐门特败艾迪", "getElementByID"],
    "querySelector": ["query selector", "奎瑞selector", "Q selector", "query selector"],
    "querySelectorAll": ["query selector 奥", "querySelectorAll", "奎瑞 selector all"],
    "createElement": ["create element", "克瑞艾特 element", "create element"],
    "appendChild": ["append child", "阿喷的 child", "append child"],
    "removeChild": ["remove child", "瑞木夫 child", "remove child"],
    "innerHTML": ["inner H T M L", "英呢HTML", "inner html", "inner h t m l"],
    "innerText": ["英呢text", "inner text"],
    "textContent": ["text content", "泰克斯特 content"],
    "classList": ["class list", "克拉斯 list"],
    "addEventListener": ["add event listener", "阿的 event listener"],
    "removeEventListener": ["remove event listener", "瑞木夫 event listener"],
    "事件冒泡": ["事件冒泡", "event bubbling", "一问特巴柏林"],
    "事件捕获": ["事件捕获", "event capturing", "一问特开普车瑞英"],
    "事件委托": ["事件委托", "事件代理", "event delegation"],
    "阻止冒泡": ["阻止冒泡", "stopPropagation", "斯道普 propagation"],
    "阻止默认": ["阻止默认", "preventDefault", "普瑞问特 default"],
    "diff算法": ["diff算法", "地府算法", "diff 算法"],
    "window": ["温斗", "win dow", "w i n d o w"],
    "location": ["楼k神", "low k神", "lo cation"],
    "href": ["h ref", "h r e f"],
    "reload": ["瑞楼的", "re load"],
    "history": ["黑斯特瑞", "hi story"],
    "pushState": ["push state", "普式state"],
    "replaceState": ["replace state", "瑞普雷斯state"],
    "navigator": ["乃维给特", "navi gator"],
    "cookie": ["库克", "酷K"],
    "同源策略": ["同源策略", "same-origin policy", "same origin policy"],
    "跨域": ["跨域", "cross-origin", "cors", "跨越"],
    "JSONP": ["j s o n p", "jason p", "杰森p"],
    "fetch": ["飞吃", "f e t c h", "fatch", "fetch"],
    "XMLHttpRequest": ["X H R", "x m l http request", "XHR"],
    "axios": ["阿克笑死", "a x i o s", "艾克西欧斯"],
    "请求": ["请秋", "request", "瑞快斯特"],
    "响应": ["想应", "response", "瑞斯胖斯"],
    "状态码": ["状态马", "status code"],
    "请求头": ["请求头", "header", "海德"],
    "请求体": ["请求体", "body", "包地"],
    "GET": ["该特", "get", "给特"],
    "POST": ["抛斯特", "post", "破斯特"],
    "PUT": ["普特", "put"],
    "DELETE": ["地类的", "delete"],
    "PATCH": ["帕吃", "patch"],
    "拦截器": ["拦姐器", "interceptor", "因特塞普特"],
    "超时": ["草时", "timeout", "太亩奥"],
    "重试": ["从试", "retry", "瑞垂"],

    # ═══════════════════════════════════════════════════════════
    # 补充：Web API
    # ═══════════════════════════════════════════════════════════
    "EventSource": ["event source", "一问特source", "SSE"],
    "IntersectionObserver": ["intersection observer", "因特塞克神observer"],
    "MutationObserver": ["mutation observer", "谬特神observer"],
    "ResizeObserver": ["resize observer", "瑞赛斯observer"],
    "Performance": ["performance", "普佛曼斯"],
    "Web Worker": ["web worker", "web沃克"],
    "Service Worker": ["service worker", "瑟维斯worker"],
    "Cache API": ["cache api", "开式api"],
    "推送通知": ["推送通知", "push notification"],
    "语音识别": ["语音识别", "speech recognition", "speech to text"],
    "语音合成": ["语音合成", "speech synthesis", "TTS"],

    # ═══════════════════════════════════════════════════════════
    # 补充：ES6+ 新特性
    # ═══════════════════════════════════════════════════════════
    "解构": ["姐够", "解够", "destructuring", "迪斯特 ra 庆"],
    "展开运算符": ["展开运算符", "spread operator", "斯普瑞的operator"],
    "剩余参数": ["剩余参数", "rest parameter", "瑞斯特 parameter"],
    "模板字符串": ["模板字串", "template literal", "坦普雷特"],
    "可选链": ["可选连", "optional chaining", "奥普申诺 chain 英"],
    "空值合并": ["空值合并", "nullish coalescing", "那累许 扣累森"],
    "BigInt": ["比个int", "big int", "big 英特"],
    "私有字段": ["私有字段", "private field", "普瑞维特 field"],
    "静态方法": ["静态方法", "static method", "斯达提克 method"],
    "模块": ["摸块", "module", "猫丢欧"],
    "import": ["因炮特", "音炮特", "im port"],
    "export": ["一克斯炮特", "ex炮特", "ex port"],
    "动态导入": ["动态导入", "dynamic import", "带纳米克 import"],
    "for...of": ["for 奥夫", "for 欧夫", "for of"],
    "Symbol.iterator": ["symbol 爱ter瑞特", "森波爱ter瑞特"],

    # ═══════════════════════════════════════════════════════════
    # 补充：原型与继承（英文变体）
    # ═══════════════════════════════════════════════════════════
    "原型": ["圆形", "原形", "prototype", "普肉太普"],
    "原型链": ["圆形链", "原形连", "prototype chain"],
    "__proto__": ["dunder proto", "双下划线proto"],
    "constructor": ["康思抓克特", "constructer", "constructor"],
    "继承": ["集成", "继层", "inheritance", "因黑瑞疼斯"],
    "类": ["累", "class", "克拉死"],
    "extends": ["一克斯腾斯", "ex tends", "extends"],
    "super": ["苏泊", "休伯", "super"],
    "多态": ["多太", "polymorphism", "跑林毛飞赠"],
    "封装": ["风装", "封撞", "encapsulation", "恩卡普修雷神"],

    # ═══════════════════════════════════════════════════════════
    # 补充：React 深度
    # ═══════════════════════════════════════════════════════════
    "组件": ["组建", "component", "康姆剖嫩特"],
    "函数组件": ["函数组件", "function component"],
    "类组件": ["类组件", "class component"],
    "状态": ["装态", "state", "斯得特"],
    "属性": ["属性", "props", "普绕普斯"],
    "生命周期": ["生命周期", "lifecycle", "来夫赛口"],
    "调和": ["调和", "reconciliation", "瑞康斯雷神"],
    "渲染": ["渲染", "render", "瑞恩的"],
    "重新渲染": ["重新渲染", "re-render"],
    "受控组件": ["受控组件", "controlled component"],
    "非受控组件": ["非受控组件", "uncontrolled component"],
    "状态提升": ["状态提升", "lifting state up"],
    "上下文": ["上下文", "context", "康泰克斯"],
    "Portal": ["portal", "炮特"],
    "React.lazy": ["react lazy", "lazy load", "react点lazy"],
    "Suspense": ["suspense", "撒斯喷斯"],
    "中间件": ["中间件", "middleware", "米斗威尔"],

    # ═══════════════════════════════════════════════════════════
    # 补充：Vue 深度
    # ═══════════════════════════════════════════════════════════
    "实例": ["实例", "instance", "因斯疼斯"],
    "指令": ["指令", "directive", "地瑞克t五"],
    "v-bind": ["v bind", "v 绑的", "v:bind", "冒号"],
    "v-model": ["v model", "v 猫斗", "双向绑定"],
    "v-for": ["v for", "v 佛"],
    "v-if": ["v if", "v 衣服"],
    "v-show": ["v show", "v 受"],
    "计算属性": ["计算属性", "computed", "康姆Q特的"],
    "侦听器": ["侦听器", "watcher", "沃车"],
    "生命周期钩子": ["生命周期钩子", "lifecycle hooks"],
    "mounted": ["忙ted", "mount ted", "mounted"],
    "created": ["克瑞艾特ted", "create ted", "created"],
    "updated": ["阿普得特ted", "update ted", "updated"],
    "组件通信": ["组件通信", "组件传值"],
    "emit": ["一米特", "e m i t"],
    "插槽": ["插槽", "slot", "斯唠特"],
    "混入": ["混入", "mixin", "米克森"],
    "组合式API": ["组合式API", "composition api", "composition API"],
    "选项式API": ["选项式API", "options api", "options API"],
    "响应式": ["响应式", "reactive", "瑞艾克t五", "responsive"],
    "ref": ["瑞夫", "ref", "r e f"],
    "reactive": ["reactive", "瑞艾克t五"],
    "computed": ["computed", "康姆Q特的"],
    "watch": ["watch", "沃吃"],
    "路由": ["路由", "router", "饶特"],
    "状态管理": ["状态管理", "state management", "撞态管理"],
    "Pinia": ["pinia", "批尼亚", "p i n i a"],
    "Vuex": ["vuex", "v u e x", "view x"],

    # ═══════════════════════════════════════════════════════════
    # 补充：Angular
    # ═══════════════════════════════════════════════════════════
    "Angular": ["angular", "昂古拉", "安格瑞"],
    "TypeScript": ["typescript", "太普斯瑞普特", "TS"],
    "服务": ["服务", "service", "色维斯"],
    "依赖注入": ["依赖注入", "dependency injection", "DI"],
    "管道": ["管道", "pipe", "派普"],
    "表单": ["表单", "form", "佛木"],
    "响应式表单": ["响应式表单", "reactive form"],
    "模板驱动表单": ["模板驱动表单", "template-driven form"],
    "ngOnInit": ["on init", "on 因尼特", "ng on init"],
    "可观察对象": ["可观察对象", "observable", "奥布斯瓦波"],
    "RxJS": ["rxjs", "r x j s"],
    "Subject": ["subject", "撒布杰克特"],
    "BehaviorSubject": ["behavior subject", "比黑威儿subject"],

    # ═══════════════════════════════════════════════════════════
    # 补充：HTTP 深度
    # ═══════════════════════════════════════════════════════════
    "HTTP": ["http", "超文本传输协议", "H T T P"],
    "HTTPS": ["https", "超文本传输安全协议", "H T T P S"],
    "URL": ["url", "U R L", "统一资源定位符"],
    "URI": ["uri", "U R I"],
    "DNS": ["dns", "D N S", "域名系统"],
    "TCP": ["tcp", "T C P", "传输控制协议"],
    "UDP": ["udp", "U D P", "用户数据报协议"],
    "三次握手": ["三次握手", "three-way handshake"],
    "四次挥手": ["四次挥手", "four-way挥手"],
    "200": ["两百", "二百", "二零零", "200 OK"],
    "301": ["三零一", "三百零一", "301 重定向"],
    "302": ["三零二", "三百零二", "302 重定向"],
    "304": ["三零四", "三百零四", "304 未修改"],
    "400": ["四百", "四零零", "400 错误请求"],
    "401": ["四零一", "四百零一", "401 未授权"],
    "403": ["四零三", "四百零三", "403 禁止"],
    "404": ["四零四", "四百零四", "404 未找到"],
    "500": ["五百", "五零零", "500 服务器错误"],
    "502": ["五零二", "五百零二", "502 网关错误"],
    "503": ["五零三", "五百零三", "503 服务不可用"],
    "RESTful": ["REST 佛", "restful", "rest"],
    "REST API": ["rest api", "瑞斯特api"],
    "简单请求": ["简单请求", "simple request"],
    "预检请求": ["预检请求", "preflight request"],
    "强缓存": ["强缓存", "强cache"],
    "协商缓存": ["协商缓存", "negotiation cache"],
    "CDN": ["cdn", "C D N", "内容分发网络"],
    "负载均衡": ["负载均衡", "load balancing"],
    "代理": ["代理", "proxy", "普绕克西"],
    "正向代理": ["正向代理", "forward proxy"],
    "反向代理": ["反向代理", "reverse proxy"],

    # ═══════════════════════════════════════════════════════════
    # 补充：性能优化
    # ═══════════════════════════════════════════════════════════
    "性能": ["性能", "performance", "普佛曼斯"],
    "优化": ["优化", "optimization", "奥普提米z神"],
    "首屏加载": ["首屏加载", "首屏时间", "first paint"],
    "FCP": ["fcp", "首次内容绘制", "first contentful paint"],
    "LCP": ["lcp", "最大内容绘制", "largest contentful paint"],
    "FID": ["fid", "首次输入延迟", "first input delay"],
    "CLS": ["cls", "累积布局偏移", "cumulative layout shift"],
    "TTI": ["tti", "可交互时间", "time to interactive"],
    "白屏时间": ["白屏时间", "白屏"],
    "打包优化": ["打包优化", "bundle optimization"],
    "图片优化": ["图片优化", "image optimization"],
    "预连接": ["预连接", "preconnect"],
    "DNS预解析": ["dns预解析", "dns-prefetch"],
    "回流": ["回流", "reflow", "重排"],
    "重绘": ["重绘", "repaint"],
    "图层": ["图层", "layer", "雷尔"],
    "长任务": ["长任务", "long task"],
    "按需加载": ["按需加载", "按需导入"],

    # ═══════════════════════════════════════════════════════════
    # 补充：安全
    # ═══════════════════════════════════════════════════════════
    "XSS": ["xss", "跨站脚本攻击", "cross-site scripting"],
    "CSRF": ["csrf", "跨站请求伪造", "cross-site request forgery"],
    "SQL注入": ["sql注入", "sql injection", "SQL injection"],
    "点击劫持": ["点击劫持", "clickjacking"],
    "CORS": ["cors", "C O R S", "跨域资源共享"],
    "CSP": ["csp", "C S P", "内容安全策略", "content security policy"],
    "同源策略": ["同源策略", "same-origin policy"],
    "加密": ["加密", "encryption", "因克瑞普神"],
    "解密": ["解密", "decryption"],
    "对称加密": ["对称加密", "symmetric encryption"],
    "非对称加密": ["非对称加密", "asymmetric encryption"],
    "RSA": ["rsa", "R S A", "r s a"],
    "AES": ["aes", "A E S", "a e s"],
    "身份认证": ["身份认证", "authentication", "奥森提k神"],
    "授权": ["授权", "authorization", "奥色瑞z神"],
    "令牌": ["令牌", "token", "偷肯"],
    "刷新令牌": ["刷新令牌", "refresh token"],
    "会话": ["会话", "session", "赛神"],
    "跨站": ["跨站", "cross-site"],

    # ═══════════════════════════════════════════════════════════
    # 补充：TypeScript
    # ═══════════════════════════════════════════════════════════
    "TypeScript": ["typescript", "太普斯瑞普特", "type script", "TS"],
    "类型": ["类型", "type", "太普"],
    "接口": ["接口", "interface", "因特非斯"],
    "泛型": ["泛型", "generic", "基奈瑞克"],
    "枚举": ["枚举", "enum", "伊纳姆"],
    "元组": ["元组", "tuple", "太普欧"],
    "联合类型": ["联合类型", "union type", "尤尼恩 type"],
    "交叉类型": ["交叉类型", "intersection type"],
    "类型别名": ["类型别名", "type alias"],
    "类型推断": ["类型推断", "type inference", "因佛润斯"],
    "类型守卫": ["类型守卫", "type guard"],
    "类型断言": ["类型断言", "type assertion", "阿色神"],
    "非空断言": ["非空断言", "non-null assertion"],
    "装饰器": ["装饰器", "decorator", "呆口瑞特"],
    "抽象类": ["抽象类", "abstract class"],
    "实现": ["实现", "implements", "因普莱门斯"],
    "命名空间": ["命名空间", "namespace", "内姆斯佩斯"],
    "tsconfig": ["t s config", "ts 康飞哥", "tsconfig文件"],
}


# ══════════════════════════════════════════════════════════════════
# 展开为变体→正词的查找表（模块加载时一次性完成）
# ══════════════════════════════════════════════════════════════════

def _build_lookup() -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for term, variants in _TERM_VARIANTS.items():
        seen: set[str] = set()
        for v in variants:
            # 原始变体
            v_norm = v.strip()
            if v_norm and v_norm not in seen:
                seen.add(v_norm)
                pairs.append((v_norm, term))
            # 自动生成的变体（字母拼读、大小写等）
            for auto in _generate_variants(v):
                if auto and auto not in seen:
                    seen.add(auto)
                    pairs.append((auto, term))
    # 长匹配优先
    pairs.sort(key=lambda x: -len(x[0]))
    return pairs

_CORRECTIONS: list[tuple[str, str]] = _build_lookup()


# ══════════════════════════════════════════════════════════════════
# 拼音模糊匹配（已知术语库）
# ══════════════════════════════════════════════════════════════════

class _PinyinTerm(NamedTuple):
    term: str
    pinyin: str

_PINYIN_DB: list[_PinyinTerm] = sorted([
    _PinyinTerm(term, _to_pinyin(term))
    for term in _TERM_VARIANTS.keys()
], key=lambda x: -len(x.term))


def _pinyin_fuzzy_correct(text: str, threshold: float = 0.72) -> str:
    """对中文片段做拼音模糊匹配。"""
    segments = re.findall(r'[一-鿿]{2,}', text)
    if not segments:
        return text

    result = text
    for segment in sorted(set(segments), key=lambda x: -len(x)):
        seg_pinyin = _to_pinyin(segment)

        best_score = 0.0
        best_term = ""
        for pt in _PINYIN_DB:
            score = fuzz.ratio(seg_pinyin, pt.pinyin) / 100.0
            if score > best_score:
                best_score = score
                best_term = pt.term

        if best_score >= threshold and best_term != segment:
            result = result.replace(segment, best_term)
            logger.info("拼音纠正 [%.0f%%]: %.20s → %.20s", best_score * 100, segment, best_term)

    return result


# ══════════════════════════════════════════════════════════════════
# 公开 API
# ══════════════════════════════════════════════════════════════════

def correct_asr_text(text: str) -> str:
    """双层纠正。

    Layer 1 — 精确匹配（归一化后查找词典，微秒级）
    Layer 2 — 拼音模糊匹配（毫秒级兜底）
    """
    if not text or not text.strip():
        return text

    original = text

    # 归一化后精确匹配
    text_norm = _normalize(text)
    text_nosp = _strip_spaces(text_norm)

    for wrong, correct in _CORRECTIONS:
        wrong_nosp = _strip_spaces(wrong)
        if wrong_nosp in text_nosp:
            # 在原文本中替换（保留原文本的空格/大小写格式）
            pattern = re.compile(re.escape(wrong), re.IGNORECASE)
            text = pattern.sub(correct, text)

    # 拼音模糊匹配兜底
    text = _pinyin_fuzzy_correct(text)

    # 清理
    text = re.sub(r'\s{2,}', ' ', text).strip()

    if text != original:
        logger.info("ASR 纠正: %.50s → %.50s", original, text)

    return text
