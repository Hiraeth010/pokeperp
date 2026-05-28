/**
 * Server-side Solana RPC proxy.
 *
 * The browser's `Connection` POSTs JSON-RPC here (same-origin), and we forward
 * to the real upstream read from a SERVER-ONLY env var (`RPC_URL`, e.g. the
 * Helius endpoint). This keeps the paid API key out of the client bundle —
 * unlike `NEXT_PUBLIC_RPC_URL`, which Next.js inlines into client JS.
 *
 * WebSocket subscriptions (account-change) can't be proxied through an HTTP
 * route; the client points those at a keyless public WS endpoint instead
 * (see WalletProvider `wsEndpoint`).
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const upstream = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const body = await req.text();

  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: `RPC proxy error: ${String(e)}` },
        id: null,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
