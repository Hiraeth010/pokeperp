/**
 * Card metadata helpers. Bridges our on-chain `Constituent` (set_code, collector_number,
 * variant_code) to pokemontcg.io's CDN — images live at:
 *
 *   https://images.pokemontcg.io/{set_id}/{number}.png      (~430×600 thumbnail)
 *   https://images.pokemontcg.io/{set_id}/{number}_hires.png (~734×1024)
 *
 * The on-chain registry stores a 2–8 byte ASCII `set_code` (e.g. "ES" for Evolving Skies)
 * which we map to the API's canonical set IDs (e.g. "swsh7"). Unknown set_codes return
 * `null` from `cardImageUrl` so the UI falls back to a placeholder.
 *
 * Display names use the inception candidate list (docs/inception-candidates.md §2/§3)
 * since the on-chain registry doesn't store names — only the search-hash.
 */

/** Map from our internal short set code → pokemontcg.io set ID. */
const SET_CODE_TO_API: Record<string, string> = {
  // Sword & Shield era
  CP: "swsh35",       // Champion's Path
  VV: "swsh4",        // Vivid Voltage
  BS: "swsh9",        // Brilliant Stars
  ES: "swsh7",        // Evolving Skies
  FS: "swsh8",        // Fusion Strike
  AR: "swsh10",       // Astral Radiance
  LO: "swsh11",       // Lost Origin
  ST: "swsh12",       // Silver Tempest
  CZ: "swsh12pt5gg",  // Crown Zenith Galarian Gallery
  SF: "swsh45sv",     // Shining Fates Shiny Vault
  CEL: "cel25",       // Celebrations (v0.10: Pikachu V-UNION)
  PGO: "pgo",         // Pokemon GO (v0.10)
  // Sun & Moon era
  UB: "sm10",         // Unbroken Bonds
  UM: "sm11",         // Unified Minds
  // Scarlet & Violet era
  PE: "sv2",          // Paldea Evolved
  PaE: "sv2",         // Paldea Evolved (v0.10 alias used by Boss's Orders SAR)
  OF: "sv3",          // Obsidian Flames
  PMK: "sv3pt5",      // Pokemon 151
  PaF: "sv4pt5",      // Paldean Fates
  PR: "sv4",          // Paradox Rift (v0.10)
  TM: "sv6",          // Twilight Masquerade (v0.10)
  SS: "sv8",          // Surging Sparks (v0.10)
  SC: "sv7",          // Stellar Crown (v0.10)
};

/** Friendly long-form name for the set, used in tooltips and detail labels. */
const SET_CODE_TO_NAME: Record<string, string> = {
  CP: "Champion's Path",
  VV: "Vivid Voltage",
  BS: "Brilliant Stars",
  ES: "Evolving Skies",
  FS: "Fusion Strike",
  AR: "Astral Radiance",
  LO: "Lost Origin",
  ST: "Silver Tempest",
  CZ: "Crown Zenith",
  SF: "Shining Fates",
  CEL: "Celebrations",
  PGO: "Pokemon GO",
  UB: "Unbroken Bonds",
  UM: "Unified Minds",
  PE: "Paldea Evolved",
  PaE: "Paldea Evolved",
  OF: "Obsidian Flames",
  PMK: "Pokemon 151",
  PaF: "Paldean Fates",
  PR: "Paradox Rift",
  TM: "Twilight Masquerade",
  SS: "Surging Sparks",
  SC: "Stellar Crown",
};

/** Display name for a card given (set_code, collector_number, variant_code).
 *  Returns the canonical Pokemon name if we know it; otherwise a structural label.
 *  Keys mirror the seed list in services/dashboard/scripts/init-localnet.ts.  */
