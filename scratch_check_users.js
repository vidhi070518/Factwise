const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'Backend', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  try {
    console.log('Listing users from Supabase...');
    const { data, error } = await supabase.auth.admin.listUsers();
    
    if (error) {
      console.error('Error listing users:', error);
    } else {
      console.log(`Successfully retrieved ${data.users.length} users:`);
      data.users.forEach((user, index) => {
        console.log(`[${index + 1}] Email: ${user.email}`);
        console.log(`    ID: ${user.id}`);
        console.log(`    Confirmed At: ${user.email_confirmed_at}`);
        console.log(`    Last Sign In: ${user.last_sign_in_at}`);
        console.log(`    Created At: ${user.created_at}`);
        console.log('------------------------------------------------');
      });
    }
  } catch (err) {
    console.error('Execution error:', err);
  }
}

run();
