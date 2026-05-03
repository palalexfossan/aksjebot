function rangeBar(pos, width = 10) {
  const filled = Math.round(pos * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

export function formatSignalMessage(q, aiAnalysis) {
  const pos = (q.rangePos * 100).toFixed(0);
  const lines = [
    `⚡ *KJØPSSIGNAL – ${q.ticker.replace(".OL", "")}*`,
    `_${q.name}_`,
    ``,
    `💰 Yield:        *${q.dividendYield?.toFixed(1)}%*`,
    `📈 Kurs:         ${q.price.toFixed(2)} ${q.currency}`,
    `📊 Range-pos:    ${rangeBar(q.rangePos)} ${pos}%`,
    `📉 52u-lav:      ${q.low52.toFixed(2)}`,
    `📈 52u-høy:      ${q.high52.toFixed(2)}`,
    q.change1d != null
      ? `🔄 Dagsendring:  ${q.change1d >= 0 ? "+" : ""}${q.change1d.toFixed(2)}%`
      : null,
  ].filter(Boolean).join("\n");
  return lines;
}

export function formatSummaryMessage(allQuotes, signals, aiAnalysis) {
  const header = `📊 *Daglig oppsummering – ${new Date().toLocaleDateString("no-NO")}*\n`;
  const signalSection = signals.length > 0
    ? `\n🟢 *Aktive signaler (${signals.length}):*\n` +
      signals.map(s =>
        `• *${s.ticker.replace(".OL","")}* – yield ${s.dividendYield?.toFixed(1)}%, pos ${(s.rangePos * 100).toFixed(0)}%`
      ).join("\n")
    : `\n⚪ Ingen aktive signaler akkurat nå`;

  const watchSection = `\n\n👀 *Nærmer seg signal (<40%):*\n` +
    allQuotes
      .filter(q => q.rangePos >= 0.30 && q.rangePos < 0.40 && q.dividendYield >= 6)
      .sort((a, b) => a.rangePos - b.rangePos)
      .slice(0, 5)
      .map(s => `• ${s.ticker.replace(".OL","")} – ${(s.rangePos * 100).toFixed(0)}% – yield ${s.dividendYield?.toFixed(1)}%`)
      .join("\n") || "  –";

  return header + signalSection + watchSection;
}
