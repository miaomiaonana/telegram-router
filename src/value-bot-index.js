import fs from "node:fs";
import { config } from "./config.js";
import { buildTechnicalSummary } from "./market-data.js";
import { TelegramClient } from "./telegram.js";
import { escapeHtml, messageText } from "./summarizer.js";
import { WatchlistStore } from "./watchlist.js";

const pidFile = ".value-watch-bot.pid";

if (!config.valueTopicId) {
  throw new Error("Please set VALUE_TOPIC_ID in .env.");
}

const botClient = new TelegramClient(config.telegramBotToken);
const watchlist = new WatchlistStore(config.valueWatchlistFile);
let offset = 0;

fs.writeFileSync(pidFile, String(process.pid));

function isValueTopic(message) {
  return (
    String(message?.chat?.id) === String(config.chatId) &&
    String(message?.message_thread_id || "") === String(config.valueTopicId)
  );
}

function parseValueCommand(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/?([a-zA-Z\u4e00-\u9fa5]+)(?:\s+(.+))?$/);
  if (!match) return null;

  const command = match[1].toLowerCase();
  const arg = (match[2] || "").trim().split(/\s+/)[0] || "";

  if (["add", "添加", "监控"].includes(command)) return { type: "add", arg };
  if (["remove", "rm", "delete", "删除", "取消"].includes(command)) return { type: "remove", arg };
  if (["list", "watchlist", "列表", "查看"].includes(command)) return { type: "list", arg };
  if (["ta", "analysis", "analyze", "分析", "指标"].includes(command)) return { type: "analysis", arg };
  if (["help", "帮助"].includes(command)) return { type: "help", arg };

  return null;
}

async function reply(text) {
  await botClient.sendMessage({
    targetChatId: config.chatId,
    topicId: config.valueTopicId,
    text,
  });
}

function helpText() {
  return [
    "<b>价值币沉淀指令</b>",
    "",
    "<code>/add BTC</code> 添加沉淀标的",
    "<code>/remove BTC</code> 删除沉淀标的",
    "<code>/watchlist</code> 查看沉淀列表",
    "<code>/ta BTC</code> 查看 4h / 1d 指标",
    "",
    "中文也可以：添加 BTC、删除 BTC、列表、分析 BTC",
  ].join("\n");
}

async function handleMessage(message) {
  if (!isValueTopic(message)) return;

  const text = messageText(message);
  console.log(`Value bot message ${message.message_id}: ${text.slice(0, 80)}`);
  const parsed = parseValueCommand(text);
  if (!parsed) return;

  if (parsed.type === "help") {
    await reply(helpText());
    return;
  }

  if (parsed.type === "list") {
    const symbols = watchlist.list();
    await reply(
      symbols.length
        ? `<b>当前沉淀标的：</b>\n${symbols.map((item) => `- ${escapeHtml(item)}`).join("\n")}`
        : "当前没有沉淀标的。用 /add BTC 添加。",
    );
    return;
  }

  if (!parsed.arg) {
    await reply("请带上标的，例如：/add BTC 或 /ta BTC");
    return;
  }

  if (parsed.type === "add") {
    const result = watchlist.add(parsed.arg);
    await reply(
      result.changed
        ? `已添加沉淀：<b>${escapeHtml(result.symbol)}</b>`
        : `已在沉淀列表：<b>${escapeHtml(result.symbol)}</b>`,
    );
    return;
  }

  if (parsed.type === "remove") {
    const result = watchlist.remove(parsed.arg);
    await reply(
      result.changed
        ? `已删除沉淀：<b>${escapeHtml(result.symbol)}</b>`
        : `未找到沉淀标的：<b>${escapeHtml(result.symbol)}</b>`,
    );
    return;
  }

  if (parsed.type === "analysis") {
    await reply(`正在获取 <b>${escapeHtml(parsed.arg.toUpperCase())}</b> 价值币指标...`);
    try {
      await reply(await buildTechnicalSummary(parsed.arg, { profile: "value" }));
    } catch (error) {
      await reply(`获取指标失败：${escapeHtml(error.message)}`);
    }
  }
}

async function pollForever() {
  console.log("Value watch bot service is running.");

  while (true) {
    try {
      const updates = await botClient.getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleMessage(update.message || update.edited_message);
      }
    } catch (error) {
      console.error(`Value bot polling failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

function stop() {
  fs.rmSync(pidFile, { force: true });
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

pollForever().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
