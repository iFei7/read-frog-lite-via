# 开发指南

本仓库是 Via 浏览器用户脚本 `Read Frog Lite for Via` 的定制版工程。约束只有三条，但都是硬约束：

- **单文件脚本**：所有业务代码在 `src/read-frog-lite-via.user.js` 一个文件里，不做模块化拆分。
- **零依赖**：`package.json` 不含 `dependencies` / `devDependencies`，`scripts/release.cjs` 只用 Node 内置模块，不联网。
- **无 CI**：发布靠本地 `npm test` + `npm run release` 两道手序。

## 1. 目录结构

```
src/read-frog-lite-via.user.js          唯一可编辑源文件（含 // @version）
upstream/read-frog-lite-via-1.2.1.user.js  上游原版基线，只读，用于对比
tests/test-four-finger.cjs              手势回归（25 用例）
tests/test-persist.cjs                  配置持久化回归（18 用例）
tests/test-view-toggle.cjs              原文/译文切换与轻点语义（29 项断言）
tests/test-free-providers.cjs           免费通道与降级链（49 项断言，全桩不联网）
tests/test-via-port.mjs                 端到端移植测试（需要 playwright）
scripts/release.cjs                     发布同步脚本
docs/development.md                     本文件
docs/*.md                               分析报告与优化记录
docs/images/                            截图等资源
rfvia-publish/                          部署产物（index.html + 各版本脚本）
```

### 为什么 `upstream/` 是只读的

它是上游 v1.2.1 的原样快照，作用是回答「这行到底是上游的，还是我们改的」。要看定制差异：

```bash
git diff --no-index upstream/read-frog-lite-via-1.2.1.user.js src/read-frog-lite-via.user.js
```

不要把它当成第二份源文件去改 —— 那会重新造出双源混乱。

## 2. 日常开发流程

```bash
npm run check     # node --check，先过语法
npm test          # 四个 .cjs 回归，必须 25/25、18/0、29/0、49/0 全绿
npm run release   # 同步 rfvia-publish/
```

只改 `src/` 里的文件，然后按上面顺序跑。提交前确认 `git status --short` 里没有临时文件。

## 3. 新增一个翻译服务

新服务必须在**四处**联动，漏一处就会出现「设置里能选，但点翻译报错」或者「能翻但缓存串味」。

### 3.1 服务枚举（配置层）

- `var DEFAULT_CONFIG = {...}`（约第 204 行）：`service` 的默认值，新增服务一般不用改这里。
- `var FREE_SERVICES = { microsoft:1, youdao:1, mymemory:1, google:1, auto:1 }`：**免 key 通道登记表**。加进来即表示「不需要 Key/模型/接口地址」，`validateConfig()` 与设置面板显隐都会读它。
- `var SERVICE_CHOICES = [...]`：`normalizeConfig()` 的白名单（`service: isOneOf(source.service, SERVICE_CHOICES, ...)`）。不加进白名单，用户选择会被静默回退成默认值，这类问题最难查。
- `function migrateConfig()`（约第 318 行）：旧配置按 `provider` / `endpoint` 迁移；免费通道已支持 `provider` 直写。

### 3.2 设置面板（UI 层）

- `<select id="service">`（约第 535 行）：加 `<option value="新标识">显示名</option>`，顺序即推荐顺序。
- `function updateServiceFields(resetModel)`（约第 641 行）：`ai-fields` 显隐由 `FREE_SERVICES[service]` 决定，`custom-endpoint-wrap` 只有 `custom` 显示，模型候选 `models` 数组按服务给出。
- `function defaultModel(service)`：新服务的默认模型（免费通道不涉及）。
- `function updateEndpointPreview()`：免 key 通道显示「无需配置」，`auto` 显示「Edge → 有道 → MyMemory（失败自动降级）」。

### 3.3 端点解析

`function resolvedEndpoint(cfg)`（约第 620 行）为新服务返回固定地址；若新服务也允许用户填自定义地址，走 `normalizeChatEndpoint()` 的补全逻辑（自动补 `/chat/completions`）。自定义地址默认要求 HTTPS，仅 `localhost` / `127.0.0.1` / `10.0.2.2` 允许 HTTP。

### 3.4 翻译分发与请求实现

