# Factwise — The Easy & Complete Guide for Interviews

This document explains everything about **Factwise** in simple, plain English. Read this guide to understand how the project works, how all the different pieces connect, and how to answer questions during interviews with 100% confidence.

---

## 1. What is Factwise? (The Simple Explanation)
**Factwise** is a website that fact-checks text. 
* A user copies a piece of text (like an AI draft, a news paragraph, or a post) and pastes it into the text box.
* The application extracts the claims made in that text and scans them.
* It highlights the exact sentences in the text using colors (Green for Verified, Red for Inaccurate, Purple for Conflicting, etc.) so the user can easily see what is true and what is false.
* Users can sign up for an account to save their history, allowing them to look back at their previous fact checks anytime.

---

## 2. The Tech Stack: What We Used and Why

### A. The Frontend (What the User Sees)
* **HTML5**: Creates the basic structure (boxes, input fields, navigation bar, buttons).
* **Vanilla CSS3**: Styles the website completely from scratch.
  * **Harmonious Dark Theme**: Uses dark blues (`#0b0f19`, `#131b2e`) and subtle glows to create a modern, premium aesthetic.
  * **Glassmorphism**: Nav bars and buttons have semi-transparent backgrounds with a blur filter (`backdrop-filter: blur(12px)`) so they look like frosted glass.
  * **Transitions**: Smooth animations for button hovers and modal pop-ups.
* **Vanilla JavaScript (ES6 Modules)**: Controls the interactivity.
  * *Why "Vanilla"?* It means we did not use complex frameworks like React or Angular. This shows recruiters that you understand the core mechanics of how browsers load files, structure the document tree (DOM), and handle state natively.

### B. The Backend (The Engine)
* **Node.js & Express.js**: Our server that listens to the frontend's requests.
  * *Why do we need a backend?* Security. If the frontend called the database or the AI directly, our secret API keys would be visible to anyone inspecting the website's source code. The backend acts as a shield, keeping keys hidden in a private `.env` environment file.

### C. The Database & Authentication: Supabase
* **Supabase** is a cloud database platform (a modern alternative to Firebase).
  * **Auth**: Handles signing up, logging in, logging out, and managing browser sessions.
  * **Database Table (`verifications`)**: Stores every fact check. Each record contains the user's ID, the input text, the AI summary, the individual claims, and the creation timestamp.

### D. The AI: Groq & OpenAI GPT-OSS
* **Groq** is a lightning-fast cloud service designed to run Artificial Intelligence models at extreme speeds.
* **openai/gpt-oss-120b** is the AI model we connect to. It acts as our semantic reasoning engine, analyzing the text and checking if the claims are logically consistent with established facts.

### E. Hosting: Vercel
* **Vercel** hosts our website. It serves our static frontend files and hosts our backend code inside serverless functions.

---

## 3. End-to-End Walkthrough: How Everything Connects

### A. Signing Up (How we solved the Email Confirmation Loop)
1. **The Old Problem**: When a user signed up, Supabase sent a verification email. If developers used test/fake emails (like `test12@gmail.com`), the emails bounced, causing warnings. Also, users could not log in until they clicked the link (which didn't exist for fake emails).
2. **The New Flow**:
   * The user types their email and password on the **Sign up** page and clicks "Create account".
   * JavaScript intercepts this and sends a `POST` request to our backend endpoint `/api/signup`.
   * The backend receives the email and password, initializes Supabase using the master key (Service Role Key), and calls `supabase.auth.admin.createUser` with `email_confirm: true`.
   * This tells the database: *"Create this user and mark their email as verified immediately. Do not send any emails."*
   * The backend returns a success message to the browser.
   * On receiving the success, the browser immediately logs the user in client-side using `supabase.auth.signInWithPassword`. Since the user is already marked as verified, the login succeeds instantly, and they are redirected to the homepage.

### B. Performing a Fact Check (Step-by-Step)
1. **Input**: The user pastes a paragraph and clicks **Verify Text**.
2. **Spam & Abuse Protection**:
   * **Rate Limiting**: The server uses `express-rate-limit` to restrict the number of requests a single computer can send in 15 minutes.
   * **Concurrency Lock**: When a request begins, JavaScript generates a unique session key. The server stores this in an `activeScans` cache. If the user clicks "Verify" multiple times, the server rejects duplicates with status `429 (Too Many Requests)` until the first one completes.
3. **Data Sanitization**: The backend cleans the input text to remove HTML tags (`<script>`, etc.), preventing hackers from trying to run malicious code (XSS attacks).
4. **AI Generation**: The backend sends the text to the **openai/gpt-oss-120b** model on Groq. It demands that the AI respond in a strict JSON format containing:
   * `overall`: A single-word rating.
   * `summary`: A 2-3 sentence overview.
   * `claims`: An array of claims, containing the claim statement, the exact sentence it came from (`quote`), the status, and an explanation.
   * `tip`: A helpful tip.
5. **Logic Override**: The backend code double-checks the AI's logic (e.g. if even one claim is marked as "conflicting", it overrides the AI's overall rating to "conflicting" to ensure strict accuracy).
6. **Save to History**: If the user is logged in, the backend saves the details into the `verifications` table in Supabase.
7. **Frontend Highlighting**: 
   * The backend returns the JSON result.
   * JavaScript replaces sentences matching the `quote` fields with `<mark class="highlight-status">` tags.
   * CSS styles these tags with soft color-coded highlights.

### C. Displaying History
1. When you go to `/history`, JavaScript calls the backend endpoint `/api/history/:userId`.
2. The backend queries Supabase for the 20 most recent checks for that user.
3. The browser renders them as cards. We added `white-space: pre-wrap;` to the text styling so that paragraphs and spacing are preserved exactly as they were written.

---

## 4. Key Questions Recrawlers/Recruiters Will Ask (And Your Answers)

#### Q: "Why didn't you build this with React or Next.js?"
> **Answer**: *"I wanted to build this using the native web stack (HTML, CSS, and Vanilla JS) to demonstrate that I have a strong foundation in core web technologies. Frameworks hide DOM management and raw browser behaviors. By using vanilla code, I prove I can build custom layouts, handle responsive states, manage state changes reactively, and handle client routing without relying on external packages."*

#### Q: "How does the highlight system match text safely?"
> **Answer**: *"When the AI returns a list of claims, each claim includes the exact sentence (`quote`) it extracted. In my JavaScript code, I first sort the claims by quote length (so longer quotes don't get messed up by shorter nested ones). I escape HTML characters to prevent security injections, and then use Regular Expressions to replace the original text with formatted HTML `<mark>` tags."*

#### Q: "Why is there a backend server instead of just calling Supabase and Groq from the browser?"
> **Answer**: *"Security and architecture. First, calling Groq or accessing Supabase using admin permissions requires secret API keys. If these keys were in the browser, anyone could view the source code, steal them, and leave us with a huge bill. By keeping these keys on a Node/Express backend inside a private environment file, they remain completely hidden. Second, having a backend lets us do server-side sanitization, concurrency locking, and rate-limiting, which you cannot securely do in a browser."*

#### Q: "How does your URL clean-up work on Vercel?"
> **Answer**: *"Accessing pages as `/history.html` looks a bit raw. To make it professional, I configured custom routing in Vercel to redirect users from `.html` routes to clean URLs (like `/history`), and then internally rewrite those requests to serve the correct static files. I also updated the JavaScript pathname checks so the logic handles both cleaner routes and local file setups."*
