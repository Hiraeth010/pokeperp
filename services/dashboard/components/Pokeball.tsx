/** Inline-SVG Pokeball icon. Currying through props (size, className) keeps it
 *  usable as a button glyph, nav mark, or spinner. */
export default function Pokeball({
  size = 16,
  className = "",
  spin = false,
}: {
  size?: number;
  className?: string;
  spin?: boolean;
}) {
  const animation = spin ? "animate-spin-slow" : "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`${animation} ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="poke-red" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF5757" />
          <stop offset="100%" stopColor="#D6283A" />
        </linearGradient>
        <linearGradient id="poke-white" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F4F4F8" />
          <stop offset="100%" stopColor="#C7C7CF" />
        </linearGradient>
      </defs>
      {/* Top red half */}
      <path
        d="M32 4a28 28 0 0 1 27.86 24.5H42.4a10.5 10.5 0 0 0-20.8 0H4.14A28 28 0 0 1 32 4z"
        fill="url(#poke-red)"
      />
      {/* Bottom white half */}
      <path
        d="M32 60a28 28 0 0 1-27.86-24.5H21.6a10.5 10.5 0 0 0 20.8 0h17.46A28 28 0 0 1 32 60z"
        fill="url(#poke-white)"
      />
      {/* Black band */}
      <path
        d="M4.14 28.5h17.46a10.5 10.5 0 0 1 20.8 0h17.46a28.1 28.1 0 0 1 0 7H42.4a10.5 10.5 0 0 1-20.8 0H4.14a28.1 28.1 0 0 1 0-7z"
        fill="#0E0E14"
      />
      {/* Center button outer */}
      <circle cx="32" cy="32" r="7.5" fill="#0E0E14" />
      {/* Center button inner */}
      <circle cx="32" cy="32" r="4.5" fill="#F4F4F8" />
      <circle cx="30" cy="30" r="1.3" fill="#fff" opacity="0.9" />
    </svg>
  );
}
