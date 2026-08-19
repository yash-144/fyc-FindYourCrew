'use client'

import { CREW_COLORS, type CrewColor } from '@/lib/crew-color'

export { CrewmateIcon as Crewmate } from '@/components/ui/crewmate-icon'
export { CREW_COLORS }
export type { CrewColor }

function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

/**
 * Hands out random colors with no immediate repeats: draws from a shuffled
 * bag of all 11 colors and only reshuffles once the bag is empty, so a full
 * lobby round-robins through every color before any repeats. Used only for
 * the lobby's live arrival order — everywhere else uses the stable
 * per-person color from crewColorForId (src/lib/crew-color.ts) so identity
 * stays consistent across pages.
 */
export class ColorBag {
  private bag: CrewColor[] = []

  next(): CrewColor {
    if (this.bag.length === 0) this.bag = shuffle(CREW_COLORS)
    return this.bag.pop()!
  }
}

/** Deterministic 0..1 pseudo-random derived from a string, for stable idle timing. */
export function seeded(id: string, salt: string): number {
  let h = 0
  const s = id + salt
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}
