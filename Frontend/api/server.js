const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay');
const db = require('./db');

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// Initialize Razorpay SDK
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

// Cache to prevent concurrent verification scans from same session/user
const activeScans = new Set();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

const checkAndResetVerificationLimit = async (status, { userId, sessionId }) => {
  const lastReset = status.lastVerificationReset ? new Date(status.lastVerificationReset) : new Date(status.createdAt);
  const now = new Date();
  const msPassed = now - lastReset;
  const hoursPassed = msPassed / (1000 * 60 * 60);

  if (hoursPassed >= 24) {
    console.log(`24 hours passed since last reset for user/session ${userId || sessionId}. Resetting count.`);
    const updatedStatus = await db.resetVerificationUsage({
      userId,
      sessionId,
      resetTime: now.toISOString()
    });
    return updatedStatus;
  }
  return status;
};

// DB-backed Pro and Free Tier limits middleware
const checkProAccessLimit = async (req, res, next) => {
  console.log(`[Limit Flow] 1. Incoming request received at /api/verify`);
  console.log(`[Limit Flow] 2. Middleware checkProAccessLimit is executing`);

  let { userId, sessionId, email } = req.body;
  console.log(`[Limit Flow] 3. Request parameters parsed: userId=${userId}, sessionId=${sessionId}, email=${email}`);

  if (!sessionId) {
    console.log(`[Limit Flow] Validation error: Session ID is missing in request.`);
    return res.status(400).json({ error: 'Session ID is required.' });
  }

  const normalizedUserId = (userId && typeof userId === 'string' && userId.trim() !== '') ? userId : null;
  const scanKey = normalizedUserId || sessionId;

  if (activeScans.has(scanKey)) {
    console.log(`[Limit Flow] Request blocked: verification scan already in progress for key '${scanKey}'.`);
    return res.status(429).json({
      error: 'Verification in progress',
      message: 'A verification request is already in progress for this session. Please wait.'
    });
  }

  // Lock session scan
  activeScans.add(scanKey);
  req.scanKey = scanKey;

  try {
    console.log(`[Limit Flow] 4. Fetching subscription status from database for key: '${scanKey}'`);
    let status = await db.getOrCreateSubscription({ userId: normalizedUserId, sessionId, email });
    console.log(`[Limit Flow] 5. Subscription loaded: isPro=${status.isPro}, freeVerifications count=${status.freeVerifications}`);
    
    // Check and reset 24h limit
    status = await checkAndResetVerificationLimit(status, { userId: normalizedUserId, sessionId });

    if (status.isPro) {
      req.isPro = true;
      req.freeVerifications = 0;
      console.log(`[Limit Flow] 8. Request ALLOWED: User is Pro (limit bypassed).`);
      return next();
    }

    const blockCondition = (status.freeVerifications >= 5);
    console.log(`[Limit Flow] 6. Limit block condition check: (freeVerifications >= 5) => ${blockCondition}`);

    if (blockCondition) {
      activeScans.delete(scanKey);
      req.scanKey = null;
      console.log(`[Limit Flow] 7. Middleware BLOCKED request: Session '${sessionId}' has reached the limit (count=${status.freeVerifications}).`);
      return res.status(403).json({
        error: 'Free tier limit reached',
        message: 'You have used all 5 free daily verifications. Upgrade to Pro for unlimited access.',
        isPro: false,
        freeVerifications: status.freeVerifications
      });
    }

    req.isPro = false;
    req.freeVerifications = status.freeVerifications;
    console.log(`[Limit Flow] 8. Request ALLOWED: Free user below limit. Remaining scans: ${5 - status.freeVerifications}/5`);
    return next();
  } catch (err) {
    console.error(`[Limit Flow] Database check failed: ${err.message}`);
    activeScans.delete(scanKey);
    req.scanKey = null;
    return res.status(500).json({
      error: 'Database error',
      message: 'Failed to verify subscription status. Please try again.'
    });
  }
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP. Please wait 5 minutes and try again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);


