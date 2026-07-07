import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstEquals = trimmed.indexOf('=');
    if (firstEquals === -1) continue;
    const key = trimmed.substring(0, firstEquals).trim();
    const value = trimmed.substring(firstEquals + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Get a citizen user
  const { data: profiles, error: err } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('role', 'citizen')
    .limit(1);

  if (err || !profiles || profiles.length === 0) {
    console.error('Error fetching citizen:', err);
    return;
  }

  const userId = profiles[0].id;
  console.log(`Testing with user ID: ${userId} (${profiles[0].username})...`);

  try {
    console.log('Query 1: profiles...');
    const { data: profile, error: err1 } = await supabase
      .from('profiles')
      .select('username, full_name, xp, level, streak')
      .eq('id', userId)
      .maybeSingle();
    console.log('Profile:', profile, 'Error:', err1);

    console.log('\nQuery 2: global_leaderboard...');
    const { data: rankData, error: err2 } = await supabase
      .from('global_leaderboard')
      .select('rank')
      .eq('id', userId)
      .maybeSingle();
    console.log('RankData:', rankData, 'Error:', err2);

    console.log('\nQuery 3: profile_badges...');
    const { data: badgesData, error: err3 } = await supabase
      .from('profile_badges')
      .select('earned_at, badges(title, description, icon_url)')
      .eq('profile_id', userId);
    console.log('BadgesData:', badgesData, 'Error:', err3);

    if (badgesData) {
      const badges = (badgesData || []).map((pb: any) => ({
        earned_at: pb.earned_at,
        ...pb.badges,
      }));
      console.log('Processed Badges:', badges);
    }
  } catch (e: any) {
    console.error('Exception thrown:', e.message || e);
  }
}

run();
