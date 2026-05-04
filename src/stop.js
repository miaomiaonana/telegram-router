import fs from "node:fs";

const pidFile = ".telegram-router.pid";

if (!fs.existsSync(pidFile)) {
  console.log("没有找到正在运行的服务 PID 文件。");
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
  console.log(`已发送停止信号给服务进程 ${pid}。`);
} catch (error) {
  fs.rmSync(pidFile, { force: true });
  console.log(`服务进程 ${pid} 已不存在或无法停止，PID 文件已清理。`);
}
