'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Crossfades content whenever `phaseKey` changes — a brief fade-out of the
 * old phase, then a fade-in of the new one. Used between question / locked /
 * reveal / matching states so transitions read as deliberate beats rather
 * than an instant content swap.
 */
export function PhaseFade({ phaseKey, children }: { phaseKey: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(true)
  const prevKey = useRef(phaseKey)

  useEffect(() => {
    if (prevKey.current === phaseKey) return
    prevKey.current = phaseKey
    setVisible(false)
    const t = window.setTimeout(() => setVisible(true), 160)
    return () => window.clearTimeout(t)
  }, [phaseKey])

  return (
    <div className={`transition-all duration-200 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}>
      {children}
    </div>
  )
}
