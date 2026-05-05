import fs from "node:fs";
import { config } from "./config.js";
import {
  buildAlertMessage,
  buildTechnicalSummary,
  buildValueAlertMessage,
  evaluateAlerts,
  evaluateOiMarketCapCross,
  evaluateValueAlerts,
  getTokenMetrics,
} from "./market-data.js";
import { TelegramClient } from "./telegram.js";
import { escapeHtml, messageText } from "./summarizer.js";
import { WatchlistStore } from "./watchlist.js";

const pidFile = ".meme-watch-bot.pid";

if (!config.watchTopicId) {
  throw new Error("Please set WATCH_TOPIC_ID in .env.");
}

const botClient = new TelegramClient(config.telegramBotToken);
const watchlist = new WatchlistStore(config.watchlistFile);
const valueWatchlist = new WatchlistStore(config.valueWatchlistFile);
const alertState = new WatchlistStore(config.alertStateFile);
const valueAlertState = new WatchlistStore(config.valueAlertStateFile);
let offset = 0;

fs.writeFileSync(pidFile, String(process.pid));

function isTopic(message, topicId) {
  return (
    String(message?.chat?.id) === String(config.chatId) &&
    String(message?.message_thread_id || "") === String(topicId)
  );
}

function parseCommand(text) {
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

async function reply(topicId, text) {
  await botClient.sendMessage({
    targetChatId: config.chatId,
    topicId,
    text,
  });
}

function helpText(profile) {
  const isValue = profile === "value";

  return [
    isValue ? "<b>价值币沉淀指令</b>" : "<b>妖币监控指令</b>",
    "",
    `<code>/add BTC</code> 添加${isValue ? "沉淀" : "监控"}标的`,
    `<code>/remove BTC</code> 删除${isValue ? "沉淀" : "监控"}标的`,
    `<code>/watchlist</code> 查看${isValue ? "沉淀" : "监控"}列表`,
    `<code>/ta BTC</code> 查看${isValue ? "4h / 1d" : "当前"}指标`,
    "",
    "中文也可以：添加 BTC、删除 BTC、列表、分析 BTC",
  ].join("\n");
}

async function handleTopicMessage(message, topic) {
  const text = messageText(message);
  console.log(`${topic.logName} message ${message.message_id}: ${text.slice(0, 80)}`);
  const parsed = parseCommand(text);
  if (!parsed) return;

  if (parsed.type === "help") {
    await reply(topic.topicId, helpText(topic.profile));
    return;
  }

  if (parsed.type === "list") {
    const symbols = topic.watchlist.list();
    await reply(
      topic.topicId,
      symbols.length
        ? `<b>当前${topic.itemName}标的：</b>\n${symbols.map((item) => `- ${escapeHtml(item)}`).join("\n")}`
        : `当前没有${topic.itemName}标的。用 /add BTC 添加。`,
    );
    return;
  }

  if (!parsed.arg) {
    await reply(topic.topicId, "请带上标的，例如：/add BTC 或 /ta BTC");
    return;
  }

  if (parsed.type === "add") {
    const result = topic.watchlist.add(parsed.arg);
    await reply(
      topic.topicId,
      result.changed
        ? `已添加${topic.itemName}：<b>${escapeHtml(result.symbol)}</b>`
        : `已在${topic.itemName}列表：<b>${escapeHtml(result.symbol)}</b>`,
    );
    return;
  }

  if (parsed.type === "remove") {
    const result = topic.watchlist.remove(parsed.arg);
    await reply(
      topic.topicId,
      result.changed
        ? `已删除${topic.itemName}：<b>${escapeHtml(result.symbol)}</b>`
        : `未找到${topic.itemName}标的：<b>${escapeHtml(result.symbol)}</b>`,
    );
    return;
  }

  if (parsed.type === "analysis") {
    await reply(topic.topicId, `正在获取 <b>${escapeHtml(parsed.arg.toUpperCase())}</b> 指标...`);
    try {
      await reply(topic.topicId, await buildTechnicalSummary(parsed.arg, { profile: topic.profile }));
    } catch (error) {
      await reply(topic.topicId, `获取指标失败：${escapeHtml(error.message)}`);
    }
  }
}

async function handleMessage(message) {
  if (!message) return;

  if (isTopic(message, config.watchTopicId)) {
    await handleTopicMessage(message, {
      topicId: config.watchTopicId,
      watchlist,
      profile: "meme",
      itemName: "监控",
      logName: "Meme watch bot",
    });
    return;
  }

  if (config.valueTopicId && isTopic(message, config.valueTopicId)) {
    await handleTopicMessage(message, {
      topicId: config.valueTopicId,
      watchlist: valueWatchlist,
      profile: "value",
      itemName: "沉淀",
      logName: "Value watch bot",
    });
  }
}

function alertKey(symbol, type) {
  if (
    type === "daily_close_above_ema200" ||
    type === "daily_close_below_ema200" ||
    type === "value_daily_close_above_ema200" ||
    type === "value_daily_close_below_ema200"
  ) {
    const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    return `${symbol}:${type}:${bucket}`;
  }

  if (type.startsWith("supertrend_1h_")) {
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    return `${symbol}:${type}:${bucket}`;
  }

  if (type.startsWith("value_supertrend_4h_")) {
    const bucket = Math.floor(Date.now() / (4 * 60 * 60 * 1000));
    return `${symbol}:${type}:${bucket}`;
  }

  if (type.startsWith("value_supertrend_1d_")) {
    const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    return `${symbol}:${type}:${bucket}`;
  }

  if (type === "value_oi_build_up_4h" || type === "value_oi_drop_4h") {
    const bucket = Math.floor(Date.now() / (4 * 60 * 60 * 1000));
    return `${symbol}:${type}:${bucket}`;
  }

  const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
  return `${symbol}:${type}:${bucket}`;
}

function oiMarketCapSideKey(symbol, side) {
  return `${symbol}:oi_market_cap_side:${side}`;
}

function previousOiMarketCapSide(sent, symbol) {
  if (sent.has(oiMarketCapSideKey(symbol, "high"))) return "high";
  if (sent.has(oiMarketCapSideKey(symbol, "low"))) return "low";
  return "";
}

function updateOiMarketCapSide(sent, symbol, side) {
  sent.delete(oiMarketCapSideKey(symbol, "high"));
  sent.delete(oiMarketCapSideKey(symbol, "low"));
  if (side) sent.add(oiMarketCapSideKey(symbol, side));
}

async function scanWatchlistAlerts() {
  const symbols = watchlist.list();
  if (symbols.length === 0) return;

  const sent = new Set(alertState.list());

  for (const symbol of symbols) {
    try {
      const metrics = await getTokenMetrics(symbol, { profile: "meme" });
      const alerts = evaluateAlerts(metrics);
      const oiMarketCapCross = evaluateOiMarketCapCross(
        metrics,
        previousOiMarketCapSide(sent, symbol),
      );
      if (oiMarketCapCross.alert) alerts.push(oiMarketCapCross.alert);

      for (const alert of alerts) {
        if (alert.type.startsWith("oi_market_cap_cross_")) {
          await reply(config.watchTopicId, buildAlertMessage(metrics, alert));
          continue;
        }

        const key = alertKey(symbol, alert.type);
        if (sent.has(key)) continue;

        await reply(config.watchTopicId, buildAlertMessage(metrics, alert));
        sent.add(key);
      }

      updateOiMarketCapSide(sent, symbol, oiMarketCapCross.side);
    } catch (error) {
      console.error(`Watchlist scan failed for ${symbol}: ${error.message}`);
    }
  }

  alertState.save([...sent].slice(-500));
}

async function scanValueWatchlistAlerts() {
  if (!config.valueTopicId) return;

  const symbols = valueWatchlist.list();
  if (symbols.length === 0) return;

  const sent = new Set(valueAlertState.list());

  for (const symbol of symbols) {
    try {
      const metrics = await getTokenMetrics(symbol, { profile: "value" });
      const alerts = evaluateValueAlerts(metrics);

      for (const alert of alerts) {
        const key = alertKey(symbol, alert.type);
        if (sent.has(key)) continue;

        await reply(config.valueTopicId, buildValueAlertMessage(metrics, alert));
        sent.add(key);
      }
    } catch (error) {
      console.error(`Value watchlist scan failed for ${symbol}: ${error.message}`);
    }
  }

  valueAlertState.save([...sent].slice(-500));
}

async function pollForever() {
  console.log("Market topic bot service is running.");

  setInterval(() => {
    scanWatchlistAlerts().catch((error) =>
      console.error(`Failed to scan watchlist alerts: ${error.message}`),
    );
  }, config.watchMonitorIntervalMinutes * 60 * 1000);

  setInterval(() => {
    scanValueWatchlistAlerts().catch((error) =>
      console.error(`Failed to scan value watchlist alerts: ${error.message}`),
    );
  }, config.watchMonitorIntervalMinutes * 60 * 1000);

  while (true) {
    try {
      const updates = await botClient.getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleMessage(update.message || update.edited_message);
      }
    } catch (error) {
      console.error(`Watch bot polling failed: ${error.message}`);
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
