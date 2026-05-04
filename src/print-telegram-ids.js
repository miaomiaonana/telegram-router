import fs from "node:fs";
import { TelegramClient } from "./telegram.js";

function readBotToken() {
  const text = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = text
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith("TELEGRAM_BOT_TOKEN="));

  const token = line?.split("=").slice(1).join("=").trim() || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");

  return token;
}

const telegram = new TelegramClient(readBotToken());
let offset = 0;

function topicName(message) {
  return message.reply_to_message?.forum_topic_created?.name || "";
}

function printMessageIds(message) {
  if (!message?.chat?.id) return;

  const topicId = message.message_thread_id || "(main chat / no topic)";
  const name = topicName(message);
  const text = message.text || message.caption || "";

  console.log("");
  console.log("收到一条 Telegram 消息：");
  console.log(`群名称: ${message.chat.title || "(unknown)"}`);
  console.log(`群 ID TELEGRAM_CHAT_ID: ${message.chat.id}`);
  console.log(`Topic ID: ${topicId}`);
  if (name) console.log(`Topic 名称: ${name}`);
  if (text) console.log(`消息内容: ${text.slice(0, 80)}`);
  console.log("把上面的 Topic ID 填到对应配置项里。");
}

async function main() {
  console.log("正在等待 Telegram 消息...");
  console.log("请在来源 topic、美股 topic、交易 topic、总结 topic 各发一条测试消息。");
  console.log("看到需要的 ID 后，可以按 Ctrl+C 停止。");

  while (true) {
    const updates = await telegram.getUpdates(offset);

    for (const update of updates) {
      offset = update.update_id + 1;
      printMessageIds(update.message || update.edited_message);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
