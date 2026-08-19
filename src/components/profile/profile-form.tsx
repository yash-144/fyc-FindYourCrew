'use client'

import { useState } from 'react'
import { joinEvent } from '@/app/profile/actions'

interface ProfileFormProps {
  eventId: string
  userEmail: string
}

export function ProfileForm({ eventId, userEmail }: ProfileFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)

    const result = await joinEvent(formData)
    if (result?.error) {
      setError(result.error)
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <input type="hidden" name="eventId" value={eventId} />

      {/* Email — read-only, sourced from Google auth */}
      <div className="space-y-1.5">
        <label htmlFor="email" className="crew-label">
          Email
        </label>
        <div className="relative">
          <input
            type="email"
            id="email"
            value={userEmail}
            readOnly
            disabled
            className="input-among pr-20 font-mono text-sm"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[0.6rem] tracking-wider text-starlight-dim border border-space-line px-1.5 py-0.5 rounded">
            GOOGLE
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="phone_number" className="crew-label">
          Phone Number
        </label>
        <input
          type="tel"
          id="phone_number"
          name="phone_number"
          required
          placeholder="e.g. +91 98765 43210"
          className="input-among"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="department" className="crew-label">
          Department
        </label>
        <input
          type="text"
          id="department"
          name="department"
          required
          placeholder="e.g. Computer Science"
          className="input-among"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="course" className="crew-label">
          Course
        </label>
        <input
          type="text"
          id="course"
          name="course"
          required
          placeholder="e.g. BSc Computer Science"
          className="input-among"
        />
      </div>

      {error && (
        <div className="font-mono text-xs text-red border-[1.5px] border-red bg-red-tint p-2.5 rounded-lg">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="btn-among w-full py-3.5"
      >
        {isLoading ? 'Boarding...' : 'BOARD THE SHIP'}
      </button>
    </form>
  )
}
