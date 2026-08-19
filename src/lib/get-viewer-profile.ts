import type { SupabaseClient } from "@supabase/supabase-js"

/** Fetches the display identity (name/avatar) for the AppHeader. Best-effort — never throws. */
export async function getViewerProfile(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", userId)
    .maybeSingle()

  return {
    fullName: (data?.full_name as string | undefined) ?? null,
    avatarUrl: (data?.avatar_url as string | undefined) ?? null,
  }
}
