// Stable per-person crew color — deterministic so the same person always
// shows the same color everywhere (header, chat, lobby), unlike the lobby's
// arrival-order shuffle bag which is deliberately session-random for variety.

export const CREW_COLORS = [
  'red', 'blue', 'green', 'yellow', 'pink', 'orange', 'cyan', 'white', 'purple', 'black', 'brown',
] as const

export type CrewColor = (typeof CREW_COLORS)[number]

export function crewColorForId(id: string): CrewColor {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CREW_COLORS[h % CREW_COLORS.length]!
}
