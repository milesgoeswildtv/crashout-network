import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase = url && key ? createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}) : null;
export const destinations = ['shyst','poker','realms','rituals','degen','mmo'] as const;
export type Destination = typeof destinations[number];
