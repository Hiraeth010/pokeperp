/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/oracle.json`.
 */
export type Oracle = {
  "address": "GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i",
  "metadata": {
    "name": "oracle",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Pokeperp oracle program"
  },
  "instructions": [
    {
      "name": "acceptAdminTransfer",
      "docs": [
        "Proposed admin signs to accept authority; commit + clear pending slot."
      ],
      "discriminator": [
        89,
        211,
        96,
        212,
        233,
        0,
        251,
        7
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "newAdmin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "activatePublisher",
      "docs": [
        "Promote publisher from shadow to active after 30-day shadow period.",
        "Spec: docs/oracle.md §2 onboarding (shadow period)."
      ],
      "discriminator": [
        189,
        116,
        113,
        89,
        151,
        222,
        149,
        8
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "publisherAccount",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "aggregateDay",
      "docs": [
        "Aggregate publisher submissions for a given day into IndexState.",
        "`remaining_accounts` carries the PriceUpdate accounts to consider (caller's responsibility",
        "to pass a comprehensive set; the program validates ownership + day of each).",
        "Spec: docs/oracle.md §5 on-chain aggregation, docs/methodology.md §7 index formula."
      ],
      "discriminator": [
        241,
        186,
        249,
        123,
        182,
        133,
        185,
        248
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "registry",
          "docs": [
            "Mutated for chain-linking new constituents on first observation.",
            "Zero-copy access via `.load_mut()` in the handler."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "indexState",
          "docs": [
            "Singleton IndexState — created on first aggregation, updated on subsequent days."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  100,
                  101,
                  120,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "docs": [
            "Anyone can call; the caller pays rent for the IndexState on first day."
          ],
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
          "name": "day",
          "type": "u32"
        }
      ]
    },
    {
      "name": "emergencyPause",
      "docs": [
        "Emergency pause the oracle (admin only).",
        "Spec: docs/oracle.md §9 failure modes."
      ],
      "discriminator": [
        21,
        143,
        27,
        142,
        200,
        181,
        210,
        255
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "reason",
          "type": "u8"
        }
      ]
    },
    {
      "name": "emergencyUnpause",
      "docs": [
        "Lift the emergency pause (admin only)."
      ],
      "discriminator": [
        83,
        249,
        195,
        57,
        206,
        189,
        31,
        85
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
      "args": []
    },
    {
      "name": "finalizeDay",
      "docs": [
        "Finalize the index after the challenge window closes.",
        "Spec: docs/oracle.md §5 (provisional vs final)."
      ],
      "discriminator": [
        88,
        77,
        250,
        153,
        57,
        146,
        161,
        198
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "docs": [
            "Anyone can finalize once the challenge window has elapsed."
          ],
          "signer": true
        },
        {
          "name": "indexState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  100,
                  101,
                  120,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "day",
          "type": "u32"
        }
      ]
    },
    {
      "name": "finalizeRegistryUpdate",
      "docs": [
        "Commit version + effective_day after all slots are updated for a rebalance.",
        "Spec: docs/methodology.md §5 monthly rebalance."
      ],
      "discriminator": [
        27,
        68,
        185,
        8,
        130,
        15,
        11,
        13
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "effectiveDay",
          "type": "u32"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Initialize global config. Admin = core multisig.",
        "Spec: docs/oracle.md §2 (publisher set), §7 (params), §8 (phasing)."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
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
              "name": "initializeParams"
            }
          }
        }
      ]
    },
    {
      "name": "initializeRegistry",
      "docs": [
        "Initialize the constituent registry to all-zero state.",
        "Caller then writes each slot via `update_constituent` (up to 25 calls), then",
        "commits with `finalize_registry_update`. Split from a single instruction because",
        "25 × 64-byte Constituent payload exceeds Solana's 1232-byte tx data cap.",
        "Spec: docs/methodology.md §1, §5, §9.8."
      ],
      "discriminator": [
        189,
        181,
        20,
        17,
        174,
        57,
        249,
        59
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "registry",
          "docs": [
            "Zero-copy account; `init` zero-fills the data segment."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openChallenge",
      "docs": [
        "Open a challenge against a publisher's submission for a specific (day, constituent).",
        "Escrows the challenger's USDC bond into a per-challenge vault PDA. Bond either",
        "returns to challenger (success) or gets redistributed 50/50 to the targeted",
        "publisher's bond vault + protocol treasury (failure).",
        "Spec: docs/oracle.md §6 dispute mechanism."
      ],
      "discriminator": [
        56,
        176,
        3,
        12,
        28,
        205,
        10,
        5
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "challenger",
          "writable": true,
          "signer": true
        },
        {
          "name": "indexState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  100,
                  101,
                  120,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "challenge",
          "writable": true
        },
        {
          "name": "challengerUsdcAccount",
          "docs": [
            "Challenger's USDC source for the bond."
          ],
          "writable": true
        },
        {
          "name": "challengeBondVault",
          "docs": [
            "Per-challenge bond escrow PDA — created here, owned by itself."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
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
      "args": [
        {
          "name": "targetDay",
          "type": "u32"
        },
        {
          "name": "targetPublisher",
          "type": "pubkey"
        },
        {
          "name": "targetConstituent",
          "type": "u8"
        },
        {
          "name": "claimedCorrectPrice",
          "type": "u64"
        },
        {
          "name": "evidenceUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "proposeAdminTransfer",
      "docs": [
        "Current admin nominates a new admin. Overwrites any prior proposal."
      ],
      "discriminator": [
        218,
        178,
        115,
        190,
        80,
        107,
        95,
        158
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "registerPublisher",
      "docs": [
        "Register a publisher: admin approves, admin's USDC funds the 10k bond into a per-publisher vault PDA.",
        "New publisher enters in Shadow status with 30 shadow days remaining.",
        "Spec: docs/oracle.md §2 onboarding, §7 bonds."
      ],
      "discriminator": [
        144,
        151,
        194,
        252,
        185,
        4,
        145,
        252
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "publisherAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  98,
                  108,
                  105,
                  115,
                  104,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "publisherKey"
              }
            ]
          }
        },
        {
          "name": "adminUsdcAccount",
          "docs": [
            "Admin's USDC ATA, source of the bond."
          ],
          "writable": true
        },
        {
          "name": "bondVault",
          "docs": [
            "Per-publisher bond vault, owned by the program PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "publisherKey"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
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
      "args": [
        {
          "name": "publisherKey",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "resolveChallenge",
      "docs": [
        "Resolve an open challenge — **permissionless and fully on-chain (v0.9)**.",
        "",
        "Replaces the v0.5–v0.8 admin-attested path: instead of the admin passing",
        "`challenge_succeeded` + `slash_bps`, this ix reads the publisher's actual",
        "submitted price for the challenged constituent and the protocol's",
        "aggregated price on that day, computes the deviation arithmetically, and",
        "maps to a slash tier per oracle.md §7:",
        "",
        "deviation < 2%       → challenge FAILS (within market noise)",
        "deviation 2% – <5%   → 10% slash (warning level)",
        "deviation 5% – <10%  → 50% slash + status → Suspended",
        "deviation ≥ 10%      → 100% slash + status → Removed",
        "",
        "Deviation is `|publisher_price − aggregated_price| / aggregated_price`,",
        "scaled to basis points.  The aggregated price is the median across all",
        "submitting publishers for that day, finalized into `IndexState`.  A",
        "publisher whose submission lands close to the median can't be slashed",
        "regardless of who challenges them; one that lands far from the median",
        "gets slashed proportionally with no admin discretion.",
        "",
        "Cash flows are unchanged from v0.5:",
        "- Success: slashed_amount = publisher.bond × slash_bps / 10_000.",
        "50% → challenger USDC ATA, 50% → protocol treasury vault. Challenger",
        "bond refunded in full.",
        "- Failure: challenger bond split 50/50 → publisher bond vault (refill)",
        "+ protocol treasury vault.",
        "",
        "Spec: docs/oracle.md §6 resolution + §7 slashing schedule + flow."
      ],
      "discriminator": [
        81,
        191,
        124,
        119,
        131,
        248,
        157,
        109
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "docs": [
            "v0.9: permissionless — anyone can crank a challenge resolution because",
            "the slash decision is computed arithmetically from on-chain state.",
            "The caller still pays the tx fee; in practice the challenger themselves",
            "has the strongest incentive to call this (they get their bond back +",
            "reward on success)."
          ],
          "signer": true
        },
        {
          "name": "challenge",
          "writable": true
        },
        {
          "name": "indexState",
          "docs": [
            "IndexState for the challenged day — the aggregated (median) price the",
            "deviation is measured against.  Pinned to challenge.target_day so",
            "callers can't substitute a different day's index to game the math."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  100,
                  101,
                  120,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "targetPriceUpdate",
          "docs": [
            "The challenged publisher's actual PriceUpdate for the challenged day —",
            "the submission whose deviation is being judged.  PDA is per-",
            "(publisher, day), so the seed constraint already pins it to the right",
            "(publisher, day) pair; the explicit `constraint =` is belt-and-braces."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "challenge.target_publisher",
                "account": "challenge"
              },
              {
                "kind": "account",
                "path": "challenge.target_day",
                "account": "challenge"
              }
            ]
          }
        },
        {
          "name": "challengeBondVault",
          "docs": [
            "Per-challenge bond escrow holding the challenger's stake."
          ],
          "writable": true
        },
        {
          "name": "targetPublisherAccount",
          "docs": [
            "The targeted publisher's record — needed to read bond_amount, update on slash."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  98,
                  108,
                  105,
                  115,
                  104,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "target_publisher_account.publisher_key",
                "account": "publisher"
              }
            ]
          }
        },
        {
          "name": "targetPublisherBondVault",
          "docs": [
            "Publisher's bond vault — funds slashed FROM here (success) or refilled INTO it (failure)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100,
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
                "path": "target_publisher_account.publisher_key",
                "account": "publisher"
              }
            ]
          }
        },
        {
          "name": "challengerUsdcAccount",
          "docs": [
            "Challenger's USDC ATA — receives slashed share + bond refund on success.",
            "On failure this account is touched only for handler symmetry; no transfer happens."
          ],
          "writable": true
        },
        {
          "name": "treasuryVault",
          "docs": [
            "Protocol treasury USDC vault — validated against `config.protocol_treasury_vault`",
            "in the handler. Note this is a perp-engine PDA; oracle has no authority over it."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "setProtocolTreasury",
      "docs": [
        "Wire the protocol treasury USDC vault (perp-engine PDA) into oracle Config.",
        "Admin-only. Must be set before any `resolve_challenge` can succeed, since",
        "both success and failure paths route a protocol cut into this vault.",
        "Called post-init once the perp-engine `initialize_treasury` has run."
      ],
      "discriminator": [
        70,
        185,
        238,
        193,
        38,
        214,
        189,
        7
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "treasuryVault",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "slashForLiveness",
      "docs": [
        "Liveness slashing — anyone can crank this against a publisher whose",
        "last submission is sufficiently far in the past (v0.9).  Tiered per",
        "oracle.md §7:",
        "",
        "days absent ≥ 3  → tier 1 :  5% of current bond slashed",
        "days absent ≥ 7  → tier 2 : 25% of current bond slashed + Suspended",
        "days absent ≥ 14 → tier 3 :100% of current bond slashed + Removed",
        "",
        "`last_liveness_slash_tier` on Publisher tracks the highest tier already",
        "applied to the *current* absence gap; this ix requires the target tier",
        "to be strictly higher than that, which prevents repeatedly slashing",
        "inside a tier (calling on day 4 and again on day 5 = no double tier-1).",
        "The counter resets to 0 on the publisher's next successful submission,",
        "so a publisher who returns after a 5% slash can be tier-1-slashed",
        "again on a fresh gap weeks later.",
        "",
        "Only Active or Suspended publishers are eligible.  Shadow publishers",
        "haven't activated yet (and have shadow_period_days_remaining instead);",
        "Removed publishers have nothing left to slash.  Slashed funds route",
        "100% to the protocol treasury (no challenger to split with)."
      ],
      "discriminator": [
        194,
        230,
        83,
        205,
        25,
        108,
        46,
        189
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "publisherAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  98,
                  108,
                  105,
                  115,
                  104,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "publisher_account.publisher_key",
                "account": "publisher"
              }
            ]
          }
        },
        {
          "name": "publisherBondVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100,
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
                "path": "publisher_account.publisher_key",
                "account": "publisher"
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "docs": [
            "Protocol treasury USDC vault — validated against `config.protocol_treasury_vault`",
            "in the handler.  All slashed funds route here (no challenger to split with)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "submitPriceUpdate",
      "docs": [
        "Submit a publisher's daily price update for the prior day (T-1).",
        "Spec: docs/oracle.md §4 submission format."
      ],
      "discriminator": [
        23,
        47,
        136,
        74,
        223,
        157,
        69,
        155
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "publisher",
          "docs": [
            "Signing publisher pubkey. Must match `publisher_account.publisher_key`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "publisherAccount",
          "docs": [
            "Publisher record. PDA is bound to `publisher.key()`, so the signer must match."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  98,
                  108,
                  105,
                  115,
                  104,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "publisher"
              }
            ]
          }
        },
        {
          "name": "priceUpdate",
          "docs": [
            "New PriceUpdate account, one per (publisher, day)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "publisher"
              },
              {
                "kind": "arg",
                "path": "day"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "day",
          "type": "u32"
        },
        {
          "name": "prices",
          "type": {
            "array": [
              "u64",
              25
            ]
          }
        },
        {
          "name": "saleCounts",
          "type": {
            "array": [
              "u16",
              25
            ]
          }
        },
        {
          "name": "sourceRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "updateConstituent",
      "docs": [
        "Update a single constituent slot in the registry.",
        "If the new (set_code, collector_number, variant_code) matches the prior entry",
        "at this slot, `base_price` is preserved (chain-linking per methodology §7).",
        "Spec: docs/methodology.md §9.8."
      ],
      "discriminator": [
        66,
        142,
        69,
        65,
        160,
        219,
        233,
        73
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "idx",
          "type": "u8"
        },
        {
          "name": "constituent",
          "type": {
            "defined": {
              "name": "constituentInput"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "challenge",
      "discriminator": [
        119,
        250,
        161,
        121,
        119,
        81,
        22,
        208
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "constituentRegistry",
      "discriminator": [
        215,
        185,
        89,
        211,
        186,
        211,
        143,
        223
      ]
    },
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
      "name": "priceUpdate",
      "discriminator": [
        105,
        54,
        115,
        246,
        58,
        216,
        66,
        178
      ]
    },
    {
      "name": "publisher",
      "discriminator": [
        86,
        152,
        93,
        215,
        234,
        89,
        232,
        104
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "publisherNotActive",
      "msg": "Publisher is not in good standing"
    },
    {
      "code": 6001,
      "name": "submissionWindowClosed",
      "msg": "Submission is outside the daily submission window"
    },
    {
      "code": 6002,
      "name": "duplicateSubmission",
      "msg": "Publisher already submitted for this day"
    },
    {
      "code": 6003,
      "name": "insufficientSubmissions",
      "msg": "Fewer than the minimum number of publishers submitted"
    },
    {
      "code": 6004,
      "name": "challengeWindowClosed",
      "msg": "Challenge window has closed"
    },
    {
      "code": 6005,
      "name": "challengeTargetMissing",
      "msg": "Challenge target submission does not exist"
    },
    {
      "code": 6006,
      "name": "insufficientBond",
      "msg": "Bond deposit is insufficient"
    },
    {
      "code": 6007,
      "name": "unauthorized",
      "msg": "Caller is not authorized"
    },
    {
      "code": 6008,
      "name": "invalidPrice",
      "msg": "Price array contains an invalid value"
    },
    {
      "code": 6009,
      "name": "dayAlreadyAggregated",
      "msg": "Day has already been aggregated"
    },
    {
      "code": 6010,
      "name": "registryMismatch",
      "msg": "Constituent registry version mismatch"
    },
    {
      "code": 6011,
      "name": "oraclePaused",
      "msg": "Oracle is currently paused"
    },
    {
      "code": 6012,
      "name": "publisherInShadow",
      "msg": "Publisher is still in the shadow period"
    },
    {
      "code": 6013,
      "name": "invalidConfig",
      "msg": "Config initialization parameters are invalid"
    },
    {
      "code": 6014,
      "name": "invalidSubmissionDay",
      "msg": "Submission day must equal current_day - 1"
    },
    {
      "code": 6015,
      "name": "challengeWindowOpen",
      "msg": "Challenge window still open — finalize requires elapsed challenge window"
    },
    {
      "code": 6016,
      "name": "invalidIndexStatus",
      "msg": "Index state is in unexpected status for this operation"
    },
    {
      "code": 6017,
      "name": "invalidSlashSeverity",
      "msg": "Slash basis points must be one of 1000 (10%), 5000 (50%), or 10000 (100%)"
    },
    {
      "code": 6018,
      "name": "treasuryNotConfigured",
      "msg": "Protocol treasury vault has not been configured on Config"
    },
    {
      "code": 6019,
      "name": "treasuryVaultMismatch",
      "msg": "Protocol treasury vault account does not match Config"
    },
    {
      "code": 6020,
      "name": "publisherBondVaultMismatch",
      "msg": "Publisher bond vault account does not match Publisher record"
    },
    {
      "code": 6021,
      "name": "challengeTargetMismatch",
      "msg": "Challenge target publisher does not match passed Publisher account"
    },
    {
      "code": 6022,
      "name": "publisherNotEligibleForLivenessSlash",
      "msg": "Publisher is not eligible for liveness slashing (Shadow or Removed)"
    },
    {
      "code": 6023,
      "name": "noNewLivenessSlashTier",
      "msg": "Publisher absence has not crossed a new liveness slash tier"
    },
    {
      "code": 6024,
      "name": "challengeIndexStateMismatch",
      "msg": "IndexState day does not match the challenge target day"
    },
    {
      "code": 6025,
      "name": "challengePriceUpdateMismatch",
      "msg": "Passed PriceUpdate does not match the challenge's (publisher, day)"
    },
    {
      "code": 6026,
      "name": "challengeReferencePriceZero",
      "msg": "Aggregated price for the challenged constituent is zero — cannot compute deviation"
    }
  ],
  "types": [
    {
      "name": "challenge",
      "docs": [
        "An open or resolved challenge.",
        "Spec: docs/oracle.md §6 dispute mechanism, §7 slashing."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenger",
            "type": "pubkey"
          },
          {
            "name": "targetPublisher",
            "type": "pubkey"
          },
          {
            "name": "targetDay",
            "type": "u32"
          },
          {
            "name": "targetConstituent",
            "type": "u8"
          },
          {
            "name": "claimedCorrectPrice",
            "type": "u64"
          },
          {
            "name": "evidenceUri",
            "type": "string"
          },
          {
            "name": "bond",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "challengeStatus"
              }
            }
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "slashBps",
            "docs": [
              "Set on success: basis points of publisher bond slashed (one of 1000/5000/10000",
              "per spec §7). Zero on failure or while open."
            ],
            "type": "u16"
          },
          {
            "name": "slashedAmount",
            "docs": [
              "Set on success: absolute USDC amount transferred out of the publisher bond vault.",
              "Zero on failure or while open."
            ],
            "type": "u64"
          },
          {
            "name": "challengerPayout",
            "docs": [
              "Set on resolve: amount the challenger received. Success = bond refund + 50% of slash;",
              "failure = 0 (challenger's bond was redistributed)."
            ],
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
      "name": "challengeStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "succeeded"
          },
          {
            "name": "failed"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Global config for the oracle program.",
        "Spec: docs/oracle.md §2, §7, §8."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "docs": [
              "v0.8 two-step admin transfer.  Same semantics as Market.pending_admin",
              "in perp-engine: propose_admin_transfer writes here, accept_admin_transfer",
              "(signed by the proposed admin) commits.  Sentinel for \"no transfer in",
              "flight\" is Pubkey::default().  Two-step protects against typos when",
              "handing authority to a Squads multisig vault."
            ],
            "type": "pubkey"
          },
          {
            "name": "publisherCount",
            "type": "u8"
          },
          {
            "name": "publisherBond",
            "type": "u64"
          },
          {
            "name": "challengeBond",
            "type": "u64"
          },
          {
            "name": "phase",
            "type": "u8"
          },
          {
            "name": "minPublishersPerDay",
            "type": "u8"
          },
          {
            "name": "submissionWindowStart",
            "type": "u32"
          },
          {
            "name": "submissionWindowEnd",
            "type": "u32"
          },
          {
            "name": "challengeWindowSeconds",
            "type": "u32"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "pauseReason",
            "type": "u8"
          },
          {
            "name": "protocolTreasuryVault",
            "docs": [
              "Protocol treasury USDC vault (perp-engine PDA). Set post-init via",
              "`set_protocol_treasury`. Slash + failed-challenge protocol cuts route here.",
              "Zero pubkey = not configured; resolve_challenge reverts until set."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "constituent",
      "docs": [
        "A single constituent entry. Fields reordered (largest align first) to avoid",
        "implicit padding, then explicit trailing `_pad` to make the type Pod-safe.",
        "Spec: docs/methodology.md §1 (card identity), §9.8 (matching protocol)."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "basePrice",
            "type": "u64"
          },
          {
            "name": "canonicalSearchHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "setCode",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "variantCode",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "collectorNumber",
            "type": "u16"
          },
          {
            "name": "setTotal",
            "type": "u16"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "constituentInput",
      "docs": [
        "Wire-format struct used as the `update_constituent` instruction parameter.",
        "Necessary because Anchor 0.31's `#[zero_copy]` and `#[derive(AnchorSerialize)]`",
        "both emit `IdlBuild` impls — they collide on the same type. We split the wire",
        "format from the storage format."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "basePrice",
            "type": "u64"
          },
          {
            "name": "canonicalSearchHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "setCode",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "variantCode",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "collectorNumber",
            "type": "u16"
          },
          {
            "name": "setTotal",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "constituentRegistry",
      "docs": [
        "The 25-entry constituent registry. Versioned at each rebalance.",
        "Zero-copy because the array is ~1500 bytes — deserializing onto stack would",
        "exceed Solana's 4KB stack frame in `try_accounts`.",
        "Spec: docs/methodology.md §1, §5, §9.8."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "constituents",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "constituent"
                  }
                },
                25
              ]
            }
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "effectiveDay",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          }
        ]
      }
    },
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
      "name": "initializeParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "publisherBond",
            "type": "u64"
          },
          {
            "name": "challengeBond",
            "type": "u64"
          },
          {
            "name": "minPublishersPerDay",
            "type": "u8"
          },
          {
            "name": "submissionWindowStart",
            "type": "u32"
          },
          {
            "name": "submissionWindowEnd",
            "type": "u32"
          },
          {
            "name": "challengeWindowSeconds",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "priceUpdate",
      "docs": [
        "A publisher's daily price submission.",
        "Spec: docs/oracle.md §4 submission format."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "day",
            "type": "u32"
          },
          {
            "name": "prices",
            "type": {
              "array": [
                "u64",
                25
              ]
            }
          },
          {
            "name": "saleCounts",
            "type": {
              "array": [
                "u16",
                25
              ]
            }
          },
          {
            "name": "sourceRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "submittedAt",
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
      "name": "publisher",
      "docs": [
        "Per-publisher record.",
        "Spec: docs/oracle.md §2 (onboarding, removal), §7 (bonds, rewards, slashing)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "publisherKey",
            "type": "pubkey"
          },
          {
            "name": "bondAmount",
            "type": "u64"
          },
          {
            "name": "bondVault",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "publisherStatus"
              }
            }
          },
          {
            "name": "joinedDay",
            "type": "u32"
          },
          {
            "name": "shadowPeriodDaysRemaining",
            "type": "u16"
          },
          {
            "name": "totalSubmissions",
            "type": "u64"
          },
          {
            "name": "successfulChallengesAgainst",
            "type": "u32"
          },
          {
            "name": "lastSubmittedDay",
            "type": "u32"
          },
          {
            "name": "lastLivenessSlashTier",
            "docs": [
              "v0.9 liveness slashing: highest tier that has already been applied for",
              "the current absence gap.  0 = no liveness slash pending; 1/2/3 = the",
              "5%/25%/100% tiers from oracle.md §7.  Resets to 0 whenever the publisher",
              "makes a successful submission, so each fresh absence gap can re-tier",
              "from scratch.  Prevents double-slashing the same gap if `slash_for_liveness`",
              "is cranked multiple times within a tier."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "publisherStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "shadow"
          },
          {
            "name": "active"
          },
          {
            "name": "suspended"
          },
          {
            "name": "removed"
          }
        ]
      }
    }
  ]
};
