import { LogOut } from "lucide-react"
import { signOut } from "@/app/auth/actions"
import { Avatar } from "./avatar"

// Header for the crew-facing (dark/spaceship) pages — profile, event, chat.
// Admin keeps its own AppHeader (paper/ink) untouched.
export function CrewHeader({
  eyebrow,
  title,
  id,
  name,
  email,
  children,
}: {
  eyebrow?: string
  title?: string
  id: string
  name?: string | null
  email?: string | null
  children?: React.ReactNode
}) {
  const displayName = name?.trim() || email?.split("@")[0] || "Unknown"

  return (
    <header className="w-full border-b-2 border-space-line bg-space/90 backdrop-blur-sm relative z-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="crew-label-red">{eyebrow}</div>}
          {title && (
            <h1 className="font-display font-bold text-lg sm:text-xl text-starlight truncate">
              {title}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {children}

          {(name || email) && (
            <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l-2 border-space-line">
              <Avatar id={id} name={displayName} size="sm" variant="dark" />
              <div className="min-w-0 leading-tight">
                <div className="text-sm font-semibold text-starlight truncate max-w-[10rem]">{displayName}</div>
                {email && (
                  <div className="font-mono text-[0.65rem] text-starlight-dim truncate max-w-[10rem]">{email}</div>
                )}
              </div>
            </div>
          )}

          <form action={signOut}>
            <button type="submit" className="btn-icon-among" title="Sign out">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
