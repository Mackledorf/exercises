/* ── bulletin · app.js ─ Coordinator module ───────── */

// ── Module imports ───────────────────────────────
import * as S from "./state.js";

import { screenToWorld } from "./utils.js";

import {
  zoom, attachWheelHandler, applyGridTransform,
  resetViewportToIdentity, cancelZoomInteraction,
  clearViewportInputCarryover, guardHomeWheelInput,
  runZoomTransition, requestTopbarVisibilityUpdate,
  updateBoardZoomUIVisibility, setTopbarAutoHidden,
  getPanBoundsWorld,
  getPendingHomeViewportGuard, setPendingHomeViewportGuard,
} from "./viewport.js";
import * as viewport from "./viewport.js";

import * as minimap from "./minimap.js";

import * as history from "./history.js";

import * as selection from "./selection.js";

import { initTransitions, computeHomeBoardPreviewGeometry } from "./transitions.js";

import * as home from "./home.js";

import * as board from "./board.js";

import * as modals from "./modals.js";

import * as explore from "./explore.js";

// ══════════════════════════════════════════════════
//  Coordinator helpers
// ══════════════════════════════════════════════════

function syncRenderedPinPosition(pinId, x, y) {
  const pinGroup = S.masterG.select(`g.pin-group[data-id="${pinId}"]`);
  if (pinGroup.empty()) return false;
  const pinData = pinGroup.datum();
  if (pinData) { pinData.x = x; pinData.y = y; }
  pinGroup.interrupt().attr("transform", `translate(${x},${y})`);
  return true;
}

function clonePin(pin) {
  if (!pin) return null;
  return { ...pin, tags: Array.isArray(pin.tags) ? pin.tags.slice() : [] };
}

// ══════════════════════════════════════════════════
//  Render dispatcher
// ══════════════════════════════════════════════════

function render() {
  const boards = Store.getBoards();
  const hasBoards = boards.length > 0;

  document.body.classList.toggle("profile-mode", S.currentView === "profile");
  document.body.classList.toggle("explore-mode", S.currentView === "explore");

  if (S.currentView === "explore") {
    setTopbarAutoHidden(false);
    document.body.classList.remove("zoom-ui-hidden");
    S.svg.node().style.cursor = "default";
    S.emptyState.hidden = true;
    S.fabGroup.hidden = true;
    S.profileView.hidden = true;
    S.exploreView.hidden = false;
    cancelZoomInteraction();
    resetViewportToIdentity();
    S.svg.on(".zoom", null);
    document.getElementById("zoom-indicator").style.display = "none";
    if (S.minimapContainerEl) S.minimapContainerEl.style.display = "none";
    explore.renderExplore();
  } else if (S.currentView === "profile") {
    setTopbarAutoHidden(false);
    document.body.classList.remove("zoom-ui-hidden");
    S.svg.node().style.cursor = "default";
    S.emptyState.hidden = true;
    S.fabGroup.hidden = true;
    S.profileView.hidden = false;
    S.exploreView.hidden = true;
    cancelZoomInteraction();
    resetViewportToIdentity();
    S.svg.on(".zoom", null);
    document.getElementById("zoom-indicator").style.display = "none";
    if (S.minimapContainerEl) S.minimapContainerEl.style.display = "none";
    modals.renderProfileView();
  } else {
    S.profileView.hidden = true;
    S.exploreView.hidden = true;
    S.emptyState.hidden = hasBoards;
    S.fabGroup.hidden = !hasBoards;

    if (S.currentView === "home") {
      setTopbarAutoHidden(false);
      document.body.classList.remove("zoom-ui-hidden");
      S.svg.node().style.removeProperty("cursor");
      cancelZoomInteraction();
      if (getPendingHomeViewportGuard()) {
        clearViewportInputCarryover();
        guardHomeWheelInput();
        setPendingHomeViewportGuard(false);
      }
      home.renderHome(boards);
      if (hasBoards) {
        S.svg.call(zoom).on("dblclick.zoom", null);
      } else {
        S.svg.on(".zoom", null);
      }
      document.getElementById("zoom-indicator").style.display = "block";
      if (S.minimapContainerEl) S.minimapContainerEl.style.display = "flex";
    } else if (S.currentView === "board") {
      S.svg.node().style.removeProperty("cursor");
      S.svg.call(zoom).on("dblclick.zoom", null);
      document.getElementById("zoom-indicator").style.display = "block";
      if (S.minimapContainerEl) S.minimapContainerEl.style.display = "flex";
      board.renderBoard(S.activeBoardId);
    }
  }

  const fabCenter = document.getElementById("fab-center-group");
  if (fabCenter) {
    fabCenter.classList.toggle("visible", S.currentView === "board");
  }

  const homeAddBoardGroup = home.ensureHomeAddBoardButton();
  homeAddBoardGroup.hidden = !(S.currentView === "home" && hasBoards);

  selection.syncSelectionModeUI();
  selection.updatePanBinding();

  minimap.updateMinimap();
  updateBoardZoomUIVisibility();
  requestTopbarVisibilityUpdate();
}