const CARD_NAMES: Record<string, string> = {
  // Evolving Skies (swsh7) — Eeveelution + dragon alt arts
  "ES-215-AA": "Umbreon VMAX",
  "ES-218-AA": "Rayquaza VMAX",
  "ES-180-AA": "Espeon V",
  "ES-167-AA": "Leafeon V",
  "ES-184-AA": "Sylveon V",
  "ES-175-AA": "Glaceon V",
  // Lost Origin (swsh11)
  "LO-186-AA": "Giratina V",
  "LO-3-TG":   "Charizard (Trainer Gallery)",
  // Silver Tempest (swsh12)
  "ST-186-AA": "Lugia V",
  // Brilliant Stars (swsh9)
  "BS-154-AA": "Charizard V",
  "BS-174-RR": "Charizard VSTAR",
  // Champion's Path (swsh35)
  "CP-74-RR":  "Charizard VMAX",
  // Vivid Voltage (swsh4)
  "VV-188-RR": "Pikachu VMAX",
  // Fusion Strike (swsh8)
  "FS-251-AA": "Mew V",
  "FS-269-AA": "Mew VMAX",
  "FS-271-AA": "Gengar VMAX",
  // Unbroken Bonds (sm10)
  "UB-217-RR": "Reshiram & Charizard GX",
  // Unified Minds (sm11)
  "UM-242-RR": "Mewtwo & Mew GX",
  // Pokemon 151 (sv3pt5)
  "PMK-199-SIR": "Charizard ex (151)",
  "PMK-204-SIR": "Giovanni's Charisma",
  // Crown Zenith Galarian Gallery (swsh12pt5gg) — canonical Hisuian Zoroark
  // VSTAR alt-art lives here at GG56/GG70.  Inception-candidates.md v0.1
  // mistakenly listed this as "AR-188-AA" (Astral Radiance #188) but pokemontcg
  // #188 in that set is Roxanne SAR — the Hisuian Zoroark alt art doesn't
  // exist in Astral Radiance at all.  Corrected v0.9.
  "CZ-56-GG": "Hisuian Zoroark VSTAR",
  // Obsidian Flames (sv3)
  "OF-215-SIR": "Charizard ex (Obsidian Flames)",
  // Paldean Fates (sv4pt5)
  "PaF-233-SIR": "Gardevoir ex",
  // Paldea Evolved (sv2)
  "PE-269-SAR": "Iono",
  // Shining Fates Shiny Vault (swsh45sv) — naive URL doesn't resolve (SV-prefixed)
  "SF-107-RR": "Charizard VMAX (Shiny Vault)",

  // ===== PMT26-50 (v0.10 expansion, post-2026-05-30 catalog fix) =====
  // Silver Tempest — Lugia VSTAR Alt Art (distinct from ST-186 Lugia V)
  "ST-211-AA":  "Lugia VSTAR",
  // Pokemon 151 — Pikachu IR + 4 SIR ex cards.  Originally listed as
  // "Pikachu ex SIR 151" but that card doesn't exist; pointing to the
  // famous Pikachu Illustration Rare (sv3pt5-173) instead.
  "PMK-173-SIR": "Pikachu (151)",
  "PMK-200-SIR": "Blastoise ex (151)",
  "PMK-198-SIR": "Venusaur ex (151)",
  "PMK-201-SIR": "Alakazam ex (151)",
  "PMK-193-SIR": "Mew ex (151)",
  // Lost Origin — Giratina VSTAR Alt Art (#212 — #213 is Hisuian Zoroark)
  "LO-212-AA":  "Giratina VSTAR",
  // Surging Sparks — Pikachu ex SIR
  "SS-238-SIR": "Pikachu ex (Surging Sparks)",
  // Celebrations — Pikachu V-UNION (V-UNION cards only exist as swshp
  // promos in pokemontcg.io; left at cel25-25 placeholder for now)
  "CEL-25-UN":  "Pikachu V-UNION",
  // Crown Zenith Galarian Gallery — these 4 Pokemon don't actually have
  // GG variants in swsh12pt5gg; awaiting substitution by user
  "CZ-29-GG":   "Charizard VSTAR (GG)",
  "CZ-44-GG":   "Pikachu VMAX (GG)",
  "CZ-50-GG":   "Rayquaza VMAX (GG)",
  "CZ-51-GG":   "Zacian V (GG)",
  // Astral Radiance alt arts (208 = Palkia, 210 = Dialga)
  "AR-208-AA":  "Origin Forme Palkia VSTAR",
  "AR-210-AA":  "Origin Forme Dialga VSTAR",
  // Hisuian Goodra V alt art lives in Lost Origin (swsh11-187), not AR
  "LO-187-AA":  "Hisuian Goodra V",
  // Brilliant Stars — Arceus VSTAR Alt Art
  "BS-184-AA":  "Arceus VSTAR",
  // Stellar Crown — Lance's Charizard ex SAR (not yet in pokemontcg.io)
  "SC-232-SAR": "Lance's Charizard ex",
  // Pokemon GO
  "PGO-11-RR":  "Radiant Charizard",
  "PGO-86-AA":  "Mewtwo VSTAR",
  // Paldean Fates — Penny SAR (#239)
  "PaF-239-SAR": "Penny",
  // Hydreigon ex SIR is in Surging Sparks (sv8-240), not Twilight Masquerade
  "SS-240-SIR": "Hydreigon ex",
  // Paradox Rift — Mela SAR (#254)
  "PR-254-SAR": "Mela",
  // Paldea Evolved — Boss's Orders (Ghetsis) SIR (#265)
  "PaE-265-SAR": "Boss's Orders (Ghetsis)",
  // Obsidian Flames — Tyranitar ex Ultra Rare alt-art (no SIR variant exists)
  "OF-211-AA": "Tyranitar ex",
};

