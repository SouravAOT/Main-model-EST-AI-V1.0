const API_BASE_URL = "https://main-model-est-ai-v1-0-y3o3.onrender.com";
const intro = document.getElementById("intro");
const video = document.getElementById("introVideo");
const auth = document.getElementById("auth");
const app = document.getElementById("app");
let currentUser = null;
let activeChatId = null;
let firebaseAuth = null;
let guestMessageCount = 0;
const guestChatIds = new Set();
const GUEST_MESSAGE_LIMIT = 10;
const GUEST_PROMPT_MAX_CHARS = 1500;
let guestBackGuardInstalled = false;

function isGuestUser() { return Boolean(currentUser && currentUser.isAnonymous); }
function guestCounterKey() { return currentUser ? `est-guest-message-count-${currentUser.uid}` : "est-guest-message-count"; }

function updateGuestUi() {
  const wasGuest = Boolean(window.EST_IS_GUEST);
  const guest = isGuestUser();
  window.EST_IS_GUEST = guest;
  if (guest) {
    const guestMode = sessionStorage.getItem("est-persona-mode");
    window.EST_PERSONA_MODE = ["horror", "shadow", "heavenly"].includes(guestMode) ? guestMode : "normal";
  }
  const notice = document.getElementById("guestNotice");
  const signInMenu = document.getElementById("guestSignInMenu");
  if (notice) notice.classList.toggle("hidden", !guest);
  if (signInMenu) signInMenu.classList.toggle("hidden", !guest);
  const quota = document.getElementById("guestQuota");
  if (quota && guest) quota.textContent = `${Math.max(0, GUEST_MESSAGE_LIMIT - guestMessageCount)} of ${GUEST_MESSAGE_LIMIT} messages left this session`;
  if (guest && !wasGuest) installGuestBackGuard();
  if (typeof window.renderSavedCodes === "function") window.renderSavedCodes();
}

function installGuestBackGuard() {
  if (!guestBackGuardInstalled) {
    guestBackGuardInstalled = true;
    window.addEventListener("popstate", async () => {
      if (!isGuestUser()) return;
      try { history.pushState({ estAiGuestGuard: true }, "", location.href); } catch (_) {}
      toast("Guest session ended. Temporary chats are being cleared.");
      await finishGuestSession();
    });
  }
  try { history.pushState({ estAiGuestGuard: true }, "", location.href); } catch (_) {}
}

async function clearGuestServerChats() {
  if (!isGuestUser()) return;
  try {
    const data = await apiFetch("/api/chat");
    (data.chats || []).forEach(chat => { if (chat.id) guestChatIds.add(chat.id); });
  } catch (error) {
    console.warn("Could not list temporary guest chats for cleanup:", error.message);
  }
  for (const id of Array.from(guestChatIds)) {
    try { await apiFetch(`/api/chat/${encodeURIComponent(id)}`, { method: "DELETE" }); }
    catch (error) { console.warn("Temporary guest chat cleanup failed:", id, error.message); }
  }
  guestChatIds.clear();
}

async function finishGuestSession() {
  if (!isGuestUser() || !firebaseAuth) return;
  const guestUser = currentUser;
  try { await clearGuestServerChats(); } catch (_) {}
  try { sessionStorage.removeItem(guestCounterKey()); } catch (_) {}
  try { sessionStorage.removeItem("est-saved-codes"); sessionStorage.removeItem("est-persona-mode"); } catch (_) {}
  try { localStorage.removeItem("est-persona-mode"); } catch (_) {}
  activeChatId = null;
  guestMessageCount = 0;
  conversations.splice(0, conversations.length);
  renderConversations();
  try {
    if (guestUser && guestUser.isAnonymous) await guestUser.delete();
    else await firebaseAuth.signOut();
  } catch (error) {
    console.warn("Guest account deletion failed; signing out instead:", error.message);
    try { await firebaseAuth.signOut(); } catch (_) {}
  }
  const messages = document.getElementById("messages");
  if (messages) messages.innerHTML = "";
  const prompt = document.getElementById("prompt");
  if (prompt) prompt.value = "";
  updateGuestUi();
}

async function upgradeGuestToAccount() {
  if (isGuestUser()) await finishGuestSession();
  revealAuth("Sign in with Google or use Email & Password to create a regular account.");
  const emailBox = document.getElementById("emailBox");
  if (emailBox) emailBox.classList.remove("hidden");
  toast("Guest session cleared. Sign in or create an account.");
}

function enterApp() {
  // Hide only the intro here. Firebase auth-state listener alone decides
  // whether the sign-in screen or signed-in workspace is shown.
  if (intro && !intro.classList.contains("hidden")) intro.classList.add("hidden");
}
if (video) {
  // Let the original intro finish naturally before showing auth/app.
  video.addEventListener("ended", enterApp, { once: true });
  video.addEventListener("error", () => {
    const fallback = document.getElementById("fallbackLogo");
    if (fallback) fallback.style.display = "grid";
    setTimeout(enterApp, 1800);
  }, { once: true });
  const playAttempt = video.play();
  if (playAttempt && typeof playAttempt.catch === "function") {
    playAttempt.catch(() => {
      // Muted inline video should autoplay; if the browser blocks it, don't trap the user.
      setTimeout(enterApp, Math.max(1200, Math.min(2600, (video.duration || 2.1) * 1000 + 200)));
    });
  }
} else {
  setTimeout(enterApp, 2200);
}

function firebaseConfigReady() {
  const c = window.EST_FIREBASE_CONFIG;
  return !!(c && c.apiKey && c.authDomain && c.projectId && c.appId && !String(c.apiKey).startsWith("PASTE_") && !String(c.appId).startsWith("PASTE_"));
}
function setAuthStatus(message) {
  const el = document.getElementById("authStatus");
  if (el) el.textContent = message;
}
function revealAuth(message) {
  if (intro) intro.classList.add("hidden");
  if (app) app.classList.add("hidden");
  if (auth) auth.classList.remove("hidden");
  if (message) setAuthStatus(message);
}
function setBackendStatus(ok, label) {
  const text = label || (ok ? "Backend online" : "Backend unavailable");
  ["backendStatus", "authBackendStatus"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; if (id === "backendStatus") el.classList.toggle("online", !!ok); }
  });
}
async function checkBackend() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { method: "GET", signal: controller.signal, cache: "no-store" });
    const data = await response.json();
    const ok = response.ok && (data.status === "ok" || data.status === "healthy");
    setBackendStatus(ok, ok ? "Backend online" : "Backend check failed");
  } catch (_) { setBackendStatus(false, "Backend unreachable"); }
  finally { clearTimeout(timeout); }
}
checkBackend();

let authStateResolved = false;
const authFallbackTimer = setTimeout(() => {
  if (!authStateResolved) revealAuth("Sign-in is taking longer than expected. Check your internet connection and Firebase setup, then retry.");
}, 6500);
function initFirebase() {
  if (!firebaseConfigReady()) {
    revealAuth("Firebase Web App config is missing or incomplete. Check firebase-config.js.");
    return false;
  }
  if (!window.firebase || !window.firebase.auth) {
    revealAuth("Firebase SDK did not load. Check your internet connection and reload.");
    return false;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.EST_FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    // Do not force LOCAL persistence here: Guest mode deliberately uses SESSION
    // persistence, while Google/email sign-in explicitly select LOCAL below.
    firebaseAuth.onAuthStateChanged(user => {
      authStateResolved = true; clearTimeout(authFallbackTimer);
      currentUser = user || null;
      if (intro) intro.classList.add("hidden");
      if (user) {
        auth.classList.add("hidden"); app.classList.remove("hidden");
        if (user.isAnonymous) {
          guestMessageCount = Number(sessionStorage.getItem(guestCounterKey()) || 0);
          setAuthStatus("Guest session active.");
          updateGuestUi();
          conversations.splice(0, conversations.length); renderConversations();
          loadConversations(); startEventPresence(); refreshEventWallet(); loadSavedUploads();
        } else {
          guestMessageCount = 0; updateGuestUi();
          setAuthStatus(`Signed in as ${user.email || user.displayName || "your account"}.`);
          loadProfile(); loadConversations();
          startEventPresence(); refreshEventWallet(); loadSavedUploads(); recordMailboxVisit();
        }
      } else {
        stopEventPresence();
        updateGuestUi();
        app.classList.add("hidden"); auth.classList.remove("hidden");
      }
    });
    return true;
  } catch (error) { authStateResolved = true; clearTimeout(authFallbackTimer); revealAuth(`Firebase setup error: ${error.message}`); return false; }
}
// Firebase compat SDK is loaded in index.html before this file.
initFirebase();

function showEmail() {
  document.getElementById("emailBox").classList.toggle("hidden");
}
async function loginGoogle() {
  if (!firebaseAuth && !initFirebase()) return toast("Firebase sign-in is not ready. Read the message below the buttons.");
  try {
    await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebaseAuth.signInWithPopup(provider);
  } catch (error) {
    setAuthStatus(error.message || "Google sign-in failed.");
    toast(error.message || "Google sign-in failed");
  }
}
async function loginEmail() {
  if (!firebaseAuth && !initFirebase()) return toast("Firebase sign-in is not ready. Read the message below the buttons.");
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || password.length < 6) return toast("Enter a valid email and password (6+ characters)");
  try {
    await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    try {
      await firebaseAuth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        await firebaseAuth.createUserWithEmailAndPassword(email, password);
      } else throw error;
    }
  } catch (error) {
    setAuthStatus(error.message || "Email sign-in failed.");
    toast(error.message || "Email sign-in failed");
  }
}
async function loginGuest() {
  if (!firebaseAuth && !initFirebase()) return toast("Firebase sign-in is not ready. Check the message below the buttons.");
  try {
    await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
    await firebaseAuth.signInAnonymously();
    toast("Guest session started. Your work is temporary.");
  } catch (error) {
    const message = error.code === "auth/operation-not-allowed"
      ? "Guest sign-in is disabled in Firebase. Enable Authentication → Sign-in method → Anonymous, then try again."
      : (error.message || "Guest sign-in failed.");
    setAuthStatus(message);
    toast(message);
  }
}

