/* ── netwrk · store.js ─ localStorage persistence ── */

const Store = (function () {
  "use strict";

  const STORAGE_KEY = "netwrk_data";

  // ── Internal helpers ────────────────────────────
  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt data */ }
    return { boards: [], pins: [], arena: {} };
  }

  function _save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function _uid() {
    return crypto.randomUUID();
  }

  // ── Boards ──────────────────────────────────────

  function getBoards() {
    return _load().boards;
  }

  function getBoard(id) {
    return _load().boards.find(b => b.id === id) || null;
  }

  function addBoard({ name, description, color, source, arenaChannelId }) {
    const data = _load();
    const board = {
      id: _uid(),
      name: name || "Untitled",
      description: description || "",
      color: color || "#EEEBE7",
      source: source || "local",
      arenaChannelId: arenaChannelId || null,
      createdAt: Date.now(),
    };
    data.boards.push(board);
    _save(data);
    return board;
  }

  function updateBoard(id, changes) {
    const data = _load();
    const board = data.boards.find(b => b.id === id);
    if (!board) return null;
    Object.assign(board, changes);
    _save(data);
    return board;
  }

  function deleteBoard(id) {
    const data = _load();
    data.boards = data.boards.filter(b => b.id !== id);
    data.pins = data.pins.filter(p => p.boardId !== id);
    _save(data);
  }

  // ── Pins ────────────────────────────────────────

  function getPins(boardId) {
    return _load().pins.filter(p => p.boardId === boardId);
  }

  function getPin(id) {
    return _load().pins.find(p => p.id === id) || null;
  }

  function getAllPins() {
    return _load().pins;
  }

  function addPin({ boardId, title, imageUrl, imageData, source, arenaBlockId, x, y }) {
    const data = _load();
    const pin = {
      id: _uid(),
      boardId,
      title: title || "",
      imageUrl: imageUrl || "",
      imageData: imageData || null, // base64 data URL for uploads
      source: source || "local",
      arenaBlockId: arenaBlockId || null,
      x: x ?? 0,
      y: y ?? 0,
      createdAt: Date.now(),
    };
    data.pins.push(pin);
    _save(data);
    return pin;
  }

  function updatePin(id, changes) {
    const data = _load();
    const pin = data.pins.find(p => p.id === id);
    if (!pin) return null;
    Object.assign(pin, changes);
    _save(data);
    return pin;
  }

  function deletePin(id) {
    const data = _load();
    data.pins = data.pins.filter(p => p.id !== id);
    _save(data);
  }

  // ── Are.na Token ────────────────────────────────

  function getArenaToken() {
    return _load().arena.accessToken || null;
  }

  function setArenaToken(accessToken, expiresAt) {
    const data = _load();
    data.arena = { accessToken, expiresAt };
    _save(data);
  }

  function clearArenaToken() {
    const data = _load();
    data.arena = {};
    _save(data);
  }

  // ── Public API ──────────────────────────────────
  return {
    getBoards,
    getBoard,
    addBoard,
    updateBoard,
    deleteBoard,
    getPins,
    getPin,
    getAllPins,
    addPin,
    updatePin,
    deletePin,
    getArenaToken,
    setArenaToken,
    clearArenaToken,
  };
})();