// ══════════════════════════════════════════════════
//  Module initialization
// ══════════════════════════════════════════════════

// DOM refs
S.initDOM();
S.setZoom(zoom);

// Viewport
viewport.init({
  render,
  hideQuickAdd: () => board.hideQuickAdd(),
  updateMinimap: () => minimap.updateMinimap(),
  requestMinimapUpdate: () => minimap.requestMinimapUpdate(),
});

// Minimap
minimap.init({
  getPanBoundsWorld,
});

// History
history.init({
  renderBoard: (id) => board.renderBoard(id),
  deselectPin: () => board.deselectPin(),
  updateMinimap: () => minimap.updateMinimap(),
});

// Selection
selection.init({
  deselectPin: () => board.deselectPin(),
  updateMinimap: () => minimap.updateMinimap(),
  rememberPinMove: (...a) => history.rememberPinMove(...a),
  render,
  syncRenderedPinPosition,
  computeHomeLayout: () => home.computeHomeLayout(),
  pushPinHistory: (e) => history.pushPinHistory(e),
});

// Transitions
initTransitions({
  getHomeBoardGridPositions: () => home.getHomeBoardGridPositions(),
});

// Home
home.init({
  enterBoard: (id, event) => board.enterBoard(id, event),
  openModal: (id) => modals.openModal(id),
  openEditBoardModal: (b) => modals.openEditBoardModal(b),
  openDeleteBoardConfirmation: (ids) => modals.openDeleteBoardConfirmation(ids),
  setSelectionModeActive: (v) => selection.setSelectionModeActive(v),
  render,
  deselectPin: () => board.deselectPin(),
  isSelectionModeEnabled: () => selection.isSelectionModeEnabled(),
  updateBreadcrumb: (b) => modals.updateBreadcrumb(b),
});

// Board
board.init({
  updateMinimap: () => minimap.updateMinimap(),
  requestMinimapUpdate: () => minimap.requestMinimapUpdate(),
  openAddPinModal: () => modals.openAddPinModal(),
  openEditPinModal: (pin) => modals.openEditPinModal(pin),
  render,
  renderMultiSelection: () => selection.renderMultiSelection(),
  clearMultiSelection: () => selection.clearMultiSelection(),
  isSelectionModeEnabled: () => selection.isSelectionModeEnabled(),
  updateBreadcrumb: (b) => modals.updateBreadcrumb(b),
  updatePanBinding: () => selection.updatePanBinding(),
  syncSelectionModeUI: () => selection.syncSelectionModeUI(),
  handleAlignmentAction: (a) => selection.handleAlignmentAction(a),
  setSelectionModeActive: (v) => selection.setSelectionModeActive(v),
  computeHomeBoardPreviewGeometry: (id) => computeHomeBoardPreviewGeometry(id),
});

// Modals
modals.init({
  renderBoard: (id) => board.renderBoard(id),
  render,
  enterBoard: (id, event) => board.enterBoard(id, event),
  exitBoard: () => board.exitBoard(),
  deselectPin: () => board.deselectPin(),
  updateMinimap: () => minimap.updateMinimap(),
  requestMinimapUpdate: () => minimap.requestMinimapUpdate(),
  resetPinMoveHistory: () => history.resetPinMoveHistory(),
});

// Explore
explore.init({
  render,
});

// ══════════════════════════════════════════════════
//  D3 zoom attachment & wheel
// ══════════════════════════════════════════════════

