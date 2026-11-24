// Shared dataset loader: the kit's dev window, ALL 3 parts (the server dev
// window is the full 24h, not part-00000 alone). Extracted so backtest /
// oracle / sweep can all import it without re-running each other's main.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Dataset } from './sim.ts';

export function loadDatasetAll(kit: string, part: number | null = null): Dataset {
  const kitJson = JSON.parse(readFileSync(`${kit}/kit.json`, 'utf8'));
  const manifest = JSON.parse(readFileSync(`${kit}/dataset/manifest.json`, 'utf8'));
  const files: { path: string }[] = manifest.files;
  const parts = part === null ? files : [files[part]!];
  const { modulus, residue } = manifest.universe.sample;
  const excluded = new Set<string>(manifest.excluded_mints ?? []);
  const members = new Set<string>();
  const all: any[] = [];
  for (const f of parts) {
    const raw = gunzipSync(readFileSync(`${kit}/dataset/${f.path}`)).toString('utf8');
    for (const l of raw.split('\n')) if (l.length > 0) all.push(JSON.parse(l));
  }
  all.sort((a, b) => a.slot - b.slot || (a.chain_seq ?? 0) - (b.chain_seq ?? 0));
  const events: any[] = [];
  for (const e of all) {
    if (e.event === 'CreateEvent' && !members.has(e.mint)) {
      const h = BigInt('0x' + createHash('sha256').update(e.mint, 'utf8').digest('hex'));
      if (e.quote_mint === '11111111111111111111111111111111' && !e.is_mayhem_mode && !e.is_cashback_enabled && !excluded.has(e.mint) && h % BigInt(modulus) === BigInt(residue)) {
        members.add(e.mint);
      }
    }
    if (members.has(e.mint)) events.push(e);
  }
  const batches: { slot: number; events: any[] }[] = [];
  for (const e of events) {
    const tail = batches[batches.length - 1];
    if (tail !== undefined && tail.slot === e.slot) tail.events.push(e);
    else batches.push({ slot: e.slot, events: [e] });
  }
  const lastSlot = all.length > 0 ? all[all.length - 1].slot : 0;
  return { sha256: kitJson.dataset_sha256, events, endSlot: manifest.window?.end_slot ?? lastSlot, batches };
}
