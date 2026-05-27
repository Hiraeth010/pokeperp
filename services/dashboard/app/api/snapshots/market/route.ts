import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Serve the most recent N market snapshots.
 *
 * Two modes:
 *   - INDEXER_URL set (production on Vercel)  → proxy to the indexer's HTTP API
 *     (indexer runs on Railway, exposes /snapshots/market).
 *   - Not set (local dev)                      → read services/indexer/data/market.jsonl
 *     directly off the local filesystem.
 *
 * Same response shape either way: a JSON array of snapshot records.
 */

export const dynamic = "force-dynamic";

const LOCAL_DATA_PATH = path.join(
  process.cwd(),
  "..",
  "indexer",
  "data",
  "market.jsonl",
);

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "200");

  const indexerUrl = process.env.INDEXER_URL;
  if (indexerUrl) {
    try {
      const upstream = await fetch(
        `${indexerUrl.replace(/\/$/, "")}/snapshots/market?limit=${limit}`,
        { cache: "no-store", signal: AbortSignal.timeout(8000) },
      );
      if (!upstream.ok) {
        return Response.json(
          { error: `upstream ${upstream.status}` },
          { status: 502 },
        );
      }
      return Response.json(await upstream.json());
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  }

  if (!fs.existsSync(LOCAL_DATA_PATH)) {
    return Response.json([]);
  }
  try {
    const lines = fs
      .readFileSync(LOCAL_DATA_PATH, "utf-8")
      .split("\n")
      .filter(Boolean);
    const recent = lines.slice(-limit).map((l) => JSON.parse(l));
    return Response.json(recent);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
