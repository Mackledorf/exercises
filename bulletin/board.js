/* ── bulletin · board.js ─ Board view rendering, pin interaction, quick-add ── */

import {
  currentView, setCurrentView,
  activeBoardId, setActiveBoardId,
  selectedPinId, setSelectedPinId,
  currentTransform, setCurrentTransform,
  multiSelectedPinIds, multiSelectedBoardIds,
  selectionModeActive, setSelectionModeActiveFlag,
  spacebarHeld,
  masterG, svg, width, height,
  PIN_W, PIN_H, PIN_GAP, SNAP_THRESH, GRID, TRANSITION_MS,
  PIN_HANDLE_R, PIN_SEL_EDIT_H, PIN_SEL_EDIT_W,
  emptyState, fabGroup, topbarEl, breadcrumb,
  skipNextBoardAutoFit, setSkipNextBoardAutoFit,
  homeViewportInitialized, setHomeViewportInitialized,
  zoom,
  BOARD_LOADING_MIN_PINS, BOARD_LOADING_TARGET_READY, BOARD_LOADING_TIMEOUT_MS,
} from "./state.js";

import {
  imageAspectCache, getPinImageSrc, loadImageAspect,
  roundToGrid, screenToWorld, escapeHtml,
} from "./utils.js";

import {
  runZoomTransition, computeBoardFitTransform,
  resetViewportToIdentity, getPinsWorldBounds,
  getBoardPinsForFitAndTransition, applyGridTransform,
  clearViewportInputCarryover, guardHomeWheelInput,
  requestTopbarVisibilityUpdate, updateBoardZoomUIVisibility,
} from "./viewport.js";

import { stopAllGroupSimulations } from "./home.js";

import {
  rememberPinMove, rememberPinResize, rememberPinAdd,
  resetPinMoveHistory, removePinMoveHistory,
  deletePinWithHistory, pushPinHistory,
} from "./history.js";

import {
  playBoardNavTransition, captureBoardGeometryFromDOM,
  captureHomeBoardGeometryFromDOM, getBoardPinsScreenGeometry,
  warmBoardImageAspects, cleanupBoardNavTransition,
  computeHomeBoardPreviewGeometry,
  isBoardNavTransitionActive,
} from "./transitions.js";

// ── Private state ────────────────────────────────
let quickAddG = null;
let quickAddActive = false;
let quickAddTimeout = null;
let suppressQuickAddUntil = 0;
let pendingPinPos = null;
let boardRenderToken = 0;
let boardLoadingTimer = null;

// ── Callback injection ───────────────────────────
let _updateMinimap = null;
let _requestMinimapUpdate = null;
let _openAddPinModal = null;
let _openEditPinModal = null;
let _render = null;
let _renderMultiSelection = null;
let _clearMultiSelection = null;
let _isSelectionModeEnabled = null;
let _updateBreadcrumb = null;
let _updatePanBinding = null;
let _syncSelectionModeUI = null;
let _handleAlignmentAction = null;
let _setSelectionModeActive = null;
let _computeHomeBoardPreviewGeometry = null;

export function init({
  updateMinimap,
  requestMinimapUpdate,
  openAddPinModal,
  openEditPinModal,
  render,
  renderMultiSelection,
  clearMultiSelection,
  isSelectionModeEnabled,
  updateBreadcrumb,
  updatePanBinding,
  syncSelectionModeUI,
  handleAlignmentAction,
  setSelectionModeActive,
  computeHomeBoardPreviewGeometry: computeHomeBoardPreviewGeometryFn,
}) {
  _updateMinimap = updateMinimap;
  _requestMinimapUpdate = requestMinimapUpdate;
  _openAddPinModal = openAddPinModal;
  _openEditPinModal = openEditPinModal;
  _render = render;
  _renderMultiSelection = renderMultiSelection;
  _clearMultiSelection = clearMultiSelection;
  _isSelectionModeEnabled = isSelectionModeEnabled;
  _updateBreadcrumb = updateBreadcrumb;
  _updatePanBinding = updatePanBinding;
  _syncSelectionModeUI = syncSelectionModeUI;
  _handleAlignmentAction = handleAlignmentAction;
  _setSelectionModeActive = setSelectionModeActive;
  _computeHomeBoardPreviewGeometry = computeHomeBoardPreviewGeometryFn;
}

