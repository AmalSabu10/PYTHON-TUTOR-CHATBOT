"""
Python Tutor AI - Backend Server
=================================

This file contains the Flask backend for the Python Tutor Chatbot.

What it does:
- Serves the frontend (templates/index.html + static files).
- Exposes a single API endpoint, POST /api/chat, that:
    1. Reads the user's message, the selected explanation level,
       and recent conversation history from the request body.
    2. Builds a system prompt that tells the AI model how to behave
       as a Python tutor at the requested level.
    3. Sends everything to the configured AI model (Google Gemini by
       default) and returns the generated reply as JSON.
- Handles errors gracefully (missing API key, network issues, bad
  input) and never exposes the API key to the browser.

Why Flask?
Flask is a small, beginner-friendly Python web framework. It is easy
to read top-to-bottom, which matters for a learning project like this.
"""

import os
import time
import logging
from collections import defaultdict, deque

from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# 1. Setup
# ---------------------------------------------------------------------------

# Load variables from a local .env file (if present) into the environment.
# This lets you keep secrets like API keys out of the source code.
load_dotenv(override=True)

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("python-tutor-ai")

# The name of the AI model to use. Configurable via environment variable so
# you can switch models without touching the code.
MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")

# The API key is read from the environment ONLY. It is never sent to, or
# read from, the frontend.
API_KEY = os.environ.get("GEMINI_API_KEY")

# Maximum number of previous messages (from the frontend-supplied history)
# that we forward to the model. Keeps requests small and bounded.
MAX_HISTORY_MESSAGES = 12

# Maximum allowed length of a single user message, to avoid accidentally
# sending huge payloads to the API.
MAX_MESSAGE_LENGTH = 4000

# ---------------------------------------------------------------------------
# 2. Very simple in-memory rate limiting
# ---------------------------------------------------------------------------
# This is NOT meant for production use (it resets when the server restarts
# and is per-process only), but it is enough to stop accidental runaway
# usage in a local/demo setting -- e.g. a buggy frontend looping requests.

RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 20
_request_log = defaultdict(deque)


def is_rate_limited(client_id: str) -> bool:
    """Return True if client_id has made too many requests recently."""
    now = time.time()
    log = _request_log[client_id]

    # Drop timestamps older than the window.
    while log and now - log[0] > RATE_LIMIT_WINDOW_SECONDS:
        log.popleft()

    if len(log) >= RATE_LIMIT_MAX_REQUESTS:
        return True

    log.append(now)
    return False


# ---------------------------------------------------------------------------
# 3. The system prompt
# ---------------------------------------------------------------------------

BASE_SYSTEM_PROMPT = """You are "Python Tutor AI", a patient, knowledgeable and encouraging
Python programming tutor. Your ONLY subject is the Python programming language:
its syntax, standard library, common third-party libraries, programming
concepts, data structures, algorithms, debugging, and best practices.

General rules you must always follow:
- Understand the user's question and the explanation level they selected
  before answering.
- Give direct answers. Do not open with filler like "Great question!" or
  long introductions -- start answering right away.
- Use Markdown formatting: headings for structure when useful, bullet or
  numbered lists for steps, and fenced code blocks (```python ... ```) for
  all code.
- Every answer that involves a concept, function, or technique should
  include at least one correct, runnable Python code example, followed by
  its expected output shown in a separate block labeled "Output:".
- Never invent Python syntax, libraries, functions, or output. If you are
  not fully sure something is correct, say so explicitly rather than
  guessing.
- If a concept has more than one valid approach, briefly mention the
  alternatives and when each is appropriate.
- Break complex topics into small, clearly labeled steps.
- Maintain the context of the conversation so follow-up questions make
  sense without the user repeating themselves.
- Only ask a clarifying question when the request is genuinely ambiguous
  (e.g. you cannot tell what the user's code is supposed to do). Otherwise,
  make a reasonable assumption, state it briefly, and answer.
- If the user submits their own code:
    * Repeat back (or clearly reference) the relevant part of their
      original code before correcting it.
    * Clearly separate "Your code" from "Corrected code" using labeled
      code blocks, so the two are never confused.
    * Explain what was wrong and why the fix works.
- If a question is NOT about Python programming (e.g. general chit-chat,
  other languages unrelated to Python, personal advice), politely explain
  that you are focused on Python programming, and offer to help with a
  related Python topic instead. Keep this redirect short.
- Keep explanations for simple, short-definition questions concise, but
  still include a small example -- do not pad the answer with unnecessary
  length.

Explanation level for this conversation: {level}

{level_instructions}
"""

LEVEL_INSTRUCTIONS = {
    "simple": (
        "The user selected SIMPLE mode.\n"
        "- Use everyday language and analogies a complete beginner would "
        "understand (avoid jargon, or define it immediately in plain words).\n"
        "- Keep code examples short (a few lines) and explain them step by "
        "step, line by line, in plain language.\n"
        "- Avoid discussing internal implementation details, performance, "
        "or edge cases unless the user directly asks."
    ),
    "intermediate": (
        "The user selected INTERMEDIATE mode.\n"
        "- Use correct programming terminology, but still explain new terms "
        "briefly the first time you use them.\n"
        "- Use practical, slightly more realistic examples than beginner "
        "one-liners.\n"
        "- Briefly mention common pitfalls related to the topic, without "
        "going deep into internals."
    ),
    "technical": (
        "The user selected TECHNICAL mode.\n"
        "- Use precise technical terminology without simplifying.\n"
        "- Where relevant, explain internal working principles (e.g. how "
        "CPython implements the feature), time/space complexity, edge "
        "cases, and performance considerations.\n"
        "- Mention best practices and, where relevant, how the topic "
        "compares to related approaches or alternatives."
    ),
}

