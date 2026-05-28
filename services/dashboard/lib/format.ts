/**
 * Number / display helpers for the dashboard.
 * Index values come on-chain scaled by 1e6 (so 1000.000000 = 1_000_000_000).
 * USDC amounts are micro-USDC (6 decimals).
 */

const ONE_E6 = 1_000_000n;

/** Format a 1e6-scaled index value (BigInt) for display, e.g. 1_124_700_000n → "1124.70". */
export function formatIndex(value: bigint, decimals = 2): string {
  if (value === 0n) return "0.00";
  const whole = value / ONE_E6;
  const frac = value % ONE_E6;
  const fracStr = frac.toString().padStart(6, "0").slice(0, decimals);
  return `${whole}.${fracStr}`;
}

/** Format micro-USDC as USD string, e.g. 50_000_000_000n → "$50,000.00". */
export function formatUsdc(microUsdc: bigint, decimals = 2): string {
  const whole = microUsdc / ONE_E6;
  const frac = microUsdc % ONE_E6;
  const fracStr = frac.toString().padStart(6, "0").slice(0, decimals);
  return `$${formatWithCommas(whole.toString())}.${fracStr}`;
}

/** Format an absolute USD amount compactly: 1_234_567 → "1.23M". */
export function formatUsdCompact(microUsdc: bigint): string {
  const usd = Number(microUsdc / ONE_E6);
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
  return `$${usd.toFixed(0)}`;
}

/** "+2.34%" / "-1.22%" with appropriate sign. */
export function formatPct(pct: number, decimals = 2): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/** Compute pct change between current and base. Returns 0 if base is 0. */
export function pctChange(current: bigint, base: bigint): number {
  if (base === 0n) return 0;
  // (current - base) / base × 100, computed via Number once narrowed
  const cur = Number(current);
  const ba = Number(base);
  return ((cur - ba) / ba) * 100;
}

/** Human "time ago" from a duration in seconds, rolling minutes→hours→days:
 *  40 → "just now", 184min → "3h 4m ago", 1500min → "1d 1h ago". */
export function formatAgo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m ago` : `${h}h ago`;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}d ${remH}h ago` : `${d}d ago`;
}

/** Decode a fixed-size byte array into trimmed UTF-8 string (drops trailing zeros). */
export function bytesToString(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let end = arr.length;
  while (end > 0 && arr[end - 1] === 0) end--;
  return new TextDecoder().decode(arr.subarray(0, end));
}

function formatWithCommas(n: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
