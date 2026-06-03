/* ================================================================
   Cooking INA — Chatbot JavaScript
   Place at: static/js/chatbot.js
   ================================================================ */

"use strict";

/* ================================================================
   SHARED STATE & UTILITIES
   ================================================================ */

/** Simple markdown renderer for AI messages */
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^---+$/gm, "<hr/>")
    .replace(/^\d+\. (.+)$/gm, '<li class="ol-item">$1</li>')
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(
      /(<li class="ol-item">.*?<\/li>(\n|$))+/g,
      (m) => `<ol>${m.replace(/ class="ol-item"/g, "")}</ol>`,
    )
    .replace(/(<li>(?!.*ol-item).*?<\/li>(\n|$))+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");
  return `<p>${html}</p>`;
}

/** Format a timestamp for display */
function formatTime(date) {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Auto-resize textarea to fit content */
function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 140) + "px";
}

/** Scroll a container to its bottom */
function scrollToBottom(smooth = true) {
  const el =
    document.getElementById("chatMessages") ||
    document.getElementById("widgetMessages");
  if (!el) return;
  el.scrollTo({
    top: el.scrollHeight,
    behavior: smooth ? "smooth" : "instant",
  });
}

/* ================================================================
   VOICE OUTPUT — INA speaks back
   ================================================================ */

let voiceEnabled = true;
let isSpeaking = false;
let speechUnlocked = false;
let lastReply = "";

/** Unlock speech synthesis on first user interaction (Chrome requirement) */
function _unlockSpeech() {
  if (speechUnlocked) return;
  const silent = new SpeechSynthesisUtterance("");
  silent.volume = 0;
  window.speechSynthesis.speak(silent);
  speechUnlocked = true;
}

/** Toggle INA voice on/off */
function toggleSpeak() {
  voiceEnabled = !voiceEnabled;
  const btn = document.getElementById("muteSpeakBtn");
  if (!btn) return;
  if (voiceEnabled) {
    btn.innerHTML = "🔊";
    btn.title = "Mute INA";
    // Replay last reply when unmuting
    if (lastReply) _speakText(lastReply);
  } else {
    window.speechSynthesis.cancel();
    btn.innerHTML = "🔇";
    btn.title = "Unmute INA";
  }
}

/** Stop INA speaking */
function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  isSpeaking = false;
}

/** Make INA speak the given text */
function _speakText(text) {
  if (!window.speechSynthesis || !voiceEnabled) return;

  // Strip markdown before speaking
  const clean = text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/#+\s/g, "")
    .replace(/[-*]\s/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\n/g, " ")
    .trim();

  if (!clean) return;

  window.speechSynthesis.cancel();

  const speak = () => {
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = "en-PH";
    utter.rate = 0.95;
    utter.pitch = 1.1;
    utter.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(
        (v) =>
          v.lang.startsWith("en") && v.name.toLowerCase().includes("female"),
      ) ||
      voices.find(
        (v) =>
          v.lang.startsWith("en") && !v.name.toLowerCase().includes("male"),
      ) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (preferred) utter.voice = preferred;

    utter.onstart = () => {
      isSpeaking = true;
    };
    utter.onend = () => {
      isSpeaking = false;
    };
    utter.onerror = (e) => {
      console.warn("Speech error:", e);
      isSpeaking = false;
    };

    window.speechSynthesis.speak(utter);
  };

  // Voices may not be loaded yet
  if (window.speechSynthesis.getVoices().length > 0) {
    speak();
  } else {
    window.speechSynthesis.addEventListener("voiceschanged", speak, {
      once: true,
    });
  }
}

// Unlock speech on first click anywhere on the page
document.addEventListener("click", _unlockSpeech, { once: true });

/* ================================================================
   FULL-PAGE CHAT
   ================================================================ */

async function createNewConversation() {
  try {
    const res = await fetch("/chat/new", { method: "POST" });
    const data = await res.json();
    if (data.conversation_id) {
      window.location.href = `/chat?conv=${data.conversation_id}`;
    }
  } catch (e) {
    console.error("Failed to create conversation:", e);
  }
}

