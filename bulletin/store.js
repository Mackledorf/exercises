/* ── bulletin · store.js ─ Supabase-backed persistence (cache-first) ── */

const Store = (function () {
  "use strict";

  // ── In-memory cache ─────────────────────────────
  let _data = { boards: [], pins: [], groups: [], connections: [] };
  let _userId = null;
  let _ready = false;

  function _sb() {
    return window.supabaseClient;
  }

  function _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function _uid() {
    return crypto.randomUUID();
  }

  function _logSupabaseError(scope, error) {
    if (!error) return;
    console.error(`[Store] ${scope}:`, {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
  }

  // board_pins has no user_id column; rows are scoped through board ownership.
  function _buildBoardPinPayload({ pinId, boardId, x, y, pinW }) {
    return { pin_id: pinId, board_id: boardId, x, y, pin_w: pinW };
  }

  // ── Async DB helpers (fire-and-forget for writes) ──

  function _dbInsert(table, row) {
    _sb().from(table).insert(row).then(({ error }) => {
      if (error) console.error(`[Store] insert ${table}:`, error.message);
    });
  }

  function _dbUpdate(table, id, changes) {
    _sb().from(table).update(changes).eq("id", id).then(({ error }) => {
      if (error) console.error(`[Store] update ${table}:`, error.message);
    });
  }

  function _dbDelete(table, id) {
    _sb().from(table).delete().eq("id", id).then(({ error }) => {
      if (error) console.error(`[Store] delete ${table}:`, error.message);
    });
  }

  function _dbDeleteWhere(table, column, value) {
    _sb().from(table).delete().eq(column, value).then(({ error }) => {
      if (error) console.error(`[Store] delete ${table} where ${column}=${value}:`, error.message);
    });
  }

  // ── Pin normalization (keeps compatibility with rest of app) ──

  function _normalizePlacement(placement) {
    return {
      x: placement?.x ?? 0,
      y: placement?.y ?? 0,
      pinW: placement?.pinW ?? null,
    };
  }

  function _normalizeTagKey(tag) {
    return String(tag || "").trim().toLowerCase();
  }

  function _boardTagsForBoardIds(boardIds) {
    if (!Array.isArray(boardIds)) return [];
    const seen = new Set();
    return boardIds
      .map(boardId => _data.boards.find(board => board.id === boardId)?.name?.trim())
      .filter(Boolean)
      .filter(tag => {
        const key = _normalizeTagKey(tag);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function _mergeTags(tags, lockedTags = []) {
    const seen = new Set();
    return [...lockedTags, ...(Array.isArray(tags) ? tags : [])]
      .map(tag => String(tag || "").trim())
      .filter(Boolean)
      .filter(tag => {
        const key = _normalizeTagKey(tag);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function _uniqueTags(tags) {
    const seen = new Set();
    return (Array.isArray(tags) ? tags : [])
      .map(tag => String(tag || "").trim())
      .filter(Boolean)
      .filter(tag => {
        const key = _normalizeTagKey(tag);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
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

  // ── Init: Load all data from Supabase ───────────

  async function init(userId) {
    _userId = userId;

    // Prevent malformed Supabase filters (for example eq(user_id, undefined)).
    if (typeof _userId !== "string" || _userId.trim().length === 0) {
      console.warn("[Store] init called without a valid user id; skipping remote load.");
      _data = { boards: [], pins: [], groups: [], connections: [] };
      _ready = true;
      return;
    }

    const [boardsRes, pinsRes, boardPinsRes, groupsRes, connectionsRes] = await Promise.all([
      _sb().from("boards").select("*").eq("user_id", _userId).order("created_at"),
      _sb().from("pins").select("*").eq("user_id", _userId).order("created_at"),
      _sb().from("board_pins").select("*"),
      _sb().from("groups").select("*").eq("user_id", _userId).order("created_at"),
      _sb().from("connections").select("*").eq("user_id", _userId).order("created_at"),
    ]);

    if (boardsRes.error) _logSupabaseError("select boards", boardsRes.error);
    if (pinsRes.error) _logSupabaseError("select pins", pinsRes.error);
    if (groupsRes.error) _logSupabaseError("select groups", groupsRes.error);
    if (connectionsRes.error) _logSupabaseError("select connections", connectionsRes.error);

    const boards = (boardsRes.data || []).map(b => ({
      id: b.id,
      name: b.name || "Untitled",
      description: b.description || "",
      color: b.color || "#EEEBE7",
      source: b.source || "local",
      arenaChannelId: b.arena_channel_id || null,
      createdAt: new Date(b.created_at).getTime(),
      groupId: b.group_id || null,
    }));

    if (boardPinsRes.error) {
      _logSupabaseError("select board_pins", boardPinsRes.error);
    }

    const boardsById = new Set(boards.map(b => b.id));
    const rawPins = pinsRes.data || [];
    const pinsById = new Set(rawPins.map(p => p.id));
    const boardPins = (boardPinsRes.data || []).filter(bp => (
      boardsById.has(bp.board_id) && pinsById.has(bp.pin_id)
    ));

    // Build pin objects with placements from board_pins junction
    const pins = rawPins.map(p => {
      const pinBoardPins = boardPins.filter(bp => bp.pin_id === p.id);
      const placements = {};
      const boardIds = [];

      pinBoardPins.forEach(bp => {
        boardIds.push(bp.board_id);
        placements[bp.board_id] = {
          x: bp.x ?? 0,
          y: bp.y ?? 0,
          pinW: bp.pin_w ?? null,
        };
      });

      return {
        id: p.id,
        sharedPinId: p.shared_pin_id || p.id,
        tags: Array.isArray(p.tags) ? p.tags : [],
        imageUrl: p.image_url || "",
        imageData: null, // no longer storing base64
        linkUrl: p.link_url || null,
        source: p.source || "local",
        arenaBlockId: p.arena_block_id || null,
        createdAt: new Date(p.created_at).getTime(),
        boardIds,
        placements,
      };
    }).filter(pin => pin.boardIds.length > 0);

    const groups = (groupsRes.data || []).map(g => ({
      id: g.id,
      name: g.name || "Untitled Group",
      createdAt: new Date(g.created_at).getTime(),
    }));

    const connections = (connectionsRes.data || []).map(c => ({
      id: c.id,
      sourceId: c.source_id,
      targetId: c.target_id,
      createdAt: new Date(c.created_at).getTime(),
    }));

    _data = { boards, pins, groups, connections };
    _ready = true;
  }

  // ── Boards ──────────────────────────────────────

  function getBoards() {
    return _data.boards;
  }

  function getBoard(id) {
    return _data.boards.find(b => b.id === id) || null;
  }

  function addBoard({ name, description, color, source, arenaChannelId, groupId }) {
    const id = _uid();
    const board = {
      id,
      name: name || "Untitled",
      description: description || "",
      color: color || "#EEEBE7",
      source: source || "local",
      arenaChannelId: arenaChannelId || null,
      createdAt: Date.now(),
      groupId: groupId || null,
    };
    _data.boards.push(board);

    _dbInsert("boards", {
      id,
      user_id: _userId,
      name: board.name,
      description: board.description,
      color: board.color,
      source: board.source,
      arena_channel_id: board.arenaChannelId,
      group_id: board.groupId,
    });

    return board;
  }

  function updateBoard(id, changes) {
    const board = _data.boards.find(b => b.id === id);
    if (!board) return null;
    Object.assign(board, changes);

    // Map camelCase to snake_case for DB
    const dbChanges = {};
    if ("name" in changes) dbChanges.name = changes.name;
    if ("description" in changes) dbChanges.description = changes.description;
    if ("color" in changes) dbChanges.color = changes.color;
    if ("source" in changes) dbChanges.source = changes.source;
    if ("arenaChannelId" in changes) dbChanges.arena_channel_id = changes.arenaChannelId;
    if ("groupId" in changes) dbChanges.group_id = changes.groupId;

    if (Object.keys(dbChanges).length > 0) {
      _dbUpdate("boards", id, dbChanges);
    }

    return board;
  }

  function deleteBoard(id) {
    _data.boards = _data.boards.filter(b => b.id !== id);

    // Detach pins from this board in cache
    _data.pins = _data.pins
      .map(pin => _detachPinFromBoardInternal(pin, id))
      .filter(pin => pin.boardIds.length > 0);

    // Remove connections referencing this board
    _data.connections = _data.connections.filter(
      c => c.sourceId !== id && c.targetId !== id
    );

    // DB: cascade deletes handle board_pins; also clean up connections
    _dbDelete("boards", id);
    _sb().from("connections").delete()
      .or(`source_id.eq.${id},target_id.eq.${id}`)
      .then(({ error }) => {
        if (error) console.error("[Store] delete connections for board:", error.message);
      });
  }

  // ── Groups ─────────────────────────────────────

  function getGroups() {
    return _data.groups;
  }

  function addGroup({ name, color }) {
    const id = _uid();
    const group = {
      id,
      name: name || "Untitled Group",
      color: color || null,
      createdAt: Date.now()
    };
    _data.groups.push(group);

    _dbInsert("groups", {
      id,
      user_id: _userId,
      name: group.name,
      color: group.color,
    });

    return group;
  }

  function getGroup(id) {
    return _data.groups.find(g => g.id === id);
  }

  function updateGroup(id, changes) {
    const group = _data.groups.find(g => g.id === id);
    if (!group) return null;
    Object.assign(group, changes);

    const dbChanges = {};
    if ("name" in changes) dbChanges.name = changes.name;
    if ("color" in changes) dbChanges.color = changes.color;

    if (Object.keys(dbChanges).length > 0) {
      _dbUpdate("groups", id, dbChanges);
    }

    return group;
  }

  function deleteGroup(id) {
    _data.groups = _data.groups.filter(g => g.id !== id);
    // Un-group boards
    _data.boards.forEach(b => {
      if (b.groupId === id) b.groupId = null;
    });

    _dbDelete("groups", id);
    // Un-group boards in DB
    _sb().from("boards").update({ group_id: null }).eq("group_id", id).then(({ error }) => {
      if (error) console.error("[Store] ungroup boards:", error.message);
    });
  }

  // ── Pin internal helpers ────────────────────────

  function _detachPinFromBoardInternal(pin, boardId) {
    const nextPin = _clone(pin);
    nextPin.boardIds = nextPin.boardIds.filter(id => id !== boardId);
    if (nextPin.placements) delete nextPin.placements[boardId];
    return nextPin;
  }

  // ── Pins ────────────────────────────────────────

  function getPins(boardId) {
    return _data.pins
      .map(pin => _withBoardPlacement(pin, boardId))
      .filter(Boolean);
  }

  function getPin(id, boardId) {
    const pin = _data.pins.find(p => p.id === id) || null;
    if (!pin) return null;
    if (boardId) return _withBoardPlacement(pin, boardId);
    const defaultBoardId = pin.boardIds[0] || null;
    return defaultBoardId ? _withBoardPlacement(pin, defaultBoardId) : pin;
  }

  function getAllPins() {
    return _data.pins.map(pin => {
      const defaultBoardId = pin.boardIds[0] || null;
      return defaultBoardId ? _withBoardPlacement(pin, defaultBoardId) : pin;
    });
  }

  function getAllTags() {
    return _uniqueTags([
      ..._data.pins.flatMap(pin => Array.isArray(pin.tags) ? pin.tags : []),
      ..._data.boards.map(board => board.name),
    ]).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  function addPin({ id, sharedPinId, boardId, boardIds, placements, tags, imageUrl, imageData, linkUrl, source, arenaBlockId, x, y, pinW, createdAt }) {
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
      ? boardIds.filter(nextBoardId => !!nextBoardId && nextPlacements[nextBoardId])
      : Object.keys(nextPlacements);

    const pin = {
      id: pinId,
      sharedPinId: sharedPinId || pinId,
      tags: _mergeTags(tags, _boardTagsForBoardIds(nextBoardIds)),
      imageUrl: imageUrl || "",
      imageData: imageData || null,
      linkUrl: linkUrl || null,
      source: source || "local",
      arenaBlockId: arenaBlockId || null,
      createdAt: createdAt ?? Date.now(),
      boardIds: nextBoardIds,
      placements: nextPlacements,
    };

    const existingIndex = _data.pins.findIndex(p => p.id === pinId);
    if (existingIndex >= 0) {
      _data.pins[existingIndex] = pin;
    } else {
      _data.pins.push(pin);
    }

    // DB: upsert pin row, then board_pins (must sequence — FK dependency)
    _sb().from("pins").upsert({
      id: pinId,
      user_id: _userId,
      shared_pin_id: pin.sharedPinId,
      tags: pin.tags,
      image_url: pin.imageUrl,
      link_url: pin.linkUrl,
      source: pin.source,
      arena_block_id: pin.arenaBlockId,
    }).then(({ error }) => {
      if (error) {
        console.error("[Store] upsert pin:", error.message);
        return; // Don't write board_pins if pin failed
      }
      // Pin row exists — now safe to write board_pins
      nextBoardIds.forEach(bId => {
        const p = nextPlacements[bId];
        _sb().from("board_pins").upsert(_buildBoardPinPayload({
          pinId,
          boardId: bId,
          x: p.x,
          y: p.y,
          pinW: p.pinW,
        }), { onConflict: "pin_id,board_id" }).then(({ error }) => {
          if (error) _logSupabaseError("upsert board_pin", error);
        });
      });
    });

    return getPin(pinId, nextBoardIds[0]);
  }

  function updatePin(id, changes) {
    const pin = _data.pins.find(p => p.id === id);
    if (!pin) return null;
    const sharedPinId = pin.sharedPinId || pin.id;
    const nextChanges = { ...changes };
    delete nextChanges.boardId;
    delete nextChanges.x;
    delete nextChanges.y;
    delete nextChanges.pinW;
    delete nextChanges.sharedPinId;

    const sharedPins = _data.pins.filter(entry => (entry.sharedPinId || entry.id) === sharedPinId);
    if ("tags" in nextChanges) {
      nextChanges.tags = _mergeTags(
        nextChanges.tags,
        sharedPins.flatMap(entry => _boardTagsForBoardIds(entry.boardIds))
      );
    }

    // Update all pins sharing the same sharedPinId in cache
    sharedPins.forEach(entry => {
      Object.assign(entry, nextChanges);
    });

    // DB: update all pins with matching shared_pin_id
    const dbChanges = {};
    if ("tags" in nextChanges) dbChanges.tags = nextChanges.tags;
    if ("imageUrl" in nextChanges) dbChanges.image_url = nextChanges.imageUrl;
    if ("linkUrl" in nextChanges) dbChanges.link_url = nextChanges.linkUrl;
    if ("source" in nextChanges) dbChanges.source = nextChanges.source;

    // Remove imageData from DB changes (not stored in Supabase)
    // imageData is only used transiently before upload

    if (Object.keys(dbChanges).length > 0) {
      _sb().from("pins").update(dbChanges)
        .eq("shared_pin_id", sharedPinId)
        .eq("user_id", _userId)
        .then(({ error }) => {
          if (error) console.error("[Store] update pin by shared id:", error.message);
        });
      _sb().from("pins").update(dbChanges)
        .eq("id", sharedPinId)
        .eq("user_id", _userId)
        .then(({ error }) => {
          if (error) console.error("[Store] update pin by id:", error.message);
        });
    }

    return getPin(id);
  }

  function updatePinPlacement(id, boardId, changes) {
    const pin = _data.pins.find(entry => entry.id === id);
    if (!pin || !boardId || !pin.placements[boardId]) return null;

    pin.placements[boardId] = {
      ...pin.placements[boardId],
      ...changes,
    };

    // DB: update board_pins row
    const dbChanges = {};
    if ("x" in changes) dbChanges.x = changes.x;
    if ("y" in changes) dbChanges.y = changes.y;
    if ("pinW" in changes) dbChanges.pin_w = changes.pinW;

    if (Object.keys(dbChanges).length > 0) {
      _sb().from("board_pins").update(dbChanges)
        .eq("pin_id", id)
        .eq("board_id", boardId)
        .then(({ error }) => {
          if (error) _logSupabaseError("update board_pin placement", error);
        });
    }

    return getPin(id, boardId);
  }

  function attachPinToBoard(id, boardId, placement = {}) {
    const pin = _data.pins.find(entry => entry.id === id);
    if (!pin || !boardId) return null;
    if (!pin.boardIds.includes(boardId)) pin.boardIds.push(boardId);
    pin.placements[boardId] = _normalizePlacement({
      ...pin.placements[boardId],
      ...placement,
    });
    pin.tags = _mergeTags(pin.tags, _boardTagsForBoardIds(pin.boardIds));

    const p = pin.placements[boardId];
    _sb().from("board_pins").upsert(_buildBoardPinPayload({
      pinId: id,
      boardId,
      x: p.x,
      y: p.y,
      pinW: p.pinW,
    }), { onConflict: "pin_id,board_id" }).then(({ error }) => {
      if (error) _logSupabaseError("upsert board_pin (attach)", error);
    });

    _dbUpdate("pins", id, { tags: pin.tags });

    return getPin(id, boardId);
  }

  function detachPinFromBoard(id, boardId) {
    const index = _data.pins.findIndex(entry => entry.id === id);
    if (index < 0) return null;

    const pin = _data.pins[index];
    const boardScopedPin = getPin(id, boardId);
    if (!boardScopedPin || !boardId) return null;

    _data.pins[index] = _detachPinFromBoardInternal(pin, boardId);
    if (_data.pins[index].boardIds.length === 0) {
      _data.pins.splice(index, 1);
      // DB: delete the pin entirely if no boards left
      _dbDelete("pins", id);
    }

    // DB: remove board_pin row
    _sb().from("board_pins").delete()
      .eq("pin_id", id)
      .eq("board_id", boardId)
      .then(({ error }) => {
        if (error) _logSupabaseError("delete board_pin", error);
      });

    return boardScopedPin;
  }

  function pinHasBoard(id, boardId) {
    const pin = _data.pins.find(entry => entry.id === id);
    return !!pin && !!boardId && pin.boardIds.includes(boardId);
  }

  function deletePin(id) {
    _data.pins = _data.pins.filter(p => p.id !== id);
    _dbDelete("pins", id); // cascade deletes board_pins
  }

  // ── Connections ─────────────────────────────────

  function getConnections() {
    return _data.connections;
  }

  function getConnectionsForBoard(boardId) {
    return _data.connections.filter(
      c => c.sourceId === boardId || c.targetId === boardId
    );
  }

  function addConnection({ sourceId, targetId }) {
    if (!sourceId || !targetId || sourceId === targetId) return null;
    const exists = _data.connections.some(
      c => (c.sourceId === sourceId && c.targetId === targetId) ||
           (c.sourceId === targetId && c.targetId === sourceId)
    );
    if (exists) return null;

    const id = _uid();
    const connection = { id, sourceId, targetId, createdAt: Date.now() };
    _data.connections.push(connection);

    _dbInsert("connections", {
      id,
      user_id: _userId,
      source_id: sourceId,
      target_id: targetId,
    });

    return connection;
  }

  function deleteConnection(id) {
    _data.connections = _data.connections.filter(c => c.id !== id);
    _dbDelete("connections", id);
  }

  // ── Are.na Token (kept in localStorage) ─────────

  function getArenaToken() {
    try {
      const raw = localStorage.getItem("bulletin_arena");
      if (raw) return JSON.parse(raw).accessToken || null;
    } catch (e) { /* ignore */ }
    return null;
  }

  function setArenaToken(accessToken, expiresAt) {
    localStorage.setItem("bulletin_arena", JSON.stringify({ accessToken, expiresAt }));
  }

  function clearArenaToken() {
    localStorage.removeItem("bulletin_arena");
  }

  // ── Image upload to Supabase Storage ────────────

  async function uploadImage(file) {
    const ext = file.name?.split(".").pop() || "jpg";
    const path = `${_userId}/${_uid()}.${ext}`;

    const { data, error } = await _sb().storage
      .from("pin-images")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) throw error;

    const { data: urlData } = _sb().storage
      .from("pin-images")
      .getPublicUrl(data.path);

    return urlData.publicUrl;
  }

  async function uploadBase64Image(dataUrl) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = blob.type.split("/")[1] || "png";
    const file = new File([blob], `upload.${ext}`, { type: blob.type });
    return uploadImage(file);
  }

  // ── Explore: all public pins (cross-user) ───────

  async function getAllPublicPins() {
    const { data, error } = await _sb()
      .from("pins")
      .select("*, board_pins(*)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[Store] getAllPublicPins:", error.message);
      return [];
    }

    return (data || []).map(p => {
      const bp = (p.board_pins || [])[0];
      return {
        id: p.id,
        sharedPinId: p.shared_pin_id || p.id,
        tags: Array.isArray(p.tags) ? p.tags : [],
        imageUrl: p.image_url || "",
        imageData: null,
        linkUrl: p.link_url || null,
        source: p.source || "local",
        createdAt: new Date(p.created_at).getTime(),
        boardId: bp?.board_id || null,
        boardIds: (p.board_pins || []).map(b => b.board_id),
        x: bp?.x ?? 0,
        y: bp?.y ?? 0,
        pinW: bp?.pin_w ?? null,
      };
    }).filter(p => p.imageUrl);
  }

  // ── Public API ──────────────────────────────────
  return {
    init,
    getBoards,
    getBoard,
    addBoard,
    updateBoard,
    deleteBoard,
    getGroups,
    getGroup,
    addGroup,
    updateGroup,
    deleteGroup,
    getPins,
    getPin,
    getAllPins,
    getAllTags,
    addPin,
    updatePin,
    updatePinPlacement,
    attachPinToBoard,
    detachPinFromBoard,
    pinHasBoard,
    deletePin,
    getConnections,
    getConnectionsForBoard,
    addConnection,
    deleteConnection,
    getArenaToken,
    setArenaToken,
    clearArenaToken,
    uploadImage,
    uploadBase64Image,
    getAllPublicPins,
  };
})();
