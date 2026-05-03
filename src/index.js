import TelegramBot from "node-telegram-bot-api";
import { screenerConfig } from "./config.js";
import { formatSignalMessage, formatSummaryMessage } from "./formatter.js";
import { loadState, saveState } from "./state.js";

const telegram = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Konverter GOGL.OL → GOGL-NO (Euronext format)
function toEuronext(ticker) {
  return ticker.replace(".OL", "-NO");
}

async function fetchQuote(ticker) {
  try {
    const symbol = toEuronext(ticker);
    const url = `https://live.euronext.com/en/ajax/getDetailedQuote/${symbol}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" }
    });
    const data = await res.json();

    const price = parseFloat(data?.lastPrice);
    const high52 = parseFloat(data?.high52Week);
    const low52 = parseFloat(data?.low52Week);
    const name = data?.instrumentName || ticker;

    if (isNaN(price) || isNaN(high52) || isNaN(low52)) return null;
    const rangePos = (price - low52) / (high52 - low52);

    // Yield hentes separat
    const yieldUrl = `https://live.euronext.com/en/ajax/getInstrumentDividend/${symbol}`;
    const yRes = await fetch(yieldUrl, {
      headers: { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" }
    });
    const yData = await yRes.json();
    const rawYield = parseFloat(yData?.dividendYield);
    const dividendYield = !isNaN(rawYield) ? rawYield : null;

    return { ticker, name, price, low52, high52, rangePos, dividendYield, currency: "NOK" };
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
    await sleep(1000);
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
    const activeSignals = quotes.filter(isSignal);
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
    await bot.sendMessage(msg.chat.id, "⏳ Henter data, tar ca. 1 minutt...");
    const state = loadState();
    const quotes = await fetchAllQuotes(state.tickers ?? screenerConfig.defaultTickers);
    await bot.sendMessage(msg.chat.id, formatSummaryMessage(quotes, quotes.filter(isSignal), null), { parse_mode: "Markdown" });
  });
  bot.onText(/\/signaler/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "⏳ Henter data, tar ca. 1 minutt...");
    const state = loadState();
    const quotes = await fetchAllQuotes(state.tickers ?? screenerConfig.defaultTickers);
    const signals = quotes.filter(isSignal);
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
