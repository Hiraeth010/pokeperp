/**
 * One-off experiment: find an Oxylabs config that doesn't fault (613) on the
 * heavy eBay sold-listing queries. Run with the service's creds injected:
 *   railway run --service Pokeperps -- npx tsx test-oxylabs.ts
 *
 * Compares: current (render=html, ipg=240) vs lighter variants. Prints upstream
 * status, content size, and a rough listing-card count for each.
 */
const USER = process.env.OXYLABS_USER ?? "";
const PASS = process.env.OXYLABS_PASS ?? "";
const GEO = process.env.OXYLABS_GEO ?? "United States";
if (!USER || !PASS) { console.error("no OXYLABS creds in env"); process.exit(1); }

const QUERIES = [
  "Pokemon Umbreon VMAX Evolving Skies 215 Alt Art PSA 10",
  "Pokemon Charizard VMAX Champions Path 74 PSA 10",
];

function ebayUrl(query: string, ipg: number): string {
  const p = new URLSearchParams({
    _nkw: query, LH_Sold: "1", LH_Complete: "1", LH_PrefLoc: "1",
    _ipg: String(ipg), _sop: "13",
  });
  return `https://www.ebay.com/sch/i.html?${p.toString()}`;
}

interface Cfg { name: string; render: boolean; ipg: number }
const CONFIGS: Cfg[] = [
  { name: "current (render=html, ipg=240)", render: true, ipg: 240 },
  { name: "render=html, ipg=60", render: true, ipg: 60 },
  { name: "NO render, ipg=60", render: false, ipg: 60 },
  { name: "NO render, ipg=120", render: false, ipg: 120 },
];

async function oxy(url: string, render: boolean): Promise<{ status: number | string; bytes: number; cards: number; ms: number }> {
  const body: Record<string, unknown> = { source: "universal", url, geo_location: GEO };
  if (render) body.render = "html";
  const t0 = Date.now();
  const resp = await fetch("https://realtime.oxylabs.io/v1/queries", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64") },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - t0;
  if (!resp.ok) return { status: `HTTP ${resp.status}`, bytes: 0, cards: 0, ms };
  const payload = (await resp.json()) as { results?: Array<{ status_code: number; content?: string }> };
  const first = payload.results?.[0];
  const content = first?.content ?? "";
  const cards = (content.match(/data-listingid/g) ?? []).length;
  return { status: first?.status_code ?? "none", bytes: content.length, cards, ms };
}

async function main(): Promise<void> {
  for (const q of QUERIES) {
    console.log(`\n### ${q}`);
    for (const c of CONFIGS) {
      try {
        const r = await oxy(ebayUrl(q, c.ipg), c.render);
        console.log(`  ${c.name.padEnd(34)} status=${String(r.status).padEnd(5)} ${(r.bytes/1024).toFixed(0).padStart(5)}KB  cards=${String(r.cards).padStart(4)}  ${r.ms}ms`);
      } catch (e) {
        console.log(`  ${c.name.padEnd(34)} THREW: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
