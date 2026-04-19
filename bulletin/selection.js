/* ── bulletin · selection.js ─ Multi-select, marquee & alignment ── */

import {
  selectionModeActive, setSelectionModeActiveFlag,
  shiftSelectHeld, setShiftSelectHeld,
  spacebarHeld, setSpacebarHeld,
  multiSelectedPinIds, multiSelectedBoardIds,
  masterG, svg, currentView, activeBoardId,
  currentTransform, width, height,
  PIN_W, PIN_H, GRID,
  marqueeStart, marqueeCurrent, marqueePointerId,
  setMarqueeStart, setMarqueeCurrent, setMarqueePointerId,
  zoom,
  HOME_GRID_CELL_W, HOME_GRID_CELL_H,
} from "./state.js";

import {
  roundToGrid, screenToWorld,
  compareByXThenYThenId, compareByYThenXThenId,
  imageAspectCache, getPinImageSrc,
} from "./utils.js";

// ── Callback injection ───────────────────────────
let _deselectPin   = () => {};
let _updateMinimap = () => {};
let _rememberPinMove = () => {};
let _render        = () => {};
let _zoom          = null;
let _syncRenderedPinPosition = () => false;
let _computeHomeLayout = () => ({ allBoardPositions: new Map() });
let _pushPinHistory = () => {};

export function init({
  deselectPin,
  updateMinimap,
  rememberPinMove,
  render,
  syncRenderedPinPosition,
  computeHomeLayout,
  pushPinHistory,
}) {
  if (deselectPin)   _deselectPin   = deselectPin;
  if (updateMinimap) _updateMinimap = updateMinimap;
  if (rememberPinMove) _rememberPinMove = rememberPinMove;
  if (render)        _render        = render;
  if (syncRenderedPinPosition) _syncRenderedPinPosition = syncRenderedPinPosition;
  if (computeHomeLayout) _computeHomeLayout = computeHomeLayout;
  if (pushPinHistory) _pushPinHistory = pushPinHistory;
}

// ── Selection mode toggle ────────────────────────

export function setSelectionModeActive(nextActive) {
  setSelectionModeActiveFlag(!!nextActive);
  if (!nextActive) {
    clearMultiSelection();
    multiSelectedBoardIds.clear();
    setSpacebarHeld(false);
  } else {
    _deselectPin();
  }
  syncSelectionModeUI();
  updatePanBinding();
  if (currentView === "home") _render();
}

export function isSelectionModeEnabled() {
  return selectionModeActive || shiftSelectHeld;
}

// ── Multi-selection rendering ────────────────────

export function clearMultiSelection() {
  multiSelectedPinIds.clear();
  masterG.selectAll(".pin-multi-select-outline").remove();
  updateAlignmentPanelVisibility();
}

export function renderMultiSelection() {
  masterG.selectAll("g.pin-group").each(function (pin) {
    const group = d3.select(this);
    const isSelected = multiSelectedPinIds.has(pin.id);
    const outline = group.selectAll(".pin-multi-select-outline").data(isSelected ? [pin] : []);

    outline
      .join("rect")
      .attr("class", "pin-multi-select-outline")
      .attr("x", -pin._pw / 2)
      .attr("y", -pin._ph / 2)
      .attr("width", pin._pw)
      .attr("height", pin._ph)
      .attr("rx", 6)
      .attr("ry", 6);
  });

  updateAlignmentPanelVisibility();
}

// ── Alignment panel ──────────────────────────────

export function updateAlignmentPanelVisibility() {
  const panel = document.getElementById("align-panel");
  if (!panel) return;
  panel.classList.toggle("visible", multiSelectedPinIds.size >= 2);
}

export function getSelectedPinsForAlignment() {
  if (!activeBoardId || multiSelectedPinIds.size < 2) return [];

  const selected = [];
  masterG.selectAll("g.pin-group").each(function (pin) {
    if (multiSelectedPinIds.has(pin.id)) {
      selected.push(pin);
    }
  });
  return selected;
}