- `function requestTranslations(texts, cfg, jobId)`（约第 1315 行）内的 `providerCall` 就是分发点，按 `cfg.service` 分成 auto / microsoft / youdao / mymemory / google 与 AI 兜底。
- 若请求/响应格式与 Chat Completions 不同，单独写一个 `xxxTranslate(texts, cfg, jobId)`，放在 **`// === 免费通道 BEGIN ===` 与 `// === 免费通道 END ===`** 之间：
  - 该标记区只允许依赖 `requestWithRetry` / `sleep` / `requestError` / `decodeHtml` / `normalizeLanguage`（以及 `microsoftTranslate`），测试才能用 `new Function` 注入桩整体执行。
  - 用 `requestWithRetry(url, headers, body, jobId, method)`：`method` 缺省 POST；GET 通道传 `"GET"` 且 `body` 传 `null`。
  - 错误统一抛带 `kind` 的对象；限流 / 5xx 沿用现有退避重试，不要自己吞异常。
- `function translationCacheKey(text, cfg)`：缓存键包含 `cfg.service`，新服务自然隔离。
- `function validateConfig(cfg)`（约第 712 行）：`if (FREE_SERVICES[cfg.service]) return;` 免 key 放行，其余服务仍校验 Key / 模型 / 端点。

### 3.5 免费通道的三个已知坑

1. **`errorCode` 类型不固定**：有道有时回字符串 `"0"`、有时回数字 `0`，必须 `String(code) === "0"`。
2. **HTTP 200 也可能是错误**：MyMemory 超长时 `responseStatus` 为 `"403"`、译文是 `QUERY LENGTH LIMIT EXCEEDED...`，必须同时判 `responseStatus` 与 `LIMIT EXCEEDED`，否则会把英文错误提示当译文渲染。
3. **批量段数可能对不上**：有道用 `\n` 拼接，返回段数与输入不一致时不能强行按序回填，要整组降级为逐条请求（`tests/test-free-providers.cjs` 第 5 项覆盖）。

### 3.6 自测清单

1. `npm run check && npm test` 全绿。
2. 设置面板切到新服务：字段显隐、模型下拉、地址预览都正确。
3. 「测试服务」按钮能拿到一次真实译文（`validateConfig` + `translateProvider` 联合验证）。
4. 翻一段长文，确认缓存命中（第二次不再发请求）与失败重试。
5. 切回旧服务，配置不丢。

## 4. 测试与调试

### 4.1 四个 `.cjs` 测试是「切片测试」

它们不重写逻辑，而是用源码里的字符串标记把真实代码整段切出来跑：

- `tests/test-four-finger.cjs`：从 `// 四指长按屏幕` 切到 `window.addEventListener("wheel"`。
- `tests/test-persist.cjs`：从 `var CONFIG_KEY = {` 切到 `var config = migrateConfig();`。
- `tests/test-view-toggle.cjs`：从 `function restorePage() {` 切到 `async function retryRecord`；另按 `function dragEnd(event) {` 切到 `frog.addEventListener("touchstart"` 验证轻点语义。
- `tests/test-free-providers.cjs`：按 `// === 免费通道 BEGIN ===` / `// === 免费通道 END ===` 整段截取，另切 `requestTranslations` 验证分发。

因此**改动这些标记文本或切片区间的起止位置**，测试会立刻报「定位失败」或切到错误代码。真要动结构，同步更新标记，并确认切出来的行数合理（用手势测试首行打印的「第 X - Y 行」核对）。

### 4.2 免费通道的测试桩写法

`tests/test-free-providers.cjs` 用 `new Function` 把截取块包成函数，参数就是它依赖的外部名：

```js
new Function(
  "requestWithRetry", "sleep", "requestError", "decodeHtml", "normalizeLanguage", "microsoftTranslate",
  block + "\nreturn { youdaoTranslate: youdaoTranslate, ... };\n"
)
```

- `requestWithRetry` 桩把 `(url, headers, body, jobId, method)` 全部记进 `log.requests`，再返回预设 JSON；`method` 缺省时按 `"POST"` 记录，才能断言 GET 通道真的用了 GET。
- `sleep` 桩立即 `resolve`，避免真实退避把测试拖慢。
- `requestError` 桩只需造出带 `kind` 的 `Error`；`decodeHtml` / `normalizeLanguage` 用最小实现（实体表 + `zh-CN → zh-Hans`）。
- 想看某个通道的请求形态，就断言 `log.requests[0].url / headers / body / method`，不要断言内部变量。

### 4.3 两个必须知道的桩坑

