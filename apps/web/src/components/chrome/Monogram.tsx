/** The Qanary mark: a Q cut as an engraver would, the bowl's weight carried by
 *  nested burin lines on the shaded side, and a swelling tail. */
export function Monogram({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <ellipse cx="23" cy="22" rx="15.5" ry="16.5" strokeWidth="1.6" />
        <path d="M10.2 30.2A15 16 0 0 1 14.6 8.6" strokeWidth="1.05" />
        <path d="M12.4 29A12.6 13.8 0 0 1 15.6 11.2" strokeWidth="0.85" />
        <path d="M14.6 27.4A10.4 11.8 0 0 1 16.8 13.6" strokeWidth="0.65" />
        <path d="M35.8 13.8A15 16 0 0 1 31.6 35.4" strokeWidth="1.05" />
        <path d="M33.6 15A12.6 13.8 0 0 1 30.4 32.8" strokeWidth="0.8" />
        <path d="M31.4 16.6A10.4 11.8 0 0 1 29.2 30.4" strokeWidth="0.55" />
      </g>
      <path d="M24.6 30.4c3.6 1.4 7.6 5.6 10.8 10.4c1.6 2.3 3.6 3.6 6 3.2c-2.9-.6-4.6-2.6-6.4-5.4c-2.8-4.4-6-7.8-10.4-8.2z" fill="currentColor" />
    </svg>
  );
}
