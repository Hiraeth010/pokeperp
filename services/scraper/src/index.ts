/**
 * Pokeperp scraper service.
 *
 * v2: Oxylabs Web Scraper API edition.
 *
 * We POST an eBay sold-listings search URL to https://realtime.oxylabs.io/v1/queries,
 * Oxylabs handles IP rotation + JS rendering + CAPTCHA + fingerprint warfare,
 * and we get back ~3MB of rendered HTML.  We parse the result cards out of it
 * with cheerio (much cheaper than Playwright + Chromium) and return a JSON
 * array of `SoldListing` records to the Rust publisher.
 *
 * Why this design vs. self-hosted Playwright:
 *   - Cost: ~$2 per 1000 successful requests vs. ~$300/mo for residential proxies
 *     (and we don't need a Chromium container on Railway).
 *   - Reliability: Oxylabs claims 99%+ success-rate SLA; we observed
 *     self-hosted Playwright getting IP-banned after 4 requests.
 *   - Maintenance: parser logic stays here (and matches the same regex/filter
 *     pipeline in services/publisher/src/methodology.rs).  IP/fingerprint
 *     warfare is Oxylabs' job.
 *
 * Endpoints:
 *   GET /health
 *   GET /scrape?q=<query>&days=<lookback>
 *
 * Env vars (required):
 *   OXYLABS_USER, OXYLABS_PASS — Web Scraper API credentials.
 * Env vars (optional):
 *   PORT (default 3002)
 *   OXYLABS_GEO (default "United States" — eBay US storefront filtering)
 */

import * as http from "node:http";
import * as cheerio from "cheerio";

const HTTP_PORT = Number(process.env.PORT ?? "3002");
const OXYLABS_USER = process.env.OXYLABS_USER ?? "";
const OXYLABS_PASS = process.env.OXYLABS_PASS ?? "";
const OXYLABS_GEO = process.env.OXYLABS_GEO ?? "United States";

if (!OXYLABS_USER || !OXYLABS_PASS) {
  console.error(
    "FATAL: OXYLABS_USER and OXYLABS_PASS env vars are required. " +
      "Get them from https://dashboard.oxylabs.io/ → Web Scraper API → Authorize.",
  );
  process.exit(1);
}

interface SoldListing {
  listing_id: string;
  raw_title: string;
  /** Item price in micro-USDC (1 USD = 1_000_000). Matches the Rust struct. */
  price_microusdc: number;
  /** Shipping cost in micro-USDC, 0 if free shipping or unknown. */
  shipping_microusdc: number;
  /** Unix seconds when the sale completed (best-effort). */
  sold_at_unix: number;
  source: string;
  buyer_hash: string | null;
  seller_hash: string | null;
}

function parsePrice(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const usd = parseFloat(cleaned);
  if (!isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * 1_000_000);
}

/** Parse eBay sold-date strings into a unix timestamp.  Best-effort — falls
 *  back to "now" if unparseable so we don't drop the listing entirely.  The
 *  publisher's window filter will weed out stale stragglers via the methodology
 *  pipeline (services/publisher/src/methodology.rs::compute_constituent). */
function parseSoldDate(s: string | null | undefined): number {
  if (!s) return Math.floor(Date.now() / 1000);
  const now = Date.now();

  // Absolute: "Sold Oct 15, 2025" / "Oct 15, 2025"
  const absMatch = s.match(/([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})/);
  if (absMatch) {
    const d = new Date(`${absMatch[1]} ${absMatch[2]}, ${absMatch[3]}`);
    if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  }

  // Relative: "Sold 3 days ago" / "1 hour ago" / "2 weeks ago"
  const relMatch = s.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const ms =
      unit === "minute"
        ? n * 60_000
        : unit === "hour"
          ? n * 3_600_000
          : unit === "day"
            ? n * 86_400_000
            : unit === "week"
              ? n * 7 * 86_400_000
              : n * 30 * 86_400_000;
    return Math.floor((now - ms) / 1000);
  }

  return Math.floor(now / 1000);
}

