'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

export async function loginWithGoogle(formData: FormData) {
  const supabase = await createClient()
  const nextUrl = formData.get('nextUrl')?.toString() || '/profile'
  
  // Resolve the origin dynamically since window.location is not available on the server
  const headersList = await headers()
  const host = headersList.get('host') || 'localhost:3000'
  
  // Use http for localhost, local IPs, or if we're explicitly in development mode
  const isLocal = host.includes('localhost') || host.match(/^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[0-1]))/) || process.env.NODE_ENV === 'development';
  const protocol = headersList.get('x-forwarded-proto') || (isLocal ? 'http' : 'https')
  const origin = `${protocol}://${host}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback?next=${nextUrl}`,
    },
  })

  if (error) {
    console.error('OAuth error:', error)
    redirect('/?error=Could+not+authenticate')
  }

  if (data.url) {
    redirect(data.url)
  }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
