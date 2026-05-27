import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Serve the most recent N IndexState snapshots.
 * See ../market/route.ts for the proxy/local-fallback rationale.
 */

export const dynamic = "force-dynamic";

const LOCAL_DATA_PATH = path.join(
  process.cwd(),
  "..",
  "indexer",
  "data",
  "index.jsonl",
);

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "200");

  const indexerUrl = process.env.INDEXER_URL;
  if (indexerUrl) {
    try {
      const upstream = await fetch(
        `${indexerUrl.replace(/\/$/, "")}/snapshots/index?limit=${limit}`,
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
