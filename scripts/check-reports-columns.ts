import { createClient } from '@supabase/supabase-js';

const newUrl = 'https://uvwkhwryfofnteffrmxe.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2d2tod3J5Zm9mbnRlZmZybXhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTUxNTAsImV4cCI6MjA5ODc3MTE1MH0.6eVqtU3A7dsWb9Z1Zn8U0XzL8OT7ixbtOCbJbPHdKAE';

const supabase = createClient(newUrl, anonKey, {
  auth: { persistSession: false }
});

async function run() {
  const { data, error } = await supabase.from('reports').select('*').limit(1);
  if (error) {
    console.error('Error fetching report:', error.message);
    return;
  }
  if (data && data.length > 0) {
    console.log('Columns in reports table:', Object.keys(data[0]));
  } else {
    console.log('No reports found in database, fetching columns using select() with specific empty query...');
    const { data: emptyData, error: emptyError } = await supabase.from('reports').select('id').limit(0);
    if (emptyError) {
      console.error('Error:', emptyError.message);
    } else {
      console.log('Reports table exists.');
    }
  }
}

run();
