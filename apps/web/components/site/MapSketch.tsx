/**
 * Static map illustration in the Telvey map style (BRAND §2 "Map styling") for the marketing
 * site's device frames. The live WebApp renders a real MapLibre / Google map instead; this
 * keeps marketing pages free of map JS.
 */
export function MapSketch({ variant }: { variant: 'walk' | 'drive' | 'quiet' }) {
  if (variant === 'drive') {
    return (
      <svg viewBox="0 0 300 260" preserveAspectRatio="xMidYMid slice" className="mapsketch" aria-hidden>
        <rect width="300" height="260" fill="#06090B" />
        <path d="M-20 250 C 60 200, 110 170, 150 120 S 230 30, 320 -10" stroke="#1B252B" strokeWidth="18" fill="none" />
        <path d="M150 250 L150 120 C 150 90, 190 50, 320 -10" stroke="#FFC857" strokeOpacity="0.16" strokeWidth="44" fill="none" strokeLinecap="round" />
        <path d="M150 250 L150 120 C 150 90, 190 50, 320 -10" stroke="#FFC857" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M30 40 l20 -8 18 10 -6 16z M240 150 l24 -6 10 14 -20 12z" fill="#11181C" />
        <circle cx="236" cy="42" r="14" fill="none" stroke="#FF8A70" strokeWidth="2" strokeOpacity="0.5" />
        <circle cx="236" cy="42" r="6" fill="#FF8A70" />
        <path d="M150 210 l-16 -34 h32z" fill="#F4F7F8" fillOpacity="0.12" />
        <path d="M150 192 l-9 20 9 -5 9 5z" fill="#F4F7F8" />
      </svg>
    );
  }
  const quiet = variant === 'quiet';
  return (
    <svg viewBox="0 0 300 260" preserveAspectRatio="xMidYMid slice" className="mapsketch" aria-hidden>
      <rect width="300" height="260" fill="#F7F4EE" />
      <path d="M-10 196 C 60 180, 120 230, 310 200 L310 270 L-10 270z" fill="#DCECEE" />
      <g stroke="#E2DBCF" strokeWidth="9" strokeLinecap="round">
        <path d="M-10 60 H310 M-10 130 H310 M40 -10 V200 M120 -10 V200 M200 -10 V200 M270 -10 V200" />
      </g>
      <g stroke="#EFEAE1" strokeWidth="4">
        <path d="M-10 95 H310 M80 -10 V200 M160 -10 V200 M235 -10 V200" />
      </g>
      <g fill="#EFEAE1">
        <rect x="48" y="68" width="24" height="20" rx="2" />
        <rect x="128" y="68" width="24" height="54" rx="2" />
        <rect x="208" y="10" width="54" height="42" rx="2" />
        <rect x="48" y="138" width="64" height="30" rx="2" />
        <rect x="208" y="138" width="54" height="40" rx="2" />
      </g>
      {quiet ? null : (
        <>
          <circle cx="222" cy="102" r="20" fill="#FF6A4D" fillOpacity="0.16" />
          <circle cx="222" cy="102" r="12" fill="none" stroke="#FF6A4D" strokeWidth="2" />
          <circle cx="222" cy="102" r="6.5" fill="#FF6A4D" />
          <circle cx="96" cy="30" r="7" fill="none" stroke="#0F4C5C" strokeWidth="2.5" />
        </>
      )}
      <path d="M160 170 l-24 -48 h48z" fill="#0F4C5C" fillOpacity="0.1" />
      <circle cx="160" cy="160" r="15" fill="#fff" />
      <path d="M160 149 l-8 19 8 -5 8 5z" fill="#0F4C5C" />
    </svg>
  );
}
