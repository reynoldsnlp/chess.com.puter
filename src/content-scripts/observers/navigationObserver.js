// Observes SPA navigation on chess.com (React Router doesn't cause page reloads).
// Calls the provided callback whenever the URL changes.

/**
 * @param {(url: string) => void} onNavigate - called with the new URL on navigation
 * @returns {() => void} cleanup function
 */
export function observeNavigation(onNavigate) {
  let lastUrl = window.location.href;

  // Check for URL changes
  function checkUrl() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      onNavigate(currentUrl);
    }
  }

  // Listen for popstate (browser back/forward)
  window.addEventListener('popstate', checkUrl);

  // Watch for title changes (React Router often updates the title on navigation)
  const titleEl = document.querySelector('title');
  let titleObserver = null;
  if (titleEl) {
    titleObserver = new MutationObserver(checkUrl);
    titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  // Also watch for pushState/replaceState calls (chess.com uses these)
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    checkUrl();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    checkUrl();
  };

  // Return cleanup function
  return () => {
    window.removeEventListener('popstate', checkUrl);
    if (titleObserver) titleObserver.disconnect();
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
  };
}
