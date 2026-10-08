"use strict";

/**
 * 纯逻辑回归测试：四指手势识别率
 *
 * 手势判定逻辑不从这里手抄，而是用 start/end 两个标记从
 * read-frog-lite-via.custom.user.js 真实源码里整段截取，
 * 再注入假 document / 假 event（带 touches 数组）/ 假定时器 / 假 Date.now()。
 * 因此断言跑的就是发布到真机上的那一份代码，改坏了这里立刻红。
 */

const fs = require("fs");
const path = require("path");

const SOURCE_FILE = path.join(__dirname, "read-frog-lite-via.custom.user.js");
const source = fs.readFileSync(SOURCE_FILE, "utf8");

const BLOCK_START = source.indexOf("  // 四指长按屏幕");
const BLOCK_END = source.indexOf('  window.addEventListener("wheel"', BLOCK_START);
if (BLOCK_START < 0 || BLOCK_END < BLOCK_START) {
  console.error("定位失败：未在 " + SOURCE_FILE + " 中找到四指手势代码块");
  process.exit(2);
}
const block = source.slice(BLOCK_START, BLOCK_END);
const blockStartLine = source.slice(0, BLOCK_START).split("\n").length;
const blockLineCount = block.split("\n").length;
const blockEndLine = blockStartLine + blockLineCount - 2;

/* ------------------------------------------------------------------ 假数据 */

// radius 传null 表示该触点不上报 radiusX/radiusY（很多安卓 WebView 的真实情况）。
function touch(identifier, clientX, clientY, radius) {
  var t = { identifier: identifier, clientX: clientX, clientY: clientY };
  if (radius) { t.radiusX = radius; t.radiusY = radius; }
  return t;
}
function finger(i, radius) {
  return touch(i, 20 + i * 70, 400, radius === undefined ? 20 : radius);
}
function fourFingers(radius) {
  return [finger(0, radius), finger(1, radius), finger(2, radius), finger(3, radius)];
}
function moved(dx, dy, radius) {
  return fourFingers(radius).map(function (t) {
    return touch(t.identifier, t.clientX + dx, t.clientY + dy, t.radiusX);
  });
}

/* ------------------------------------------------- 沙箱：假 document / 定时器 */

function createHarness(options) {
  options = options || {};
  const log = { fired: 0, stopped: 0, restored: 0, openedSettings: 0, toasts: [] };
  // 贴近真实 Date.now()（绝对时间）：若从 0 起算，首次触发会落在 1.5s 去抖窗口内被误杀。
  let time = 1000000000000;
  let seq = 0;
  const timers = [];
  const listeners = {};

  const fakeDocument = {
    addEventListener: function (type, handler) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    }
  };
  const host = { contains: function () { return false; } };
  const settings = { classList: { contains: function () { return !!options.settingsOpen; } } };
  const fakeDate = { now: function () { return time; } };

  function setTimeoutFake(fn, delay) {
    const id = ++seq;
    timers.push({ id: id, fn: fn, at: time + (delay || 0) });
    return id;
  }
  function clearTimeoutFake(id) {
    for (let i = 0; i < timers.length; i++) {
      if (timers[i].id === id) { timers.splice(i, 1); return; }
    }
  }

  const factory = new Function(
    "document", "host", "settings", "Date", "setTimeout", "clearTimeout",
    "isBusyPhase", "stopTranslation", "restorePage", "validateConfig", "openSettings",
    "showSettingsStatus", "startTranslation", "showGestureToast",
    "var app = { active: " + (options.appActive ? "true" : "false") + " };\n" +
    "var frogSummoned = false;\n" +
    // 真实脚本里 config 是宿主 IIFE 的全局（fireFourFingerGesture 里 validateConfig(config)
    // 会先求值它）。沙箱漏掉它时，求值 config 抛 ReferenceError 被 catch 接住，走 openSettings
    // 分支返回，所有"应触发"用例全部假红。校验行为由 validateConfig stub 负责，这里给合法对象即可。
    "var config = " + (options.fingers ? "{ gestureFingers: " + options.fingers + " }" : "{}") + ";\n" +
    block + "\n" +
    "return {\n" +
    "  pending: function () { return !!fourFingerTimer; },\n" +
    "  points: function () { return fourFingerPoints; },\n" +
    "  constants: { min: FOUR_FINGER_MIN, hold: FOUR_FINGER_HOLD_MS, landWindow: FOUR_FINGER_LAND_WINDOW_MS, settle: FOUR_FINGER_SETTLE_MS, slopScale: FOUR_FINGER_SLOP_SCALE, slopMin: FOUR_FINGER_SLOP_MIN, slopMax: FOUR_FINGER_SLOP_MAX, debounce: FOUR_FINGER_DEBOUNCE_MS }\n" +
    "};\n"
  );

  const api = factory(
    fakeDocument, host, settings, fakeDate, setTimeoutFake, clearTimeoutFake,
    function () { return !!options.busy; },
    function () { log.stopped++; },
    function () { log.restored++; },
    function () { if (options.invalidConfig) throw new Error("配置不完整"); },
    function () { log.openedSettings++; },
    function (message) { log.toasts.push("status:" + message); },
    function () { log.fired++; },
    function (text) { log.toasts.push(text); }
  );

  return {
    api: api,
    log: log,
    now: function () { return time; },
    fire: function (type, touches) {
      const handlers = listeners[type] || [];
      if (handlers.length === 0) throw new Error("未注册 " + type + " 监听器");
      for (const handler of handlers) handler({ type: type, touches: touches, target: {} });
    },
    advance: function (ms) {
      const target = time + ms;
      for (;;) {
        let due = null;
        for (const timer of timers) {
          if (timer.at <= target && (due === null || timer.at < due.at)) due = timer;
        }
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        time = due.at;
        due.fn();
      }
      time = target;
    }
  };
}

