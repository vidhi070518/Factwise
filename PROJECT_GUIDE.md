# Factwise — Project Architecture, End-to-End Workflow & Recruiter Q&A

This guide serves as a comprehensive overview of **Factwise**. Read this document to understand the underlying mechanics, technical decisions, and security implementations of the application. It also contains a curated list of questions recruiters might ask and how you should answer them.

---

## 1. Executive Summary
**Factwise** is a full-stack, AI-powered content verification application that analyzes text (e.g., AI-generated drafts, articles, or claims) and uses a large language model (LLM) to extract, verify, and highlight claims with detailed citations. It includes user authentication, verification history saving, responsive premium design, and enterprise-grade backend security.

---

## 2. Tech Stack & Technologies Used

### Frontend (Client-Side)
* **HTML5**: Structured semantic markup designed with SEO best practices and accessibility in mind.
* **Vanilla CSS3**: Styled completely from scratch without external frameworks like Bootstrap or Tailwind. It utilizes CSS custom properties (variables), Flexbox, Grid, glassmorphism overlays, and smooth cubic-bezier micro-animations.
* **Vanilla JS (ES6+ ES Modules)**: Used for DOM manipulation, reactive UI updates, loading-tracker animations, and connecting directly to Supabase client auth via ES Modules (`@supabase/supabase-js/+esm`).

### Backend (Server-Side)
* **Node.js & Express.js**: Handles API endpoints, routes incoming requests, manages rate limiting, and wraps secure service integrations.
* **Groq SDK**: Connects securely to the **openai/gpt-oss-120b** model via Groq's high-speed inference engine to perform advanced semantic fact-checking.
* **Supabase Client SDK**: Used in two modes:
  1. **Client-side**: Standard authentication (handling logins, sessions, and sign-outs).
  2. **Server-side**: Administrative actions (creating pre-confirmed users using the Supabase Service Role Key).

### Deployment
* **Vercel**: Deploys the static frontend files and hosts the Node/Express backend as serverless functions, using custom routes configured in `vercel.json` to enable Clean URLs.

---

## 3. End-to-End Architecture & Data Flow

### A. Authentication Flows
```
[User Signup]
  │ (Email & Password)
  ▼
[Frontend: app.js] ──(Fetch POST)──► [Backend: /api/signup]
                                           │
                                           ├─► Uses Supabase SERVICE_KEY (Admin API)
                                           ├─► Calls: supabase.auth.admin.createUser
                                           ├─► Sets email_confirm: true (Bypasses email verification)
                                           ▼
[Frontend: app.js] ◄──(Success 200)────── [User Created & Confirmed]
  │
  ├─► Calls client-side: supabase.auth.signInWithPassword()
  ▼
[User Logged In & Session Saved in LocalStorage]
```

### B. Text Verification & Analysis Flow
1. **Request Submission**: A logged-in or guest user pastes text (minimum 10 chars, max 10,000) and clicks **Verify Text**.
2. **Concurrency Lock (Server)**: The server registers a unique lock key (User ID if logged in, or Session ID if guest). If the user double-clicks or double-submits, any concurrent request is instantly blocked with a `429 Too Many Requests` code.
3. **AI Evaluation (Groq)**: The backend cleans the input text and sends a structured prompt to the openai/gpt-oss-120b model on Groq. The prompt requests a strict JSON output matching this schema:
   ```json
   {
     "overall": "verified" | "conflicting" | "potentially_inaccurate" | "questionable" | "requires_human_verification",
     "summary": "...",
     "claims": [{ "claim": "...", "quote": "...", "status": "...", "explanation": "..." }],
     "tip": "..."
   }
   ```
4. **Logical Consistency Check**: The backend double-checks the LLM's classification logic programmatically (e.g. ensuring the overall verdict is marked `verified` *only* if all claims are verified).
5. **Database Storage**: If the user is logged in, the server saves the complete input text and AI analysis payload directly into the Supabase database.
6. **Frontend Highlights**: The frontend parses the returned claims and matches the direct `quote` fields against the original text. It dynamically injects `<mark>` tags styled with color-coded CSS overlays to highlight verified vs. inaccurate statements.

---

## 4. Key Engineering & Security Highlights (The "Wow" Factors)

* **Backend Proxy Pattern (API Key Protection)**: No sensitive keys (`GROQ_API_KEY`, `SUPABASE_SERVICE_KEY`) are exposed to the client. The frontend only talks to your backend, keeping your API bills secure.
* **Active Concurrency Lock**: Prevents API abuse and token waste by tracking active scans in a server-side `Set` cache. If a scan is already running for a user, subsequent clicks are locked until it completes.
* **Email Bounce Prevention**: By creating users via the admin client with `email_confirm: true`, you bypass Supabase's transactional emails, preventing email bounces and complaints when testing with fake emails.
* **Rate Limiting**: Integrated `express-rate-limit` to block malicious brute-force attacks on the API.
* **Clean URLs**: Implemented a routing matrix in Vercel to serve neat routes (e.g., `/history` instead of `/history.html`), maintaining fallback compatibility for local `file://` execution.

---

## 5. Recruiter Q&A Cheat Sheet

#### Q: "Why did you build this with Vanilla JavaScript and CSS instead of React, Next.js, or Tailwind?"
> **Answer**: *"I chose Vanilla JS and CSS to demonstrate my deep understanding of core web fundamentals. Frameworks abstract away the DOM and styling mechanics. By building this with Vanilla JS and CSS, I show that I can write clean, high-performance code, manage DOM state reactively, design responsive layout systems from scratch, and configure custom build configurations on Vercel without relying on templates."*

#### Q: "How did you solve the Supabase signup email verification issue?"
> **Answer**: *"By default, Supabase sends verification emails on signup. When developing or testing, sending emails to dummy accounts leads to bounced emails and spam complaints. To solve this, I decoupled the signup flow. The client sends a request to my Express backend, which uses the Supabase Admin/Service Key to create the user with `email_confirm: true`. This marks them as confirmed immediately in the database without sending any emails. The client then logs them in instantly using standard passwords."*

#### Q: "How do you protect your API endpoints from abuse and extra charges?"
> **Answer**: *"I implemented a multi-layered security system: first, standard rate limiting via middleware blocks automated spam. Second, I built a server-side concurrency lock using a tracking Set. When a user initiates a text analysis scan, their User ID or Session ID is locked. If they try to click the button multiple times, the server rejects the duplicates. The lock is released only when the API request finishes or closes."*

#### Q: "How does the highlight feature work on the home page?"
> **Answer**: *"When the AI returns the fact-checking analysis, it includes the exact quote from the text it evaluated. In JavaScript, I sort the claims by quote length to avoid nested replacement errors, escape the strings to prevent XSS, and use Regular Expressions to insert temporary markers around the quotes. Finally, I replace these markers with custom CSS `<mark>` tags styled with transparent color overlays."*

#### Q: "How did you implement Clean URLs on a static site?"
> **Answer**: *"I configured Vercel routes in `vercel.json` to handle 308 Permanent Redirects from standard HTML extensions (like `/history.html` to `/history`). I then set up internal rewrites so Vercel serves the correct HTML content behind the scenes. Lastly, I updated the JavaScript path checks to support both clean and relative paths so that the app runs smoothly in production and local dev servers alike."*