export function getSelectionBounds(pins) {
  const left = Math.min(...pins.map((pin) => pin.x - pin._pw / 2));
  const right = Math.max(...pins.map((pin) => pin.x + pin._pw / 2));
  const top = Math.min(...pins.map((pin) => pin.y - pin._ph / 2));
  const bottom = Math.max(...pins.map((pin) => pin.y + pin._ph / 2));

  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

// ── Anchor helpers ───────────────────────────────

export function getPinAnchorValue(pin, axis, anchor) {
  if (axis === "x") {
    if (anchor === "left") return pin.x - pin._pw / 2;
    if (anchor === "right") return pin.x + pin._pw / 2;
    return pin.x;
  }

  if (anchor === "top") return pin.y - pin._ph / 2;
  if (anchor === "bottom") return pin.y + pin._ph / 2;
  return pin.y;
}

export function getCenterFromAnchor(pin, axis, anchor, target) {
  if (axis === "x") {
    if (anchor === "left") return target + pin._pw / 2;
    if (anchor === "right") return target - pin._pw / 2;
    return target;
  }

  if (anchor === "top") return target + pin._ph / 2;
  if (anchor === "bottom") return target - pin._ph / 2;
  return target;
}

// ── Alignment actions ────────────────────────────

export function alignSelectionToAnchor(axis, anchor) {
  const selected = getSelectedPinsForAlignment();
  if (selected.length < 2) return;

  const target = axis === "x"
    ? (anchor === "left"
        ? Math.min(...selected.map((pin) => getPinAnchorValue(pin, "x", "left")))
        : anchor === "right"
          ? Math.max(...selected.map((pin) => getPinAnchorValue(pin, "x", "right")))
          : getSelectionBounds(selected).centerX)
    : (anchor === "top"
        ? Math.min(...selected.map((pin) => getPinAnchorValue(pin, "y", "top")))
        : anchor === "bottom"
          ? Math.max(...selected.map((pin) => getPinAnchorValue(pin, "y", "bottom")))
          : getSelectionBounds(selected).centerY);

  const next = new Map();
  selected.forEach((pin) => {
    if (axis === "x") {
      next.set(pin.id, {
        x: getCenterFromAnchor(pin, "x", anchor, target),
        y: pin.y,
      });
      return;
    }

    next.set(pin.id, {
      x: pin.x,
      y: getCenterFromAnchor(pin, "y", anchor, target),
    });
  });

  applyBatchPinPositions(next, { snapX: false, snapY: false });
}

export function applyBatchPinPositions(nextPositions, options = {}) {
  if (!activeBoardId || !nextPositions || nextPositions.size === 0) return;

  const {
    snapX = true,
    snapY = true,
  } = options;

  const movedEntries = [];
  nextPositions.forEach((nextPos, pinId) => {
    const pin = Store.getPin(pinId, activeBoardId);
    if (!pin) return;

    const snappedX = snapX ? roundToGrid(nextPos.x) : nextPos.x;
    const snappedY = snapY ? roundToGrid(nextPos.y) : nextPos.y;
    const fromPos = { x: pin.x, y: pin.y };
    const toPos = { x: snappedX, y: snappedY };

    if (fromPos.x === toPos.x && fromPos.y === toPos.y) return;

    Store.updatePinPlacement(pinId, activeBoardId, toPos);
    _syncRenderedPinPosition(pinId, toPos.x, toPos.y);

    movedEntries.push({
      type: "move",
      pinId,
      boardId: activeBoardId,
      fromPos,
      toPos,
    });
  });

  if (movedEntries.length === 0) return;

  _pushPinHistory({ type: "batch", entries: movedEntries });
  _updateMinimap();
  renderMultiSelection();
}

export function alignSelectionLeft() {
  alignSelectionToAnchor("x", "left");
}

export function alignSelectionCenterHorizontal() {
  alignSelectionToAnchor("x", "center");
}

export function alignSelectionRight() {
  alignSelectionToAnchor("x", "right");
}

export function alignSelectionTop() {
  alignSelectionToAnchor("y", "top");
}

export function alignSelectionCenterVertical() {
  alignSelectionToAnchor("y", "center");
}

export function alignSelectionBottom() {
  alignSelectionToAnchor("y", "bottom");
}

// ── Distribution ─────────────────────────────────

export function distributeSelectionHorizontal() {
  const selected = getSelectedPinsForAlignment();
  if (selected.length < 3) return;

  const sorted = selected.slice().sort(compareByXThenYThenId);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || first.id === last.id) return;

  const step = (last.x - first.x) / (sorted.length - 1);
  if (!Number.isFinite(step)) return;

  const next = new Map();
  for (let i = 1; i < sorted.length - 1; i++) {
    const pin = sorted[i];
    next.set(pin.id, {
      x: first.x + step * i,
      y: pin.y,
    });
  }

  if (next.size === 0) return;

  applyBatchPinPositions(next, { snapX: true, snapY: false });
}