/* ------------------------------------------------------------ 断言小跑腿 */

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
  } catch (error) {
    results.push({ name: name, ok: false, error: error });
  }
}
function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "断言失败") + "：期望 " + expected + "，实际 " + actual);
  }
}

/* ---------------------------------------------------------------- 测试用例 */

test("1. 4 指在 320ms 内先后落齐（0/100/200/300ms）→ 会触发", function () {
  const h = createHarness();
  h.fire("touchstart", [finger(0)]);
  h.advance(100);
  h.fire("touchstart", [finger(0), finger(1)]);
  h.advance(100);
  h.fire("touchstart", [finger(0), finger(1), finger(2)]);
  h.advance(100);
  h.fire("touchstart", fourFingers());
  h.advance(100);
  assertEq(h.log.fired, 0, "第 4 指落齐后 100ms 不该触发");
  h.advance(219);
  assertEq(h.log.fired, 0, "距第 4 指落下 319ms 不该触发");
  h.advance(1);
  assertEq(h.log.fired, 1, "落齐后满 FOUR_FINGER_HOLD_MS 应触发");
});

test("2. 4 指同时落下、按住不动 → 会触发", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(320);
  assertEq(h.log.fired, 1, "四指静止按压应触发");
});

test("3. touchcancel 到达但 touches.length 仍为 4 → 仍然会触发（本次修复核心）", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(100);
  h.fire("touchcancel", fourFingers());
  assertEq(h.api.pending(), true, "系统吞序列后必须保留待触发状态");
  h.advance(219);
  assertEq(h.log.fired, 0, "计时器不能被 touchcancel 提前引爆");
  h.advance(1);
  assertEq(h.log.fired, 1, "计时器必须在 touchcancel 之后照常到期");
});

test("4. touchcancel 到达且 touches.length 为 3 → 不触发", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(100);
  h.fire("touchcancel", fourFingers().slice(0, 3));
  assertEq(h.api.pending(), false, "有效触点掉到 4 以下应取消");
  h.advance(1000);
  assertEq(h.log.fired, 0, "已取消不得补触发");
});

test("5a. 超出圆形 slop 半径（15px > 12px）→ 不触发", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(100);
  h.fire("touchmove", moved(15, 0));
  assertEq(h.api.pending(), false, "轴向 15px 已超出 slop");
  h.advance(1000);
  assertEq(h.log.fired, 0, "超半径不得触发");
});

test("5b. 斜向移动但仍在半径内（8,8 → 11.3px < 12px）→ 仍触发", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(100);
  h.fire("touchmove", moved(8, 8));
  assertEq(h.api.pending(), true, "圆内斜向抖动不得取消");
  h.advance(220);
  assertEq(h.log.fired, 1, "圆内斜向移动后仍应触发");
});

