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
  // Sun & Moon era
  UB: "sm10",         // Unbroken Bonds
  UM: "sm11",         // Unified Minds
  // Scarlet & Violet era
  PE: "sv2",          // Paldea Evolved
  OF: "sv3",          // Obsidian Flames
  PMK: "sv3pt5",      // Pokemon 151
  PaF: "sv4pt5",      // Paldean Fates
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
  UB: "Unbroken Bonds",
  UM: "Unified Minds",
  PE: "Paldea Evolved",
  OF: "Obsidian Flames",
  PMK: "Pokemon 151",
  PaF: "Paldean Fates",
};

/** Display name for a card given (set_code, collector_number, variant_code).
 *  Returns the canonical Pokemon name if we know it; otherwise a structural label. */
const CARD_NAMES: Record<string, string> = {
  "ES-215-AA": "Umbreon VMAX",
  "ES-218-AA": "Rayquaza VMAX",
  "ES-180-AA": "Espeon V",
  "ES-167-AA": "Leafeon V",
  "ES-211-AA": "Sylveon V",
  "ES-169-AA": "Glaceon V",
  "LO-186-AA": "Giratina V",
  "ST-186-AA": "Lugia V",
  "BS-154-AA": "Charizard V",
  "BS-174-RR": "Charizard VSTAR",
  "CP-074-RR": "Charizard VMAX",
  "VV-188-RR": "Pikachu VMAX",
  "FS-251-AA": "Mew V",
  "FS-269-AA": "Mew VMAX",
  "FS-271-AA": "Gengar VMAX",
  "UB-217-RR": "Reshiram & Charizard GX",
  "UM-242-RR": "Mewtwo & Mew GX",
  "LO-TG03-TG": "Charizard Trainer Gallery",
  "PMK-199-SIR": "Charizard ex",
  "AR-188-AA": "Hisuian Zoroark VSTAR",
  "PaF-233-SIR": "Gardevoir ex",
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
  const apiSet = SET_CODE_TO_API[c.setCode];
  if (!apiSet) return null;
  // Trainer Gallery / Galarian Gallery numbers come through as "TG03" / "GG44" —
  // already string-shaped in the on-chain registry. Numeric slots get padded only
  // when the API expects it; pokemontcg.io accepts unpadded numbers.
  const num = String(c.collectorNumber);
  const suffix = variant === "hires" ? "_hires.png" : ".png";
  return `https://images.pokemontcg.io/${apiSet}/${num}${suffix}`;
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