function buildEbayUrl(query: string): string {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: "1",
    LH_Complete: "1",
    LH_PrefLoc: "1",
    _ipg: "240",
    _sop: "13",
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/** Submit one search URL to Oxylabs, return raw HTML. */
async function fetchViaOxylabs(url: string): Promise<string> {
  const resp = await fetch("https://realtime.oxylabs.io/v1/queries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " +
        Buffer.from(`${OXYLABS_USER}:${OXYLABS_PASS}`).toString("base64"),
    },
    body: JSON.stringify({
      source: "universal",
      url,
      render: "html",
      geo_location: OXYLABS_GEO,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!resp.ok) {
    throw new Error(`oxylabs HTTP ${resp.status}: ${await resp.text()}`);
  }

  const payload = (await resp.json()) as {
    results?: Array<{ status_code: number; content?: string; url?: string }>;
    errors?: unknown;
  };
  if (payload.errors) {
    throw new Error(`oxylabs errors: ${JSON.stringify(payload.errors)}`);
  }
  const first = payload.results?.[0];
  if (!first) throw new Error("oxylabs: no results in response");
  if (first.status_code !== 200) {
    throw new Error(`oxylabs upstream status ${first.status_code}`);
  }
  return first.content ?? "";
}

/** Parse eBay search HTML into listing records.  Selectors verified 2026-05-27;
 *  if they ever rot, the parser logs the card count it found so debugging is
 *  fast.  All filtering (PSA 10 regex, variant matching, English-only,
 *  trimmed mean) is downstream in services/publisher/src/methodology.rs. */
function parseEbayHtml(html: string): SoldListing[] {
  const $ = cheerio.load(html);
  const cards = $("li[data-listingid]");
  const out: SoldListing[] = [];

  cards.each((_, el) => {
    try {
      const $card = $(el);
      const title = $card.find(".s-item__title, .s-card__title, span[role='heading']").first().text().trim();
      if (!title || title === "Shop on eBay") return;

      const priceText = $card.find(".s-item__price, .s-card__price").first().text().trim();
      const price_microusdc = parsePrice(priceText);
      if (price_microusdc === 0) return;

      let shipping_microusdc = 0;
      const shipText = $card.find(".s-item__shipping, .s-card__shipping").first().text().trim();
      if (shipText && !/free/i.test(shipText)) {
        shipping_microusdc = parsePrice(shipText);
      }

      const soldText = $card
        .find(".s-item__caption, .s-card__caption, .s-item__detail")
        .first()
        .text()
        .trim();
      const sold_at_unix = parseSoldDate(soldText);

      // listing_id: prefer the data-listingid attribute, fall back to URL parse.
      let listing_id = ($card.attr("data-listingid") || "").trim();
      if (!listing_id) {
        const href = $card.find("a[href*='itm/']").first().attr("href") ?? "";
        const m = href.match(/itm\/(\d+)/) ?? href.match(/item(\d+)/);
        listing_id = m ? m[1] : `${Date.now()}-${out.length}`;
      }

      out.push({
        listing_id,
        raw_title: title,
        price_microusdc,
        shipping_microusdc,
        sold_at_unix,
        source: "ebay_oxylabs",
        buyer_hash: null,
        seller_hash: null,
      });
    } catch {
      // One bad card shouldn't kill the batch; min_sample_size downstream
      // catches under-sampled queries.
    }
  });

  return out;
}

async function scrape(query: string): Promise<SoldListing[]> {
  const url = buildEbayUrl(query);
  console.log(`  → ${url.slice(0, 90)}...`);
  const html = await fetchViaOxylabs(url);
  console.log(`  ← ${html.length} bytes`);
  const listings = parseEbayHtml(html);
  console.log(`  parsed ${listings.length} listings`);
  return listings;
}

// ===== HTTP server =====

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    res.end();
    return;
  }

  const parsed = new URL(req.url ?? "/", `http://${req.headers.host ?? "x"}`);
  try {
    switch (parsed.pathname) {
      case "/health":
        send(res, 200, { ok: true, ts: Date.now(), source: "oxylabs" });
        return;
      case "/scrape": {
        const q = parsed.searchParams.get("q");
        if (!q || q.length < 3) {
          send(res, 400, { error: "missing or too-short ?q param" });
          return;
        }
        const t0 = Date.now();
        try {
          const listings = await scrape(q);
          const ms = Date.now() - t0;
          console.log(`  ✓ ${listings.length} listings in ${ms}ms — ${q}`);
          send(res, 200, { query: q, listings, scraped_in_ms: ms });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`  ✗ ${q}: ${msg}`);
          send(res, 502, { query: q, error: msg });
        }
        return;
      }
      case "/":
        send(res, 200, {
          service: "pokeperp-scraper",
          backend: "oxylabs-web-scraper-api",
          endpoints: ["/health", "/scrape?q=<query>"],
        });
        return;
      default:
        send(res, 404, { error: "not found" });
    }
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`Pokeperp scraper (Oxylabs) — listening on :${HTTP_PORT}`);
  console.log(`  GET /health`);
  console.log(`  GET /scrape?q=<query>`);
});

process.on("SIGINT", () => {
  console.log("\nshutting down");
  server.close();
  process.exit(0);
});
