import { config } from "./config.js";

if (!config.openaiApiKey) {
  throw new Error("OPENAI_API_KEY is empty.");
}

const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    authorization: `Bearer ${config.openaiApiKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: config.openaiModel,
    input: "用中文回复：OpenAI API 正常。",
    max_output_tokens: 50,
  }),
});

const body = await response.json();

if (!response.ok) {
  console.error(body.error?.message || response.statusText);
  process.exit(1);
}

console.log(body.output_text || "OpenAI API 正常。");
