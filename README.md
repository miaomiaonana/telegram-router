# Telegram 群消息转发与整理

这个项目会做两件事：

1. 从 Telegram forum 群的指定来源 topic 读取消息，按内容里的用户分组，把消息复制转发到同一个群里的指定 topic。
2. 每 4 小时整理群消息，并把摘要发送到指定 topic；也可以用指令立刻总结过去 2 小时。

## 准备 Telegram bot

1. 在 Telegram 找到 `@BotFather` 创建 bot，拿到 `TELEGRAM_BOT_TOKEN`。
2. 把 bot 加进这个 Telegram forum 群。
3. 如果要读取普通群里的所有消息，需要在 `@BotFather` 里关闭 bot privacy mode，或确保 bot 有权限收到这些消息。
4. 目标群必须开启 topics。把消息发到某个 topic 后，topic 链接里的最后一段通常就是 `message_thread_id`。

## 配置

复制 `.env.example` 为 `.env`，然后填写：

```ini
TELEGRAM_BOT_TOKEN=你的_bot_token
TELEGRAM_CHAT_ID=-100群id
SOURCE_TOPIC_IDS=来源topic_id
STOCK_TOPIC_ID=美股消息要发去的topic_id
TRADING_TOPIC_ID=交易消息要发去的topic_id
SUMMARY_TOPIC_ID=摘要要发去的topic_id
SUMMARY_INTERVAL_MINUTES=240
SUMMARY_COMMAND=/summary2h
SUMMARY_COMMAND_HOURS=2
OPENAI_API_KEY=可选
```

目前转发规则是固定的：

- 内容包含 `用户所属分组: 美股` 的消息，会转发到 `STOCK_TOPIC_ID`
- 内容包含 `用户所属分组: 交易` 的消息，会转发到 `TRADING_TOPIC_ID`

如果一条消息同时包含两个分组，会分别转发到两个 topic。

`SOURCE_TOPIC_IDS` 是来源 topic。  
如果有多个来源 topic，用英文逗号分隔，例如：

```ini
SOURCE_TOPIC_IDS=11,22,33
```

默认每 4 小时自动总结一次。  
在这个群任意 topic 发送 `/summary2h`，会立刻总结过去 2 小时的信息并发送到 `SUMMARY_TOPIC_ID`。

## 运行

```bash
npm start
```

如果来源消息是另一个 bot 发的，Telegram Bot API 可能不会把这些消息交给我们的 bot。  
这种情况下使用用户账号监听版：

1. 打开 `https://my.telegram.org/apps`
2. 登录你的 Telegram 账号
3. 创建一个 app，拿到 `api_id` 和 `api_hash`
4. 填到 `.env`：

```ini
TELEGRAM_API_ID=你的_api_id
TELEGRAM_API_HASH=你的_api_hash
```

5. 生成登录 session：

```bash
npm run user:login
```

6. 按提示输入手机号、Telegram 验证码，如果有二步验证也输入密码
7. 把输出的 `TELEGRAM_USER_SESSION=...` 填进 `.env`
8. 启动用户账号监听版：

```bash
npm run start:user
```

用户账号监听版会用你的 Telegram 账号读取群消息，再用 bot 把匹配到的文本发送到对应 topic。

## 妖币监控 topic

在 `.env` 里配置：

```ini
WATCH_TOPIC_ID=妖币监控topic_id
WATCHLIST_FILE=watchlist.json
ALERT_STATE_FILE=alert-state.json
WATCH_MONITOR_INTERVAL_MINUTES=5
COINGLASS_API_KEY=你的_coinglass_api_key
COINGLASS_BASE_URL=https://open-api-v4.coinglass.com
```

在“妖币监控” topic 里可以使用：

```text
/add BTC
/remove BTC
/watchlist
/ta BTC
```

中文也支持：

```text
添加 BTC
删除 BTC
列表
分析 BTC
```

`/ta BTC` 会返回公开行情指标，包括当前价格、过去 1h 涨跌、1h 成交额、当前 OI、market cap、24h 变化等。数据来自 Binance public API 和 CoinGecko public API，仅供信息整理，不构成交易建议。