export interface CardIdentity {
  setCode: string;
  collectorNumber: number;
  variantCode: string;
}

export function cardImageUrl(
  c: CardIdentity,
  variant: "thumb" | "hires" = "thumb"
): string | null {
  const suffix = variant === "hires" ? "_hires.png" : ".png";
  const variantUpper = c.variantCode.toUpperCase();

  // Trainer Gallery subsets: pokemontcg.io stores TG cards under <parent>tg/
  // with the number prefixed by "TG" and zero-padded to 2 digits.
  if (variantUpper === "TG") {
    const parent = SET_CODE_TO_API[c.setCode];
    if (!parent) return null;
    const padded = String(c.collectorNumber).padStart(2, "0");
    return `https://images.pokemontcg.io/${parent}tg/TG${padded}${suffix}`;
  }

  // Galarian Gallery (Crown Zenith): pokemontcg.io stores GG cards in the
  // parent set with filenames `GG<NN>.png` (zero-padded to 2 digits). The
  // SET_CODE_TO_API mapping for "CZ" already points directly at the GG subset
  // (`swsh12pt5gg`), so no extra suffix on the path — just the GG-prefixed
  // filename.  Empirically verified: swsh12pt5gg/GG56.png → 200, /56.png → 404.
  if (variantUpper === "GG") {
    const parent = SET_CODE_TO_API[c.setCode];
    if (!parent) return null;
    const padded = String(c.collectorNumber).padStart(2, "0");
    return `https://images.pokemontcg.io/${parent}/GG${padded}${suffix}`;
  }

  // Shining Fates Shiny Vault: SV-prefixed numbering in the swsh45sv subset.
  // The cards we treat as SF on-chain live exclusively in this subset.
  if (c.setCode === "SF") {
    const padded = String(c.collectorNumber).padStart(3, "0");
    return `https://images.pokemontcg.io/swsh45sv/SV${padded}${suffix}`;
  }

  // Standard path: <set_id>/<number>.png. pokemontcg.io accepts unpadded numbers.
  const apiSet = SET_CODE_TO_API[c.setCode];
  if (!apiSet) return null;
  return `https://images.pokemontcg.io/${apiSet}/${c.collectorNumber}${suffix}`;
}

export function cardName(c: CardIdentity): string | null {
  const key = `${c.setCode}-${c.collectorNumber}-${c.variantCode}`;
  return CARD_NAMES[key] ?? null;
}

export function setName(setCode: string): string {
  return SET_CODE_TO_NAME[setCode] ?? setCode;
}

/** Variant code → readable label. Empty/unknown codes fall through. */
export function variantLabel(code: string): string {
  switch (code.toUpperCase()) {
    case "AA":
      return "Alt Art";
    case "SIR":
      return "Special Illustration Rare";
    case "SAR":
      return "Special Art Rare";
    case "RR":
      return "Rainbow Rare";
    case "TG":
      return "Trainer Gallery";
    case "GG":
      return "Galarian Gallery";
    case "VMAX":
      return "VMAX";
    case "VSTAR":
      return "VSTAR";
    default:
      return code;
  }
}

/** Compact identifier used in tight UI: "ES #215 · AA". */
export function compactLabel(c: CardIdentity): string {
  return `${c.setCode} #${c.collectorNumber} · ${c.variantCode}`;
}

/** Richer label for headers: "Umbreon VMAX · Evolving Skies 215". */
export function richLabel(c: CardIdentity): string {
  const name = cardName(c);
  const set = setName(c.setCode);
  if (name) {
    return `${name} · ${set} #${c.collectorNumber}`;
  }
  return `${set} #${c.collectorNumber} · ${variantLabel(c.variantCode)}`;
}