function loadConversation(convId) {
  window.location.href = `/chat?conv=${convId}`;
}

async function deleteConversation(convId, btn) {
  if (!confirm("Delete this conversation?")) return;
  try {
    await fetch(`/chat/${convId}/delete`, { method: "POST" });
    const item = btn.closest(".conv-item");
    if (item) item.remove();
    if (convId === currentConvId) {
      window.location.href = "/chat";
    }
  } catch (e) {
    console.error("Failed to delete conversation:", e);
  }
}

async function clearCurrentChat() {
  if (!currentConvId) return;
  if (!confirm("Clear all messages in this conversation?")) return;
  try {
    await fetch(`/chat/${currentConvId}/clear`, { method: "POST" });
    window.location.reload();
  } catch (e) {
    console.error("Failed to clear chat:", e);
  }
}

function filterConversations() {
  const q = document.getElementById("convSearch").value.toLowerCase();
  document.querySelectorAll(".conv-item").forEach((item) => {
    const title = item.dataset.title.toLowerCase();
    item.style.display = title.includes(q) ? "" : "none";
  });
}

function handleChatKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
  const input = document.getElementById("chatInput");
  const counter = document.getElementById("charCounter");
  if (counter && input) {
    const len = input.value.length;
    counter.textContent = `${len} / 2000`;
    counter.className =
      "char-counter" +
      (len > 1800 ? " warn" : "") +
      (len >= 2000 ? " over" : "");
  }
}

async function sendSuggestion(text) {
  const input = document.getElementById("chatInput");
  if (input) {
    input.value = text;
    autoResize(input);
  }
  const welcome = document.getElementById("chatWelcome");
  if (welcome) welcome.remove();
  if (!currentConvId) await _ensureConversation();
  await sendChatMessage();
}

async function _ensureConversation() {
  if (currentConvId) return;
  const res = await fetch("/chat/new", { method: "POST" });
  const data = await res.json();
  currentConvId = data.conversation_id;

  const convList = document.getElementById("convList");
  const empty = document.getElementById("convEmpty");
  if (empty) empty.remove();
  if (convList) {
    const item = document.createElement("div");
    item.className = "conv-item active";
    item.dataset.id = currentConvId;
    item.dataset.title = "New Conversation";
    item.onclick = () => loadConversation(currentConvId);
    item.innerHTML = `<div class="conv-title">New Conversation</div>
      <div class="conv-meta">Just now</div>
      <button class="conv-delete-btn" onclick="event.stopPropagation(); deleteConversation(${currentConvId}, this)">🗑</button>`;
    convList.prepend(item);
  }
}

