const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000'
  : 'https://factwise-brown.vercel.app';


const SUPABASE_URL = 'https://dnxzkzpolkmwlhaqnfyy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRueHprenBvbGttd2xoYXFuZnl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzU5MjIsImV4cCI6MjA5MzQ1MTkyMn0._2w-r8v0cLjxeHeYA71PQmg4sMulmlk6EMJymUNNF2c';


// ── Supabase Client ────────────────────────────────────────────────────────────
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth State ─────────────────────────────────────────────────────────────────
let currentUser = null;

function getOrCreateSessionId() {
  let sid = localStorage.getItem('factwise_session_id');
  if (!sid) {
    sid = 'session_' + Math.random().toString(36).substring(2, 15) + '_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('factwise_session_id', sid);
    console.log(`[Session ID] Generated new sessionId: ${sid}`);
  } else {
    console.log(`[Session ID] Retrieved existing sessionId: ${sid}`);
  }
  return sid;
}



async function initAuth() {
  getOrCreateSessionId();

  console.log('[Auth Diagnostic] Checking for existing Supabase session...');
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('[Auth Diagnostic] Failed to get session on init:', error.message);
    }
    
    if (session) {
      currentUser = session.user;
      console.log('[Auth Diagnostic] Session restored successfully on page load:', {
        userId: currentUser.id,
        email: currentUser.email,
        expiresAt: new Date(session.expires_at * 1000).toLocaleString()
      });
      updateNavForUser(currentUser);
      if (window.location.pathname.includes('history.html')) {
        loadHistory();
      }
    } else {
      console.log('[Auth Diagnostic] No active session found on page load. User is Guest.');
      updateNavForGuest();
      
      // Check for success params on login.html load
      if (window.location.pathname.includes('login.html')) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('signup') === 'success') {
          const errorEl = document.getElementById('authError');
          if (errorEl) {
            errorEl.textContent = 'Account created successfully! Please log in below.';
            errorEl.style.color = 'var(--verified)';
          }
        }
      }
    }
  } catch (err) {
    console.error('[Auth Diagnostic] Critical error during initAuth getSession:', err);
  }

  console.log('[Auth Diagnostic] Registering auth state change listener...');
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log(`[Auth Diagnostic] Auth State Changed! Event: ${event}`, {
      hasSession: !!session,
      userId: session?.user?.id,
      email: session?.user?.email
    });
    
    currentUser = session?.user || null;
    if (currentUser) {
      console.log(`[Auth Diagnostic] Session active (Event: ${event}) for user: ${currentUser.email}`);
      updateNavForUser(currentUser);
      
      if (window.location.pathname.includes('history.html')) {
        const historyList = document.getElementById('historyList');
        if (historyList && (historyList.innerHTML.includes('Loading') || historyList.innerHTML.includes('Could not load'))) {
          console.log('[Auth Diagnostic] Triggering history load due to auth state change...');
          loadHistory();
        }
      }
    } else {
      console.log(`[Auth Diagnostic] Session cleared (Event: ${event}).`);
      updateNavForGuest();
    }
  });
}

// ── Nav Updates ────────────────────────────────────────────────────────────────
function updateNavForUser(user) {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;
  navLinks.innerHTML = `
    <a href="index.html#how-it-works" class="nav-link">How it works</a>
    <a href="history.html" class="nav-link">My History</a>
    <span class="nav-email">${user.email}</span>
    <button class="btn-outline" onclick="signOut()">Sign out</button>
  `;
}

function updateNavForGuest() {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;
  navLinks.innerHTML = `
    <a href="index.html#how-it-works" class="nav-link">How it works</a>
    <a href="login.html" class="nav-link">Log in</a>
    <button class="btn-primary" onclick="window.location.href='signup.html'">Sign up</button>
  `;
}

// ── Sign Out ───────────────────────────────────────────────────────────────────
async function signOut() {
  console.log('[Auth Diagnostic] signOut() initiated by user:', currentUser?.email);
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[Auth Diagnostic] signOut error:', error.message);
    } else {
      console.log('[Auth Diagnostic] signOut succeeded. Session cleared.');
    }
  } catch (err) {
    console.error('[Auth Diagnostic] signOut unhandled error:', err);
  }
  currentUser = null;
  window.location.href = 'index.html';
}

// ── Character Counter ──────────────────────────────────────────────────────────
const inputText = document.getElementById('inputText');
const charCount = document.getElementById('charCount');

