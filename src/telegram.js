export class TelegramClient {
  constructor(botToken) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async call(method, payload = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await response.json();
    if (!body.ok) {
      throw new Error(
        `Telegram ${method} failed: ${body.description || response.statusText}`,
      );
    }

    return body.result;
  }

  async getUpdates(offset) {
    return this.call("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message", "edited_message"],
    });
  }

  async copyMessage({ fromChatId, messageId, targetChatId, topicId }) {
    return this.call("copyMessage", {
      chat_id: targetChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
      ...(topicId ? { message_thread_id: topicId } : {}),
    });
  }

  async sendMessage({ targetChatId, topicId, text }) {
    return this.call("sendMessage", {
      chat_id: targetChatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(topicId ? { message_thread_id: topicId } : {}),
    });
  }
}
