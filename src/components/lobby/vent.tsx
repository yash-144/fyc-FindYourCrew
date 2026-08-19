'use client'

// An original vent/hatch graphic — the lobby's "entrance mechanism." Not a
// copy of any existing game's vent art: a simple hinged grate of our own
// design that pops open briefly whenever a new crewmate arrives.

export function Vent({ open, width = 120 }: { open: boolean; width?: number }) {
  return (
    <div className="relative" style={{ width, height: width * 0.62 }}>
      <svg width={width} height={width * 0.62} viewBox="0 0 120 74" aria-hidden="true">
        <ellipse cx="60" cy="66" rx="52" ry="7" fill="rgba(0,0,0,0.45)" />
        <rect x="10" y="24" width="100" height="34" rx="10" fill="#2a2f3d" stroke="#454c5f" strokeWidth="2" />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={22 + i * 20} y="30" width="10" height="22" rx="3" fill="#151821" />
        ))}
        <rect x="10" y="24" width="100" height="8" rx="4" fill="#454c5f" />
      </svg>
      <svg
        width={width}
        height={width * 0.62}
        viewBox="0 0 120 74"
        className="absolute inset-0 transition-transform duration-300 ease-out"
        style={{
          transformOrigin: '60px 30px',
          transform: open ? 'rotateX(75deg) translateY(-4px)' : 'rotateX(0deg)',
        }}
        aria-hidden="true"
      >
        <rect x="8" y="16" width="104" height="16" rx="6" fill="#5b6478" stroke="#2a2f3d" strokeWidth="2" />
        <rect x="52" y="19" width="16" height="4" rx="2" fill="#2a2f3d" />
      </svg>
      {open && (
        <div className="absolute inset-x-0 top-1/3 flex justify-center pointer-events-none">
          <span className="vent-puff" />
        </div>
      )}
    </div>
  )
}
