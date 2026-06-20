const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dnxzkzpolkmwlhaqnfyy.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRueHprenBvbGttd2xoYXFuZnl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzU5MjIsImV4cCI6MjA5MzQ1MTkyMn0._2w-r8v0cLjxeHeYA71PQmg4sMulmlk6EMJymUNNF2c';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const email = `new_test_${Math.floor(Math.random() * 100000)}@gmail.com`;
  const password = 'Password123!';
  console.log(`Testing client-side signUp for email: ${email}`);

  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      console.error('Client-side signUp failed with error:', error.message);
    } else {
      console.log('Client-side signUp succeeded!');
      console.log('User ID:', data.user?.id);
      console.log('Session present:', !!data.session);
      console.log('Confirmed At:', data.user?.email_confirmed_at);
      if (data.session) {
        console.log('User auto-confirmed and logged in successfully!');
      } else {
        console.log('User is NOT confirmed. GoTrue STILL requires email confirmation!');
      }
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

run();