test("6a. settle 期(60ms)内的坐标跳变 → 不取消", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(30);
  h.fire("touchmove", moved(15, 0));
  assertEq(h.api.pending(), true, "settle 期内的落屏跳变不应取消");
  h.advance(40);
  h.fire("touchmove", fourFingers());
  h.advance(250);
  assertEq(h.log.fired, 1, "settle 期抖动后回到原点仍应触发");
});

test("6b. settle 期之后超出 slop → 取消", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(100);
  h.fire("touchmove", moved(15, 0));
  assertEq(h.api.pending(), false, "settle 期之后的超半径位移应取消");
  h.advance(1000);
  assertEq(h.log.fired, 0, "取消后不得触发");
});

test("7. 第 5 指中途按下（含第 5 指大幅移动）→ 不取消、不重置计时", function () {
  const h = createHarness();
  const five = fourFingers().concat([touch(9, 600, 800, 20)]);
  h.fire("touchstart", fourFingers());
  h.advance(50);
  h.fire("touchstart", five);
  h.advance(50);
  h.fire("touchmove", moved(0, 0).concat([touch(9, 900, 1000, 20)]));
  assertEq(h.api.pending(), true, "第 5 指及其位移不参与判定，不该取消");
  h.advance(219);
  assertEq(h.log.fired, 0, "计时不得被第 5 指重置");
  h.advance(1);
  assertEq(h.log.fired, 1, "原计时点应照常触发");
});

test("8. 触发后 1.5s 去抖窗口内的二次触发被拦下，超窗后可再触发", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(320);
  assertEq(h.log.fired, 1, "首次应触发");
  h.fire("touchend", []);
  h.advance(80);
  h.fire("touchstart", fourFingers());
  h.advance(320);
  assertEq(h.log.fired, 1, "去抖窗口内不得二次触发");
  h.fire("touchend", []);
  h.advance(1400);
  h.fire("touchstart", fourFingers());
  h.advance(320);
  assertEq(h.log.fired, 2, "超过 1.5s 去抖后应能再次触发");
});

test("9. 落指窗口(300ms)外补上的第 4 指 → 不与最早的触点拼成手势", function () {
  const h = createHarness();
  h.fire("touchstart", [finger(0)]);
  h.advance(150);
  h.fire("touchstart", [finger(0), finger(1)]);
  h.advance(150);
  h.fire("touchstart", [finger(0), finger(1), finger(2)]);
  assertEq(h.api.pending(), false, "只到 3 指不该启动计时");
  h.advance(150);
  h.fire("touchstart", fourFingers());
  assertEq(h.api.pending(), false, "超窗补上的第 4 指不应触发");
  h.advance(1000);
  assertEq(h.log.fired, 0, "超窗不得触发");
});

test("10a. 触点不报 radiusX/radiusY → 回退 10px 下限，8px 位移照常触发", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers(null));
  h.advance(100);
  h.fire("touchmove", moved(8, 0, null));
  assertEq(h.api.pending(), true, "8px 应在 10px 下限内");
  h.advance(220);
  assertEq(h.log.fired, 1, "无半径回退路径应可触发");
});

test("10b. 触点不报半径时 12px 位移 → 超出 10px 下限，取消", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers(null));
  h.advance(100);
  h.fire("touchmove", moved(12, 0, null));
  assertEq(h.api.pending(), false, "12px 应超出 10px 下限");
  h.advance(1000);
  assertEq(h.log.fired, 0, "取消后不得触发");
});

test("11. 状态循环：翻译进行中 → stopTranslation + 「已停止翻译」", function () {
  const h = createHarness({ busy: true });
  h.fire("touchstart", fourFingers());
  h.advance(320);
  assertEq(h.log.stopped, 1, "应停止翻译");
  assertEq(h.log.fired, 0, "不应开始翻译");
  assertEq(h.log.toasts[0], "已停止翻译", "toast 文案应保持");
});

test("12. 状态循环：已有译文 → restorePage + 「已恢复原文」", function () {
  const h = createHarness({ appActive: true });
  h.fire("touchstart", fourFingers());
  h.advance(320);
  assertEq(h.log.restored, 1, "应恢复原文");
  assertEq(h.log.fired, 0, "不应开始翻译");
  assertEq(h.log.toasts[0], "已恢复原文", "toast 文案应保持");
});

