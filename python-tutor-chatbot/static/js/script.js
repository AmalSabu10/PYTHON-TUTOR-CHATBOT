/**
 * Python Tutor AI — Frontend logic
 * =================================
 * Handles:
 *  - Sending messages to the backend (/api/chat)
 *  - Rendering Markdown + syntax-highlighted code blocks
 *  - Inline question editing with "Save & Re-run"
 *  - Regenerating responses & copying messages
 *  - Explanation level selection
 *  - Conversation history (kept in memory for this session)
 *  - Clear chat, suggestion chips, loading states, and toasts
 */

(function () {
  "use strict";

  // ---- DOM references ----
  const chatForm = document.getElementById("chat-form");
  const messageInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const messagesEl = document.getElementById("messages");
  const welcomeScreen = document.getElementById("welcome-screen");
  const typingIndicator = document.getElementById("typing-indicator");
  const clearChatBtn = document.getElementById("clear-chat-btn");
  const levelSelector = document.getElementById("level-selector");
  const levelHint = document.getElementById("level-hint");
  const sidebar = document.querySelector(".sidebar");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const toast = document.getElementById("toast");

  // ---- State ----
  // history holds {role: "user"|"assistant", content: "..."} objects.
  let history = [];
  let currentLevel = "simple";
  let isWaitingForReply = false;

  const LEVEL_HINTS = {
    simple: "Everyday language and simple examples.",
    intermediate: "Proper terminology with practical examples.",
    technical: "Deep dives, internals, and performance notes.",
  };

  // Configure Markdown rendering for bot responses.
  const renderer = new marked.Renderer();
  renderer.code = function (code, infostring) {
    const lang = (infostring || "").trim() || "text";
    let highlighted;
    try {
      highlighted = hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    } catch (e) {
      highlighted = escapeHtml(code);
    }
    const escapedForCopy = escapeHtml(code).replace(/"/g, "&quot;");
    return `
      <div class="code-block">
        <div class="code-block-header">
          <span class="code-lang">${escapeHtml(lang)}</span>
          <button type="button" class="copy-btn" data-code="${escapedForCopy}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
        </div>
        <pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>
      </div>
    `;
  };
  marked.setOptions({ renderer, breaks: true });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---- Auto-resize the main textarea as the user types ----
  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
  });

  // Enter to send, Shift+Enter for a newline.
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  // ---- Explanation level selector ----
  levelSelector.addEventListener("click", (e) => {
    const btn = e.target.closest(".level-btn");
    if (!btn) return;
    currentLevel = btn.dataset.level;
    [...levelSelector.querySelectorAll(".level-btn")].forEach((b) => {
      const active = b === btn;
      b.classList.toggle("active", active);
      b.setAttribute("aria-checked", String(active));
    });
    levelHint.textContent = LEVEL_HINTS[currentLevel] || "";
  });

  // ---- Suggestion chips (sidebar + welcome screen) ----
  document.addEventListener("click", (e) => {
    const item = e.target.closest("[data-prompt]");
    if (!item) return;
    messageInput.value = item.dataset.prompt;
    messageInput.dispatchEvent(new Event("input"));
    chatForm.requestSubmit();
  });

  // ---- Copy to clipboard helper ----
  function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(showToast)
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast();
    } catch (e) {
      console.error("Copy failed", e);
    }
    document.body.removeChild(ta);
  }

  function showToast(msg = "Copied!") {
    toast.textContent = msg;
    toast.hidden = false;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (toast.hidden = true), 1600);
  }

  // ---- Sidebar toggle (mobile) ----
  sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("open"));

  // ---- Clear conversation ----
  clearChatBtn.addEventListener("click", () => {
    if (isWaitingForReply) return;
    history = [];
    messagesEl.innerHTML = "";
    welcomeScreen.style.display = "";
  });

  function scrollToBottom() {
    const chatArea = document.getElementById("chat-area");
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function setLoading(loading) {
    isWaitingForReply = loading;
    sendBtn.disabled = loading;
    typingIndicator.hidden = !loading;
    if (loading) scrollToBottom();
  }

  // ---- Render a single message node ----
  function createMessageElement(index, role, content, isError = false) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${role === "user" ? "user" : "bot"}`;
    wrap.dataset.index = index;
    wrap.dataset.role = role;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${role === "user" ? "user-avatar" : "bot-avatar"}`;
    avatar.textContent = role === "user" ? "🙂" : "🐍";

    const contentDiv = document.createElement("div");
    contentDiv.className = "msg-content";

    const bubble = document.createElement("div");
    bubble.className = "bubble" + (isError ? " error-bubble" : "");

    if (role === "user") {
      bubble.textContent = content;
    } else {
      bubble.innerHTML = marked.parse(content);
    }

    contentDiv.appendChild(bubble);

    // Add action toolbar (Edit, Regenerate, Copy)
    if (!isError) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      if (role === "user") {
        actions.innerHTML = `
          <button type="button" class="msg-action-btn edit-msg-btn" title="Edit question and re-run" aria-label="Edit question and re-run">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Edit</span>
          </button>
          <button type="button" class="msg-action-btn copy-msg-btn" title="Copy question" aria-label="Copy question">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy</span>
          </button>
        `;
      } else {
        actions.innerHTML = `
          <button type="button" class="msg-action-btn retry-msg-btn" title="Regenerate this response" aria-label="Regenerate this response">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span>Regenerate</span>
          </button>
          <button type="button" class="msg-action-btn copy-msg-btn" title="Copy response" aria-label="Copy response">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy</span>
          </button>
        `;
      }
      contentDiv.appendChild(actions);
    }

    wrap.appendChild(avatar);
    wrap.appendChild(contentDiv);
    return wrap;
  }

  function appendMessage(role, content, isError = false) {
    welcomeScreen.style.display = "none";
    const index = history.length;
    const msgEl = createMessageElement(index, role, content, isError);
    messagesEl.appendChild(msgEl);
    scrollToBottom();
    return msgEl;
  }

  // ---- Inline Question Editing & Re-running ----
  function startEditingMessage(msgWrap) {
    if (isWaitingForReply) return;

    // Close any other open edit boxes first
    document.querySelectorAll(".msg-edit-box").forEach((box) => {
      const parentWrap = box.closest(".msg");
      if (parentWrap) {
        const bubble = parentWrap.querySelector(".bubble");
        const actions = parentWrap.querySelector(".msg-actions");
        box.remove();
        if (bubble) bubble.style.display = "";
        if (actions) actions.style.display = "";
      }
    });

    const index = parseInt(msgWrap.dataset.index, 10);
    const originalText = history[index] ? history[index].content : "";
    const contentDiv = msgWrap.querySelector(".msg-content");
    const bubble = contentDiv.querySelector(".bubble");
    const actions = contentDiv.querySelector(".msg-actions");

    bubble.style.display = "none";
    if (actions) actions.style.display = "none";

    const editBox = document.createElement("div");
    editBox.className = "msg-edit-box";
    editBox.innerHTML = `
      <textarea class="msg-edit-textarea" rows="2" maxlength="4000" aria-label="Edit your question"></textarea>
      <div class="msg-edit-actions">
        <button type="button" class="msg-edit-btn cancel-btn">Cancel</button>
        <button type="button" class="msg-edit-btn save-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          Save &amp; Re-run
        </button>
      </div>
    `;

    const textarea = editBox.querySelector(".msg-edit-textarea");
    textarea.value = originalText;

    function autoResize() {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 220) + "px";
    }
    textarea.addEventListener("input", autoResize);

    const cancelBtn = editBox.querySelector(".cancel-btn");
    const saveBtn = editBox.querySelector(".save-btn");

    function cancelEdit() {
      editBox.remove();
      bubble.style.display = "";
      if (actions) actions.style.display = "";
    }

    async function saveAndRerun() {
      const newText = textarea.value.trim();
      if (!newText) {
        textarea.focus();
        return;
      }
      if (isWaitingForReply) return;

      editBox.remove();

      // Keep history prior to this question
      const priorHistory = history.slice(0, index);

      // Remove all messages from index onward in both history and DOM
      history = priorHistory;
      const allMsgs = Array.from(messagesEl.querySelectorAll(".msg"));
      allMsgs.forEach((el) => {
        const elIdx = parseInt(el.dataset.index, 10);
        if (elIdx >= index) {
          el.remove();
        }
      });

      // Add updated question to history and DOM
      history.push({ role: "user", content: newText });
      const userMsgEl = createMessageElement(index, "user", newText);
      messagesEl.appendChild(userMsgEl);

      // Send revised question to backend
      await sendChatRequest(newText, priorHistory);
    }

    cancelBtn.addEventListener("click", cancelEdit);
    saveBtn.addEventListener("click", saveAndRerun);

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveAndRerun();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    });

    contentDiv.appendChild(editBox);
    autoResize();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  // ---- Regenerate response for previous turn ----
  async function regenerateResponse(botMsgWrap) {
    if (isWaitingForReply) return;

    const botIndex = parseInt(botMsgWrap.dataset.index, 10);
    const userIndex = botIndex - 1;

    if (userIndex < 0 || !history[userIndex]) return;

    const userMessage = history[userIndex].content;
    const priorHistory = history.slice(0, userIndex);

    // Remove bot message and anything after it
    const allMsgs = Array.from(messagesEl.querySelectorAll(".msg"));
    allMsgs.forEach((el) => {
      const elIdx = parseInt(el.dataset.index, 10);
      if (elIdx >= botIndex) {
        el.remove();
      }
    });

    history = history.slice(0, userIndex + 1);

    await sendChatRequest(userMessage, priorHistory);
  }

  // ---- Send chat request to backend ----
  async function sendChatRequest(message, priorHistory) {
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          level: currentLevel,
          history: priorHistory,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errMsg =
          data.error || "Something went wrong talking to the AI service.";
        appendMessage("assistant", `⚠️ ${errMsg}`, true);
        return;
      }

      appendMessage("assistant", data.reply);
      history.push({ role: "assistant", content: data.reply });
    } catch (err) {
      appendMessage(
        "assistant",
        "⚠️ Could not reach the server. Please check your connection and that the backend is running.",
        true
      );
    } finally {
      setLoading(false);
    }
  }

  // ---- Event delegation for message actions ----
  messagesEl.addEventListener("click", (e) => {
    // 1. Copy button inside code blocks
    const codeCopyBtn = e.target.closest(".copy-btn");
    if (codeCopyBtn) {
      const code = codeCopyBtn.dataset.code
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
      copyToClipboard(code);
      return;
    }

    // 2. Edit button on user message
    const editBtn = e.target.closest(".edit-msg-btn");
    if (editBtn) {
      const msgWrap = editBtn.closest(".msg.user");
      if (msgWrap) startEditingMessage(msgWrap);
      return;
    }

    // 3. Regenerate button on bot message
    const retryBtn = e.target.closest(".retry-msg-btn");
    if (retryBtn) {
      const msgWrap = retryBtn.closest(".msg.bot");
      if (msgWrap) regenerateResponse(msgWrap);
      return;
    }

    // 4. Copy full message button
    const copyMsgBtn = e.target.closest(".copy-msg-btn");
    if (copyMsgBtn) {
      const msgWrap = copyMsgBtn.closest(".msg");
      if (!msgWrap) return;
      const index = parseInt(msgWrap.dataset.index, 10);
      const textToCopy = history[index] ? history[index].content : "";
      copyToClipboard(textToCopy);
      return;
    }
  });

  // ---- Main submit handler ----
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (!message || isWaitingForReply) return;

    const priorHistory = history.slice();
    appendMessage("user", message);
    history.push({ role: "user", content: message });

    messageInput.value = "";
    messageInput.style.height = "auto";

    await sendChatRequest(message, priorHistory);
  });
})();
