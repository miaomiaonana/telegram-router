import { config } from "./config.js";
import fs from "node:fs";
import { TelegramClient } from "./telegram.js";
import { escapeHtml, messageText, summarizeMessages } from "./summarizer.js";

const pidFile = ".telegram-router.pid";
const telegram = new TelegramClient(config.telegramBotToken);
const messageHistory = [];
let offset = 0;
let lastPeriodicSummaryAt = Date.now();

fs.writeFileSync(pidFile, String(process.pid));

function isConfiguredChat(message) {
  return String(message.chat.id) === String(config.chatId);
}

function messageTopicId(message) {
  return message.message_thread_id ? String(message.message_thread_id) : "";
}

function targetTopicIds() {
  return new Set(
    [
      config.stockTopicId,
      config.tradingTopicId,
      config.summaryTopicId,
      config.watchTopicId,
      config.valueTopicId,
    ]
      .filter(Boolean)
      .map(String),
  );
}

function isExcludedTopic(message) {
  return targetTopicIds().has(messageTopicId(message));
}

function isSourceTopic(message) {
  if (!isConfiguredChat(message)) return false;
  if (config.sourceTopicIds.length === 0) {
    return !isExcludedTopic(message);
  }

  return config.sourceTopicIds.includes(messageTopicId(message)) && !isExcludedTopic(message);
}

function isSummaryCommand(message) {
  const text = messageText(message).trim();
  return config.summaryCommandAliases.some(
    (command) => text === command || text.startsWith(`${command} `),
  );
}

function rememberMessage(message) {
  if (!messageText(message)) return;
  if (isSummaryCommand(message)) return;

  messageHistory.push(message);

  const cutoff = Date.now() - config.summaryHistoryHours * 60 * 60 * 1000;
  while (messageHistory.length > 0 && messageHistory[0].date * 1000 < cutoff) {
    messageHistory.shift();
  }
}

function matchingTopicIds(message) {
  const text = messageText(message);
  const topicIds = config.routingRules
    .filter((rule) => rule.topicId && (rule.pattern?.test(text) || text.includes(rule.marker)))
    .map((rule) => rule.topicId);

  return [...new Set(topicIds)];
}

async function handleMessage(message) {
  if (!message?.chat?.id) return;

  const senderType = message.from?.is_bot ? "bot" : "user";
  const senderName = message.from?.username || message.from?.first_name || "unknown";
  const preview = messageText(message).replace(/\s+/g, " ").slice(0, 100);
  console.log(
    `Received ${senderType} message ${message.message_id} from ${senderName} in topic ${messageTopicId(message) || "general"}: ${preview}`,
  );

  if (isConfiguredChat(message) && isExcludedTopic(message)) return;

  if (isSummaryCommand(message) && isConfiguredChat(message)) {
    await sendWindowSummary(config.summaryCommandHours);
    return;
  }

  if (!isSourceTopic(message)) return;

  rememberMessage(message);

  const topicIds = matchingTopicIds(message);
  if (topicIds.length === 0) {
    console.log(`No route matched for message ${message.message_id} in topic ${messageTopicId(message) || "general"}.`);
    return;
  }

  for (const topicId of topicIds) {
    await telegram.copyMessage({
      fromChatId: message.chat.id,
      messageId: message.message_id,
      targetChatId: config.chatId,
      topicId,
    });
    console.log(`Copied message ${message.message_id} to topic ${topicId}.`);
  }
}

function messagesSince(timestamp) {
  return messageHistory.filter((message) => message.date * 1000 >= timestamp);
}

async function sendSummary(messages, title, { sendEmpty = false } = {}) {
  if (messages.length === 0) {
    if (!sendEmpty) return;

    await telegram.sendMessage({
      targetChatId: config.chatId,
      topicId: config.summaryTopicId,
      text: `<b>${escapeHtml(title)}</b>\n\n没有找到可整理的信息。`,
    });
    return;
  }

  const summary = await summarizeMessages(messages, config, title);
  if (!summary) return;

  await telegram.sendMessage({
    targetChatId: config.chatId,
    topicId: config.summaryTopicId,
    text: summary,
  });
}

async function sendPeriodicSummary() {
  const now = Date.now();
  const messages = messagesSince(lastPeriodicSummaryAt);
  lastPeriodicSummaryAt = now;

  try {
    await sendSummary(messages, "过去4小时群消息整理");
  } catch (error) {
    console.error("Failed to send periodic summary:", error.message);
  }
}

async function sendWindowSummary(hours) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  const messages = messagesSince(since);

  try {
    await sendSummary(messages, `过去${hours}小时群消息整理`, { sendEmpty: true });
  } catch (error) {
    console.error("Failed to send command summary:", error.message);
  }
}

async function pollForever() {
  console.log("Telegram topic router is running.");

  setInterval(
    () => {
      sendPeriodicSummary().catch((error) => {
        console.error("Summary interval failed:", error.message);
      });
    },
    config.summaryIntervalMinutes * 60 * 1000,
  );

  while (true) {
    try {
      const updates = await telegram.getUpdates(offset);

      for (const update of updates) {
        offset = update.update_id + 1;
        const message = update.message || update.edited_message;

        try {
          await handleMessage(message);
        } catch (error) {
          console.error("Failed to handle message:", error.message);
        }
      }
    } catch (error) {
      console.error("Polling failed:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

process.on("SIGINT", async () => {
  console.log("Stopping...");
  fs.rmSync(pidFile, { force: true });
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Stopping...");
  fs.rmSync(pidFile, { force: true });
  process.exit(0);
});

pollForever().catch((error) => {
  console.error(escapeHtml(error.message));
  process.exit(1);
});