if (inputText) {
  inputText.addEventListener('input', () => {
    const count = inputText.value.length;
    charCount.textContent = count;
    charCount.style.color = count > 9000 ? '#ef4444' : count > 7000 ? '#f59e0b' : '#94a3b8';
  });
}

// ── Scroll Helpers ─────────────────────────────────────────────────────────────
function scrollToChecker() {
  const ch = document.getElementById('checker');
  if (ch) {
    ch.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { if (inputText && !inputText.disabled) inputText.focus(); }, 600);
  }
}

// ── Verify Text Action ─────────────────────────────────────────────────────────
async function verifyText() {
  const text = inputText.value.trim();

  if (text.length < 10) {
    showError('Please paste at least a sentence to verify.');
    return;
  }

  if (text.length > 10000) {
    showError('Text is too long. Please keep it under 10,000 characters.');
    return;
  }

  showQuietLoading(true);
  hideError();
  hideResults();

  const payload = {
    text,
    userId: currentUser?.id || null,
    sessionId: getOrCreateSessionId(),
    email: currentUser?.email || null
  };
  console.log(`[Outgoing Verify Request] Payload:`, JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(`${BACKEND_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log(`[Incoming Verify Response] Status: ${response.status}, Payload:`, JSON.stringify(data, null, 2));

    if (!response.ok) {
      showError(data.error || 'Something went wrong. Please try again.');
      return;
    }

    if (data.success && data.result) {
      renderResults(data.result);
    } else {
      showError('Could not process the result. Please try again.');
    }

  } catch (err) {
    showError('Could not connect to Factwise. Please check your connection and try again.');
  } finally {
    showQuietLoading(false);
  }
}

// ── Text Highlight parsing ────────────────────────────────────────────────────
function generateTextBreakdown(text, claims) {
  let escapedText = escapeHTML(text);
  
  // Sort claims by quote length in descending order to avoid matching nested/shorter quotes incorrectly first
  const sortedClaims = [...claims]
    .filter(c => c.quote && c.quote.trim().length > 0)
    .sort((a, b) => b.quote.length - a.quote.length);
    
  sortedClaims.forEach(claim => {
    const rawQuote = claim.quote;
    const escapedQuote = escapeHTML(rawQuote);
    
    // Escape special regex characters in the quote
    const regexEscapedQuote = escapedQuote.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(regexEscapedQuote, 'gi');
    
    // Replace using placeholders to prevent subsequent iterations from matching within HTML tags
    const statusClass = `highlight-${claim.status}`;
    escapedText = escapedText.replace(regex, (match) => {
      return `__FACTWISE_MARK_START_${statusClass}__${match}__FACTWISE_MARK_END__`;
    });
  });
  
  // Reconstruct HTML replacing markers with mark tags
  escapedText = escapedText
    .replace(/__FACTWISE_MARK_START_(highlight-[a-z_]+)__/g, '<mark class="$1">')
    .replace(/__FACTWISE_MARK_END__/g, '</mark>');
    
  return escapedText;
}

// ── Render Results ─────────────────────────────────────────────────────────────
function renderResults(result) {
  const { overall, summary, claims, tip } = result;

  const verdictCard = document.getElementById('verdictCard');
  verdictCard.className = `verdict-card verdict-${overall}`;

  const icons = {
    verified: '✅',
    trusted: '✅',
    conflicting: '💜',
    potentially_inaccurate: '❌',
    unreliable: '❌',
    questionable: '⚠️',
    requires_human_verification: '🔍'
  };
  const labels = {
    verified: 'Verified Rating',
    trusted: 'Verified Rating',
    conflicting: 'Conflicting Rating',
    potentially_inaccurate: 'Potentially Inaccurate',
    unreliable: 'Potentially Inaccurate',
    questionable: 'Questionable Rating',
    requires_human_verification: 'Requires Human Verification'
  };

  document.getElementById('verdictIcon').textContent = icons[overall] || '🔍';
  document.getElementById('verdictValue').textContent = labels[overall] || (overall ? overall.replace(/_/g, ' ') : '');
  document.getElementById('verdictSummary').textContent = summary;

  // Build the text highlight panel
  const originalText = inputText.value;
  const highlightedHTML = generateTextBreakdown(originalText, claims);
  document.getElementById('visualBreakdownText').innerHTML = highlightedHTML;

  const claimsList = document.getElementById('claimsList');
  claimsList.innerHTML = '';

  claims.forEach(claim => {
    const statusLabels = { 
      verified: 'Verified Facts', 
      unsupported: 'Unsupported Statement', 
      potentially_inaccurate: 'Potentially Inaccurate',
      conflicting_info: 'Conflicting Information',
      requires_human_verification: 'Requires Human Verification'
    };
    const item = document.createElement('div');
    item.className = `claim-item ${claim.status}`;
    item.innerHTML = `
      <div class="claim-top">
        <span class="claim-badge">${statusLabels[claim.status] || claim.status}</span>
        <p class="claim-text">${escapeHTML(claim.claim)}</p>
      </div>
      <p class="claim-explanation">${escapeHTML(claim.explanation)}</p>
    `;
    claimsList.appendChild(item);
  });

  document.getElementById('tipText').textContent = tip;

  const results = document.getElementById('results');
  results.classList.remove('hidden');
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (!currentUser) {
    showSavePrompt();
  }
}

// ── Save Prompt for guests ─────────────────────────────────────────────────────
function showSavePrompt() {
  const existing = document.getElementById('savePrompt');
  if (existing) return;

  const prompt = document.createElement('div');
  prompt.id = 'savePrompt';
  prompt.className = 'save-prompt';
  prompt.innerHTML = `
    <p>👤 <strong>Create an account</strong> to save this result and access your verification history.</p>
    <button class="btn-primary" onclick="window.location.href='signup.html'">Save my results</button>
  `;
  document.getElementById('results').prepend(prompt);
}

// ── History ────────────────────────────────────────────────────────────────────
async function loadHistory() {
  if (!currentUser) {
    window.location.href = 'login.html';
    return;
  }

  const container = document.getElementById('historyList');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Loading your history...</p>';

  try {
    const response = await fetch(`${BACKEND_URL}/api/history/${currentUser.id}`);
    const data = await response.json();

    if (!data.success || data.history.length === 0) {
      container.innerHTML = '<p class="empty-text">No verifications yet. Go check some text!</p>';
      return;
    }

    container.innerHTML = '';
    data.history.forEach(item => {
      const date = new Date(item.created_at).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      const icons = {
        verified: '✅',
        trusted: '✅',
        conflicting: '💜',
        potentially_inaccurate: '❌',
        unreliable: '❌',
        questionable: '⚠️',
        requires_human_verification: '🔍'
      };
      const labelText = item.overall ? item.overall.replace(/_/g, ' ') : '';
      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="history-top">
          <span class="history-verdict verdict-${item.overall}">${icons[item.overall] || '🔍'} ${labelText}</span>
          <span class="history-date">${date}</span>
        </div>
        <p class="history-text">${escapeHTML(item.input_text.substring(0, 120))}...</p>
        <p class="history-summary">${escapeHTML(item.summary)}</p>
      `;
      container.appendChild(card);
    });

  } catch (err) {
    container.innerHTML = '<p class="empty-text">Could not load history. Please try again.</p>';
  }
}

