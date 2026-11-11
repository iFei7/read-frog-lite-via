// 固定更新链接守卫（v1.4.2）：读源码与发布页文本做断言，不需要 DOM 桩。
// 覆盖：头部 @updateURL/@downloadURL、版本号、release.cjs 固定名副本逻辑、
// index.html 固定链接；固定名文件若已生成则比对与 src 逐字节一致（未生成则跳过）。
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC_FILE = path.join(ROOT, "src", "read-frog-lite-via.user.js");
const RELEASE_FILE = path.join(ROOT, "scripts", "release.cjs");
const INDEX_FILE = path.join(ROOT, "rfvia-publish", "index.html");
const FIXED_JS = path.join(ROOT, "rfvia-publish", "read-frog-lite-via.user.js");
const FIXED_TXT = path.join(ROOT, "rfvia-publish", "read-frog-lite-via.txt");
const FIXED_URL = "https://read-frog-via-custom.app.workbuddy.host/read-frog-lite-via.user.js";

const src = fs.readFileSync(SRC_FILE, "utf8");
const releaseSrc = fs.readFileSync(RELEASE_FILE, "utf8");
const html = fs.readFileSync(INDEX_FILE, "utf8");

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log((ok ? "✅" : "❌") + " " + name + " → " + JSON.stringify(actual) + (ok ? "" : "（期望 " + JSON.stringify(expected) + "）"));
}

// ── 头部元信息 ──
const updateLine = (src.match(/^\/\/\s*@updateURL\s+(\S+)\s*$/m) || [])[1];
const downloadLine = (src.match(/^\/\/\s*@downloadURL\s+(\S+)\s*$/m) || [])[1];
check("存在 @updateURL", Boolean(updateLine), true);
check("存在 @downloadURL", Boolean(downloadLine), true);
check("@updateURL 为固定链接（不带版本号）", updateLine, FIXED_URL);
check("@downloadURL 为固定链接（不带版本号）", downloadLine, FIXED_URL);
check("@updateURL/@downloadURL 位于 @grant 之前", src.indexOf("@updateURL") < src.indexOf("@grant") && src.indexOf("@downloadURL") < src.indexOf("@grant"), true);

// ── 版本号 ──
const headerVersion = (src.match(/^\/\/\s*@version\s+(\d+\.\d+\.\d+)\s*$/m) || [])[1];
const varVersion = (src.match(/var VERSION = "(\d+\.\d+\.\d+)"/) || [])[1];
check("@version 为 1.4.2", headerVersion, "1.4.2");
check("var VERSION 与 @version 一致", varVersion, headerVersion);
check("头部注释含 v1.4.2 段", src.includes("Local modifications (v1.4.2)"), true);

// ── release.cjs 固定名副本逻辑 ──
check("release.cjs 含固定名 .user.js 写入", releaseSrc.includes('PUBLISH_DIR, "read-frog-lite-via.user.js")'), true);
check("release.cjs 含固定名 .txt 写入", releaseSrc.includes('PUBLISH_DIR, "read-frog-lite-via.txt")'), true);

// ── index.html 固定链接 ──
const dlHref = (html.match(/class="dl"\s+href="([^"]+)"/) || [])[1];
const rawHrefs = (html.match(/class="raw"\s+href="([^"]+)"/g) || []).map(function (s) { return (s.match(/href="([^"]+)"/) || [])[1]; });
check(".dl 按钮指向固定 .user.js", dlHref, "read-frog-lite-via.user.js");
check(".raw 直链第一条指向固定 .user.js", rawHrefs[0], "read-frog-lite-via.user.js");
check(".raw 第二条指向固定 .txt", rawHrefs[1], "read-frog-lite-via.txt");
check("页面无带版本号链接（href 不含 v1.4.）", /href="[^"]*v1\.4\./.test(html), false);
check(".note 含固定链接升级说明", html.includes("下载链接固定不变"), true);

// ── 固定名副本与 src 一致（未跑 release 时跳过，不视为失败） ──
if (fs.existsSync(FIXED_JS)) {
  check("固定名 .user.js 与 src 逐字节一致", fs.readFileSync(FIXED_JS).equals(fs.readFileSync(SRC_FILE)), true);
  if (fs.existsSync(FIXED_TXT)) {
    check("固定名 .txt 与 src（LF 归一）一致", fs.readFileSync(FIXED_TXT, "utf8") === src.replace(/\r\n/g, "\n"), true);
  } else {
    check("固定名 .txt 未生成（跳过，请先 npm run release）", "skip", "skip");
  }
} else {
  check("固定名 .user.js 未生成（跳过，请先 npm run release）", "skip", "skip");
}

console.log("");
console.log("结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
