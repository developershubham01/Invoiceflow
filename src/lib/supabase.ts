import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuencakasnfzpozkwhon.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_z-tvIX8cGd37EG8qcPd6hg_O0DFbsxX'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