// ── Reset Checker ──────────────────────────────────────────────────────────────
function resetChecker() {
  inputText.value = '';
  charCount.textContent = '0';
  charCount.style.color = '#94a3b8';
  hideResults();
  hideError();
  const savePrompt = document.getElementById('savePrompt');
  if (savePrompt) savePrompt.remove();
  const ch = document.getElementById('checker');
  if (ch) ch.scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => { if (inputText && !inputText.disabled) inputText.focus(); }, 600);
}

// ── Quiet Progression Loading Controller ───────────────────────────────────────
function showQuietLoading(state) {
  const tracker = document.getElementById('loadingTracker');
  const verifyBtn = document.getElementById('verifyBtn');
  const btnText = document.getElementById('btnText');
  const btnLoader = document.getElementById('btnLoader');

  if (state) {
    verifyBtn.disabled = true;
    btnText.textContent = 'Verifying...';
    if (btnLoader) btnLoader.classList.remove('hidden');
    if (tracker) {
      tracker.classList.remove('hidden');
      updateProgressStep('stepParse', 'active');
      updateProgressStep('stepExtract', 'pending');
      updateProgressStep('stepVerify', 'pending');
      updateProgressStep('stepCompile', 'pending');

      setTimeout(() => {
        updateProgressStep('stepParse', 'completed');
        updateProgressStep('stepExtract', 'active');
      }, 700);

      setTimeout(() => {
        updateProgressStep('stepExtract', 'completed');
        updateProgressStep('stepVerify', 'active');
      }, 1600);

      setTimeout(() => {
        updateProgressStep('stepVerify', 'completed');
        updateProgressStep('stepCompile', 'active');
      }, 2800);
    }
  } else {
    verifyBtn.disabled = false;
    if (inputText) inputText.disabled = false;
    btnText.textContent = 'Verify Text';
    if (btnLoader) btnLoader.classList.add('hidden');
    if (tracker) tracker.classList.add('hidden');
  }
}