/** Main send function for full-page chat */
async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const message = input.value.trim();
  if (!message || (sendBtn && sendBtn.disabled)) return;

  _unlockSpeech(); // ensure speech is unlocked on send

  await _ensureConversation();

  const welcome = document.getElementById("chatWelcome");
  if (welcome) welcome.remove();

  input.value = "";
  autoResize(input);
  if (sendBtn) sendBtn.disabled = true;

  _appendMessage("user", message);
  scrollToBottom();

  const typing = document.getElementById("typingIndicator");
  if (typing) typing.style.display = "flex";
  scrollToBottom();

  try {
    const res = await fetch(`/chat/${currentConvId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (typing) typing.style.display = "none";

    if (data.reply) {
      _appendMessage("ai", data.reply);
      _updateSidebarTitle(currentConvId, message);
      lastReply = data.reply;
      _speakText(data.reply); // INA speaks back
    } else {
      _appendMessage("ai", "❌ " + (data.error || "Something went wrong."));
    }
  } catch (e) {
    if (typing) typing.style.display = "none";
    _appendMessage(
      "ai",
      "❌ Network error. Please check your connection and try again.",
    );
  }

  if (sendBtn) sendBtn.disabled = false;
  input.focus();
  scrollToBottom();
}

function _appendMessage(role, content) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const isUser = role === "user";
  const userImg = typeof CHAT_USER_IMAGE !== "undefined" ? CHAT_USER_IMAGE : "";

  const row = document.createElement("div");
  row.className = `msg-row ${isUser ? "msg-user" : "msg-ai"}`;

  let avatarHtml;
  if (isUser) {
    avatarHtml = userImg
      ? `<div class="msg-avatar user-avatar"><img src="${userImg}" alt="" /></div>`
      : `<div class="msg-avatar user-avatar">👤</div>`;
  } else {
    avatarHtml = `<div class="msg-avatar ai-avatar"><img src="/static/images/ina-avatar.png" alt="INA"></div>`;
  }

  const contentHtml = isUser ? _escapeHtml(content) : renderMarkdown(content);

  row.innerHTML = `
    ${!isUser ? avatarHtml : ""}
    <div class="msg-bubble">
      <div class="msg-content ${!isUser ? "markdown-content" : ""}">${contentHtml}</div>
      <div class="msg-time">${formatTime()}</div>
    </div>
    ${isUser ? avatarHtml : ""}
  `;

  container.appendChild(row);
}

function _escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
}

function _updateSidebarTitle(convId, firstMessage) {
  const item = document.querySelector(`.conv-item[data-id="${convId}"]`);
  if (!item) return;
  const title = item.querySelector(".conv-title");
  if (title && title.textContent === "New Conversation") {
    const words = firstMessage.split(" ").slice(0, 7).join(" ");
    const short = words.length < firstMessage.length ? words + "…" : words;
    title.textContent = short;
    item.dataset.title = short;
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById("chatSidebar");
  if (sidebar) sidebar.classList.toggle("open");
}

/* ================================================================
   VOICE INPUT (speech-to-text)
   ================================================================ */

let chatRecognition = null;

function toggleChatVoice() {
  stopSpeaking(); // stop INA if she's speaking
  const btn = document.getElementById("voiceInputBtn");
  if (
    !("webkitSpeechRecognition" in window) &&
    !("SpeechRecognition" in window)
  ) {
    alert("Voice input is not supported in this browser.");
    return;
  }
  if (chatRecognition) {
    chatRecognition.stop();
    chatRecognition = null;
    if (btn) btn.classList.remove("recording");
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  chatRecognition = new SR();
  chatRecognition.lang = "en-PH";
  chatRecognition.continuous = false;
  chatRecognition.interimResults = false;
  if (btn) btn.classList.add("recording");

  chatRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    const input = document.getElementById("chatInput");
    if (input) {
      input.value = transcript;
      autoResize(input);
    }
    if (btn) btn.classList.remove("recording");
    chatRecognition = null;
  };
  chatRecognition.onerror = () => {
    if (btn) btn.classList.remove("recording");
    chatRecognition = null;
  };
  chatRecognition.onend = () => {
    if (btn) btn.classList.remove("recording");
    chatRecognition = null;
  };
  chatRecognition.start();
}

/* ================================================================
   FLOATING WIDGET
   ================================================================ */

let widgetOpen = false;
let widgetHistory = [];
let widgetConvId = null;

function toggleWidget() {
  if (widgetOpen) {
    closeWidget();
  } else {
    openWidget();
  }
}

function openWidget() {
  if (typeof LOGGED_IN !== "undefined" && !LOGGED_IN) {
    window.location.href = "/login";
    return;
  }
  const popup = document.getElementById("chatWidgetPopup");
  if (!popup) return;
  popup.style.display = "flex";
  popup.classList.remove("closing");
  widgetOpen = true;
  const input = document.getElementById("widgetInput");
  if (input) setTimeout(() => input.focus(), 200);
}

function closeWidget() {
  const popup = document.getElementById("chatWidgetPopup");
  if (!popup) return;
  popup.classList.add("closing");
  setTimeout(() => {
    popup.style.display = "none";
    popup.classList.remove("closing");
  }, 150);
  widgetOpen = false;
}

function handleWidgetKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendWidgetMessage();
  }
  autoResize(event.target);
}

function sendWidgetSuggestion(text) {
  const input = document.getElementById("widgetInput");
  if (input) input.value = text;
  const welcome = document.getElementById("widgetWelcome");
  if (welcome) welcome.remove();
  sendWidgetMessage();
}

async function sendWidgetMessage() {
  const input = document.getElementById("widgetInput");
  const sendBtn = document.getElementById("widgetSendBtn");
  const message = (input && input.value.trim()) || "";
  if (!message || (sendBtn && sendBtn.disabled)) return;

  const welcome = document.getElementById("widgetWelcome");
  if (welcome) welcome.remove();

  input.value = "";
  autoResize(input);
  if (sendBtn) sendBtn.disabled = true;

  _appendWidgetMessage("user", message);

  const typing = document.getElementById("widgetTyping");
  if (typing) typing.style.display = "flex";
  _widgetScrollBottom();

  widgetHistory.push({ role: "user", content: message });
  if (widgetHistory.length > 20) widgetHistory = widgetHistory.slice(-20);

  try {
    const res = await fetch("/chat/widget/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: widgetHistory }),
    });
    const data = await res.json();
    if (typing) typing.style.display = "none";

    if (data.reply) {
      _appendWidgetMessage("ai", data.reply);
      widgetHistory.push({ role: "assistant", content: data.reply });
      if (data.conversation_id) widgetConvId = data.conversation_id;
    } else {
      _appendWidgetMessage(
        "ai",
        "❌ " + (data.error || "Something went wrong."),
      );
    }
  } catch (e) {
    if (typing) typing.style.display = "none";
    _appendWidgetMessage("ai", "❌ Network error. Please try again.");
  }

  if (sendBtn) sendBtn.disabled = false;
  if (input) input.focus();
  _widgetScrollBottom();
}

function _appendWidgetMessage(role, content) {
  const container = document.getElementById("widgetMessages");
  if (!container) return;
  const isUser = role === "user";

  const row = document.createElement("div");
  row.className = `widget-msg-row ${isUser ? "widget-user" : "widget-ai"}`;

  const userAvatarSrc =
    typeof CHAT_USER_IMAGE !== "undefined" && CHAT_USER_IMAGE
      ? CHAT_USER_IMAGE
      : null;
  const avatarHtml = `<div class="widget-avatar">${
    isUser
      ? userAvatarSrc
        ? `<img src="${userAvatarSrc}" alt="You" onerror="this.parentElement.innerHTML='👤'">`
        : "👤"
      : "<img src='/static/images/ina-avatar.png' alt='INA'>"
  }</div>`;
  const bodyHtml = isUser
    ? `<div class="widget-bubble">${_escapeHtml(content)}</div>`
    : `<div class="widget-bubble markdown-content">${renderMarkdown(content)}</div>`;

  row.innerHTML = `${!isUser ? avatarHtml : ""}${bodyHtml}${isUser ? avatarHtml : ""}`;
  container.appendChild(row);
}

function clearWidgetChat() {
  const container = document.getElementById("widgetMessages");
  if (!container) return;
  container.innerHTML = "";
  widgetHistory = [];
  const welcome = document.createElement("div");
  welcome.id = "widgetWelcome";
  welcome.className = "widget-welcome";
  welcome.innerHTML = `
<div class="ww-icon"><img src="/static/images/ina-avatar.png" alt="INA"></div>
    <p>Hi! I'm INA, your Filipino cooking assistant. Ask me about recipes, ingredients, or cooking tips!</p>
    <div class="widget-suggestions">
      <button class="widget-suggestion" onclick="sendWidgetSuggestion('Suggest a quick Filipino dinner')">🇵🇭 Quick Filipino dinner</button>
      <button class="widget-suggestion" onclick="sendWidgetSuggestion('What can I cook with chicken and coconut milk?')">🍗 Cook with chicken</button>
      <button class="widget-suggestion" onclick="sendWidgetSuggestion('Budget-friendly recipes under ₱150')">💰 Budget recipes</button>
    </div>`;
  container.appendChild(welcome);
}

function _widgetScrollBottom() {
  const el = document.getElementById("widgetMessages");
  if (el) el.scrollTop = el.scrollHeight;
}
