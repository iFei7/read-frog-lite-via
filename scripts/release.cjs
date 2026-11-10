"use strict";

/**
 * 零依赖发布脚本（只用 Node 内置模块，不联网、不读写本机以外路径）
 *
 * 流程：
 *   1. 从 src/read-frog-lite-via.user.js 的 // @version 读版本号
 *   2. 复制为 rfvia-publish/read-frog-lite-via-v<ver>.user.js
 *      与同名 .txt（.txt 按仓库一贯做法做 CRLF→LF 归一，便于手机上长按复制）
 *   3. 用正则把 rfvia-publish/index.html 里的标题、.ver 行、
 *      两处 .user.js 链接与 .txt 链接统一到新版本
 *   4. 打印版本号、产物路径、index.html 被改动的行号与内容
 *
 * 幂等：版本未变时重复运行结果完全一致（仅重写同样的字节），
 * 并明确提示「版本未变，仅同步副本」。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE_FILE = path.join(ROOT, "src", "read-frog-lite-via.user.js");
const PUBLISH_DIR = path.join(ROOT, "rfvia-publish");
const INDEX_FILE = path.join(PUBLISH_DIR, "index.html");

// 读源码里的 // @version（形如 "// @version      1.3.8"）
function readSourceVersion(source) {
  var matched = source.match(/^\/\/\s*@version\s+(\d+\.\d+\.\d+)\s*$/m);
  if (!matched) throw new Error("未找到 // @version：" + SOURCE_FILE);
  return matched[1];
}

// 读 index.html 当前对外展示的版本号：优先取 <title> 里的第一个版本号，
// 退而求其次取 .ver 行的第一个版本号（该行后半段「基于上游 vX」必须保持不动）。
function readPublishedVersion(html) {
  var matched = html.match(/<title>[^<]*?v(\d+\.\d+\.\d+)/);
  if (matched) return matched[1];
  matched = html.match(/class="ver"[^<]*?v(\d+\.\d+\.\d+)/);
  return matched ? matched[1] : null;
}

// 逐行改写 index.html，返回新内容与被改动的行（含行号，便于人工核对）
function syncIndexHtml(html, oldVersion, newVersion) {
  var changes = [];
  var lines = html.split("\n");
  var updated = lines.map(function (line, index) {
    var next = line;
    // 标题与 .ver 行：只替换第一个版本号，避免误伤「基于上游 v1.2.1」这类历史说明
    if (/<title>/.test(next) || /class="ver"/.test(next)) {
      next = next.replace("v" + oldVersion, "v" + newVersion);
    }
    // 下载链接与链接文案：.user.js / .txt 的旧文件名全部换成新文件名
    if (oldVersion !== newVersion) {
      next = next.split("read-frog-lite-via-v" + oldVersion + ".user.js").join("read-frog-lite-via-v" + newVersion + ".user.js");
      next = next.split("read-frog-lite-via-v" + oldVersion + ".txt").join("read-frog-lite-via-v" + newVersion + ".txt");
    }
    if (next !== line) changes.push({ line: index + 1, before: line, after: next });
    return next;
  });
  return { html: updated.join("\n"), changes: changes };
}

function main() {
  var source = fs.readFileSync(SOURCE_FILE, "utf8");
  var version = readSourceVersion(source);
  var html = fs.readFileSync(INDEX_FILE, "utf8");
  var publishedVersion = readPublishedVersion(html);
  if (!publishedVersion) {
    console.warn("警告：未能从 index.html 解析旧版本号，跳过页面版本号替换");
  }

  // 1) 生成发布副本
  var userJsPath = path.join(PUBLISH_DIR, "read-frog-lite-via-v" + version + ".user.js");
  var txtPath = path.join(PUBLISH_DIR, "read-frog-lite-via-v" + version + ".txt");
  fs.writeFileSync(userJsPath, source);
  fs.writeFileSync(txtPath, source.replace(/\r\n/g, "\n"));

  // 2) 同步 index.html
  var oldVersion = publishedVersion || version;
  var result = syncIndexHtml(html, oldVersion, version);
  if (result.changes.length) fs.writeFileSync(INDEX_FILE, result.html);

  // 3) 报告
  console.log("版本号: v" + version + (publishedVersion && publishedVersion !== version ? "（页面原为 v" + publishedVersion + "）" : ""));
  console.log("生成: " + path.relative(ROOT, userJsPath));
  console.log("生成: " + path.relative(ROOT, txtPath) + "（纯文本，LF 归一）");
  if (!result.changes.length) {
    console.log("index.html: 无需替换版本号（版本未变，仅同步副本）");
  } else {
    console.log("index.html: 替换 " + result.changes.length + " 行");
    result.changes.forEach(function (item) {
      console.log("  第 " + item.line + " 行: " + item.after.trim());
    });
  }
  if (publishedVersion === version) console.log("提示：版本未变，仅同步副本。");
}

main();