新版 `/ta BTC` 使用 CoinGlass v4 API 和 CoinGecko public API，返回：

- 当前 OI
- OI Change (1h)
- OI Change (15m)
- Funding Rate
- Market Cap
- OI / Market Cap
- RSI (1 hour)
- Volume (1h%)
- Price Change (1h)
- Price Change (15m)
- Daily EMA200
- Daily Close vs EMA200
- 1h Supertrend (10,3)
- 1h Supertrend Line
- 1h Supertrend Flip
- Binance Top Trader Long/Short Ratio (Accounts)
- Binance Top Trader Long/Short Ratio (Positions)

定时监控会每 `WATCH_MONITOR_INTERVAL_MINUTES` 分钟扫描一次监控列表，并在“妖币监控” topic 推送 alert：

- `OI Change (1h) > 20%`，并且 `Positions Ratio > Accounts Ratio` 或 `Funding Rate < 0`
- `OI Change (15m) < -15%`，并且 `Price Change (15m) < -10%`
- `OI Change (15m) > 15%`，并且 `Price Change (15m) > 10%`，并且 `Volume (15m%) > 75%`
- 日线收盘价从 EMA200 下方站上 EMA200，或从 EMA200 上方跌下 EMA200 时提醒
- 1h Supertrend 发生变化时提醒，也就是空翻多或多翻空
- `OI / Market Cap` 从 `< 0.5` 变成 `>= 0.5`，或从 `>= 0.5` 变成 `< 0.5` 时提醒

如果只需要妖币监控，不需要读取其他 topic，可以单独启动 Bot 版：

```bash
npm run start:watch:bot
```

检查代码语法：

```bash
npm run check
```

## 价值币沉淀 topic

在 `.env` 里配置：

```ini
VALUE_TOPIC_ID=价值币沉淀topic_id
VALUE_WATCHLIST_FILE=value-watchlist.json
VALUE_ALERT_STATE_FILE=value-alert-state.json
```

在“价值币沉淀” topic 里可以使用：

```text
/add BTC
/remove BTC
/watchlist
/ta BTC
```

中文也支持：

```text
添加 BTC
删除 BTC
列表
分析 BTC
```

`/ta BTC` 会返回偏中周期的 4h / 1d 指标，包括：

- 当前价格
- 当前 OI
- 当前 OI USD
- OI Change (4h)
- Funding Rate
- Market Cap
- OI / Market Cap
- RSI (4 hour)
- Volume (4h%)
- Volume (4h)
- Price Change (4h)
- Daily EMA200
- Daily Close vs EMA200
- 4h Supertrend (10,3)
- 4h Supertrend Line
- 1d Supertrend (10,3)
- 1d Supertrend Line
- Binance Top Trader Long/Short Ratio (Accounts)
- Binance Top Trader Long/Short Ratio (Positions)

单独启动价值币沉淀 Bot：

```bash
npm run start:value:bot
```

价值币沉淀 alert 会按 `WATCH_MONITOR_INTERVAL_MINUTES` 的间隔扫描沉淀列表：

- 日线收盘价从 EMA200 下方重新站上 EMA200，或从 EMA200 上方重新跌下 EMA200
- 4h Supertrend 翻多或翻空
- 1d Supertrend 翻多或翻空
- `OI Change (4h) > 15%` 或 `OI Change (4h) < -15%`

停止价值币沉淀 Bot：

```bash
npm run stop:value:bot
```

## 获取群 ID 和 topic ID

最简单的方式：

1. 先把 bot 加进群里。
2. 在来源 topic 和目标 topic 各发一条测试消息。
3. 临时运行服务，观察终端里如果 Telegram 报权限或 ID 错误，再调整 `.env`。

如果你需要更明确地查看 ID，可以访问：

```text
https://api.telegram.org/bot你的_bot_token/getUpdates
```

返回结果里的：

- `message.chat.id` 是群 ID
- `message.message_thread_id` 是 topic ID

## 注意

这个服务使用 Telegram Bot API 的 `getUpdates` 轮询方式。生产环境里可以长期运行在一台服务器上，也可以之后改成 webhook。