const sanitizeText = (text) => {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[<>'"`;]/g, '')
    .replace(/\\/g, '')
    .replace(/(\r\n|\n|\r){3,}/g, '\n\n')
    .trim();
};

const verifyValidation = [
  body('text')
    .exists().withMessage('Text field is required')
    .isString().withMessage('Text must be a string')
    .isLength({ min: 10 }).withMessage('Text is too short. Please paste at least a sentence.')
    .isLength({ max: 10000 }).withMessage('Text is too long. Please keep it under 10000 characters.')
    .trim()
    .escape(),
];

app.get('/api/health', (req, res) => {
  res.json({
    status: 'Factwise backend is running',
    useSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    supabaseURL: process.env.SUPABASE_URL ? 'Configured' : 'Missing',
    supabaseKey: process.env.SUPABASE_SERVICE_KEY ? 'Configured' : 'Missing',
    port: process.env.PORT || 5000
  });
});

app.get('/api/ping', (req, res) => {
  res.json({ ping: 'pong', time: new Date().toISOString() });
});

// ─── Razorpay Endpoints ───────────────────────────────────────────────────────
app.get('/api/razorpay-key', (req, res) => {
  res.json({ keyId: process.env.RAZORPAY_KEY_ID || '' });
});

app.post('/api/create-order', async (req, res) => {
  const options = {
    amount: 29900, // ₹299 in paise (server-side fixed amount)
    currency: 'INR',
    receipt: `receipt_order_${Date.now()}`
  };
  try {
    const order = await razorpay.orders.create(options);
    res.json({ success: true, orderId: order.id, amount: order.amount });
  } catch (err) {
    console.error('Razorpay order creation failed:', err.message);
    res.status(500).json({ error: 'Failed to create payment order. Please try again.' });
  }
});

app.post('/api/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, sessionId, email } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required Razorpay payment fields.' });
  }

  try {
    const crypto = require('crypto');
    const secret = process.env.RAZORPAY_KEY_SECRET || '';
    const generated_signature = crypto
      .createHmac('sha256', secret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (generated_signature === razorpay_signature) {
      const updatedSub = await db.activatePro({ userId, sessionId, email, orderId: razorpay_order_id, paymentId: razorpay_payment_id });
      res.json({ success: true, message: 'Payment verified successfully. Pro access activated!', subscription: updatedSub });
    } else {
      res.status(400).json({ error: 'Payment verification failed. Invalid signature.' });
    }
  } catch (err) {
    console.error('Verify payment error:', err.message);
    res.status(500).json({ error: 'Internal server error during payment verification.' });
  }
});

app.get('/api/check-pro-status', async (req, res) => {
  const { userId, sessionId } = req.query;

  if (!sessionId && !userId) {
    return res.status(400).json({ error: 'Either User ID or Session ID is required.' });
  }

  const normalizedUserId = (userId && typeof userId === 'string' && userId.trim() !== '') ? userId : null;

  try {
    let status = await db.getOrCreateSubscription({ userId: normalizedUserId, sessionId });
    
    // Check and reset 24h limit
    status = await checkAndResetVerificationLimit(status, { userId: normalizedUserId, sessionId });

    res.json({ success: true, isPro: status.isPro, freeVerifications: status.freeVerifications });
  } catch (err) {
    console.error('Check status error:', err.message);
    res.status(500).json({ error: 'Failed to check subscription status.' });
  }
});

// Helper to ensure logical consistency of results
const ensureLogicalConsistency = (result) => {
  if (!result || !Array.isArray(result.claims) || result.claims.length === 0) {
    return result;
  }

  const claims = result.claims;
  const total = claims.length;
  const verifiedCount = claims.filter(c => c.status === 'verified').length;
  const conflictingCount = claims.filter(c => c.status === 'conflicting_info').length;
  const inaccurateCount = claims.filter(c => c.status === 'potentially_inaccurate').length;
  const unsupportedCount = claims.filter(c => c.status === 'unsupported').length;
  const humanVerificationCount = claims.filter(c => c.status === 'requires_human_verification').length;

  let computedOverall = result.overall;

  if (verifiedCount === total) {
    computedOverall = 'verified';
  } else if (conflictingCount > 0) {
    computedOverall = 'conflicting';
  } else if (inaccurateCount >= total / 2) {
    computedOverall = 'potentially_inaccurate';
  } else if (humanVerificationCount === total || (humanVerificationCount > 0 && verifiedCount === 0 && conflictingCount === 0 && inaccurateCount === 0 && unsupportedCount === 0)) {
    computedOverall = 'requires_human_verification';
  } else {
    computedOverall = 'questionable';
  }

  if (result.overall !== computedOverall) {
    console.log(`[Logical Consistency] Overriding overall verdict from '${result.overall}' to '${computedOverall}'`);
    result.overall = computedOverall;
  }

  return result;
};

