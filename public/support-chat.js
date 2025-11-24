/**
 * Support Chat Modal - AI-powered help for subscribers
 * Connects to OpenAI GPT to answer questions about app usage
 */

const OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY_HERE'; // You'll set this in settings
const MODEL = 'gpt-4o-mini'; // Most cost-effective for this use case

// Chat state
const chatState = {
  messages: [],
  isLoading: false,
  apiKey: null
};

/**
 * Initialize support chat modal
 */
export function initSupportChat() {
  createSupportModal();
  attachEventListeners();
  loadSavedApiKey();
}

/**
 * Load API key from localStorage
 */
function loadSavedApiKey() {
  const saved = localStorage.getItem('swash:supportChatApiKey');
  if (saved) {
    chatState.apiKey = saved;
  }
}

/**
 * Save API key to localStorage
 */
function saveSavedApiKey(key) {
  localStorage.setItem('swash:supportChatApiKey', key);
  chatState.apiKey = key;
}

/**
 * Create the support chat modal HTML
 */
function createSupportModal() {
  if (document.getElementById('supportChatModal')) return;

  const modal = document.createElement('div');
  modal.id = 'supportChatModal';
  modal.className = 'support-chat-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="support-chat-container">
      <div class="support-chat-header">
        <h3>Support Assistant</h3>
        <button type="button" class="support-chat-close" id="closeSupportChat" aria-label="Close">×</button>
      </div>
      
      <div class="support-chat-api-notice" id="apiKeyNotice">
        <p style="margin: 0; font-size: 0.9rem; color: #d97706;">
          ⚠️ To enable AI support, you need to configure an OpenAI API key in Settings.
        </p>
        <button type="button" class="btn btn-sm btn-primary" id="goToSettingsBtn" style="margin-top: 8px;">Go to Settings</button>
      </div>

      <div class="support-chat-messages" id="supportChatMessages"></div>
      
      <div class="support-chat-input-area">
        <textarea 
          id="supportChatInput" 
          placeholder="Ask a question about the app..." 
          rows="3"
          style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem; font-family: inherit; resize: vertical;"
        ></textarea>
        <button type="button" id="sendSupportMessage" class="btn btn-primary" style="width: 100%; margin-top: 8px;">Send</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add CSS
  if (!document.getElementById('supportChatStyles')) {
    const style = document.createElement('style');
    style.id = 'supportChatStyles';
    style.innerHTML = `
      .support-chat-modal {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2000;
        width: 380px;
        max-width: 90vw;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        display: flex;
        flex-direction: column;
        max-height: 600px;
        font-family: inherit;
      }

      .support-chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid #e5e7eb;
        background: #f3f4f6;
        border-radius: 12px 12px 0 0;
      }

      .support-chat-header h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: #1f2937;
      }

      .support-chat-close {
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: #6b7280;
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .support-chat-close:hover {
        color: #1f2937;
      }

      .support-chat-api-notice {
        padding: 12px 16px;
        background: #fef3c7;
        border-bottom: 1px solid #e5e7eb;
        display: none;
      }

      .support-chat-api-notice.show {
        display: block;
      }

      .support-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 200px;
      }

      .support-chat-message {
        display: flex;
        gap: 8px;
        animation: slideIn 0.3s ease-out;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .support-chat-message.user {
        justify-content: flex-end;
      }

      .support-chat-message-content {
        max-width: 75%;
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 0.9rem;
        line-height: 1.4;
      }

      .support-chat-message.user .support-chat-message-content {
        background: #0078d7;
        color: #fff;
      }

      .support-chat-message.assistant .support-chat-message-content {
        background: #f3f4f6;
        color: #1f2937;
      }

      .support-chat-message.system .support-chat-message-content {
        background: #fee2e2;
        color: #991b1b;
        font-size: 0.85rem;
      }

      .support-chat-loading {
        display: flex;
        gap: 4px;
        padding: 10px 12px;
        background: #f3f4f6;
        border-radius: 8px;
        width: fit-content;
      }

      .support-chat-loading span {
        width: 8px;
        height: 8px;
        background: #9ca3af;
        border-radius: 50%;
        animation: bounce 1.4s infinite;
      }

      .support-chat-loading span:nth-child(2) {
        animation-delay: 0.2s;
      }

      .support-chat-loading span:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes bounce {
        0%, 80%, 100% { transform: translateY(0); }
        40% { transform: translateY(-8px); }
      }

      .support-chat-input-area {
        padding: 16px;
        border-top: 1px solid #e5e7eb;
        background: #f9fafb;
        border-radius: 0 0 12px 12px;
      }

      @media (max-width: 640px) {
        .support-chat-modal {
          width: calc(100vw - 20px);
          bottom: 10px;
          right: 10px;
          max-height: 70vh;
        }

        .support-chat-message-content {
          max-width: 85%;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Attach event listeners
 */
function attachEventListeners() {
  const closeBtn = document.getElementById('closeSupportChat');
  const sendBtn = document.getElementById('sendSupportMessage');
  const input = document.getElementById('supportChatInput');
  const settingsBtn = document.getElementById('goToSettingsBtn');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSupportChat);
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', sendSupportMessage);
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendSupportMessage();
      }
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      closeSupportChat();
      // Navigate to settings
      window.location.hash = '#settings';
      const settingsTab = document.getElementById('tabSettings');
      if (settingsTab) settingsTab.click();
    });
  }
}

/**
 * Open support chat
 */
export function openSupportChat() {
  const modal = document.getElementById('supportChatModal');
  if (modal) {
    modal.hidden = false;
    // Show or hide API notice based on key status
    const notice = document.getElementById('apiKeyNotice');
    if (notice) {
      notice.classList.toggle('show', !chatState.apiKey);
    }
    // Focus input
    setTimeout(() => {
      const input = document.getElementById('supportChatInput');
      if (input && chatState.apiKey) input.focus();
    }, 100);
  }
}

/**
 * Close support chat
 */
export function closeSupportChat() {
  const modal = document.getElementById('supportChatModal');
  if (modal) {
    modal.hidden = true;
  }
}

/**
 * Send message to support chat
 */
async function sendSupportMessage() {
  if (!chatState.apiKey) {
    showSystemMessage('❌ API key not configured. Go to Settings to add your OpenAI API key.');
    return;
  }

  const input = document.getElementById('supportChatInput');
  const message = input.value.trim();

  if (!message) return;

  // Clear input
  input.value = '';

  // Add user message
  addMessage(message, 'user');

  // Show loading
  showLoadingIndicator();

  // Send to OpenAI
  try {
    const response = await sendToOpenAI(message);
    removeLoadingIndicator();
    addMessage(response, 'assistant');
  } catch (error) {
    removeLoadingIndicator();
    showSystemMessage(`❌ Error: ${error.message}`);
  }
}

/**
 * Send message to OpenAI API
 */
async function sendToOpenAI(userMessage) {
  const systemPrompt = `You are a helpful support assistant for Swash, a window cleaning management app. 
Help subscribers understand how to use the app features including:
- Quote calculator
- Schedule management
- Customer tracking
- Rep logging
- Settings and customization
- SMS management
- Theme customization

Be concise, friendly, and helpful. Provide step-by-step guidance when needed.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${chatState.apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatState.messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.text
        })),
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Add message to chat
 */
