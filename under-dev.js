// Under development overlay unlock for admins
// Pages include this file as a module.

(function(){
  const OVERLAY_SELECTOR = '.under-development, .maintenance-overlay';
  const KEY_PREFIX = 'devUnlock:';
  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(() => {
    const role = window.userRole; // set by auth-check.js
    const pathKey = KEY_PREFIX + location.pathname;
    const unlocked = sessionStorage.getItem(pathKey) === '1';
    const overlay = document.querySelector(OVERLAY_SELECTOR);
    if (!overlay) return;
    if (unlocked) {
      overlay.remove();
      return;
    }
    if (role === 'admin') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Work on this page';
      btn.className = 'btn btn-primary';
      btn.style.marginTop = '16px';
      btn.addEventListener('click', () => {
        sessionStorage.setItem(pathKey, '1');
        overlay.remove();
        console.log('[UnderDev] Overlay dismissed for admin');
      });
      overlay.appendChild(btn);
    }
  });
})();
