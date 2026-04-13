/* ── netwrk · arena.js ─ Are.na OAuth PKCE + API ── */

const Arena = (function () {
  "use strict";

  // ══════════════════════════════════════════════
  //  CONFIGURATION — Replace with your app values
  // ══════════════════════════════════════════════
  //
  //  Register your app at: https://dev.are.na/oauth/applications
  //  Set redirect URI to wherever you host this page.

  const CLIENT_ID    = "YOUR_ARENA_CLIENT_ID";   // ← replace
  const REDIRECT_URI = window.location.origin + window.location.pathname;
  const AUTH_URL     = "https://dev.are.na/oauth/authorize";
  const TOKEN_URL    = "https://dev.are.na/oauth/token";
  const API_BASE     = "https://api.are.na/v2";

  // ── PKCE helpers ───────────────────────────────

  function generateVerifier() {
    const arr = new Uint8Array(64);
    crypto.getRandomValues(arr);
    return base64url(arr);
  }

  async function generateChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return base64url(new Uint8Array(hash));
  }

  function base64url(buffer) {
    return btoa(String.fromCharCode(...buffer))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  // ── Auth flow ──────────────────────────────────

  async function startAuth() {
    const verifier = generateVerifier();
    const challenge = await generateChallenge(verifier);

    sessionStorage.setItem("arena_verifier", verifier);

    const params = new URLSearchParams({
      client_id:             CLIENT_ID,
      redirect_uri:          REDIRECT_URI,
      response_type:         "code",
      code_challenge:        challenge,
      code_challenge_method: "S256",
    });

    window.location.href = AUTH_URL + "?" + params.toString();
  }

  async function handleCallback() {
    const url = new URL(window.location);
    const code = url.searchParams.get("code");
    if (!code) return false;

    const verifier = sessionStorage.getItem("arena_verifier");
    if (!verifier) {
      console.warn("Arena: no PKCE verifier found in session");
      return false;
    }

    // Clean URL
    url.searchParams.delete("code");
    window.history.replaceState({}, "", url.pathname);

    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:     CLIENT_ID,
          grant_type:    "authorization_code",
          code:          code,
          redirect_uri:  REDIRECT_URI,
          code_verifier: verifier,
        }),
      });

      if (!res.ok) throw new Error("Token exchange failed: " + res.status);

      const data = await res.json();
      Store.setArenaToken(data.access_token, Date.now() + (data.expires_in || 7200) * 1000);
      sessionStorage.removeItem("arena_verifier");

      return true;
    } catch (err) {
      console.error("Arena auth error:", err);
      return false;
    }
  }

  // ── API fetching ───────────────────────────────

  function authHeaders() {
    const token = Store.getArenaToken();
    if (!token) return {};
    return { Authorization: "Bearer " + token };
  }

  async function fetchChannels() {
    const res = await fetch(API_BASE + "/me/channels?per=100", {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch channels: " + res.status);
    const data = await res.json();
    return data.channels || data || [];
  }

  async function fetchChannelContents(slug, page) {
    page = page || 1;
    const res = await fetch(API_BASE + "/channels/" + encodeURIComponent(slug) + "/contents?page=" + page + "&per=100", {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch channel: " + res.status);
    return res.json();
  }

  // ── Import channels as boards + pins ───────────

  async function importChannels(channels) {
    const results = [];
    const GRID = 24;

    for (const ch of channels) {
      // Create board
      const board = Store.addBoard({
        name:            ch.title,
        description:     ch.metadata?.description || "",
        color:           "#7CA1E8",  // default arena blue
        source:          "arena",
        arenaChannelId:  ch.id,
      });

      // Fetch all blocks (paginated)
      let page = 1;
      let hasMore = true;
      let pinIndex = 0;

      while (hasMore) {
        const data = await fetchChannelContents(ch.slug, page);
        const contents = data.contents || data.data || [];

        for (const block of contents) {
          if (block.class !== "Image" && block.class !== "Link" && block.class !== "Media") continue;

          const imageUrl =
            block.image?.display?.url ||
            block.image?.large?.url ||
            block.image?.thumb?.url ||
            block.image?.original?.url ||
            "";

          if (!imageUrl) continue;

          // Place in a grid layout
          const cols = 5;
          const spacing = 180;
          const x = (pinIndex % cols) * spacing;
          const y = Math.floor(pinIndex / cols) * spacing;

          Store.addPin({
            boardId:      board.id,
            title:        block.title || "",
            imageUrl:     imageUrl,
            source:       "arena",
            arenaBlockId: block.id,
            x: Math.round(x / GRID) * GRID,
            y: Math.round(y / GRID) * GRID,
          });

          pinIndex++;
        }

        hasMore = data.current_page < data.total_pages;
        page++;
      }

      results.push(board);
    }

    return results;
  }

  // ── Public API ─────────────────────────────────
  return {
    startAuth,
    handleCallback,
    fetchChannels,
    fetchChannelContents,
    importChannels,
    isConnected: () => !!Store.getArenaToken(),
  };
})();
