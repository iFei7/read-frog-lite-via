// 从真实源码中截取配置层，模拟 Via GM 存储，测试 showDock 的保存/重载/恢复全链路
const fs = require("fs");
const vm = require("vm");
const path = "C:/Users/hwx1254427/WorkBuddy/2026-09-30-12-03-47/read-frog-lite-via.custom.user.js";
const src = fs.readFileSync(path, "utf8");

// 截取 CONFIG_KEY 到 var config = migrateConfig(); 之间的真实代码
const start = src.indexOf("var CONFIG_KEY = {") >= 0 ? src.indexOf("var CONFIG_KEY = {") : src.indexOf("var CONFIG_KEY = ");
const end = src.indexOf("var config = migrateConfig();") + "var config = migrateConfig();".length;
if (start < 0 || end < start) { console.error("SLICE FAILED"); process.exit(1); }
const code = src.slice(start, end);

// 模拟 Via 脚本存储（跨"页面加载"共享）
const store = {};
function makeContext(name) {
  const ctx = {
    GM_getValue: (k, f) => (k in store ? JSON.parse(JSON.stringify(store[k])) : f), // 模拟序列化往返
    GM_setValue: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: name });
  return ctx;
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log((ok ? "✅" : "❌") + " " + name + " → " + JSON.stringify(actual) + (ok ? "" : "（期望 " + JSON.stringify(expected) + "）"));
}

// ── 第 1 次加载：默认配置 ──
const ctx1 = makeContext("load1");
check("首次加载 showDock 默认值", ctx1.config.showDock, true);

// ── 模拟设置面板保存（readForm 返回合并对象 → saveConfig）──
ctx1.__saved = ctx1.normalizeConfig(Object.assign({}, ctx1.config, { showDock: false }));
ctx1.config = ctx1.__saved; ctx1.GM_setValue("read_frog_via_config_v2", ctx1.config);
check("保存后内存中 showDock", ctx1.config.showDock, false);
check("存储中 showDock", store["read_frog_via_config_v2"].showDock, false);

// ── 第 2 次加载（新页面）：migrateConfig 应恢复 false ──
const ctx2 = makeContext("load2");
check("重载后 showDock 恢复为 false", ctx2.config.showDock, false);

// ── 部分保存（改显示模式）不丢 showDock ──
ctx2.config = ctx2.normalizeConfig(Object.assign({}, ctx2.config, { mode: "bilingual" }));
ctx2.GM_setValue("read_frog_via_config_v2", ctx2.config);
check("仅改 mode 后 showDock 保持 false", ctx2.config.showDock, false);

// ── 模拟 Via 菜单切换：false → true ──
ctx2.config = ctx2.normalizeConfig(Object.assign({}, ctx2.config, { showDock: !ctx2.config.showDock }));
ctx2.GM_setValue("read_frog_via_config_v2", ctx2.config);
check("菜单切换后 showDock", ctx2.config.showDock, true);

// ── 第 3 次加载 ──
const ctx3 = makeContext("load3");
check("再次重载 showDock 为 true", ctx3.config.showDock, true);

// ── 边界：旧版本配置（无 showDock 字段）迁移 ──
store["read_frog_via_config_v2"] = { schemaVersion: 2, service: "microsoft", mode: "translation" };
const ctx4 = makeContext("load4");
check("旧配置迁移后 showDock", ctx4.config.showDock, true);

// ── 边界：若存储层把布尔变成字符串 "false" ──
console.log("ℹ️  字符串 \"false\" 归一化结果 → " + JSON.stringify(ctx4.normalizeConfig({ showDock: "false" }).showDock) + "（Via 正常序列化不会出现，仅极端兼容场景）");

// ── 手势指数 gestureFingers：默认 4、保存 2 后重载仍为 2 ──
const ctx5 = makeContext("load5");
check("首次加载 gestureFingers 默认值", ctx5.config.gestureFingers, 4);
ctx5.config = ctx5.normalizeConfig(Object.assign({}, ctx5.config, { gestureFingers: 2 }));
ctx5.GM_setValue("read_frog_via_config_v2", ctx5.config);
check("保存后存储中 gestureFingers", store["read_frog_via_config_v2"].gestureFingers, 2);
const ctx6 = makeContext("load6");
check("重载后 gestureFingers 恢复为 2", ctx6.config.gestureFingers, 2);
check("非法值 8 归一化回退为 4", ctx6.normalizeConfig({ gestureFingers: 8 }).gestureFingers, 4);
check("旧配置（无 gestureFingers）迁移后为 4", ctx6.normalizeConfig({ mode: "translation" }).gestureFingers, 4);

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