// ── Verify Route ─────────────────────────────────────────────────────────────
app.post('/api/verify', checkProAccessLimit, verifyValidation, async (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.scanKey) activeScans.delete(req.scanKey);
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const text = sanitizeText(req.body.text);
  const userId = req.body.userId || null;

  if (!text || text.length === 0) {
    if (req.scanKey) activeScans.delete(req.scanKey);
    return res.status(400).json({ error: 'Text became empty after sanitization. Please try again.' });
  }

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are a fact-checking assistant for Factwise, an AI output verification assistant. Your job is to analyze text (often AI-generated) and verify its claims in plain English that anyone can understand — no technical jargon.

Analyze the following text and return a JSON response in exactly this format:
{
  "overall": "verified" | "conflicting" | "potentially_inaccurate" | "questionable" | "requires_human_verification",
  "summary": "A 2-3 sentence plain English summary of your overall finding. Keep it objective and encourage critical thinking.",
  "claims": [
    {
      "claim": "the specific claim extracted from the text",
      "quote": "the exact sentence or phrase from the original text containing this claim, matching word-for-word",
      "status": "verified" | "unsupported" | "potentially_inaccurate" | "conflicting_info" | "requires_human_verification",
      "explanation": "cautious explanation of why — max 2 sentences. Clearly highlight what is missing or conflicting."
    }
  ],
  "tip": "One practical tip for the user about this text"
}

Rules for Overall Verdict:
- "verified": Select this IF AND ONLY IF ALL extracted claims are marked "verified".
- "conflicting": Select this if there is ANY conflicting information in the claims (at least one claim status is "conflicting_info").
- "potentially_inaccurate": Select this if most claims (50% or more of the claims) are false or "potentially_inaccurate".
- "requires_human_verification": Select this ONLY when confidence is genuinely low, or all claims are subjective opinions or unresolvable.
- "questionable": Select this for mixed or uncertain evidence (e.g., some verified claims mixed with unsupported or requires_human_verification claims).

Rules for Claim Extraction & Lore:
- Extract maximum 6 most important claims.
- The 'quote' field MUST match a direct, case-sensitive substring from the input text exactly, so the UI can highlight it.
- Be cautious. Never claim to provide absolute truth. Avoid presenting uncertain claims as definitively false unless verification confidence is extremely high.
- Map each claim status to one of:
     - 'verified': claim is backed by established facts.
     - 'unsupported': statement lacks evidence or supporting details.
     - 'potentially_inaccurate': claim likely contradicts facts or contains errors.
     - 'conflicting_info': credible sources show conflicting reports.
     - 'requires_human_verification': claim is subjective, ambiguous, or requires human review.
- Distinguish properly between factual claims, opinions, fictional content, and incomplete context.
- If the text contains claims referring to fictional universes, lore, or canon (e.g. comic books, movies, novels, gaming lore), verify them within the context of that fiction/canon. For example, "Doctor Strange was a surgeon before becoming Sorcerer Supreme" is verified within Marvel canon and MUST be marked as "verified", not inaccurate or unsupported.
- Only return the JSON, nothing else.

Text to analyze:
${text}`
        }
      ]
    });

    const rawContent = response.choices[0].message.content;

    let result;
    try {
      const cleaned = rawContent.replace(/```json|```/g, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Could not parse verification result. Please try again.' });
    }

    if (!result.overall || !result.summary || !result.claims || !result.tip) {
      return res.status(500).json({ error: 'Incomplete verification result. Please try again.' });
    }

    // Programmatically enforce strict logical consistency
    result = ensureLogicalConsistency(result);

    // ─── Save to Supabase if user is logged in ────────────────────────────────
    if (userId && supabase) {
      try {
        await supabase.from('verifications').insert({
          user_id: userId,
          input_text: text,
          overall: result.overall,
          summary: result.summary,
          claims: result.claims,
          tip: result.tip,
        });
      } catch (dbError) {
        console.error('DB save error:', dbError.message);
        // Don't fail the request if DB save fails
      }
    }

    // Increment free verifications usage if not Pro
    let updatedVerifications = req.freeVerifications;
    if (!req.isPro) {
      try {
        const normalizedUserId = (req.body.userId && typeof req.body.userId === 'string' && req.body.userId.trim() !== '') ? req.body.userId : null;
        console.log(`[Limit Flow] 9. Executing incrementVerificationUsage() for sessionId: ${req.body.sessionId}`);
        const updatedSub = await db.incrementVerificationUsage({ userId: normalizedUserId, sessionId: req.body.sessionId });
        updatedVerifications = updatedSub.freeVerifications;
        console.log(`[Limit Flow] 10. Increment executed. Updated verification count in database: ${updatedVerifications}`);
      } catch (err) {
        console.error('[Limit Flow] Failed to increment usage count:', err.message);
        throw err;
      }
    }

    res.json({
      success: true,
      result,
      isPro: req.isPro,
      freeVerifications: updatedVerifications
    });

  } catch (error) {
    console.error('Verification error:', error.message);
    res.status(500).json({ error: 'Verification failed. Please try again in a moment.' });
  } finally {
    if (req.scanKey) {
      activeScans.delete(req.scanKey);
    }
  }
});

// ─── Get verification history for a user ─────────────────────────────────────
app.get('/api/history/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  try {
    const { data, error } = await supabase
      .from('verifications')
      .select('id, overall, summary, input_text, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json({ success: true, history: data });
  } catch (error) {
    console.error('History error:', error.message);
    res.status(500).json({ error: 'Could not fetch history. Please try again.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Factwise backend running on port ${PORT}`);
  });
}

module.exports = app;