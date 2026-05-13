/* ── bulletin · store.js ─ Supabase-backed persistence (cache-first) ── */

const Store = (function () {
  "use strict";

  // ── In-memory cache ─────────────────────────────
  let _data = { boards: [], pins: [], groups: [], connections: [] };
  let _userId = null;
  let _ready = false;
  let _demoMode = false;

  const DEMO_BOARD_CONFIGS = [
    {
      name: "GRDS 255 Hot Sauce",
      color: "#ff4a44",
      files: [
        "1479fa217ae511c598569ae3fb840315-2.jpg",
        "3c92e3aee61e360c09aad21535926d1d.jpg",
        "483fb03bf2c347be21146ce635a225cb.jpg",
        "4aaaf2e07c22d85e7a191b04a8f3a493.jpg",
        "5e7493c9fbb0d49cceedc7eb5eaff4cf-2.jpg",
        "822466dbcc8902cd9dac5541c754ca17.jpg",
        "85c2a8a52ce68e3c0e53b5c1ddb08438.jpg",
        "92d2e776b0ed43eab3a0a53cc64d1bf2.jpg",
        "aee133e814b0a99d7ea1e995713cbabd-2.jpg",
        "cabdb4f7c394aa3c9e4dbaf40cbce82e.jpg",
        "d19b72a4a93c33f8f5bf5e6cf6224752.jpg",
        "e8ec1e2ff44664128c7eaa910aa0f43e-2.jpg",
        "e9b082d220f1ac33c66a17e9fb28675c.jpg",
      ],
    },
    {
      name: "GRDS 271 Clock Moodboard",
      color: "#f05f2f",
      files: [
        "1ee98d38cba4c5709242c3f448530ce4.jpg",
        "2bd4dc9423051c6b2babb28791fdad35.jpg",
        "37ad8a2b4084f8299eed80fab05c1e96-2.jpg",
        "381505dd929409a09a5d1f7d363797c4-2.jpg",
        "3d3438a386b66e6004c664cdeb9830eb.jpg",
        "405f5773640e9cdb5118cbc2083f5e67-2.jpg",
        "53e43aaf90560a0fe67ff1f489dc6b7e-2.jpg",
        "5dffffe09823352d8f109ba3f7a69039.jpg",
        "6dbe5aa94a84341c70cf346c11f5d140.jpg",
        "72cc8fa06066f7ff717a55d4a2f6e8b6.jpg",
        "7afbb5376b9fd405205d0cd0479f2552-2.jpg",
        "802e6f5d55b9209e8747fb859ad1e6dc.jpg",
        "8d633a5f29b500caed6cc55025f824ff.jpg",
        "96fc89853b4210bda9c1481dde684f18-2.jpg",
        "9ee1fe9f78fb781e5810b776a2951415-2.jpg",
        "a715d7b9b207b06eb97643e3bd699185.jpg",
        "b42fdc8e41edc94fccf368bfd4b14dcc.jpg",
        "b7d04a278028b3b72dfaf9b941cf022f-2.jpg",
        "be30655ca95a55d20c9348131e41da8b.jpg",
        "c37a36a7561bc6806484e413726380ed.jpg",
        "dea7785f3f7be6a34d2c22ee664bc7c1.jpg",
      ],
    },
    {
      name: "Helvetica",
      color: "#2f7fd1",
      files: [
        "04e3373959d756093501143411e1a6b9.jpg",
        "27bde0ee65e3d3d1886e70616c29d810.jpg",
        "a09e229a0716d7fe0b6d17cc9fb42802.jpg",
        "ced1f3e5651c00beb8e18c77ef174aea.jpg",
        "d923600d2101f0cef8ef591bfe5f4c09.jpg",
      ],
    },
    {
      name: "Palms and Venice",
      color: "#6eba72",
      files: [
        "06b69993d7fefbdb7a44df8f34873980.jpg",
        "169010f0d5b8b26058face2f45cc7a9b.jpg",
        "1ba2361c9540e268eaa89b4d5dee2977.jpg",
        "2aab8d87b0c0582f45597079ce559c5d.jpg",
        "552a5aaf3bcee70941a4f9a693be7ae5.jpg",
        "ceb410786e32bc1a454a7d92c21d6167.jpg",
        "e1c3446eab4243dcf946aa3660afecda.jpg",
        "eb063ea48936fc12110e967fcc016c43.jpg",
        "f8cc9483be104b2acd6895a0d9087ede.jpg",
      ],
    },
    {
      name: "Saved Works",
      color: "#c7f28a",
      files: [
        "cosmos_1053255589.jpeg",
        "cosmos_1058818968.jpeg",
        "cosmos_1442779170.jpeg",
        "cosmos_1481105096.jpeg",
        "cosmos_1539479796.jpeg",
        "cosmos_1607401651.jpeg",
        "cosmos_2004016514.jpeg",
        "cosmos_316989548.jpeg",
        "cosmos_453807681.jpeg",
        "cosmos_467791289.jpeg",
        "cosmos_571512865.jpeg",
        "cosmos_625591096.jpeg",
        "cosmos_774006560.jpeg",
        "cosmos_950462764.jpeg",
      ],
    },
  ];

  function _sb() {
    return window.supabaseClient;
  }

  function _slug(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function _demoAssetPath(folder, file) {
    return encodeURI(`assets/Bulletin Defaults/${folder}/${file}`);
  }

  function _demoPlacement(index, count) {
    const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(count))));
    const row = Math.floor(index / cols);
    const col = index % cols;
    const rows = Math.max(1, Math.ceil(count / cols));
    const spacingX = 240;
    const spacingY = 286;
    const x = (col - (cols - 1) / 2) * spacingX + (row % 2 ? 36 : 0);
    const y = (row - (rows - 1) / 2) * spacingY;

    return { x, y, pinW: 168 };
  }

  function _initDemoData() {
    const boards = [];
    const pins = [];

    DEMO_BOARD_CONFIGS.forEach((config, boardIndex) => {
      const boardId = `demo-board-${_slug(config.name)}`;
      boards.push({
        id: boardId,
        name: config.name,
        description: "",
        color: config.color || "#EEEBE7",
        source: "demo",
        arenaChannelId: null,
        createdAt: boardIndex + 1,
        groupId: null,
      });

      config.files.forEach((file, fileIndex) => {
        const pinId = `demo-pin-${_slug(config.name)}-${fileIndex + 1}`;
        pins.push({
          id: pinId,
          sharedPinId: pinId,
          tags: [config.name],
          imageUrl: _demoAssetPath(config.name, file),
          imageData: null,
          linkUrl: null,
          source: "demo",
          arenaBlockId: null,
          createdAt: (boardIndex * 1000) + fileIndex + 1,
          boardIds: [boardId],
          placements: {
            [boardId]: _demoPlacement(fileIndex, config.files.length),
          },
        });
      });
    });

    _data = { boards, pins, groups: [], connections: [] };
    _ready = true;
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
    if (_demoMode) return;
    _sb().from(table).insert(row).then(({ error }) => {
      if (error) console.error(`[Store] insert ${table}:`, error.message);
    });
  }

  function _dbUpdate(table, id, changes) {
    if (_demoMode) return;
    _sb().from(table).update(changes).eq("id", id).then(({ error }) => {
      if (error) console.error(`[Store] update ${table}:`, error.message);
    });
  }

  function _dbDelete(table, id) {
    if (_demoMode) return;
    _sb().from(table).delete().eq("id", id).then(({ error }) => {
      if (error) console.error(`[Store] delete ${table}:`, error.message);
    });
  }

  function _dbDeleteWhere(table, column, value) {
    if (_demoMode) return;
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

  async function init(userId, options = {}) {
    _userId = userId;
    _demoMode = !!options.demo || _userId === "demo-user";

    if (_demoMode) {
      _initDemoData();
      return;
    }

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
        tags: [], // WIPED: Fresh start with tags
        imageUrl: p.image_url || "",
        imageData: null, // no longer storing base64
        linkUrl: p.link_url || null,
        source: p.source || "local",
        arenaBlockId: p.arena_block_id || null,
        createdAt: new Date(p.created_at).getTime(),
        boardIds,
        placements,
      };
    }).filter(pin => pin.boardIds.length > 0 || pin.source === "network");

    const groups = (groupsRes.data || []).map(g => ({
      id: g.id,
      name: g.name || "Untitled Group",
      color: g.color || null,
      createdAt: new Date(g.created_at).getTime(),
    }));

    const connections = (connectionsRes.data || []).map(c => ({
      id: c.id,
      sourceId: c.source_id,
      targetId: c.target_id,
      createdAt: new Date(c.created_at).getTime(),
    }));

    _data = { boards, pins, groups, connections };

    // Migration/Cleanup: Wipe all tags from DB for a fresh start
    _sb().from("pins").update({ tags: [] }).neq("id", "00000000-0000-0000-0000-000000000000").then(({ error }) => {
      if (error) console.error("Error wiping tags:", error);
    });

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
      .map(pin => {
        const wasAttachedToDeletedBoard = pin.boardIds.includes(id);
        const nextPin = _detachPinFromBoardInternal(pin, id);
        return nextPin.boardIds.length > 0 || !wasAttachedToDeletedBoard ? nextPin : null;
      })
      .filter(Boolean);

    // Remove connections referencing this board
    _data.connections = _data.connections.filter(
      c => c.sourceId !== id && c.targetId !== id
    );

    // DB: cascade deletes handle board_pins; also clean up connections
    if (_demoMode) return;

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
    if (_demoMode) return;

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
      tags: _uniqueTags(tags),
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

    if (_demoMode) return getPin(pinId, nextBoardIds[0]);

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
      nextChanges.tags = _uniqueTags(nextChanges.tags);
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

    if (!_demoMode && Object.keys(dbChanges).length > 0) {
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

    if (!_demoMode && Object.keys(dbChanges).length > 0) {
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

    if (_demoMode) return getPin(id, boardId);

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

    if (_demoMode) return boardScopedPin;

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
    if (_demoMode) return URL.createObjectURL(file);

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
    if (_demoMode) return dataUrl;

    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = blob.type.split("/")[1] || "png";
    const file = new File([blob], `upload.${ext}`, { type: blob.type });
    return uploadImage(file);
  }

  // ── Explore: all public pins (cross-user) ───────

  async function getAllPublicPins() {
    if (_demoMode) {
      return _data.pins.map(pin => {
        const defaultBoardId = pin.boardIds[0] || null;
        const scopedPin = defaultBoardId ? _withBoardPlacement(pin, defaultBoardId) : pin;
        return {
          ...scopedPin,
          boardNames: pin.boardIds
            .map(boardId => _data.boards.find(board => board.id === boardId)?.name)
            .filter(Boolean),
        };
      });
    }

    const { data, error } = await _sb()
      .from("pins")
      .select("*, board_pins(*, boards(name))")
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
        boardNames: (p.board_pins || []).map(b => b.boards?.name).filter(Boolean),
        x: bp?.x ?? 0,
        y: bp?.y ?? 0,
        pinW: bp?.pin_w ?? null,
      };
    }).filter(p => p.imageUrl);
  }

  // ── Public API ──────────────────────────────────
  return {
    init,
    isDemoMode: () => _demoMode,
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
