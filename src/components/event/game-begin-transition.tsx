'use client'

import { useEffect, useState } from 'react'

/**
 * The one-time cinematic beat for "the game is about to begin": the screen
 * goes to black, holds, then fades back to transparent — revealing the
 * normal PRE_GAME phase content underneath (which already says "THE GAME IS
 * ABOUT TO BEGIN") as the wipe clears. Deliberately renders no text of its
 * own — an earlier version duplicated the PRE_GAME copy here so it could
 * fade in on top of the dark, but that meant two copies of the same text
 * briefly overlapping during the crossfade (the overlay is a `fixed inset-0`
 * covering the full viewport while the real content centers within the area
 * below the page header, so the two never lined up — visible as ghosting).
 * Reusing the real content instead of duplicating it sidesteps that
 * entirely: there is only ever one copy of the text in the DOM.
 */
export function GameBeginTransition({ active }: { active: boolean }) {
  const [stage, setStage] = useState<'idle' | 'dark' | 'fadeOut'>('idle')

  useEffect(() => {
    if (!active) return
    setStage('dark')
    const toFadeOut = window.setTimeout(() => setStage('fadeOut'), 500 + 900)
    const toIdle = window.setTimeout(() => setStage('idle'), 500 + 900 + 700)
    return () => {
      window.clearTimeout(toFadeOut)
      window.clearTimeout(toIdle)
    }
  }, [active])

  if (stage === 'idle') return null

  return (
    <div
      className={`fixed inset-0 z-50 bg-black pointer-events-none transition-opacity ease-out ${
        stage === 'fadeOut' ? 'opacity-0 duration-700' : 'opacity-100 duration-500'
      }`}
    />
  )
}
