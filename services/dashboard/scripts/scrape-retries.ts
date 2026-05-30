// Retry pass for the 6 candidates whose initial queries didn't match well.
const SCRAPER = process.env.SCRAPER_URL || "https://pokeperps-production.up.railway.app";
const NINETY = 90 * 86400;
const NOW = Math.floor(Date.now() / 1000);
const RETRY: Array<{ name: string; q: string }> = [
  { name: "Origin Forme Palkia VSTAR AA", q: "Pokemon Origin Forme Palkia VSTAR Astral Radiance Alt Art PSA 10" },
  { name: "Origin Forme Dialga VSTAR AA", q: "Pokemon Origin Forme Dialga VSTAR Astral Radiance Alt Art PSA 10" },
  { name: "Hisuian Lilligant V AA",       q: "Pokemon Hisuian Lilligant V Astral Radiance Alt Art PSA 10" },
  { name: "Hisuian Goodra V AA",          q: "Pokemon Hisuian Goodra V Astral Radiance Alt Art PSA 10" },
  { name: "Lugia VSTAR AA (ST)",          q: "Pokemon Lugia VSTAR Silver Tempest Alt Art PSA 10" },
  { name: "Pidgeot ex SIR (OF) — retry",  q: "Pokemon Pidgeot ex Special Illustration Rare Obsidian Flames PSA 10" },
];
const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length & 1 ? s[m] : (s[m-1]+s[m])/2; };

(async () => {
  for (const c of RETRY) {
    const url = `${SCRAPER}/scrape?q=${encodeURIComponent(c.q)}&days=90`;
    const j: any = await (await fetch(url)).json();
    const recent = (j.listings ?? []).filter((l: any) => Number(l.sold_at_unix) >= NOW - NINETY);
    const prices = recent.map((l: any) => Number(l.price_microusdc) / 1e6).filter((p: number) => p > 0);
    const med = median(prices);
    const vol = prices.length * med;
    console.log(`${c.name.padEnd(38)} 90d=${prices.length.toString().padStart(3)} median=$${med.toFixed(0).padStart(6)} vol=$${vol.toLocaleString(undefined,{maximumFractionDigits:0}).padStart(10)}  (q="${c.q}")`);
    await new Promise(r => setTimeout(r, 1500));
  }
})();
