# Python Tutor AI 🐍

A beginner-friendly, AI-powered chatbot that helps you learn Python — from
`print("hello world")` to decorators, generators, and async/await.

It adapts every answer to a **Simple**, **Intermediate**, or **Technical**
explanation level, always includes a runnable code example, and can explain,
debug, or improve code you paste in.

---

## 1. Project structure

```
python-tutor-chatbot/
├── app.py                  # Flask backend + AI integration
├── requirements.txt        # Python dependencies
├── .env.example            # Template for your secret API key
├── README.md                # This file
├── templates/
│   └── index.html          # Chatbot page markup
└── static/
    ├── css/
    │   └── style.css       # All styling
    └── js/
        └── script.js       # Chat logic, rendering, Markdown/code handling
```

What each file does:

| File | Purpose |
|---|---|
| `app.py` | Runs the web server, defines the `/api/chat` endpoint, builds the tutor's system prompt, and calls the Gemini API. |
| `requirements.txt` | Lists the exact Python packages needed to run the app. |
| `.env.example` | Shows which environment variables to set — copy it to `.env` and fill in your key. |
| `templates/index.html` | The single HTML page the browser loads. |
| `static/css/style.css` | All visual styling (colors, layout, chat bubbles, code blocks). |
| `static/js/script.js` | Sends your messages to the backend, renders Markdown/code, handles the level selector, clear button, copy buttons, etc. |

---

## 2. Prerequisites

- Python 3.9 or newer
- A free Google Gemini API key (see step 4 below)

---

## 3. Setup: step by step

### Step 1 — Create a virtual environment

A virtual environment keeps this project's dependencies separate from the
rest of your system.

```bash
# Navigate into the project folder
cd python-tutor-chatbot

# Create the virtual environment
python -m venv venv

# Activate it
# On macOS/Linux:
source venv/bin/activate
# On Windows (Command Prompt):
venv\Scripts\activate.bat
# On Windows (PowerShell):
venv\Scripts\Activate.ps1
```

You'll know it worked when your terminal prompt shows `(venv)` at the start.

### Step 2 — Install dependencies

```bash
pip install -r requirements.txt
```

### Step 3 — Get a Gemini API key

1. Go to [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. Sign in with a Google account.
3. Click **Create API key** and copy the generated key.

Gemini's free tier is generous enough for learning and personal projects.

> Prefer a different AI provider (OpenAI, Anthropic, etc.)? You only need to
> edit the `call_ai_model()` function in `app.py` — everything else
> (frontend, routes, error handling) stays the same.

### Step 4 — Configure your environment variables

```bash
cp .env.example .env
```

Open the new `.env` file and paste your key:

```
GEMINI_API_KEY=your_actual_key_here
GEMINI_MODEL=gemini-1.5-flash
```

**Never commit `.env` to version control** — it contains your secret key.
`.env.example` (with no real key) is safe to share.

### Step 5 — Run the backend server

```bash
python app.py
```

You should see output like:

```
 * Running on http://127.0.0.1:5000
```

### Step 6 — Open the app

Open your browser and go to:

```
http://127.0.0.1:5000
```

You should see the Python Tutor AI chat interface. Try asking:
*"What is a variable?"*

---

## 4. Using the chatbot

- **Explanation level**: Choose *Simple*, *Intermediate*, or *Technical* in
  the sidebar before (or between) questions. Every new answer uses whichever
  level is currently selected.
- **Suggested questions**: Click any suggestion in the sidebar or on the
  welcome screen to ask it instantly.
- **Pasting code**: Paste your code directly into the message box along with
  what you want (e.g. "explain this", "why is this throwing a TypeError?",
  "how can I make this faster?"). The tutor will keep your original code
  visible and clearly separate it from any corrected version.
- **Edit & Re-run questions**: Hover over any question you asked and click the **Edit** button to modify your question in-place, then click **Save & Re-run** (or press `Enter`). The tutor will update its answer based on your changes.
- **Regenerate responses**: Hover over any AI answer and click **Regenerate** to get a new explanation or answer at the current level.
- **Copy messages & code**: Use the **Copy** button on any message or code block to quickly copy text to your clipboard.
- **Clear conversation**: Use the **Clear conversation** button in the
  sidebar to start fresh. This clears both the visible chat and the context
  sent to the AI.
- **Keyboard shortcuts**: `Enter` sends your message; `Shift+Enter` adds a
  new line. In edit mode, `Enter` saves & re-runs, and `Esc` cancels.

---

## 5. How it works (architecture overview)

1. The browser loads `index.html`, `style.css`, and `script.js` from Flask.
2. When you send a message, `script.js` sends a `POST` request to
   `/api/chat` with:
   - your message,
   - the selected explanation level,
   - the recent conversation history (kept in the browser tab's memory).
3. `app.py` builds a system prompt (see `BASE_SYSTEM_PROMPT` and
   `LEVEL_INSTRUCTIONS` in `app.py`) describing how a Python tutor at that
   level should answer, and sends it — along with your message and history —
   to the Gemini API.
4. The AI's reply is returned as JSON and rendered in the chat as Markdown,
   with syntax-highlighted code blocks.

The backend is intentionally **stateless**: it does not store your
conversation on disk or in a database. History lives only in your browser
tab and is sent with each request. Refreshing the page starts a new session.

---

## 6. Troubleshooting

| Problem | Likely cause / fix |
|---|---|
| `ModuleNotFoundError: No module named 'flask'` | Your virtual environment isn't activated, or dependencies weren't installed. Run `pip install -r requirements.txt` again inside the activated venv. |
| Chat replies with "No API key configured on the server" | You haven't created a `.env` file, or `GEMINI_API_KEY` is missing/empty. Re-check Step 4. |
| Chat replies with "The AI API rejected the configured API key" | Your key is invalid, disabled, or copied incorrectly. Generate a new one at [Google AI Studio](https://aistudio.google.com/app/apikey). |
| Chat replies with "rate limit or quota was reached" | You've hit Gemini's free-tier usage limit. Wait a bit and try again, or check your usage at Google AI Studio. |
| "Could not reach the server" in the browser | Make sure `python app.py` is still running in a terminal, and that you're visiting `http://127.0.0.1:5000` (not a different port). |
| Page loads but looks unstyled | Make sure you're running the app via `python app.py` (so Flask serves `static/`), not by double-clicking `index.html` directly. |
| `Address already in use` when starting the server | Something else is using port 5000. Stop that process, or run `app.run(debug=True, port=5001)` (edit the last line of `app.py`) and visit that port instead. |

---

## 7. Sample questions to try

- "What is a variable?"
- "Explain the difference between a list and a tuple."
- "Write a Python program to check whether a number is prime."
- "What is a decorator in Python?"
- "Explain the difference between multithreading and multiprocessing."
- Paste a short snippet and ask: "Why am I getting a TypeError in this code?"

Switch the explanation level between questions to see how the depth and
vocabulary of the answers change.

---

## 8. Extending this project

Some ideas if you want to keep building:

- Add user accounts and persist chat history in a database (e.g. SQLite).
- Add a "regenerate response" button.
- Stream the AI's response token-by-token instead of waiting for the full
  reply.
- Add unit tests for `app.py` using `pytest` and Flask's test client.
- Deploy it (e.g. Render, Railway, Fly.io) — remember to set `GEMINI_API_KEY`
  as a secret environment variable on the hosting platform, and set
  `debug=False` in production.
