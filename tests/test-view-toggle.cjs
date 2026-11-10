"use strict";

/**
 * 二态循环核心函数测试：enterOriginalView / showTranslatedView / restorePage
 *
 * 与 test-four-finger.cjs 同一套做法：从真实源码用字符串标记截取函数体，
 * 再注入最小桩（app / records / setPhase / renderRecord / startTranslation ...），
 * 因此断言跑的是发布出去的那份代码，而不是测试里另抄一份影子实现。
 */

const fs = require("fs");
const path = require("path");

const SOURCE_FILE = path.join(__dirname, "..", "src", "read-frog-lite-via.user.js");
const source = fs.readFileSync(SOURCE_FILE, "utf8");

// 截取块从 restorePage 起，到 retryRecord 前止：正好覆盖 restorePage 与原文字面切换的两个函数。
const BLOCK_START = source.indexOf("  function restorePage() {");
const BLOCK_END = source.indexOf("  async function retryRecord", BLOCK_START);
if (BLOCK_START < 0 || BLOCK_END < BLOCK_START) {
  console.error("定位失败：未在 " + SOURCE_FILE + " 中找到 enterOriginalView / showTranslatedView 代码块");
  process.exit(2);
}
const block = source.slice(BLOCK_START, BLOCK_END);
const missing = ["function enterOriginalView", "function showTranslatedView", "function restorePage"]
  .filter(function (name) { return block.indexOf(name) < 0; });
if (missing.length) {
  console.error("截取块缺少函数：" + missing.join(", "));
  process.exit(2);
}
const blockStartLine = source.slice(0, BLOCK_START).split("\n").length;
const blockEndLine = blockStartLine + block.split("\n").length - 2;

/* ------------------------------------------------------------------ 假数据 */

function record(status) {
  return { status: status, element: { isConnected: true }, node: null };
}

/* ------------------------------------------------------------- 沙箱工厂 */

function createHarness(options) {
  options = options || {};
  const log = {
    stopped: 0, cleared: [], observerStopped: 0, phases: [], labels: 0,
    rendered: [], started: 0, startedWith: null, toasts: []
  };
  const app = {
    phase: options.phase || "idle",
    active: options.active !== false,
    jobId: 0,
    records: new Map(),
    requests: new Set(),
    counters: { total: 0, success: 0, failed: 0, skipped: 0 },
    deferredCandidates: null,
    mutationScope: null,
    observer: null,
    originalView: !!options.originalView
  };
  (options.records || []).forEach(function (item, index) { app.records.set("r" + index, item); });

  const factory = new Function(
    "document", "app", "initialFrogSummoned",
    "isBusyPhase", "stopTranslation", "clearRecordRendering", "stopObserver",
    "setPhase", "updateActionLabels", "showGestureToast", "renderRecord", "startTranslation",
    "var pendingStart = false, bodyReadyHandler = null, deferredRoots = [];\n" +
    "var SOURCE_SEGMENT_CLASS = 'seg', UI_LABEL_CLASS = 'lbl';\n" +
    "var frogSummoned = !!initialFrogSummoned;\n" +
    "function emptyCounters() { return { total:0, success:0, failed:0, skipped:0 }; }\n" +
    "function cleanupRecord(record) { clearRecordRendering(record); }\n" +
    "function unwrapSourceSegment() {}\n" +
    block + "\n" +
    "return {\n" +
    "  enterOriginalView: enterOriginalView,\n" +
    "  showTranslatedView: showTranslatedView,\n" +
    "  restorePage: restorePage,\n" +
    "  summoned: function () { return frogSummoned; }\n" +
    "};\n"
  );

  const fakeDocument = { querySelectorAll: function () { return []; } };
  const api = factory(
    fakeDocument, app, !!options.summoned,
    function () { return !!options.busy; },
    function () { log.stopped++; },
    function (item) { log.cleared.push(item); },
    function () { log.observerStopped++; },
    function (phase) { app.phase = phase; log.phases.push(phase); },
    function () { log.labels++; },
    function (text) { log.toasts.push(text); },
    function (item) { log.rendered.push(item); },
    function (onlyRecords) { log.started++; log.startedWith = onlyRecords; }
  );

  return { api: api, app: app, log: log };
}

/* ------------------------------------------------------------ 断言小跑腿 */

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log((ok ? "✅" : "❌") + " " + name + " → " + JSON.stringify(actual) + (ok ? "" : "（期望 " + JSON.stringify(expected) + "）"));
}

/* ---------------------------------------------------------------- 用例 */

// 1) enterOriginalView：翻译进行中
const h1 = createHarness({ busy: true, records: [record("success"), record("pending")] });
h1.api.enterOriginalView();
check("busy 时 stopTranslation 被调用一次", h1.log.stopped, 1);
check("每条 record 都调用 clearRecordRendering", h1.log.cleared.length, 2);
check("originalView 置为 true", h1.app.originalView, true);
check("phase 变为 paused", h1.app.phase, "paused");
check("stopObserver 被调用一次", h1.log.observerStopped, 1);
check("提示「已显示原文」", h1.log.toasts[0], "已显示原文");
check("originalView 不触发 startTranslation", h1.log.started, 0);

// 2) showTranslatedView：已有 success / failed + 仍有 pending
const h2 = createHarness({ originalView: true, records: [record("success"), record("failed"), record("pending")] });
h2.api.showTranslatedView();
check("originalView 置为 false", h2.app.originalView, false);
check("success/failed 记录被重新渲染（pending 不渲染）", h2.log.rendered.length, 2);
check("存在 pending 时调用 startTranslation", h2.log.started, 1);
check("续翻走全量路径（无参）", h2.log.startedWith, undefined);
check("提示「已显示译文」", h2.log.toasts[0], "已显示译文");
check("续翻时 frogSummoned 置为 true", h2.api.summoned(), true);

// 3) showTranslatedView：全部译完（无 pending/failed）
const h3 = createHarness({ originalView: true, records: [record("success"), record("success")] });
h3.api.showTranslatedView();
check("无待办时不重复启动翻译", h3.log.started, 0);
check("全部成功时 phase 为 complete", h3.app.phase, "complete");

// 4) showTranslatedView：仅失败段落（无 pending）→ 需要补翻
const h4 = createHarness({ originalView: true, records: [record("success"), record("failed")] });
h4.api.showTranslatedView();
check("存在 failed 时也调用 startTranslation 补翻", h4.log.started, 1);

// 5) 幂等：连续两次 enterOriginalView
const h5 = createHarness({ busy: false, records: [record("success")] });
let idempotentError = null;
try { h5.api.enterOriginalView(); h5.api.enterOriginalView(); } catch (error) { idempotentError = error; }
check("连续两次 enterOriginalView 不抛错", idempotentError, null);
check("两次调用后 phase 仍为 paused", h5.app.phase, "paused");
check("两次调用后 originalView 仍为 true", h5.app.originalView, true);

// 6) restorePage：彻底还原后回到初始态
const h6 = createHarness({ originalView: true, records: [record("success")] });
h6.api.restorePage();
check("restorePage 后 originalView 置为 false", h6.app.originalView, false);
check("restorePage 后 phase 回到 idle", h6.app.phase, "idle");
check("restorePage 后 records 清空", h6.app.records.size, 0);

/* -------------------------------------------------------------------- 输出 */

console.log("");
console.log("源码截取: " + SOURCE_FILE);
console.log("         第 " + blockStartLine + " - " + blockEndLine + " 行（" + block.split("\n").length + " 行真实代码）");
console.log("");
console.log("结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
