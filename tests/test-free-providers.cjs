"use strict";

/**
 * 免 key 免费通道测试：有道 / MyMemory / Google / 自动降级链 / 服务分发
 *
 * 与 test-four-finger.cjs 同一套做法：按固定标记从真实源码截取
 * 「免费通道 BEGIN/END」区块，再用 new Function 注入桩函数执行，
 * 断言跑的是发布出去的那份代码。全程不联网，全部使用预设响应。
 */

const fs = require("fs");
const path = require("path");

const SOURCE_FILE = path.join(__dirname, "..", "src", "read-frog-lite-via.user.js");
const source = fs.readFileSync(SOURCE_FILE, "utf8");

const BLOCK_START_MARK = "  // === 免费通道 BEGIN ===";
const BLOCK_END_MARK = "  // === 免费通道 END ===";
const blockStart = source.indexOf(BLOCK_START_MARK);
const blockEnd = source.indexOf(BLOCK_END_MARK);
if (blockStart < 0 || blockEnd < blockStart) {
  console.error("定位失败：未在 " + SOURCE_FILE + " 中找到免费通道标记");
  process.exit(2);
}
const block = source.slice(blockStart, blockEnd);
const required = ["youdaoTranslate", "myMemoryTranslate", "googleTranslate", "freeServiceFallback", "splitFreeText"];
const missing = required.filter(function (name) { return block.indexOf("function " + name) < 0; });
if (missing.length) {
  console.error("截取块缺少函数：" + missing.join(", "));
  process.exit(2);
}
const blockStartLine = source.slice(0, blockStart).split("\n").length;
const blockEndLine = blockStartLine + block.split("\n").length - 2;

/* --------------------------------------------------------------- 桩实现 */

function makeRequestError(message, kind) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

// 只覆盖测试用到的实体，够验证「回传的是 HTML 实体」这一行为。
function makeDecodeHtml() {
  const entities = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };
  return function decodeHtml(text) {
    return String(text).replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, function (match) { return entities[match]; });
  };
}

function makeNormalizeLanguage() {
  return function normalizeLanguage(value) {
    const raw = String(value == null ? "" : value).trim();
    if (raw === "中文" || raw === "zh-CN" || raw === "zh") return "zh-Hans";
    return raw || "zh-Hans";
  };
}

/**
 * options.responder(url, headers, body, attemptIndex) -> 字符串（或抛出）
 * options.edge 传入自定义 microsoftTranslate 桩
 */
function createHarness(options) {
  options = options || {};
  const log = { requests: [], sleeps: [], edgeCalls: 0 };
  const responder = options.responder || function () { return "{}"; };
  const requestWithRetry = function (url, headers, body, jobId, method) {
    log.requests.push({ url: url, headers: headers, body: body, method: method || "POST" });
    return Promise.resolve().then(function () {
      return responder(url, headers, body, log.requests.length - 1);
    });
  };
  const sleep = function (ms) { log.sleeps.push(ms); return Promise.resolve(); };
  const edgeTranslate = options.edge || async function (texts) {
    log.edgeCalls++;
    return texts.map(function (text) { return "EDGE:" + text; });
  };

  const factory = new Function(
    "requestWithRetry", "sleep", "requestError", "decodeHtml", "normalizeLanguage", "microsoftTranslate",
    block + "\n" +
    "return {\n" +
    "  youdaoTranslate: youdaoTranslate,\n" +
    "  myMemoryTranslate: myMemoryTranslate,\n" +
    "  googleTranslate: googleTranslate,\n" +
    "  freeServiceFallback: freeServiceFallback,\n" +
    "  splitFreeText: splitFreeText\n" +
    "};\n"
  );

  const api = factory(requestWithRetry, sleep, makeRequestError, makeDecodeHtml(), makeNormalizeLanguage(), edgeTranslate);
  return { api: api, log: log };
}

/* ------------------------------------------------------- requestTranslations */

const RT_START = source.indexOf("  async function requestTranslations(texts, cfg, jobId) {");
const RT_END = source.indexOf("\n  function registerInflight", RT_START);
if (RT_START < 0 || RT_END < RT_START) {
  console.error("定位失败：未找到 requestTranslations");
  process.exit(2);
}
const requestTranslationsBlock = source.slice(RT_START, RT_END);