function addMessage(text, role) {
  chatState.messages.push({ text, role });

  const messagesDiv = document.getElementById('supportChatMessages');
  const messageEl = document.createElement('div');
  messageEl.className = `support-chat-message ${role}`;
  messageEl.innerHTML = `<div class="support-chat-message-content">${escapeHtml(text)}</div>`;

  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Show loading indicator
 */
function showLoadingIndicator() {
  const messagesDiv = document.getElementById('supportChatMessages');
  const loader = document.createElement('div');
  loader.id = 'supportChatLoader';
  loader.className = 'support-chat-loading';
  loader.innerHTML = '<span></span><span></span><span></span>';
  messagesDiv.appendChild(loader);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Remove loading indicator
 */
function removeLoadingIndicator() {
  const loader = document.getElementById('supportChatLoader');
  if (loader) loader.remove();
}

/**
 * Show system message
 */
function showSystemMessage(text) {
  const messagesDiv = document.getElementById('supportChatMessages');
  const messageEl = document.createElement('div');
  messageEl.className = 'support-chat-message system';
  messageEl.innerHTML = `<div class="support-chat-message-content">${escapeHtml(text)}</div>`;
  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Set API key (called from settings)
 */
export function setSupportChatApiKey(key) {
  saveSavedApiKey(key);
  const notice = document.getElementById('apiKeyNotice');
  if (notice) {
    notice.classList.remove('show');
  }
}

/**
 * Get API key status
 */
export function hasSupportChatApiKey() {
  return !!chatState.apiKey;
}
