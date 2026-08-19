/**
 * The "red connection line" — Find Your Crew's signature visual motif.
 * A routing/wayfinding line, not a neural-network edge: a deliberate hand-marked
 * path with small joint nodes, used to imply relationships (you -> signal -> person).
 */

/** A single diagonal routing line with joint nodes at each end. Decorative. */
export function ConnectionLine({
  className,
  length = 220,
}: {
  className?: string
  length?: number
}) {
  return (
    <svg
      className={`draw-in overflow-visible ${className ?? ''}`}
      width={length}
      height={length * 0.42}
      viewBox={`0 0 ${length} ${Math.round(length * 0.42)}`}
      fill="none"
      aria-hidden="true"
      style={{ ['--line-length' as string]: '320' }}
    >
      <path
        d={`M4 4 Q ${length * 0.45} ${length * 0.36}, ${length - 6} ${length * 0.38 - 4}`}
        stroke="var(--color-red)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="4" cy="4" r="3.5" fill="var(--color-red)" />
      <circle cx={length - 6} cy={length * 0.38 - 4} r="3.5" fill="var(--color-red)" />
    </svg>
  )
}

/**
 * A labeled route: YOU -> MUSIC -> ARJUN. Each label sits at a joint on a bent
 * line, communicating "your answers connect you to this person."
 */
export function RouteBranch({
  nodes,
  className,
}: {
  nodes: string[]
  className?: string
}) {
  return (
    <div className={`font-mono text-xs ${className ?? ''}`}>
      {nodes.map((node, i) => (
        <div key={i} className="flex items-center" style={{ paddingLeft: `${i * 1.35}rem` }}>
          {i > 0 && (
            <svg width="22" height="18" viewBox="0 0 22 18" fill="none" className="shrink-0 -ml-1" aria-hidden="true">
              <path d="M2 0 V8 Q2 12 7 12 H20" stroke="var(--color-red)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          <span
            className={
              i === 0
                ? 'uppercase tracking-wider text-ink font-semibold'
                : i === nodes.length - 1
                  ? 'uppercase tracking-wider text-red font-semibold'
                  : 'uppercase tracking-wider text-ink-60'
            }
          >
            {node}
          </span>
        </div>
      ))}
    </div>
  )
}

/** A horizontal hairline with a routing node — used as a section break. */
export function RouteDivider({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-red shrink-0" aria-hidden="true" />
      <span className="flex-1 h-px bg-line" />
      {label && <span className="meta-label shrink-0">{label}</span>}
      {label && <span className="flex-1 h-px bg-line" />}
    </div>
  )
}