// ── Quick-add bubble ─────────────────────────────

export function showQuickAdd(clientX, clientY) {
  if (currentView !== "board") return;

  const wx = (clientX - currentTransform.x) / currentTransform.k;
  const wy = (clientY - currentTransform.y) / currentTransform.k;
  const sx = Math.round(wx / GRID) * GRID;
  const sy = Math.round(wy / GRID) * GRID;

  pendingPinPos = { x: sx, y: sy };

  removeQuickAddDOM();

  quickAddG = masterG.append("g")
    .attr("class", "quick-add-group")
    .attr("transform", `translate(${sx},${sy})`)
    .style("cursor", "pointer");

  quickAddG.append("circle")
    .attr("r", 18)
    .attr("fill", "#fff")
    .attr("class", "quick-add-circle");

  quickAddG.append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("fill", "#1e1e1e")
    .attr("font-size", 20)
    .attr("font-weight", 300)
    .style("pointer-events", "none")
    .text("+");

  quickAddActive = true;

  if (quickAddTimeout) clearTimeout(quickAddTimeout);
  quickAddTimeout = setTimeout(() => hideQuickAdd(), 5000);
}

export function removeQuickAddDOM() {
  if (quickAddTimeout) { clearTimeout(quickAddTimeout); quickAddTimeout = null; }
  if (quickAddG) {
    quickAddG.remove();
    quickAddG = null;
  }
  quickAddActive = false;
}

export function hideQuickAdd() {
  removeQuickAddDOM();
  pendingPinPos = null;
}

export function isQuickAddActive() {
  return quickAddActive;
}

export function getSuppressQuickAddUntil() {
  return suppressQuickAddUntil;
}

export function setSuppressQuickAddUntil(t) {
  suppressQuickAddUntil = t;
}

export function getPendingPinPos() {
  return pendingPinPos;
}

export function consumePendingPinPos() {
  const pos = pendingPinPos;
  pendingPinPos = null;
  return pos;
}

// ── Snap position ────────────────────────────────

function snapPosition(d, pins) {
  const myL = d.x - d._pw / 2, myR = d.x + d._pw / 2;
  const myT = d.y - d._ph / 2, myB = d.y + d._ph / 2;

  let bestX = null, bestDX = SNAP_THRESH + 1;
  let bestY = null, bestDY = SNAP_THRESH + 1;

  for (const p of pins) {
    if (p.id === d.id) continue;
    const pw = p._pw || PIN_W, ph = p._ph || PIN_H;
    const pL = p.x - pw / 2, pR = p.x + pw / 2;
    const pT = p.y - ph / 2, pB = p.y + ph / 2;

    // ── X-axis candidates ──
    const dxLR = Math.abs(myL - (pR + PIN_GAP));
    if (dxLR < bestDX) { bestDX = dxLR; bestX = pR + PIN_GAP + d._pw / 2; }
    const dxRL = Math.abs(myR - (pL - PIN_GAP));
    if (dxRL < bestDX) { bestDX = dxRL; bestX = pL - PIN_GAP - d._pw / 2; }
    const dxLL = Math.abs(myL - pL);
    if (dxLL < bestDX) { bestDX = dxLL; bestX = pL + d._pw / 2; }
    const dxRR = Math.abs(myR - pR);
    if (dxRR < bestDX) { bestDX = dxRR; bestX = pR - d._pw / 2; }
    const dxCC = Math.abs(d.x - p.x);
    if (dxCC < bestDX) { bestDX = dxCC; bestX = p.x; }

    // ── Y-axis candidates ──
    const dyTB = Math.abs(myT - (pB + PIN_GAP));
    if (dyTB < bestDY) { bestDY = dyTB; bestY = pB + PIN_GAP + d._ph / 2; }
    const dyBT = Math.abs(myB - (pT - PIN_GAP));
    if (dyBT < bestDY) { bestDY = dyBT; bestY = pT - PIN_GAP - d._ph / 2; }
    const dyTT = Math.abs(myT - pT);
    if (dyTT < bestDY) { bestDY = dyTT; bestY = pT + d._ph / 2; }
    const dyBB = Math.abs(myB - pB);
    if (dyBB < bestDY) { bestDY = dyBB; bestY = pB - d._ph / 2; }
    const dyCCy = Math.abs(d.y - p.y);
    if (dyCCy < bestDY) { bestDY = dyCCy; bestY = p.y; }
  }

  d.x = (bestX !== null && bestDX <= SNAP_THRESH)
    ? bestX
    : Math.round(d.x / GRID) * GRID;
  d.y = (bestY !== null && bestDY <= SNAP_THRESH)
    ? bestY
    : Math.round(d.y / GRID) * GRID;
}

