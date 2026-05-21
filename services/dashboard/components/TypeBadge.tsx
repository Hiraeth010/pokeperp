/** Pokemon-type styled pill. Used for variant tags ("VMAX", "SIR", "RR") and
 *  ad-hoc accent labels. The mapping below approximates which TCG type a
 *  variant most often correlates with — purely aesthetic. */

type Tone =
  | "electric"
  | "fire"
  | "water"
  | "psychic"
  | "dark"
  | "grass"
  | "dragon";

const TONE_CLASS: Record<Tone, string> = {
  electric: "bg-poke-electric/15 text-poke-electric ring-poke-electric/40",
  fire: "bg-poke-fire/15 text-poke-fire ring-poke-fire/40",
  water: "bg-poke-water/15 text-poke-water ring-poke-water/40",
  psychic: "bg-poke-psychic/15 text-poke-psychic ring-poke-psychic/40",
  dark: "bg-poke-dark/15 text-poke-dark ring-poke-dark/40",
  grass: "bg-poke-grass/15 text-poke-grass ring-poke-grass/40",
  dragon: "bg-poke-dragon/15 text-poke-dragon ring-poke-dragon/40",
};

export default function TypeBadge({
  children,
  tone = "electric",
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md ring-1 text-[10px] font-semibold tracking-wider uppercase ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Map variant code → tone for consistent visual hierarchy. */
export function toneForVariant(code: string): Tone {
  switch (code.toUpperCase()) {
    case "AA":
      return "psychic";
    case "SIR":
    case "SAR":
      return "fire";
    case "RR":
    case "RAINBOW":
      return "electric";
    case "TG":
    case "GG":
      return "grass";
    case "VMAX":
      return "dragon";
    case "VSTAR":
      return "water";
    default:
      return "dark";
  }
}
