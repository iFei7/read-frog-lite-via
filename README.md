# Read Frog Lite for Via

面向 Via 浏览器的单文件网页翻译用户脚本（当前 **v1.4.2**），基于上游 [Read Frog](https://github.com/mengxi-ream/read-frog) 二次开发，采用 GPL-3.0-only 发布。

> 本项目基于 [Read Frog](https://github.com/mengxi-ream/read-frog) 进行二次开发。
> This project is a modified work based on Read Frog.

由于 Via 浏览器长期缺少为移动端阅读场景专门设计的翻译脚本，本项目参考 Read Frog 的设计与翻译思路，使用 Vibe Coding 完成了适配 Via 的轻量实现。它专注于手机上的网页阅读与手动翻译体验，不是 Read Frog 官方版本。

## 项目结构

单文件油猴脚本，不做模块化拆分、不引入运行时依赖、不建 CI。仓库只按职责分层：

| 路径 | 说明 |
| --- | --- |
| `src/read-frog-lite-via.user.js` | **唯一可编辑源文件**（定制版，含 `// @version`），所有改动都落在这里 |
| `upstream/read-frog-lite-via-1.2.1.user.js` | 上游 v1.2.1 原版基线，只读参考，用于对比定制改动 |
| `tests/test-four-finger.cjs` | 多指手势回归测试（25 用例），从源码按标记截取真实代码执行 |
| `tests/test-persist.cjs` | 配置持久化回归测试（18 用例），截取配置层在 vm 沙箱里跑 |
| `tests/test-view-toggle.cjs` | 原文/译文二态切换与轻点语义测试（29 项断言），截取 `restorePage`~`retryRecord` 与 `dragEnd` |
| `tests/test-free-providers.cjs` | 免费通道测试（51 项断言），按 `免费通道 BEGIN/END` 标记截取后注入请求桩，全程不联网 |
| `tests/test-via-port.mjs` | 既有端到端测试（依赖 playwright，未随仓库安装） |
| `scripts/release.cjs` | 零依赖发布脚本：读版本号 → 同步 `rfvia-publish/` |
| `docs/` | 开发指南、分析报告、优化方向记录与 `images/` |
| `rfvia-publish/` | 部署产物：`index.html` 下载页 + 各版本 `.user.js` / `.txt` |
| `package.json` | 只有 `scripts`，无任何依赖字段 |

## 开发流程

```bash
# 1. 只改 src/read-frog-lite-via.user.js
# 2. 语法检查 + 回归测试（必须 25/25、18/0、29/0、51/0 全绿）
npm run check
npm test
# 3. 同步发布产物（读 @version → 生成 .user.js/.txt → 改 index.html）
npm run release
# 4. 部署：提交 rfvia-publish/ 后由维护者发布到静态托管
git add -A && git commit -m "feat: ..."
```

改版本号只需改 `src/read-frog-lite-via.user.js` 头部的 `// @version`，再执行 `npm run release`；脚本不联网、不读本机其他路径。详细说明（新增翻译服务的完整步骤、调试技巧、常见假红排查）见 [docs/development.md](docs/development.md)。

## 如何新增一个翻译服务

新服务不是改一处就够，下面四处必须联动（缺一处会出现「设置里选得到但翻译报错」或「有响应但缓存串味」）：

1. **服务枚举**：`SERVICE_CHOICES` 白名单（`normalizeConfig()` 用它校验）+ `FREE_SERVICES`（免 key 通道登记）+ 设置面板 `<select id="service">` 增加 `<option>`。
2. **设置面板**：`updateServiceFields()` 的 `ai-fields` / `custom-endpoint-wrap` 显隐由 `FREE_SERVICES` 决定；`updateEndpointPreview()` 为免 key 通道显示「无需配置」或降级顺序。
3. **校验**：`validateConfig()` 对 `FREE_SERVICES[cfg.service]` 直接放行，不再强制 Key/模型/接口地址。
4. **翻译分发**：`requestTranslations()` 的 `providerCall` 按 `cfg.service` 分发到对应 `xxxTranslate()`；非 Chat Completions 的请求请写在 `// === 免费通道 BEGIN/END ===` 标记区内，便于测试整体截取。

补充检查点：`migrateConfig()` 的旧配置迁移（`provider`/`endpoint` → `service`）、缓存键（`translationCacheKey()` 已带服务标识）、`requestWithRetry()` 的最后一个 `method` 参数（GET 通道传 `"GET"` 且 body 传 `null`）。

## 测试桩的两个已知坑

两个 `.cjs` 测试都是「从真实源码截取代码 + 假 DOM」运行，不是重写逻辑，因此桩必须足够像真机：

1. **`El` 桩必须有 `className` 的 setter**。脚本里用 `el.className = "..."` 切换状态，若桩只提供 `classList` 或只读 `className`，赋值会被静默丢弃，激活态判断随之错乱 —— 表现为莫名其妙的假红。
2. **沙箱必须预置 `var config = {}`**。截取的代码块里有 `validateConfig(config)`，若 `config` 未声明会抛 `ReferenceError`，而外层 `try/catch` 会把异常吞掉，测试因此「通过」或「随机失败」，排查成本极高。

## 发布产物

`rfvia-publish/` 是纯静态下载页，结构保持不变：

- `index.html`：卡片式下载页，含 `.user.js` 下载按钮、直链、`.txt` 纯文本入口与 Via 安装步骤。
- `read-frog-lite-via-v<版本>.user.js`：该版本的完整脚本，与 `src/` 逐字节一致。
- `read-frog-lite-via-v<版本>.txt`：同一份脚本的纯文本版（CRLF → LF 归一，便于手机上长按复制）。
- `read-frog-lite-via.user.js` 与 `read-frog-lite-via.txt`：固定文件名副本（不带版本号），每次发版覆盖，URL 永远不变、内容永远是最新版；脚本头部的 `@updateURL` / `@downloadURL` 即指向该固定 URL，已安装用户在 Via 脚本管理里点「更新」即可拉到最新版，无需重新导入。
- 历史版本文件保留不删，便于回滚与对比。

`npm run release` 会更新 `index.html` 的标题、`.ver` 行与两处 `.user.js`、`.txt` 链接；页面底部的版本说明段落（`.note`）是人工撰写的变更描述，脚本不会自动改写，发版时请手动更新。

## Features

- 为 Via 浏览器和 Android WebView 的移动阅读场景优化
- 页面加载期间尽早显示悬浮球，并兼容限制内联样式的严格 CSP 网站
- 渐进式网页正文翻译，优先处理当前阅读区域，并让批量结果逐条自然显示
- 双语对照与“直接替换原文”模式，可随时切换或恢复原文
- 多指按压在“原文 / 译文”之间二态循环：翻译中按压一步停译并显示原文，停在原文时再按压秒回已有译文并继续翻译剩余段落
- 可为指定网站开启自动翻译，默认仍保持手动触发
- Microsoft 免费翻译、有道、MyMemory、Google（需可访问 Google）、自动降级链、OpenAI、DeepSeek 与 OpenAI Compatible API
- 跨页面本地翻译缓存、批量控制、并发控制、失败段落单独重试
- 限流与服务端错误自动退避重试，点击停止翻译会立即中止
- 长文没有段落数量上限，超长段落切分翻译后无损拼回
- 页面新增或改写的内容会继续跟进：动态加载、折叠展开、切换显示、AI 逐字输出、虚拟列表都不漏译
- 正文智能识别：跳过工具栏、表单、代码与隐藏内容，同时保留导航、页脚与按钮上的可读文字
- 输入框与可编辑区保护：草稿不会被读取、发送或改写
- 可拖动、贴边半隐藏的青蛙悬浮球，以及 Material 风格设置面板

## Installation

1. 下载或复制 [`src/read-frog-lite-via.user.js`](src/read-frog-lite-via.user.js)（或从 `rfvia-publish/` 取对应版本；发布页的固定链接 `read-frog-lite-via.user.js` 始终指向最新版）。
2. 将文件传到 Android 设备，或复制完整脚本内容。
3. 在 Via 中打开“设置 → 脚本”，从本地导入脚本或新建脚本后粘贴保存。
4. 启用脚本并刷新网页。页面右侧会出现半隐藏的青蛙悬浮球。
5. 轻点一次悬浮球将其呼出；再次轻点开始翻译。长按可打开翻译模式、恢复原文与设置等操作。也可用多指长按（默认四指）在原文与译文之间切换：译文视图中按压一步显示原文，原文视图中按压立即回到译文。

> Via 的菜单名称可能因版本或语言略有不同；核心步骤是导入并启用用户脚本，然后刷新目标网页。

## Configuration

长按悬浮球，选择“设置”即可配置服务、语言、显示模式、每批段落数与并发数。开启“总是自动翻译此网站”后，脚本会记住当前域名，并在以后访问该域名时自动翻译。

## 翻译通道

| 通道 | 是否需要 Key | 批量能力 | 限流 / 风险 |
| --- | --- | --- | --- |
| Microsoft（Edge 接口） | 否 | 原生数组批量，按序对齐；单条可达 9800 字符 | 实测 200 条 / 0.43–0.82s，20 次连打未见限流；空数组会 400（脚本已拦截） |
| 有道（aidemo） | 否 | 用 `\n` 拼接，段数一致才回填，不一致自动逐条重发 | 单请求 ≤1000 字符（脚本按 900 切片）；超长或频控返回 `errorCode:411` |
| MyMemory | 否 | 无批量，逐条串行 | 500 字符硬限；超长时 HTTP 仍是 200，但 `responseStatus:"403"` 且译文为 `QUERY LENGTH LIMIT EXCEEDED...`（脚本已拦截，不会当译文渲染） |
| Google（gtx 免 key） | 否 | 无稳定批量，逐条 GET，3 条一批 | **中国大陆不可直连**，仅可访问 Google 的网络下可用，因此不进入自动降级链 |
| OpenAI / DeepSeek / 自定义 | 是 | 由模型一次性返回 JSON 数组 | 受各自额度与速率限制；需填写 Key 与模型 |
| 自动（`auto`） | 否 | 按 **Edge → 有道 → MyMemory** 依次尝试 | 任一通道成功即返回；全失败才报错，错误信息会附各通道原因 |

说明：

- 「自动」只在免费通道之间降级，不包含 Google —— 大陆网络下 Google 只会多等一轮超时，让降级链变慢。
- Google 需要代理或境外网络才能使用；在网络可达时它作为独立选项手动选择，稳定性和速度不如 Edge。
- 免 key 通道同样会把页面正文发送到对应服务商，隐私边界与本项目其他通道一致。

对于 OpenAI、DeepSeek 与自定义接口，请填写自己的 API Key 和模型名称；Microsoft、有道、MyMemory、Google 与「自动」均无需填写任何 Key。请先使用“测试服务”确认配置可用，再翻译网页。

目标语言为中文等字符体系明确的语言时，脚本会在请求前跳过已经是目标语言的纯文本，以及 URL、邮箱、纯数字、金额与版本号等内容；中外文混合段落仍会发送给翻译服务。AI 批量输出格式异常时会使用受控并行补救，减少逐段等待；遇到限流或服务端错误时按指数退避自动重试，最多 3 次。

## Compatibility

- 设计目标为较新的 Via 浏览器与 Android System WebView。
- 使用构造样式表加载脚本界面和译文样式，以兼容禁止内联样式的严格 CSP 页面。
- 脚本优先使用 Via 提供的 `GM_*` API；在缺少部分 API 的环境中会尝试标准 Web API 作为降级路径，但自定义跨域接口可能无法工作。
- 自定义接口默认要求 HTTPS；仅 `localhost`、`127.0.0.1` 与 Android 模拟器地址 `10.0.2.2` 可使用 HTTP。
- Canvas、PDF 查看器、封闭 Shadow DOM 等不提供普通网页 DOM 正文的页面，可能无法识别可翻译内容；图片内的文字、CSS 伪元素生成的内容与 iframe 内部也不在翻译范围内。

## Privacy

- API Key 保存在 Via 的本地用户脚本存储中，不会由本脚本上传到开发者服务器；它不是加密保险库，请不要在不受信任或多人共用的设备上保存敏感 Key。
- 为减少重复请求，脚本会在本地保存容量受限的原文与译文缓存（最多约 300 条）；缓存键不包含 API Key，清除 Via 的脚本数据即可移除缓存。
- 在你手动翻译网页、为当前网站开启自动翻译或测试服务时，待翻译文本会发送给你选择的翻译服务。
- 使用 Microsoft 服务时，文本会发送到 Microsoft 翻译服务；使用有道 / MyMemory / Google 时，文本会发送到对应服务商（「自动」会在降级时依次尝试前两者）；使用 AI 或自定义服务时，文本会发送到对应 API 提供方。请同时阅读该服务提供方的隐私政策。
- 本脚本不包含统计、遥测、广告或开发者数据收集代码。
- 脚本声明 `GM_xmlhttpRequest` 和 `@connect *`，是为了在 Via 中绕过网页跨域限制，并支持用户自行配置的 OpenAI Compatible API。请只填写可信服务地址，并妥善保管 API Key。

## Credits

感谢 [Read Frog](https://github.com/mengxi-ream/read-frog) 原作者与贡献者提供的开源项目、设计思路和参考实现。

## License

本项目采用 [GPL-3.0-only](LICENSE) 许可证发布。

发布或再分发修改版本时，请保留上游归属与许可证声明，并同时提供对应源码。

## 文档

- [docs/development.md](docs/development.md)：开发指南（结构、新增服务、调试、发布、排查假红）
- [docs/translation-endpoints.md](docs/translation-endpoints.md)：免费翻译通道调研与选型（实测数据、各通道坑、为何不做 DeepSeek 网页版）
- [docs/read-frog-lite-via-分析报告.md](docs/read-frog-lite-via-分析报告.md)：代码结构分析
- [docs/read-frog-lite-via-优化方向分析.md](docs/read-frog-lite-via-优化方向分析.md)：优化方向分析
- [docs/read-frog-lite-via-优化方向修订与实施记录.md](docs/read-frog-lite-via-优化方向修订与实施记录.md)：优化实施记录
- [CHANGELOG.md](CHANGELOG.md)：版本变更

## 赞助

如果这个脚本帮你省了时间，可以[请作者喝杯咖啡](docs/images/sponsor-qr.jpg)（微信 / 支付宝扫码，完全自愿，不影响任何功能）。