function createDispatchHarness(calls) {
  const factory = new Function(
    "splitLongText", "freeServiceFallback", "microsoftTranslate", "youdaoTranslate",
    "myMemoryTranslate", "googleTranslate", "aiTranslate", "retryAiIndividually",
    requestTranslationsBlock + "\nreturn requestTranslations;\n"
  );
  function provider(name) {
    return async function (texts) {
      calls.push(name);
      return texts.map(function (text) { return name + ":" + text; });
    };
  }
  return factory(
    function splitLongText(text) { return [{ core: text, sep: "" }]; },
    provider("auto"),
    provider("microsoft"),
    provider("youdao"),
    provider("mymemory"),
    provider("google"),
    provider("ai"),
    async function retryAiIndividually() { throw new Error("不应走到单条重试"); }
  );
}

/* ------------------------------------------------------------ 断言小跑腿 */

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? "✅" : "❌") + " " + name + " → " + JSON.stringify(actual) + (ok ? "" : "（期望 " + JSON.stringify(expected) + "）"));
}
function section(title) { console.log("\n── " + title + " ──"); }

const YOUDAO_URL = "https://aidemo.youdao.com/trans";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const GOOGLE_URL = "https://translate.googleapis.com/translate_a/single";

function youdaoResponse(code, translation) {
  // 真实接口的译文在 translation 数组的第 0 项里。
  return JSON.stringify({ errorCode: code, translation: translation == null ? null : [translation] });
}

/* ------------------------------------------------------------------ 用例 */

