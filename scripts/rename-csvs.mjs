#!/usr/bin/env node
// scripts/rename-csvs.mjs
// data/SaveFile_*.csv を CSV 内の決済日/約定日を読んで YYYY-MM-DD.csv にリネーム

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = 'data';

function decode(buffer) {
  for (const enc of ['utf-8', 'shift-jis', 'euc-jp']) {
    try {
      const decoder = new TextDecoder(enc, { fatal: false });
      const text = decoder.decode(buffer);
      if (text.includes('銘柄') && (text.includes('決済日') || text.includes('約定日'))) return text;
    } catch (e) {}
  }
  return null;
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

async function extractDate(csvPath) {
  const buf = await fs.readFile(csvPath);
  const text = decode(buf);
  if (!text) throw new Error('Cannot decode CSV');
  const lines = text.split(/\r?\n/);

  // Find header
  const isCloseDetail = text.includes('信用決済明細') || lines.some(l => l.startsWith('決済日'));
  let headerIdx;
  if (isCloseDetail) {
    headerIdx = lines.findIndex(l => l.startsWith('決済日'));
  } else {
    headerIdx = lines.findIndex(l => l.startsWith('約定日'));
  }
  if (headerIdx < 0) throw new Error('Header not found');

  // First data line
  const dataLines = lines.slice(headerIdx + 1).filter(l => l.trim() && l.includes('"'));
  if (dataLines.length === 0) throw new Error('No data rows');

  // Date is the first field in YYYY/MM/DD format
  const fields = parseCsvLine(dataLines[0]);
  const dateStr = fields[0];
  const m = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) throw new Error(`Invalid date format: ${dateStr}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

async function main() {
  let entries;
  try {
    entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`Cannot read ${DATA_DIR}: ${e.message}`);
    return;
  }

  // Find files that need renaming: anything ending in .csv that's not already YYYY-MM-DD.csv
  const candidates = entries
    .filter(e => e.isFile() && e.name.endsWith('.csv'))
    .filter(e => !/^\d{4}-\d{2}-\d{2}\.csv$/.test(e.name));

  if (candidates.length === 0) {
    console.log('✓ No files need renaming');
    return;
  }

  console.log(`📂 Found ${candidates.length} file(s) to rename`);

  for (const entry of candidates) {
    const oldPath = path.join(DATA_DIR, entry.name);
    try {
      const date = await extractDate(oldPath);
      const newName = `${date}.csv`;
      const newPath = path.join(DATA_DIR, newName);

      // Check if target already exists
      try {
        await fs.access(newPath);
        // Already exists - decide: replace if newer, otherwise keep both
        const oldStat = await fs.stat(oldPath);
        const newStat = await fs.stat(newPath);
        if (oldStat.mtimeMs > newStat.mtimeMs) {
          // Newer file uploaded - replace
          await fs.rename(oldPath, newPath);
          console.log(`  ↻ ${entry.name} → ${newName} (replaced older)`);
        } else {
          // Older or same - just delete the duplicate
          await fs.unlink(oldPath);
          console.log(`  ✗ ${entry.name}: duplicate of ${newName}, removed`);
        }
      } catch {
        // Target doesn't exist - simple rename
        await fs.rename(oldPath, newPath);
        console.log(`  ✓ ${entry.name} → ${newName}`);
      }
    } catch (err) {
      console.error(`  ❌ ${entry.name}: ${err.message}`);
    }
  }

  console.log('✅ Rename done');
}

main().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
