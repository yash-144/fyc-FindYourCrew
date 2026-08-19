import type { CrewColor } from '@/lib/crew-color'

// Renders one of the copyright-free crew-color SVGs in public/sprites/players/
// (supplied directly by the project owner — not the ripped Innersloth files
// in /sprites/player). Pure presentational, no client-only behavior.
export function CrewmateIcon({
  color,
  size = 56,
  className,
}: {
  color: CrewColor
  size?: number
  className?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/sprites/players/${color}.svg`}
      alt=""
      width={size}
      height={size}
      className={className}
      draggable={false}
      aria-hidden="true"
    />
  )
}
