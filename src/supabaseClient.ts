import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vwsvfyneyziytdmxkxgi.supabase.co';
const supabaseAnonKey = 'sb_publishable_lg-Gthxzjx9G5Yfw1r-EkQ_f-t5uWFA';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