(async function main() {
  // 1) 有道：请求 URL / Content-Type / body 编码
  section("1. 有道请求编码");
  const h1 = createHarness({ responder: function () { return youdaoResponse("0", "你好\n世界"); } });
  const r1 = await h1.api.youdaoTranslate(["Hello", "World"], { targetLanguage: "zh-Hans" }, 0);
  const req1 = h1.log.requests[0];
  check("URL 指向 aidemo.youdao.com", req1.url, YOUDAO_URL);
  check("Content-Type 为表单编码", req1.headers["Content-Type"], "application/x-www-form-urlencoded");
  check("body 含 q=（换行编码为 %0A）", req1.body.indexOf("q=Hello%0AWorld") === 0, true);
  check("body 含 from=auto", req1.body.indexOf("&from=auto") > 0, true);
  check("body 含 to=zh-CHS", req1.body.indexOf("&to=zh-CHS") > 0, true);
  check("未显式传 method 时默认 POST", req1.method, "POST");
  check("按序回填两段", r1, ["你好", "世界"]);

  // 2) 有道：errorCode 字符串 "0" 与数字 0 都能解析
  section("2. 有道 errorCode 类型兼容");
  const h2a = createHarness({ responder: function () { return youdaoResponse("0", "字符串零"); } });
  check("errorCode 为字符串 \"0\" 时解析成功", await h2a.api.youdaoTranslate(["A"], { targetLanguage: "en" }, 0), ["字符串零"]);
  const h2b = createHarness({ responder: function () { return youdaoResponse(0, "数字零"); } });
  check("errorCode 为数字 0 时解析成功", await h2b.api.youdaoTranslate(["A"], { targetLanguage: "en" }, 0), ["数字零"]);

  // 3) 有道：411 抛错
  section("3. 有道 411 超长/限流");
  const h3 = createHarness({ responder: function () { return youdaoResponse(411, null); } });
  let err3 = null;
  try { await h3.api.youdaoTranslate(["A"], { targetLanguage: "en" }, 0); } catch (error) { err3 = error; }
  check("抛出错误", !!err3, true);
  check("message 含「有道」", !!(err3 && /有道/.test(err3.message)), true);
  check("错误类型为 format", err3 && err3.kind, "format");

  // 4) 有道：多段拼接后段数一致 → 按序回填
  section("4. 有道多段按序回填");
  const h4 = createHarness({ responder: function () { return youdaoResponse("0", "甲\n乙\n丙"); } });
  const r4 = await h4.api.youdaoTranslate(["one", "two", "three"], { targetLanguage: "zh-Hans" }, 0);
  check("三段按序回填", r4, ["甲", "乙", "丙"]);
  check("只发一次请求", h4.log.requests.length, 1);

  // 5) 有道：段数不一致 → 降级逐条
  section("5. 有道段数不一致降级逐条");
  const h5 = createHarness({
    responder: function (url, headers, body, index) {
      if (index === 0) return youdaoResponse("0", "只有一段");
      return youdaoResponse("0", "单条" + index);
    }
  });
  const r5 = await h5.api.youdaoTranslate(["one", "two"], { targetLanguage: "zh-Hans" }, 0);
  check("请求次数 = 1 次批量 + 2 次逐条", h5.log.requests.length, 3);
  check("逐条结果按序回填", r5, ["单条1", "单条2"]);

  // 6) 有道：单条超 900 字符 → 切片
  section("6. 有道超长单条切片");
  let longText = "";
  for (let i = 0; i < 80; i++) longText += "Sentence number " + i + ". ";
  check("测试文本确实超过 900 字符", longText.length > 900, true);
  const h6 = createHarness({ responder: function () { return youdaoResponse("0", "译"); } });
  const r6 = await h6.api.youdaoTranslate([longText], { targetLanguage: "zh-Hans" }, 0);
  check("发生切片（请求次数 > 1）", h6.log.requests.length > 1, true);
  check("切片后仍返回单条结果", r6.length, 1);
  check("每片都在 900 字符以内", h6.log.requests.every(function (req) {
    const matched = /^q=([^&]*)/.exec(req.body);
    return matched && decodeURIComponent(matched[1]).length <= 900;
  }), true);

  // 7) MyMemory：正常解析 + HTML 实体解码
  section("7. MyMemory 正常解析");
  const h7 = createHarness({
    responder: function () {
      return JSON.stringify({ responseStatus: "200", responseData: { translatedText: "你好 &amp; 世界" } });
    }
  });
  const r7 = await h7.api.myMemoryTranslate(["Hello & World"], { targetLanguage: "zh-CN" }, 0);
  const req7 = h7.log.requests[0];
  check("使用 GET", req7.method, "GET");
  check("GET 不带请求体", req7.body, null);
  check("URL 指向 MyMemory", req7.url.indexOf(MYMEMORY_URL + "?q=") === 0, true);
  check("langpair 为 Autodetect|zh-CN", req7.url.indexOf("langpair=Autodetect%7Czh-CN") > 0, true);
  check("HTML 实体已解码", r7, ["你好 & 世界"]);

  // 8) MyMemory：超长错误不能被当成译文
  section("8. MyMemory 超长/限流拦截");
  const h8a = createHarness({
    responder: function () {
      return JSON.stringify({ responseStatus: "403", responseData: { translatedText: "QUERY LENGTH LIMIT EXCEEDED. MAX ALLOWED QUERY : 500 CHARS" } });
    }
  });
  let err8 = null;
  try { await h8a.api.myMemoryTranslate(["A"], { targetLanguage: "zh-CN" }, 0); } catch (error) { err8 = error; }
  check("responseStatus 403 时抛错", !!err8, true);
  check("不会被当成译文返回", err8 && /MyMemory/.test(err8.message), true);

  const h8b = createHarness({
    responder: function () {
      return JSON.stringify({ responseStatus: "200", responseData: { translatedText: "QUERY LENGTH LIMIT EXCEEDED" } });
    }
  });
  let err8b = null;
  try { await h8b.api.myMemoryTranslate(["A"], { targetLanguage: "zh-CN" }, 0); } catch (error) { err8b = error; }
  check("译文含 LIMIT EXCEEDED 时抛错", !!(err8b && err8b.kind === "format"), true);

  const h8c = createHarness({ responder: function () { return JSON.stringify({ quotaFinished: true, responseStatus: "200", responseData: { translatedText: "x" } }); } });
  let err8c = null;
  try { await h8c.api.myMemoryTranslate(["A"], { targetLanguage: "zh-CN" }, 0); } catch (error) { err8c = error; }
  check("quotaFinished 时抛 quota 错误", err8c && err8c.kind, "quota");

  // 9) MyMemory：500 字符切片
  section("9. MyMemory 超长切片");
  let myMemoryLong = "";
  for (let i = 0; i < 40; i++) myMemoryLong += "This is a sentence. ";
  check("测试文本超过 500 字符", myMemoryLong.length > 500, true);
  const h9 = createHarness({
    responder: function () {
      return JSON.stringify({ responseStatus: "200", responseData: { translatedText: "片段" } });
    }
  });
  const r9 = await h9.api.myMemoryTranslate([myMemoryLong], { targetLanguage: "zh-CN" }, 0);
  check("发生切片（请求次数 > 1）", h9.log.requests.length > 1, true);
  check("切片后拼成单条结果", r9.length, 1);

  // 10) Google：sentences 多句 join
  section("10. Google 多句拼接");
  const h10 = createHarness({
    responder: function () {
      return JSON.stringify({ sentences: [{ trans: "你好" }, { trans: "世界" }], src: "en" });
    }
  });
  const r10 = await h10.api.googleTranslate(["Hello world"], { targetLanguage: "zh-CN" }, 0);
  const req10 = h10.log.requests[0];
  check("使用 GET", req10.method, "GET");
  check("URL 含 dj=1", req10.url.indexOf("dj=1") > 0, true);
  check("URL 含 sl=auto", req10.url.indexOf("sl=auto") > 0, true);
  check("URL 含 tl=zh-CN", req10.url.indexOf("tl=zh-CN") > 0, true);
  check("多句按顺序拼接", r10, ["你好世界"]);

  // 11) Google：缺 sentences
  section("11. Google 响应缺 sentences");
  const h11 = createHarness({ responder: function () { return JSON.stringify({ src: "en" }); } });
  let err11 = null;
  try { await h11.api.googleTranslate(["Hello"], { targetLanguage: "zh-CN" }, 0); } catch (error) { err11 = error; }
  check("抛出 format 错误", err11 && err11.kind, "format");
  check("message 含「Google」", !!(err11 && /Google/.test(err11.message)), true);

  // 12) freeServiceFallback：Edge 失败 → 有道成功；三者全失败
  section("12. 自动降级链");
  const h12 = createHarness({
    edge: async function () { throw makeRequestError("Edge 挂了", "network"); },
    responder: function () { return youdaoResponse("0", "有道救场"); }
  });
  const r12 = await h12.api.freeServiceFallback(["Hello"], { targetLanguage: "zh-Hans" }, 0);
  check("Edge 失败后自动改用有道", r12, ["有道救场"]);
  check("有道被真实调用（1 次请求）", h12.log.requests.length, 1);

  const h12b = createHarness({
    edge: async function () { throw makeRequestError("Edge down", "network"); },
    responder: function (url) {
      if (url.indexOf("youdao") >= 0) return youdaoResponse(411, null);
      return JSON.stringify({ responseStatus: "403", responseData: { translatedText: "LIMIT EXCEEDED" } });
    }
  });
  let err12 = null;
  try { await h12b.api.freeServiceFallback(["Hello"], { targetLanguage: "zh-Hans" }, 0); } catch (error) { err12 = error; }
  check("全失败时抛出错误", !!err12, true);
  check("message 以「所有免费通道均失败」开头", !!(err12 && err12.message.indexOf("所有免费通道均失败") === 0), true);
  check("message 列出三个通道", !!(err12 && /Edge/.test(err12.message) && /有道/.test(err12.message) && /MyMemory/.test(err12.message)), true);

  const h12c = createHarness({ edge: async function () { return ["零额外请求"]; } });
  await h12c.api.freeServiceFallback(["Hello"], { targetLanguage: "zh-Hans" }, 0);
  check("Edge 正常时零额外请求", h12c.log.requests.length, 0);

  // 14) requestTranslations 分发
  section("14. 服务分发");
  const calls14 = [];
  const dispatch = createDispatchHarness(calls14);
  const out14 = await dispatch(["a", "b"], { service: "youdao" }, 0);
  check("service=youdao 命中 youdaoTranslate", calls14, ["youdao"]);
  check("分发后译文按通道返回", out14, ["youdao:a", "youdao:b"]);
  calls14.length = 0;
  await dispatch(["a"], { service: "auto" }, 0);
  check("service=auto 命中 freeServiceFallback", calls14, ["auto"]);
  calls14.length = 0;
  await dispatch(["a"], { service: "mymemory" }, 0);
  await dispatch(["a"], { service: "google" }, 0);
  await dispatch(["a"], { service: "deepseek", apiKey: "k", model: "m" }, 0);
  check("mymemory / google / AI 各自命中", calls14, ["mymemory", "google", "ai"]);

  /* -------------------------------------------------------------- 输出 */

  console.log("");
  console.log("源码截取: " + SOURCE_FILE);
  console.log("         免费通道区块 第 " + blockStartLine + " - " + blockEndLine + " 行（" + block.split("\n").length + " 行真实代码）");
  console.log("         分发区块：requestTranslations");
  console.log("");
  console.log("结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(function (error) {
  console.error("测试异常：" + (error && error.stack ? error.stack : error));
  process.exit(2);
});