// ── Apply pin box dimensions to DOM ──────────────

function applyPinBox(g, d) {
  const setBox = (sel) => sel
    .attr("x", -d._pw / 2)
    .attr("y", -d._ph / 2)
    .attr("width", d._pw)
    .attr("height", d._ph);

  setBox(g.select(".pin-bg"));
  setBox(g.select(".pin-img"));
  setBox(g.select(".pin-hit-area"));
  setBox(g.select(".pin-select-outline"));

  d3.select(`#pin-clip-${d.id} rect`)
    .attr("x", -d._pw / 2)
    .attr("y", -d._ph / 2)
    .attr("width", d._pw)
    .attr("height", d._ph);
}

// ── Pin deselect / select ────────────────────────

export function deselectPin() {
  if (!selectedPinId) return;
  masterG.select(`g.pin-group[data-id="${selectedPinId}"]`)
    .selectAll(".pin-select-outline, .pin-handle, .pin-sel-edit")
    .remove();
  setSelectedPinId(null);
}

export function selectPin(d, gEl) {
  _clearMultiSelection();
  deselectPin();
  setSelectedPinId(d.id);
  d3.select(gEl).raise();
  const sel = d3.select(gEl);

  // White stroke outline
  sel.append("rect")
    .attr("class", "pin-select-outline")
    .attr("x", -d._pw / 2).attr("y", -d._ph / 2)
    .attr("width", d._pw).attr("height", d._ph)
    .attr("rx", 6).attr("ry", 6);

  // "Edit" SVG pill button under the pin
  const editG = sel.append("g")
    .attr("class", "pin-sel-edit")
    .attr("transform", `translate(0, ${d._ph / 2 + 12})`);

  editG.append("rect")
    .attr("class", "pin-sel-edit-bg")
    .attr("x", -PIN_SEL_EDIT_W / 2).attr("y", 0)
    .attr("width", PIN_SEL_EDIT_W).attr("height", PIN_SEL_EDIT_H)
    .attr("rx", PIN_SEL_EDIT_H / 2);

  editG.append("text")
    .attr("class", "pin-sel-edit-label")
    .attr("x", 0).attr("y", PIN_SEL_EDIT_H / 2)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .text("Edit");

  editG.on("click", (e) => { e.stopPropagation(); _openEditPinModal(d); });
  editG.on("pointerdown", (e) => e.stopPropagation());

  // Corner handles + resize
  [
    { key: "tl", cursor: "nwse-resize" },
    { key: "tr", cursor: "nesw-resize" },
    { key: "br", cursor: "nwse-resize" },
    { key: "bl", cursor: "nesw-resize" },
  ].forEach(({ key, cursor }) => {
    const getX = (pw) => (key === "tl" || key === "bl") ? -pw / 2 : pw / 2;
    const getY = (ph) => (key === "tl" || key === "tr") ? -ph / 2 : ph / 2;

    const hNode = sel.append("circle")
      .attr("class", "pin-handle")
      .attr("data-corner", key)
      .attr("cx", getX(d._pw)).attr("cy", getY(d._ph))
      .attr("r", PIN_HANDLE_R)
      .attr("cursor", cursor)
      .node();

    let resizing = false;
    let pivotX, pivotY;
    let resizeStartX, resizeStartY, resizeStartW;

    hNode.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      hNode.setPointerCapture(e.pointerId);
      resizing = true;
      svg.on(".zoom", null);
      resizeStartX = d.x;
      resizeStartY = d.y;
      resizeStartW = d._pw;

      pivotX = d.x + ((key === "tl" || key === "bl") ? d._pw / 2 : -d._pw / 2);
      pivotY = d.y + ((key === "tl" || key === "tr") ? d._ph / 2 : -d._ph / 2);
    });

    hNode.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);

      let targetW = Math.abs(wx - pivotX);
      targetW = Math.max(70, Math.min(560, Math.round(targetW / GRID) * GRID));

      const targetH = Math.round(targetW * d._aspect);

      d._pw = targetW;
      d._ph = targetH;

      const sigX = (key === "tl" || key === "bl") ? -1 : 1;
      const sigY = (key === "tl" || key === "tr") ? -1 : 1;

      d.x = pivotX + (sigX * d._pw / 2);
      d.y = pivotY + (sigY * d._ph / 2);

      gEl.setAttribute("transform", `translate(${d.x},${d.y})`);

      const g = d3.select(gEl);
      const setBox = (s) => s
        .attr("x", -d._pw / 2).attr("y", -d._ph / 2)
        .attr("width", d._pw).attr("height", d._ph);

      setBox(g.select(".pin-bg"));
      setBox(g.select(".pin-img"));
      setBox(g.select(".pin-hit-area"));
      setBox(g.select(".pin-select-outline"));

      d3.select(`#pin-clip-${d.id} rect`)
        .attr("x", -d._pw / 2).attr("y", -d._ph / 2)
        .attr("width", d._pw).attr("height", d._ph);

      g.selectAll(".pin-handle").each(function () {
        const k = this.dataset.corner;
        this.setAttribute("cx", (k === "tl" || k === "bl") ? -d._pw / 2 : d._pw / 2);
        this.setAttribute("cy", (k === "tl" || k === "tr") ? -d._ph / 2 : d._ph / 2);
      });

      g.select(".pin-sel-edit")
        .attr("transform", `translate(0, ${d._ph / 2 + 12})`);

      requestTopbarVisibilityUpdate();
    });

    function finalizeResize(pointerId) {
      if (!resizing) return;
      resizing = false;

      if (pointerId !== undefined && pointerId !== null) {
        try { hNode.releasePointerCapture(pointerId); } catch (err) { /* ignore */ }
      }

      svg.call(zoom).on("dblclick.zoom", null);
      d.pinW = d._pw;
      Store.updatePinPlacement(d.id, activeBoardId, { x: d.x, y: d.y, pinW: d._pw });
      rememberPinResize(
        d.id,
        activeBoardId,
        { x: resizeStartX, y: resizeStartY, pinW: resizeStartW },
        { x: d.x, y: d.y, pinW: d._pw }
      );
      _updateMinimap();
      requestTopbarVisibilityUpdate();
    }

    hNode.addEventListener("pointerup", (e) => {
      finalizeResize(e.pointerId);
    });

    hNode.addEventListener("pointercancel", () => {
      finalizeResize();
    });
  });
}

