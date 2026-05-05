import fs from "node:fs";
import path from "node:path";

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

const env = {
  ...loadDotEnv(path.resolve(process.cwd(), ".env")),
  ...process.env,
};

function required(name) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment value: ${name}`);
  }
  return value;
}

function optionalInteger(name, fallback) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

function optionalList(name) {
  return (env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  chatId: required("TELEGRAM_CHAT_ID"),
  sourceTopicIds: optionalList("SOURCE_TOPIC_IDS"),
  telegramApiId: optionalInteger("TELEGRAM_API_ID", undefined),
  telegramApiHash: env.TELEGRAM_API_HASH || "",
  telegramUserSession: env.TELEGRAM_USER_SESSION || "",
  stockTopicId: optionalInteger("STOCK_TOPIC_ID", undefined),
  tradingTopicId: optionalInteger("TRADING_TOPIC_ID", undefined),
  summaryTopicId: optionalInteger("SUMMARY_TOPIC_ID", undefined),
  watchTopicId: optionalInteger("WATCH_TOPIC_ID", undefined),
  watchlistFile: env.WATCHLIST_FILE || "watchlist.json",
  alertStateFile: env.ALERT_STATE_FILE || "alert-state.json",
  valueTopicId: optionalInteger("VALUE_TOPIC_ID", undefined),
  valueWatchlistFile: env.VALUE_WATCHLIST_FILE || "value-watchlist.json",
  valueAlertStateFile: env.VALUE_ALERT_STATE_FILE || "value-alert-state.json",
  coinglassApiKey: env.COINGLASS_API_KEY || "",
  coinglassBaseUrl: env.COINGLASS_BASE_URL || "https://open-api-v4.coinglass.com",
  watchMonitorIntervalMinutes: optionalInteger("WATCH_MONITOR_INTERVAL_MINUTES", 5),
  summaryIntervalMinutes: optionalInteger("SUMMARY_INTERVAL_MINUTES", 240),
  summaryCommand: env.SUMMARY_COMMAND || "/summary2h",
  summaryCommandAliases: [
    env.SUMMARY_COMMAND || "/summary2h",
    "/ai_summary2h",
    ...optionalList("SUMMARY_COMMAND_ALIASES"),
  ],
  summaryCommandHours: optionalInteger("SUMMARY_COMMAND_HOURS", 2),
  summaryHistoryHours: optionalInteger("SUMMARY_HISTORY_HOURS", 24),
  maxSummaryMessages: optionalInteger("MAX_SUMMARY_MESSAGES", 80),
  summaryMaxOutputTokens: optionalInteger("SUMMARY_MAX_OUTPUT_TOKENS", 4096),
  openaiApiKey: env.OPENAI_API_KEY || "",
  openaiModel: env.OPENAI_MODEL || "gpt-4.1-mini",
  routingRules: [
    {
      name: "美股",
      marker: "用户所属分组: 美股",
      pattern: /用户所属分组\s*[:：]\s*美股/i,
      topicId: optionalInteger("STOCK_TOPIC_ID", undefined),
    },
    {
      name: "交易",
      marker: "用户所属分组: 交易",
      pattern: /用户所属分组\s*[:：]\s*交易/i,
      topicId: optionalInteger("TRADING_TOPIC_ID", undefined),
    },
  ],
};
