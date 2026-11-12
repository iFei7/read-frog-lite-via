// 赞助页源码守卫（v1.4.3）：读 src 源文本做断言，不需要 DOM 桩。
// 二维码一致性校验依赖源 JPEG（仓库外剪贴板图片路径写死，仅本机测试可用；
// 该图 21917 字节，md5 3817596ebb592282b9b9d3e20a8931fb，已内嵌进脚本，
// 源图缺失时跳过该项，不视为失败）。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SOURCE_FILE = path.join(__dirname, "..", "src", "read-frog-lite-via.user.js");
const QR_SOURCE_FILE = "C:/Users/hwx1254427/.workbuddy/clipboard-images/clipboard-2026-11-11T01-10-38-261Z-31f2be50.jpg";
const src = fs.readFileSync(SOURCE_FILE, "utf8");

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log((ok ? "✅" : "❌") + " " + name + " → " + JSON.stringify(actual) + (ok ? "" : "（期望 " + JSON.stringify(expected) + "）"));
}

// ── 函数与常量 ──
check("存在 function openSponsor", src.includes("function openSponsor"), true);
check("存在 function closeSponsor", src.includes("function closeSponsor"), true);
check("存在 var SPONSOR_QR_DATA_URI", src.includes("var SPONSOR_QR_DATA_URI"), true);

// ── data URI 前缀与解码一致性 ──
const arrayMatch = src.match(/var SPONSOR_QR_DATA_URI = \[([\s\S]*?)\]\.join\(""\)/);
const dataUri = arrayMatch ? eval("[" + arrayMatch[1] + "]").join("") : "";
check("data URI 前缀为 data:image/jpeg;base64,", dataUri.slice(0, 23), "data:image/jpeg;base64,");
// 解码校验需剥掉 data URI 头部，只对 base64 载荷解码
const decoded = Buffer.from(dataUri.slice(23), "base64");
check("解码后字节数为 21917", decoded.length, 21917);
if (fs.existsSync(QR_SOURCE_FILE)) {
  const sourceMd5 = crypto.createHash("md5").update(fs.readFileSync(QR_SOURCE_FILE)).digest("hex");
  const decodedMd5 = crypto.createHash("md5").update(decoded).digest("hex");
  check("解码 md5 与源 JPEG md5 一致", decodedMd5, sourceMd5);
} else {
  check("解码 md5（源图缺失，退化为内嵌注释值）", crypto.createHash("md5").update(decoded).digest("hex"), "3817596ebb592282b9b9d3e20a8931fb");
}

// ── HTML 模板与交互 ──
check("HTML 模板含 id=\"sponsor-qr\"", src.includes('id="sponsor-qr"'), true);
check("面板 role=\"dialog\"", src.includes('role="dialog"'), true);
check("面板 aria-modal=\"true\"", src.includes('aria-modal="true"'), true);
check("二维码用 .src 赋值（不走 innerHTML）", /sponsorQr\.src = SPONSOR_QR_DATA_URI/.test(src), true);
check("菜单注册含 赞助作者", src.includes('GM_registerMenuCommand("赞助作者 ☕", openSponsor)'), true);
check("Esc 关闭仅在面板打开时生效", src.includes('if (!sponsorPanel.classList.contains("open")) return;'), true);

// ── CSS 作用域：新增样式选择器含 #rf-via-host，不得出现裸 .sponsor{ ──
check("新增样式选择器含 #rf-via-host .sponsor", src.includes("#rf-via-host .sponsor"), true);
check("不得出现裸 .sponsor{（无 #rf-via-host 前缀的规则起点）", /(^|[}\s;])\.sponsor\s*\{/.test(src), false);

// ── 版本号 ──
const headerVersion = (src.match(/^\/\/\s*@version\s+(\d+\.\d+\.\d+)\s*$/m) || [])[1];
const varVersion = (src.match(/var VERSION = "(\d+\.\d+\.\d+)"/) || [])[1];
check("@version 为 1.4.3", headerVersion, "1.4.3");
check("var VERSION 与 @version 一致", varVersion, headerVersion);
check("头部注释含 v1.4.3 段", src.includes("Local modifications (v1.4.3)"), true);

console.log("");
console.log("结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
