import { TelegramClient as UserTelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "./config.js";

if (!config.telegramApiId || !config.telegramApiHash) {
  throw new Error("Please set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first.");
}

const client = new UserTelegramClient(
  new StringSession(config.telegramUserSession || ""),
  config.telegramApiId,
  config.telegramApiHash,
  {
    connectionRetries: 5,
    baseLogger: {
      info: () => {},
      warn: () => {},
      error: console.error,
      debug: () => {},
      trace: () => {},
    },
  },
);

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  });
}

await client.start({
  phoneNumber: async () => ask("Telegram phone number: "),
  password: async () => ask("Two-step password, if enabled: "),
  phoneCode: async () => ask("Telegram login code: "),
  onError: (error) => console.error(error.message),
});

const session = client.session.save();
console.log("");
console.log("Login successful. Put this value in .env:");
console.log(`TELEGRAM_USER_SESSION=${session}`);
console.log("");

await client.disconnect();
