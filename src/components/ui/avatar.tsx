import { crewColorForId } from '@/lib/crew-color'
import { CrewmateIcon } from './crewmate-icon'

const SIZE_PX = {
  sm: 28,
  md: 40,
  lg: 60,
} as const

export function Avatar({
  id,
  name,
  size = 'md',
  variant = 'dark',
}: {
  id: string
  name: string
  size?: keyof typeof SIZE_PX
  /** 'dark' for the crew-facing pages, 'light' for admin's paper theme. */
  variant?: 'dark' | 'light'
}) {
  const color = crewColorForId(id)
  const px = SIZE_PX[size]
  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center overflow-hidden ${
        variant === 'dark' ? 'bg-space-panel-raised' : 'bg-card border-[1.5px] border-line'
      }`}
      style={{ width: px, height: px }}
      title={name}
    >
      <CrewmateIcon color={color} size={Math.round(px * 1.15)} />
    </div>
  )
}