// ── Enter / Exit Board ───────────────────────────

export function enterBoard(boardId, event) {
  if (isBoardNavTransitionActive()) return;
  stopAllGroupSimulations();
  if (activeBoardId !== boardId || currentView !== "board") {
    resetPinMoveHistory();
  }
  _setSelectionModeActive(false);
  multiSelectedBoardIds.clear();

  if (currentView === "home") {
    resetViewportToIdentity();
    const pins = getBoardPinsForFitAndTransition(boardId);
    const targetTransform = computeBoardFitTransform(pins);
    const pinBounds = getPinsWorldBounds(pins);
    const board = Store.getBoard(boardId);
    const sourceGeometry = captureHomeBoardGeometryFromDOM(boardId) || (_computeHomeBoardPreviewGeometry ? _computeHomeBoardPreviewGeometry(boardId) : computeHomeBoardPreviewGeometry(boardId));
    const targetGeometry = getBoardPinsScreenGeometry(boardId, targetTransform);

    warmBoardImageAspects(boardId);

    if (sourceGeometry && targetGeometry && targetGeometry.pins.length > 0) {
      playBoardNavTransition("enter", board, sourceGeometry, targetGeometry);
    }

    svg.call(zoom).on("dblclick.zoom", null);
    setSkipNextBoardAutoFit(true);
    runZoomTransition(targetTransform, () => {
      setCurrentView("board");
      setActiveBoardId(boardId);
      _render();
    }, pinBounds ? {
      anchorWorld: { x: pinBounds.cx, y: pinBounds.cy },
      anchorScreen: { x: width / 2, y: height / 2 },
    } : { lockPan: true });
    return;
  }

  setCurrentView("board");
  setActiveBoardId(boardId);
  _render();
}