async function getIdToken() {
  if (!currentUser) throw new Error("Please sign in first.");
  return currentUser.getIdToken();
}
async function apiFetch(path, options = {}) {
  const token = await getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.body instanceof FormData ? 120000 : 30000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const message = data.error || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The request took too long. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
async function loadProfile() {
  if (!currentUser || isGuestUser()) return;
  try {
    const data = await apiFetch("/api/user/me");
    const subscription = data.user?.subscription;
    if (subscription?.plan && Number(subscription.expiresAtMs) > Date.now()) localStorage.setItem("est-current-plan", subscription.plan);
    else if (subscription?.expiresAtMs && Number(subscription.expiresAtMs) <= Date.now()) localStorage.removeItem("est-current-plan");
    updateBadge();
  } catch (error) {
    console.warn("Profile load failed:", error.message);
  }
}
function openDrawer() {
  const drawer = document.getElementById("drawer"), backdrop = document.getElementById("drawerBackdrop");
  drawer.classList.add("open");
  if (window.matchMedia("(max-width:760px)").matches) backdrop.classList.add("active");
}
function closeDrawer() {
  document.getElementById("drawer")?.classList.remove("open");
  document.getElementById("drawerBackdrop")?.classList.remove("active");
}
const pages = ["chat", "images", "library", "projects", "scheduled", "plugins", "settings", "profile", "plus", "watch", "games", "codes", "help", "features", "events", "spinwheel", "luckroyale", "currency", "bidwin", "mailbox", "voicecall"];
let eventsLoadTimeout = null;
function showPage(name, afterEventsLoader = false) {
  if (name === "events" && !afterEventsLoader) {
    closeDrawer(); closeAttachMenu();
    const loader = document.getElementById("eventsLoading");
    if (loader) { loader.classList.add("active"); loader.setAttribute("aria-hidden", "false"); }
    document.body.classList.add("events-loading-mode");
    if (eventsLoadTimeout) clearTimeout(eventsLoadTimeout);
    eventsLoadTimeout = setTimeout(() => {
      if (loader) { loader.classList.remove("active"); loader.setAttribute("aria-hidden", "true"); }
      document.body.classList.remove("events-loading-mode");
      showPage("events", true);
    }, 2300);
    return;
  }
  const pageName = name;
  pages.forEach(p => document.getElementById(`page-${p}`)?.classList.remove("active"));
  document.getElementById(`page-${pageName}`)?.classList.add("active");
  const eventPageNames = ["events", "spinwheel", "luckroyale", "currency", "bidwin", "mailbox"];
  document.body.classList.toggle("events-mode", eventPageNames.includes(pageName));
  closeDrawer(); closeAttachMenu();
  if (pageName !== "voicecall" && voiceCallActive) endVoiceCall({navigate: true, keepCurrentPage: true});
  if (["events", "spinwheel", "luckroyale", "currency"].includes(pageName)) {
    refreshEventWallet();
    if (pageName === "spinwheel") renderEventWheel();
  }
  if (pageName === "currency") showCurrencyInfo(window.currentCurrencyInfo || "coins");
  if (pageName === "mailbox") loadMailbox();
  if (pageName === "images" || pageName === "library") renderSavedUploads();
}
function toggleAgentTools() {
  const panel = document.getElementById("nestedAgentTools");
  const button = document.querySelector(".plugin-nested-toggle");
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  button?.setAttribute("aria-expanded", String(opening));
  const chevron = document.getElementById("agentToggleChevron"); if (chevron) chevron.textContent = opening ? "−" : "+";
}
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.style.opacity = 1;
  el.style.transform = "translateX(-50%) translateY(0)";
  setTimeout(() => { el.style.opacity = 0; el.style.transform = "translateX(-50%) translateY(30px)"; }, 2300);
}
const conversations = [];
function renderConversations() {
  const list = document.getElementById("conversationList");
  const pinned = document.getElementById("pinned");
  list.innerHTML = ""; pinned.innerHTML = "";
  if (!conversations.length) {
    const empty = document.createElement("div"); empty.className = "conv muted"; empty.textContent = "Your saved chats will appear here."; list.appendChild(empty); return;
  }
  conversations.forEach(c => {
    const el = document.createElement("div"); el.className = "conv"; el.textContent = c.title || "Conversation";
    el.onclick = async () => { activeChatId = c.id; showPage("chat"); await loadChat(c.id); };
    list.appendChild(el);
    if (c.pinned) { const clone = el.cloneNode(true); clone.onclick = el.onclick; pinned.appendChild(clone); }
  });
}
renderConversations();
async function loadConversations() {
  if (!currentUser) return;
  try {
    const data = await apiFetch("/api/chat");
    if (isGuestUser()) {
      (data.chats || []).forEach(chat => { if (chat.id) guestChatIds.add(chat.id); });
      conversations.splice(0, conversations.length);
      renderConversations();
      updateGuestUi();
      return;
    }
    conversations.splice(0, conversations.length, ...(data.chats || []).map(chat => ({
      id: chat.id,
      title: chat.title || "Conversation",
      pinned: Boolean(chat.pinned)
    })));
    renderConversations();
  } catch (error) {
    console.warn("Conversation list unavailable:", error.message);
  }
}
async function showAll() {
  if (!currentUser) return toast("Sign in to load saved conversations");
  await loadConversations();
  toast(conversations.length ? "Saved conversations refreshed" : "No saved conversations yet");
}
function cleanAssistantText(value) {
  return String(value ?? "")
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*\s+/gm, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1$2");
}
function appendMessage(role, content, attachments = []) {
  const messages = document.getElementById("messages");
  const el = document.createElement("div");
  el.className = role === "user" ? "user-message" : "ai-message";
  if (role === "assistant" || role === "ai") {
    el.className = "ai-message";
    const body = document.createElement("div"); body.className = "message-content"; body.textContent = cleanAssistantText(content);
    el.appendChild(body); addAssistantActions(el);
  } else {
    const body=document.createElement("div");body.className="user-message-text";body.textContent=content||"Attached file(s)";el.appendChild(body);
    if (Array.isArray(attachments) && attachments.length) {
      const tray=document.createElement("div");tray.className="message-attachment-tray";
      attachments.forEach(file=>{
        const link=document.createElement("a");link.className="message-attachment";link.href=file.url;link.target="_blank";link.rel="noopener noreferrer";
        if (/^image\//.test(file.mimeType||"")) { const img=document.createElement("img");img.src=file.url;img.alt=file.name||"Attached image";img.loading="lazy";link.appendChild(img); }
        else if (/^video\//.test(file.mimeType||"")) { const video=document.createElement("video");video.src=file.url;video.controls=true;video.preload="metadata";link.appendChild(video); }
        const label=document.createElement("span");label.textContent=file.name||"Open attachment";link.appendChild(label);tray.appendChild(link);
      });
      el.appendChild(tray);
    }
  }
  messages.appendChild(el);
  // Preserve normal newest-message behavior, without binding this to keyboard resize events.
  if (messages.scrollHeight - messages.scrollTop - messages.clientHeight < 120 || role === "user") messages.scrollTop = messages.scrollHeight;
  return el;
}
function getMessageText(el) {
  const body = el?.querySelector?.(".message-content");
  return (body ? body.textContent : el?.textContent || "").trim();
}
function setMessageContent(el, content) {
  if (!el) return;
  let body = el.querySelector(".message-content");
  if (!body) { el.textContent = ""; body = document.createElement("div"); body.className = "message-content"; el.appendChild(body); addAssistantActions(el); }
  body.textContent = cleanAssistantText(content);
}
function actionIcon(name) {
  const paths = {
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    like: '<path d="M7 10v11H3V10h4Z"/><path d="M7 10 12 3a2 2 0 0 1 2 2l-1 5h6a2 2 0 0 1 2 2l-1.5 7a2 2 0 0 1-2 2H7"/>',
    dislike: '<path d="M7 3v11H3V3h4Z"/><path d="M7 14 12 21a2 2 0 0 0 2-2l-1-5h6a2 2 0 0 0 2-2l-1.5-7a2 2 0 0 0-2-2H7"/>',
    listen: '<path d="M3 10v4h4l5 4V6l-5 4H3Z"/><path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    game: '<path d="M6 8h12a4 4 0 0 1 3.8 5.2l-1 3.2a2.5 2.5 0 0 1-4.1 1.1L14 16H10l-2.7 2.5a2.5 2.5 0 0 1-4.1-1.1l-1-3.2A4 4 0 0 1 6 8Z"/><path d="M7 11v4M5 13h4M16.5 12h.01M19 14h.01"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.3 1.7c-1.2 1.1-1.9 1.4-1.9 3M12 17h.01"/>'
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.help}</svg>`;
}
function addAssistantActions(el) {
  if (el.querySelector(".message-actions")) return;
  const actions = document.createElement("div"); actions.className = "message-actions";
  const makeButton = (icon, title, handler, extraClass="") => {
    const b = document.createElement("button"); b.type = "button"; b.className = `message-action ${extraClass}`.trim();
    b.innerHTML = actionIcon(icon); b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", () => handler(el, b)); return b;
  };
  actions.appendChild(makeButton("copy", "Copy response", async (message) => { try { await navigator.clipboard.writeText(getMessageText(message)); toast("Copied"); } catch (_) { toast("Copy is unavailable in this browser"); } }));
  const voteArea = document.createElement("span"); voteArea.className = "feedback-vote-area";
  const like = makeButton("like", "Like response", (message, button) => recordResponseFeedback(message, "like", button), "feedback-like");
  const dislike = makeButton("dislike", "Dislike response", (message, button) => recordResponseFeedback(message, "dislike", button), "feedback-dislike");
  voteArea.append(like, dislike);
  // Keep the order matching the familiar response toolbar: copy, vote pair, listen, share.
  actions.appendChild(voteArea);
  actions.append(makeButton("listen", "Read this response aloud", (message, button) => toggleSpeechForMessage(message, button), "speak-action"));
  actions.append(makeButton("share", "Share response", async (message) => {
    const text = getMessageText(message);
    if (navigator.share) { try { await navigator.share({ text }); } catch (_) {} }
    else { try { await navigator.clipboard.writeText(text); toast("Response copied; sharing isn't supported here"); } catch (_) { toast("Sharing isn't supported in this browser"); } }
  }));
  const player = document.createElement("div"); player.className = "speech-player hidden";
  player.innerHTML = '<div class="speech-controls"><button type="button" class="speech-toggle" aria-label="Pause or resume speech">Ⅱ</button><button type="button" class="speech-stop" aria-label="Stop speech">■</button><span class="speech-time">Ready</span></div><input class="speech-seek" type="range" min="0" max="100" value="0" aria-label="Speech position"><small class="speech-hint">Playback position is approximate and depends on your device voice engine.</small>';
  player.querySelector(".speech-toggle").addEventListener("click", () => togglePauseResume(el));
  player.querySelector(".speech-stop").addEventListener("click", () => stopSpeech(el));
  player.querySelector(".speech-seek").addEventListener("change", event => seekSpeech(el, Number(event.target.value)));
  el.append(actions, player);
}
function recordResponseFeedback(message, vote, button) {
  const area = message.querySelector(".feedback-vote-area");
  if (!area || area.dataset.voted === "true") return;
  area.dataset.voted = "true";
  const chosen = area.querySelector(vote === "like" ? ".feedback-like" : ".feedback-dislike");
  const other = area.querySelector(vote === "like" ? ".feedback-dislike" : ".feedback-like");
  if (other) other.remove();
  if (chosen) {
    chosen.classList.add("selected");
    chosen.setAttribute("aria-pressed", "true");
    chosen.title = vote === "like" ? "You liked this response" : "You disliked this response";
  }
  const status = document.createElement("span");
  status.className = "feedback-status";
  status.setAttribute("role", "status");
  status.textContent = vote === "like" ? "Thanks for the feedback" : "Feedback noted";
  area.appendChild(status);
  try {
    const key = "est-response-feedback";
    const previous = JSON.parse(sessionStorage.getItem(key) || "[]");
    previous.push({ vote, text: getMessageText(message).slice(0, 300), at: Date.now() });
    sessionStorage.setItem(key, JSON.stringify(previous.slice(-100)));
  } catch (_) {}
}

function enhanceExistingAssistantMessages() {
  document.querySelectorAll("#messages .ai-message").forEach(el => {
    if (!el.querySelector(".message-content")) {
      const text = el.textContent; el.textContent = "";
      const body = document.createElement("div"); body.className = "message-content"; body.textContent = text; el.appendChild(body);
    }
    addAssistantActions(el);
  });
}
enhanceExistingAssistantMessages();
let webSearchMode = false;
function startWebSearch() {
  webSearchMode = true;
  const input = document.getElementById("prompt");
  input.placeholder = "Ask a question to search the web…";
  input.focus();
  toast("Web search enabled for your next message");
}
function startWriteEdit() {
  const input = document.getElementById("prompt");
  input.value = input.value || "Help me write or edit: ";
  updateComposerControls();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  toast("Write or edit mode ready");
}
function startImageCreation() {
  showPage("images");
  toast("Image generation is not available in backend v1.8 yet");
}
function newChat() {
  activeChatId = null;
  webSearchMode = false;
  const messages = document.getElementById("messages");
  messages.innerHTML = "";
  appendMessage("assistant", "Hi! I'm Est Ai. What would you like to do today?");
  document.getElementById("prompt").value = "";
  document.getElementById("prompt").placeholder = "Message Est Ai...";
  updateComposerControls();
  showPage("chat");
}
async function signOut() {
  if (!firebaseAuth) return;
  try {
    if (isGuestUser()) {
      await finishGuestSession();
      toast("Guest session cleared.");
      return;
    }
    await firebaseAuth.signOut();
    activeChatId = null;
    conversations.splice(0, conversations.length);
    renderConversations();
    toast("Signed out successfully");
  } catch (_) {
    toast("Couldn't sign out. Please try again.");
  }
}
async function sendMessage() {
  const input = document.getElementById("prompt");
  const value = input.value.trim();
  const attachments = [...pendingChatAttachments];
  if (!value && !attachments.length) return;
  const visibleUserText = value || "Please review the attached file(s).";
  // Attachment metadata is sent separately below and appended once by the backend.
  // Keeping URLs out of message text avoids duplicate links in the model context.
  const requestMessage = visibleUserText;
  if (!currentUser) return toast("Please sign in before chatting with Est Ai");
  if (isGuestUser()) {
    if (guestMessageCount >= GUEST_MESSAGE_LIMIT) return toast("Guest limit reached. Sign in or create an account to continue.");
    if (value.length > GUEST_PROMPT_MAX_CHARS) return toast(`Guest messages are limited to ${GUEST_PROMPT_MAX_CHARS} characters.`);
    guestMessageCount += 1;
    sessionStorage.setItem(guestCounterKey(), String(guestMessageCount));
    updateGuestUi();
  }
  appendMessage("user", visibleUserText, attachments);
  input.value = ""; pendingChatAttachments = []; renderPendingAttachments(); updateComposerControls();
  const pending = appendMessage("assistant", "Thinking…");
  try {
    const data = await apiFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: requestMessage, attachments: attachments.map(file => ({ name: file.name, mimeType: file.mimeType, url: file.url })), chatId: activeChatId, webSearch: webSearchMode, language: document.querySelector("#page-settings select")?.value || "auto", personaMode: window.EST_PERSONA_MODE || "normal" })
    });
    if (data.available === false && data.type === "image_generation") {
      setMessageContent(pending, data.message || "Image generation is not available yet.");
    } else {
      setMessageContent(pending, data.message?.content || data.message || "I couldn't generate a response.");
    }
    if (webSearchMode && data.webSearch && !data.webSearch.used) {
      setMessageContent(pending, getMessageText(pending) + "\n\nNote: web search did not return results, so this reply may not include live web information.");
    }
    webSearchMode = false;
    input.placeholder = "Message Est Ai...";
    if (data.chatId) {
      activeChatId = data.chatId;
      if (isGuestUser()) guestChatIds.add(data.chatId);
    }
    if (isGuestUser()) {
      await loadConversations();
    } else if (activeChatId && !conversations.some(c => c.id === activeChatId)) {
      conversations.unshift({ id: activeChatId, title: value.slice(0, 48), pinned: false });
      renderConversations();
    } else {
      await loadConversations();
    }
  } catch (error) {
    setMessageContent(pending, error.message || "Couldn't connect to Est Ai. Please try again.");
    webSearchMode = false;
    input.placeholder = "Message Est Ai...";
  }
}
document.getElementById("prompt").addEventListener("input", updateComposerControls);
document.getElementById("prompt").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
});
function syncMobileKeyboard() {
  const vv = window.visualViewport;
  const focused = document.activeElement === document.getElementById("prompt");
  const hiddenHeight = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty("--est-visual-height", `${vv?.height || window.innerHeight}px`);
  document.documentElement.style.setProperty("--keyboard-offset", `${focused ? hiddenHeight : 0}px`);
  // Deliberately do not call scrollIntoView here. Mobile browsers emit many
  // viewport resize/scroll events while the keyboard animates; auto-scrolling
  // on every event makes old messages jump while the user is reading.
}
window.visualViewport?.addEventListener("resize", syncMobileKeyboard);
window.visualViewport?.addEventListener("scroll", syncMobileKeyboard);
document.getElementById("prompt")?.addEventListener("focus", syncMobileKeyboard);
document.getElementById("prompt")?.addEventListener("blur", () => document.documentElement.style.setProperty("--keyboard-offset", "0px"));
async function loadChat(chatId) {
  if (!chatId) return;
  try {
    const data = await apiFetch(`/api/chat/${encodeURIComponent(chatId)}/messages`);
    const messages = document.getElementById("messages");
    messages.innerHTML = "";
    (data.messages || []).forEach(m => appendMessage(m.role, m.content, Array.isArray(m.attachments) ? m.attachments : []));
  } catch (error) { toast(error.message || "Unable to load chat"); }
}

// Best-effort cleanup if the guest closes the tab rather than using the Back button/sign-out.
window.addEventListener("pagehide", () => {
  if (!isGuestUser() || !currentUser) return;
  const ids = Array.from(guestChatIds);
  currentUser.getIdToken().then(token => {
    ids.forEach(id => {
      fetch(`${API_BASE_URL}/api/chat/${encodeURIComponent(id)}`, {
        method: "DELETE", keepalive: true,
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    });
  }).catch(() => {});
});

// Narrow helpers used by the Secret Codes page; keeps auth/API state in app.js.
window.currentUserForCodes = () => Boolean(currentUser);
window.estApiFetch = apiFetch;
window.estGetActiveChatId = () => activeChatId;
window.estSetActiveChatId = (id) => { activeChatId = id; if (id && isGuestUser()) guestChatIds.add(id); };
window.estAppendAssistantMessage = (text) => appendMessage('assistant', text);
window.estRefreshConversations = () => loadConversations();

function setTheme(theme) {
  document.body.classList.remove("light", "winter");
  if (theme === "light") document.body.classList.add("light");
  if (theme === "winter") document.body.classList.add("winter");
  localStorage.setItem("est-theme", theme);
  if (currentUser) apiFetch("/api/user/settings", { method: "PATCH", body: JSON.stringify({ theme }) }).catch(() => {});
}
const savedTheme = localStorage.getItem("est-theme");
if (savedTheme && document.getElementById("theme")) { document.getElementById("theme").value = savedTheme; setTheme(savedTheme); }
function startAds(required, plan) {
  // The currently configured HighRevenueFormat placements are banner/iframe ads,
  // not a verified rewarded-video SDK. Do not imply that watching them grants a plan.
  toast(`EST ${String(plan).toUpperCase()} ad rewards are paused until a verified rewarded-video provider is configured.`);
}
function updateBadge() {
  const plan = localStorage.getItem("est-current-plan") || "lite";
  const badge = document.getElementById("profileBadge");
  if (badge) { badge.className = `badge ${plan}`; badge.textContent = `✦ EST ${plan.toUpperCase()}`; }
}
updateBadge();

let adLoaded = false, remaining = 30, timerHandle = null;
function addScript(src, attrs = {}) {
  const script = document.createElement("script"); script.src = src;
  Object.entries(attrs).forEach(([key, value]) => script.setAttribute(key, value));
  document.body.appendChild(script);
}
function loadAds() {
  if (adLoaded) return; adLoaded = true;
  addScript("https://pl31694850.profitableratecpmnetwork.com/c31f2558dc285fe9d1c1f04566221f47/invoke.js", { async: "async", "data-cfasync": "false" });
  const slots = [
    ["e9ef1dae333e9c765594cb030ada5f86", 300, 250],
    ["fd16236cd40d3c6ec9b8d0bd001b7c78", 320, 50],
    ["7b21ac088c132d29ce273993e9e0d735", 468, 60],
    ["73a7a46aed51e0bfba2133c748eef4ef", 728, 90]
  ];
  const root = document.getElementById("bannerSlots"); let index = 0;
  function next() {
    if (index >= slots.length) return;
    const [key, width, height] = slots[index++];
    const slot = document.createElement("div"); slot.className = "slot";
    const holder = document.createElement("div"); holder.style.width = `${width}px`; holder.style.minHeight = `${height}px`; holder.style.maxWidth = "100%"; slot.appendChild(holder); root.appendChild(slot);
    const options = document.createElement("script");
    options.text = `var atOptions = ${JSON.stringify({ key, format: "iframe", height, width, params: {} })};`;
    holder.appendChild(options);
    const invoke = document.createElement("script"); invoke.src = `https://www.highrevenueformat.com/${key}/invoke.js`;
    invoke.onload = next; invoke.onerror = next; holder.appendChild(invoke);
  }
  next();
  addScript("https://pl31694849.profitableratecpmnetwork.com/8f/ac/b5/8facb50e3e239e31adde534fc6c08fc2.js");
}
function openAd() {
  document.getElementById("adOverlay").style.display = "block"; document.body.style.overflow = "hidden";
  remaining = 30; document.getElementById("timer").textContent = "30"; document.getElementById("adClose").disabled = true;
  loadAds(); clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    remaining--; document.getElementById("timer").textContent = String(Math.max(0, remaining));
    if (remaining <= 0) { clearInterval(timerHandle); document.getElementById("adClose").disabled = false; }
  }, 1000);
}
function closeAd() {
  if (document.getElementById("adClose").disabled) return;
  document.getElementById("adOverlay").style.display = "none"; document.body.style.overflow = "";
  toast("Ad preview finished. No plan/reward is credited until a verified rewarded-ad provider is connected.");
}
window.addEventListener("beforeunload", () => clearInterval(timerHandle));