S.svg.call(zoom).on("dblclick.zoom", null);

// Block browser default double-tap-to-zoom
document.addEventListener("dblclick", (e) => {
  e.preventDefault();
}, { passive: false });

attachWheelHandler();

// ══════════════════════════════════════════════════
//  SVG pointer events (marquee, click, dblclick)
// ══════════════════════════════════════════════════

selection.initMarqueeListeners();

const canvasNode = S.svg.node();

canvasNode.addEventListener("dblclick", (event) => {
  if (S.currentView !== "board" && S.currentView !== "home") return;
  if (S.currentView === "board") {
    board.setSuppressQuickAddUntil(Date.now() + 250);
    board.hideQuickAdd();
  }

  if (!selection.isSelectionModeEnabled()) {
    selection.setSelectionModeActive(true);
    return;
  }

  if (event.target.closest && (event.target.closest("g.pin-group") || event.target.closest("g.board-node"))) return;
  S.setShiftSelectHeld(false);
  selection.setSelectionModeActive(false);
});

S.svg.on("click.quickadd", (event) => {
  if (S.currentView !== "board") return;
  if (selection.isSelectionModeEnabled() && !S.spacebarHeld) return;
  if (Date.now() < board.getSuppressQuickAddUntil()) return;

  const wasSelected = !!S.selectedPinId;
  if (!event.target.closest?.("g.pin-group")) board.deselectPin();

  if (wasSelected || event.target.classList?.contains("pin-hit-area")) {
    board.hideQuickAdd();
    return;
  }

  if (board.isQuickAddActive()) {
    const target = event.target;
    const qg = S.masterG.select(".quick-add-group").node();
    if (qg && qg.contains(target)) return;
  }

  if (event.target.classList && event.target.classList.contains("pin-hit-area")) return;
  if (event.target !== S.svg.node() && event.target.tagName !== "rect") return;

  board.showQuickAdd(event.clientX, event.clientY);
});

// ══════════════════════════════════════════════════
//  Keyboard shortcuts
// ══════════════════════════════════════════════════

document.addEventListener("keydown", (e) => {
  const isInput = ["INPUT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable;
  const hasOpenModal = !!document.querySelector(".modal-overlay:not([hidden])");
  if (isInput || hasOpenModal) return;

  // Home view: Delete selected boards
  if (S.currentView === "home") {
    if ((e.key === "Backspace" || e.key === "Delete") && S.multiSelectedBoardIds.size > 0) {
      e.preventDefault();
      modals.openDeleteBoardConfirmation(Array.from(S.multiSelectedBoardIds));
      return;
    }
  }

  if (!S.activeBoardId) return;

  // Shift → temporary selection mode
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    if (!S.selectionModeActive) {
      S.setShiftSelectHeld(true);
      selection.syncSelectionModeUI();
      selection.updatePanBinding();
    }
    return;
  }

  // Space → hand tool while in selection mode
  if (selection.isSelectionModeEnabled() && e.code === "Space") {
    e.preventDefault();
    if (!S.spacebarHeld) {
      S.setSpacebarHeld(true);
      selection.syncSelectionModeUI();
      selection.updatePanBinding();
    }
    return;
  }

  // Cmd+Z / Cmd+Shift+Z → undo / redo
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === "z") {
    e.preventDefault();
    if (e.shiftKey) history.redoPinMove();
    else history.undoPinMove();
    return;
  }

  // Delete multi-selected pins
  if (selection.isSelectionModeEnabled() && S.multiSelectedPinIds.size > 0 && (e.key === "Backspace" || e.key === "Delete")) {
    e.preventDefault();
    const pinsToDelete = Array.from(S.multiSelectedPinIds)
      .map((id) => Store.getPin(id, S.activeBoardId))
      .filter(Boolean);

    if (pinsToDelete.length > 0) {
      pinsToDelete.forEach((pin) => {
        history.removePinMoveHistory(pin.id);
        Store.detachPinFromBoard(pin.id, S.activeBoardId);
      });
      history.pushPinHistory({
        type: "batch",
        entries: pinsToDelete.map((pin) => ({
          type: "delete",
          pinId: pin.id,
          boardId: pin.boardId,
          pin: clonePin(pin),
        })),
      });
    }

    selection.clearMultiSelection();
    board.renderBoard(S.activeBoardId);
    return;
  }

  // Delete selected pin
  if (S.selectedPinId && (e.key === "Backspace" || e.key === "Delete")) {
    e.preventDefault();
    history.deletePinWithHistory(S.selectedPinId);
    board.deselectPin();
    board.renderBoard(S.activeBoardId);
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    S.setShiftSelectHeld(false);
    selection.syncSelectionModeUI();
    selection.updatePanBinding();
    return;
  }
  if (e.code !== "Space") return;
  if (!selection.isSelectionModeEnabled()) return;
  S.setSpacebarHeld(false);
  selection.syncSelectionModeUI();
  selection.updatePanBinding();
});