export function distributeSelectionVertical() {
  const selected = getSelectedPinsForAlignment();
  if (selected.length < 3) return;

  const sorted = selected.slice().sort(compareByYThenXThenId);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || first.id === last.id) return;

  const step = (last.y - first.y) / (sorted.length - 1);
  if (!Number.isFinite(step)) return;

  const next = new Map();
  for (let i = 1; i < sorted.length - 1; i++) {
    const pin = sorted[i];
    next.set(pin.id, {
      x: pin.x,
      y: first.y + step * i,
    });
  }

  if (next.size === 0) return;

  applyBatchPinPositions(next, { snapX: false, snapY: true });
}

// ── Action dispatcher ────────────────────────────

export function handleAlignmentAction(action) {
  const handlers = {
    "align-left": alignSelectionLeft,
    "align-center-h": alignSelectionCenterHorizontal,
    "align-right": alignSelectionRight,
    "align-top": alignSelectionTop,
    "align-center-v": alignSelectionCenterVertical,
    "align-bottom": alignSelectionBottom,
    "distribute-h": distributeSelectionHorizontal,
    "distribute-v": distributeSelectionVertical,
  };

  const handler = handlers[action];
  if (handler) handler();
}

// ── UI sync ──────────────────────────────────────

export function syncSelectionModeUI() {
  const selectBtn = document.getElementById("btn-selection-mode");
  const homeSelectBtn = document.getElementById("btn-home-selection-mode");

  if (selectBtn) selectBtn.classList.toggle("active", isSelectionModeEnabled());
  if (homeSelectBtn) homeSelectBtn.classList.toggle("active", isSelectionModeEnabled());

  updateAlignmentPanelVisibility();
  // updateHomeActionRow is in app.js — called via render or separately
  const canvasNode = svg.node();
  if (!canvasNode) return;
  if (currentView !== "board" && currentView !== "home") {
    canvasNode.style.removeProperty("cursor");
    return;
  }
  if (!isSelectionModeEnabled()) {
    canvasNode.style.removeProperty("cursor");
    return;
  }

  canvasNode.style.cursor = spacebarHeld ? "grab" : "crosshair";
}

export function updatePanBinding() {
  if (currentView !== "board" && currentView !== "home") return;
  if (isSelectionModeEnabled() && !spacebarHeld && marqueePointerId == null) {
    svg.on(".zoom", null);
    return;
  }
  svg.call(zoom).on("dblclick.zoom", null);
}

// ── Marquee ──────────────────────────────────────

export function removeMarquee() {
  masterG.selectAll(".selection-marquee").remove();
  setMarqueeStart(null);
  setMarqueeCurrent(null);
  setMarqueePointerId(null);
}

export function drawMarquee() {
  if (!marqueeStart || !marqueeCurrent) return;

  const x = Math.min(marqueeStart.x, marqueeCurrent.x);
  const y = Math.min(marqueeStart.y, marqueeCurrent.y);
  const w = Math.abs(marqueeCurrent.x - marqueeStart.x);
  const h = Math.abs(marqueeCurrent.y - marqueeStart.y);

  masterG.selectAll(".selection-marquee")
    .data([{ x, y, w, h }])
    .join("rect")
    .attr("class", "selection-marquee")
    .attr("x", d => d.x)
    .attr("y", d => d.y)
    .attr("width", d => d.w)
    .attr("height", d => d.h);
}

