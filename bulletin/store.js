/* ── bulletin · store.js ─ localStorage persistence ── */

const Store = (function () {
  "use strict";

  const STORAGE_KEY = "bulletin_data";

  function _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function _normalizePlacement(placement) {
    return {
      x: placement?.x ?? 0,
      y: placement?.y ?? 0,
      pinW: placement?.pinW ?? null,
    };
  }

  function _normalizePin(pin) {
    const placementSource = pin?.placements && typeof pin.placements === "object"
      ? pin.placements
      : pin?.boardId
        ? {
            [pin.boardId]: {
              x: pin.x ?? 0,
              y: pin.y ?? 0,
              pinW: pin.pinW ?? null,
            },
          }
        : {};

    const placements = {};
    Object.entries(placementSource).forEach(([boardId, placement]) => {
      if (!boardId) return;
      placements[boardId] = _normalizePlacement(placement);
    });

    const boardIds = Array.isArray(pin?.boardIds)
      ? pin.boardIds.filter((boardId) => !!boardId && placements[boardId])
      : Object.keys(placements);

    return {
      id: pin?.id || _uid(),
      sharedPinId: pin?.sharedPinId || pin?.id || _uid(),
      tags: Array.isArray(pin?.tags) ? pin.tags : [],
      imageUrl: pin?.imageUrl || "",
      imageData: pin?.imageData || null,
      source: pin?.source || "local",
      arenaBlockId: pin?.arenaBlockId || null,
      createdAt: pin?.createdAt ?? Date.now(),
      boardIds,
      placements,
    };
  }

  function _withBoardPlacement(pin, boardId) {
    if (!pin || !boardId || !pin.placements?.[boardId]) return null;
    const placement = pin.placements[boardId];
    return {
      ...pin,
      boardId,
      x: placement.x ?? 0,
      y: placement.y ?? 0,
      pinW: placement.pinW ?? null,
    };
  }

  function _normalizeData(data) {
    const next = {
      boards: Array.isArray(data?.boards) ? data.boards : [],
      pins: Array.isArray(data?.pins) ? data.pins.map(_normalizePin) : [],
      arena: data?.arena && typeof data.arena === "object" ? data.arena : {},
      groups: Array.isArray(data?.groups) ? data.groups : [],
    };

    next.pins = next.pins.filter((pin) => pin.boardIds.length > 0);
    return next;
  }

  // ── Internal helpers ────────────────────────────
  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return _normalizeData(JSON.parse(raw));
    } catch (e) { /* ignore corrupt data */ }
    return { boards: [], pins: [], arena: {}, groups: [] };
  }

  function _save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_normalizeData(data)));
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

  function addBoard({ name, description, color, source, arenaChannelId, groupId }) {
    const data = _load();
    const board = {
      id: _uid(),
      name: name || "Untitled",
      description: description || "",
      color: color || "#EEEBE7",
      source: source || "local",
      arenaChannelId: arenaChannelId || null,
      createdAt: Date.now(),
      groupId: groupId || null,
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
    data.pins = data.pins
      .map((pin) => detachPinFromBoardInternal(pin, id))
      .filter((pin) => pin.boardIds.length > 0);
    _save(data);
  }

  // ── Groups ─────────────────────────────────────
  function getGroups() {
    return _load().groups || [];
  }

  function addGroup({ name }) {
    const data = _load();
    if (!data.groups) data.groups = [];
    const group = { id: _uid(), name: name || "Untitled Group", createdAt: Date.now() };
    data.groups.push(group);
    _save(data);
    return group;
  }

  function updateGroup(id, changes) {
    const data = _load();
    if (!data.groups) data.groups = [];
    const group = data.groups.find(g => g.id === id);
    if (!group) return null;
    Object.assign(group, changes);
    _save(data);
    return group;
  }

  function deleteGroup(id) {
    const data = _load();
    if (!data.groups) data.groups = [];
    data.groups = data.groups.filter(g => g.id !== id);
    // Un-group boards that belonged to this group
    data.boards = data.boards.map(b =>
      b.groupId === id ? Object.assign({}, b, { groupId: null }) : b
    );
    _save(data);
  }

  function detachPinFromBoardInternal(pin, boardId) {
    const nextPin = _clone(pin);
    nextPin.boardIds = nextPin.boardIds.filter((id) => id !== boardId);
    if (nextPin.placements) delete nextPin.placements[boardId];
    return nextPin;
  }

  // ── Pins ────────────────────────────────────────

  function getPins(boardId) {
    return _load().pins
      .map((pin) => _withBoardPlacement(pin, boardId))
      .filter(Boolean);
  }

  function getPin(id, boardId) {
    const pin = _load().pins.find(p => p.id === id) || null;
    if (!pin) return null;
    if (boardId) return _withBoardPlacement(pin, boardId);
    const defaultBoardId = pin.boardIds[0] || null;
    return defaultBoardId ? _withBoardPlacement(pin, defaultBoardId) : pin;
  }

  function getAllPins() {
    return _load().pins.map((pin) => {
      const defaultBoardId = pin.boardIds[0] || null;
      return defaultBoardId ? _withBoardPlacement(pin, defaultBoardId) : pin;
    });
  }

  function addPin({ id, sharedPinId, boardId, boardIds, placements, tags, imageUrl, imageData, source, arenaBlockId, x, y, pinW, createdAt }) {
    const data = _load();
    const pinId = id || _uid();
    const nextPlacements = placements && typeof placements === "object"
      ? Object.fromEntries(
          Object.entries(placements)
            .filter(([nextBoardId]) => !!nextBoardId)
            .map(([nextBoardId, placement]) => [nextBoardId, _normalizePlacement(placement)])
        )
      : boardId
        ? { [boardId]: _normalizePlacement({ x, y, pinW }) }
        : {};

    const nextBoardIds = Array.isArray(boardIds)
      ? boardIds.filter((nextBoardId) => !!nextBoardId && nextPlacements[nextBoardId])
      : Object.keys(nextPlacements);

    const pin = {
      id: pinId,
      sharedPinId: sharedPinId || pinId,
      tags: Array.isArray(tags) ? tags : [],
      imageUrl: imageUrl || "",
      imageData: imageData || null, // base64 data URL for uploads
      source: source || "local",
      arenaBlockId: arenaBlockId || null,
      createdAt: createdAt ?? Date.now(),
      boardIds: nextBoardIds,
      placements: nextPlacements,
    };

    const existingIndex = data.pins.findIndex(p => p.id === pinId);
    if (existingIndex >= 0) data.pins[existingIndex] = pin;
    else data.pins.push(pin);

    _save(data);
    return getPin(pinId, nextBoardIds[0]);
  }

  function updatePin(id, changes) {
    const data = _load();
    const pin = data.pins.find(p => p.id === id);
    if (!pin) return null;
    const sharedPinId = pin.sharedPinId || pin.id;
    const nextChanges = { ...changes };
    delete nextChanges.boardId;
    delete nextChanges.x;
    delete nextChanges.y;
    delete nextChanges.pinW;
    delete nextChanges.sharedPinId;
    data.pins.forEach((entry) => {
      if ((entry.sharedPinId || entry.id) !== sharedPinId) return;
      Object.assign(entry, nextChanges);
    });
    _save(data);
    return getPin(id);
  }

  function updatePinPlacement(id, boardId, changes) {
    const data = _load();
    const pin = data.pins.find((entry) => entry.id === id);
    if (!pin || !boardId || !pin.placements[boardId]) return null;

    pin.placements[boardId] = {
      ...pin.placements[boardId],
      ...changes,
    };
    _save(data);
    return getPin(id, boardId);
  }

  function attachPinToBoard(id, boardId, placement = {}) {
    const data = _load();
    const pin = data.pins.find((entry) => entry.id === id);
    if (!pin || !boardId) return null;
    if (!pin.boardIds.includes(boardId)) pin.boardIds.push(boardId);
    pin.placements[boardId] = _normalizePlacement({
      ...pin.placements[boardId],
      ...placement,
    });
    _save(data);
    return getPin(id, boardId);
  }

  function detachPinFromBoard(id, boardId) {
    const data = _load();
    const index = data.pins.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const pin = data.pins[index];
    const boardScopedPin = getPin(id, boardId);
    if (!boardScopedPin || !boardId) return null;

    data.pins[index] = detachPinFromBoardInternal(pin, boardId);
    if (data.pins[index].boardIds.length === 0) {
      data.pins.splice(index, 1);
    }

    _save(data);
    return boardScopedPin;
  }

  function pinHasBoard(id, boardId) {
    const pin = _load().pins.find((entry) => entry.id === id);
    return !!pin && !!boardId && pin.boardIds.includes(boardId);
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
    getGroups,
    addGroup,
    updateGroup,
    deleteGroup,
    getPins,
    getPin,
    getAllPins,
    addPin,
    updatePin,
    updatePinPlacement,
    attachPinToBoard,
    detachPinFromBoard,
    pinHasBoard,
    deletePin,
    getArenaToken,
    setArenaToken,
    clearArenaToken,
  };
})();