// Lightweight agent/workflow shortcuts inspired by public agent/plugin catalogues.
const EST_AGENT_PROMPTS = {
  study: "Act as a patient study coach. Explain the topic step by step in simple language, then ask me 3 short practice questions. Topic: ",
  coding: "Act as a coding helper. First identify the likely cause, then give a minimal fix and explain it. Code/problem: ",
  writer: "Act as a writing assistant. Improve clarity and grammar while preserving my meaning and tone. Text/task: ",
  research: "Act as a research guide. Organize the question, separate established facts from uncertainty, and list what needs current source verification. Topic: ",
  document: "Summarize the document text I provide into key points, important names/dates, and open questions. Text: ",
  creative: "Act as a creative partner. Offer several original directions and briefly compare their strengths. Idea: "
};
function useAgent(name) {
  const input = document.getElementById("prompt");
  input.value = EST_AGENT_PROMPTS[name] || "Help me with: ";
  updateComposerControls();
  showPage("chat"); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  toast("Agent prompt ready — add your topic and send it.");
}
function useWorkflow(name) {
  const prompts = {
    summarize: "Summarize the following text into key points and a short conclusion: ",
    translate: "Translate the following text into the language I specify, preserving meaning and tone: ",
    explain: "Explain this in simple language, step by step, with an example: ",
    brainstorm: "Brainstorm 5 useful ideas for this goal and compare their pros and cons: "
  };
  const input = document.getElementById("prompt"); input.value = prompts[name] || "Help me with: ";
  updateComposerControls();
  showPage("chat"); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
}
let estRecognition = null;
let pendingChatAttachments = [];
let uploadShouldAttachToChat = false;
let estRecognitionBase = "";
let estRecognitionFinalByIndex = new Map();
let voiceStatusHideTimer = null;
function dedupeSpeechText(value) {
  const tokens = String(value || "").trim().split(/\s+/).filter(Boolean);
  const output = [], fillerCount = new Map();
  const repeatedFillers = new Set(["bhai", "भाई", "um", "uh"]);
  for (const token of tokens) {
    const lower = token.toLocaleLowerCase().replace(/[.,!?;:،۔]/g, "");
    const previous = output.length ? output[output.length - 1].toLocaleLowerCase().replace(/[.,!?;:،۔]/g, "") : "";
    if (previous === lower) continue;
    if (repeatedFillers.has(lower)) {
      const count = fillerCount.get(lower) || 0;
      if (count >= 1) continue;
      fillerCount.set(lower, count + 1);
    }
    output.push(token);
  }
  return output.join(" ");
}
function renderVoiceInputStatus(recording, label = "Recording voice…") {
  const bar = document.getElementById("voiceInputBar");
  const text = document.getElementById("voiceInputLabel");
  if (!bar) return;
  bar.classList.toggle("hidden", !recording && !label);
  bar.classList.toggle("recording", Boolean(recording));
  bar.classList.toggle("transcript-ready", !recording && Boolean(label));
  if (text) text.textContent = label || "";
  const stop = bar.querySelector("button");
  if (stop) { stop.textContent = recording ? "■" : "×"; stop.setAttribute("aria-label", recording ? "Stop voice recording" : "Dismiss transcription status"); }
  if (voiceStatusHideTimer) clearTimeout(voiceStatusHideTimer);
  if (!recording && label) voiceStatusHideTimer = setTimeout(() => { if (!estRecognition) bar.classList.add("hidden"); }, 2600);
}
function updateComposerControls() {
  const input = document.getElementById("prompt");
  const callBtn = document.querySelector(".voice-call-trigger");
  const sendBtn = document.querySelector(".send-trigger");
  const micBtn = document.querySelector(".mic-trigger");
  const hasText = Boolean(input?.value.trim());
  const recording = Boolean(estRecognition);
  callBtn?.classList.toggle("hidden", hasText || recording);
  sendBtn?.classList.toggle("hidden", !hasText && !recording && !pendingChatAttachments.length);
  if (sendBtn) sendBtn.disabled = !hasText && pendingChatAttachments.length === 0;
  micBtn?.classList.toggle("listening", recording);
  if (micBtn) {
    micBtn.setAttribute("aria-label", recording ? "Stop voice recording" : "Start voice recording");
    micBtn.title = recording ? "Stop recording" : "Voice input";
    micBtn.innerHTML = recording ? '<span class="record-stop-square" aria-hidden="true"></span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8"></path></svg>';
  }
}
function startVoiceInput() {
  if (estRecognition) { stopVoiceInput(true); return; }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const input = document.getElementById("prompt");
  if (!SpeechRecognition) return toast("Voice typing is not supported in this browser. Try Chrome on HTTPS.");
  const recognition = new SpeechRecognition();
  recognition.lang = getSpeechLanguage();
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  estRecognitionBase = input.value.trim();
  estRecognitionFinalByIndex = new Map();
  estRecognition = recognition;
  renderVoiceInputStatus(true, "Recording voice… speak clearly, then stop");
  updateComposerControls();
  recognition.onresult = event => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const phrase = dedupeSpeechText(result?.[0]?.transcript || "");
      if (!phrase) continue;
      if (result.isFinal) estRecognitionFinalByIndex.set(i, phrase);
      else interim = phrase;
    }
    const finalTranscript = dedupeSpeechText([...estRecognitionFinalByIndex.entries()].sort((a,b) => a[0]-b[0]).map(([,text]) => text).join(" "));
    const transcript = dedupeSpeechText([finalTranscript, interim].filter(Boolean).join(" "));
    input.value = [estRecognitionBase, transcript].filter(Boolean).join(" ").trim();
    updateComposerControls();
  };
  recognition.onerror = event => {
    if (event.error === "not-allowed") renderVoiceInputStatus(false, "Microphone permission was denied.");
    else if (!['aborted','no-speech'].includes(event.error)) renderVoiceInputStatus(false, "Voice input paused — tap the mic to retry.");
  };
  recognition.onend = () => {
    if (estRecognition === recognition) estRecognition = null;
    updateComposerControls();
    const hasTranscript = Boolean(input.value.trim());
    renderVoiceInputStatus(false, hasTranscript ? "Transcription ready — review, then send" : "No speech detected. Tap the mic to try again.");
  };
  try { recognition.start(); }
  catch (_) { estRecognition = null; updateComposerControls(); renderVoiceInputStatus(false, "Voice input could not start. Check microphone permission."); }
}
function stopVoiceInput(showTranscript = true) {
  const recognition = estRecognition;
  if (!recognition) { document.getElementById("voiceInputBar")?.classList.add("hidden"); return; }
  estRecognition = null;
  try { recognition.stop(); } catch (_) {}
  updateComposerControls();
  const hasTranscript = Boolean(document.getElementById("prompt")?.value.trim());
  renderVoiceInputStatus(false, showTranscript ? (hasTranscript ? "Transcription ready — review, then send" : "Recording stopped — no speech captured") : "");
}
function getSpeechLanguage() {
  const selected = document.getElementById("appLanguage")?.value || "English";
  if (/bengali/i.test(selected)) return "bn-IN";
  if (/hindi/i.test(selected)) return "hi-IN";
  return "en-IN";
}
updateComposerControls();

