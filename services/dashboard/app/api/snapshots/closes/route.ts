import * as fs from "node:fs";
import * as path from "node:path";

export const dynamic = "force-dynamic";

const DATA_PATH = path.join(
  process.cwd(),
  "..",
  "indexer",
  "data",
  "closes.jsonl"
);

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const trader = searchParams.get("trader");
  const limit = Number(searchParams.get("limit") ?? "50");

  if (!fs.existsSync(DATA_PATH)) {
    return Response.json([]);
  }
  try {
    const lines = fs
      .readFileSync(DATA_PATH, "utf-8")
      .split("\n")
      .filter(Boolean);
    let parsed = lines.map((l) => JSON.parse(l));
    if (trader) parsed = parsed.filter((p) => p.trader === trader);
    return Response.json(parsed.slice(-limit).reverse());
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
