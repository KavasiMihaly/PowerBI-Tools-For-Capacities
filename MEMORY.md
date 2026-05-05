# MEMORY — Lessons & gotchas

Quick-reference shortcuts and lessons learned. Architecture, how-to guides, and project structure live in `CLAUDE.md` files (per global convention). This file is for the things that bit us once and shouldn't bite again.

## Lessons

### MSAL.js — `acquireTokenPopup` must fire from a user gesture, never on page load
**Symptom:** `popup_window_error: Error opening popup window. This can happen if you are using IE or if popups are blocked in the browser.` — even with no popup blocker visibly enabled.

**Why:** Modern browsers (Chrome/Edge/Firefox) silently block any popup that isn't synchronously initiated from a real user gesture (click, keypress). MSAL's `acquireTokenPopup` opens a `window.open(...)` to login.microsoftonline.com — if the call originates from a `Promise.then` chain triggered by `DOMContentLoaded`, the gesture-tracking heuristic has already lost the click context and the browser blocks it.

**Workaround for users:** Allow pop-ups for the site once. Chrome address bar → click the blocked-popup icon → "Always allow pop-ups from \<origin\>" → reload. After the first successful login, the token caches in `localStorage` and silent acquisition handles subsequent reloads (no popup ever fires).

**Permanent fix (tracked as backlog T5a):** Replace the auto-popup-on-load pattern with an explicit Sign-in button:
```js
document.getElementById('signin').addEventListener('click', async () => {
  const result = await msalApp.acquireTokenPopup({ scopes });
  msalApp.setActiveAccount(result.account);
  // proceed with embed
});
```
Or use `acquireTokenRedirect` (full-page navigate, no popup at all — needs a redirect handler in `initAuth()` to pick up the response).

**Where it bit:** v0.8 first end-to-end smoke test on `http://localhost:8080`, 2026-05-05.

---

### Entra SPA redirect URIs are matched as exact strings — port included
**Symptom:** `AADSTS50011: The redirect URI specified in the request does not match`. Looks identical to the registered value at a glance.

**Why:** Entra's SPA platform compares redirect URIs as exact strings, including scheme, host, port, and path. `http://localhost` and `http://localhost:8080` are different URIs to Entra. Same for trailing slashes (`http://localhost:8080/` vs `http://localhost:8080`).

**Fix:** In Entra → App registration → Authentication → SPA → add the *exact* origin/URL the browser is sending. If you want flexibility across ports, register each one explicitly.

**Where it bit:** v0.8 first MSAL config attempt — registered `http://localhost`, served from `http://localhost:8080`. Caught early because the v0.8 page sets `redirectUri: window.location.origin` by default.

---

### `auth-config.json` was documented as gitignored but wasn't
**Symptom:** Real `clientId` / `tenantId` could be committed silently.

**Fix:** Added `RealisticLoadTestTool/auth-config.json` to `.gitignore` (line 450). Committed example template stays at `auth-config.example.json`.

**Lesson:** When a doc claims a file is gitignored, verify it with `git check-ignore -v <path>`. Don't trust the prose alone.
