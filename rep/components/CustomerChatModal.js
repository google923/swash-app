const MODAL_ID = "customerChatModal";

let modalEl;
let dialogEl;
let titleEl;
let subtitleEl;
let statusEl;
let messagesEl;
let textareaEl;
let sendBtn;
let errorEl;
let formEl;
let closeBtn;

let activeConversation = null;
let keydownHandler = null;
let isLoading = false;
let isSending = false;
let shouldAutoScroll = false;

function ensureModal() {
  if (modalEl) return;

  modalEl = document.createElement("div");
  modalEl.id = MODAL_ID;
  modalEl.className = "customer-chat-modal";
  modalEl.setAttribute("hidden", "hidden");
  modalEl.innerHTML = `
    <div class="customer-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="customerChatTitle">
      <header class="customer-chat-header">
        <div class="customer-chat-header__titles">
          <h3 id="customerChatTitle">Customer communications</h3>
          <p id="customerChatSubtitle"></p>
        </div>
        <button type="button" class="customer-chat-close" data-chat-close aria-label="Close communications">&times;</button>
      </header>
      <div class="customer-chat-body">
        <div class="customer-chat-status" id="customerChatStatus"></div>
        <div class="customer-chat-messages" id="customerChatMessages" aria-live="polite"></div>
      </div>
      <form class="customer-chat-form" id="customerChatForm">
        <label class="sr-only" for="customerChatInput">Message</label>
        <textarea id="customerChatInput" placeholder="Type a message to the customer..."></textarea>
        <div class="customer-chat-actions">
          <span class="customer-chat-error" id="customerChatError" hidden></span>
          <button type="submit" class="btn btn-primary customer-chat-send" disabled>Send</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modalEl);

  dialogEl = modalEl.querySelector(".customer-chat-dialog");
  titleEl = modalEl.querySelector("#customerChatTitle");
  subtitleEl = modalEl.querySelector("#customerChatSubtitle");
  statusEl = modalEl.querySelector("#customerChatStatus");
  messagesEl = modalEl.querySelector("#customerChatMessages");
  textareaEl = modalEl.querySelector("#customerChatInput");
  sendBtn = modalEl.querySelector(".customer-chat-send");
  errorEl = modalEl.querySelector("#customerChatError");
  formEl = modalEl.querySelector("#customerChatForm");
  closeBtn = modalEl.querySelector("[data-chat-close]");

  if (formEl) {
    formEl.addEventListener("submit", handleFormSubmit);
  }
  if (textareaEl) {
    textareaEl.addEventListener("input", handleTextareaInput);
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", closeCustomerChatModal);
  }
  if (messagesEl) {
    messagesEl.addEventListener("click", handleMessagesClick, { passive: false });
  }
  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) {
      closeCustomerChatModal();
    }
  });
}

function initCustomerChatModal() {
  ensureModal();
}

function openCustomerChatModal({
  customer,
  customerId = null,
  subscribeMessages = null,
  loadMessages = null,
  onSend = null,
  contextLabel = "",
}) {
  ensureModal();
  if (!modalEl || !dialogEl) return;

  if (activeConversation?.unsubscribe) {
    try {
      activeConversation.unsubscribe();
    } catch (error) {
      console.warn("[CustomerChatModal] Failed to cleanup previous subscription", error);
    }
  }

  const resolvedCustomer = customer || {};

  activeConversation = {
    customer: resolvedCustomer,
    customerId,
    unsubscribe: null,
    onSend: typeof onSend === "function" ? onSend : null,
    messages: [],
    hasLiveSubscription: typeof subscribeMessages === "function" && Boolean(customerId),
  };

  titleEl.textContent = resolvedCustomer.name || "Customer";
  subtitleEl.textContent = buildSubtitle(resolvedCustomer);

  setError("");
  textareaEl.value = "";
  textareaEl.placeholder = "Type a message to the customer...";
  updateSendButtonState();

  modalEl.removeAttribute("hidden");
  requestAnimationFrame(() => {
    modalEl.classList.add("is-open");
  });

  bindEscapeKey();
  setLoading(true, contextLabel || "Loading messages...");
  shouldAutoScroll = true;

  if (activeConversation.hasLiveSubscription) {
    activeConversation.unsubscribe = subscribeMessages({
      customerId,
      onUpdate: handleIncomingMessages,
      onError: handleSubscriptionError,
    });
    setStatus(contextLabel || "Listening for new activity...");
  } else if (typeof loadMessages === "function") {
    Promise.resolve()
      .then(() => loadMessages(resolvedCustomer))
      .then((messages) => {
        const list = Array.isArray(messages) ? messages : [];
        handleIncomingMessages(list);
      })
      .catch((error) => {
        console.error("[CustomerChatModal] Failed to load messages", error);
        handleSubscriptionError(error);
      })
      .finally(() => {
        setLoading(false);
        focusComposer();
      });
    return;
  }

  setLoading(false);
  focusComposer();
}

function closeCustomerChatModal() {
  if (activeConversation?.unsubscribe) {
    try {
      activeConversation.unsubscribe();
    } catch (error) {
      console.warn("[CustomerChatModal] Failed to cleanup subscription", error);
    }
  }

  activeConversation = null;
  if (!modalEl) return;

  modalEl.classList.remove("is-open");
  modalEl.setAttribute("hidden", "hidden");
  unbindEscapeKey();
  setError("");
  setStatus("");

  if (messagesEl) {
    messagesEl.innerHTML = "";
  }
  if (textareaEl) {
    textareaEl.value = "";
    textareaEl.disabled = false;
  }
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = "Send";
  }
  isLoading = false;
  isSending = false;
  shouldAutoScroll = false;
}

function handleIncomingMessages(messages) {
  if (!Array.isArray(messages)) {
    return;
  }

  const normalized = messages
    .map(normalizeMessageEntry)
    .filter((entry) => entry.timestampDate)
    .sort((a, b) => a.timestampDate.getTime() - b.timestampDate.getTime());

  if (activeConversation) {
    activeConversation.messages = normalized;
  }

  const stickToBottom = shouldAutoScroll || isNearBottom();

  renderMessages(normalized);
  if (stickToBottom) {
    scrollMessagesToBottom();
  }
  shouldAutoScroll = false;

  if (normalized.length) {
    const latest = normalized[normalized.length - 1];
    setStatus(`Last update ${formatTimestamp(latest.timestampDate)}`);
  } else {
    setStatus("No communications yet");
  }

  setLoading(false);
  updateSendButtonState();
}

function handleSubscriptionError(error) {
  console.error("[CustomerChatModal] Subscription error", error);
  renderMessages([]);
  setError("Unable to load message history.");
  setStatus("Please try again later.");
}

function handleFormSubmit(event) {
  event.preventDefault();
  if (!activeConversation || !textareaEl) return;

  const message = (textareaEl.value || "").trim();
  if (!message) {
    updateSendButtonState();
    return;
  }
  if (!activeConversation.onSend) {
    setError("Sending is not available right now.");
    return;
  }

  setError("");
  setSending(true);
  setStatus("Sending message...");

  Promise.resolve()
    .then(() => activeConversation.onSend(message))
    .then(() => {
      textareaEl.value = "";
      setStatus("Message sent");
    })
    .catch((error) => {
      console.error("[CustomerChatModal] Failed to send message", error);
      setError(error?.message || "Unable to send message.");
      setStatus("Message not sent.");
    })
    .finally(() => {
      setSending(false);
      updateSendButtonState();
      focusComposer();
    });
}

function handleTextareaInput() {
  setError("");
  updateSendButtonState();
}

function handleMessagesClick(event) {
  const expandBtn = event.target.closest("[data-chat-expand]");
  if (expandBtn) {
    event.preventDefault();
    toggleMessageExpansion(expandBtn.getAttribute("data-chat-expand"));
    return;
  }

  const replyBtn = event.target.closest("[data-chat-reply]");
  if (replyBtn) {
    event.preventDefault();
    populateReply(replyBtn.getAttribute("data-chat-reply"));
  }
}

function toggleMessageExpansion(messageId) {
  if (!messageId || !messagesEl) return;
  const messageBlock = messagesEl.querySelector(`.customer-chat-message[data-message-id="${CSS.escape(messageId)}"]`);
  if (!messageBlock) return;
  const bodyEl = messageBlock.querySelector(".customer-chat-message__body");
  const expandBtn = messageBlock.querySelector("[data-chat-expand]");
  if (!bodyEl || !expandBtn) return;

  bodyEl.classList.toggle("is-expanded");
  const expanded = bodyEl.classList.contains("is-expanded");
  expandBtn.textContent = expanded ? "Show less" : "Show more";
  expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function populateReply(messageId) {
  if (!messageId || !activeConversation || !textareaEl) return;
  const message = activeConversation.messages.find((entry) => entry.id === messageId);
  if (!message) return;

  const subjectPrefix = message.subject ? `RE: ${message.subject}\n\n` : "";
  const quoteBlock = message.body ? `\n> ${message.body.replace(/\n/g, "\n> ")}\n\n` : "";
  const template = `${subjectPrefix}${quoteBlock}`.trim();

  textareaEl.value = template ? `${template}\n` : "";
  setStatus(`Replying to message from ${message.author || "customer"}`);
  updateSendButtonState();
  focusComposer();
}

function focusComposer() {
  setTimeout(() => {
    textareaEl?.focus();
  }, 120);
}

function setLoading(flag, message) {
  isLoading = flag;
  if (modalEl) {
    modalEl.classList.toggle("is-loading", flag);
  }
  if (textareaEl) {
    textareaEl.disabled = flag;
  }
  if (typeof message === "string" && message) {
    setStatus(message);
  }
  updateSendButtonState();
}

function setSending(flag) {
  isSending = flag;
  if (modalEl) {
    modalEl.classList.toggle("is-sending", flag);
  }
  updateSendButtonState();
}

function updateSendButtonState() {
  if (!sendBtn) return;
  const hasText = textareaEl ? (textareaEl.value || "").trim().length > 0 : false;
  const disabled = !hasText || isLoading || isSending;
  sendBtn.disabled = disabled;
  sendBtn.textContent = isSending ? "Sending..." : "Send";
}

function renderMessages(messages) {
  if (!messagesEl) return;

  if (!messages.length) {
    messagesEl.innerHTML = '<div class="customer-chat-empty">No communications yet. Type below to start the conversation.</div>';
    return;
  }

  const emailMessages = messages.filter((entry) => entry.type === "email");
  const otherMessages = messages.filter((entry) => entry.type !== "email");

  const sections = [];

  if (emailMessages.length) {
    sections.push('<div class="customer-chat-divider">Emails</div>');
    sections.push(renderGroupedMessageSection(emailMessages));
  }

  if (otherMessages.length) {
    sections.push('<div class="customer-chat-divider">Other communications</div>');
    sections.push(renderGroupedMessageSection(otherMessages));
  }

  messagesEl.innerHTML = sections.join("");
}

function renderGroupedMessageSection(list) {
  const groups = groupMessagesByDate(list);
  return groups
    .map(({ label, messages: dayMessages }) => {
      const dayHtml = dayMessages.map((entry) => renderMessage(entry)).join("");
      return `
        <section class="customer-chat-day">
          <header class="customer-chat-day__header">${escapeHtml(label)}</header>
          <div class="customer-chat-day__messages">${dayHtml}</div>
        </section>
      `;
    })
    .join("");
}

function scrollMessagesToBottom() {
  if (!messagesEl) return;
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function isNearBottom(threshold = 120) {
  if (!messagesEl) return false;
  const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  return distance <= threshold;
}

function buildMessageBodyHtml(message, { mode }) {
  const usePreview = mode === "preview" && message.shouldTruncate;
  const source = usePreview ? message.previewBody || "" : message.body || "";

  if (!source || !source.trim()) {
    return "<p><em>No message body provided.</em></p>";
  }

  if (message.isEmail) {
    if (message.hasHtml && !usePreview) {
      return sanitizeHtmlContent(source);
    }
    const plainText = message.hasHtml && !usePreview ? stripHtml(source) : source;
    const htmlContent = convertTextToHtml(plainText);
    const suffix = message.shouldTruncate && usePreview ? "&hellip;" : "";
    return `<p>${htmlContent}${suffix}</p>`;
  }

  const htmlContent = convertTextToHtml(source);
  const suffix = message.shouldTruncate && usePreview ? "&hellip;" : "";
  return `<p>${htmlContent}${suffix}</p>`;
}

function convertTextToHtml(text) {
  return escapeHtml(text || "").replace(/(?:\r\n|\r|\n)/g, "<br>");
}

function sanitizeHtmlContent(html) {
  if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
    return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const textValue = temp.textContent || temp.innerText || "";
  return convertTextToHtml(textValue);
}

function hasHtmlMarkup(value) {
  if (typeof value !== "string") return false;
  return /<\s*[a-z][^>]*>/i.test(value);
}

function stripHtml(value) {
  const temp = document.createElement("div");
  temp.innerHTML = value || "";
  return temp.textContent || temp.innerText || "";
}

function renderMessage(message) {
  const directionClass = message.direction === "outbound" ? "outbound" : "inbound";
  const badgeClass = `customer-chat-badge--${message.type}`;
  const author = message.author || (message.direction === "outbound" ? "Swash Team" : "Customer");
  const jobMeta = message.jobLabel ? `<span class="customer-chat-job">${escapeHtml(message.jobLabel)}</span>` : "";
  const senderEmailLine = message.fromEmail
    ? `<span class="customer-chat-message__from">${escapeHtml(message.fromEmail)}</span>`
    : "";
  const subjectBlock = message.subject
    ? `<div class="customer-chat-message__subject"><strong>${escapeHtml(message.subject)}</strong></div>`
    : "";
  const icon = message.direction === "outbound" ? "📨" : "📩";
  const bodyPreviewHtml = buildMessageBodyHtml(message, { mode: "preview" });
  const bodyFullHtml = message.shouldTruncate ? buildMessageBodyHtml(message, { mode: "full" }) : "";
  const expandButton = message.shouldTruncate
    ? `<button type="button" class="customer-chat-expander" data-chat-expand="${escapeAttr(message.id)}" aria-expanded="false">Show more</button>`
    : "";
  const replyButton = message.direction === "inbound"
    ? `<button type="button" class="customer-chat-reply" data-chat-reply="${escapeAttr(message.id)}">Reply</button>`
    : "";
  const timestamp = message.timeLabel
    ? `<span class="customer-chat-message__timestamp">${escapeHtml(message.timeLabel)}</span>`
    : "";
  const bodyMarkup = message.shouldTruncate
    ? `<div class="customer-chat-message__body">
        <div class="customer-chat-message__content customer-chat-message__content--preview">${bodyPreviewHtml}</div>
        <div class="customer-chat-message__content customer-chat-message__content--full">${bodyFullHtml}</div>
      </div>`
    : `<div class="customer-chat-message__body customer-chat-message__body--single">
        <div class="customer-chat-message__content">${bodyPreviewHtml}</div>
      </div>`;

  return `
    <article class="customer-chat-message customer-chat-message--${directionClass}" data-message-id="${escapeAttr(message.id)}">
      <header class="customer-chat-message__header">
        <span class="customer-chat-message__icon" aria-hidden="true">${icon}</span>
        <div class="customer-chat-message__meta">
          <span class="customer-chat-message__author">${escapeHtml(author)}</span>
          ${senderEmailLine}
          ${jobMeta}
        </div>
        <span class="customer-chat-badge ${badgeClass}">${escapeHtml(message.typeLabel)}</span>
      </header>
      ${subjectBlock}
      ${bodyMarkup}
      <footer class="customer-chat-message__footer">
        ${timestamp}
        ${expandButton}
        ${replyButton}
      </footer>
    </article>
  `;
}

function groupMessagesByDate(messages) {
  const map = new Map();
  messages.forEach((entry) => {
    const key = entry.dayKey;
    if (!map.has(key)) {
      map.set(key, { label: entry.dayLabel, messages: [] });
    }
    map.get(key).messages.push(entry);
  });
  return Array.from(map.values());
}

function normalizeMessageEntry(entry = {}) {
  const id = entry.id || entry.messageId || entry.docId || crypto.randomUUID();
  const timestampDate = normalizeTimestamp(entry.timestamp || entry.timestampDate || entry.createdAt);

  const jobLabel = buildJobLabel(entry.jobDate, entry.jobStatus);
  const type = (entry.type || entry.channel || "email").toLowerCase();
  const typeLabel = type === "sms" ? "SMS" : type === "note" ? "NOTE" : type === "call" ? "CALL" : type.toUpperCase();
  const rawBodyValue = typeof entry.body === "string" ? entry.body : entry.body || entry.text || "";
  const body = rawBodyValue;
  const isEmail = type === "email";
  const hasHtml = isEmail && hasHtmlMarkup(body);
  const plainBody = hasHtml ? stripHtml(body) : body;
  const plainBodyNormalized = plainBody || "";
  const shouldTruncate = plainBodyNormalized.length > 200;
  const previewSource = shouldTruncate ? plainBodyNormalized.slice(0, 200) : plainBodyNormalized;

  const dayKey = timestampDate ? timestampDate.toISOString().slice(0, 10) : "unknown";
  const fromEmail = typeof entry.from === "string" && entry.from.trim()
    ? entry.from.trim()
    : typeof entry.email === "string" && entry.email.trim()
      ? entry.email.trim()
      : typeof entry.fromEmail === "string" && entry.fromEmail.trim()
        ? entry.fromEmail.trim()
        : typeof entry.sender === "string" && entry.sender.includes("@")
          ? entry.sender.trim()
          : "";
  return {
    id,
    direction: entry.direction === "outbound" ? "outbound" : "inbound",
    subject: entry.subject || "",
    body,
    previewBody: previewSource,
    plainBody: plainBodyNormalized,
    author: entry.author || entry.from || (entry.direction === "outbound" ? "Swash Team" : "Customer"),
    fromEmail,
    timestampDate,
    dayKey,
    dayLabel: buildDayLabel(timestampDate),
    timeLabel: timestampDate ? timestampDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "",
    jobLabel,
    type,
    typeLabel,
    isEmail,
    hasHtml,
    shouldTruncate,
  };
}

function buildJobLabel(rawDate, status) {
  if (!rawDate) return "";
  const jobDate = normalizeTimestamp(rawDate);
  if (!jobDate) return "";
  const dateLabel = jobDate.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const statusLabel = status ? ` • ${status}` : "";
  return `Linked job: ${dateLabel}${statusLabel}`;
}

function buildDayLabel(date) {
  if (!date) return "Unknown date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compare = new Date(date);
  compare.setHours(0, 0, 0, 0);
  const diff = compare.getTime() - today.getTime();
  if (diff === 0) {
    return `Today • ${date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}`;
  }
  if (diff === 24 * 60 * 60 * 1000) {
    return `Tomorrow • ${date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}`;
  }
  if (diff === -24 * 60 * 60 * 1000) {
    return `Yesterday • ${date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}`;
  }
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function normalizeTimestamp(input) {
  if (!input) return null;
  if (input instanceof Date) {
    return new Date(input.getTime());
  }
  if (typeof input === "number") {
    return new Date(input);
  }
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
    return null;
  }
  if (typeof input === "object") {
    if (typeof input.toDate === "function") {
      try {
        return input.toDate();
      } catch (error) {
        console.warn("[CustomerChatModal] Failed to convert timestamp via toDate", error);
      }
    }
    if (typeof input.seconds === "number") {
      const milliseconds = input.seconds * 1000 + (input.nanoseconds || 0) / 1e6;
      return new Date(milliseconds);
    }
  }
  return null;
}

function formatTimestamp(date) {
  if (!(date instanceof Date)) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  return `on ${date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}`;
}

function buildSubtitle(customer = {}) {
  const parts = [];
  if (customer.address) parts.push(customer.address);
  if (customer.email) parts.push(customer.email);
  if (customer.mobile) parts.push(customer.mobile);
  if (!parts.length) return "";
  return parts.join(" • ");
}

function setError(message) {
  if (!errorEl) return;
  if (!message) {
    errorEl.textContent = "";
    errorEl.setAttribute("hidden", "hidden");
    return;
  }
  errorEl.textContent = message;
  errorEl.removeAttribute("hidden");
}

function setStatus(message) {
  if (!statusEl) return;
  statusEl.textContent = message || "";
}

function bindEscapeKey() {
  unbindEscapeKey();
  keydownHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCustomerChatModal();
    }
  };
  document.addEventListener("keydown", keydownHandler);
}

function unbindEscapeKey() {
  if (!keydownHandler) return;
  document.removeEventListener("keydown", keydownHandler);
  keydownHandler = null;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value)
    .replace(/`/g, "&#96;")
    .replace(/\//g, "&#47;");
}

initCustomerChatModal();

window.CustomerChatModal = {
  init: initCustomerChatModal,
  open: openCustomerChatModal,
  close: closeCustomerChatModal,
};