function updateProgressStep(stepId, status) {
  const stepEl = document.getElementById(stepId);
  if (!stepEl) return;
  const indicator = stepEl.querySelector('.progress-indicator');
  
  stepEl.className = `progress-step ${status}`;
  if (status === 'completed') {
    indicator.innerHTML = '<span class="progress-check">✓</span>';
  } else if (status === 'active') {
    indicator.innerHTML = '<div class="progress-spinner"></div>';
  } else {
    indicator.innerHTML = '<span style="opacity: 0.4;">○</span>';
  }
}

// ── Error Management ───────────────────────────────────────────────────────────
function showError(message) {
  const errorBox = document.getElementById('errorBox');
  const errorText = document.getElementById('errorText');
  errorText.textContent = message;
  errorBox.classList.remove('hidden');
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  const box = document.getElementById('errorBox');
  if (box) box.classList.add('hidden');
}

function hideResults() {
  const res = document.getElementById('results');
  if (res) res.classList.add('hidden');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ── Keyboard shortcut ──────────────────────────────────────────────────────────
if (inputText) {
  inputText.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      if (!inputText.disabled) verifyText();
    }
  });
}

// ── Try Demo Templates Loading ─────────────────────────────────────────────────
const DEMO_TEMPLATES = {
  history: {
    text: "Napoleon Bonaparte was born in Paris in 1769. During the French Revolution, he quickly rose through the military ranks and declared himself Emperor of France in 1804. He famously defeated the British military at the Battle of Waterloo in 1815, solidifying his control over continental Europe until his retirement in Saint Helena.",
    result: {
      overall: "unreliable",
      summary: "This historical draft contains critical factual errors. Napoleon was born in Corsica (not Paris), and he was defeated at the Battle of Waterloo (not victorious). Always review military timelines.",
      claims: [
        {
          claim: "Napoleon Bonaparte was born in Paris in 1769.",
          quote: "born in Paris in 1769",
          status: "potentially_inaccurate",
          explanation: "He was born in Ajaccio, Corsica. He did not reside in Paris until his military schooling began."
        },
        {
          claim: "He rose through ranks and declared himself Emperor of France in 1804.",
          quote: "declared himself Emperor of France in 1804",
          status: "verified",
          explanation: "Historically verified. Napoleon crowned himself Emperor on December 2, 1804 at Notre-Dame."
        },
        {
          claim: "He famously defeated the British military at the Battle of Waterloo in 1815.",
          quote: "defeated the British military at the Battle of Waterloo in 1815",
          status: "potentially_inaccurate",
          explanation: "Napoleon was defeated at Waterloo by coalition forces. This battle directly forced his final abdication."
        },
        {
          claim: "Waterloo solidified his control over continental Europe until his retirement in Saint Helena.",
          quote: "solidifying his control over continental Europe until his retirement in Saint Helena",
          status: "unsupported",
          explanation: "He did not retire; he was exiled to Saint Helena as a British prisoner. His control ended at Waterloo."
        }
      ],
      tip: "Verify battle timelines and biographical coordinates using official academic historical archives."
    }
  },
  health: {
    text: "Drinking five liters of alkaline water every morning is the most effective way to permanently cure chronic headaches and flush out toxins. This practice is universally endorsed by neuroscientists. It instantly balances the body's pH levels, ensuring complete immunity to viral infections and preventing any future vascular inflammation.",
    result: {
      overall: "questionable",
      summary: "The medical assertions in this text lack clinical substantiation. While hydration helps mitigate tension headaches, extreme consumption rates are clinically dangerous.",
      claims: [
        {
          claim: "Drinking 5 liters of alkaline water cures headaches and flushes toxins.",
          quote: "Drinking five liters of alkaline water every morning is the most effective way to permanently cure chronic headaches and flush out toxins",
          status: "unsupported",
          explanation: "Consuming 5 liters rapidly exceeds kidney capacity, leading to water intoxication (hyponatremia). No evidence supports alkaline water as a headache cure."
        },
        {
          claim: "This practice is universally endorsed by neuroscientists.",
          quote: "universally endorsed by neuroscientists",
          status: "potentially_inaccurate",
          explanation: "This is incorrect. Neurological and medical boards advise against excessive consumption. Hydration advice is standardized at 2-3 liters daily."
        },
        {
          claim: "Alkaline water instantly balances the body's pH levels and ensures viral immunity.",
          quote: "instantly balances the body's pH levels, ensuring complete immunity to viral infections",
          status: "conflicting_info",
          explanation: "Systemic pH is tightly self-regulated by the kidneys and lungs. Dietary intake cannot shift it. Hydration cannot guarantee viral immunity."
        },
        {
          claim: "This prevents vascular inflammation.",
          quote: "preventing any future vascular inflammation",
          status: "requires_human_verification",
          explanation: "Vascular health depends on cardiovascular profiles and lifestyle. Consult a licensed physician to evaluate chronic inflammatory symptoms."
        }
      ],
      tip: "Adopt medical recommendations only from peer-reviewed clinical guidelines rather than general AI generation summaries."
    }
  }
};

