# Read Frog Lite for Via 油猴脚本分析报告

> 仓库：https://github.com/iFei7/read-frog-lite-via （作者 ShiZi-OuO / shizi）
> 分析基于 v1.2.1 源码 `src/read-frog-lite-via.user.js`（2546 行，约 140KB）
> 许可证：GPL-3.0-only；上游项目：[Read Frog](https://github.com/mengxi-ream/read-frog)

---

## 一、项目概览

| 项目 | 内容 |
|------|------|
| 定位 | 面向 **Via 浏览器（Android）** 的轻量级网页翻译用户脚本，Read Frog 的移动端精简移植版 |
| 形态 | **单文件用户脚本**（无构建系统、无依赖、无打包），在 Via 的脚本引擎中运行 |
| 版本 | v1.2.1（2026-09-24），共 13 次提交，从 v1.0.0 到 v1.2.1 迭代约两周 |
| 核心功能 | 悬浮球触发渐进式正文翻译、双语对照/替换原文、按网站自动翻译、多翻译服务 |
| 翻译服务 | Microsoft（免费无 Key）、OpenAI、DeepSeek、OpenAI Compatible 自定义接口 |
| 测试 | 仅 1 个回归测试文件 `tests/test-via-port.mjs`（覆盖启动流程：延迟 DOM、根节点替换、重复挂载） |

**UserScript 元数据头：**

```
@name         Read Frog Lite for Via
@version      1.2.1
@match        http://*/*  +  https://*/*        ← 全站注入
@run-at       document-end
@grant        GM_getValue / GM_setValue / GM_addStyle / GM_xmlhttpRequest / GM_registerMenuCommand
@connect      *                                  ← 允许跨域请求任意域名
```

---

## 二、代码架构（单文件内按注释分模块）

整个脚本是一个 IIFE，入口先做防重复注入（`document.__rfViaBooting` 标记 + 检查宿主节点），DOM 就绪后 `bootWhenReady()` → `initialize()`。各模块及实测行号：

| 模块 | 关键函数（行号） | 职责 |
|------|----------------|------|
| 启动引导 | `adoptStyle`(L45)、`bootWhenReady`、`mountIsolatedMarkup` | 早期挂载悬浮球宿主，防重复注入 |
| 配置与持久化 | `DEFAULT_CONFIG`、`migrateConfig`、`normalizeConfig`、`gmGet/gmSet` | 配置迁移与校验，GM 存储 |
| 翻译缓存 | `loadTranslationCache`(L206)、`pruneTranslationCache`(L332) | LRU 本地缓存（见下文） |
| UI 外壳与主题 | `applyDynamicPalette`(L523) | Shadow DOM 隔离界面；读 `<meta theme-color>` 生成 Material You 配色 |
| 设置面板 | `resolvedEndpoint`(L552)、`fillForm/readForm/validateConfig` | 底部弹出面板；端点标准化（自动补 `/chat/completions`） |
| 请求层 | `requestWithRetry`(L757)、`requestRaw` | 统一重试/取消/超时（见下文） |
| 翻译服务适配 | `microsoftTranslate`(L780)、`aiTranslate`(L804)、`translateProvider`(L1065) | 四种服务的调度与解析 |
| 语言判定 | `isAlreadyTargetText`(L888)、`TARGET_SCRIPT_RANGES`(L828) | 白名单字符体系判定，跳过已是目标语言的文本 |
| 长文切分 | `splitLongText`(L998) | 超长段落按标点/换行切分，保护代理对与 emoji，翻译后无损拼回 |
| 正文识别 | `layoutParagraphCandidates`(L1476)、`candidateElements`(L1574)、`chromeLabelCandidates`(L1552)、`wrapDirectProtectedText`(L1528) | 基于布局的正文遍历与段落包装 |
| 动态跟进 | `scanNewRecords`(L1742) | MutationObserver 增量扫描新增/改写内容 |
| 悬浮球交互 | 长按弹出操作面板、贴边半隐藏、busy 状态 | 点击呼出→再点翻译；长按开菜单 |

---

## 三、核心机制详解

### 1. 翻译服务适配

| 服务 | 端点 | 认证 | 备注 |
|------|------|------|------|
| Microsoft | `edge.microsoft.com/translate/translatetext` | 无 | 文本先 `escapeHtml` 再 POST，返回后用 textarea `innerHTML` 反解码；校验返回段落数一致 |
| OpenAI | `api.openai.com/v1/chat/completions` | Bearer Key | `temperature: 0.2`，非流式 |
| DeepSeek | `api.deepseek.com/chat/completions`（写死） | Bearer Key | 同上 |
| Custom | 用户填基础地址，脚本自动补 `/chat/completions` | Bearer Key | 强制 HTTPS（仅 localhost/127.0.0.1/10.0.2.2 允许 HTTP） |

**提示注入防护**（`translationMessages`, L795）：system 消息完全由脚本构造，页面可控内容（如 title）不进入协议层；user 消息是纯 JSON 数组。AI 返回需剥离 ```` ```json ```` 围栏、截取首尾 `[...]` 后解析，且强制校验「数组长度 === 输入段落数、每项均为 string」，不符则标记 `kind:"format"` 走批量>1 时的逐条并行补救。

### 2. 重试与取消（`requestWithRetry`, L757）

- 可重试条件：超时 / 网络错误 / HTTP 429、500、502、503、504
- 指数退避：`500ms × 2^attempt`，上限 4s，乘 0.75~1.25 随机抖动；服务端给 `Retry-After` 时优先尊重
- 最多重试 3 次；每次重试前后都检查 `jobId !== app.jobId` —— 点「停止翻译」立即中止，不留悬挂重试

### 3. 正文识别算法（最核心的部分）

采用 **布局驱动遍历** 而非标签名猜测：

1. `wrapBreakSeparatedText`：处理用连续 `<br>` 排版的老式页面
2. `layoutParagraphCandidates`：递归遍历，块级元素持有段落，行内内容归入最近块级段落；用 `layoutInfo()`（getComputedStyle）排除 `display:none`、隐藏、可编辑区；**关键规则**：元素非行内、含行内文本且无块级子内容 → 整段成为候选；混合内容时只包装安全的行内片段（可点击节点逐文字节点包装，避免整体替换清掉图片/图标/事件）
3. `wrapInteractiveText`：`<a>/<button>` 等控件内的文字单独包 span，保留跳转与事件
4. `chromeLabelCandidates`：`role=toolbar/menu/menubar/tablist` 容器本身不翻译，但其中的浅层文字叶子（≤160 字符）按行内译文渲染——v1.2.0 收敛的「排除容器不排除内容」策略
5. 排除规则：`script/style/svg/pre/code`、`contenteditable` 子树、广告容器（强 token `ad/ads`，弱 token `sponsor` 仅跳容器）、屏外 1px/`left:-9999px` 辅助文本、URL/邮箱/纯数字/版本号/金额

**语言判定改为白名单**（v1.2.0 重要修复，L824-856 注释写明了原因）：旧版用「不含任何已知文字体系 → 已是目标语言」的反向推断，导致希伯来文、希腊文、天城文整站漏译。新版 `TARGET_SCRIPT_RANGES` 定义每种目标语言的 `need`（必须出现）与 `allow`（可共存，如日文汉字）；拉丁字母语言再配合虚词占比（en/fr/de/es/pt/it 各一张停用词表）判断。

### 4. 缓存与去重

| 项 | 值 |
|----|----|
| 存储键 | `read_frog_via_translation_cache_v1`（GM 存储） |
| 容量 | 最多 300 条 且 总计 25 万字符；单条键值 >12000 字符不缓存 |
| 淘汰 | LRU：超限删最旧，命中移到末尾；写回防抖 180ms |
| 缓存键 | service + endpoint 哈希 + model + 目标语言 + 原文（**不含 API Key**） |
| 请求去重 | `inflightTranslations` Map 合并并发中的相同文本，同批次相同原文只请求一次 |

### 5. CSP 兼容（v1.2.1 主打特性）

严格 CSP 会拦截 `<style>` 内联注入，脚本三级降级：

1. **构造样式表**：`new CSSStyleSheet()` + `replaceSync()` + `adoptedStyleSheets`（Shadow Root 和 document 各一套）
2. 失败则回退 `GM_addStyle`
3. 再失败才创建 `<style>` 标签（旧 WebView）

跨域请求同理：优先 `GM_xmlhttpRequest`（不受页面 CORS 限制），缺失时降级原生 `fetch` + `AbortController`（自定义接口可能因 CORS 失效）。

### 6. 动态内容跟进

MutationObserver 防抖 + 最大等待，增量扫描只针对真正变化的区域；覆盖框架重渲染、虚拟列表复用、AI 逐字输出、`<details>` 展开、`hidden`/`value`/`title`/`alt` 属性改写。v1.2.0 取消了 500 段硬上限，长文（1000+ 段）可持续翻译。

---

## 四、代码质量评价

| 维度 | 评价 |
|------|------|
| 可读性 | ★★★★★ 中文注释密度高且解释「为什么」而非「是什么」（如 L824 白名单判定、L797 提示注入、L1512 与上游对齐的说明），模块分隔清晰 |
| 兼容性处理 | ★★★★☆ ES5 风格（var/function）+ 少量 async/await，针对旧 WebView 做了多处降级路径 |
| 工程化 | ★★☆☆☆ 单文件 2546 行无拆分、无 lint/CI 配置，测试仅覆盖启动流程（README 自述「Vibe Coding」产物，符合预期） |
| 健壮性 | ★★★★☆ 错误分类（timeout/network/http/format/abort）明确、重试有界、取消及时、输入输出均有形状校验 |
| 安全意识 | ★★★★☆ 提示注入防护、API Key 不入缓存键、自定义端点强制 HTTPS、无遥测——README 隐私章节坦诚说明 `@connect *` 的用途与风险 |

**潜在风险点：**

1. `@connect *` + `GM_xmlhttpRequest` 授权面很宽——是支持任意自定义 API 的必要代价，但也意味着恶意配置下脚本可向任意域发请求。对个人使用可接受，不建议盲目信任第三方分发的修改版。
2. API Key 明文存在 Via 脚本存储中（README 已提示非加密保险库）。
3. `document.__rfViaBooting` 直接挂在 document 上做防重入，可能与极端情况下的页面脚本冲突（概率低）。
4. 封闭 Shadow DOM、Canvas、PDF、CSS 伪元素、iframe 内部内容天然不可达（README 已声明）。

---

## 五、总结

这是一个**完成度和工程质量都明显高于平均水平**的个人油猴脚本：单文件却覆盖了正文识别、渐进翻译、多服务适配、缓存去重、限流退避、CSP 兼容、动态内容跟进等完整链路；v1.0→v1.2 的 changelog 显示作者在认真响应真实场景问题（白名单语言判定修复、输入框草稿保护、重复计费消除等），而不是堆功能。注释中保留的「踩坑记录」（如反向推断语言导致漏译、块内混排行内内容丢署名）尤其有价值。

适用场景：Android 上用 Via 浏览器、想要「点一下翻译正文」的轻量移动阅读体验。不适合需要划词翻译、PDF 翻译或桌面端深度集成（那是上游 Read Frog 的领域）。
