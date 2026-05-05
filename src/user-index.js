import fs from "node:fs";
import { TelegramClient as UserTelegramClient } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "./config.js";
import { TelegramClient as BotTelegramClient } from "./telegram.js";
import { escapeHtml, messageText, summarizeMessages } from "./summarizer.js";

const pidFile = ".telegram-user-router.pid";

if (!config.telegramApiId || !config.telegramApiHash || !config.telegramUserSession) {
  throw new Error(
    "Please set TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_USER_SESSION in .env.",
  );
}

const userClient = new UserTelegramClient(
  new StringSession(config.telegramUserSession),
  config.telegramApiId,
  config.telegramApiHash,
  { connectionRetries: 5 },
);
const botClient = new BotTelegramClient(config.telegramBotToken);
const messageHistory = [];
let lastPeriodicSummaryAt = Date.now();

fs.writeFileSync(pidFile, String(process.pid));

function userMessageText(message) {
  return message.message || "";
}

function normalizedMessage(message) {
  return {
    text: userMessageText(message),
    caption: "",
    date: Math.floor(message.date || Date.now() / 1000),
    from: {
      username: message.sender?.username || "",
      first_name: message.sender?.firstName || "",
      last_name: message.sender?.lastName || "",
      is_bot: Boolean(message.sender?.bot),
    },
  };
}

function messageChatId(event) {
  return String(event.chatId || "");
}

function messageTopicId(message) {
  const replyTo = message.replyTo;
  return String(replyTo?.replyToTopId || replyTo?.replyToMsgId || "");
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
  if (config.sourceTopicIds.length === 0) {
    return !isExcludedTopic(message);
  }

  return config.sourceTopicIds.includes(messageTopicId(message)) && !isExcludedTopic(message);
}

function isSummaryCommand(message) {
  const text = userMessageText(message).trim();
  return config.summaryCommandAliases.some(
    (command) => text === command || text.startsWith(`${command} `),
  );
}

function matchingTopicIds(message) {
  const text = userMessageText(message);
  const topicIds = config.routingRules
    .filter((rule) => rule.topicId && (rule.pattern?.test(text) || text.includes(rule.marker)))
    .map((rule) => rule.topicId);

  return [...new Set(topicIds)];
}

function rememberMessage(message) {
  if (!userMessageText(message) || isSummaryCommand(message)) return;

  messageHistory.push(normalizedMessage(message));

  const cutoff = Date.now() - config.summaryHistoryHours * 60 * 60 * 1000;
  while (messageHistory.length > 0 && messageHistory[0].date * 1000 < cutoff) {
    messageHistory.shift();
  }
}

function messagesSince(timestamp) {
  return messageHistory.filter((message) => message.date * 1000 >= timestamp);
}

async function historyMessagesSince(timestamp) {
  const messages = [];
  const limit = 1000;

  for await (const message of userClient.iterMessages(config.chatId, { limit })) {
    const date = Math.floor(message.date || Date.now() / 1000);
    if (date * 1000 < timestamp) break;
    if (!userMessageText(message) || isSummaryCommand(message) || !isSourceTopic(message)) continue;

    messages.push(normalizedMessage(message));
  }

  return messages.reverse();
}

async function sendSummary(messages, title, { sendEmpty = false } = {}) {
  if (messages.length === 0) {
    if (!sendEmpty) return;

    await botClient.sendMessage({
      targetChatId: config.chatId,
      topicId: config.summaryTopicId,
      text: `<b>${escapeHtml(title)}</b>\n\n没有找到可整理的信息。`,
    });
    return;
  }

  try {
    const summary = await summarizeMessages(messages, config, title);
    if (!summary) return;

    await botClient.sendMessage({
      targetChatId: config.chatId,
      topicId: config.summaryTopicId,
      text: summary,
    });
  } catch (error) {
    await botClient.sendMessage({
      targetChatId: config.chatId,
      topicId: config.summaryTopicId,
      text: `<b>${escapeHtml(title)}</b>\n\nOpenAI 总结失败：${escapeHtml(error.message)}`,
    });
  }
}

async function sendWindowSummary(hours) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  const historyMessages = await historyMessagesSince(since);
  console.log(`Summary command loaded ${historyMessages.length} messages from Telegram history.`);
  await sendSummary(historyMessages, `过去${hours}小时群消息整理`, { sendEmpty: true });
}

async function sendPeriodicSummary() {
  const now = Date.now();
  const messages = messagesSince(lastPeriodicSummaryAt);
  lastPeriodicSummaryAt = now;
  await sendSummary(messages, "过去4小时群消息整理");
}

async function routeMessage(message) {
  const topicIds = matchingTopicIds(message);
  const preview = userMessageText(message).replace(/\s+/g, " ").slice(0, 100);

  if (topicIds.length === 0) {
    console.log(`No route matched for user-listened message ${message.id}: ${preview}`);
    return;
  }

  for (const topicId of topicIds) {
    await botClient.sendMessage({
      targetChatId: config.chatId,
      topicId,
      text: escapeHtml(userMessageText(message)).slice(0, 3900),
    });
    console.log(`Sent user-listened message ${message.id} to topic ${topicId}.`);
  }
}

async function handleEvent(event) {
  const message = event.message;
  if (!message || messageChatId(event) !== String(config.chatId)) return;

  const senderKind = message.sender?.bot ? "bot" : "user";
  console.log(
    `Received ${senderKind} message ${message.id} in topic ${messageTopicId(message) || "general"}.`,
  );

  if (isSummaryCommand(message)) {
    await sendWindowSummary(config.summaryCommandHours);
    return;
  }

  if (isExcludedTopic(message)) return;

  if (!isSourceTopic(message)) return;

  rememberMessage(message);
  await routeMessage(message);
}

await userClient.connect();
console.log("Telegram user-account router is running.");

userClient.addEventHandler((event) => {
  handleEvent(event).catch((error) => console.error(`Failed to handle user event: ${error.message}`));
}, new NewMessage({}));

setInterval(() => {
  sendPeriodicSummary().catch((error) =>
    console.error(`Failed to send periodic summary: ${error.message}`),
  );
}, config.summaryIntervalMinutes * 60 * 1000);

function stop() {
  fs.rmSync(pidFile, { force: true });
  userClient.disconnect();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