function loadDemo(type) {
  const template = DEMO_TEMPLATES[type];
  if (!template) return;

  inputText.value = template.text;
  if (charCount) charCount.textContent = template.text.length;

  hideError();
  renderResults(template.result);

  // Mark the tip showing it's a simulated preview
  const tipText = document.getElementById('tipText');
  tipText.innerHTML = `${template.result.tip} <br><small style="color:var(--text-3); font-weight:500;">(Demo Sandbox: Loaded high-fidelity analysis model output instantly)</small>`;
}

// ── Auth Forms ─────────────────────────────────────────────────────────────────
async function handleSignup() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('authError');
  const btn = document.getElementById('authBtn');

  if (!email || !password) {
    errorEl.textContent = 'Please fill in all fields.';
    errorEl.style.color = 'var(--incorrect)';
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters.';
    errorEl.style.color = 'var(--incorrect)';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating account...';
  errorEl.textContent = '';
  errorEl.style.color = 'var(--incorrect)';

  console.log(`[Auth Diagnostic] handleSignup() signup attempt started for email: ${email}`);

  try {
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      console.error('[Auth Diagnostic] handleSignup() signup failed:', error.message);
      errorEl.textContent = error.message;
      btn.disabled = false;
      btn.textContent = 'Create account';
    } else {
      const user = data?.user;
      const session = data?.session;
      
      console.log('[Auth Diagnostic] handleSignup() signup call succeeded:', {
        userId: user?.id,
        email: user?.email,
        hasSession: !!session
      });

      // Note: public.profiles table does not exist in the database and is unused, so insertion is removed.
      
      if (session) {
        console.log('[Auth Diagnostic] handleSignup() session created immediately. Auto-logged in successfully.');
        window.location.href = 'index.html';
      } else {
        console.log('[Auth Diagnostic] handleSignup() signup completed but session is null. Redirecting to login...');
        window.location.href = 'login.html?signup=success';
      }
    }
  } catch (err) {
    console.error('[Auth Diagnostic] handleSignup() unexpected error:', err);
    errorEl.textContent = 'An unexpected error occurred. Please try again.';
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
}

async function handleLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('authError');
  const btn = document.getElementById('authBtn');

  if (!email || !password) {
    errorEl.textContent = 'Please fill in all fields.';
    errorEl.style.color = 'var(--incorrect)';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging in...';
  errorEl.textContent = '';
  errorEl.style.color = 'var(--incorrect)';

  console.log(`[Auth Diagnostic] handleLogin() login attempt started for email: ${email}`);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.error('[Auth Diagnostic] handleLogin() login failed:', error.message);
      errorEl.textContent = error.message;
      btn.disabled = false;
      btn.textContent = 'Log in';
    } else {
      console.log('[Auth Diagnostic] handleLogin() login call succeeded:', {
        userId: data.user?.id,
        email: data.user?.email,
        hasSession: !!data.session
      });
      window.location.href = 'index.html';
    }
  } catch (err) {
    console.error('[Auth Diagnostic] handleLogin() unexpected error:', err);
    errorEl.textContent = 'An unexpected error occurred. Please try again.';
    btn.disabled = false;
    btn.textContent = 'Log in';
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
initAuth();

// ── Expose functions to global scope ──────────────────────────────────────────
window.scrollToChecker = scrollToChecker;
window.verifyText = verifyText;
window.resetChecker = resetChecker;
window.signOut = signOut;
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.loadHistory = loadHistory;

// Expose demo features
window.loadDemo = loadDemo;