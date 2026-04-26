#!/usr/bin/env node
// scripts/fetch-prices.mjs
// CSVから日付・銘柄コードを抽出 → Yahoo Financeで1分足取得 → JSON保存
// 既存ファイルがあれば上書きしない（手動で作成したデータを保護）

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = 'data';
const PRICES_DIR = 'data/prices';
const REQUEST_DELAY_MS = 1500; // Be gentle with Yahoo

// ── Helpers ──────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function decode(buffer) {
  for (const enc of ['utf-8', 'shift-jis', 'euc-jp']) {
    try {
      const decoder = new TextDecoder(enc, { fatal: false });
      const text = decoder.decode(buffer);
      if (text.includes('銘柄') && (text.includes('決済日') || text.includes('約定日'))) return text;
    } catch (e) {}
  }
  throw new Error('Cannot decode CSV');
}

function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields.map(f => f.trim().replace(/^"|"$/g, ''));
}

async function extractTickers(csvPath) {
  const buf = await fs.readFile(csvPath);
  const text = decode(buf);
  const lines = text.split(/\r?\n/);

  const isCloseDetail = text.includes('信用決済明細') || lines.some(l => l.startsWith('決済日'));
  let headerIdx;
  let codeColumnIdx;
  if (isCloseDetail) {
    headerIdx = lines.findIndex(l => l.startsWith('決済日'));
    codeColumnIdx = 2;
  } else {
    headerIdx = lines.findIndex(l => l.startsWith('約定日'));
    codeColumnIdx = 2;
  }
  if (headerIdx < 0) return [];

  const dataLines = lines.slice(headerIdx + 1).filter(l => l.trim() && l.includes('"'));
  const tickers = new Set();
  for (const line of dataLines) {
    const fields = parseCsvLine(line);
    let code = (fields[codeColumnIdx] || '').replace(/^"|"$/g, '').trim();
    if (code && /^\d{4,5}$/.test(code)) tickers.add(code);
  }
  return [...tickers];
}

async function listTradeCsvs() {
  let entries;
  try {
    entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`Cannot read ${DATA_DIR}: ${e.message}`);
    return [];
  }
  return entries
    .filter(e => e.isFile() && /^\d{4}-\d{2}-\d{2}\.csv$/.test(e.name))
    .map(e => ({
      date: e.name.replace('.csv', ''),
      path: path.join(DATA_DIR, e.name),
    }));
}

// ── Yahoo Finance ────────────────────────────────────────────────
function dateRangeForFetch(dateStr) {
  // dateStr is the target trading date in JST (YYYY-MM-DD)
  // We want to fetch from ~5 days before through the day after, in UTC seconds.
  const [y, m, d] = dateStr.split('-').map(Number);
  // JST 00:00 of target date = (target_date - 9h) UTC
  const targetJstMidnightUtc = Date.UTC(y, m - 1, d) - 9 * 3600 * 1000;
  const period1 = Math.floor((targetJstMidnightUtc - 5 * 86400 * 1000) / 1000);
  const period2 = Math.floor((targetJstMidnightUtc + 1.5 * 86400 * 1000) / 1000);
  return [period1, period2];
}

async function fetchYahoo(code, dateStr) {
  const symbol = `${code}.T`;
  const [p1, p2] = dateRangeForFetch(dateStr);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1m`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; X11) AppleWebKit/537.36 daytrade-journal/1.0',
    },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}: ${symbol}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${symbol}`);
  const ts = result.timestamp || [];
  const ind = result.indicators?.quote?.[0] || {};
  const candles = ts.map((t, i) => ({
    t,
    o: ind.open?.[i],
    h: ind.high?.[i],
    l: ind.low?.[i],
    c: ind.close?.[i],
    v: ind.volume?.[i],
  })).filter(c => c.o != null && c.c != null);
  return { symbol, candles };
}

function filterCandlesForDate(candles, targetDateStr) {
  // Keep only candles within target date + 4 prior days (for BB warmup)
  const targetDate = new Date(targetDateStr + 'T00:00:00Z');
  const oneDayMs = 86400 * 1000;
  return candles.filter(c => {
    const jst = new Date((c.t + 9 * 3600) * 1000);
    const dateStr = jst.toISOString().slice(0, 10);
    const candleDate = new Date(dateStr + 'T00:00:00Z');
    const diffDays = (targetDate - candleDate) / oneDayMs;
    return diffDays >= 0 && diffDays <= 4;
  });
}

// ── Main ────────────────────────────────────────────────────────
async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function main() {
  const csvs = await listTradeCsvs();
  console.log(`Found ${csvs.length} CSV file(s)`);

  for (const csv of csvs) {
    const codes = await extractTickers(csv.path);
    console.log(`\n[${csv.date}] tickers: ${codes.join(', ') || '(none)'}`);

    const outDir = path.join(PRICES_DIR, csv.date);
    await fs.mkdir(outDir, { recursive: true });

    for (const code of codes) {
      const outPath = path.join(outDir, `${code}.json`);
      
      // ★ Skip if file already exists (protect manual data)
      if (await fileExists(outPath)) {
        console.log(`  ⏭  ${code}: existing file kept (skipped)`);
        continue;
      }
      
      try {
        const { symbol, candles } = await fetchYahoo(code, csv.date);
        const filtered = filterCandlesForDate(candles, csv.date);
        const out = {
          symbol,
          code,
          date: csv.date,
          timezone: 'Asia/Tokyo',
          currency: 'JPY',
          source: 'yahoo',
          fetchedAt: new Date().toISOString(),
          candles: filtered,
        };
        await fs.writeFile(outPath, JSON.stringify(out));
        console.log(`  ✓ ${code}: ${filtered.length} candles → ${outPath}`);
      } catch (e) {
        console.error(`  ✗ ${code}: ${e.message}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
