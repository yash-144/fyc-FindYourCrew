import { createServiceRoleClient } from '@/lib/supabase/service-role'

export async function applyModeration(text: string): Promise<{ censoredText: string, status: 'CLEAN' | 'FLAGGED' }> {
  const supabase = createServiceRoleClient()

  // Fetch active moderation terms
  const { data: terms } = await supabase.from('moderation_terms').select('*').eq('is_active', true)
  
  if (!terms || terms.length === 0) {
    return { censoredText: text, status: 'CLEAN' }
  }

  let censoredText = text
  let status: 'CLEAN' | 'FLAGGED' = 'CLEAN'

  for (const t of terms) {
    const regex = new RegExp(`\\b${t.term}\\b`, 'gi')
    if (regex.test(censoredText)) {
      status = 'FLAGGED'
      censoredText = censoredText.replace(regex, t.replacement)
    }
  }

  return { censoredText, status }
}
