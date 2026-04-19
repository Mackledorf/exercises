/* ── bulletin · auth.js ─ Authentication layer ── */

const Auth = (function () {
  "use strict";

  let _onAuthReady = null; // callback: (user) => void
  let _onSignOut = null;  // callback: () => void
  let _currentUser = null;

  function _sb() {
    return window.supabaseClient;
  }

  // ── Init ───────────────────────────────────────

  function init({ onAuthReady, onSignOut }) {
    _onAuthReady = onAuthReady;
    _onSignOut = onSignOut || null;

    // Show auth view immediately until auth state resolves
    _showAuthView();

    // Listen for auth state changes
    _sb().auth.onAuthStateChange((event, session) => {
      _currentUser = session?.user || null;
      _updateAuthUI();

      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        if (_currentUser && _onAuthReady) _onAuthReady(_currentUser);
      }
      if (event === "SIGNED_OUT") {
        _showAuthView();
        if (_onSignOut) _onSignOut();
      }
    });

    _bindEvents();
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
      // Update profile button with email
      const profileBtn = document.getElementById("topbar-profile");
      if (profileBtn) {
        profileBtn.textContent = _currentUser.email?.split("@")[0] || "Profile";
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

        if (!email || !password) {
          _setError("Email and password are required.");
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
              el.style.color = "var(--accent, #7C93C3)";
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

        if (title) title.textContent = isSignUp ? "Create Account" : "Sign In";
        if (submit) {
          submit.textContent = isSignUp ? "Create Account" : "Sign In";
          submit.dataset.label = isSignUp ? "Create Account" : "Sign In";
        }
        toggleText.innerHTML = isSignUp
          ? 'Already have an account? <a href="#" id="auth-toggle">Sign in</a>'
          : 'Don\'t have an account? <a href="#" id="auth-toggle">Create one</a>';
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener("click", async () => {
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
