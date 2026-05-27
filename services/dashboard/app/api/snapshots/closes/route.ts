import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Serve the most recent N close events.  Supports an optional ?trader=<pubkey>
 * filter for the portfolio page.  Always returned newest-first.
 *
 * See ../market/route.ts for the proxy/local-fallback rationale.  Note that
 * trader filtering is done on this side regardless of which mode we're in —
 * the indexer's /snapshots/closes returns raw records, we slice + filter
 * here so both modes have identical observable behavior.
 */

export const dynamic = "force-dynamic";

const LOCAL_DATA_PATH = path.join(
  process.cwd(),
  "..",
  "indexer",
  "data",
  "closes.jsonl",
);

type CloseRecord = { trader?: string; [k: string]: unknown };

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const trader = searchParams.get("trader");
  const limit = Number(searchParams.get("limit") ?? "50");

  // When filtering by trader we want a generous upstream pull so the per-
  // trader filter doesn't end up with too few matches.  When not filtering,
  // the upstream limit is what the caller asked for.
  const upstreamLimit = trader ? Math.max(limit * 10, 500) : limit;

  let records: CloseRecord[] = [];

  const indexerUrl = process.env.INDEXER_URL;
  if (indexerUrl) {
    try {
      const upstream = await fetch(
        `${indexerUrl.replace(/\/$/, "")}/snapshots/closes?limit=${upstreamLimit}`,
        { cache: "no-store", signal: AbortSignal.timeout(8000) },
      );
      if (!upstream.ok) {
        return Response.json(
          { error: `upstream ${upstream.status}` },
          { status: 502 },
        );
      }
      records = (await upstream.json()) as CloseRecord[];
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  } else {
    if (!fs.existsSync(LOCAL_DATA_PATH)) {
      return Response.json([]);
    }
    try {
      const lines = fs
        .readFileSync(LOCAL_DATA_PATH, "utf-8")
        .split("\n")
        .filter(Boolean);
      records = lines.map((l) => JSON.parse(l) as CloseRecord);
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  if (trader) records = records.filter((r) => r.trader === trader);
  return Response.json(records.slice(-limit).reverse());
}