test("13. 状态循环：配置无效 → openSettings + 状态提示，不开翻译", function () {
  const h = createHarness({ invalidConfig: true });
  h.fire("touchstart", fourFingers());
  h.advance(320);
  assertEq(h.log.openedSettings, 1, "应打开设置");
  assertEq(h.log.fired, 0, "不应开始翻译");
  assertEq(h.log.toasts[0], "status:配置不完整", "应提示校验失败原因");
});

test("14. 设置面板打开时按四指 → 不触发", function () {
  const h = createHarness({ settingsOpen: true });
  h.fire("touchstart", fourFingers());
  h.advance(1000);
  assertEq(h.log.fired, 0, "面板内不应触发");
});

test("15. 长按途中抬起一指（touchend 剩 3 指）→ 不触发", function () {
  const h = createHarness();
  h.fire("touchstart", fourFingers());
  h.advance(100);
  h.fire("touchend", fourFingers().slice(1));
  assertEq(h.api.pending(), false, "掉到 3 指应取消");
  h.advance(1000);
  assertEq(h.log.fired, 0, "取消后不得触发");
});

test("16. gestureFingers=2：2 指按压 → 会触发（超出指数的第 3 指不取消，同第 7 条语义）", function () {
  const h = createHarness({ fingers: 2 });
  h.fire("touchstart", [finger(0)]);
  h.advance(100);
  h.fire("touchstart", [finger(0), finger(1)]);
  assertEq(h.api.pending(), true, "凑满 2 指应启动计时");
  h.advance(100);
  h.fire("touchstart", [finger(0), finger(1), finger(2)]);
  assertEq(h.api.pending(), true, "第 3 指不参与也不得取消");
  h.advance(219);
  h.advance(1);
  assertEq(h.log.fired, 1, "凑满 2 指满 320ms 应触发");
});

test("17. 未凑满指数不触发：gestureFingers=2 时单指；gestureFingers=3 时 2 指", function () {
  const h2 = createHarness({ fingers: 2 });
  h2.fire("touchstart", [finger(0)]);
  h2.advance(1000);
  assertEq(h2.log.fired, 0, "双指档位下单指按压不得触发");

  const h3 = createHarness({ fingers: 3 });
  h3.fire("touchstart", [finger(0)]);
  h3.advance(100);
  h3.fire("touchstart", [finger(0), finger(1)]);
  h3.advance(1000);
  assertEq(h3.api.pending(), false, "三指档位下 2 指不该启动计时");
  assertEq(h3.log.fired, 0, "三指档位下 2 指不得触发");
});

test("18. gestureFingers=8（非法值）→ 回退四指，4 指可触发、3 指不触发", function () {
  const h = createHarness({ fingers: 8 });
  h.fire("touchstart", fourFingers().slice(0, 3));
  h.advance(1000);
  assertEq(h.log.fired, 0, "回退四指后 3 指不得触发");
  h.fire("touchend", []);
  h.advance(100);
  h.fire("touchstart", fourFingers());
  h.advance(320);
  assertEq(h.log.fired, 1, "回退四指后 4 指应照常触发");
});

test("19. gestureFingers=3：3 指触发；第 4 指不参与也不取消", function () {
  const h = createHarness({ fingers: 3 });
  const three = fourFingers().slice(0, 3);
  h.fire("touchstart", three);
  h.advance(50);
  h.fire("touchstart", three.concat([touch(9, 600, 800, 20)]));
  h.advance(50);
  h.fire("touchmove", moved(0, 0).slice(0, 3).concat([touch(9, 900, 1000, 20)]));
  assertEq(h.api.pending(), true, "第 4 指及其位移不参与判定，不该取消");
  h.advance(219);
  assertEq(h.log.fired, 0, "计时不得被第 4 指重置");
  h.advance(1);
  assertEq(h.log.fired, 1, "三指档位下凑满 3 指应照常触发");
});

/* -------------------------------------------------------------------- 输出 */

const probe = createHarness();
console.log("源码截取: " + SOURCE_FILE);
console.log("         第 " + blockStartLine + " - " + blockEndLine + " 行（" + blockLineCount + " 行真实代码）");
console.log("阈值: " + JSON.stringify(probe.api.constants));
console.log("");

for (const result of results) {
  console.log((result.ok ? "PASS  " : "FAIL  ") + result.name);
  if (!result.ok) console.log("        " + result.error.message);
}

const failed = results.filter(function (r) { return !r.ok; }).length;
console.log("");
console.log((results.length - failed) + " / " + results.length + " 通过");
process.exit(failed ? 1 : 0);
