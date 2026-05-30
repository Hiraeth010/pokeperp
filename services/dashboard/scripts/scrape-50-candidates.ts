/**
 * One-shot scrape of 30 candidate cards for PMT50 (positions 26-50).
 * Calls the live Railway scraper service, filters sold listings to the
 * trailing 90 days, and produces a `count × median = dollar_volume` table
 * sorted descending. Output picks the top 25.
 *
 *   npx tsx scripts/scrape-50-candidates.ts
 */

const SCRAPER = process.env.SCRAPER_URL || "https://pokeperps-production.up.railway.app";
const NINETY_DAYS = 90 * 86400;
const NOW = Math.floor(Date.now() / 1000);
const DELAY_MS = 2000; // pacing between requests

type Candidate = { name: string; q: string; tag?: string };

const CANDIDATES: Candidate[] = [
  // ===== 151 set chase cards =====
  { name: "Mew ex SIR",                  q: "Pokemon Mew ex 205/165 SIR PSA 10",                  tag: "151" },
  { name: "Pikachu ex SIR (151)",        q: "Pokemon Pikachu ex 193/165 SIR PSA 10",              tag: "151" },
  { name: "Blastoise ex SIR",            q: "Pokemon Blastoise ex 200/165 SIR PSA 10",            tag: "151" },
  { name: "Venusaur ex SIR",             q: "Pokemon Venusaur ex 198/165 SIR PSA 10",             tag: "151" },
  { name: "Erika's Invitation SAR",      q: "Pokemon Erika's Invitation 203/165 SAR PSA 10",      tag: "151" },
  { name: "Alakazam ex SIR",             q: "Pokemon Alakazam ex 201/165 SIR PSA 10",             tag: "151" },

  // ===== Astral Radiance alt arts =====
  { name: "Origin Forme Palkia VSTAR AA", q: "Pokemon Origin Forme Palkia VSTAR 211/189 Alt Art PSA 10", tag: "AR" },
  { name: "Origin Forme Dialga VSTAR AA", q: "Pokemon Origin Forme Dialga VSTAR 209/189 Alt Art PSA 10", tag: "AR" },
  { name: "Hisuian Lilligant V AA",       q: "Pokemon Hisuian Lilligant V 207/189 Alt Art PSA 10",       tag: "AR" },
  { name: "Hisuian Goodra V AA",          q: "Pokemon Hisuian Goodra V 205/189 Alt Art PSA 10",          tag: "AR" },

  // ===== Other alt-art VSTARs =====
  { name: "Lugia VSTAR AA",              q: "Pokemon Lugia VSTAR 211/195 Alt Art PSA 10",         tag: "ST" },
  { name: "Giratina VSTAR AA",           q: "Pokemon Giratina VSTAR 213/196 Alt Art PSA 10",      tag: "LO" },
  { name: "Arceus VSTAR AA",             q: "Pokemon Arceus VSTAR 184/172 Alt Art PSA 10",        tag: "BS" },

  // ===== Pokemon GO =====
  { name: "Mewtwo VSTAR PGO Promo",      q: "Pokemon Mewtwo VSTAR Pokemon GO Promo Gold PSA 10",  tag: "PGO" },
  { name: "Radiant Charizard PGO",       q: "Pokemon Radiant Charizard 11/78 Pokemon GO PSA 10",  tag: "PGO" },

  // ===== Crown Zenith Galarian Gallery =====
  { name: "Charizard VSTAR CZ-GG",       q: "Pokemon Charizard VSTAR GG29/GG70 Crown Zenith PSA 10",  tag: "CZ-GG" },
  { name: "Pikachu VMAX CZ-GG",          q: "Pokemon Pikachu VMAX GG44/GG70 Crown Zenith PSA 10",     tag: "CZ-GG" },
  { name: "Rayquaza VMAX CZ-GG",         q: "Pokemon Rayquaza VMAX GG50/GG70 Crown Zenith PSA 10",    tag: "CZ-GG" },

  // ===== Obsidian Flames SIRs =====
  { name: "Tyranitar ex SIR (OF)",       q: "Pokemon Tyranitar ex 226/197 SIR Obsidian Flames PSA 10", tag: "OF" },
  { name: "Pidgeot ex SIR (OF)",         q: "Pokemon Pidgeot ex 217/197 SIR Obsidian Flames PSA 10",   tag: "OF" },

  // ===== Newer S&V SARs/SIRs =====
  { name: "Lance's Charizard ex SAR",    q: "Pokemon Lance's Charizard ex SAR Stellar Crown PSA 10",   tag: "SC" },
  { name: "Pecharunt ex SIR",            q: "Pokemon Pecharunt ex SIR Shrouded Fable PSA 10",          tag: "SF" },
  { name: "Boss's Orders SAR",           q: "Pokemon Boss's Orders SAR PSA 10",                        tag: "SAR" },
  { name: "Mela SAR (PR)",               q: "Pokemon Mela SAR Paradox Rift PSA 10",                    tag: "PR" },
  { name: "Penny SAR (PaF)",             q: "Pokemon Penny SAR Paldean Fates PSA 10",                  tag: "PaF" },
  { name: "Hydreigon ex SIR (TM)",       q: "Pokemon Hydreigon ex SIR Twilight Masquerade PSA 10",     tag: "TM" },
  { name: "Pikachu ex SIR (SS)",         q: "Pokemon Pikachu ex SIR Surging Sparks PSA 10",            tag: "SS" },

  // ===== Other =====
  { name: "Zacian V AA (CZ)",            q: "Pokemon Zacian V Alt Art Crown Zenith PSA 10",            tag: "CZ" },
  { name: "Pikachu V-UNION",             q: "Pokemon Pikachu V-UNION Celebrations PSA 10",             tag: "promo" },
  { name: "Iono SAR (PE) variant",       q: "Pokemon Iono SAR 269 Paldea Evolved PSA 10",              tag: "PE" },
];

