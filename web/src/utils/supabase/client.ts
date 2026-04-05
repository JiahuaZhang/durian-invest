import { createClient } from '@supabase/supabase-js'

export function getSupabaseClient() {
    const url = process.env['VITE_SUPABASE_URL'] ?? ''
    const key = process.env['VITE_SUPABASE_KEY'] ?? ''
    return createClient(url, key)
}
