import YahooFinance from "yahoo-finance2";
import TelegramBot from "node-telegram-bot-api";
import { screenerConfig } from "./config.js";
import { formatSignalMessage, formatSummaryMessage } from "./formatter.js";
import { loadState, saveState } from "./state.js";

const yf = new YahooFinance();
const telegram = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchQuote(ticker) {
  try {
    const q = await yf.quote(ticker);
    const summary = await yf.quoteSummary(ticker, {
      modules: ["summaryDetail"],
    });
    const price = q.regularMarketPrice;
    const low52 = q.fiftyTwoWeekLow;
    const high52 = q.fiftyTwoWeekHigh;
    const rawYield = summary.summaryDetail?.dividendYield;
    const dividendYield = rawYield ? rawYield * 100 : null;
    if (!price || !low52 || !high52) return null;
    const rangePos = (price - low52) / (high52 - low52);
    return {
      ticker, name: q.shortName || ticker,
      price, low52, high52, rangePos, dividendYield,
      currency: q.currency || "NOK",
      change1d: q.regularMarketChangePercent ?? null,
    };
  } catch (err) {
    console.error(`⚠️ ${ticker}: ${err.message}`);
    return null;
  }
}

async function fetchAllQuotes(tickers) {
  const results = [];
  for (const ticker of tickers) {
    const q = await fetchQuote(ticker);
    if (q) results.push(q);
    await sleep(800); // Vent 0.8 sekunder mellom hvert kall
  }
  return results;
}

function isSignal(q) {
  return q.rangePos < screenerConfig.rangeThreshold &&
    q.dividendYield !== null &&
    q.dividendYield >= screenerConfig.minYield;
}

async function runScreener() {
  const state = loadState();
  const tickers = state.tickers ?? screenerConfig.defaultTickers;
  const previousSignals = state.activeSignals ?? {};
  const now = new Date();
  console.log(`\n[${now.toLocaleTimeString("no-NO")}] Sjekker ${tickers.length} aksjer...`);
  const quotes = await fetchAllQuotes(tickers);
  console.log(`✅ Hentet data for ${quotes.length} aksjer`);
  const newSignals = {};
  const freshSignals = [];
  for (const q of quotes) {
    if (isSignal(q)) {
      newSignals[q.ticker] = true;
      if (!previousSignals[q.ticker]) freshSignals.push(q);
    }
  }
  for (const s of freshSignals) {
    await telegram.sendMessage(CHAT_ID, formatSignalMessage(s, null), { parse_mode: "Markdown" });
    console.log(`📲 Signal: ${s.ticker}`);
  }
  if (now.getHours() === 8 && now.getMinutes() < 2) {
    const activeSignals = quotes.filter(q => isSignal(q));
    await telegram.sendMessage(CHAT_ID, formatSummaryMessage(quotes, activeSignals, null), { parse_mode: "Markdown" });
    console.log("📊 Daglig oppsummering sendt");
  }
  state.activeSignals = newSignals;
  state.lastRun = now.toISOString();
  saveState(state);
}

async function setupCommands() {
  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
  bot.onText(/\/status/, async (msg) => {
    const state = loadState();
    const quotes = await fetchAllQuotes(state.tickers ?? screenerConfig.defaultTickers);
    await bot.sendMessage(msg.chat.id, formatSummaryMessage(quotes, quotes.filter(q => isSignal(q)), null), { parse_mode: "Markdown" });
  });
  bot.onText(/\/signaler/, async (msg) => {
    const state = loadState();
    const quotes = await fetchAllQuotes(state.tickers ?? screenerConfig.defaultTickers);
    const signals = quotes.filter(q => isSignal(q));
    if (signals.length === 0) {
      await bot.sendMessage(msg.chat.id, "Ingen aktive signaler akkurat nå 🔍");
    } else {
      for (const s of signals) {
        await bot.sendMessage(msg.chat.id, formatSignalMessage(s, null), { parse_mode: "Markdown" });
      }
    }
  });
  bot.onText(/\/hjelp/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
      `*AksjeBot – kommandoer*\n\n/status – Alle aksjer og range-posisjon\n/signaler – Aktive kjøpssignaler nå\n/hjelp – Denne listen`,
      { parse_mode: "Markdown" });
  });
  console.log("🤖 Kommandoer aktive");
}

async function main() {
  console.log("🚀 AksjeBot starter...");
  await telegram.sendMessage(CHAT_ID,
    `🚀 *AksjeBot er oppe!*\n\nOvervåker ${(loadState().tickers ?? screenerConfig.defaultTickers).length} aksjer.\nSjekker hvert ${screenerConfig.intervalMinutes} minutt.\n\nSkriv /hjelp for kommandoer.`,
    { parse_mode: "Markdown" });
  await setupCommands();
  await runScreener();
  setInterval(runScreener, screenerConfig.intervalMinutes * 60 * 1000);
}

main().catch(err => { console.error("Kritisk feil:", err); process.exit(1); });
