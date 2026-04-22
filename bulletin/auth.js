/* ── bulletin · auth.js ─ Authentication layer ── */

const Auth = (function () {
  "use strict";

  const SESSION_STARTED_AT_KEY = "bulletin_session_started_at";
  const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  let _onAuthReady = null; // callback: (user) => void
  let _onSignOut = null;  // callback: () => void
  let _currentUser = null;
  let _authSubscription = null;
  let _authResolved = false;
  let _authFailSafeTimer = null;

  function _sb() {
    return window.supabaseClient;
  }

  function _clearAuthFailSafeTimer() {
    if (_authFailSafeTimer) {
      clearTimeout(_authFailSafeTimer);
      _authFailSafeTimer = null;
    }
  }

  function _markAuthResolved() {
    _authResolved = true;
    _clearAuthFailSafeTimer();
  }

  function _getSessionStartedAt() {
    try {
      const raw = localStorage.getItem(SESSION_STARTED_AT_KEY);
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function _setSessionStartedAt(ts) {
    try {
      localStorage.setItem(SESSION_STARTED_AT_KEY, String(ts || Date.now()));
    } catch (err) {
      // Ignore storage errors (private mode, quota, etc.)
    }
  }

  function _clearSessionStartedAt() {
    try {
      localStorage.removeItem(SESSION_STARTED_AT_KEY);
    } catch (err) {
      // Ignore storage errors
    }
  }

  function _isSessionExpired() {
    const startedAt = _getSessionStartedAt();
    if (!startedAt) return false;
    return (Date.now() - startedAt) > SESSION_MAX_AGE_MS;
  }

  async function _enforceSessionAge(event, session) {
    if (!session?.user) return false;

    if (event === "SIGNED_IN") {
      // Reset the local max-age window for explicit sign-ins.
      _setSessionStartedAt(Date.now());
    } else if (!_getSessionStartedAt()) {
      _setSessionStartedAt(Date.now());
    }

    if (!_isSessionExpired()) return false;

    _setError("Session expired. Please sign in again.");
    await _sb().auth.signOut();
    return true;
  }

  async function _handleAuthState(event, session) {
    _markAuthResolved();

    if (event === "SIGNED_OUT") {
      _currentUser = null;
      _clearSessionStartedAt();
      _updateAuthUI();
      if (_onSignOut) _onSignOut();
      return;
    }

    if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
      if (await _enforceSessionAge(event, session)) return;

      _currentUser = session?.user || null;
      _updateAuthUI();

      if (_currentUser && _onAuthReady) {
        _onAuthReady(_currentUser);
      }
      return;
    }

    _currentUser = session?.user || null;
    _updateAuthUI();
  }

  async function _resolveInitialSession() {
    try {
      const { data, error } = await _sb().auth.getSession();
      if (error) throw error;
      await _handleAuthState("INITIAL_SESSION", data?.session || null);
    } catch (err) {
      console.error("[Auth] Failed to resolve initial session:", err);
      _markAuthResolved();
      _currentUser = null;
      _updateAuthUI();
    }
  }

  // ── Init ───────────────────────────────────────

  function init({ onAuthReady, onSignOut }) {
    _onAuthReady = onAuthReady;
    _onSignOut = onSignOut || null;
    _authResolved = false;
    _clearAuthFailSafeTimer();

    // Show auth view immediately until auth state resolves
    _showAuthView();

    if (_authSubscription) {
      _authSubscription.unsubscribe();
      _authSubscription = null;
    }

    _bindEvents();

    // Listen for auth state changes
    try {
      const { data } = _sb().auth.onAuthStateChange((event, session) => {
        _handleAuthState(event, session).catch((err) => {
          console.error("[Auth] Auth state handler failed:", err);
        });
      });
      _authSubscription = data?.subscription || null;
    } catch (err) {
      console.error("[Auth] Failed to subscribe to auth changes:", err);
      _showAuthView();
      _setError("Unable to initialize authentication. Please refresh.");
      return;
    }

    _authFailSafeTimer = setTimeout(() => {
      if (_authResolved) return;
      _showAuthView();
      _setError("Authentication check timed out. Please sign in.");
    }, 5000);

    _resolveInitialSession();
  }

  // ── Current user ───────────────────────────────

  function getUser() {
    return _currentUser;
  }

  function getUserId() {
    return _currentUser?.id || null;
  }

  // ── Auth actions ───────────────────────────────

  async function signUp(email, password) {
    const { data, error } = await _sb().auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await _sb().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await _sb().auth.signOut();
    if (error) throw error;
    _currentUser = null;
    _clearSessionStartedAt();
  }

  // ── UI ─────────────────────────────────────────

  function _showAuthView() {
    const authView = document.getElementById("auth-view");
    if (authView) authView.hidden = false;

    // Hide the main app
    document.body.classList.add("auth-mode");
  }

  function _hideAuthView() {
    const authView = document.getElementById("auth-view");
    if (authView) authView.hidden = true;

    document.body.classList.remove("auth-mode");
  }

  function _updateAuthUI() {
    if (_currentUser) {
      _hideAuthView();
      // Update profile button text to be generic
      const profileBtn = document.getElementById("topbar-profile");
      if (profileBtn) {
        profileBtn.textContent = "Profile";
      }
      
      // Update profile page with username
      const nameEl = document.getElementById("profile-user-name");
      if (nameEl) {
        nameEl.textContent = _currentUser.email?.split("@")[0] || "User";
      }
    } else {
      _showAuthView();
    }
  }

  function _setError(msg) {
    const el = document.getElementById("auth-error");
    if (el) {
      el.textContent = msg || "";
      el.hidden = !msg;
      el.className = "auth-error";
    }
  }

  function _setLoading(loading) {
    const btn = document.getElementById("auth-submit");
    if (btn) {
      btn.disabled = loading;
      btn.textContent = loading ? "Loading…" : btn.dataset.label || "Sign In";
    }
  }

  function _bindEvents() {
    const form = document.getElementById("auth-form");
    const signOutBtn = document.getElementById("topbar-signout");
    let isSignUp = false;

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        _setError("");
        _setLoading(true);

        const email = document.getElementById("auth-email").value.trim();
        const password = document.getElementById("auth-password").value;
        const confirmPassword = document.getElementById("auth-confirm-password").value;

        if (!email || !password) {
          _setError("Email and password are required.");
          _setLoading(false);
          return;
        }

        if (isSignUp && password !== confirmPassword) {
          _setError("Passwords do not match.");
          _setLoading(false);
          return;
        }

        try {
          if (isSignUp) {
            await signUp(email, password);
            _setError("");
            // Supabase may require email confirmation — show message
            const el = document.getElementById("auth-error");
            if (el) {
              el.textContent = "Check your email to confirm your account.";
              el.hidden = false;
              el.className = "auth-success";
            }
          } else {
            await signIn(email, password);
          }
        } catch (err) {
          _setError(err.message || "Authentication failed.");
        }

        _setLoading(false);
      });
    }

    // Use event delegation on the parent so re-created links still work
    const toggleText = document.getElementById("auth-toggle-text");
    if (toggleText) {
      toggleText.addEventListener("click", (e) => {
        if (e.target.id !== "auth-toggle") return;
        e.preventDefault();
        isSignUp = !isSignUp;
        _setError("");

        const title = document.getElementById("auth-title");
        const submit = document.getElementById("auth-submit");
        const confirmInput = document.getElementById("auth-confirm-password");

        if (title) title.textContent = isSignUp ? "Create Account" : "Sign In";
        if (submit) {
          submit.textContent = isSignUp ? "Create Account" : "Sign In";
          submit.dataset.label = isSignUp ? "Create Account" : "Sign In";
        }
        if (confirmInput) {
          confirmInput.hidden = !isSignUp;
          confirmInput.required = isSignUp;
        }
        toggleText.innerHTML = isSignUp
          ? 'Already have an account? <a href="#" id="auth-toggle">Sign in</a>'
          : 'Don\'t have an account? <a href="#" id="auth-toggle">Create one</a>';
      });
    }

    if (signOutBtn) {
      console.log("Binding signOutBtn click");
      signOutBtn.addEventListener("click", async (e) => {
        console.log("Signout clicked");
        e.preventDefault();
        try {
          await signOut();
        } catch (err) {
          console.error("Sign out failed:", err);
        }
      });
    }
  }

  return {
    init,
    getUser,
    getUserId,
    signUp,
    signIn,
    signOut,
  };
})();