1. **`El` 桩要有 `className` 的 setter**。脚本用 `el.className = "..."` 切状态，桩若只给 `classList` 或只读 `className`，赋值被吞掉，断言随之假红。
2. **沙箱要预置 `var config = {}`**。截取代码里有 `validateConfig(config)`，缺声明会抛 `ReferenceError`，外层 `try/catch` 一吞，测试就变成「莫名通过」或「随机失败」。

### 4.4 真机调试技巧

- Via 菜单 → 设置 → 脚本，可查看脚本控制台；脚本平时不打印日志，仅启动失败时输出 `[Read Frog Via] 启动失败（仅记录错误类型）`（故意不带堆栈与配置内容，避免泄露 Key）。要详细排查就临时加 `console.log`，提交前删掉。
- 悬浮球不出现时先看 `@match`、`@run-at` 与页面是否为 CSP 严格站点；本脚本用构造样式表，理论上不受内联样式限制。
- 手势没反应时先确认 `gestureFingers` 档位（2/3/4 指）与按压时长（320ms 长按 + 300ms 内落齐）。
- 手势语义是二态循环：空闲按压开始翻译；译文视图按压一步「停译 + 显示原文」；原文视图按压立即回渲染已有译文并续翻剩余段落（`paused` 状态，记录与缓存保留）。
- 翻译卡住时看是否是服务端限流；脚本对 429/5xx 按指数退避重试 3 次。

## 5. 发布流程

```bash
# 1. 改版本号（只改这一处）
#    src/read-frog-lite-via.user.js 头部：// @version      1.4.0
# 2. 跑测试
npm run check && npm test
# 3. 同步发布产物
npm run release
# 4. 手动更新 rfvia-publish/index.html 底部 .note 段落的变更说明
# 5. 提交
git add -A && git commit -m "release: v1.4.0"
```

`scripts/release.cjs` 做四件事：

1. `readSourceVersion()`：从 `src/` 读 `// @version`。
2. 写 `rfvia-publish/read-frog-lite-via-v<ver>.user.js`（与源码逐字节一致）。
3. 写同名 `.txt`（同一份内容，CRLF → LF 归一，便于手机上长按复制）。
4. `syncIndexHtml()` 逐行改写 `index.html`：`<title>` 里的版本号、`.ver` 行、两处 `.user.js` 链接（含链接文案）、`.txt` 链接，并打印被改行号与新内容。

注意事项：

- **幂等**：版本没变时重复执行只重写相同字节，`git status` 保持干净，输出「版本未变，仅同步副本」。
- **`index.html` 里的「基于上游 v1.2.1」不会被改**：`.ver` 行只替换第一个版本号，历史归属说明保持原样。
- **底部 `.note` 段落不会自动改**：那是人工写的变更描述（以 `v1.4.0：…` 开头），发版时手动更新，否则下载页会一直讲上一版的功能。
- 历史版本文件不删除，`rfvia-publish/` 充当可回滚的版本归档。

## 6. 常见假红排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `定位失败：未在 … 中找到四指手势代码块` | 切片标记被改名，或测路径指向错误文件 | 检查标记字符串与 `SOURCE_FILE` 拼接 |
| `SLICE FAILED` | `var CONFIG_KEY` / `var config = migrateConfig();` 被改动 | 恢复标记或同步改切片 |
| 手势用例大量失败且报 `className` 相关 | `El` 桩缺 `className` setter | 补 setter |
| `ReferenceError: config is not defined` 但测试仍"通过" | 沙箱没预置 `var config = {}`，异常被 catch 吞 | 在沙箱 globals 里补 `config: {}` |
| 断言数字少一截 | 切片段落变小（标记提前命中） | 打印切片行数核对 |
| `npm test` 在 Windows 下路径报错 | 手动拼了 `\` 或写死绝对路径 | 统一用 `path.join(__dirname, "..", "src", …)` |

> 红线：修测试只允许改**路径与工程化问题**，不允许改断言期望值、不允许删减用例。断言红了意味着源码行为变了，先判断是 bug 还是要更新用例，别拿改期望值糊过去。

## 7. 安全约束

- 不提交任何 API Key、token、本机绝对路径或内网 IP；测试里也不要留真实密钥。
- 不引入第三方依赖、不加网络请求；`release.cjs` 只读写仓库内的文件。
- `@connect *` 是运行期需要（支持用户自配 OpenAI Compatible 接口），但脚本本身不上传任何数据。
