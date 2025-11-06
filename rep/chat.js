import { auth, db } from '../firebase-init.js';
import { authStateReady, handlePageRouting } from '../auth-check.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { initMenuDropdown } from "./menu.js";

// Elements
const chatFeed = document.getElementById('chatFeed');
const messageInput = document.getElementById('messageInput');
const postBtn = document.getElementById('postBtn');
const charCount = document.getElementById('charCount');

// State
let currentUser = null;
let currentRepName = null;
let unsubscribe = null;
let isAdmin = false;
let chatInitialised = false;

function waitForDomReady() {
  if (document.readyState === "loading") {
    return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return Promise.resolve();
}

await waitForDomReady();
await authStateReady();
console.log("[Page] Auth ready, userRole:", window.userRole);
const routing = await handlePageRouting("shared");
if (routing.redirected) {
  console.log("[Chat] Redirect scheduled; aborting chat bootstrap");
}

// Format timestamp
function formatTime(timestamp) {
  if (!timestamp) return 'Just now';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  // Less than 1 minute
  if (diff < 60000) return 'Just now';
  // Less than 1 hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins} min${mins > 1 ? 's' : ''} ago`;
  }
  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  // Show date
  const options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleDateString('en-GB', options);
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Render messages
function renderMessage(message, messageId) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.dataset.messageId = messageId;
  
  const author = escapeHtml(message.repName || 'Unknown');
  const text = escapeHtml(message.message || '');
  const time = formatTime(message.timestamp);
  
  const deleteBtn = isAdmin 
    ? `<button class="chat-message__delete" data-id="${messageId}" title="Delete message">×</button>`
    : '';
  
  div.innerHTML = `
    <div class="chat-message__header">
      <span class="chat-message__author">${author}</span>
      <span class="chat-message__time">${time}</span>
      ${deleteBtn}
    </div>
    <div class="chat-message__text">${text}</div>
  `;
  
  return div;
}

// Listen for messages
function startListening() {
  const q = query(
    collection(db, 'repChat'),
    orderBy('timestamp', 'desc'),
    limit(100)
  );

  if (unsubscribe) {
    unsubscribe();
  }

  unsubscribe = onSnapshot(q, (snapshot) => {
    chatFeed.innerHTML = '';
    
    if (snapshot.empty) {
      chatFeed.innerHTML = '<div class="chat-empty"><p>No messages yet. Be the first to say hello! 👋</p></div>';
      return;
    }
    
    snapshot.forEach((doc) => {
      const message = doc.data();
      chatFeed.appendChild(renderMessage(message, doc.id));
    });
    
    // Auto-scroll to bottom (newest message)
    chatFeed.scrollTop = 0;
  });
}

// Post message
async function postMessage() {
  const text = messageInput.value.trim();
  
  if (!text) {
    alert('Please enter a message.');
    return;
  }
  
  if (text.length > 1000) {
    alert('Message is too long. Maximum 1000 characters.');
    return;
  }
  
  if (!currentRepName) {
    alert('Unable to determine your name. Please refresh and try again.');
    return;
  }
  
  try {
    postBtn.disabled = true;
    postBtn.textContent = 'Posting...';
    
    await addDoc(collection(db, 'repChat'), {
      repName: currentRepName,
      message: text,
      timestamp: serverTimestamp(),
      userId: currentUser.uid
    });
    
    messageInput.value = '';
    charCount.textContent = '0';
    messageInput.focus();
  } catch (error) {
    console.error('Failed to post message:', error);
    alert('Failed to post message. Please try again.');
  } finally {
    postBtn.disabled = false;
    postBtn.textContent = 'Post';
  }
}

// Update character counter
function updateCharCounter() {
  const count = messageInput.value.length;
  charCount.textContent = count;
  
  if (count > 1000) {
    charCount.style.color = '#dc2626';
  } else if (count > 900) {
    charCount.style.color = '#ea580c';
  } else {
    charCount.style.color = '#64748b';
  }
}

// Get rep name from user profile or auth
async function getRepName(user) {
  try {
    // First try to get from users collection
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists() && userDoc.data().name) {
      return userDoc.data().name;
    }
    
    // Fallback to email username
    if (user.email) {
      return user.email.split('@')[0];
    }
    
    return 'Anonymous';
  } catch (error) {
    console.warn('Failed to fetch user name:', error);
    return user.email?.split('@')[0] || 'Anonymous';
  }
}

// Delete message
async function deleteMessage(messageId) {
  if (!confirm('Are you sure you want to delete this message?')) {
    return;
  }
  
  try {
    const { deleteDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
    await deleteDoc(doc(db, 'repChat', messageId));
  } catch (error) {
    console.error('Failed to delete message:', error);
    alert('Failed to delete message. Please try again.');
  }
}

// Initialize
function init() {
  if (chatInitialised) return;
  chatInitialised = true;

  initMenuDropdown();
  messageInput.addEventListener('input', updateCharCounter);
  
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      postMessage();
    }
  });
  
  postBtn.addEventListener('click', postMessage);
  
  // Delete button handler (event delegation)
  chatFeed.addEventListener('click', (e) => {
    if (e.target.classList.contains('chat-message__delete')) {
      const messageId = e.target.dataset.id;
      if (messageId) {
        deleteMessage(messageId);
      }
    }
  });
  
  startListening();
}

// Auth state
if (!routing.redirected) {
onAuthStateChanged(auth, async (user) => {
  if (!user) return; // auth-check.js will redirect
  
  currentUser = user;
  currentRepName = await getRepName(user);
  
  // Check if user is admin
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    isAdmin = userDoc.exists() && userDoc.data().role === 'admin';
  } catch (error) {
    console.warn('Failed to check admin status:', error);
    isAdmin = false;
  }
  
  init();
});
}
