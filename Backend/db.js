const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const JSON_FILE_PATH = path.join(__dirname, 'data', 'subscriptions.json');

// Ensure data folder exists
function ensureDataDir() {
  const dir = path.dirname(JSON_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Local JSON File helpers
function readLocalSubscriptions() {
  ensureDataDir();
  if (!fs.existsSync(JSON_FILE_PATH)) {
    return [];
  }
  try {
    const data = fs.readFileSync(JSON_FILE_PATH, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading subscriptions JSON, using empty array:', err.message);
    return [];
  }
}

function writeLocalSubscriptions(subs) {
  ensureDataDir();
  try {
    fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(subs, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing subscriptions JSON:', err.message);
  }
}

// Supabase client instance
let supabase = null;
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

if (useSupabase) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('Database Client: Supabase module initialized');
  } catch (e) {
    console.error('Supabase client creation failed:', e.message);
    throw e;
  }
} else {
  console.log('Database Client: Supabase not configured. Using JSON file fallback.');
}

async function getOrCreateSubscription({ userId, sessionId, email }) {
  if (useSupabase) {
    try {
      let data = null;
      let error = null;

      // 1. Try to find by userId (if provided)
      if (userId) {
        ({ data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle());
      }

      // 2. If not found by userId, try to find by sessionId (if provided)
      if (!data && sessionId) {
        ({ data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('session_id', sessionId)
          .maybeSingle());

        // Link userId/email if found by sessionId but userId wasn't set yet
        if (data && userId && !data.user_id) {
          const { data: updated, error: linkErr } = await supabase
            .from('subscriptions')
            .update({ user_id: userId, email: email, updated_at: new Date().toISOString() })
            .eq('id', data.id)
            .select('*')
            .single();
          if (linkErr) throw linkErr;
          data = updated;
        }
      }

      if (error) throw error;

      if (data) {
        return {
          userId: data.user_id,
          sessionId: data.session_id,
          email: data.email,
          paymentId: data.payment_id,
          orderId: data.order_id,
          isPro: data.is_pro,
          freeVerifications: data.free_verifications || 0,
          lastVerificationReset: data.last_verification_reset,
          createdAt: data.created_at,
          updatedAt: data.updated_at
        };
      }

      // 3. Create new record if not found
      const newRecord = {
        user_id: userId || null,
        session_id: sessionId || null,
        email: email || null,
        is_pro: false,
        free_verifications: 0,
        last_verification_reset: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('subscriptions')
        .insert(newRecord)
        .select('*')
        .single();

      if (insertErr) throw insertErr;

      return {
        userId: inserted.user_id,
        sessionId: inserted.session_id,
        email: inserted.email,
        paymentId: inserted.payment_id,
        orderId: inserted.order_id,
        isPro: inserted.is_pro,
        freeVerifications: inserted.free_verifications || 0,
        lastVerificationReset: inserted.last_verification_reset,
        createdAt: inserted.created_at,
        updatedAt: inserted.updated_at
      };

    } catch (dbErr) {
      console.error('Supabase query error in getOrCreateSubscription:', dbErr.message);
      throw dbErr; // Let the caller (server.js) catch and fail securely with 500
    }
  }

  // JSON Fallback
  const subs = readLocalSubscriptions();
  let sub = null;
  if (userId) {
    sub = subs.find(s => s.userId === userId);
  }
  if (!sub && sessionId) {
    sub = subs.find(s => s.sessionId === sessionId);
    if (sub && userId && !sub.userId) {
      sub.userId = userId;
      if (email) sub.email = email;
      sub.updatedAt = new Date().toISOString();
      writeLocalSubscriptions(subs);
    }
  }

  if (sub) {
    if (!sub.lastVerificationReset) {
      sub.lastVerificationReset = sub.createdAt || new Date().toISOString();
      writeLocalSubscriptions(subs);
    }
    return sub;
  }

  // Create local
  const newSub = {
    userId: userId || null,
    sessionId: sessionId || null,
    email: email || null,
    paymentId: null,
    orderId: null,
    isPro: false,
    freeVerifications: 0,
    lastVerificationReset: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  subs.push(newSub);
  writeLocalSubscriptions(subs);
  return newSub;
}

async function activatePro({ userId, sessionId, email, orderId, paymentId }) {
  if (useSupabase) {
    try {
      let data = null;
      if (userId) {
        const { data: byUser } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
        data = byUser;
      }
      if (!data && sessionId) {
        const { data: bySession } = await supabase.from('subscriptions').select('*').eq('session_id', sessionId).maybeSingle();
        data = bySession;
      }

      const updateData = {
        is_pro: true,
        order_id: orderId,
        payment_id: paymentId,
        updated_at: new Date().toISOString()
      };
      if (userId) updateData.user_id = userId;
      if (email) updateData.email = email;

      if (data) {
        const { data: updated, error } = await supabase
          .from('subscriptions')
          .update(updateData)
          .eq('id', data.id)
          .select('*')
          .single();
        if (error) throw error;
        return {
          userId: updated.user_id,
          sessionId: updated.session_id,
          email: updated.email,
          paymentId: updated.payment_id,
          orderId: updated.order_id,
          isPro: updated.is_pro,
          freeVerifications: updated.free_verifications || 0,
          lastVerificationReset: updated.last_verification_reset,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at
        };
      } else {
        const newRecord = {
          user_id: userId || null,
          session_id: sessionId || null,
          email: email || null,
          is_pro: true,
          order_id: orderId,
          payment_id: paymentId,
          free_verifications: 0,
          last_verification_reset: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const { data: inserted, error } = await supabase
          .from('subscriptions')
          .insert(newRecord)
          .select('*')
          .single();
        if (error) throw error;
        return {
          userId: inserted.user_id,
          sessionId: inserted.session_id,
          email: inserted.email,
          paymentId: inserted.payment_id,
          orderId: inserted.order_id,
          isPro: inserted.is_pro,
          freeVerifications: inserted.free_verifications || 0,
          lastVerificationReset: inserted.last_verification_reset,
          createdAt: inserted.created_at,
          updatedAt: inserted.updated_at
        };
      }
    } catch (dbErr) {
      console.error('Supabase query error in activatePro:', dbErr.message);
      throw dbErr;
    }
  }

  // JSON Fallback
  const subs = readLocalSubscriptions();
  let sub = null;
  if (userId) {
    sub = subs.find(s => s.userId === userId);
  }
  if (!sub && sessionId) {
    sub = subs.find(s => s.sessionId === sessionId);
  }

  if (sub) {
    sub.isPro = true;
    sub.orderId = orderId;
    sub.paymentId = paymentId;
    if (userId) sub.userId = userId;
    if (email) sub.email = email;
    if (!sub.lastVerificationReset) {
      sub.lastVerificationReset = new Date().toISOString();
    }
    sub.updatedAt = new Date().toISOString();
  } else {
    sub = {
      userId: userId || null,
      sessionId: sessionId || null,
      email: email || null,
      paymentId: paymentId,
      orderId: orderId,
      isPro: true,
      freeVerifications: 0,
      lastVerificationReset: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    subs.push(sub);
  }
  writeLocalSubscriptions(subs);
  return sub;
}

async function incrementVerificationUsage({ userId, sessionId }) {
  if (useSupabase) {
    try {
      let data = null;
      if (userId) {
        const { data: byUser } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
        data = byUser;
      }
      if (!data && sessionId) {
        const { data: bySession } = await supabase.from('subscriptions').select('*').eq('session_id', sessionId).maybeSingle();
        data = bySession;
      }

      if (data) {
        const currentCount = data.free_verifications || 0;
        const { data: updated, error } = await supabase
          .from('subscriptions')
          .update({
            free_verifications: currentCount + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', data.id)
          .select('*')
          .single();
        if (error) throw error;
        return {
          userId: updated.user_id,
          sessionId: updated.session_id,
          email: updated.email,
          paymentId: updated.payment_id,
          orderId: updated.order_id,
          isPro: updated.is_pro,
          freeVerifications: updated.free_verifications || 0,
          lastVerificationReset: updated.last_verification_reset,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at
        };
      } else {
        const newRecord = {
          user_id: userId || null,
          session_id: sessionId || null,
          is_pro: false,
          free_verifications: 1,
          last_verification_reset: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const { data: inserted, error: insertErr } = await supabase
          .from('subscriptions')
          .insert(newRecord)
          .select('*')
          .single();
        if (insertErr) throw insertErr;
        return {
          userId: inserted.user_id,
          sessionId: inserted.session_id,
          email: inserted.email,
          paymentId: inserted.payment_id,
          orderId: inserted.order_id,
          isPro: inserted.is_pro,
          freeVerifications: inserted.free_verifications || 0,
          lastVerificationReset: inserted.last_verification_reset,
          createdAt: inserted.created_at,
          updatedAt: inserted.updated_at
        };
      }
    } catch (dbErr) {
      console.error('Supabase query error in incrementVerificationUsage:', dbErr.message);
      throw dbErr;
    }
  }

  // JSON Fallback
  const subs = readLocalSubscriptions();
  let sub = null;
  if (userId) {
    sub = subs.find(s => s.userId === userId);
  }
  if (!sub && sessionId) {
    sub = subs.find(s => s.sessionId === sessionId);
  }

  if (sub) {
    sub.freeVerifications = (sub.freeVerifications || 0) + 1;
    if (!sub.lastVerificationReset) {
      sub.lastVerificationReset = new Date().toISOString();
    }
    sub.updatedAt = new Date().toISOString();
  } else {
    sub = {
      userId: userId || null,
      sessionId: sessionId || null,
      email: null,
      paymentId: null,
      orderId: null,
      isPro: false,
      freeVerifications: 1,
      lastVerificationReset: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    subs.push(sub);
  }
  writeLocalSubscriptions(subs);
  return sub;
}

async function resetVerificationUsage({ userId, sessionId, resetTime }) {
  if (useSupabase) {
    try {
      let data = null;
      if (userId) {
        const { data: byUser } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
        data = byUser;
      }
      if (!data && sessionId) {
        const { data: bySession } = await supabase.from('subscriptions').select('*').eq('session_id', sessionId).maybeSingle();
        data = bySession;
      }

      if (data) {
        const { data: updated, error } = await supabase
          .from('subscriptions')
          .update({
            free_verifications: 0,
            last_verification_reset: resetTime,
            updated_at: new Date().toISOString()
          })
          .eq('id', data.id)
          .select('*')
          .single();
        if (error) throw error;
        return {
          userId: updated.user_id,
          sessionId: updated.session_id,
          email: updated.email,
          paymentId: updated.payment_id,
          orderId: updated.order_id,
          isPro: updated.is_pro,
          freeVerifications: updated.free_verifications || 0,
          lastVerificationReset: updated.last_verification_reset,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at
        };
      } else {
        const newRecord = {
          user_id: userId || null,
          session_id: sessionId || null,
          is_pro: false,
          free_verifications: 0,
          last_verification_reset: resetTime,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const { data: inserted, error: insertErr } = await supabase
          .from('subscriptions')
          .insert(newRecord)
          .select('*')
          .single();
        if (insertErr) throw insertErr;
        return {
          userId: inserted.user_id,
          sessionId: inserted.session_id,
          email: inserted.email,
          paymentId: inserted.payment_id,
          orderId: inserted.order_id,
          isPro: inserted.is_pro,
          freeVerifications: inserted.free_verifications || 0,
          lastVerificationReset: inserted.last_verification_reset,
          createdAt: inserted.created_at,
          updatedAt: inserted.updated_at
        };
      }
    } catch (dbErr) {
      console.error('Supabase query error in resetVerificationUsage:', dbErr.message);
      throw dbErr;
    }
  }

  // JSON Fallback
  const subs = readLocalSubscriptions();
  let sub = null;
  if (userId) {
    sub = subs.find(s => s.userId === userId);
  }
  if (!sub && sessionId) {
    sub = subs.find(s => s.sessionId === sessionId);
  }

  if (sub) {
    sub.freeVerifications = 0;
    sub.lastVerificationReset = resetTime;
    sub.updatedAt = new Date().toISOString();
  } else {
    sub = {
      userId: userId || null,
      sessionId: sessionId || null,
      email: null,
      paymentId: null,
      orderId: null,
      isPro: false,
      freeVerifications: 0,
      lastVerificationReset: resetTime,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    subs.push(sub);
  }
  writeLocalSubscriptions(subs);
  return sub;
}

module.exports = {
  getOrCreateSubscription,
  activatePro,
  incrementVerificationUsage,
  resetVerificationUsage
};
