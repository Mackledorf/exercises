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
export const BOARD_PREVIEW_OFFSET_Y = 0;
export const BOARD_PREVIEW_MAX_W = 100;
export const BOARD_PREVIEW_MAX_H = 100;
export const BOARD_PREVIEW_PAD = 16;
export const HOME_WHEEL_GUARD_MS = 220;

// ── Bubble sizes (golden-ratio steps: 100 → 162 → 262) ──
export const BUBBLE_SMALL  = 100;   // group default diameter
export const BUBBLE_MEDIUM = 162;  // board default diameter
export const BUBBLE_LARGE  = 300;  // hover state diameter
export const BUBBLE_GAP    = 60;   // desired visual gap between bubble edges

// Layout spacing (enough room for hover growth + breathing room)
export const HOME_GRID_CELL_W = BUBBLE_LARGE + BUBBLE_GAP;
export const HOME_GRID_CELL_H = BUBBLE_LARGE + BUBBLE_GAP;
export const HOME_GRID_PAD_X = 80;
export const HOME_GRID_PAD_Y = 110;
export const HOME_SECTION_GAP   = 52;
export const HOME_GROUP_LABEL_H = 44;
export const HOME_GROUP_CLUSTER_RADIUS = BUBBLE_LARGE + BUBBLE_GAP;
export const HOME_GROUP_CIRCLE_RADIUS = BUBBLE_SMALL / 2;
export const HOME_GROUP_CLUSTER_PAD = 40;
export const HOME_GROUP_HOVER_SCALE = BUBBLE_LARGE / BUBBLE_SMALL;
export const HOME_GROUP_HOVER_RADIUS = BUBBLE_LARGE / 2;
export const PIN_HANDLE_R = 5;
export const PIN_SEL_EDIT_H = 26;
export const PIN_SEL_EDIT_W = 54;
export const COMPACT_VIEWPORT_MAX_W = 767;
export const COMPACT_VIEWPORT_MAX_H = 600;
export const COMPACT_TOPBAR_H = 48;

// ── DOM refs (set once via initDOM) ──────────────
export let svg, masterG, emptyState, fabGroup, fabGroupLeft, topbarEl, breadcrumb;
export let topbarLogo, topbarProfileBtn, profileView, exploreView, networkView, zoomLabel;
export let minimapEl, minimapContainerEl, mCtx;

// ── Viewport dimensions ──────────────────────────
export let width  = 0;
export let height = 0;
export let visualWidth = 0;
export let visualHeight = 0;
export let visualOffsetTop = 0;
export let visualOffsetLeft = 0;

export function setSize(w, h) {
  setViewportMetrics({ width: w, height: h });
}

export function setViewportMetrics(metrics = {}) {
  const nextW = Math.max(1, Math.round(metrics.width || window.innerWidth || 1));
  const nextH = Math.max(1, Math.round(metrics.height || window.innerHeight || 1));
  width = nextW;
  height = nextH;
  visualWidth = nextW;
  visualHeight = nextH;
  visualOffsetTop = Math.max(0, Math.round(metrics.offsetTop || 0));
  visualOffsetLeft = Math.max(0, Math.round(metrics.offsetLeft || 0));
}

export function getAppViewportRect() {
  return {
    width,
    height,
    offsetTop: visualOffsetTop,
    offsetLeft: visualOffsetLeft,
  };
}

export function isCompactViewport() {
  return width <= COMPACT_VIEWPORT_MAX_W || height <= COMPACT_VIEWPORT_MAX_H;
}

export function isCoarsePointer() {
  return typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export function getHomeLayoutMetrics() {
  const compact = isCompactViewport();
  if (!compact) {
    return {
      compact,
      coarsePointer: isCoarsePointer(),
      gridCellW: HOME_GRID_CELL_W,
      gridCellH: HOME_GRID_CELL_H,
      padX: HOME_GRID_PAD_X,
      padY: HOME_GRID_PAD_Y,
      sectionGap: HOME_SECTION_GAP,
      groupClusterRadius: HOME_GROUP_CLUSTER_RADIUS,
      groupClusterPad: HOME_GROUP_CLUSTER_PAD,
      groupCircleRadius: HOME_GROUP_CIRCLE_RADIUS,
      groupHoverScale: HOME_GROUP_HOVER_SCALE,
      groupHoverRadius: HOME_GROUP_HOVER_RADIUS,
      bubbleSmall: BUBBLE_SMALL,
      bubbleMedium: BUBBLE_MEDIUM,
      bubbleLarge: BUBBLE_LARGE,
      bubbleGap: BUBBLE_GAP,
      boardRadius: BUBBLE_MEDIUM / 2,
      groupRadius: BUBBLE_SMALL / 2,
      hoverRadius: BUBBLE_LARGE / 2,
      previewPad: BOARD_PREVIEW_PAD,
      previewMaxW: BOARD_PREVIEW_MAX_W,
      previewMaxH: BOARD_PREVIEW_MAX_H,
      fitPadding: 180,
    };
  }

  const coarsePointer = isCoarsePointer();
  const bubbleSmall = 56;
  const bubbleMedium = 96;
  const bubbleLarge = coarsePointer ? 108 : 124;
  const bubbleGap = 28;
  const gridCellW = Math.min(148, Math.max(112, width - 56));
  const gridCellH = 188;

  return {
    compact,
    coarsePointer,
    gridCellW,
    gridCellH,
    padX: 20,
    padY: COMPACT_TOPBAR_H + 28,
    sectionGap: 36,
    groupClusterRadius: bubbleLarge + bubbleGap,
    groupClusterPad: 28,
    groupCircleRadius: bubbleSmall / 2,
    groupHoverScale: bubbleLarge / bubbleSmall,
    groupHoverRadius: bubbleLarge / 2,
    bubbleSmall,
    bubbleMedium,
    bubbleLarge,
    bubbleGap,
    boardRadius: bubbleMedium / 2,
    groupRadius: bubbleSmall / 2,
    hoverRadius: bubbleLarge / 2,
    previewPad: 12,
    previewMaxW: bubbleMedium - 18,
    previewMaxH: bubbleMedium - 18,
    fitPadding: Math.min(112, Math.max(76, width * 0.24)),
  };
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
export let activePinsSnapshot = []; // Cache of pins for the current board
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
export function setActivePinsSnapshot(pins) { activePinsSnapshot = pins; }
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
  fabGroupLeft = document.querySelector(".fab-group-left");
  topbarEl     = document.querySelector(".topbar");
  breadcrumb   = document.getElementById("breadcrumb");
  topbarLogo   = document.getElementById("topbar-logo");
  topbarProfileBtn = document.getElementById("topbar-profile");
  profileView  = document.getElementById("profile-view");
  exploreView  = document.getElementById("explore-view");
  networkView  = document.getElementById("network-view");
  zoomLabel    = document.getElementById("zoom-indicator");
  minimapEl    = document.getElementById("minimap");
  minimapContainerEl = document.querySelector(".minimap-container");
  mCtx         = minimapEl.getContext("2d");

  setViewportMetrics({ width: window.innerWidth, height: window.innerHeight });
  svg.attr("viewBox", [0, 0, width, height]);

  masterG = svg.append("g").attr("class", "master-g");
}
