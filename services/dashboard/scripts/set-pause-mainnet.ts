/**
 * Set trading/funding pause on the mainnet market, signed by the admin key.
 * Works while Market.admin is the deploy wallet (i.e. BEFORE the Squad
 * migration). Once admin is the Squad, route set_pause through the multisig
 * instead.
 *
 * Enable trading (the go-live flip, after insurance is seeded):
 *   RPC_URL="<mainnet>" PAUSE=false WALLET_PATH="../../mainnet-keys/deploy.json" \
 *     npx tsx scripts/set-pause-mainnet.ts
 * Re-pause (emergency):
 *   ... PAUSE=true REASON=2 ...
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "node:fs";
import PerpIdl from "../lib/idl/perp_engine.json";
import type { PerpEngine } from "../lib/idl/perp_engine";
import { resolveRpc } from "./rpc";

const RPC = resolveRpc();
const WALLET_PATH = process.env.WALLET_PATH ?? "../../mainnet-keys/deploy.json";
const TRADING_PAUSED = (process.env.PAUSE ?? "true") === "true";
const FUNDING_PAUSED = (process.env.FUNDING_PAUSE ?? "false") === "true";
const REASON = Number(process.env.REASON ?? "0");
const kp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));

async function main(): Promise<void> {
  if (!RPC.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${RPC})`);
  const admin = kp(WALLET_PATH);
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
  const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);
  const marketPda = PublicKey.findProgramAddressSync([Buffer.from("market")], perp.programId)[0];

  console.log(`set_pause(trading_paused=${TRADING_PAUSED}, funding_paused=${FUNDING_PAUSED}, reason=${REASON})`);
  const sig = await perp.methods
    .setPause(TRADING_PAUSED, FUNDING_PAUSED, REASON)
    .accounts({ market: marketPda, admin: admin.publicKey } as never)
    .rpc();
  const mkt = await perp.account.market.fetch(marketPda);
  console.log(`✓ trading_paused is now ${mkt.tradingPaused} ${mkt.tradingPaused ? "🔒" : "🟢 TRADING OPEN"}`);
  console.log("tx:", sig);
}

main().catch((e) => { console.error(e); process.exit(1); });
