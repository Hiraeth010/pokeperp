/**
 * Shared RPC endpoint resolver for the local helper scripts.
 *
 * Resolution order:
 *   1. RPC_URL env var          (per-invocation override, e.g. localnet)
 *   2. RPC_URL in .env.devnet.local   (gitignored — where the Helius key lives)
 *   3. RPC_URL in .env.local
 *   4. public devnet            (fallback)
 *
 * The Helius API key is intentionally NOT in source — the repo is public. It
 * lives only in the gitignored .env.devnet.local. To run a script against
 * localnet instead: `RPC_URL=http://127.0.0.1:8899 npx tsx scripts/<name>.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

// dashboard dir = scripts/.. — resolve env files there regardless of cwd.
const DASHBOARD_DIR = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  ".."
);

function readEnvVar(file: string, key: string): string | undefined {
  try {
    const txt = fs.readFileSync(path.join(DASHBOARD_DIR, file), "utf8");
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Mask an api-key query param so the secret never lands in terminal/logs. */
function mask(u: string): string {
  return u.replace(/(api-key=)[^&\s]+/i, "$1****");
}

export function resolveRpc(): string {
  const sources: Array<[string, string | undefined]> = [
    ["env RPC_URL", process.env.RPC_URL],
    [".env.devnet.local", readEnvVar(".env.devnet.local", "RPC_URL")],
    [".env.local", readEnvVar(".env.local", "RPC_URL")],
  ];
  for (const [src, val] of sources) {
    if (val) {
      console.error(`[rpc] ${mask(val)} (from ${src})`);
      return val;
    }
  }
  const fallback = "https://api.devnet.solana.com";
  console.error(`[rpc] ${fallback} (default)`);
  return fallback;
}
