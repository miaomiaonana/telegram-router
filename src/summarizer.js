function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function compactMessage(message) {
  const rawText = message.text || message.caption || "";
  const author =
    message.from?.username ||
    [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") ||
    "unknown";

  return {
    author,
    watchedUser: messageWatchedUser(rawText),
    text: cleanMessageText(rawText),
    rawText,
    date: new Date(message.date * 1000).toISOString(),
    group: messageGroup(rawText),
    symbols: messageSymbols(rawText),
  };
}

export function messageText(message) {
  return message.text || message.caption || "";
}

export function messageGroup(text) {
  const match = text.match(/用户所属分组\s*[:：]\s*([^\n\r]+)/i);
  if (!match) return "未分类";

  return match[1].trim().replace(/\s+/g, " ");
}

export function messageWatchedUser(text) {
  const match = text.match(/你关注的用户\s*[:：]\s*([^\n\r]+)/i);
  if (!match) return "";

  return match[1]
    .trim()
    .replace(/\s*\(备注[:：][^)]+\)\s*/g, "")
    .replace(/\s+/g, " ");
}

export function cleanMessageText(text) {
  return text
    .replace(/^\s*🌟?\s*监控到新推文\s*/i, "")
    .replace(/你关注的用户\s*[:：]\s*[^\n\r]+/gi, "")
    .replace(/用户所属分组\s*[:：]\s*[^\n\r]+/gi, "")
    .replace(/推文内容\s*[:：]\s*/gi, "")
    .replace(/^\s*RT\s+/i, "RT ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function isNoiseMessage(text) {
  return /吃饭|餐厅|美食|喝酒|咖啡|奶茶|旅游|旅行|酒店|机票|唱歌|电影|追剧|健身|日常|周末|下班|睡觉|起床|天气不错|打卡|NBA|球赛|直播间|看书|聊天/i.test(
    text,
  );
}

export function messageSymbols(text) {
  const symbols = new Set();
  const cashtags = text.match(/\$[A-Za-z][A-Za-z0-9._-]{0,15}/g) || [];
  const uppercase = text.match(/\b[A-Z]{2,8}\b/g) || [];
  const cryptoPairs = text.match(/\b[A-Z]{2,10}(?:USDT|USD|BTC|ETH)\b/g) || [];

  for (const item of [...cashtags, ...uppercase, ...cryptoPairs]) {
    const normalized = item.replace(/^\$/, "").toUpperCase();
    if (COMMON_WORDS.has(normalized)) continue;
    symbols.add(normalized);
  }

  return [...symbols].slice(0, 12);
}

const COMMON_WORDS = new Set([
  "RT",
  "ETF",
  "CEO",
  "CFO",
  "SEC",
  "FED",
  "FOMC",
  "USD",
  "TVL",
  "API",
  "ATH",
  "ATL",
  "NFT",
  "AI",
]);

export function isWantedMessage(message, includePatterns, excludePatterns) {
  const text = messageText(message);
  if (!text) return false;

  if (excludePatterns.some((pattern) => pattern.test(text))) return false;
  if (includePatterns.length === 0) return true;

  return includePatterns.some((pattern) => pattern.test(text));
}

export async function summarizeMessages(messages, config, title = "群消息整理") {
  const cleaned = messages
    .map(compactMessage)
    .filter((message) => message.text);

  if (cleaned.length === 0) return "";

  if (config.openaiApiKey) {
    try {
      const summary = await summarizeWithOpenAI(cleaned, config, title);
      console.log("OpenAI summary succeeded.");
      return summary;
    } catch (error) {
      console.error(`OpenAI summary unavailable, using local summary: ${error.message}`);
    }
  } else {
    console.error("OpenAI summary skipped: OPENAI_API_KEY is empty.");
  }

  return summarizeLocally(cleaned, title);
}

async function summarizeWithOpenAI(messages, config, title) {
  const input = [
    {
      role: "system",
      content:
        `你是 Telegram 群消息整理员。摘要标题是“${title}”。请总结时间窗口内全部有信息量的原文内容。

严格要求：只能总结原文明确表达的观点，不得引入外部知识，不得根据常识自行推断，不得添加原文没有出现的价格、方向、风险、催化或建议。原文没有明确观点时，必须写“不明确”。“关注”也只能来自原文直接提到的信息；如果原文没有风险或关注点，写“原文未提及”。

按 group 字段分类输出，例如“交易”“默认分组”“美股”“官方账号”。不同板块之间必须单独插入一行“---------”。

每个板块用自然语言短摘要或 2-5 条短 bullet 总结原文即可。要在摘要里适当提到 watchedUser 用户名，例如“大宇提到……”“Binance 发布……”。不要专门列“明确观点”“风险”“关注点”等固定栏目。可以保留原文提到的股票、代币、项目、交易所、交易对、事件和数据，但只做压缩整理，不做额外解读。

必须省略没有独立信息量的泛泛占位句，例如“某某、某某等多条简短闲聊或转发”“多条无关闲聊”“若干转发”。如果内容只是 gm、表情、单纯链接、寒暄、无上下文转发、无法判断含义的碎片，不要为了覆盖它而写一句废话。

不要逐条复述原文。不要出现“监控到新推文”“你关注的用户”“用户所属分组”“推文内容”。整体尽量简洁，但必须覆盖时间窗口内全部有信息量的市场、项目、股票、代币、数据、观点和事件。输出可以使用 Telegram HTML 标签，如 <b>。`,
    },
    {
      role: "user",
      content: JSON.stringify(messages, null, 2),
    },
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openaiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input,
      max_output_tokens: config.summaryMaxOutputTokens,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI summary failed: ${body.error?.message || response.statusText}`);
  }

  const outputText = extractOpenAIText(body);
  if (!outputText) {
    throw new Error("OpenAI returned no summary text");
  }

  return outputText;
}

function extractOpenAIText(body) {
  if (body.output_text) return body.output_text.trim();

  const textParts = [];
  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function summarizeLocally(messages, title) {
  const scopedMessages = messages.slice(-80);
  const grouped = new Map();
  for (const message of scopedMessages) {
    const group = message.group || "未分类";
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(message);
  }

  const sections = [];
  let sectionIndex = 0;
  for (const [group, items] of grouped.entries()) {
    const symbolCounts = new Map();
    for (const item of items) {
      for (const symbol of item.symbols || []) {
        symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
      }
    }

    const topSymbols = [...symbolCounts.entries()]
      .sort((first, second) => second[1] - first[1])
      .slice(0, 3)
      .map(([symbol]) => symbol);

    if (sectionIndex > 0) sections.push("---------");
    const lines =
      topSymbols.length > 0
        ? topSymbols.flatMap((symbol) => [
            `<b>${escapeHtml(symbol)}</b>`,
            "- 本地兜底摘要：仅识别到该核心标的，未做智能整理。",
          ])
        : ["无有效市场信息。"];

    sections.push(
      `<b>${escapeHtml(group)}</b>`,
      ...lines,
      "",
    );
    sectionIndex += 1;
  }

  return [
    `<b>${escapeHtml(title)}</b>`,
    "",
    `<b>消息数量：</b>${messages.length}`,
    "",
    ...sections,
  ].join("\n");
}

export { escapeHtml };
