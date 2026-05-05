import fs from "node:fs";
import { TelegramClient as UserTelegramClient } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "./config.js";
import {
  buildAlertMessage,
  buildTechnicalSummary,
  evaluateAlerts,
  getTokenMetrics,
} from "./market-data.js";
import { TelegramClient as BotTelegramClient } from "./telegram.js";
import { escapeHtml } from "./summarizer.js";
import { WatchlistStore } from "./watchlist.js";

const pidFile = ".meme-watch.pid";

if (!config.telegramApiId || !config.telegramApiHash || !config.telegramUserSession) {
  throw new Error(
    "Please set TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_USER_SESSION in .env.",
  );
}

if (!config.watchTopicId) {
  throw new Error("Please set WATCH_TOPIC_ID in .env.");
}

const userClient = new UserTelegramClient(
  new StringSession(config.telegramUserSession),
  config.telegramApiId,
  config.telegramApiHash,
  { connectionRetries: 5 },
);
const botClient = new BotTelegramClient(config.telegramBotToken);
const watchlist = new WatchlistStore(config.watchlistFile);
const alertState = new WatchlistStore(config.alertStateFile);

fs.writeFileSync(pidFile, String(process.pid));

function userMessageText(message) {
  return message.message || "";
}

function messageChatId(event) {
  return String(event.chatId || "");
}

function messageTopicId(message) {
  const replyTo = message.replyTo;
  return String(replyTo?.replyToTopId || replyTo?.replyToMsgId || "");
}

function isWatchTopic(event, message) {
  return messageChatId(event) === String(config.chatId) && messageTopicId(message) === String(config.watchTopicId);
}

function parseWatchCommand(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/?([a-zA-Z\u4e00-\u9fa5]+)(?:\s+(.+))?$/);
  if (!match) return null;

  const command = match[1].toLowerCase();
  const arg = (match[2] || "").trim().split(/\s+/)[0] || "";

  if (["add", "添加", "监控"].includes(command)) return { type: "add", arg };
  if (["remove", "rm", "delete", "删除", "取消"].includes(command)) return { type: "remove", arg };
  if (["list", "watchlist", "列表", "查看"].includes(command)) return { type: "list", arg };
  if (["ta", "analysis", "analyze", "分析", "指标"].includes(command)) {
    return { type: "analysis", arg };
  }
  if (["help", "帮助"].includes(command)) return { type: "help", arg };

  return null;
}

async function reply(text) {
  await botClient.sendMessage({
    targetChatId: config.chatId,
    topicId: config.watchTopicId,
    text,
  });
}

function helpText() {
  return [
    "<b>妖币监控指令</b>",
    "",
    "<code>/add BTC</code> 添加监控标的",
    "<code>/remove BTC</code> 删除监控标的",
    "<code>/watchlist</code> 查看监控列表",
    "<code>/ta BTC</code> 查看当前指标",
    "",
    "中文也可以：添加 BTC、删除 BTC、列表、分析 BTC",
  ].join("\n");
}

async function handleWatchCommand(message) {
  const parsed = parseWatchCommand(userMessageText(message));
  if (!parsed) return;

  if (parsed.type === "help") {
    await reply(helpText());
    return;
  }

  if (parsed.type === "list") {
    const symbols = watchlist.list();
    await reply(
      symbols.length
        ? `<b>当前监控标的：</b>\n${symbols.map((item) => `- ${escapeHtml(item)}`).join("\n")}`
        : "当前没有监控标的。用 /add BTC 添加。",
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
        ? `已添加监控：<b>${escapeHtml(result.symbol)}</b>`
        : `已在监控列表：<b>${escapeHtml(result.symbol)}</b>`,
    );
    return;
  }

  if (parsed.type === "remove") {
    const result = watchlist.remove(parsed.arg);
    await reply(
      result.changed
        ? `已删除监控：<b>${escapeHtml(result.symbol)}</b>`
        : `未找到监控标的：<b>${escapeHtml(result.symbol)}</b>`,
    );
    return;
  }

  if (parsed.type === "analysis") {
    await reply(`正在获取 <b>${escapeHtml(parsed.arg.toUpperCase())}</b> 指标...`);
    try {
      await reply(await buildTechnicalSummary(parsed.arg, { profile: "meme" }));
    } catch (error) {
      await reply(`获取指标失败：${escapeHtml(error.message)}`);
    }
  }
}

function alertKey(symbol, type) {
  if (type === "daily_close_above_ema200") {
    const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    return `${symbol}:${type}:${bucket}`;
  }

  if (type.startsWith("supertrend_1h_")) {
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    return `${symbol}:${type}:${bucket}`;
  }

  const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
  return `${symbol}:${type}:${bucket}`;
}

async function scanWatchlistAlerts() {
  const symbols = watchlist.list();
  if (symbols.length === 0) return;

  const sent = new Set(alertState.list());

  for (const symbol of symbols) {
    try {
      const metrics = await getTokenMetrics(symbol, { profile: "meme" });
      const alerts = evaluateAlerts(metrics);

      for (const alert of alerts) {
        const key = alertKey(symbol, alert.type);
        if (sent.has(key)) continue;

        await reply(buildAlertMessage(metrics, alert));
        sent.add(key);
      }
    } catch (error) {
      console.error(`Watchlist scan failed for ${symbol}: ${error.message}`);
    }
  }

  alertState.save([...sent].slice(-500));
}

async function handleEvent(event) {
  const message = event.message;
  if (!message) return;

  if (messageChatId(event) === String(config.chatId)) {
    console.log(
      `Watch diagnostic: chat ${messageChatId(event)} topic ${messageTopicId(message) || "general"} text ${userMessageText(message).slice(0, 80)}`,
    );
  }

  if (!isWatchTopic(event, message)) return;

  console.log(`Watch topic message ${message.id}: ${userMessageText(message).slice(0, 80)}`);
  await handleWatchCommand(message);
}

await userClient.connect();
console.log("Meme watch service is running.");

userClient.addEventHandler((event) => {
  handleEvent(event).catch((error) => console.error(`Failed to handle watch event: ${error.message}`));
}, new NewMessage({}));

setInterval(() => {
  scanWatchlistAlerts().catch((error) =>
    console.error(`Failed to scan watchlist alerts: ${error.message}`),
  );
}, config.watchMonitorIntervalMinutes * 60 * 1000);

function stop() {
  fs.rmSync(pidFile, { force: true });
  userClient.disconnect();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
