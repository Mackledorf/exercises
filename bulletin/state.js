/* ── bulletin · state.js ─ Shared state, constants & DOM refs ── */

// ── Constants ──────────────────────────────────
export const GRID          = 24;
export const PIN_W         = 144;
export const PIN_H         = 192;
export const PIN_GAP       = 8;
export const SNAP_THRESH   = 12;
export const TRANSITION_MS = 500;
export const BOARD_NAV_OVERLAY_MS = TRANSITION_MS + 180;
export const BOARD_SPREAD  = 288;
export const WHEEL_ZOOM_SENS = 0.01;
export const ZOOM_SETTLE_MS = 150;
export const PAN_BOUND_SCREENS = 2.5;
export const MOVE_HISTORY_LIMIT = 100;
export const TOPBAR_CLIP_BUFFER = 6;
export const BOARD_LOADING_MIN_PINS = 20;
export const BOARD_LOADING_TARGET_READY = 6;
export const BOARD_LOADING_TIMEOUT_MS = 1500;
export const BOARD_PREVIEW_OFFSET_Y = 110;
export const BOARD_PREVIEW_MAX_W = 220;
export const BOARD_PREVIEW_MAX_H = 148;
export const BOARD_PREVIEW_PAD = 96;
export const HOME_WHEEL_GUARD_MS = 220;
export const HOME_GRID_CELL_W = 296;
export const HOME_GRID_CELL_H = 264;
export const HOME_GRID_PAD_X = 80;
export const HOME_GRID_PAD_Y = 110;
export const HOME_SECTION_GAP   = 52;
export const HOME_GROUP_LABEL_H = 44;
export const HOME_GROUP_CLUSTER_RADIUS = 360;
export const HOME_GROUP_CIRCLE_RADIUS = 34;
export const HOME_GROUP_CLUSTER_PAD = 90;
export const HOME_GROUP_HOVER_SCALE = 5.9;
export const HOME_GROUP_HOVER_RADIUS = HOME_GROUP_CIRCLE_RADIUS * HOME_GROUP_HOVER_SCALE;
export const PIN_HANDLE_R = 5;
export const PIN_SEL_EDIT_H = 26;
export const PIN_SEL_EDIT_W = 54;

// ── DOM refs (set once via initDOM) ──────────────
export let svg, masterG, emptyState, fabGroup, topbarEl, breadcrumb;
export let topbarLogo, topbarProfileBtn, profileView, exploreView, zoomLabel;
export let minimapEl, minimapContainerEl, mCtx;

// ── Viewport dimensions ──────────────────────────
export let width  = 0;
export let height = 0;

export function setSize(w, h) {
  width = w;
  height = h;
}

// ── Zoom behavior (set by viewport.js) ───────────
export let zoom = null;
export function setZoom(z) { zoom = z; }

// ── Shared mutable state ─────────────────────────
export let currentView   = "home";
export let activeBoardId = null;
export let selectedPinId = null;
export let selectionModeActive = false;
export let shiftSelectHeld = false;
export let spacebarHeld = false;
export let currentTransform = d3.zoomIdentity;
export let skipNextBoardAutoFit = false;
export let homeViewportInitialized = false;

export const multiSelectedPinIds = new Set();
export const multiSelectedBoardIds = new Set();

// Marquee
export let marqueeStart = null;
export let marqueeCurrent = null;
export let marqueePointerId = null;

export function setCurrentView(v) { currentView = v; }
export function setActiveBoardId(id) { activeBoardId = id; }
export function setSelectedPinId(id) { selectedPinId = id; }
export function setSelectionModeActiveFlag(v) { selectionModeActive = v; }
export function setShiftSelectHeld(v) { shiftSelectHeld = v; }
export function setSpacebarHeld(v) { spacebarHeld = v; }
export function setCurrentTransform(t) { currentTransform = t; }
export function setSkipNextBoardAutoFit(v) { skipNextBoardAutoFit = v; }
export function setHomeViewportInitialized(v) { homeViewportInitialized = v; }
export function setMarqueeStart(v) { marqueeStart = v; }
export function setMarqueeCurrent(v) { marqueeCurrent = v; }
export function setMarqueePointerId(v) { marqueePointerId = v; }

// ── DOM initialization ───────────────────────────
export function initDOM() {
  svg          = d3.select("#canvas");
  emptyState   = document.getElementById("empty-state");
  fabGroup     = document.getElementById("fab-group");
  topbarEl     = document.querySelector(".topbar");
  breadcrumb   = document.getElementById("breadcrumb");
  topbarLogo   = document.getElementById("topbar-logo");
  topbarProfileBtn = document.getElementById("topbar-profile");
  profileView  = document.getElementById("profile-view");
  exploreView  = document.getElementById("explore-view");
  zoomLabel    = document.getElementById("zoom-indicator");
  minimapEl    = document.getElementById("minimap");
  minimapContainerEl = document.querySelector(".minimap-container");
  mCtx         = minimapEl.getContext("2d");

  width  = window.innerWidth;
  height = window.innerHeight;
  svg.attr("viewBox", [0, 0, width, height]);

  masterG = svg.append("g");
}
