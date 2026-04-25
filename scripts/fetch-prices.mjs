#!/usr/bin/env node
// scripts/fetch-prices.mjs
// CSVから日付・銘柄コードを抽出 → Yahoo Financeで1分足取得 → JSON保存

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = 'data';
const PRICES_DIR = 'data/prices';
const REQUEST_DELAY_MS = 1500;

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
  if (isCloseDetail) {
    headerIdx = lines.findIndex(l => l.startsWith('決済日'));
  } else {
    headerIdx = lines.findIndex(l => l.startsWith('約定日'));
  }
  if (headerIdx < 0) return [];

  const dataLines = lines.slice(headerIdx + 1).filter(l => l.trim() && l.includes('"'));
  const tickers = new Set();
  for (const line of dataLines) {
    const fields = parseCsvLine(line);
    let code = (fields[2] || '').trim();
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

function dateRangeForFetch(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayMid = Date.UTC(y, m - 1, d);
  const period1 = Math.floor((dayMid - 4 * 86400 * 1000) / 1000);
  const period2 = Math.floor((dayMid + 1.5 * 86400 * 1000) / 1000);
  return [period1, period2];
}

async function fetchYahoo(code, dateStr) {
  const symbol = `${code}.T`;
  const [p1, p2] = dateRangeForFetch(dateStr);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1m`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; X11) AppleWebKit/537.36 daytrade-journal/1.0',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    const errMsg = json?.chart?.error?.description || 'No result';
    throw new Error(errMsg);
  }
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const candles = ts.map((t, i) => ({
    t,
    o: q.open?.[i],
    h: q.high?.[i],
    l: q.low?.[i],
    c: q.close?.[i],
    v: q.volume?.[i],
  })).filter(c => c.o != null && c.c != null);
  return {
    symbol,
    timezone: result.meta?.exchangeTimezoneName || 'Asia/Tokyo',
    currency: result.meta?.currency || 'JPY',
    instrumentType: result.meta?.instrumentType,
    candles,
  };
}

async function main() {
  const csvs = await listTradeCsvs();
  console.log(`📂 Found ${csvs.length} CSV file(s)`);
  if (csvs.length === 0) return;

  await fs.mkdir(PRICES_DIR, { recursive: true });

  let totalNew = 0, totalCached = 0, totalFailed = 0;

  for (const csv of csvs) {
    let tickers;
    try {
      tickers = await extractTickers(csv.path);
    } catch (err) {
      console.error(`  ⚠️  ${csv.date}: parse error - ${err.message}`);
      continue;
    }
    if (tickers.length === 0) {
      console.log(`  ${csv.date}: no tickers`);
      continue;
    }
    console.log(`📅 ${csv.date}: ${tickers.join(', ')}`);

    const dateDir = path.join(PRICES_DIR, csv.date);
    await fs.mkdir(dateDir, { recursive: true });

    for (const code of tickers) {
      const outPath = path.join(dateDir, `${code}.json`);
      try {
        await fs.access(outPath);
        console.log(`  ✓ ${code}: cached`);
        totalCached++;
        continue;
      } catch {}

      try {
        const data = await fetchYahoo(code, csv.date);
        const dayCandles = data.candles.filter(c => {
          const d = new Date(c.t * 1000);
          const jst = new Date(d.getTime() + 9 * 3600 * 1000);
          return jst.toISOString().slice(0, 10) === csv.date;
        });
        if (dayCandles.length === 0) {
          console.log(`  ⚠️  ${code}: no candles for ${csv.date} (got ${data.candles.length} total)`);
          totalFailed++;
          continue;
        }
        await fs.writeFile(outPath, JSON.stringify({
          symbol: data.symbol,
          code,
          date: csv.date,
          timezone: data.timezone,
          currency: data.currency,
          source: 'yahoo',
          fetchedAt: new Date().toISOString(),
          candles: data.candles,
        }, null, 0));
        console.log(`  ✓ ${code}: ${dayCandles.length} day-candles, ${data.candles.length} total`);
        totalNew++;
        await sleep(REQUEST_DELAY_MS);
      } catch (err) {
        console.error(`  ❌ ${code}: ${err.message}`);
        totalFailed++;
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  console.log(`\n✅ Done: ${totalNew} new, ${totalCached} cached, ${totalFailed} failed`);
}

main().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
