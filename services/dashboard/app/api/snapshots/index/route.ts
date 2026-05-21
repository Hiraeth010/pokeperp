import * as fs from "node:fs";
import * as path from "node:path";

export const dynamic = "force-dynamic";

const DATA_PATH = path.join(
  process.cwd(),
  "..",
  "indexer",
  "data",
  "index.jsonl"
);

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "200");

  if (!fs.existsSync(DATA_PATH)) {
    return Response.json([]);
  }
  try {
    const lines = fs
      .readFileSync(DATA_PATH, "utf-8")
      .split("\n")
      .filter(Boolean);
    const recent = lines.slice(-limit).map((l) => JSON.parse(l));
    return Response.json(recent);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