VALID_LEVELS = set(LEVEL_INSTRUCTIONS.keys())


def build_system_prompt(level: str) -> str:
    level = level if level in VALID_LEVELS else "simple"
    return BASE_SYSTEM_PROMPT.format(
        level=level, level_instructions=LEVEL_INSTRUCTIONS[level]
    )


# ---------------------------------------------------------------------------
# 4. AI model call (Google Gemini)
# ---------------------------------------------------------------------------
#
# We use Google's Gemini API here because it has a generous free tier that
# is easy for beginners to get started with. If you prefer another
# provider (OpenAI, Anthropic, etc.), you only need to change the contents
# of `call_ai_model()` below -- the rest of the app does not need to change.

def call_ai_model(system_prompt: str, history: list, user_message: str) -> str:
    """
    Send the conversation to the Gemini API and return the text reply.

    Raises RuntimeError with a user-friendly message on any failure, so the
    Flask route can turn it into a clean JSON error response.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or API_KEY
    model_name = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")

    if not api_key:
        raise RuntimeError(
            "No API key configured on the server. Set GEMINI_API_KEY in "
            "your .env file (see .env.example)."
        )

    try:
        import google.generativeai as genai
    except ImportError as exc:
        raise RuntimeError(
            "The 'google-generativeai' package is not installed. Run: "
            "pip install -r requirements.txt"
        ) from exc

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=system_prompt,
        )

        # Convert our simple history format into Gemini's chat history
        # format. Gemini expects role "user" or "model".
        gemini_history = []
        for turn in history[-MAX_HISTORY_MESSAGES:]:
            role = "user" if turn.get("role") == "user" else "model"
            gemini_history.append(
                {"role": role, "parts": [turn.get("content", "")]}
            )

        chat = model.start_chat(history=gemini_history)
        response = chat.send_message(user_message)

        if not getattr(response, "text", None):
            raise RuntimeError("The AI model returned an empty response.")

        return response.text

    except RuntimeError:
        raise
    except Exception as exc:  # noqa: BLE001 - we want to catch and translate
        logger.exception("AI model call failed")
        message = str(exc)
        if "API key" in message or "API_KEY_INVALID" in message:
            raise RuntimeError(
                "The AI API rejected the configured API key. Double-check "
                "GEMINI_API_KEY in your .env file."
            ) from exc
        if "quota" in message.lower() or "rate" in message.lower():
            raise RuntimeError(
                "The AI API's rate limit or quota was reached. Please wait "
                "a moment and try again."
            ) from exc
        raise RuntimeError(
            "Could not reach the AI service. Please check your internet "
            "connection and try again."
        ) from exc


# ---------------------------------------------------------------------------
# 5. Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Serve the chatbot frontend."""
    return render_template("index.html")


@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Main chat endpoint.

    Expected JSON body:
    {
        "message": "What is a variable?",
        "level": "simple" | "intermediate" | "technical",
        "history": [
            {"role": "user", "content": "..."},
            {"role": "assistant", "content": "..."},
            ...
        ]
    }
    """
    # --- Basic rate limiting, keyed by the client's IP address ---
    client_id = request.remote_addr or "unknown"
    if is_rate_limited(client_id):
        return jsonify(
            {"error": "Too many requests. Please wait a moment and try again."}
        ), 429

    # --- Input validation ---
    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"error": "Invalid request body. Expected JSON."}), 400

    message = (data.get("message") or "").strip()
    level = (data.get("level") or "simple").strip().lower()
    history = data.get("history") or []

    if not message:
        return jsonify({"error": "Message cannot be empty."}), 400

    if len(message) > MAX_MESSAGE_LENGTH:
        return jsonify(
            {"error": f"Message is too long (max {MAX_MESSAGE_LENGTH} characters)."}
        ), 400

    if level not in VALID_LEVELS:
        level = "simple"

    if not isinstance(history, list):
        history = []

    # --- Call the AI model ---
    try:
        system_prompt = build_system_prompt(level)
        reply = call_ai_model(system_prompt, history, message)
        return jsonify({"reply": reply, "level": level})
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception:  # noqa: BLE001
        logger.exception("Unexpected error in /api/chat")
        return jsonify(
            {"error": "An unexpected server error occurred. Please try again."}
        ), 500


@app.errorhandler(404)
def not_found(_exc):
    return jsonify({"error": "Not found."}), 404


if __name__ == "__main__":
    if not (os.environ.get("GEMINI_API_KEY") or API_KEY):
        logger.warning(
            "GEMINI_API_KEY is not set. The /api/chat endpoint will return "
            "an error until you configure it in a .env file."
        )
    # debug=True is convenient for local development; turn it off in any
    # real deployment.
    app.run(debug=True, port=5000)
