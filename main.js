import { authStateReady, handlePageRouting, onAuthStateChange } from './auth-check.js';

const overlay = document.getElementById('authOverlay');
const content = document.getElementById('mainContent');
const linkCountEl = document.getElementById('linkCount');
const roleLabels = document.querySelectorAll('[data-role-label]');
const sections = document.querySelectorAll('[data-role-section]');
const quickCards = Array.from(document.querySelectorAll('.quick-action-card'));

const ROLE_DISPLAY = {
  admin: 'Admin',
  rep: 'Rep',
  subscriber: 'Subscriber',
  unauthorised: 'Guest',
  guest: 'Guest'
};

const ROLE_SECTION_ACCESS = {
  admin: new Set(['admin', 'rep', 'subscriber', 'shared']),
  rep: new Set(['rep', 'shared']),
  subscriber: new Set(['subscriber']),
  unauthorised: new Set(['shared']),
  guest: new Set(['shared'])
};

function formatRole(role) {
  if (!role) return ROLE_DISPLAY.guest;
  return ROLE_DISPLAY[role] || role.charAt(0).toUpperCase() + role.slice(1);
}

function highlightRole(role) {
  const resolvedRole = role || 'guest';
  const formatted = formatRole(resolvedRole);
  const allowed = ROLE_SECTION_ACCESS[resolvedRole] || ROLE_SECTION_ACCESS.guest;

  roleLabels.forEach((label) => {
    label.textContent = formatted;
  });

  sections.forEach((section) => {
    const target = section.dataset.roleSection || 'shared';
    const canSee = allowed.has(target);
    section.hidden = !canSee;
    section.classList.toggle('is-active', canSee && target === resolvedRole);
  });

  applyCardVisibility(resolvedRole);
  updateLinkCount();
}

function updateLinkCount() {
  if (!linkCountEl) return;
  let total = 0;
  sections.forEach((section) => {
    if (section.hidden) return;
    const style = window.getComputedStyle(section);
    if (style.display === 'none') return;
    const cards = section.querySelectorAll('.quick-action-card');
    cards.forEach((card) => {
      if (card.hidden) return;
      const cardStyle = window.getComputedStyle(card);
      if (cardStyle.display === 'none' || cardStyle.visibility === 'hidden') return;
      total += 1;
    });
  });
  linkCountEl.textContent = String(total);
}

function applyCardVisibility(role) {
  const effectiveRole = role || 'guest';
  quickCards.forEach((card) => {
    const hideAttr = card.dataset.hideFor;
    if (!hideAttr) {
      card.hidden = false;
      card.classList.remove('is-hidden');
      return;
    }

    const hideRoles = hideAttr
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const shouldHide = hideRoles.includes(effectiveRole);
    card.hidden = shouldHide;
    card.classList.toggle('is-hidden', shouldHide);
  });
}

async function init() {
  await handlePageRouting('shared');
  const { role } = await authStateReady();

  if (overlay) {
    overlay.hidden = true;
    overlay.style.display = 'none';
  }
  if (content) {
    content.style.display = 'block';
  }

  highlightRole(role);
}

onAuthStateChange(({ role }) => {
  highlightRole(role);
});

init().catch((error) => {
  console.error('[Main Hub] Failed to initialise', error);
});