export function commitMarqueeSelection() {
  if (!marqueeStart || !marqueeCurrent || !(activeBoardId || currentView === "home")) {
    removeMarquee();
    return;
  }

  const x0 = Math.min(marqueeStart.x, marqueeCurrent.x);
  const y0 = Math.min(marqueeStart.y, marqueeCurrent.y);
  const x1 = Math.max(marqueeStart.x, marqueeCurrent.x);
  const y1 = Math.max(marqueeStart.y, marqueeCurrent.y);
  const isClickLike = (x1 - x0) < 3 && (y1 - y0) < 3;

  if (isClickLike) {
    if (currentView === "board") {
      clearMultiSelection();
      renderMultiSelection();
    } else if (currentView === "home") {
      multiSelectedBoardIds.clear();
      _render();
    }
    removeMarquee();
    return;
  }

  if (currentView === "board" && activeBoardId) {
    multiSelectedPinIds.clear();
    Store.getPins(activeBoardId).forEach((pin) => {
      const pinW = pin._pw || pin.pinW || PIN_W;
      const pinH = pin._ph || Math.round(pinW * (pin._aspect || (PIN_H / PIN_W)));
      const pinLeft = pin.x - pinW / 2;
      const pinRight = pin.x + pinW / 2;
      const pinTop = pin.y - pinH / 2;
      const pinBottom = pin.y + pinH / 2;

      const overlaps = pinLeft <= x1 && pinRight >= x0 && pinTop <= y1 && pinBottom >= y0;
      if (overlaps) multiSelectedPinIds.add(pin.id);
    });
    renderMultiSelection();
    if (multiSelectedPinIds.size > 0 && !selectionModeActive) {
      setSelectionModeActive(true);
    }
  } else if (currentView === "home") {
    multiSelectedBoardIds.clear();
    const boards = Store.getBoards();
    const { allBoardPositions } = _computeHomeLayout();
    boards.forEach(b => {
      const pos = allBoardPositions.get(b.id);
      if (!pos) return;
      const bw = HOME_GRID_CELL_W - 40;
      const bh = HOME_GRID_CELL_H - 40;
      const bLeft = pos.x - bw / 2;
      const bRight = pos.x + bw / 2;
      const bTop = pos.y - bh / 2;
      const bBottom = pos.y + bh / 2;

      const overlaps = bLeft <= x1 && bRight >= x0 && bTop <= y1 && bBottom >= y0;
      if (overlaps) multiSelectedBoardIds.add(b.id);
    });
    _render();
    if (multiSelectedBoardIds.size > 0 && !selectionModeActive) {
      setSelectionModeActive(true);
    }
  }

  removeMarquee();
}

// ── Marquee pointer handlers ─────────────────────

export function initMarqueeListeners() {
  const canvasNode = svg.node();

  canvasNode.addEventListener("pointerdown", (event) => {
    if ((currentView !== "board" && currentView !== "home") || !isSelectionModeEnabled() || spacebarHeld) return;
    if (event.button !== 0) return;
    if (event.target.closest && (event.target.closest("g.pin-group") || event.target.closest("g.board-node"))) return;

    const [wx, wy] = screenToWorld(event.clientX, event.clientY);
    setMarqueeStart({ x: wx, y: wy });
    setMarqueeCurrent({ x: wx, y: wy });
    setMarqueePointerId(event.pointerId);
    try { canvasNode.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }

    if (currentView === "board") {
      _deselectPin();
    } else {
      multiSelectedBoardIds.clear();
      _render();
    }

    svg.on(".zoom", null);
    drawMarquee();
    event.preventDefault();
  });

  canvasNode.addEventListener("pointermove", (event) => {
    if (currentView !== "board" && currentView !== "home") return;
    if (marqueePointerId == null || event.pointerId !== marqueePointerId) return;

    const [wx, wy] = screenToWorld(event.clientX, event.clientY);
    setMarqueeCurrent({ x: wx, y: wy });
    drawMarquee();
    event.preventDefault();
  });

  function finalizeMarquee(event) {
    if (marqueePointerId == null) return;
    if (event.pointerId !== marqueePointerId) return;
    try { canvasNode.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }

    commitMarqueeSelection();
    updatePanBinding();
  }

  canvasNode.addEventListener("pointerup", finalizeMarquee);
  canvasNode.addEventListener("pointercancel", finalizeMarquee);
}
