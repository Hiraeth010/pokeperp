/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/perp_engine.json`.
 */
export type PerpEngine = {
  "address": "Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa",
  "metadata": {
    "name": "perpEngine",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Pokeperp perp engine program"
  },
  "instructions": [
    {
      "name": "addMargin",
      "docs": [
        "Add margin to an open position. No checks beyond non-zero — only ever helps the position.",
        "Spec: docs/perp-engine.md §5."
      ],
      "discriminator": [
        211,
        238,
        238,
        90,
        223,
        228,
        228,
        76
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "position",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "marginVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "traderUsdcAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "autoDeleverage",
      "docs": [
        "Force-close a profitable position when the insurance fund is below floor.",
        "Spec: docs/perp-engine.md §8.",
        "",
        "Ranking is enforced via witness positions passed in `remaining_accounts`:",
        "every witness must be on the SAME side as the candidate, belong to this",
        "market, and have a strictly lower current PnL (computed at the same",
        "index_price snapshot). v0.4 requires ≥ 1 witness — this gives a",
        "probabilistic \"candidate is high-ranked\" guarantee, not \"globally",
        "highest\". The off-chain crank picks N witnesses to make the proof",
        "statistically convincing; v0.5 could require N ≥ K with K tied to the",
        "total open-position count.",
        "",
        "v0.4 simplifications carried over from v0.1:",
        "- Closes at current index price (no mark slippage), no penalty.",
        "- Pays out margin + pnl to the ADL'd trader (no haircut — a v0.5",
        "improvement is to haircut the payout to actually restore insurance)."
      ],
      "discriminator": [
        210,
        69,
        163,
        148,
        44,
        245,
        226,
        170
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "docs": [
            "Anyone can call when insurance is below floor."
          ],
          "signer": true
        },
        {
          "name": "trader",
          "docs": [
            "Trader whose position is being ADL'd."
          ],
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "marginVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "traderUsdcAccount",
          "writable": true
        },
        {
          "name": "insuranceFund",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "indexState"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closePosition",
      "docs": [
        "Close an open position in full. Pays out margin + PnL (or 0 if underwater).",
        "Margin vault and Position account are both closed; their rent goes to the trader.",
        "Spec: docs/perp-engine.md §3 (close uses mark price), §5 (margin payout)."
      ],
      "discriminator": [
        123,
        134,
        81,
        0,
        49,
        68,
        98,
        98
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "position",
          "docs": [
            "Closed at end of instruction; rent flows to trader."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "marginVault",
          "docs": [
            "Margin vault PDA; authority = position PDA. Closed inside the handler."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "traderUsdcAccount",
          "docs": [
            "Trader's USDC destination for payout."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "insuranceFund",
          "docs": [
            "Insurance fund metadata — tracks total_deposited / total_paid_out across closes."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "docs": [
            "Insurance vault — receives loss sweeps + 10% close fee, source of win top-ups.",
            "Authority = insurance_fund PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "docs": [
            "Treasury vault — receives 90% close fee on close."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury metadata — total_received bumped by the close-fee treasury share."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "indexState"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initializeInsuranceFund",
      "docs": [
        "Initialize the InsuranceFund metadata PDA and the InsuranceVault token account.",
        "Independent of `initialize_market` — can be called before or after.",
        "Spec: docs/perp-engine.md §7."
      ],
      "discriminator": [
        2,
        239,
        39,
        87,
        50,
        28,
        108,
        12
      ],
      "accounts": [
        {
          "name": "insuranceFund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeMarket",
      "docs": [
        "Initialize the Market PDA only. Insurance fund is created separately via",
        "`initialize_insurance_fund` (split to keep `try_accounts` under Solana's 4KB stack cap",
        "— three init accounts in one ix overflowed by ~100 bytes).",
        "Spec: docs/perp-engine.md §2, §9, §11."
      ],
      "discriminator": [
        35,
        35,
        189,
        193,
        155,
        48,
        170,
        203
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "Mint is read for validation only (Market stores its pubkey); not initialized here."
          ]
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initializeMarketParams"
            }
          }
        }
      ]
    },
    {
      "name": "initializeTreasury",
      "docs": [
        "Initialize the Treasury metadata PDA and the TreasuryVault token account.",
        "Receives the 90% protocol share of taker fees from open + close.",
        "Spec: docs/perp-engine.md §9."
      ],
      "discriminator": [
        124,
        186,
        211,
        195,
        85,
        165,
        129,
        166
      ],
      "accounts": [
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "liquidate",
      "docs": [
        "Liquidate a position that has breached maintenance margin.",
        "Anyone can call. `liq_ref_price` favors the liquidatee",
        "(min of index and mark_twap_5min for longs, max for shorts).",
        "Penalty 1.5% of notional: 1/3 to liquidator, 2/3 to insurance fund.",
        "Spec: docs/perp-engine.md §6."
      ],
      "discriminator": [
        223,
        179,
        226,
        125,
        48,
        46,
        39,
        74
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "liquidator",
          "docs": [
            "Anyone can liquidate."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "trader",
          "docs": [
            "Trader being liquidated. Rent from closed accounts flows here."
          ],
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "marginVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "traderUsdcAccount",
          "writable": true
        },
        {
          "name": "liquidatorUsdcAccount",
          "writable": true
        },
        {
          "name": "insuranceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "insuranceFund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "indexState"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "modifyPosition",
      "docs": [
        "Modify an existing position by `delta_size` (same-side only in v0.2; no flips).",
        "Spec: docs/perp-engine.md §3 execution.",
        "",
        "v0.2 flow:",
        "- Settles per-position funding (against OLD size) into the insurance vault",
        "BEFORE changing size, so funding accrued on the pre-modify size doesn't",
        "leak when the post-modify size carries the old snapshot forward.",
        "- Re-snapshots `cumulative_funding_snapshot` to current so the next close",
        "/ modify only sees post-modify funding.",
        "- Updates mark TWAPs with the post-modify mark.",
        "",
        "Still v0.2 simplifications:",
        "- Same-side only (delta must not change the sign of position.size)",
        "- No price-PnL realization on partial close, no entry-price weighted averaging",
        "- No taker fee",
        "- To flip side, the trader must close and reopen"
      ],
      "discriminator": [
        48,
        249,
        6,
        139,
        14,
        95,
        106,
        88
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "marginVault",
          "docs": [
            "Margin vault; authority = position PDA. Mutated during funding settlement."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "insuranceFund",
          "docs": [
            "Insurance fund metadata — total_deposited / total_paid_out updated by",
            "funding settlement."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "insuranceVault",
          "docs": [
            "Insurance vault — receives positive funding, source of negative funding.",
            "Authority = insurance_fund PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "indexState",
          "docs": [
            "Oracle index for the post-modify mark price computation."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "deltaSize",
          "type": "i64"
        }
      ]
    },
    {
      "name": "openPosition",
      "docs": [
        "Open a new perp position.",
        "Spec: docs/perp-engine.md §3 (trade execution), §5 (margin), §9 (caps)."
      ],
      "discriminator": [
        135,
        128,
        47,
        77,
        15,
        152,
        240,
        49
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "position",
          "docs": [
            "One position per (trader, market). Init fails if a position already exists."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "marginVault",
          "docs": [
            "Per-position margin vault PDA, authority = the position itself.",
            "Outbound transfers (close / liquidation) sign with position PDA seeds."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "traderUsdcAccount",
          "docs": [
            "Trader's USDC source — pays margin + fee."
          ],
          "writable": true
        },
        {
          "name": "insuranceVault",
          "docs": [
            "Insurance vault — receives 10% of the taker fee."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "insuranceFund",
          "docs": [
            "Insurance fund metadata — total_deposited tracks the cumulative inflow of",
            "taker fees + loss sweeps so the on-chain field matches actual vault balance."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  117,
                  114,
                  97,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "docs": [
            "Treasury vault — receives 90% of the taker fee (spec §9)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury metadata — total_received tracks cumulative protocol-share fees."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "indexState",
          "docs": [
            "Cross-program account: oracle program's IndexState.",
            "Anchor enforces ownership by the oracle program via the typed `Account<IndexState>`.",
            "Additional constraint pins it to the address recorded on Market at initialization."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "size",
          "type": "i64"
        },
        {
          "name": "margin",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setPause",
      "docs": [
        "Admin emergency pause / unpause for trading and funding.",
        "Spec: docs/perp-engine.md §10."
      ],
      "discriminator": [
        63,
        32,
        154,
        2,
        56,
        103,
        79,
        45
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "tradingPaused",
          "type": "bool"
        },
        {
          "name": "fundingPaused",
          "type": "bool"
        },
        {
          "name": "reason",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setPhase",
      "docs": [
        "Advance phase parameters per phase schedule.",
        "Spec: docs/perp-engine.md §11."
      ],
      "discriminator": [
        111,
        105,
        112,
        240,
        6,
        217,
        210,
        215
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newPhase",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settleFunding",
      "docs": [
        "Advance the market's cumulative funding accumulator.",
        "Anyone can call. Each hour elapsed since `last_funding_update` adds one rate's worth",
        "to the accumulator, capped at `funding_cap_per_hour_bps`. Positions read the accumulator",
        "at trade time (open/close) and settle their own accrual against `cumulative_funding_snapshot`.",
        "Spec: docs/perp-engine.md §4.",
        "",
        "v0.1 simplification: this only updates the global accumulator. Per-position settlement",
        "(transferring USDC between long and short positions) is deferred — close_position would",
        "need to apply the funding delta from `position.cumulative_funding_snapshot` to the payout."
      ],
      "discriminator": [
        11,
        251,
        12,
        161,
        199,
        228,
        133,
        87
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "indexState"
        }
      ],
      "args": []
    },
    {
      "name": "withdrawMargin",
      "docs": [
        "Withdraw margin (subject to IM check on post-withdrawal balance).",
        "Spec: docs/perp-engine.md §5."
      ],
      "discriminator": [
        124,
        222,
        8,
        141,
        181,
        108,
        15,
        176
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "position",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "marginVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "traderUsdcAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawTreasury",
      "docs": [
        "Admin-gated withdrawal from the protocol treasury. Transfers `amount`",
        "from the treasury vault to a specified recipient USDC account and bumps",
        "`total_paid_out` so the on-chain accounting stays consistent with the",
        "vault balance (deposited − paid_out == vault.amount).",
        "Spec: docs/perp-engine.md §9 (v0.4 governance carve-out).",
        "",
        "v0.4 simplification: only the Market.admin signs. A multisig / DAO",
        "governance hook is v0.5."
      ],
      "discriminator": [
        40,
        63,
        122,
        158,
        144,
        216,
        83,
        96
      ],
      "accounts": [
        {
          "name": "market",
          "docs": [
            "Market is read here only to enforce the admin constraint — only the",
            "market's admin can pull treasury funds."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "docs": [
            "Source of funds; authority is the Treasury PDA, so the handler signs",
            "the outbound transfer with [TREASURY_SEED, treasury.bump]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "recipientUsdcAccount",
          "docs": [
            "Destination USDC account — admin chooses any wallet they control or a",
            "downstream treasury manager. Constraint just pins the mint; ownership",
            "is admin's responsibility."
          ],
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "indexState",
      "discriminator": [
        39,
        84,
        33,
        207,
        234,
        99,
        126,
        210
      ]
    },
    {
      "name": "insuranceFund",
      "discriminator": [
        43,
        134,
        170,
        87,
        102,
        16,
        142,
        147
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "treasury",
      "discriminator": [
        238,
        239,
        123,
        238,
        89,
        1,
        168,
        253
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "tradingPaused",
      "msg": "Trading is currently paused"
    },
    {
      "code": 6001,
      "name": "fundingPaused",
      "msg": "Funding is currently paused"
    },
    {
      "code": 6002,
      "name": "positionTooLarge",
      "msg": "Position would exceed per-trader maximum"
    },
    {
      "code": 6003,
      "name": "oiCapExceeded",
      "msg": "Open interest cap would be exceeded on requested side"
    },
    {
      "code": 6004,
      "name": "insufficientMargin",
      "msg": "Insufficient margin for requested position"
    },
    {
      "code": 6005,
      "name": "positionNotLiquidatable",
      "msg": "Position is not currently liquidatable"
    },
    {
      "code": 6006,
      "name": "oracleNotReady",
      "msg": "Oracle index is not finalized for the current reference period"
    },
    {
      "code": 6007,
      "name": "oracleStale",
      "msg": "Oracle reports a stale index — trading restricted"
    },
    {
      "code": 6008,
      "name": "unauthorized",
      "msg": "Caller is not authorized"
    },
    {
      "code": 6009,
      "name": "withdrawalBlockedByMargin",
      "msg": "Withdrawal would drop margin below initial-margin requirement"
    },
    {
      "code": 6010,
      "name": "markPriceDeviation",
      "msg": "Mark price deviation exceeds circuit-breaker threshold"
    },
    {
      "code": 6011,
      "name": "insuranceBelowFloor",
      "msg": "Insurance fund is below floor — ADL required"
    },
    {
      "code": 6012,
      "name": "invalidConfig",
      "msg": "Market initialization parameters are invalid"
    },
    {
      "code": 6013,
      "name": "mathOverflow",
      "msg": "Mark price computation overflowed or produced non-positive value"
    },
    {
      "code": 6014,
      "name": "zeroSize",
      "msg": "Position size must be non-zero"
    },
    {
      "code": 6015,
      "name": "adlRankingFailed",
      "msg": "ADL ranking proof failed: witness position has higher PnL than candidate, or no witnesses provided"
    }
  ],
  "types": [
    {
      "name": "indexState",
      "docs": [
        "Aggregated daily index state.",
        "Spec: docs/oracle.md §5 aggregation, docs/methodology.md §7 index formula."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "indexStatus"
              }
            }
          },
          {
            "name": "aggregatedPrices",
            "type": {
              "array": [
                "u64",
                25
              ]
            }
          },
          {
            "name": "constituentStatus",
            "type": {
              "array": [
                "u8",
                25
              ]
            }
          },
          {
            "name": "indexValue",
            "type": "u64"
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "indexStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "provisional"
          },
          {
            "name": "final"
          },
          {
            "name": "stale"
          },
          {
            "name": "frozen"
          }
        ]
      }
    },
    {
      "name": "initializeMarketParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracleIndexState",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "insuranceVault",
            "type": "pubkey"
          },
          {
            "name": "slippageFactor",
            "type": "u32"
          },
          {
            "name": "oiFloor",
            "type": "u64"
          },
          {
            "name": "initialMarginBps",
            "type": "u16"
          },
          {
            "name": "maintenanceMarginBps",
            "type": "u16"
          },
          {
            "name": "fundingCapPerHourBps",
            "type": "u16"
          },
          {
            "name": "takerFeeBps",
            "type": "u16"
          },
          {
            "name": "liquidationPenaltyBps",
            "type": "u16"
          },
          {
            "name": "maxOiPerSide",
            "type": "u64"
          },
          {
            "name": "maxPositionPerTrader",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "insuranceFund",
      "docs": [
        "Insurance fund tracker (USDC vault).",
        "Spec: docs/perp-engine.md §7."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "floor",
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalPaidOut",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "Perp market configuration and runtime state.",
        "Spec: docs/perp-engine.md §2, §3 (mark price), §9 (caps & fees)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "oracleIndexState",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "insuranceFund",
            "type": "pubkey"
          },
          {
            "name": "phase",
            "type": "u8"
          },
          {
            "name": "slippageFactor",
            "type": "u32"
          },
          {
            "name": "oiFloor",
            "type": "u64"
          },
          {
            "name": "longOi",
            "type": "u64"
          },
          {
            "name": "shortOi",
            "type": "u64"
          },
          {
            "name": "maxOiPerSide",
            "type": "u64"
          },
          {
            "name": "maxPositionPerTrader",
            "type": "u64"
          },
          {
            "name": "initialMarginBps",
            "type": "u16"
          },
          {
            "name": "maintenanceMarginBps",
            "type": "u16"
          },
          {
            "name": "fundingCapPerHourBps",
            "type": "u16"
          },
          {
            "name": "lastFundingUpdate",
            "type": "i64"
          },
          {
            "name": "cumulativeFundingLong",
            "type": "i128"
          },
          {
            "name": "cumulativeFundingShort",
            "type": "i128"
          },
          {
            "name": "markTwap1H",
            "type": "u64"
          },
          {
            "name": "markTwap5Min",
            "type": "u64"
          },
          {
            "name": "takerFeeBps",
            "type": "u16"
          },
          {
            "name": "liquidationPenaltyBps",
            "type": "u16"
          },
          {
            "name": "tradingPaused",
            "type": "bool"
          },
          {
            "name": "fundingPaused",
            "type": "bool"
          },
          {
            "name": "pauseReason",
            "type": "u8"
          },
          {
            "name": "markDeviationExceededSince",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "position",
      "docs": [
        "An open trader position. Isolated margin (§5).",
        "Spec: docs/perp-engine.md §5, §6."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "size",
            "type": "i64"
          },
          {
            "name": "entryIndexPrice",
            "type": "u64"
          },
          {
            "name": "entryMarkPrice",
            "type": "u64"
          },
          {
            "name": "marginVault",
            "type": "pubkey"
          },
          {
            "name": "cumulativeFundingSnapshot",
            "type": "i128"
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "treasury",
      "docs": [
        "Protocol treasury — receives 90% of taker fees per spec §9 (insurance keeps",
        "the remaining 10% as a backstop reserve). v0.2 routed 100% of fees to",
        "insurance; the 90/10 split landed in v0.3. v0.4 added `withdraw_treasury`",
        "(admin-gated) so accumulated protocol revenue can be pulled — `total_paid_out`",
        "tracks cumulative outflow so the on-chain field still matches vault balance",
        "(deposited − paid_out == vault.amount)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "totalReceived",
            "type": "u64"
          },
          {
            "name": "totalPaidOut",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
