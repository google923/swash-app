/**
 * AI Helper Modal - Built-in feature for all subscribers
 * Uses backend Firebase function that handles OpenAI API securely
 */

import { app, auth } from './firebase-init.js';

// Chat state
const aiChatState = {
  messages: [],
  isLoading: false,
  subscriberId: null,
  subscriberName: null,
  cleaners: []
};

/**
 * Initialize AI Helper modal
 */
export function initAIHelper() {
  createAIHelperModal();
  // Attach listeners on next frame to ensure DOM is ready
  requestAnimationFrame(() => {
    attachAIHelperListeners();
  });
}

/**
 * Create the AI Helper modal HTML
 */
function createAIHelperModal() {
  if (document.getElementById('aiHelperModal')) return;

  const modal = document.createElement('div');
  modal.id = 'aiHelperModal';
  modal.className = 'ai-helper-modal';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="ai-helper-container">
      <div class="ai-helper-header">
        <h3>AI Helper</h3>
        <button type="button" class="ai-helper-close" id="closeAIHelper" aria-label="Close">×</button>
      </div>

      <div class="ai-helper-messages" id="aiHelperMessages">
        <div class="ai-helper-greeting">
          <div class="ai-helper-greeting-name" id="greetingName">Hi!</div>
          <div class="ai-helper-greeting-text">How can I help you today?</div>
          <div class="ai-helper-suggestions">
            <button class="ai-helper-suggestion" data-suggestion="organize-rota">
              📅 Help me organize my rota
            </button>
            <button class="ai-helper-suggestion" data-suggestion="cleaner-workload">
              👤 How many cleans does [Cleaner] have next week?
            </button>
            <button class="ai-helper-suggestion" data-suggestion="weather-forecast">
              🌧️ Is there any rain due when I'm busy next week?
            </button>
            <button class="ai-helper-suggestion" data-suggestion="tips">
              💡 Tips for managing my business
            </button>
          </div>
        </div>
      </div>

      <div class="ai-helper-input-area">
        <textarea 
          id="aiHelperInput" 
          placeholder="Ask me anything..." 
          rows="2"
          style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem; font-family: inherit; resize: vertical;"
        ></textarea>
        <button type="button" id="sendAIMessage" class="btn btn-primary" style="width: 100%; margin-top: 8px;">Send</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add CSS
  if (!document.getElementById('aiHelperStyles')) {
    const style = document.createElement('style');
    style.id = 'aiHelperStyles';
    style.innerHTML = `
      .ai-helper-modal {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2000;
        width: 420px;
        max-width: 90vw;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        display: flex;
        flex-direction: column;
        max-height: 650px;
        font-family: inherit;
      }

      .ai-helper-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid #e5e7eb;
        background: linear-gradient(135deg, #0078d7 0%, #005a9c 100%);
        border-radius: 12px 12px 0 0;
      }

      .ai-helper-header h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: #fff;
      }

      .ai-helper-close {
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.8);
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .ai-helper-close:hover {
        color: #fff;
      }

      .ai-helper-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 280px;
      }

      .ai-helper-greeting {
        display: flex;
        flex-direction: column;
        gap: 16px;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 20px;
      }

      .ai-helper-greeting-name {
        font-size: 1.8rem;
        font-weight: 700;
        color: #0078d7;
      }

      .ai-helper-greeting-text {
        font-size: 1.1rem;
        color: #1f2937;
      }

      .ai-helper-suggestions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }

      .ai-helper-suggestion {
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 12px 14px;
        font-size: 0.9rem;
        font-weight: 500;
        color: #1f2937;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
      }

      .ai-helper-suggestion:hover {
        background: #e5e7eb;
        border-color: #0078d7;
        color: #0078d7;
      }

      .ai-helper-message {
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

      .ai-helper-message.user {
        justify-content: flex-end;
      }

      .ai-helper-message-content {
        max-width: 75%;
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 0.9rem;
        line-height: 1.4;
        word-wrap: break-word;
      }

      .ai-helper-message.user .ai-helper-message-content {
        background: #0078d7;
        color: #fff;
      }

      .ai-helper-message.assistant .ai-helper-message-content {
        background: #f3f4f6;
        color: #1f2937;
      }

      .ai-helper-loading {
        display: flex;
        gap: 4px;
        padding: 10px 12px;
        background: #f3f4f6;
        border-radius: 8px;
        width: fit-content;
      }

      .ai-helper-loading span {
        width: 8px;
        height: 8px;
        background: #9ca3af;
        border-radius: 50%;
        animation: bounce 1.4s infinite;
      }

      .ai-helper-loading span:nth-child(2) {
        animation-delay: 0.2s;
      }

      .ai-helper-loading span:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes bounce {
        0%, 80%, 100% { transform: translateY(0); }
        40% { transform: translateY(-8px); }
      }

      .ai-helper-input-area {
        padding: 16px;
        border-top: 1px solid #e5e7eb;
        background: #f9fafb;
        border-radius: 0 0 12px 12px;
      }

      @media (max-width: 640px) {
        .ai-helper-modal {
          width: calc(100vw - 20px);
          bottom: 10px;
          right: 10px;
          max-height: 70vh;
        }

        .ai-helper-message-content {
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
function attachAIHelperListeners() {
  const closeBtn = document.getElementById('closeAIHelper');
  const sendBtn = document.getElementById('sendAIMessage');
  const input = document.getElementById('aiHelperInput');
  const suggestions = document.querySelectorAll('.ai-helper-suggestion');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeAIHelper);
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', sendAIMessage);
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAIMessage();
      }
    });
  }

  suggestions.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const suggestion = e.target.dataset.suggestion;
      handleSuggestion(suggestion);
    });
  });
}

/**
 * Handle suggestion clicks
 */
async function handleSuggestion(type) {
  const messagesDiv = document.getElementById('aiHelperMessages');
  
  // Clear greeting if needed
  const greeting = messagesDiv.querySelector('.ai-helper-greeting');
  if (greeting) greeting.remove();

  let question = '';
  let context = {};

  switch (type) {
    case 'organize-rota':
      question = "How should I organize my cleaning rota for maximum efficiency?";
      break;
    case 'cleaner-workload':
      if (aiChatState.cleaners.length > 0) {
        const cleanerName = aiChatState.cleaners[0];
        addAIMessage(`Getting workload for ${cleanerName}...`, 'assistant');
        try {
          const workload = await getCleanerWorkloadFn({ 
            subscriberId: aiChatState.subscriberId,
            cleanerName 
          });
          question = `How many cleans does ${cleanerName} have next week?`;
          context = { workload };
        } catch (error) {
          addAIMessage('Unable to fetch cleaner data. ' + error.message, 'assistant');
          return;
        }
      } else {
        question = "How many cleans does my cleaner have next week?";
      }
      break;
    case 'weather-forecast':
      addAIMessage('Checking weather forecast...', 'assistant');
      try {
        // Get user's approximate location (UK default for now)
        const forecast = await getWeatherForecastFn({ 
          lat: 51.5074,
          lon: -0.1278,
          days: 7
        });
        question = "Is there any rain due when I'm busy next week?";
        context = { forecast };
      } catch (error) {
        addAIMessage('Unable to fetch weather data. ' + error.message, 'assistant');
        return;
      }
      break;
    case 'tips':
      question = "What are the best tips for managing a window cleaning business?";
      break;
  }

  addAIMessage(question, 'user');
  await sendAIRequest(question, context);
}

/**
 * Send AI message
 */
async function sendAIMessage() {
  const input = document.getElementById('aiHelperInput');
  const question = input.value.trim();

  if (!question) return;

  // Clear input
  input.value = '';

  // Clear greeting if needed
  const messagesDiv = document.getElementById('aiHelperMessages');
  const greeting = messagesDiv.querySelector('.ai-helper-greeting');
  if (greeting) greeting.remove();

  addAIMessage(question, 'user');
  await sendAIRequest(question, {});
}

/**
 * Send request to AI backend
 */
async function sendAIRequest(question, context) {
  // Show loading
  showAILoadingIndicator();

  try {
    // Get auth token
    let token = null;
    try {
      token = await auth.currentUser?.getIdToken();
    } catch (e) {
      console.warn('Could not get auth token:', e);
    }

    if (!token) {
      throw new Error('User not authenticated. Please log in.');
    }

    // Use the current domain (works on both Firebase and Vercel)
    const baseUrl = window.location.origin;
    const functionUrl = `${baseUrl}/api/aiHelper`;
    console.log('🤖 Calling AI Helper:', functionUrl);
    console.log('Subscriber ID:', aiChatState.subscriberId);
    console.log('Question:', question);
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        question,
        subscriberId: aiChatState.subscriberId,
        context: Object.keys(context).length > 0 ? context : null
      })
    });

    console.log('📊 Response status:', response.status, response.statusText);

    // Check response status BEFORE parsing JSON
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorMessage = `HTTP ${response.status}`;
      
      try {
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } else {
          const text = await response.text();
          errorMessage = `Server error: ${text.substring(0, 100)}`;
        }
      } catch (parseError) {
        console.warn('Could not parse error response:', parseError);
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('📥 Response data:', data);

    removeAILoadingIndicator();
    addAIMessage(data.answer, 'assistant');
  } catch (error) {
    removeAILoadingIndicator();
    console.error('❌ AI request error:', error);
    addAIMessage(`Error: ${error.message}`, 'assistant');
  }
}

/**
 * Add message to chat
 */
function addAIMessage(text, role) {
  const messagesDiv = document.getElementById('aiHelperMessages');
  const messageEl = document.createElement('div');
  messageEl.className = `ai-helper-message ${role}`;
  messageEl.innerHTML = `<div class="ai-helper-message-content">${escapeHtml(text)}</div>`;

  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Show loading indicator
 */
function showAILoadingIndicator() {
  const messagesDiv = document.getElementById('aiHelperMessages');
  const loader = document.createElement('div');
  loader.id = 'aiHelperLoader';
  loader.className = 'ai-helper-loading';
  loader.innerHTML = '<span></span><span></span><span></span>';
  messagesDiv.appendChild(loader);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Remove loading indicator
 */
function removeAILoadingIndicator() {
  const loader = document.getElementById('aiHelperLoader');
  if (loader) loader.remove();
}

/**
 * Open AI Helper
 */
export function openAIHelper() {
  const modal = document.getElementById('aiHelperModal');
  if (modal) {
    modal.style.display = 'flex';
    // Focus input
    setTimeout(() => {
      const input = document.getElementById('aiHelperInput');
      if (input) input.focus();
    }, 100);
  }
}

/**
 * Close AI Helper
 */
export function closeAIHelper() {
  const modal = document.getElementById('aiHelperModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Set subscriber context
 */
export function setAIHelperContext(subscriberId, subscriberName, cleaners = []) {
  aiChatState.subscriberId = subscriberId;
  aiChatState.subscriberName = subscriberName;
  aiChatState.cleaners = cleaners;

  // Update greeting with subscriber name
  const greetingName = document.getElementById('greetingName');
  if (greetingName) {
    greetingName.textContent = `Hi ${subscriberName}!`;
  }
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
