import Pokeball from "./Pokeball";

/** Stylized wordmark with a Pokeball in place of the second "o" in "Pokeperp". */
export default function PokeperpLogo({
  size = "md",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const text = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl sm:text-3xl",
  }[size];
  const ball = { sm: 14, md: 18, lg: 30 }[size];
  return (
    <span className={`font-display ${text} tracking-tight inline-flex items-baseline`}>
      <span>P</span>
      <span className="inline-block translate-y-[6%]" style={{ marginInline: "0.04em" }}>
        <Pokeball size={ball} />
      </span>
      <span>keperp</span>
    </span>
  );
}