type Row = {
  name: string;
  tag: string;
  count90d: number;
  median: number;
  dollarVolume: number;
  raw: number; // total listings returned (before 90d filter)
  err?: string;
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function scrape(c: Candidate): Promise<Row> {
  try {
    const url = `${SCRAPER}/scrape?q=${encodeURIComponent(c.q)}&days=90`;
    const res = await fetch(url);
    if (!res.ok) return { name: c.name, tag: c.tag ?? "", count90d: 0, median: 0, dollarVolume: 0, raw: 0, err: `http ${res.status}` };
    const j: any = await res.json();
    const all = (j.listings ?? []) as any[];
    const cutoff = NOW - NINETY_DAYS;
    const recent = all.filter((l) => Number(l.sold_at_unix) >= cutoff);
    const prices = recent.map((l) => Number(l.price_microusdc) / 1e6).filter((p) => p > 0);
    const med = median(prices);
    return {
      name: c.name,
      tag: c.tag ?? "",
      count90d: prices.length,
      median: med,
      dollarVolume: prices.length * med,
      raw: all.length,
    };
  } catch (e: any) {
    return { name: c.name, tag: c.tag ?? "", count90d: 0, median: 0, dollarVolume: 0, raw: 0, err: e?.message ?? String(e) };
  }
}

(async () => {
  console.log(`scraping ${CANDIDATES.length} candidates via ${SCRAPER}`);
  console.log(`90d cutoff: sold_at_unix >= ${NOW - NINETY_DAYS}\n`);
  const rows: Row[] = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    const c = CANDIDATES[i];
    process.stdout.write(`[${i + 1}/${CANDIDATES.length}] ${c.name} ... `);
    const r = await scrape(c);
    rows.push(r);
    if (r.err) console.log(`ERR ${r.err}`);
    else console.log(`90d=${r.count90d} median=$${r.median.toFixed(0)} vol=$${r.dollarVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} (raw=${r.raw})`);
    if (i < CANDIDATES.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  rows.sort((a, b) => b.dollarVolume - a.dollarVolume);
  console.log("\n================= RANKED (top to bottom by 90d $ vol) =================");
  console.log("rank | name                                | tag   | 90d cnt | median   | $vol".padEnd(80));
  console.log("-".repeat(95));
  rows.forEach((r, i) => {
    const mark = i < 25 ? "★" : " ";
    console.log(
      `${mark} ${(i + 1).toString().padStart(2)} | ${r.name.padEnd(36)} | ${r.tag.padEnd(5)} | ${r.count90d.toString().padStart(7)} | $${r.median.toFixed(0).padStart(7)} | $${r.dollarVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(9)}${r.err ? "  (" + r.err + ")" : ""}`
    );
  });
  console.log("\n★ = top 25 by validated 90-day eBay sold dollar volume");
})();