export function exitBoard() {
  if (isBoardNavTransitionActive()) return;
  resetPinMoveHistory();
  _setSelectionModeActive(false);
  multiSelectedBoardIds.clear();

  if (currentView === "board") {
    const boardId = activeBoardId;
    const board = Store.getBoard(boardId);
    const sourceGeometry = captureBoardGeometryFromDOM() || getBoardPinsScreenGeometry(boardId, currentTransform);
    const targetGeometry = _computeHomeBoardPreviewGeometry ? _computeHomeBoardPreviewGeometry(boardId) : computeHomeBoardPreviewGeometry(boardId);

    if (sourceGeometry && targetGeometry) {
      playBoardNavTransition("exit", board, sourceGeometry, targetGeometry);
    }

    runZoomTransition(d3.zoomIdentity, () => {
      setCurrentView("home");
      setActiveBoardId(null);
      // pendingHomeViewportGuard handled by app.js render
      setHomeViewportInitialized(false);
      resetViewportToIdentity();
      _render();
    });
    return;
  }

  setCurrentView("home");
  setActiveBoardId(null);
  setHomeViewportInitialized(false);
  _render();
}

// ── Render Board ─────────────────────────────────

export function renderBoard(boardId) {
  boardRenderToken++;
  const renderToken = boardRenderToken;
  setSelectedPinId(null);
  masterG.selectAll("*").remove();

  const existingVeil = document.getElementById("board-loading-veil");
  if (existingVeil) existingVeil.remove();
  if (boardLoadingTimer) {
    clearTimeout(boardLoadingTimer);
    boardLoadingTimer = null;
  }

  const board = Store.getBoard(boardId);
  if (!board) { exitBoard(); return; }

  _updateBreadcrumb(board);

  const pins = Store.getPins(boardId);

  // Show "Add Pin" button group
  let fabContainer = document.getElementById("fab-center-group");
  if (!fabContainer) {
    fabContainer = document.createElement("div");
    fabContainer.id = "fab-center-group";
    fabContainer.className = "fab-center-group visible";

    const alignPanel = document.createElement("div");
    alignPanel.id = "align-panel";
    alignPanel.className = "align-panel";
    alignPanel.innerHTML = `
      <button type="button" class="align-btn" data-align="align-left" title="Align Selection Left"><i data-lucide="align-start-vertical"></i></button>
      <button type="button" class="align-btn" data-align="align-center-h" title="Align Selection Center"><i data-lucide="align-center-vertical"></i></button>
      <button type="button" class="align-btn" data-align="align-right" title="Align Selection Right"><i data-lucide="align-end-vertical"></i></button>
      <button type="button" class="align-btn" data-align="distribute-h" title="Distribute Horizontally"><i data-lucide="align-horizontal-distribute-center"></i></button>
      <button type="button" class="align-btn" data-align="align-top" title="Align Selection Top"><i data-lucide="align-start-horizontal"></i></button>
      <button type="button" class="align-btn" data-align="align-center-v" title="Align Selection Middle"><i data-lucide="align-center-horizontal"></i></button>
      <button type="button" class="align-btn" data-align="align-bottom" title="Align Selection Bottom"><i data-lucide="align-end-horizontal"></i></button>
      <button type="button" class="align-btn" data-align="distribute-v" title="Distribute Vertically"><i data-lucide="align-vertical-distribute-center"></i></button>
    `;
    alignPanel.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-align]");
      if (!btn) return;
      _handleAlignmentAction(btn.dataset.align);
    });

    const actionRow = document.createElement("div");
    actionRow.className = "fab-main-row";

    const addPinBtn = document.createElement("button");
    addPinBtn.id = "fab-add-pin";
    addPinBtn.className = "btn btn-primary fab-add-pin-btn";
    addPinBtn.textContent = "+ Add Pin";
    addPinBtn.addEventListener("click", () => _openAddPinModal());

    const selectBtn = document.createElement("button");
    selectBtn.id = "btn-selection-mode";
    selectBtn.className = "fab-select-btn";
    selectBtn.title = "Selection Mode";
    selectBtn.innerHTML = `<i data-lucide="square-dashed-mouse-pointer"></i>`;
    selectBtn.addEventListener("click", () => {
      _setSelectionModeActive(!selectionModeActive);
    });

    actionRow.appendChild(addPinBtn);
    actionRow.appendChild(selectBtn);
    fabContainer.appendChild(alignPanel);
    fabContainer.appendChild(actionRow);
    document.body.appendChild(fabContainer);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
  fabContainer.classList.add("visible");
  _syncSelectionModeUI();

  if (pins.length === 0) {
    masterG.append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text)")
      .attr("font-size", 14)
      .attr("opacity", 0.3)
      .text("Click \u201C+ Add Pin\u201D to start building this board");
  }

  // Seed dimensions from cache/default, then hydrate aspect ratios progressively.
  pins.forEach((d) => {
    const src = getPinImageSrc(d);
    d._aspect = imageAspectCache.get(src) || d._aspect || (PIN_H / PIN_W);
    d._pw = d.pinW || d._pw || PIN_W;
    d._ph = Math.round(d._pw * d._aspect);
  });

  let readyCount = 0;
  const readyTarget = Math.min(BOARD_LOADING_TARGET_READY, pins.length);
  const shouldShowVeil = pins.length >= BOARD_LOADING_MIN_PINS;

  function hideBoardLoadingVeil() {
    const veil = document.getElementById("board-loading-veil");
    if (veil) {
      veil.classList.add("hidden");
      setTimeout(() => {
        if (veil.parentNode) veil.remove();
      }, 220);
    }
    if (boardLoadingTimer) {
      clearTimeout(boardLoadingTimer);
      boardLoadingTimer = null;
    }
  }

  if (shouldShowVeil) {
    const veil = document.createElement("div");
    veil.id = "board-loading-veil";
    veil.innerHTML = '<div class="board-loading-inner"><span class="board-loading-spinner"></span><span>Loading board...</span></div>';
    document.body.appendChild(veil);
    boardLoadingTimer = setTimeout(hideBoardLoadingVeil, BOARD_LOADING_TIMEOUT_MS);
  }

  // Render pin cards
  const pinGroups = masterG.selectAll("g.pin-group")
    .data(pins, d => d.id)
    .join("g")
    .attr("class", "pin-group")
    .attr("data-id", d => d.id)
    .attr("transform", d => `translate(${d.x},${d.y})`);

  // ── SVG defs for pin styling ──
  const defs = masterG.append("defs");

  pins.forEach(d => {
    defs.append("clipPath")
      .attr("id", `pin-clip-${d.id}`)
      .append("rect")
      .attr("width", d._pw)
      .attr("height", d._ph)
      .attr("x", -d._pw / 2)
      .attr("y", -d._ph / 2)
      .attr("rx", 6)
      .attr("ry", 6);
  });

  // Background rect
  pinGroups.append("rect")
    .attr("class", "pin-bg")
    .attr("width", d => d._pw)
    .attr("height", d => d._ph)
    .attr("x", d => -d._pw / 2)
    .attr("y", d => -d._ph / 2)
    .attr("rx", 6)
    .attr("ry", 6)
    .attr("fill", "#2c2c2c");

  // SVG <image>
  const pinImages = pinGroups.append("image")
    .attr("class", "pin-img")
    .attr("href", d => getPinImageSrc(d))
    .attr("width", d => d._pw)
    .attr("height", d => d._ph)
    .attr("x", d => -d._pw / 2)
    .attr("y", d => -d._ph / 2)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("clip-path", d => `url(#pin-clip-${d.id})`)
    .attr("pointer-events", "none");

  // Missing Link Label (Hidden by default)
  pinGroups.append("text")
    .attr("class", "pin-error-label")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("fill", "rgba(255, 255, 255, 0.35)")
    .attr("font-family", "var(--font-mono)")
    .attr("font-size", 12)
    .attr("font-weight", 500)
    .attr("pointer-events", "none")
    .attr("display", "none")
    .text("URL not found");

  // Interaction layer
  pinGroups.append("rect")
    .attr("class", "pin-hit-area")
    .attr("width", d => d._pw)
    .attr("height", d => d._ph)
    .attr("x", d => -d._pw / 2)
    .attr("y", d => -d._ph / 2)
    .attr("fill", "transparent")
    .attr("cursor", "grab");

  pinImages.each(function (d) {
    const gEl = this.parentNode;
    const src = getPinImageSrc(d);
    if (!src) return;

    loadImageAspect(src).then((aspect) => {
      if (renderToken !== boardRenderToken || currentView !== "board" || activeBoardId !== boardId) return;

      readyCount++;
      if (readyCount >= readyTarget) hideBoardLoadingVeil();

      const prevAspect = d._aspect;
      d._aspect = aspect;
      if (Math.abs(prevAspect - aspect) < 0.001) return;

      d._ph = Math.round(d._pw * d._aspect);
      applyPinBox(d3.select(gEl), d);
      requestTopbarVisibilityUpdate();
    }).catch(() => {
      if (renderToken !== boardRenderToken || currentView !== "board" || activeBoardId !== boardId) return;
      
      const g = d3.select(gEl);
      g.select(".pin-img").remove();
      g.select(".pin-error-label").attr("display", "block");
    });
  });

  // ── Pin drag via native pointer events ──

  const pinById = new Map(pins.map(pin => [pin.id, pin]));

  pinGroups.each(function (d) {
    const gEl = this;
    const hitRect = gEl.querySelector(".pin-hit-area");
    let originX, originY, startWX, startWY, moved;
    let dragIds = [];
    let dragOrigins = new Map();

    hitRect.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (_isSelectionModeEnabled() && spacebarHeld) return;

      e.stopPropagation();
      hitRect.setPointerCapture(e.pointerId);

      originX = d.x;
      originY = d.y;
      [startWX, startWY] = screenToWorld(e.clientX, e.clientY);
      moved = false;

      dragIds = (_isSelectionModeEnabled() && !spacebarHeld && multiSelectedPinIds.has(d.id))
        ? Array.from(multiSelectedPinIds).filter((id) => pinById.has(id))
        : [d.id];
      dragOrigins = new Map(dragIds.map((id) => {
        const pin = pinById.get(id);
        return [id, { x: pin.x, y: pin.y }];
      }));

      d3.select(gEl).raise();
      dragIds.forEach((id) => {
        const node = masterG.select(`g.pin-group[data-id="${id}"]`).node();
        if (node) d3.select(node).raise();
      });
      hitRect.style.cursor = "grabbing";

      svg.on(".zoom", null);
    });

    hitRect.addEventListener("pointermove", (e) => {
      if (originX == null) return;

      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      const dx = wx - startWX;
      const dy = wy - startWY;

      dragIds.forEach((id) => {
        const pin = pinById.get(id);
        const base = dragOrigins.get(id);
        if (!pin || !base) return;
        pin.x = base.x + dx;
        pin.y = base.y + dy;

        const node = masterG.select(`g.pin-group[data-id="${id}"]`).node();
        if (node) node.setAttribute("transform", `translate(${pin.x},${pin.y})`);
      });

      if (!moved && (Math.abs(dx) + Math.abs(dy) > 3)) {
        moved = true;
      }
      requestTopbarVisibilityUpdate();
    });

    function endDrag(e) {
      if (originX == null) return;
      hitRect.releasePointerCapture(e.pointerId);

      d3.select(gEl).attr("opacity", 1);
      hitRect.style.cursor = "grab";

      _updatePanBinding();

      if (moved) {
        const preSnapX = d.x;
        const preSnapY = d.y;
        snapPosition(d, pins);

        const snapDx = d.x - preSnapX;
        const snapDy = d.y - preSnapY;

        if (dragIds.length > 1 && (snapDx !== 0 || snapDy !== 0)) {
          dragIds.forEach((id) => {
            if (id === d.id) return;
            const pin = pinById.get(id);
            if (!pin) return;
            pin.x += snapDx;
            pin.y += snapDy;
          });
        }

        const movedEntries = [];
        dragIds.forEach((id) => {
          const pin = pinById.get(id);
          const base = dragOrigins.get(id);
          if (!pin || !base) return;
          const didMove = pin.x !== base.x || pin.y !== base.y;

          const node = masterG.select(`g.pin-group[data-id="${id}"]`);
          node.transition().duration(150).attr("transform", `translate(${pin.x},${pin.y})`);

          if (!didMove) return;
          Store.updatePinPlacement(id, boardId, { x: pin.x, y: pin.y });
          movedEntries.push({
            type: "move",
            pinId: id,
            boardId,
            fromPos: { x: base.x, y: base.y },
            toPos: { x: pin.x, y: pin.y },
          });
        });

        if (movedEntries.length === 1) {
          const entry = movedEntries[0];
          rememberPinMove(entry.pinId, entry.boardId, entry.fromPos, entry.toPos);
        } else if (movedEntries.length > 1) {
          pushPinHistory({ type: "batch", entries: movedEntries });
        }

        if (movedEntries.length > 0) {
          _updateMinimap();
        }
      } else {
        dragIds.forEach((id) => {
          const pin = pinById.get(id);
          const base = dragOrigins.get(id);
          if (!pin || !base) return;
          pin.x = base.x;
          pin.y = base.y;
          const node = masterG.select(`g.pin-group[data-id="${id}"]`).node();
          if (node) node.setAttribute("transform", `translate(${pin.x},${pin.y})`);
        });

        if (_isSelectionModeEnabled() && !spacebarHeld) {
          deselectPin();
          if (e.shiftKey) {
            if (multiSelectedPinIds.has(d.id)) {
              multiSelectedPinIds.delete(d.id);
            } else {
              multiSelectedPinIds.add(d.id);
            }
          } else {
            const hasOnlyThis = multiSelectedPinIds.has(d.id) && multiSelectedPinIds.size === 1;
            if (hasOnlyThis) {
              multiSelectedPinIds.clear();
            } else {
              multiSelectedPinIds.clear();
              multiSelectedPinIds.add(d.id);
            }
          }
          _renderMultiSelection();
          if (multiSelectedPinIds.size > 0 && !selectionModeActive) {
            _setSelectionModeActive(true);
          }
        } else {
          selectPin(d, gEl);
        }
      }

      requestTopbarVisibilityUpdate();

      originX = originY = null;
      dragIds = [];
      dragOrigins.clear();
    }

    hitRect.addEventListener("pointerup", endDrag);
    hitRect.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      _openEditPinModal(d);
    });
    hitRect.addEventListener("pointercancel", () => {
      d3.select(gEl).attr("opacity", 1);
      hitRect.style.cursor = "grab";
      _updatePanBinding();
      if (originX != null) {
        dragIds.forEach((id) => {
          const pin = pinById.get(id);
          const base = dragOrigins.get(id);
          if (!pin || !base) return;
          pin.x = base.x;
          pin.y = base.y;
          const node = masterG.select(`g.pin-group[data-id="${id}"]`).node();
          if (node) node.setAttribute("transform", `translate(${pin.x},${pin.y})`);
        });
      }
      requestTopbarVisibilityUpdate();
      originX = originY = null;
      dragIds = [];
      dragOrigins.clear();
    });
  });

  _renderMultiSelection();

  // Zoom to fit pins, or keep transform when already coming from a home->board transition.
  if (skipNextBoardAutoFit) {
    setSkipNextBoardAutoFit(false);
  } else {
    runZoomTransition(computeBoardFitTransform(pins.length > 0 ? pins : getBoardPinsForFitAndTransition(boardId)));
  }

  if (!shouldShowVeil) hideBoardLoadingVeil();
  requestTopbarVisibilityUpdate();
}

// ── New pin placement helper ─────────────────────

export function getNewPinPlacement(index = 0) {
  if (pendingPinPos) {
    const basePos = { x: pendingPinPos.x, y: pendingPinPos.y };
    if (index === 0) {
      pendingPinPos = null;
      return basePos;
    }

    return {
      x: basePos.x + (index % 3) * GRID * 2,
      y: basePos.y + Math.floor(index / 3) * GRID * 2,
    };
  }

  const cx = (-currentTransform.x + width / 2) / currentTransform.k;
  const cy = (-currentTransform.y + height / 2) / currentTransform.k;
  const column = index % 3;
  const row = Math.floor(index / 3);
  const ox = (column - 1) * GRID * 2;
  const oy = row * GRID * 2;
  return {
    x: Math.round((cx + ox) / GRID) * GRID,
    y: Math.round((cy + oy) / GRID) * GRID,
  };
}