/* Attachment menu and account media library. Uploads are only shown as saved after backend confirmation. */
function toggleAttachMenu() {
  const menu = document.getElementById("attachMenu"), trigger = document.querySelector(".attach-trigger");
  const opening = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !opening); trigger?.setAttribute("aria-expanded", String(opening));
}
function closeAttachMenu() {
  document.getElementById("attachMenu")?.classList.add("hidden");
  document.querySelector(".attach-trigger")?.setAttribute("aria-expanded", "false");
}
function chooseUpload(kind) {
  closeAttachMenu();
  uploadShouldAttachToChat = Boolean(document.getElementById("page-chat")?.classList.contains("active"));
  const input = document.getElementById(kind === "photos" ? "photoUploadInput" : "fileUploadInput");
  if (input) { input.value = ""; input.click(); }
}
function openPluginsFromAttach() { closeAttachMenu(); showPage("plugins"); }
function uploadCacheKey() { return `est-ai-upload-metadata-v1-${currentUser?.uid || "guest"}`; }
function readSavedUploads() { try { return JSON.parse(localStorage.getItem(uploadCacheKey()) || "[]"); } catch (_) { return []; } }
function writeSavedUploads(items) { try { localStorage.setItem(uploadCacheKey(), JSON.stringify(items.slice(-80))); } catch (_) {} }
async function loadSavedUploads() {
  renderSavedUploads();
  if (!currentUser) return;
  try {
    const data=await apiFetch("/api/upload");
    if(Array.isArray(data.files)) {
      const remote=data.files.map(f=>({id:f.id,name:f.originalName||f.name||"Uploaded file",mimeType:f.mimeType||"application/octet-stream",sizeLabel:formatFileSize(Number(f.size)||0),url:f.url,savedAt:Date.parse(f.createdAt)||Date.now()}));
      const existing=readSavedUploads();const merged=[...remote,...existing.filter(f=>!remote.some(r=>r.id===f.id))];writeSavedUploads(merged);renderSavedUploads();
    }
  } catch(error) { console.warn("Could not refresh saved uploads:",error.message); }
}
function escapeText(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function addSavedUpload(file) { const all = readSavedUploads(); all.unshift(file); writeSavedUploads(all); renderSavedUploads(); }
function renderSavedUploads() {
  const all = readSavedUploads();
  const mediaGrid = document.getElementById("mediaGrid"), libraryGrid = document.getElementById("libraryGrid");
  if (mediaGrid) {
    const media = all.filter(f => /^image\//.test(f.mimeType) || /^video\//.test(f.mimeType));
    mediaGrid.innerHTML = media.length ? media.map((f,i) => `<article class="media-card">${/^video\//.test(f.mimeType) ? `<video src="${escapeText(f.url)}" controls preload="metadata"></video>` : `<img loading="lazy" src="${escapeText(f.url)}" alt="${escapeText(f.name)}">`}<div><b>${escapeText(f.name)}</b><small>${escapeText(f.sizeLabel || "Media")}</small><a href="${escapeText(f.url)}" target="_blank" rel="noopener">Open</a></div></article>`).join("") : '<div class="empty-state"><span>▧</span><b>No photos or videos yet</b><p>Add media to see it here. Uploaded items appear once the server confirms them.</p></div>';
  }
  if (libraryGrid) {
    const files = all.filter(f => !(/^image\//.test(f.mimeType) || /^video\//.test(f.mimeType)));
    libraryGrid.innerHTML = files.length ? files.map(f => `<article class="library-file-card"><span class="file-kind">${/pdf/i.test(f.mimeType) ? "PDF" : "FILE"}</span><div><b>${escapeText(f.name)}</b><small>${escapeText(f.sizeLabel || f.mimeType)}</small></div><a href="${escapeText(f.url)}" target="_blank" rel="noopener">Open</a></article>`).join("") : '<div class="empty-state"><span>▤</span><b>No files saved yet</b><p>Upload a supported file to add it to your Library.</p></div>';
  }
}
function setUploadFeedback(message, isError = false) {
  const inChat = document.getElementById("page-chat")?.classList.contains("active");
  const page = inChat ? "uploadStatus" : (document.getElementById("page-images")?.classList.contains("active") ? "mediaUploadStatus" : "fileUploadStatus");
  const el = document.getElementById(page); if (!el) return;
  if (inChat) { el.textContent = ""; el.classList.add("hidden"); return; }
  el.textContent = message || ""; el.classList.toggle("hidden", !message); el.classList.toggle("upload-error", Boolean(isError));
}
function renderPendingAttachments() {
  const tray=document.getElementById("pendingAttachments");if(!tray)return;
  tray.innerHTML="";
  pendingChatAttachments.forEach((file,index)=>{
    const item=document.createElement("div");item.className="pending-attachment";
    const label=document.createElement("span");label.textContent=file.name||"Attachment";
    const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.setAttribute("aria-label",`Remove ${file.name||"attachment"}`);remove.onclick=()=>{pendingChatAttachments.splice(index,1);renderPendingAttachments();updateComposerControls();};
    item.append(label,remove);tray.appendChild(item);
  });
  tray.classList.toggle("hidden",pendingChatAttachments.length===0);
}
async function uploadSelectedFiles(fileList, requestedKind) {
  const files=Array.from(fileList||[]);if(!files.length)return;
  if(!currentUser){setUploadFeedback("Sign in before uploading files.",true);return;}
  let completed=0;
  for(const file of files){
    if(file.size>100*1024*1024){setUploadFeedback(`${file.name}: the current upload limit is 100 MB.`,true);continue;}
    if(requestedKind==="photos" && !(/^image\//.test(file.type)||/^video\//.test(file.type))){setUploadFeedback(`${file.name}: select a supported photo or video.`,true);continue;}
    const form=new FormData();form.append("file",file,file.name);
    try{
      setUploadFeedback(`Uploading ${completed+1} of ${files.length}: ${file.name}…`);
      const data=await apiFetch("/api/upload",{method:"POST",body:form});
      if(!data.file?.url)throw new Error("The server did not return a saved file URL.");
      const saved={id:data.file.id||`${Date.now()}-${file.name}`,name:data.file.originalName||file.name,mimeType:data.file.mimeType||file.type||"application/octet-stream",sizeLabel:formatFileSize(file.size),url:data.file.url,savedAt:Date.now()};
      addSavedUpload(saved);
      if(uploadShouldAttachToChat)pendingChatAttachments.push({id:saved.id,name:saved.name,mimeType:saved.mimeType,url:saved.url});
      completed+=1;
      renderPendingAttachments();updateComposerControls();
      setUploadFeedback(uploadShouldAttachToChat?`${file.name} ready to send.`:`${file.name} saved successfully.`);
    }catch(error){
      setUploadFeedback(`${file.name}: ${error.message||"Upload failed. Check connection and Cloudinary setup."}`,true);
    }
  }
  uploadShouldAttachToChat=false;
  setTimeout(()=>{const el=document.getElementById("uploadStatus");if(el&&!el.classList.contains("upload-error"))el.classList.add("hidden");},3200);
}

document.getElementById("fileUploadInput")?.addEventListener("change", e => uploadSelectedFiles(e.target.files, "files"));
document.getElementById("photoUploadInput")?.addEventListener("change", e => uploadSelectedFiles(e.target.files, "photos"));
document.addEventListener("click", event => { if (!event.target.closest(".composer-wrap")) closeAttachMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") { closeAttachMenu(); if (window.matchMedia("(max-width:760px)").matches) closeDrawer(); } });

/* Server-authoritative, transparent event wallet. Prize ordering is fixed, never random. */
const DEFAULT_EVENT_WALLET = { coins:0, vouchers:0, diamonds:0, spins:0, diamondSpins:0 };
let eventWallet = {...DEFAULT_EVENT_WALLET};
let eventWheelMode = "coins";
let wheelAnimating = false;
const COIN_REWARD_SEQUENCE = [5,10,20,30,40,50,100,200,300,500];
const DIAMOND_REWARD_SEQUENCE = [1,1,2,1,2,1,5,2,1,2,1,100];
const WHEEL_CONFIG = {
  coins:{title:"Spin for Coins",eyebrow:"COIN REWARDS",subtitle:"One earned voucher unlocks one spin. The reward sequence is fixed and published.",track:COIN_REWARD_SEQUENCE.map(v=>`${v.toLocaleString()} Coins`),spinLabel:"SPIN WITH 1 VOUCHER",note:"Each voucher advances the published sequence by one position. No hidden odds."},
  lite:{title:"Spin for Lite",eyebrow:"LITE PROGRESS",subtitle:"Preview animation only. Lite entitlement is not randomly awarded; subscription activation needs verified eligibility.",track:["Lite progress +1","5 Coins preview","Lite progress +1","10 Coins preview","Eligibility review"],spinLabel:"PREVIEW SPIN",note:"Progress outcomes are fixed. This preview cannot activate an EST Lite plan."},
  pro:{title:"Spin for Pro",eyebrow:"PRO PROGRESS",subtitle:"Preview animation only. Pro entitlement is based on transparent eligibility, not hidden odds.",track:["Pro progress +1","10 Coins preview","Pro progress +1","20 Coins preview","Eligibility review"],spinLabel:"PREVIEW SPIN",note:"Progress outcomes are fixed. This preview cannot activate an EST Pro plan."},
  plus:{title:"Spin for Plus",eyebrow:"PLUS PROGRESS",subtitle:"Preview animation only. Plus entitlement is based on transparent eligibility, not hidden odds.",track:["Plus progress +1","20 Coins preview","Plus progress +1","30 Coins preview","Eligibility review"],spinLabel:"PREVIEW SPIN",note:"Progress outcomes are fixed. This preview cannot activate an EST Plus plan."},
  diamonds:{title:"Spin for Diamonds",eyebrow:"DIAMOND REWARDS",subtitle:"Each spin costs 1,000 Coins. The exact reward order is published below; no hidden odds.",track:DIAMOND_REWARD_SEQUENCE.map(v=>`${v} ${v===1?"Diamond":"Diamonds"}`),spinLabel:"SPIN FOR 1,000 COINS",note:"Every result follows the published sequence. The 100-Diamond prize is at position 12."}
};
function showCurrencyInfo(kind = "coins") {
  const normalized = ["coins", "diamonds", "vouchers"].includes(kind) ? kind : "coins";
  window.currentCurrencyInfo = normalized;
  const page = document.getElementById("page-currency");
  if (page && !page.classList.contains("active")) { showPage("currency"); return; }
  const content = {
    coins: { title:"About Coins", icon:"◉", html:"<p><b>Coins are the regular event currency.</b></p><p>Use them for the published Spin for Coins track and the published Spin for Diamonds track (1,000 Coins per diamond spin). The EST Store can use Coins for cosmetic items once its catalogue is launched.</p><p>Coins are not a direct subscription payment. Use Diamonds for the fixed-price subscription route when that entitlement flow is enabled.</p>" },
    diamonds: { title:"About Diamonds", icon:"◆", html:"<p><b>Diamonds are the premium event currency.</b></p><p>The intended main uses are eligible EST AI subscriptions and future AI-upgrade features. The diamond wheel has a published, fixed 12-spin sequence, with the 100-Diamond reward at position 12.</p><p>Subscription benefits must be granted and checked by the server; a frontend animation alone never activates a plan.</p>" },
    vouchers: { title:"About Vouchers", icon:"▤", html:"<p><b>Vouchers unlock Spins for Coins.</b></p><p>Claim earned vouchers from your Mailbox, then use one voucher for one coin-wheel spin. Your result follows the published reward sequence and is credited by the server.</p><p>Vouchers cannot be used to place bets in the Seven Up / Down practice game.</p>" }
  };
  const selected = content[normalized];
  const title = document.getElementById("currencyTitle"), icon = document.getElementById("currencyIcon"), desc = document.getElementById("currencyDescription");
  if (title) title.textContent = selected.title; if (icon) icon.textContent = selected.icon; if (desc) desc.innerHTML = selected.html;
  const ids = {coins:"currencyTabCoins",diamonds:"currencyTabDiamonds",vouchers:"currencyTabVouchers"};
  Object.entries(ids).forEach(([key,id])=>{const btn=document.getElementById(id);if(btn){btn.classList.toggle("active",key===normalized);btn.setAttribute("aria-selected",String(key===normalized));}});
}
function selectRoyaleCategory(button, name) {
  document.querySelectorAll(".royale-category").forEach(el=>el.classList.toggle("selected",el===button));
  const descriptions = {
    "Incubator":"Incubator previews show exclusive skin concepts and visual effects only. No item is granted by a preview.",
    "Weapon Royale":"Weapon Royale is a planned cosmetic showcase. Rewards will be listed and rules published before launch.",
    "Diamond Royale":"Diamond Royale is not activated yet. It will require a verified catalogue and disclosed entry rules.",
    "Gold Royale":"Gold Royale is a planned cosmetic showcase. No hidden chance or paid reward is active here.",
    "Fantasy Royale":"Fantasy Royale is a planned collection of original fantasy-style cosmetics, separate from any existing game's protected assets."
  };
  const node=document.getElementById("royaleCategoryDescription");if(node)node.textContent=descriptions[name]||"Preview only.";
  const status=document.getElementById("incubatorPreviewStatus");if(status)status.textContent=`${name} selected — preview mode only, no reward awarded.`;
}
function playCratePreviewSound() {
  try { const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;const ctx=new Ctx();const now=ctx.currentTime;[330,440,660].forEach((hz,i)=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="triangle";osc.frequency.setValueAtTime(hz,now+i*.12);gain.gain.setValueAtTime(.0001,now+i*.12);gain.gain.exponentialRampToValueAtTime(.035,now+i*.12+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+i*.12+.23);osc.connect(gain);gain.connect(ctx.destination);osc.start(now+i*.12);osc.stop(now+i*.12+.24);});setTimeout(()=>ctx.close().catch(()=>{}),800);}catch(_){}
}
function playIncubatorPreview() {
  const crate=document.getElementById("incubatorCrate"), stage=document.getElementById("incubatorStage"), status=document.getElementById("incubatorPreviewStatus");
  if(!crate||!stage)return;
  stage.classList.remove("opening");
  void crate.offsetWidth;
  stage.classList.add("opening");
  if(status)status.textContent="Opening animation preview… no item or subscription will be granted.";
  playCratePreviewSound();
  setTimeout(()=>{stage.classList.remove("opening");if(status)status.textContent="Preview complete — no reward was awarded.";},1900);
}
let diceSelected = null, diceScore = 0, diceTimer = null, diceAudio = null;
function chooseDicePick(pick) {
  if (!document.getElementById("diceStartBtn")?.disabled) { toast("Start a round before choosing a prediction."); return; }
  diceSelected = String(pick);
  document.querySelectorAll(".dice-choice,.dice-number-pick").forEach(btn=>btn.classList.toggle("selected",btn.dataset.pick===diceSelected));
  document.getElementById("diceResult").textContent = "Prediction locked in for this round.";
}
function playDiceTick() {
  try { const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;if(!diceAudio||diceAudio.state==="closed")diceAudio=new Ctx();const ctx=diceAudio;if(ctx.state==="suspended")ctx.resume();const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="sine";osc.frequency.value=740;gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.022,ctx.currentTime+.01);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.07);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.08);}catch(_){}
}
function startDiceRound() {
  if(diceTimer)return;
  diceSelected=null;document.querySelectorAll(".dice-choice,.dice-number-pick").forEach(btn=>btn.classList.remove("selected"));
  const start=document.getElementById("diceStartBtn"), status=document.getElementById("diceRoundStatus"), timer=document.getElementById("diceTimer"), result=document.getElementById("diceResult");
  let remaining=10; start.disabled=true;start.textContent="Round in progress…";status.textContent="PREDICT NOW";timer.textContent=remaining;result.textContent="Choose one prediction. This round uses score only.";
  diceTimer=setInterval(()=>{remaining-=1;timer.textContent=Math.max(0,remaining);playDiceTick();if(remaining<=0){clearInterval(diceTimer);diceTimer=null;status.textContent="STOP PREDICTING";document.getElementById("diceRoundStatus")?.classList.add("stopped");result.textContent="No more predictions — rolling dice…";setTimeout(rollPracticeDice,500);}},1000);
}
function rollPracticeDice() {
  const first=1+Math.floor(Math.random()*6),second=1+Math.floor(Math.random()*6),total=first+second;
  const one=document.getElementById("dieOne"),two=document.getElementById("dieTwo"),status=document.getElementById("diceRoundStatus"),result=document.getElementById("diceResult"),start=document.getElementById("diceStartBtn");
  const rollStage = document.querySelector(".dice-roll-stage");
  one.textContent="⚄";two.textContent="⚄";rollStage?.classList.add("rolling");one.classList.add("rolling");two.classList.add("rolling");
  setTimeout(()=>{
    rollStage?.classList.remove("rolling");one.classList.remove("rolling");two.classList.remove("rolling");one.textContent=String(first);two.textContent=String(second);
    const label=total===7?"7 wins":`${total} wins`;let add=0;
    if(diceSelected===String(total))add=3;else if((diceSelected==="low"&&total>=2&&total<=6)||(diceSelected==="high"&&total>=8&&total<=12)||(diceSelected==="seven"&&total===7))add=diceSelected==="seven"?3:1;
    diceScore+=add;document.getElementById("diceScore").textContent=String(diceScore);status.textContent=label.toUpperCase();result.textContent=add?`${label}. Correct prediction — +${add} score.`:`${label}. ${diceSelected?"Not this time — no score added.":"No prediction was chosen — no score added."}`;start.disabled=false;start.textContent="Start 10-second round";document.getElementById("diceRoundStatus")?.classList.remove("stopped");
  },1200);
}
function resetDiceScore(){diceScore=0;document.getElementById("diceScore").textContent="0";document.getElementById("diceResult").textContent="Score reset. Start a new round when ready.";}

async function refreshEventWallet() {
  updateWalletCounters();
  if (!currentUser) return;
  try { const data = await apiFetch("/api/events/state"); eventWallet = {...DEFAULT_EVENT_WALLET, ...(data.wallet || {})}; updateWalletCounters(); renderEventWheel(); }
  catch (error) { console.warn("Event wallet unavailable:",error.message); }
}
function updateWalletCounters() {
  const mapping = {coinBalance:"coins",voucherBalance:"vouchers",diamondBalance:"diamonds",homeCoinBalance:"coins",homeVoucherBalance:"vouchers",homeDiamondBalance:"diamonds"};
  Object.entries(mapping).forEach(([id,key])=>{const el=document.getElementById(id);if(el)el.textContent=Number(eventWallet[key]||0).toLocaleString();});
}
let mailboxCache = [];
async function recordMailboxVisit() {
  if (!currentUser || isGuestUser()) return;
  try {
    await apiFetch("/api/mailbox/visit", { method:"POST", body:JSON.stringify({}) });
    await loadMailbox();
  } catch (error) { console.warn("Daily mailbox rewards could not sync:", error.message); }
}
function mailboxRewardLabel(rewards = {}) {
  const parts = [];
  if (Number(rewards.coins) > 0) parts.push(`${Number(rewards.coins)} Coins`);
  if (Number(rewards.diamonds) > 0) parts.push(`${Number(rewards.diamonds)} Diamond${Number(rewards.diamonds) === 1 ? "" : "s"}`);
  if (Number(rewards.vouchers) > 0) parts.push(`${Number(rewards.vouchers)} Voucher${Number(rewards.vouchers) === 1 ? "" : "s"}`);
  if (rewards.plan) parts.push(`${String(rewards.plan).toUpperCase()} for ${Number(rewards.days)||0} days`);
  return parts.join(" + ") || "Activity notice";
}
async function loadMailbox(skipAutoClaim = false) {
  const list = document.getElementById("mailboxList");
  if (!list) return;
  if (!currentUser) { list.innerHTML = '<p class="muted">Sign in to view your mailbox.</p>'; return; }
  list.innerHTML = '<p class="muted">Loading mailbox…</p>';
  try {
    const data = await apiFetch("/api/mailbox");
    mailboxCache = Array.isArray(data.messages) ? data.messages : [];
    const toggle = document.getElementById("mailboxAutoClaimToggle");
    if (toggle) toggle.checked = Boolean(data.autoClaim);
    const streak = document.getElementById("mailboxStreak");
    if (streak) streak.innerHTML = `Daily login streak: <b>${Number(data.streak)||0} day${Number(data.streak)===1?"":"s"}</b><small>Active days in the last year: ${Number(data.yearDays)||0}/365</small>`;
    if (data.guest) { list.innerHTML = '<p class="muted">Guest mailboxes are temporary. Sign in to keep reward history.</p>'; return; }
    if (!skipAutoClaim && data.autoClaim) {
      const pending = mailboxCache.filter(item => !item.claimed && item.kind !== "notice");
      if (pending.length) {
        for (const item of pending) { try { await apiFetch(`/api/mailbox/${encodeURIComponent(item.id)}/claim`, { method:"POST", body:JSON.stringify({}) }); } catch (error) { console.warn("Auto-claim skipped:", error.message); } }
        await refreshEventWallet();
        return loadMailbox(true);
      }
    }
    renderMailboxList();
  } catch (error) {
    list.innerHTML = `<p class="upload-error">${escapeText(error.message || "Mailbox unavailable. Check the backend deployment.")}</p>`;
  }
}
function renderMailboxList() {
  const list = document.getElementById("mailboxList"); if (!list) return;
  if (!mailboxCache.length) { list.innerHTML = '<p class="muted">Your mailbox is empty.</p>'; return; }
  list.innerHTML = mailboxCache.map(item => {
    const label = mailboxRewardLabel(item.rewards || {});
    const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "New";
    return `<article class="mail-item ${item.read ? "is-read" : ""} ${item.claimed ? "is-claimed" : ""}" data-message-id="${escapeText(item.id)}"><button class="mail-open-btn" type="button"><span class="mail-icon">${item.kind === "subscription" ? "✦" : item.kind === "currency" ? "🎁" : "✉"}</span><span class="mail-copy"><b>${escapeText(item.title)}</b><small>${escapeText(date)} · ${escapeText(label)}</small><span>${escapeText(item.body)}</span></span><span class="mail-chevron">${item.read ? "✓" : "›"}</span></button>${item.kind !== "notice" && !item.claimed ? `<button class="mail-claim-btn" type="button">Claim reward</button>` : `<span class="mail-status">${item.claimed ? "Claimed" : "Notice"}</span>`}</article>`;
  }).join("");
  list.querySelectorAll(".mail-open-btn").forEach(btn => btn.addEventListener("click", () => openMailboxMessage(btn.closest("[data-message-id]")?.dataset.messageId)));
  list.querySelectorAll(".mail-claim-btn").forEach(btn => btn.addEventListener("click", () => claimMailboxReward(btn.closest("[data-message-id]")?.dataset.messageId, btn)));
}
async function openMailboxMessage(id) {
  const item = mailboxCache.find(x => x.id === id); if (!item) return;
  if (!item.read) {
    try { await apiFetch(`/api/mailbox/${encodeURIComponent(id)}/read`, { method:"POST", body:JSON.stringify({}) }); item.read = true; }
    catch (error) { console.warn("Mailbox read state could not save:", error.message); }
  }
  renderMailboxList();
}
async function claimMailboxReward(id, button) {
  if (button) { button.disabled = true; button.textContent = "Claiming…"; }
  try {
    const data = await apiFetch(`/api/mailbox/${encodeURIComponent(id)}/claim`, { method:"POST", body:JSON.stringify({}) });
    const claimed = mailboxCache.find(x => x.id === id); if (claimed) claimed.claimed = true;
    if (data.message?.rewards?.plan) {
      localStorage.setItem("est-current-plan", String(data.message.rewards.plan)); updateBadge();
    }
    await refreshEventWallet(); await loadProfile(); await loadMailbox(true);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = "Claim reward"; }
    toast(error.message || "Reward could not be claimed.");
  }
}
async function setMailboxAutoClaim(enabled) {
  if (!currentUser) return toast("Sign in to change mailbox settings.");
  try { await apiFetch("/api/mailbox/auto-claim", { method:"POST", body:JSON.stringify({ enabled:Boolean(enabled) }) }); await loadMailbox(); }
  catch (error) { toast(error.message || "Mailbox setting could not be saved."); }
}
async function recordMailboxNotice(type) {
  if (!currentUser) return;
  try { await apiFetch("/api/mailbox/notice", { method:"POST", body:JSON.stringify({ type }) }); }
  catch (error) { console.warn("Activity notice could not save:", error.message); }
}
let presenceTimer = null;
function startEventPresence() {
  stopEventPresence();
  if (!currentUser) return;
  const ping = async () => {
    if (!currentUser || document.visibilityState !== "visible") return;
    try { const data = await apiFetch("/api/events/presence", {method:"POST",body:JSON.stringify({})}); if(data.wallet){eventWallet={...DEFAULT_EVENT_WALLET,...data.wallet};updateWalletCounters();renderEventWheel();} }
    catch (error) { console.warn("Presence heartbeat unavailable:",error.message); }
  };
  ping(); presenceTimer = setInterval(ping, 60000);
  document.addEventListener("visibilitychange", handlePresenceVisibility);
}
function handlePresenceVisibility() { if (document.visibilityState === "visible") { if (currentUser) startEventPresence(); } }
function stopEventPresence() { if(presenceTimer)clearInterval(presenceTimer);presenceTimer=null;document.removeEventListener("visibilitychange",handlePresenceVisibility); }
function selectEventWheel(mode) {
  if (!WHEEL_CONFIG[mode]) return;
  eventWheelMode=mode;
  const result=document.getElementById("wheelResult");if(result)result.textContent=mode==="coins"?"Your next fixed reward will appear here.":"Preview mode: no subscription or diamond balance will be changed.";
  document.querySelectorAll("[data-wheel]").forEach(b=>b.classList.toggle("active",b.dataset.wheel===mode));
  renderEventWheel();
}
function polarPoint(angleDeg, radius, size=300) { const a=(angleDeg-90)*Math.PI/180; return {x:size/2+radius*Math.cos(a),y:size/2+radius*Math.sin(a)}; }
function renderEventWheel() {
  const wheel=document.getElementById("eventWheel");if(!wheel)return;
  const conf=WHEEL_CONFIG[eventWheelMode]||WHEEL_CONFIG.coins;
  document.getElementById("wheelTitle").textContent=conf.title;
  document.getElementById("wheelEyebrow").textContent=conf.eyebrow;
  document.getElementById("wheelSubtitle").textContent=conf.subtitle;
  document.getElementById("wheelTrackNote").textContent=conf.note;
  const btn=document.getElementById("wheelSpinBtn");btn.textContent=conf.spinLabel;
  const noCoinVoucher = eventWheelMode === "coins" && eventWallet.vouchers < 1;
  const noDiamondCoins = eventWheelMode === "diamonds" && eventWallet.coins < 1000;
  btn.disabled = wheelAnimating || noCoinVoucher || noDiamondCoins || !["coins","diamonds"].includes(eventWheelMode) && wheelAnimating;
  if (eventWheelMode === "diamonds" && noDiamondCoins) btn.title = "You need 1,000 Coins for this spin."; else btn.removeAttribute("title");
  const prizes=conf.track, n=prizes.length, step=360/n;
  wheel.innerHTML="";
  const svgNS="http://www.w3.org/2000/svg", svg=document.createElementNS(svgNS,"svg");svg.setAttribute("viewBox","0 0 300 300");svg.setAttribute("aria-hidden","true");
  const colors=["#7b2e3b","#983b48","#62232e","#3b1a21","#a24651","#70313a","#5b202a","#a95b61","#462027","#89323e"];
  prizes.forEach((label,i)=>{const start=i*step, end=(i+1)*step, p1=polarPoint(start,139),p2=polarPoint(end,139); const path=document.createElementNS(svgNS,"path");const large=step>180?1:0;path.setAttribute("d",`M150 150 L${p1.x} ${p1.y} A139 139 0 ${large} 1 ${p2.x} ${p2.y} Z`);path.setAttribute("fill",colors[i%colors.length]);path.setAttribute("stroke","#efc86c");path.setAttribute("stroke-width","1.5");svg.appendChild(path);
    const mid=start+step/2, pt=polarPoint(mid,91); const text=document.createElementNS(svgNS,"text"); text.setAttribute("x",pt.x);text.setAttribute("y",pt.y);text.setAttribute("fill","#fff");text.setAttribute("font-size",n>9?"8.5":"10");text.setAttribute("font-weight","800");text.setAttribute("text-anchor","middle");text.setAttribute("dominant-baseline","middle");let rot=mid; if(mid>90&&mid<270)rot+=180;text.setAttribute("transform",`rotate(${rot} ${pt.x} ${pt.y})`); text.textContent=label.length>22?label.slice(0,20)+"…":label;svg.appendChild(text);
  });
  const rim=document.createElementNS(svgNS,"circle");rim.setAttribute("cx","150");rim.setAttribute("cy","150");rim.setAttribute("r","144");rim.setAttribute("fill","none");rim.setAttribute("stroke","#f3ce71");rim.setAttribute("stroke-width","5");svg.appendChild(rim);wheel.appendChild(svg);
  const track=document.getElementById("wheelRewardTrack"); track.innerHTML=prizes.map((v,i)=>`<li class="${eventWheelMode==="coins"&&i===Number(eventWallet.spins||0)%prizes.length?"next-reward":""}"><span>${i+1}</span>${escapeText(v)}</li>`).join("");
}
function showWheelRules() { const c=WHEEL_CONFIG[eventWheelMode]; toast(eventWheelMode==="coins"?`${c.note} Voucher spins only; ad spins wait for verified ad-network rewards.`:c.note); }
function spinVisualWheel(targetIndex, after) {
  const wheel=document.getElementById("eventWheel"); if(!wheel)return after();
  wheelAnimating=true;document.getElementById("wheelSpinBtn").disabled=true;wheel.classList.add("spinning");
  const count=(WHEEL_CONFIG[eventWheelMode].track||[]).length;const segment=360/count;
  const prior=Number(wheel.dataset.rotation||0);const target=((360-(targetIndex*segment+segment/2))%360);const delta=((target-(prior%360)+360)%360);const turns=5*360+delta;const end=prior+turns;
  wheel.style.transform=`rotate(${end}deg)`;
  wheel.dataset.rotation=String(end%360);
  wheel.addEventListener("transitionend",function done(){wheel.removeEventListener("transitionend",done);wheel.classList.remove("spinning");wheelAnimating=false;after();},{once:true});
  // Fallback for browsers that do not emit transitionend.
  setTimeout(()=>{if(wheelAnimating){wheel.classList.remove("spinning");wheelAnimating=false;after();}},5600);
}
async function spinEventWheel() {
  if (wheelAnimating) return;
  if (!["coins", "diamonds"].includes(eventWheelMode)) {
    const conf=WHEEL_CONFIG[eventWheelMode];
    const prior=Number(sessionStorage.getItem(`est-wheel-preview-${eventWheelMode}`)||0), prizes=conf.track;
    sessionStorage.setItem(`est-wheel-preview-${eventWheelMode}`,String(prior+1));
    spinVisualWheel(prior%prizes.length,()=>{document.getElementById("wheelResult").textContent=`Preview only: ${prizes[prior%prizes.length]}. No subscription was granted.`;renderEventWheel();});
    return;
  }
  if (!currentUser) return toast("Sign in to use your verified event wallet.");
  if (eventWheelMode === "coins" && Number(eventWallet.vouchers||0)<1) return toast("You need an earned voucher for this spin.");
  if (eventWheelMode === "diamonds" && Number(eventWallet.coins||0)<1000) return toast("You need 1,000 Coins for a diamond spin.");
  primeEventAudio();
  const kind = eventWheelMode;
  const button=document.getElementById("wheelSpinBtn");button.disabled=true;button.textContent="VERIFYING SPIN…";
  try {
    const data=await apiFetch("/api/events/spin",{method:"POST",body:JSON.stringify({kind})});
    const amount=Number(data.reward?.amount||0), targetIndex=Math.max(0,Number(data.reward?.sequencePosition||1)-1);
    spinVisualWheel(targetIndex,()=>{
      eventWallet={...DEFAULT_EVENT_WALLET,...(data.wallet||{})};updateWalletCounters();
      const label = kind === "diamonds" ? `${amount.toLocaleString()} Diamond${amount===1?"":"s"}` : `${amount.toLocaleString()} EST Coins`;
      document.getElementById("wheelResult").textContent=`Reward confirmed: +${label}. Your balance is updated.`;
      showRewardPopup(amount, amount >= 100, kind);
      renderEventWheel();
    });
  } catch(error) {
    document.getElementById("wheelResult").textContent=`Spin not credited: ${error.message}.`;
    toast(error.message||"Spin could not be verified.");renderEventWheel();
  }
}
let eventAudioContext = null;
function primeEventAudio() {
  try { const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return; if(!eventAudioContext||eventAudioContext.state==="closed")eventAudioContext=new Ctx(); if(eventAudioContext.state==="suspended")eventAudioContext.resume(); } catch(_) {}
}
function playRewardFx(grandPrize = false) {
  if (localStorage.getItem("est-event-effects") === "off") return;
  if (grandPrize) { try { if (navigator.vibrate) navigator.vibrate([70, 35, 110, 40, 160]); } catch (_) {} }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    if (!eventAudioContext || eventAudioContext.state === "closed") eventAudioContext = new Ctx();
    const ctx = eventAudioContext;
    const notes = grandPrize ? [523.25,659.25,783.99,1046.5] : [587.33,783.99];
    const begin = () => {
      const now = ctx.currentTime;
      notes.forEach((hz, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.setValueAtTime(hz, now + i * (grandPrize ? .105 : .09));
        const at = now + i * (grandPrize ? .105 : .09);
        gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(grandPrize ? .075 : .05, at + .018); gain.gain.exponentialRampToValueAtTime(.0001, at + (grandPrize ? .22 : .16));
        osc.connect(gain); gain.connect(ctx.destination); osc.start(at); osc.stop(at + (grandPrize ? .24 : .18));
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(begin).catch(() => {}); else begin();
  } catch (_) {}
}
function showRewardPopup(amount, grandPrize = false, kind = "coins") {
  const overlay = document.getElementById("rewardOverlay"); if (!overlay) return;
  document.getElementById("rewardTitle").textContent = grandPrize ? "Grand Prize Unlocked!" : (kind === "diamonds" ? "You earned EST Diamonds!" : "You earned EST Coins!");
  document.getElementById("rewardAmount").textContent = `+${Number(amount).toLocaleString()} EST ${kind === "diamonds" ? (Number(amount) === 1 ? "Diamond" : "Diamonds") : "Coins"}`;
  document.getElementById("rewardMessage").textContent = grandPrize ? "Top reward in the published sequence. Added to your balance." : "Confirmed by the server and added to your account balance.";
  const card = overlay.querySelector(".reward-card"); card?.classList.remove("reward-pop");
  overlay.classList.remove("hidden"); requestAnimationFrame(() => card?.classList.add("reward-pop"));
  playRewardFx(grandPrize);
  overlay.querySelector(".reward-claim-btn")?.focus();
}
function closeRewardPopup() { document.getElementById("rewardOverlay")?.classList.add("hidden"); }

function startVoiceCallConfirmation() { confirmVoiceCall(); }
function confirmVoiceCall() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!currentUser) return toast("Sign in before starting a voice call.");
  if (!SR) return toast("This browser does not support live voice recognition. Try Chrome on HTTPS.");
  const proceed = window.confirm("Start an EST AI voice conversation? You will tap the microphone for each turn. EST AI replies will be spoken automatically, with mic listening off during playback.");
  if (proceed) startVoiceCall();
}
let voiceCallActive = false, voiceCallRecognition = null, voiceCallBusy = false;
let voiceCallCommitTimer = null, voiceCallFinalBuffer = "", voiceCallFinalByIndex = new Map(), voiceCallInterimByIndex = new Map(), voiceCallUtterance = null;
let voiceCallStartedCue = false, voiceCallEndedCue = false, voiceCallSession = 0, voiceCallSpokenText = "";
let voiceCallAudioContext = null;
let voiceCallTimer = null, voiceCallRemainingMs = null, voiceCallRemainingStart = 0;
let voiceCallManualStop = false, voiceCallHasSpeech = false, voiceCallSilenceTimer = null, voiceCallMicStream = null, voiceCallAnalyserFrame = null;
let voiceCallMicWanted = false;
function setVoiceCallMicVisual(recording) {
  const btn = document.getElementById("voiceCallMicBtn");
  if (!btn) return;
  btn.classList.toggle("recording", Boolean(recording));
  btn.classList.toggle("muted", !recording);
  btn.setAttribute("aria-label", recording ? "Stop recording and send message" : "Start microphone");
  btn.setAttribute("aria-pressed", String(Boolean(recording)));
  // app.js can be delivered separately from the stylesheet; keep the recording
  // state visibly red even if a cached stylesheet does not yet define this class.
  if (recording) {
    btn.style.background = "#c62845";
    btn.style.borderColor = "#ff7189";
    btn.style.color = "#ffffff";
    btn.style.boxShadow = "0 0 0 5px #c628452e";
  } else {
    btn.style.removeProperty("background");
    btn.style.removeProperty("border-color");
    btn.style.removeProperty("color");
    btn.style.removeProperty("box-shadow");
  }
}
function playVoiceCallCue(kind) {
  if ((kind === "start" && voiceCallStartedCue) || (kind === "end" && voiceCallEndedCue)) return;
  if (kind === "start") voiceCallStartedCue = true; else voiceCallEndedCue = true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    if (!voiceCallAudioContext || voiceCallAudioContext.state === "closed") voiceCallAudioContext = new Ctx();
    const ctx = voiceCallAudioContext;
    const notes = kind === "start" ? [{f:440,t:0},{f:587.33,t:.11}] : [{f:587.33,t:0},{f:392,t:.11}];
    const play = () => notes.forEach(note => {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = "sine"; oscillator.frequency.setValueAtTime(note.f, ctx.currentTime + note.t);
      gain.gain.setValueAtTime(.0001, ctx.currentTime + note.t);
      gain.gain.exponentialRampToValueAtTime(.035, ctx.currentTime + note.t + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + note.t + .13);
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(ctx.currentTime + note.t); oscillator.stop(ctx.currentTime + note.t + .15);
    });
    if (ctx.state === "suspended") ctx.resume().then(play).catch(() => {}); else play();
  } catch (_) {}
}
function cancelVoiceCallOutput() {
  const synth = window.speechSynthesis;
  const shouldCancel = Boolean(voiceCallUtterance || (synth && (synth.speaking || synth.pending)));
  if (voiceCallUtterance) {
    voiceCallUtterance.onend = null;
    voiceCallUtterance.onerror = null;
    voiceCallUtterance = null;
  }
  // Don't send a cancel command to an idle speech engine; on some Android
  // browser builds it can produce a click/pop or interrupt the next utterance.
  if (shouldCancel && synth) { try { synth.cancel(); } catch (_) {} }
}
function updateVoiceQuotaDisplay(remainingOverride) {
  const el = document.getElementById("voiceCallQuota"); if (!el) return;
  if (voiceCallRemainingMs === null) { el.textContent = "Voice time: Unlimited (active Plus entitlement)"; return; }
  const remaining = Math.max(0, Number(remainingOverride ?? (voiceCallRemainingMs - (Date.now() - voiceCallRemainingStart))) || 0);
  const minutes = Math.ceil(remaining / 60000);
  const hours = Math.floor(minutes / 60), mins = minutes % 60;
  el.textContent = `Daily voice time remaining: ${hours}h ${String(mins).padStart(2,"0")}m`;
}
async function startVoiceCall() {
  if (voiceCallActive) return;
  if (!currentUser) return toast("Sign in before starting a voice call.");
  let quota;
  try { quota = await apiFetch("/api/voice/start", { method: "POST", body: JSON.stringify({}) }); }
  catch (error) { return toast(error.message || "Could not check daily voice time."); }
  if (quota.allowed === false) return toast("Daily voice limit reached. Check your subscription options.");
  voiceCallRemainingMs = quota.unlimited ? null : Number(quota.remainingMs);
  voiceCallRemainingStart = Date.now();
  voiceCallSession += 1; voiceCallActive = true; voiceCallBusy = false;
  voiceCallStartedCue = false; voiceCallEndedCue = false; voiceCallFinalBuffer = ""; voiceCallFinalByIndex = new Map(); voiceCallInterimByIndex = new Map(); voiceCallManualStop = false; voiceCallHasSpeech = false;
  if (voiceCallCommitTimer) { clearTimeout(voiceCallCommitTimer); voiceCallCommitTimer = null; }
  cancelVoiceCallOutput();
  showPage("voicecall");
  document.getElementById("voiceCallState").textContent = "Connected to EST AI chat";
  document.getElementById("voiceCallStatus").textContent = "Tap the microphone when you want to speak.";
  document.getElementById("voiceCallTranscript").textContent = "Your microphone stays off until you tap it.";
  updateVoiceQuotaDisplay();
  if (voiceCallTimer) clearInterval(voiceCallTimer);
  voiceCallTimer = setInterval(() => {
    if (!voiceCallActive || voiceCallRemainingMs === null) { updateVoiceQuotaDisplay(); return; }
    const remaining = voiceCallRemainingMs - (Date.now() - voiceCallRemainingStart);
    updateVoiceQuotaDisplay(remaining);
    if (remaining <= 0) { clearInterval(voiceCallTimer); voiceCallTimer = null; endVoiceCall().then(() => toast("Daily voice time is finished for today.")); }
  }, 1000);
  document.getElementById("voiceCallOrb")?.classList.remove("listening", "thinking", "speaking");
  setVoiceCallMicVisual(false);
  playVoiceCallCue("start");
  recordMailboxNotice("ai-call-started");
}
async function startVoiceCallMeter() {
  stopVoiceCallMeter();
  const bars = [...(document.getElementById("voiceCallWaveform")?.querySelectorAll("i") || [])];
  try {
    voiceCallMicStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!voiceCallActive || !voiceCallRecognition || !voiceCallMicWanted) { stopVoiceCallMeter(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const context = new Ctx();
    const analyser = context.createAnalyser(); analyser.fftSize = 128;
    context.createMediaStreamSource(voiceCallMicStream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const animate = () => {
      if (!voiceCallMicStream) return;
      analyser.getByteTimeDomainData(samples);
      const amplitude = samples.reduce((sum, value) => sum + Math.abs(value - 128), 0) / samples.length;
      bars.forEach((bar, index) => {
        const wave = Math.abs(Math.sin((Date.now() / 115) + index * .72));
        bar.style.height = `${Math.max(4, Math.min(34, 4 + amplitude * .9 + wave * amplitude * 1.8))}px`;
      });
      voiceCallAnalyserFrame = requestAnimationFrame(animate);
    };
    voiceCallMicStream._estAudioContext = context;
    animate();
  } catch (_) {
    document.getElementById("voiceCallStatus").textContent = "Mic permission is needed to show live audio activity.";
  }
}
function stopVoiceCallMeter() {
  if (voiceCallAnalyserFrame) cancelAnimationFrame(voiceCallAnalyserFrame);
  voiceCallAnalyserFrame = null;
  if (voiceCallMicStream) {
    voiceCallMicStream.getTracks().forEach(track => track.stop());
    try { voiceCallMicStream._estAudioContext?.close(); } catch (_) {}
    voiceCallMicStream = null;
  }
  document.getElementById("voiceCallWaveform")?.querySelectorAll("i").forEach((bar, index) => { bar.style.height = `${8 + (index % 5) * 4}px`; });
}
function startVoiceCallRecognition(preserveTranscript = false) {
  if (!voiceCallActive || voiceCallBusy || voiceCallRecognition) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { document.getElementById("voiceCallStatus").textContent = "Speech recognition isn't supported in this browser."; return; }
  try {
    const recognition = new SR();
    recognition.lang = getSpeechLanguage(); recognition.continuous = true; recognition.interimResults = true;
    voiceCallRecognition = recognition; if (!preserveTranscript) { voiceCallFinalBuffer = ""; voiceCallFinalByIndex = new Map(); voiceCallInterimByIndex = new Map(); }
    recognition.onresult = event => {
      if (!voiceCallActive || voiceCallRecognition !== recognition) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const phrase = dedupeSpeechText(result?.[0]?.transcript || "");
        if (result.isFinal) {
          if (phrase) voiceCallFinalByIndex.set(i, phrase);
          voiceCallInterimByIndex.delete(i);
        } else if (phrase) {
          voiceCallInterimByIndex.set(i, phrase);
        } else {
          voiceCallInterimByIndex.delete(i);
        }
      }
      // Keep one final transcript per browser result index. SpeechRecognition can
      // send updated events for an already-seen index; appending every event was
      // the source of repeated words/phrases in voice-call messages.
      voiceCallFinalBuffer = dedupeSpeechText([...voiceCallFinalByIndex.entries()].sort((a,b)=>a[0]-b[0]).map(([,text])=>text).join(" "));
      const interim = [...voiceCallInterimByIndex.entries()].sort((a,b)=>a[0]-b[0]).map(([,text])=>text).join(" ");
      const spoken = dedupeSpeechText([voiceCallFinalBuffer, interim].filter(Boolean).join(" "));
      if (spoken) {
        voiceCallHasSpeech = true;
        document.getElementById("voiceCallTranscript").textContent = `You: ${spoken}`;
        // Recording remains active until the user taps the mic again. Silence
        // alone must never submit a partial sentence.
      }
    };
    recognition.onerror = event => {
      if (!voiceCallActive || event.error === "no-speech" || event.error === "aborted") return;
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
      document.getElementById("voiceCallStatus").textContent = denied ? "Microphone permission was denied." : "Mic paused. Tap it to retry.";
      if (denied) {
        voiceCallMicWanted = false;
        setVoiceCallMicVisual(false);
        stopVoiceCallMeter();
        document.getElementById("voiceCallOrb")?.classList.remove("listening");
      }
    };
    recognition.onend = () => {
      if (!voiceCallActive || voiceCallBusy) { if (voiceCallRecognition === recognition) voiceCallRecognition = null; return; }
      if (!voiceCallManualStop) {
        if (voiceCallRecognition === recognition) voiceCallRecognition = null;
        if (voiceCallHasSpeech) { startVoiceCallRecognition(true); }
        return;
      }
      if (voiceCallRecognition === recognition) voiceCallRecognition = null;
      voiceCallManualStop = false;
      if (voiceCallSilenceTimer) { clearTimeout(voiceCallSilenceTimer); voiceCallSilenceTimer = null; }
      const complete = dedupeSpeechText([...voiceCallFinalByIndex.entries()].sort((a,b)=>a[0]-b[0]).map(([,text])=>text).join(" ") || voiceCallFinalBuffer);
      voiceCallFinalBuffer = ""; voiceCallFinalByIndex.clear(); voiceCallInterimByIndex.clear(); voiceCallHasSpeech = false;
      voiceCallMicWanted = false;
      setVoiceCallMicVisual(false);
      stopVoiceCallMeter();
      if (complete) {
        document.getElementById("voiceCallStatus").textContent = "Transcription ready — asking EST AI…";
        sendVoiceCallTurn(complete);
      } else {
        document.getElementById("voiceCallStatus").textContent = "Mic off. Tap the microphone to speak.";
        document.getElementById("voiceCallOrb")?.classList.remove("listening");
      }
    };
    recognition.start();
  } catch (_) {
    voiceCallRecognition = null;
    voiceCallMicWanted = false;
    setVoiceCallMicVisual(false);
    stopVoiceCallMeter();
    document.getElementById("voiceCallOrb")?.classList.remove("listening");
    document.getElementById("voiceCallStatus").textContent = "Could not start microphone. Check browser permissions.";
  }
}
function stopVoiceCallRecognition() {
  voiceCallMicWanted = false;
  if (voiceCallCommitTimer) { clearTimeout(voiceCallCommitTimer); voiceCallCommitTimer = null; }
  const recognition = voiceCallRecognition; voiceCallRecognition = null;
  if (voiceCallSilenceTimer) { clearTimeout(voiceCallSilenceTimer); voiceCallSilenceTimer = null; }
  if (recognition) { recognition.onend = null; recognition.onresult = null; try { recognition.stop(); } catch (_) {} }
}
async function sendVoiceCallTurn(spokenText) {
  const text = String(spokenText || "").trim();
  if (!voiceCallActive || voiceCallBusy || !text) return;
  const thisSession = voiceCallSession;
  voiceCallBusy = true; stopVoiceCallRecognition(); stopVoiceCallMeter(); voiceCallFinalBuffer = "";
  document.getElementById("voiceCallStatus").textContent = "Thinking…";
  document.getElementById("voiceCallTranscript").textContent = "Thinking…";
  document.getElementById("voiceCallOrb")?.classList.remove("listening", "speaking");
  document.getElementById("voiceCallOrb")?.classList.add("thinking");
  try {
    const data = await apiFetch("/api/chat", {method:"POST",body:JSON.stringify({message:text,chatId:activeChatId,language:getSpeechLanguage(),voiceCall:true,personaMode:window.EST_PERSONA_MODE||"normal"})});
    if (data.chatId) { activeChatId = data.chatId; if (isGuestUser()) guestChatIds.add(data.chatId); }
    // The backend stores both the spoken user turn and its AI reply in the same Firestore chat.
    if (!voiceCallActive || thisSession !== voiceCallSession) {
      if (activeChatId) { await loadChat(activeChatId); await loadConversations(); }
      return;
    }
    const reply = cleanAssistantText(data.message?.content || data.message || "I couldn't generate a response.");
    document.getElementById("voiceCallTranscript").textContent = `Est Ai: ${reply}`;
    document.getElementById("voiceCallStatus").textContent = "EST AI is speaking…";
    document.getElementById("voiceCallOrb")?.classList.remove("thinking", "listening");
    document.getElementById("voiceCallOrb")?.classList.add("speaking");
    if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
      // Avoid cancelling before every turn; it can create audible cut/restart artifacts on Android.
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) cancelVoiceCallOutput();
      const utterance = new SpeechSynthesisUtterance(reply);
      // Match the utterance to the actual script. Never replace Hindi's lang
      // with an arbitrary English voice language (a common cause of garbled TTS).
      const hasDevanagari = /[\u0900-\u097F]/.test(reply);
      const targetLang = hasDevanagari ? "hi-IN" : (getSpeechLanguage() === "bn-IN" ? "bn-IN" : "en-IN");
      utterance.lang = targetLang;
      utterance.rate = 0.94; utterance.pitch = 1; utterance.volume = 1;
      const availableVoices = window.speechSynthesis.getVoices() || [];
      const langPrefix = targetLang.slice(0, 2).toLowerCase();
      const matchingVoices = availableVoices.filter(v => String(v.lang || "").toLowerCase().startsWith(langPrefix));
      const voice = matchingVoices.find(v => (selectedSpokenVoice === "female" ? /female|woman|zira|samantha|karen|susan|aria|jenny|neerja|heera|priya/i : /male|man|david|mark|guy|daniel|george|ravi|prabhat/i).test(v.name)) || matchingVoices[0] || null;
      if (voice) utterance.voice = voice;
      voiceCallSpokenText = reply;
      voiceCallUtterance = utterance;
      utterance.onend = () => { if (voiceCallUtterance !== utterance) return; voiceCallUtterance = null; finishVoiceCallTurn(); };
      utterance.onerror = event => { if (voiceCallUtterance !== utterance || event.error === "canceled" || event.error === "interrupted") return; voiceCallUtterance = null; finishVoiceCallTurn(); };
      window.speechSynthesis.speak(utterance);
      // Mic is intentionally off during TTS to prevent the device hearing EST AI
      // through its own speaker and recursively replying to itself.
    } else {
      document.getElementById("voiceCallStatus").textContent = "Reply ready, but speech playback isn't supported on this device.";
      finishVoiceCallTurn();
    }
  } catch (error) {
    if (!voiceCallActive || thisSession !== voiceCallSession) return;
    document.getElementById("voiceCallTranscript").textContent = "I couldn't get a reply this time.";
    document.getElementById("voiceCallStatus").textContent = error.message || "The voice request failed.";
    finishVoiceCallTurn();
  }
}
function finishVoiceCallTurn() {
  if (!voiceCallActive) return;
  voiceCallBusy = false;
  voiceCallSpokenText = "";
  document.getElementById("voiceCallOrb")?.classList.remove("thinking", "speaking", "listening");
  document.getElementById("voiceCallStatus").textContent = "Reply finished. Tap the microphone to speak again.";
  setVoiceCallMicVisual(false);
}
function toggleVoiceCallMic() {
  if (!voiceCallActive) return;
  if (voiceCallBusy) {
    document.getElementById("voiceCallStatus").textContent = "EST AI is speaking. The mic will stay off until the reply finishes.";
    return;
  }
  if (voiceCallRecognition) {
    voiceCallManualStop = true;
    voiceCallMicWanted = false;
    document.getElementById("voiceCallStatus").textContent = "Finishing transcription…";
    try { voiceCallRecognition.stop(); } catch (_) {}
    return;
  }
  voiceCallManualStop = false;
  voiceCallHasSpeech = false;
  voiceCallFinalBuffer = "";
  voiceCallFinalByIndex.clear();
  voiceCallInterimByIndex.clear();
  voiceCallMicWanted = true;
  setVoiceCallMicVisual(true);
  document.getElementById("voiceCallStatus").textContent = "Recording — speak now. Tap the red microphone to send.";
  document.getElementById("voiceCallOrb")?.classList.remove("thinking", "speaking");
  document.getElementById("voiceCallOrb")?.classList.add("listening");
  startVoiceCallRecognition();
  startVoiceCallMeter();
}
async function endVoiceCall(options = {}) {
  const wasActive = voiceCallActive;
  voiceCallActive = false; voiceCallBusy = false; voiceCallManualStop = true; voiceCallHasSpeech = false; voiceCallMicWanted = false; voiceCallSession += 1;
  setVoiceCallMicVisual(false);
  stopVoiceCallRecognition(); stopVoiceCallMeter(); cancelVoiceCallOutput(); voiceCallFinalBuffer = "";
  if (voiceCallTimer) { clearInterval(voiceCallTimer); voiceCallTimer = null; }
  if (wasActive) {
    playVoiceCallCue("end"); recordMailboxNotice("ai-call-ended");
    try { const quota = await apiFetch("/api/voice/end", { method: "POST", body: JSON.stringify({}) }); voiceCallRemainingMs = quota.unlimited ? null : Number(quota.remainingMs); voiceCallRemainingStart = Date.now(); } catch (error) { console.warn("Voice usage could not sync:", error.message); }
  }
  document.getElementById("voiceCallOrb")?.classList.remove("listening", "thinking", "speaking");
  document.getElementById("voiceCallState").textContent = "Call ended";
  if (!options.navigate) showPage("chat");
  else if (!options.keepCurrentPage) { pages.forEach(p => document.getElementById(`page-${p}`)?.classList.remove("active")); document.getElementById("page-chat")?.classList.add("active"); }
  // Server messages are durable; reload them so every call turn is visible in the normal chat.
  if (activeChatId && currentUser) { await loadChat(activeChatId); await loadConversations(); }
}

let activeSpeech = null;
let selectedSpokenVoice = localStorage.getItem("est-spoken-voice") || "female";
function setSpokenVoice(value) {
  selectedSpokenVoice = value === "male" ? "male" : "female";
  localStorage.setItem("est-spoken-voice", selectedSpokenVoice);
  toast(`${selectedSpokenVoice === "female" ? "Female" : "Male"} spoken voice selected`);
}
function findSpokenVoice() {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const preferred = voices.filter(v => /en|hi|bn/i.test(v.lang || ""));
  const genderPattern = selectedSpokenVoice === "female" ? /female|woman|zira|samantha|karen|susan|aria|jenny|neerja|heera|priya/i : /male|man|david|mark|guy|daniel|george|ravi|prabhat/i;
  return preferred.find(v => genderPattern.test(v.name)) || voices.find(v => genderPattern.test(v.name)) || preferred[0] || voices[0] || null;
}
function setSpeechProgress(el, percent, label) {
  const player = el?.querySelector(".speech-player"); if (!player) return;
  player.classList.remove("hidden");
  const range = player.querySelector(".speech-seek"); if (range) range.value = String(Math.max(0, Math.min(100, percent)));
  const time = player.querySelector(".speech-time"); if (time && label) time.textContent = label;
}
function speakFrom(messageEl, startIndex=0) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return toast("Speech playback is not supported in this browser.");
  const text = getMessageText(messageEl); if (!text) return toast("There is no response to read aloud.");
  window.speechSynthesis.cancel();
  const safeStart = Math.max(0, Math.min(text.length - 1, startIndex));
  const state = { el: messageEl, text, startIndex: safeStart, utterance: null, paused: false };
  activeSpeech = state;
  const utterance = new SpeechSynthesisUtterance(text.slice(safeStart)); state.utterance = utterance;
  utterance.lang = /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN"; utterance.rate = 1;
  const voice = findSpokenVoice(); if (voice) { utterance.voice = voice; utterance.lang = voice.lang || utterance.lang; }
  setSpeechProgress(messageEl, safeStart / text.length * 100, "Playing");
  utterance.onboundary = event => {
    if (activeSpeech !== state || !text.length) return;
    const pos = Math.min(text.length, safeStart + (event.charIndex || 0));
    setSpeechProgress(messageEl, pos / text.length * 100, "Playing");
  };
  utterance.onend = () => { if (activeSpeech === state) { setSpeechProgress(messageEl, 100, "Finished"); activeSpeech = null; const toggle = messageEl.querySelector(".speech-toggle"); if (toggle) toggle.textContent = "▶"; } };
  utterance.onerror = () => { if (activeSpeech === state) { setSpeechProgress(messageEl, safeStart / text.length * 100, "Playback stopped"); activeSpeech = null; } };
  window.speechSynthesis.speak(utterance);
  const toggle = messageEl.querySelector(".speech-toggle"); if (toggle) toggle.textContent = "Ⅱ";
}
function toggleSpeechForMessage(messageEl) {
  if (activeSpeech?.el === messageEl && window.speechSynthesis?.speaking) return togglePauseResume(messageEl);
  speakFrom(messageEl, 0);
}
function togglePauseResume(messageEl) {
  if (!window.speechSynthesis) return;
  if (activeSpeech?.el !== messageEl) return speakFrom(messageEl, 0);
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume(); activeSpeech.paused = false;
    const toggle = messageEl.querySelector(".speech-toggle"); if (toggle) toggle.textContent = "Ⅱ";
    setSpeechProgress(messageEl, Number(messageEl.querySelector(".speech-seek")?.value || 0), "Playing");
  } else if (window.speechSynthesis.speaking) {
    window.speechSynthesis.pause(); activeSpeech.paused = true;
    const toggle = messageEl.querySelector(".speech-toggle"); if (toggle) toggle.textContent = "▶";
    setSpeechProgress(messageEl, Number(messageEl.querySelector(".speech-seek")?.value || 0), "Paused");
  } else speakFrom(messageEl, 0);
}
function stopSpeech(messageEl) {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (activeSpeech?.el === messageEl) activeSpeech = null;
  const toggle = messageEl.querySelector(".speech-toggle"); if (toggle) toggle.textContent = "▶";
  setSpeechProgress(messageEl, Number(messageEl.querySelector(".speech-seek")?.value || 0), "Stopped");
}
function seekSpeech(messageEl, percent) {
  const text = getMessageText(messageEl); if (!text) return;
  const index = Math.floor(Math.max(0, Math.min(100, percent)) / 100 * text.length);
  speakFrom(messageEl, index);
}
function speakLatestReply() {
  const replies = document.querySelectorAll("#messages .ai-message");
  const latest = replies[replies.length - 1];
  if (!latest) return toast("There is no reply to read aloud yet.");
  toggleSpeechForMessage(latest);
}
function testVoiceSupport() {
  const stt = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const tts = !!window.speechSynthesis;
  toast(`Browser voice support — input: ${stt ? "available" : "not available"}; speech: ${tts ? "available" : "not available"}. Not a live voice-call system.`);
}
const spokenVoiceSelect = document.getElementById("spokenVoice");
if (spokenVoiceSelect) spokenVoiceSelect.value = selectedSpokenVoice;
function setEventEffects(value){localStorage.setItem("est-event-effects",value==="off"?"off":"on");toast(value==="off"?"Reward sound and vibration turned off":"Reward sound and vibration turned on");}
const effectsSelect=document.getElementById("eventEffects");if(effectsSelect)effectsSelect.value=localStorage.getItem("est-event-effects")==="off"?"off":"on";
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { /* Refresh voice list when the device finishes loading voices. */ };