// ══════════════════════════════════════════════════
//  Window resize
// ══════════════════════════════════════════════════

window.addEventListener("resize", () => {
  S.setSize(window.innerWidth, window.innerHeight);
  S.svg.attr("viewBox", [0, 0, S.width, S.height]);
  minimap.setupMinimapCanvas();
  home.ensureHomeAddBoardButton();
  applyGridTransform(S.currentTransform, true);
  minimap.requestMinimapUpdate();
  requestTopbarVisibilityUpdate();
});

// ══════════════════════════════════════════════════
//  Navigation buttons
// ══════════════════════════════════════════════════

S.topbarLogo.addEventListener("click", () => {
  modals.hideAddPinButton();
  explore.destroyExplore();
  // Clear any existing state and go to home
  if (S.currentView === "board") {
    S.setActiveBoardId(null);
    history.resetPinMoveHistory();
    selection.setSelectionModeActive(false);
    S.multiSelectedBoardIds.clear();
  }
  resetViewportToIdentity();
  S.setCurrentView("home");
  window.history.pushState({ view: "home" }, "Home");
  render();
});

S.topbarProfileBtn.addEventListener("click", () => {
  modals.hideAddPinButton();
  S.setCurrentView("profile");
  render();
});

// Recenter / fit-to-board button
document.getElementById("btn-map-pin-house").addEventListener("click", () => {
  if (S.currentView === "board") {
    const pins = Store.getPins(S.activeBoardId);
    if (pins.length > 0) {
      const pad = 200;
      const xs = pins.map(p => p.x);
      const ys = pins.map(p => p.y);
      const x0 = d3.min(xs) - pad, x1 = d3.max(xs) + pad;
      const y0 = d3.min(ys) - pad, y1 = d3.max(ys) + pad;
      const scale = 1;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const tx = (innerWidth / 2) - (cx * scale);
      const ty = (innerHeight / 2) - (cy * scale);
      runZoomTransition(d3.zoomIdentity.translate(tx, ty).scale(scale));
    } else {
      runZoomTransition(d3.zoomIdentity);
    }
  }
});

// ══════════════════════════════════════════════════
//  Modal & button DOM bindings
// ══════════════════════════════════════════════════

modals.bindModalEvents();

// ══════════════════════════════════════════════════
//  Auth → Store init → first render
// ══════════════════════════════════════════════════

let _appInitialized = false;
let _bootInFlight = null;

async function bootApp(user) {
  if (_appInitialized) return;
  if (_bootInFlight) return _bootInFlight;

  _bootInFlight = (async () => {
    try {
      await Store.init(user.id);

      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      render();

      // Handle Are.na OAuth callback
      if (typeof Arena !== "undefined") {
        Arena.handleCallback().then(authed => {
          if (authed) {
            modals.refreshArenaModal();
            modals.openModal("modal-arena");
            render();
          }
        });
      }

      _appInitialized = true;
    } catch (err) {
      _appInitialized = false;
      console.error("[App] Store init failed:", err);
      throw err;
    } finally {
      _bootInFlight = null;
    }
  })();

  return _bootInFlight;
}

// Allow re-init on sign-in after sign-out
function resetApp() {
  _appInitialized = false;
  _bootInFlight = null;
}

Auth.init({
  onAuthReady: (user) => {
    bootApp(user).catch((err) => {
      console.error("[App] Boot failed:", err);
    });
  },
  onSignOut: () => {
    resetApp();
    // Force reload to clear all module states and return to auth view
    window.location.reload();
  },
});
