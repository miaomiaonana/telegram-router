import fs from "node:fs";

const pidFile = ".value-watch-bot.pid";

if (!fs.existsSync(pidFile)) {
  console.log("没有找到正在运行的价值币沉淀 Bot PID 文件。");
  process.exit(0);
}

const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8"), 10);
if (!pid) {
  fs.rmSync(pidFile, { force: true });
  console.log("PID 文件无效，已清理。");
  process.exit(0);
}

try {
  process.kill(pid, "SIGTERM");
  fs.rmSync(pidFile, { force: true });
  console.log(`已发送停止信号给价值币沉淀 Bot 进程 ${pid}。`);
} catch {
  fs.rmSync(pidFile, { force: true });
  console.log(`价值币沉淀 Bot 进程 ${pid} 已不存在或无法停止，PID 文件已清理。`);
}