// Show previously uploaded media metadata stored by this browser.
renderSavedUploads();


/* Secret-code UI handlers are included here too so app.js carries the feature logic. */
/* Code validation is server-side. Private code strings are configured only in Render env vars. */
async function applyPersonalityCode(){
  const input=document.getElementById('personalityCodeInput');
  const code=(input.value||'').trim();
  const normalized=code.toUpperCase().replace(/\s+/g,' ');
  const status=document.getElementById('personalityModeStatus');
  const isRefreshCode=normalized==='117645';
  const effectLabels={heavenly:'Heavenly mode',angry:'Grumpy character mode',horror_mild:'Mild fictional horror',horror_intense:'Intense fictional horror',friendly:'Friendly mode',royal:'Royal mode',owner:'Creator mode'};
  if(!code){status.textContent='Enter a code first.';return;}
  if(!window.currentUserForCodes()){toast('Please sign in before activating a code');return;}
  status.textContent='Checking code…';
  try {
    const data=await window.estApiFetch('/api/chat',{method:'POST',body:JSON.stringify({message:code,chatId:window.estGetActiveChatId(),applyCode:true})});
    if(data.chatId) window.estSetActiveChatId(data.chatId);
    const modeStorage=window.EST_IS_GUEST?sessionStorage:localStorage;
    if(data.reset || isRefreshCode){
      modeStorage.removeItem('est-persona-mode');localStorage.removeItem('est-persona-mode');sessionStorage.removeItem('est-persona-mode');window.EST_PERSONA_MODE='normal';
      status.textContent='All personality effects are reset for this conversation.';toast('Personality reset');
    } else {
      const label=effectLabels[data.codeEffect]||'Private personality mode';
      window.EST_PERSONA_MODE=data.codeEffect||'normal';
      modeStorage.setItem('est-persona-mode',window.EST_PERSONA_MODE);
      status.textContent=`${label} activated for this conversation.`;toast('Personality code accepted');
      saveSecretCode(code,label);
    }
    if(data.message?.content) window.estAppendAssistantMessage(data.message.content);
    window.estRefreshConversations();
  } catch(error) {
    status.textContent=error.message||'Code not recognized or not configured on the server.';
    toast('Code was not accepted');
  }
}
function secretCodeStorage(){return window.EST_IS_GUEST ? sessionStorage : localStorage;}
function saveSecretCode(code,label){
  const storage=secretCodeStorage();
  let saved=[];try{saved=JSON.parse(storage.getItem('est-saved-codes')||'[]')}catch(_){saved=[]}
  if(!saved.some(item=>item.code===code)) saved.push({code,label});
  storage.setItem('est-saved-codes',JSON.stringify(saved));renderSavedCodes();toast(window.EST_IS_GUEST?'Code saved for this guest session only':'Code saved on this device');
}
function removeSecretCode(code){const storage=secretCodeStorage();let saved=[];try{saved=JSON.parse(storage.getItem('est-saved-codes')||'[]')}catch(_){};saved=saved.filter(item=>item.code!==code);storage.setItem('est-saved-codes',JSON.stringify(saved));renderSavedCodes();}
async function copySecretCode(code){try{await navigator.clipboard.writeText(code);toast('Copied')}catch(_){toast('Copy unavailable in this browser')}}
function renderSavedCodes(){
  const root=document.getElementById('savedSecretCodes');if(!root)return;
  const storage=secretCodeStorage();let saved=[];try{saved=JSON.parse(storage.getItem('est-saved-codes')||'[]')}catch(_){saved=[]}
  root.innerHTML='';
  if(!saved.length){root.innerHTML='<p class="muted">No saved codes yet.</p>';return;}
  saved.forEach(item=>{
    const row=document.createElement('div');row.className='saved-code-item';
    const text=document.createElement('span');const code=document.createElement('b');code.textContent=String(item.code||'');
    text.append(code,document.createTextNode(` · ${String(item.label||'Saved code')}`));
    const actions=document.createElement('span');
    const copy=document.createElement('button');copy.className='tiny';copy.type='button';copy.textContent='Copy';copy.onclick=()=>copySecretCode(String(item.code||''));
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove saved code');remove.onclick=()=>removeSecretCode(String(item.code||''));
    actions.append(copy,document.createTextNode(' '),remove);row.append(text,actions);root.appendChild(row);
  });
}
(function restorePersonality(){const saved=sessionStorage.getItem('est-persona-mode')||localStorage.getItem('est-persona-mode');if(['horror','shadow','heavenly'].includes(saved))window.EST_PERSONA_MODE=saved;renderSavedCodes();})();


