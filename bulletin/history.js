/* ── bulletin · history.js ─ Undo / Redo for pin operations ── */

import { currentView, activeBoardId, selectedPinId, masterG } from "./state.js";

const MOVE_HISTORY_LIMIT = 100;

let pinMoveUndoStack = [];
let pinMoveRedoStack = [];
let suppressHistoryRender = false;

// ── Callbacks (injected by coordinator) ──────────
let _renderBoard = null;
let _deselectPin = null;
let _updateMinimap = null;

export function init({ renderBoard, deselectPin, updateMinimap }) {
  _renderBoard = renderBoard;
  _deselectPin = deselectPin;
  _updateMinimap = updateMinimap;
}

// ── Public API ───────────────────────────────────

export function resetPinMoveHistory() {
  pinMoveUndoStack = [];
  pinMoveRedoStack = [];
}

export function removePinMoveHistory(pinId) {
  const touchesPin = (entry) => {
    if (!entry) return false;
    if (entry.type === "batch" && Array.isArray(entry.entries)) {
      return entry.entries.some(touchesPin);
    }
    return entry.pinId === pinId;
  };

  pinMoveUndoStack = pinMoveUndoStack.filter(entry => !touchesPin(entry));
  pinMoveRedoStack = pinMoveRedoStack.filter(entry => !touchesPin(entry));
}

function clonePin(pin) {
  if (!pin) return null;
  return {
    ...pin,
    tags: Array.isArray(pin.tags) ? pin.tags.slice() : [],
  };
}

export function pushPinHistory(entry) {
  pinMoveUndoStack.push(entry);
  if (pinMoveUndoStack.length > MOVE_HISTORY_LIMIT) pinMoveUndoStack.shift();
  pinMoveRedoStack = [];
}

export function rememberPinMove(pinId, boardId, fromPos, toPos) {
  if (fromPos.x === toPos.x && fromPos.y === toPos.y) return;
  pushPinHistory({ type: "move", pinId, boardId, fromPos, toPos });
}

export function rememberPinResize(pinId, boardId, fromState, toState) {
  if (fromState.x === toState.x && fromState.y === toState.y && fromState.pinW === toState.pinW) return;
  pushPinHistory({ type: "resize", pinId, boardId, fromState, toState });
}

export function rememberPinAdd(pin) {
  pushPinHistory({ type: "add", pinId: pin.id, boardId: pin.boardId, pin: clonePin(pin) });
}

export function rememberPinDelete(pin) {
  pushPinHistory({ type: "delete", pinId: pin.id, boardId: pin.boardId, pin: clonePin(pin) });
}

export function deletePinWithHistory(pinId) {
  const pin = Store.getPin(pinId, activeBoardId);
  if (!pin) return false;

  removePinMoveHistory(pinId);
  rememberPinDelete(pin);
  Store.detachPinFromBoard(pinId, activeBoardId);
  return true;
}

function restorePinFromSnapshot(pinSnapshot) {
  if (!pinSnapshot) return null;
  return Store.addPin(clonePin(pinSnapshot));
}

function syncRenderedPinPosition(pinId, x, y) {
  const pinGroup = masterG.select(`g.pin-group[data-id="${pinId}"]`);
  if (pinGroup.empty()) return false;

  const pinData = pinGroup.datum();
  if (pinData) {
    pinData.x = x;
    pinData.y = y;
  }

  pinGroup.interrupt().attr("transform", `translate(${x},${y})`);
  return true;
}

function applyPinMoveHistoryEntry(entry, position) {
  const pin = Store.getPin(entry.pinId, entry.boardId);
  if (!pin) return false;

  Store.updatePinPlacement(entry.pinId, entry.boardId, { x: position.x, y: position.y });

  if (currentView === "board" && activeBoardId === entry.boardId) {
    syncRenderedPinPosition(entry.pinId, position.x, position.y);
    _updateMinimap();
  }

  return true;
}

function applyPinResizeHistoryEntry(entry, state) {
  const pin = Store.getPin(entry.pinId, entry.boardId);
  if (!pin) return false;

  Store.updatePinPlacement(entry.pinId, entry.boardId, {
    x: state.x,
    y: state.y,
    pinW: state.pinW,
  });

  if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) {
    _renderBoard(entry.boardId);
  }

  return true;
}

function applyPinAddHistoryEntry(entry, isUndo) {
  if (isUndo) {
    const pin = Store.getPin(entry.pinId, entry.boardId);
    if (!pin) return false;
    Store.detachPinFromBoard(entry.pinId, entry.boardId);
    if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) {
      if (selectedPinId === entry.pinId) _deselectPin();
      _renderBoard(entry.boardId);
    }
    return true;
  }

  const restored = restorePinFromSnapshot(entry.pin);
  if (!restored) return false;
  if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) _renderBoard(entry.boardId);
  return true;
}

function applyPinDeleteHistoryEntry(entry, isUndo) {
  if (isUndo) {
    const restored = restorePinFromSnapshot(entry.pin);
    if (!restored) return false;
    if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) _renderBoard(entry.boardId);
    return true;
  }

  const pin = Store.getPin(entry.pinId, entry.boardId);
  if (!pin) return false;
  Store.detachPinFromBoard(entry.pinId, entry.boardId);
  if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) {
    if (selectedPinId === entry.pinId) _deselectPin();
    _renderBoard(entry.boardId);
  }
  return true;
}

function applyPinHistoryEntry(entry, isUndo) {
  if (!entry) return false;

  if (entry.type === "batch") {
    const entries = Array.isArray(entry.entries) ? entry.entries.slice() : [];
    if (entries.length === 0) return false;

    const ordered = isUndo ? entries.reverse() : entries;
    const needsSingleRender = ordered.some((sub) => sub.type === "add" || sub.type === "delete" || sub.type === "resize");
    const currentBoardTouched = ordered.some((sub) => sub.boardId === activeBoardId);
    let appliedCount = 0;
    const prevSuppress = suppressHistoryRender;
    suppressHistoryRender = suppressHistoryRender || needsSingleRender;
    for (const subEntry of ordered) {
      if (applyPinHistoryEntry(subEntry, isUndo)) appliedCount++;
    }
    suppressHistoryRender = prevSuppress;

    if (appliedCount > 0 && needsSingleRender && currentView === "board" && currentBoardTouched) {
      _renderBoard(activeBoardId);
    }

    return appliedCount > 0;
  }

  if (entry.type === "move") {
    return applyPinMoveHistoryEntry(entry, isUndo ? entry.fromPos : entry.toPos);
  }
  if (entry.type === "resize") {
    return applyPinResizeHistoryEntry(entry, isUndo ? entry.fromState : entry.toState);
  }
  if (entry.type === "add") {
    return applyPinAddHistoryEntry(entry, isUndo);
  }
  if (entry.type === "delete") {
    return applyPinDeleteHistoryEntry(entry, isUndo);
  }

  return false;
}

export function undoPinMove() {
  while (pinMoveUndoStack.length > 0) {
    const entry = pinMoveUndoStack.pop();
    if (!applyPinHistoryEntry(entry, true)) continue;
    pinMoveRedoStack.push(entry);
    return true;
  }
  return false;
}

export function redoPinMove() {
  while (pinMoveRedoStack.length > 0) {
    const entry = pinMoveRedoStack.pop();
    if (!applyPinHistoryEntry(entry, false)) continue;
    pinMoveUndoStack.push(entry);
    return true;
  }
  return false;
}
