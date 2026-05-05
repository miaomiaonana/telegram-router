import { normalizeSymbol } from "./watchlist.js";

const BINANCE_FUTURES = "https://fapi.binance.com";
const COINGECKO = "https://api.coingecko.com/api/v3";

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.msg || body.error || response.statusText);
  }

  return body;
}

function url(base, path, params = {}) {
  const target = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") target.searchParams.set(key, String(value));
  }
  return target.toString();
}

function latest(items) {
  return items.at(-1) || {};
}

function numberFrom(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return NaN;
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return NaN;
  return ((current - previous) / previous) * 100;
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  if (Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(digits)}B`;
  if (Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(digits)}M`;
  if (Math.abs(number) >= 1_000) {
    return number.toLocaleString("en-US", { maximumFractionDigits: digits });
  }
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatPlainNumber(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function subjectiveTake(metrics) {
  const notes = [];
  let score = 0;
  const primaryLabel = metrics.profile === "value" ? "4h" : "1h";

  if (metrics.primarySupertrendTrend === "多") {
    score += 1;
    notes.push(`🟢 ${primaryLabel} Supertrend 偏多`);
  } else if (metrics.primarySupertrendTrend === "空") {
    score -= 1;
    notes.push(`🔴 ${primaryLabel} Supertrend 偏空`);
  }

  if (metrics.profile === "value" && metrics.supertrend1dTrend === "多") {
    score += 1;
    notes.push("🟢 1d Supertrend 偏多");
  } else if (metrics.profile === "value" && metrics.supertrend1dTrend === "空") {
    score -= 1;
    notes.push("🔴 1d Supertrend 偏空");
  }

  if (metrics.primaryOiChange > 20) {
    score += 1;
    notes.push(`🔥 OI ${primaryLabel} 快速增加`);
  } else if (metrics.primaryOiChange < -15) {
    score -= 1;
    notes.push("🧊 OI 明显回落");
  }

  if (metrics.primaryPriceChange > 5) {
    score += 1;
    notes.push(`🚀 价格 ${primaryLabel} 走强`);
  } else if (metrics.primaryPriceChange < -5) {
    score -= 1;
    notes.push(`⚠️ 价格 ${primaryLabel} 走弱`);
  }

  if (metrics.primaryRsi > 80) {
    score -= 1;
    notes.push("🥵 RSI 偏热");
  } else if (metrics.primaryRsi < 30) {
    score += 1;
    notes.push("🥶 RSI 偏冷");
  }

  if (metrics.fundingRate < 0) {
    notes.push("🟣 Funding 为负");
  } else if (metrics.fundingRate > 0.05) {
    notes.push("🟠 Funding 偏高");
  }

  const mood = score >= 2 ? "🟢 偏强" : score <= -2 ? "🔴 偏弱" : "🟡 中性观察";
  const summary = notes.slice(0, 4).join("；") || "指标信号不明显";

  return `${mood}：${summary}`;
}

async function getCurrentOpenInterest(symbol) {
  const body = await fetchJson(
    url(BINANCE_FUTURES, "/fapi/v1/openInterest", { symbol: `${symbol}USDT` }),
  );
  return Number(body.openInterest);
}

async function getOpenInterestHistory(symbol, period, limit = 2) {
  return fetchJson(
    url(BINANCE_FUTURES, "/futures/data/openInterestHist", {
      symbol: `${symbol}USDT`,
      period,
      limit,
    }),
  );
}

async function getFundingRate(symbol) {
  const body = await fetchJson(
    url(BINANCE_FUTURES, "/fapi/v1/premiumIndex", { symbol: `${symbol}USDT` }),
  );
  return Number(body.lastFundingRate);
}

async function getKlines(symbol, interval, limit = 20) {
  return fetchJson(
    url(BINANCE_FUTURES, "/fapi/v1/klines", {
      symbol: `${symbol}USDT`,
      interval,
      limit,
    }),
  );
}

async function getTopAccountRatio(symbol, period = "1h") {
  const body = await fetchJson(
    url(BINANCE_FUTURES, "/futures/data/topLongShortAccountRatio", {
      symbol: `${symbol}USDT`,
      period,
      limit: 1,
    }),
  );
  return Number(latest(body).longShortRatio);
}

async function getTopPositionRatio(symbol, period = "1h") {
  const body = await fetchJson(
    url(BINANCE_FUTURES, "/futures/data/topLongShortPositionRatio", {
      symbol: `${symbol}USDT`,
      period,
      limit: 1,
    }),
  );
  return Number(latest(body).longShortRatio);
}

async function getCoinGeckoMarket(symbol) {
  const target = `${COINGECKO}/simple/price?vs_currencies=usd&symbols=${encodeURIComponent(
    symbol.toLowerCase(),
  )}&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_tokens=all`;
  const body = await fetchJson(target);
  const entries = body[symbol.toLowerCase()] || [];
  const first = Array.isArray(entries) ? entries[0] : entries;

  return {
    marketCap: Number(first?.usd_market_cap),
    volume24h: Number(first?.usd_24h_vol),
    change24h: Number(first?.usd_24h_change),
  };
}

function oiUsdFromHistory(item) {
  return numberFrom(item, ["sumOpenInterestValue", "sum_open_interest_value", "openInterestValue"]);
}

function closeFromKline(kline) {
  return Number(kline?.[4]);
}

function highFromKline(kline) {
  return Number(kline?.[2]);
}

function lowFromKline(kline) {
  return Number(kline?.[3]);
}

function quoteVolumeFromKline(kline) {
  return Number(kline?.[7]);
}

function closedKlines(klines) {
  const now = Date.now();
  return klines.filter((kline) => Number(kline?.[6]) < now);
}

function calculateRsi(closes, period = 14) {
  if (closes.length <= period) return NaN;

  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function calculateEma(values, period) {
  if (values.length < period) return NaN;

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (const value of values.slice(period)) {
    ema = value * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

function calculateSupertrend(klines, period = 10, multiplier = 3) {
  if (klines.length <= period + 2) {
    return { trend: "N/A", previousTrend: "N/A", line: NaN, previousLine: NaN };
  }

  const rows = klines
    .map((kline) => ({
      high: highFromKline(kline),
      low: lowFromKline(kline),
      close: closeFromKline(kline),
    }))
    .filter((row) => Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close));

  if (rows.length <= period + 2) {
    return { trend: "N/A", previousTrend: "N/A", line: NaN, previousLine: NaN };
  }

  const trueRanges = rows.map((row, index) => {
    if (index === 0) return row.high - row.low;
    const previousClose = rows[index - 1].close;
    return Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose),
    );
  });

  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let finalUpper = NaN;
  let finalLower = NaN;
  let supertrend = NaN;
  let previousSupertrend = NaN;
  let previousFinalUpper = NaN;
  const trends = [];

  for (let index = 0; index < rows.length; index += 1) {
    if (index < period) {
      trends.push("N/A");
      continue;
    }

    if (index > period) {
      atr = (atr * (period - 1) + trueRanges[index]) / period;
    }

    const row = rows[index];
    const previousRow = rows[index - 1];
    const basicUpper = (row.high + row.low) / 2 + multiplier * atr;
    const basicLower = (row.high + row.low) / 2 - multiplier * atr;

    previousFinalUpper = finalUpper;

    if (!Number.isFinite(finalUpper)) {
      finalUpper = basicUpper;
      finalLower = basicLower;
    } else {
      finalUpper =
        basicUpper < finalUpper || previousRow.close > finalUpper ? basicUpper : finalUpper;
      finalLower =
        basicLower > finalLower || previousRow.close < finalLower ? basicLower : finalLower;
    }

    previousSupertrend = supertrend;
    if (!Number.isFinite(supertrend)) {
      supertrend = row.close <= finalUpper ? finalUpper : finalLower;
    } else if (supertrend === previousFinalUpper) {
      supertrend = row.close <= finalUpper ? finalUpper : finalLower;
    } else {
      supertrend = row.close >= finalLower ? finalLower : finalUpper;
    }

    trends.push(supertrend === finalLower ? "多" : "空");
  }

  return {
    trend: trends.at(-1) || "N/A",
    previousTrend: trends.at(-2) || "N/A",
    line: supertrend,
    previousLine: previousSupertrend,
  };
}

async function settle(label, task) {
  try {
    return { label, ok: true, value: await task };
  } catch (error) {
    return { label, ok: false, error: error.message };
  }
}

export async function getTokenMetrics(inputSymbol, options = {}) {
  const symbol = normalizeSymbol(inputSymbol);
  if (!symbol) throw new Error("请输入标的，例如：/ta BTC");
  const profile = options.profile || "meme";
  const primaryInterval = profile === "value" ? "4h" : "1h";
  const secondaryInterval = profile === "value" ? "1d" : "15m";
  const primaryKlineLimit = profile === "value" ? 120 : 500;
  const secondaryKlineLimit = profile === "value" ? 120 : 2;
  const primaryLabel = profile === "value" ? "4h" : "1h";
  const secondaryLabel = profile === "value" ? "1d" : "15m";

  const [currentOi, primaryOi, secondaryOi, funding, primaryKlines, secondaryKlines, klines1d, topAccount, topPosition, market] =
    await Promise.all([
      settle("Current OI", getCurrentOpenInterest(symbol)),
      settle(`OI ${primaryLabel}`, getOpenInterestHistory(symbol, primaryInterval, 2)),
      settle(`OI ${secondaryLabel}`, getOpenInterestHistory(symbol, secondaryInterval, 2)),
      settle("Funding", getFundingRate(symbol)),
      settle(`Klines ${primaryLabel}`, getKlines(symbol, primaryInterval, primaryKlineLimit)),
      settle(`Klines ${secondaryLabel}`, getKlines(symbol, secondaryInterval, secondaryKlineLimit)),
      settle("Klines 1d", getKlines(symbol, "1d", 1000)),
      settle("Top Account Ratio", getTopAccountRatio(symbol, primaryInterval)),
      settle("Top Position Ratio", getTopPositionRatio(symbol, primaryInterval)),
      settle("Market Cap", getCoinGeckoMarket(symbol)),
    ]);

  const primaryOiItems = primaryOi.ok ? primaryOi.value : [];
  const secondaryOiItems = secondaryOi.ok ? secondaryOi.value : [];
  const primaryK = primaryKlines.ok ? primaryKlines.value : [];
  const secondaryK = secondaryKlines.ok ? secondaryKlines.value : [];
  const k1d = klines1d.ok ? klines1d.value : [];
  const latestPrimary = latest(primaryK);
  const previousPrimary = primaryK.at(-2);
  const latestSecondary = latest(secondaryK);
  const previousSecondary = secondaryK.at(-2);
  const marketValue = market.ok ? market.value : {};
  const latestPrimaryOiUsd = oiUsdFromHistory(latest(primaryOiItems));
  const previousPrimaryOiUsd = oiUsdFromHistory(primaryOiItems.at(-2));
  const latestSecondaryOiUsd = oiUsdFromHistory(latest(secondaryOiItems));
  const previousSecondaryOiUsd = oiUsdFromHistory(secondaryOiItems.at(-2));
  const latestPrice = closeFromKline(latestPrimary);
  const previousPrimaryPrice = closeFromKline(previousPrimary);
  const latestSecondaryPrice = closeFromKline(latestSecondary);
  const previousSecondaryPrice = closeFromKline(previousSecondary);
  const latestPrimaryVolume = quoteVolumeFromKline(latestPrimary);
  const previousPrimaryVolume = quoteVolumeFromKline(previousPrimary);
  const latestSecondaryVolume = quoteVolumeFromKline(latestSecondary);
  const previousSecondaryVolume = quoteVolumeFromKline(previousSecondary);
  const primaryCloses = primaryK.map(closeFromKline).filter(Number.isFinite);
  const primaryTrendKlines = closedKlines(primaryK);
  const primarySupertrend = calculateSupertrend(primaryTrendKlines, 10, 3);
  const closed1dKlines = closedKlines(k1d);
  const secondaryTrendKlines = profile === "value" ? closedKlines(secondaryK) : secondaryK;
  const secondarySupertrend = calculateSupertrend(secondaryTrendKlines, 10, 3);
  const closes1d = closed1dKlines.map(closeFromKline).filter(Number.isFinite);
  const dailyClose = closes1d.at(-1);
  const dailyEma200 = calculateEma(closes1d, 200);
  const previousDailyClose = closes1d.at(-2);
  const previousDailyEma200 = calculateEma(closes1d.slice(0, -1), 200);

  return {
    profile,
    symbol,
    oi: currentOi.ok ? currentOi.value : latestPrimaryOiUsd,
    oiUsd: latestPrimaryOiUsd,
    oiChange1h: profile === "meme" ? pctChange(latestPrimaryOiUsd, previousPrimaryOiUsd) : NaN,
    oiChange15m: profile === "meme" ? pctChange(latestSecondaryOiUsd, previousSecondaryOiUsd) : NaN,
    oiChange4h: profile === "value" ? pctChange(latestPrimaryOiUsd, previousPrimaryOiUsd) : NaN,
    fundingRate: funding.ok ? funding.value * 100 : NaN,
    marketCap: marketValue.marketCap,
    oiMarketCapRatio:
      Number.isFinite(latestPrimaryOiUsd) &&
      Number.isFinite(marketValue.marketCap) &&
      marketValue.marketCap > 0
        ? latestPrimaryOiUsd / marketValue.marketCap
        : NaN,
    rsi1h: profile === "meme" ? calculateRsi(primaryCloses) : NaN,
    rsi4h: profile === "value" ? calculateRsi(primaryCloses) : NaN,
    primaryRsi: calculateRsi(primaryCloses),
    volume1hChange: profile === "meme" ? pctChange(latestPrimaryVolume, previousPrimaryVolume) : NaN,
    volume1h: profile === "meme" ? latestPrimaryVolume : NaN,
    volume4hChange: profile === "value" ? pctChange(latestPrimaryVolume, previousPrimaryVolume) : NaN,
    volume4h: profile === "value" ? latestPrimaryVolume : NaN,
    volume15mChange: profile === "meme" ? pctChange(latestSecondaryVolume, previousSecondaryVolume) : NaN,
    volume15m: profile === "meme" ? latestSecondaryVolume : NaN,
    price: latestPrice,
    priceChange1h: profile === "meme" ? pctChange(latestPrice, previousPrimaryPrice) : NaN,
    priceChange15m: profile === "meme" ? pctChange(latestSecondaryPrice, previousSecondaryPrice) : NaN,
    priceChange4h: profile === "value" ? pctChange(latestPrice, previousPrimaryPrice) : NaN,
    primaryOiChange: pctChange(latestPrimaryOiUsd, previousPrimaryOiUsd),
    primaryPriceChange: pctChange(latestPrice, previousPrimaryPrice),
    dailyClose,
    dailyEma200,
    previousDailyClose,
    previousDailyEma200,
    dailyCloseVsEma200: pctChange(dailyClose, dailyEma200),
    dailyEma200CrossUp:
      previousDailyClose <= previousDailyEma200 && dailyClose > dailyEma200,
    dailyEma200CrossDown:
      previousDailyClose >= previousDailyEma200 && dailyClose < dailyEma200,
    supertrend1hTrend: profile === "meme" ? primarySupertrend.trend : "N/A",
    supertrend1hPreviousTrend: profile === "meme" ? primarySupertrend.previousTrend : "N/A",
    supertrend1hLine: profile === "meme" ? primarySupertrend.line : NaN,
    supertrend1hFlip:
      profile === "meme" &&
      ["多", "空"].includes(primarySupertrend.trend) &&
      ["多", "空"].includes(primarySupertrend.previousTrend) &&
      primarySupertrend.trend !== primarySupertrend.previousTrend
        ? `${primarySupertrend.previousTrend}->${primarySupertrend.trend}`
        : "",
    supertrend4hTrend: profile === "value" ? primarySupertrend.trend : "N/A",
    supertrend4hPreviousTrend: profile === "value" ? primarySupertrend.previousTrend : "N/A",
    supertrend4hLine: profile === "value" ? primarySupertrend.line : NaN,
    supertrend4hFlip:
      profile === "value" &&
      ["多", "空"].includes(primarySupertrend.trend) &&
      ["多", "空"].includes(primarySupertrend.previousTrend) &&
      primarySupertrend.trend !== primarySupertrend.previousTrend
        ? `${primarySupertrend.previousTrend}->${primarySupertrend.trend}`
        : "",
    supertrend1dTrend: profile === "value" ? secondarySupertrend.trend : "N/A",
    supertrend1dPreviousTrend: profile === "value" ? secondarySupertrend.previousTrend : "N/A",
    supertrend1dLine: profile === "value" ? secondarySupertrend.line : NaN,
    supertrend1dFlip:
      profile === "value" &&
      ["多", "空"].includes(secondarySupertrend.trend) &&
      ["多", "空"].includes(secondarySupertrend.previousTrend) &&
      secondarySupertrend.trend !== secondarySupertrend.previousTrend
        ? `${secondarySupertrend.previousTrend}->${secondarySupertrend.trend}`
        : "",
    primarySupertrendTrend: primarySupertrend.trend,
    topTraderLongShortAccountRatio: topAccount.ok ? topAccount.value : NaN,
    topTraderLongShortPositionRatio: topPosition.ok ? topPosition.value : NaN,
    errors: [currentOi, primaryOi, secondaryOi, funding, primaryKlines, secondaryKlines, klines1d, topAccount, topPosition, market]
      .filter((item) => !item.ok)
      .map((item) => `${item.label}: ${item.error}`),
  };
}

function buildMemeMetricsMessage(metrics) {
  return [
    `<b>${metrics.symbol} 技术指标</b>`,
    "",
    `<b>当前价格：</b>${formatNumber(metrics.price)}`,
    `<b>当前 OI：</b>${formatNumber(metrics.oi)} ${metrics.symbol}`,
    `<b>当前 OI USD：</b>${formatNumber(metrics.oiUsd)}`,
    `<b>OI Change (1h)：</b>${formatPercent(metrics.oiChange1h)}`,
    `<b>OI Change (15m)：</b>${formatPercent(metrics.oiChange15m)}`,
    `<b>Funding Rate：</b>${formatPercent(metrics.fundingRate)}`,
    `<b>Market Cap：</b>${formatNumber(metrics.marketCap)}`,
    `<b>OI / Market Cap：</b>${formatPlainNumber(metrics.oiMarketCapRatio)}`,
    `<b>RSI (1 hour)：</b>${formatPlainNumber(metrics.rsi1h, 2)}`,
    `<b>Volume (1h%)：</b>${formatPercent(metrics.volume1hChange)}`,
    `<b>Volume (1h)：</b>${formatNumber(metrics.volume1h)}`,
    `<b>Price Change (1h)：</b>${formatPercent(metrics.priceChange1h)}`,
    `<b>Price Change (15m)：</b>${formatPercent(metrics.priceChange15m)}`,
    `<b>Daily EMA200：</b>${formatNumber(metrics.dailyEma200)}`,
    `<b>Daily Close vs EMA200：</b>${formatPercent(metrics.dailyCloseVsEma200)}`,
    `<b>1h Supertrend (10,3)：</b>${metrics.supertrend1hTrend}`,
    `<b>1h Supertrend Line：</b>${formatNumber(metrics.supertrend1hLine)}`,
    `<b>1h Supertrend Flip：</b>${metrics.supertrend1hFlip || "无"}`,
    `<b>Binance Top Trader Long/Short Ratio (Accounts)：</b>${formatPlainNumber(
      metrics.topTraderLongShortAccountRatio,
    )}`,
    `<b>Binance Top Trader Long/Short Ratio (Positions)：</b>${formatPlainNumber(
      metrics.topTraderLongShortPositionRatio,
    )}`,
    "",
    `<b>主观判断：</b>${subjectiveTake(metrics)}`,
    metrics.errors.length ? `\n<b>数据缺口：</b>${metrics.errors.join("; ")}` : "",
    "",
    "数据来源：Binance Futures public API / CoinGecko public API。仅供信息整理，不构成交易建议。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildValueMetricsMessage(metrics) {
  return [
    `<b>${metrics.symbol} 价值币沉淀指标</b>`,
    "",
    `<b>当前价格：</b>${formatNumber(metrics.price)}`,
    `<b>当前 OI：</b>${formatNumber(metrics.oi)} ${metrics.symbol}`,
    `<b>当前 OI USD：</b>${formatNumber(metrics.oiUsd)}`,
    `<b>OI Change (4h)：</b>${formatPercent(metrics.oiChange4h)}`,
    `<b>Funding Rate：</b>${formatPercent(metrics.fundingRate)}`,
    `<b>Market Cap：</b>${formatNumber(metrics.marketCap)}`,
    `<b>OI / Market Cap：</b>${formatPlainNumber(metrics.oiMarketCapRatio)}`,
    `<b>RSI (4 hour)：</b>${formatPlainNumber(metrics.rsi4h, 2)}`,
    `<b>Volume (4h%)：</b>${formatPercent(metrics.volume4hChange)}`,
    `<b>Volume (4h)：</b>${formatNumber(metrics.volume4h)}`,
    `<b>Price Change (4h)：</b>${formatPercent(metrics.priceChange4h)}`,
    `<b>Daily EMA200：</b>${formatNumber(metrics.dailyEma200)}`,
    `<b>Daily Close vs EMA200：</b>${formatPercent(metrics.dailyCloseVsEma200)}`,
    `<b>4h Supertrend (10,3)：</b>${metrics.supertrend4hTrend}`,
    `<b>4h Supertrend Line：</b>${formatNumber(metrics.supertrend4hLine)}`,
    `<b>1d Supertrend (10,3)：</b>${metrics.supertrend1dTrend}`,
    `<b>1d Supertrend Line：</b>${formatNumber(metrics.supertrend1dLine)}`,
    `<b>Binance Top Trader Long/Short Ratio (Accounts)：</b>${formatPlainNumber(
      metrics.topTraderLongShortAccountRatio,
    )}`,
    `<b>Binance Top Trader Long/Short Ratio (Positions)：</b>${formatPlainNumber(
      metrics.topTraderLongShortPositionRatio,
    )}`,
    "",
    `<b>主观判断：</b>${subjectiveTake(metrics)}`,
    metrics.errors.length ? `\n<b>数据缺口：</b>${metrics.errors.join("; ")}` : "",
    "",
    "数据来源：Binance Futures public API / CoinGecko public API。仅供信息整理，不构成交易建议。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMetricsMessage(metrics) {
  return metrics.profile === "value" ? buildValueMetricsMessage(metrics) : buildMemeMetricsMessage(metrics);
}

export async function buildTechnicalSummary(inputSymbol, options = {}) {
  const metrics = await getTokenMetrics(inputSymbol, options);
  return buildMetricsMessage(metrics);
}

export function evaluateAlerts(metrics) {
  const alerts = [];

  if (
    metrics.oiChange1h > 20 &&
    (metrics.topTraderLongShortPositionRatio > metrics.topTraderLongShortAccountRatio ||
      metrics.fundingRate < 0)
  ) {
    alerts.push({
      type: "oi_build_up",
      title: "OI 1h 快速上升",
      reason: `OI Change (1h) ${formatPercent(metrics.oiChange1h)}，Positions Ratio ${formatPlainNumber(
        metrics.topTraderLongShortPositionRatio,
      )}，Accounts Ratio ${formatPlainNumber(metrics.topTraderLongShortAccountRatio)}，Funding ${formatPercent(
        metrics.fundingRate,
      )}`,
    });
  }

  if (metrics.oiChange15m < -15 && metrics.priceChange15m < -10) {
    alerts.push({
      type: "oi_price_dump",
      title: "OI 与价格 15m 同步急跌",
      reason: `OI Change (15m) ${formatPercent(metrics.oiChange15m)}，Price Change (15m) ${formatPercent(
        metrics.priceChange15m,
      )}`,
    });
  }

  if (
    metrics.oiChange15m > 15 &&
    metrics.priceChange15m > 10 &&
    metrics.volume15mChange > 75
  ) {
    alerts.push({
      type: "oi_price_volume_pump_15m",
      title: "15m OI/价格/成交量同步拉升",
      reason: `OI Change (15m) ${formatPercent(metrics.oiChange15m)}，Price Change (15m) ${formatPercent(
        metrics.priceChange15m,
      )}，Volume (15m%) ${formatPercent(metrics.volume15mChange)}`,
    });
  }

  if (metrics.dailyEma200CrossUp) {
    alerts.push({
      type: "daily_close_above_ema200",
      title: "日线收盘价站上 EMA200",
      reason: `Daily Close ${formatNumber(metrics.dailyClose)} > Daily EMA200 ${formatNumber(
        metrics.dailyEma200,
      )}，Close vs EMA200 ${formatPercent(metrics.dailyCloseVsEma200)}`,
    });
  }

  if (metrics.dailyEma200CrossDown) {
    alerts.push({
      type: "daily_close_below_ema200",
      title: "日线收盘价跌下 EMA200",
      reason: `Daily Close ${formatNumber(metrics.dailyClose)} < Daily EMA200 ${formatNumber(
        metrics.dailyEma200,
      )}，Close vs EMA200 ${formatPercent(metrics.dailyCloseVsEma200)}`,
    });
  }

  if (metrics.supertrend1hFlip) {
    alerts.push({
      type: `supertrend_1h_${metrics.supertrend1hTrend}`,
      title: `1h Supertrend 翻${metrics.supertrend1hTrend}`,
      reason: `1h Supertrend ${metrics.supertrend1hFlip}，Supertrend Line ${formatNumber(
        metrics.supertrend1hLine,
      )}，当前价格 ${formatNumber(metrics.price)}`,
    });
  }

  return alerts;
}

export function evaluateOiMarketCapCross(metrics, previousSide) {
  if (!Number.isFinite(metrics.oiMarketCapRatio)) {
    return { side: "", alert: null };
  }

  const side = metrics.oiMarketCapRatio >= 0.5 ? "high" : "low";
  if (!previousSide || previousSide === side) {
    return { side, alert: null };
  }

  return {
    side,
    alert: {
      type: side === "high" ? "oi_market_cap_cross_up" : "oi_market_cap_cross_down",
      title:
        side === "high"
          ? "OI / Market Cap 上穿 0.5"
          : "OI / Market Cap 下破 0.5",
      reason: `OI / Market Cap ${formatPlainNumber(metrics.oiMarketCapRatio)}，当前 OI USD ${formatNumber(
        metrics.oiUsd,
      )}，Market Cap ${formatNumber(metrics.marketCap)}`,
    },
  };
}

export function evaluateValueAlerts(metrics) {
  const alerts = [];

  if (metrics.dailyEma200CrossUp) {
    alerts.push({
      type: "value_daily_close_above_ema200",
      title: "日线收盘价重新站上 EMA200",
      reason: `Daily Close ${formatNumber(metrics.dailyClose)} > Daily EMA200 ${formatNumber(
        metrics.dailyEma200,
      )}，Close vs EMA200 ${formatPercent(metrics.dailyCloseVsEma200)}`,
    });
  }

  if (metrics.dailyEma200CrossDown) {
    alerts.push({
      type: "value_daily_close_below_ema200",
      title: "日线收盘价重新跌下 EMA200",
      reason: `Daily Close ${formatNumber(metrics.dailyClose)} < Daily EMA200 ${formatNumber(
        metrics.dailyEma200,
      )}，Close vs EMA200 ${formatPercent(metrics.dailyCloseVsEma200)}`,
    });
  }

  if (metrics.supertrend4hFlip) {
    alerts.push({
      type: `value_supertrend_4h_${metrics.supertrend4hTrend}`,
      title: `4h Supertrend 翻${metrics.supertrend4hTrend}`,
      reason: `4h Supertrend ${metrics.supertrend4hFlip}，Supertrend Line ${formatNumber(
        metrics.supertrend4hLine,
      )}，当前价格 ${formatNumber(metrics.price)}`,
    });
  }

  if (metrics.supertrend1dFlip) {
    alerts.push({
      type: `value_supertrend_1d_${metrics.supertrend1dTrend}`,
      title: `1d Supertrend 翻${metrics.supertrend1dTrend}`,
      reason: `1d Supertrend ${metrics.supertrend1dFlip}，Supertrend Line ${formatNumber(
        metrics.supertrend1dLine,
      )}，当前价格 ${formatNumber(metrics.price)}`,
    });
  }

  if (metrics.oiChange4h > 15) {
    alerts.push({
      type: "value_oi_build_up_4h",
      title: "OI 4h 异常增加",
      reason: `OI Change (4h) ${formatPercent(metrics.oiChange4h)}，Price Change (4h) ${formatPercent(
        metrics.priceChange4h,
      )}，Funding ${formatPercent(metrics.fundingRate)}`,
    });
  }

  if (metrics.oiChange4h < -15) {
    alerts.push({
      type: "value_oi_drop_4h",
      title: "OI 4h 异常减少",
      reason: `OI Change (4h) ${formatPercent(metrics.oiChange4h)}，Price Change (4h) ${formatPercent(
        metrics.priceChange4h,
      )}，Funding ${formatPercent(metrics.fundingRate)}`,
    });
  }

  return alerts;
}

export function buildAlertMessage(metrics, alert) {
  return [
    `<b>妖币监控 Alert：${metrics.symbol}</b>`,
    `<b>${alert.title}</b>`,
    "",
    alert.reason,
    "",
    `<b>当前价格：</b>${formatNumber(metrics.price)}`,
    `<b>Market Cap：</b>${formatNumber(metrics.marketCap)}`,
    `<b>当前 OI USD：</b>${formatNumber(metrics.oiUsd)}`,
  ].join("\n");
}

export function buildValueAlertMessage(metrics, alert) {
  return [
    `<b>价值币沉淀 Alert：${metrics.symbol}</b>`,
    `<b>${alert.title}</b>`,
    "",
    alert.reason,
    "",
    `<b>当前价格：</b>${formatNumber(metrics.price)}`,
    `<b>Market Cap：</b>${formatNumber(metrics.marketCap)}`,
    `<b>当前 OI USD：</b>${formatNumber(metrics.oiUsd)}`,
    `<b>Daily EMA200：</b>${formatNumber(metrics.dailyEma200)}`,
    `<b>4h Supertrend：</b>${metrics.supertrend4hTrend}`,
    `<b>1d Supertrend：</b>${metrics.supertrend1dTrend}`,
  ].join("\n");
}