/* Opt-in push setup. Requires HTTPS, notification permission, a Web Push VAPID key,
   service-worker support, Firebase Messaging enabled, and a signed-in user. */
async function setupPushNotifications() {
  if (!currentUser || isGuestUser()) return toast("Sign in to enable notifications for this account.");
  if (!("Notification" in window) || !navigator.serviceWorker) return toast("This browser does not support web push notifications.");
  const vapidKey = String(window.EST_FCM_VAPID_KEY || "").trim();
  if (!vapidKey || vapidKey.startsWith("PASTE_")) return toast("Add the Firebase Web Push certificate key as EST_FCM_VAPID_KEY in frontend/firebase-config.js first.");
  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return toast("Notification permission was not granted.");
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    if (!window.firebase?.messaging) throw new Error("Firebase Messaging SDK did not load.");
    const messaging = firebase.messaging();
    if (typeof messaging.onMessage === "function" && !window.__estMessagingListenerInstalled) {
      messaging.onMessage(payload => { const title = payload?.notification?.title || "EST AI"; const body = payload?.notification?.body || "You have a new update."; toast(`${title}: ${body}`); });
      window.__estMessagingListenerInstalled = true;
    }
    const token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
    if (!token) throw new Error("Firebase did not return a push token.");
    await apiFetch("/api/user/fcm-token", { method: "POST", body: JSON.stringify({ token }) });
    await apiFetch("/api/user/settings", { method: "PATCH", body: JSON.stringify({ notificationsEnabled: true }) });
    toast("Push notifications enabled for this signed-in account on this device.");
  } catch (error) {
    console.error("Push registration failed:", error);
    toast(error.message || "Could not enable notifications. Check VAPID/Firebase Messaging setup.");
  }
}


async function redeemPlanWithDiamonds(plan, expectedCost) {
  if (!currentUser || isGuestUser()) return toast("Sign in with a regular account to redeem a subscription.");
  if (!window.confirm(`Redeem 7 days of EST ${String(plan).toUpperCase()} for ${expectedCost} Diamonds?`)) return;
  try {
    const result = await apiFetch("/api/subscription/redeem-with-diamonds", { method: "POST", body: JSON.stringify({ plan }) });
    localStorage.setItem("est-current-plan", result.plan); updateBadge();
    await refreshEventWallet(); await loadProfile(); await loadMailbox();
    toast(`EST ${String(result.plan).toUpperCase()} activated for 7 days.`);
  } catch (error) { toast(error.message || "Subscription redemption failed."); }
}
