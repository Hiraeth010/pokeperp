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
        "v0.1 simplification: challenge metadata is recorded but bond escrow is deferred",
        "(would need a per-challenge token vault PDA — adds significant Accounts surface).",
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
        "Resolve an open challenge (admin-resolved in v0.1; committee multisig in v0.2).",
        "v0.1 simplification: no slashing of the targeted publisher's bond, no bond redistribution.",
        "Spec: docs/oracle.md §6 resolution + §7 slashing."
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
          "name": "admin",
          "signer": true
        },
        {
          "name": "challenge",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "challengeSucceeded",
          "type": "bool"
        }
      ]
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
    }
  ],
  "types": [
    {
      "name": "challenge",
      "docs": [
        "An open or resolved challenge.",
        "Spec: docs/oracle.md §6."
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
