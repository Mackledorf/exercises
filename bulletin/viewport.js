/* ── bulletin · viewport.js ─ Zoom, pan, wheel, grid, topbar auto-hide ── */

import {
  svg, masterG, currentTransform, setCurrentTransform,
  currentView, activeBoardId, width, height,
  GRID, TRANSITION_MS, ZOOM_SETTLE_MS, WHEEL_ZOOM_SENS,
  HOME_WHEEL_GUARD_MS, PAN_BOUND_SCREENS, PIN_W, PIN_H,
  topbarEl, zoomLabel, minimapContainerEl, fabGroupLeft,
  TOPBAR_CLIP_BUFFER,
} from "./state.js";

import { imageAspectCache, getPinImageSrc, clamp, normalizeRect } from "./utils.js";

// ── Private state ────────────────────────────────
let isZooming = false;
let isProgrammaticZoom = false;
let hasScaleInteraction = false;
let zoomSettleTimer = null;

let gridUpdateRAF = null;
let pendingGridTransform = d3.zoomIdentity;
let lastGridX = NaN;
let lastGridY = NaN;
let lastGridK = NaN;

let zoomRenderRAF = null;
let lastZoomLabelText = "100%";
let lastZoomTier = "normal";

let boardLoadingTimer = null;
let topbarVisibilityRAF = null;
let isTopbarAutoHidden = false;

let suppressHomeWheelUntil = 0;
let pendingHomeViewportGuard = false;

const wheelState = {
  raf: null,
  panX: 0,
  panY: 0,
  zoomLog2: 0,
  zoomX: 0,
  zoomY: 0,
  hasZoom: false,
};

// ── Callback injection ───────────────────────────
let _render = null;
let _hideQuickAdd = null;
let _updateMinimap = null;
let _requestMinimapUpdate = null;

export function init({ render, hideQuickAdd, updateMinimap, requestMinimapUpdate }) {
  _render = render;
  _hideQuickAdd = hideQuickAdd;
  _updateMinimap = updateMinimap;
  _requestMinimapUpdate = requestMinimapUpdate;
}

// ── Grid transform ───────────────────────────────
export function writeGridTransform(transform) {
  const { x, y, k } = transform;
  const canvasNode = svg.node();

  if (x !== lastGridX || y !== lastGridY) {
    canvasNode.style.backgroundPosition = `${x}px ${y}px`;
    lastGridX = x;
    lastGridY = y;
  }

  // Keep grid scale tightly in sync with camera zoom to avoid visible stepping.
  const scaleDeltaThreshold = 0.0001;
  if (!Number.isFinite(lastGridK) || Math.abs(k - lastGridK) >= scaleDeltaThreshold) {
    canvasNode.style.backgroundSize = `${GRID * k}px ${GRID * k}px`;
    lastGridK = k;
  }
}

export function applyGridTransform(transform, immediate) {
  pendingGridTransform = transform;

  if (immediate) {
    if (gridUpdateRAF) cancelAnimationFrame(gridUpdateRAF);
    gridUpdateRAF = null;
    writeGridTransform(pendingGridTransform);
    return;
  }

  if (gridUpdateRAF) return;
  gridUpdateRAF = requestAnimationFrame(() => {
    gridUpdateRAF = null;
    writeGridTransform(pendingGridTransform);
  });
}

// ── Viewport identity ────────────────────────────
export function resetViewportToIdentity() {
  setCurrentTransform(d3.zoomIdentity);
  masterG.attr("transform", currentTransform);
  applyGridTransform(currentTransform, true);
  svg.property("__zoom", d3.zoomIdentity);
}

// ── Pan bounds ───────────────────────────────────
export function getPanBoundsWorld() {
  return {
    minX: -width * PAN_BOUND_SCREENS,
    maxX: width * (1 + PAN_BOUND_SCREENS),
    minY: -height * PAN_BOUND_SCREENS,
    maxY: height * (1 + PAN_BOUND_SCREENS),
  };
}

export function constrainTransformToPanBounds(transform) {
  const bounds = getPanBoundsWorld();
  const k = transform.k;
  let x = transform.x;
  let y = transform.y;

  const minTx = width - bounds.maxX * k;
  const maxTx = -bounds.minX * k;
  const minTy = height - bounds.maxY * k;
  const maxTy = -bounds.minY * k;

  x = minTx <= maxTx ? Math.max(minTx, Math.min(maxTx, x)) : (minTx + maxTx) / 2;
  y = minTy <= maxTy ? Math.max(minTy, Math.min(maxTy, y)) : (minTy + maxTy) / 2;

  return d3.zoomIdentity.translate(x, y).scale(k);
}

// ── Zoom interaction lifecycle ───────────────────
export function finishZoomInteraction() {
  isZooming = false;
  isProgrammaticZoom = false;
  hasScaleInteraction = false;
  document.body.classList.remove("is-zooming");
  masterG.classed("camera-moving", false);
  applyGridTransform(currentTransform, true);
  if (_requestMinimapUpdate) _requestMinimapUpdate();
}

export function cancelZoomInteraction() {
  if (zoomSettleTimer) {
    clearTimeout(zoomSettleTimer);
    zoomSettleTimer = null;
  }
  isZooming = false;
  isProgrammaticZoom = false;
  hasScaleInteraction = false;
  document.body.classList.remove("is-zooming");
  masterG.classed("camera-moving", false);
}

export function scheduleZoomSettle() {
  if (zoomSettleTimer) clearTimeout(zoomSettleTimer);
  zoomSettleTimer = setTimeout(() => {
    zoomSettleTimer = null;
    finishZoomInteraction();
  }, ZOOM_SETTLE_MS);
}

export function startZoomInteraction(isScaleChange) {
  hasScaleInteraction = hasScaleInteraction || isScaleChange;
  if (!isZooming) {
    isZooming = true;
  }
  if (isScaleChange && _hideQuickAdd) _hideQuickAdd();
  masterG.classed("camera-moving", true);
  if (hasScaleInteraction) document.body.classList.add("is-zooming");
  scheduleZoomSettle();
}

// ── Zoom transition ──────────────────────────────
export function runZoomTransition(transform, onDone, options = {}) {
  cancelZoomInteraction();
  isProgrammaticZoom = true;
  masterG.classed("camera-moving", true);
  svg.interrupt();

  const transition = svg.transition().duration(TRANSITION_MS);
  const anchorWorld = options.anchorWorld;
  const anchorScreen = options.anchorScreen;
  const skipConstrain = options.skipConstrain === true;

  if (anchorWorld && anchorScreen) {
    const startK = currentTransform.k;
    const endK = transform.k;
    const kInterp = d3.interpolateNumber(startK, endK);

    transition.tween("zoom-anchor-center", () => {
      return (t) => {
        const nextK = kInterp(t);
        const nextX = anchorScreen.x - anchorWorld.x * nextK;
        const nextY = anchorScreen.y - anchorWorld.y * nextK;
        const rawNext = d3.zoomIdentity.translate(nextX, nextY).scale(nextK);
        const next = skipConstrain ? rawNext : constrainTransformToPanBounds(rawNext);
        svg.call(zoom.transform, next);
      };
    });
  } else if (options.lockPan) {
    const startK = currentTransform.k;
    const endK = transform.k;
    const fixedX = currentTransform.x;
    const fixedY = currentTransform.y;

    transition.tween("zoom-lock-pan", () => {
      const kInterp = d3.interpolateNumber(startK, endK);
      return (t) => {
        const next = d3.zoomIdentity
          .translate(fixedX, fixedY)
          .scale(kInterp(t));
        svg.call(zoom.transform, next);
      };
    });
  } else {
    transition.call(zoom.transform, transform);
  }

  let called = false;
  const done = () => {
    finishZoomInteraction();
    if (called) return;
    called = true;
    if (typeof onDone === "function") onDone();
  };

  transition.on("end.grid-sync", done);
  transition.on("interrupt.grid-sync", done);
}

// ── Fit / bounds helpers ─────────────────────────
export function computeFitTransformForWorldRect(rect, padding = 140) {
  if (!rect) return d3.zoomIdentity;
  const safe = normalizeRect(rect);
  const viewW = Math.max(1, width - padding * 2);
  const viewH = Math.max(1, height - padding * 2);
  const scale = clamp(Math.min(viewW / safe.width, viewH / safe.height), 0.25, 5.0);
  const cx = safe.left + safe.width / 2;
  const cy = safe.top + safe.height / 2;
  const tx = width / 2 - cx * scale;
  const ty = height / 2 - cy * scale;
  return d3.zoomIdentity.translate(tx, ty).scale(scale);
}

export function getPinsWorldBounds(pins) {
  if (!pins || pins.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  pins.forEach((pin) => {
    const pw = pin.pinW || pin._pw || PIN_W;
    const src = getPinImageSrc(pin);
    const aspect = imageAspectCache.get(src) || pin._aspect || (PIN_H / PIN_W);
    const ph = Math.round(pw * aspect);

    minX = Math.min(minX, pin.x - pw / 2);
    maxX = Math.max(maxX, pin.x + pw / 2);
    minY = Math.min(minY, pin.y - ph / 2);
    maxY = Math.max(maxY, pin.y + ph / 2);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export function computeBoardFitTransform(pins) {
  if (!pins || pins.length === 0) return d3.zoomIdentity;

  const bounds = getPinsWorldBounds(pins);
  if (!bounds) return d3.zoomIdentity;

  const pad = 200;
  const dx = bounds.width + pad * 2;
  const dy = bounds.height + pad * 2;
  const scale = Math.min(width / dx, height / dy, 1);
  const tx = width / 2 - bounds.cx * scale;
  const ty = height / 2 - bounds.cy * scale;
  return d3.zoomIdentity.translate(tx, ty).scale(scale);
}

// ── Board placeholder pin ────────────────────────
export function getBoardPlaceholderPinId(boardId) {
  return `__empty-board-placeholder__${boardId}`;
}

export function createBoardPlaceholderPin(boardId) {
  const pw = Math.max(120, width - 320);
  const ph = Math.max(120, height - 320);
  return {
    id: getBoardPlaceholderPinId(boardId),
    x: width / 2,
    y: height / 2,
    pinW: pw,
    _pw: pw,
    _aspect: ph / pw,
    _ph: ph,
    _placeholder: true,
    imageUrl: "",
  };
}

export function getBoardPinsForFitAndTransition(boardId) {
  const pins = Store.getPins(boardId);
  if (pins.length > 0) return pins;
  return [createBoardPlaceholderPin(boardId)];
}

// ── Wheel handling ───────────────────────────────
export function resetWheelState() {
  wheelState.panX = 0;
  wheelState.panY = 0;
  wheelState.zoomLog2 = 0;
  wheelState.hasZoom = false;
}

export function clearViewportInputCarryover() {
  if (zoomRenderRAF) {
    cancelAnimationFrame(zoomRenderRAF);
    zoomRenderRAF = null;
  }

  if (wheelState.raf) {
    cancelAnimationFrame(wheelState.raf);
    wheelState.raf = null;
  }

  resetWheelState();
}

export function guardHomeWheelInput() {
  suppressHomeWheelUntil = Date.now() + HOME_WHEEL_GUARD_MS;
}

export function flushWheelFrame() {
  wheelState.raf = null;
  if (currentView !== "board" && currentView !== "home") {
    resetWheelState();
    return;
  }

  if (wheelState.panX !== 0 || wheelState.panY !== 0) {
    svg.call(
      zoom.translateBy,
      wheelState.panX / currentTransform.k,
      wheelState.panY / currentTransform.k
    );
  }

  if (wheelState.hasZoom && wheelState.zoomLog2 !== 0) {
    svg.call(
      zoom.scaleBy,
      Math.pow(2, wheelState.zoomLog2),
      [wheelState.zoomX, wheelState.zoomY]
    );
  }

  resetWheelState();
}

export function queueWheelFrame() {
  if (!wheelState.raf) {
    wheelState.raf = requestAnimationFrame(flushWheelFrame);
  }
}

// ── Topbar auto-hide ─────────────────────────────
export function setTopbarAutoHidden(hidden) {
  if (isTopbarAutoHidden === hidden) return;
  isTopbarAutoHidden = hidden;
  document.body.classList.toggle("topbar-auto-hidden", hidden);
}

export function shouldHideTopbarForPinOverlap() {
  if (!topbarEl || currentView !== "board" || !activeBoardId) return false;

  const t = currentTransform;
  const k = t.k;

  if (k >= 1.26) return true;
  if (k <= 1.25) return false;

  const pins = Store.getPins(activeBoardId);
  if (pins.length === 0) return false;

  const headerHeight = 44;
  const hideThreshold = headerHeight + TOPBAR_CLIP_BUFFER;
  const showThreshold = hideThreshold + 10;

  let anyOverlap = false;

  for (const pin of pins) {
    const pinW = pin._pw || pin.pinW || PIN_W;
    const pinH = pin._ph || Math.round(pinW * (pin._aspect || (PIN_H / PIN_W)));

    const screenLeft = (pin.x - pinW / 2) * k + t.x;
    const screenRight = (pin.x + pinW / 2) * k + t.x;
    if (screenRight < 0 || screenLeft > width) continue;

    const screenTop = (pin.y - pinH / 2) * k + t.y;
    const screenBottom = (pin.y + pinH / 2) * k + t.y;

    const threshold = isTopbarAutoHidden ? showThreshold : hideThreshold;

    if (screenBottom > 0 && screenTop < threshold) {
      anyOverlap = true;
      break;
    }
  }

  return anyOverlap;
}

export function updateTopbarAutoVisibility() {
  const shouldHide = shouldHideTopbarForPinOverlap();
  setTopbarAutoHidden(shouldHide);
}

export function requestTopbarVisibilityUpdate() {
  if (topbarVisibilityRAF) return;
  topbarVisibilityRAF = requestAnimationFrame(() => {
    topbarVisibilityRAF = null;
    updateTopbarAutoVisibility();
  });
}

export function updateBoardZoomUIVisibility() {
  const isBoardView = currentView === "board";
  const zoomTooClose = isBoardView && currentTransform.k > 1.25;
  const showBoardUI = isBoardView && !zoomTooClose;

  document.body.classList.toggle("zoom-ui-hidden", zoomTooClose);

  zoomLabel.style.display = isBoardView ? "block" : "none";
  if (minimapContainerEl) {
    minimapContainerEl.style.display = isBoardView ? "flex" : "none";
  }

  const fabCenter = document.getElementById("fab-center-group");
  if (fabCenter) {
    fabCenter.classList.toggle("visible", showBoardUI);
  }

  // Update left FAB (recentering button) visibility
  // Show only if in board view and NO pins are currently visible in the viewport
  if (fabGroupLeft) {
    let showLeftFAB = false;
    if (isBoardView && activeBoardId) {
      const pins = Store.getPins(activeBoardId);
      if (pins.length > 0) {
        // Check if any pin is in the viewport
        const visible = pins.some(p => {
          const screenX = currentTransform.x + p.x * currentTransform.k;
          const screenY = currentTransform.y + p.y * currentTransform.k;
          const w = PIN_W * currentTransform.k;
          const h = PIN_H * currentTransform.k;
          return (
            screenX + w > 0 &&
            screenX < width &&
            screenY + h > 0 &&
            screenY < height
          );
        });
        showLeftFAB = !visible;
      }
    }
    fabGroupLeft.classList.toggle("visible", showLeftFAB);
  }
}

// ── Zoom render flush (RAF from onZoom) ──────────
export function flushZoomRender() {
  zoomRenderRAF = null;
  const { k } = currentTransform;

  masterG.attr("transform", currentTransform);
  applyGridTransform(currentTransform, true);
  if (_requestMinimapUpdate) _requestMinimapUpdate();
  requestTopbarVisibilityUpdate();

  const tier = k < 0.2 ? "very-far" : k < 0.6 ? "far" : "normal";
  if (tier !== lastZoomTier) {
    masterG.classed("zoom-far", tier === "far")
           .classed("zoom-very-far", tier === "very-far");
    lastZoomTier = tier;
  }

  const zoomText = Math.round(k * 100) + "%";
  if (zoomText !== lastZoomLabelText) {
    zoomLabel.textContent = zoomText;
    lastZoomLabelText = zoomText;
  }

  updateBoardZoomUIVisibility();
}

// ── D3 zoom behavior ─────────────────────────────
function onZoom(event) {
  const prevK = currentTransform.k;
  setCurrentTransform(event.transform);
  const isScaleChange = Math.abs(prevK - currentTransform.k) > 0.0001;

  if (currentView === "board" && !isProgrammaticZoom) {
    startZoomInteraction(isScaleChange);
  }

  if (!zoomRenderRAF) zoomRenderRAF = requestAnimationFrame(flushZoomRender);
}

export const zoom = d3.zoom()
  .scaleExtent([0.25, 5.0])
  .constrain((transform) => constrainTransformToPanBounds(transform))
  .on("zoom", onZoom)
  .filter(event => {
    // Disable zoom/pan if no boards (only in Home view)
    if (currentView === "home") {
      const boards = Store.getBoards();
      if (boards.length === 0) return false;
    }
    
    if (event.type === 'wheel') return false;
    return !event.button;
  });

// ── Wheel event on SVG ───────────────────────────
export function attachWheelHandler() {
  svg.on("wheel", (event) => {
    if (currentView !== "board" && currentView !== "home") return;
    
    // Disable wheel if no boards in home view
    if (currentView === "home") {
      const boards = Store.getBoards();
      if (boards.length === 0) return;
    }

    event.preventDefault();

    if (currentView === "home" && Date.now() < suppressHomeWheelUntil) {
      resetWheelState();
      return;
    }

    if (event.ctrlKey) {
      wheelState.zoomLog2 += -event.deltaY * WHEEL_ZOOM_SENS;
      wheelState.zoomX = event.clientX;
      wheelState.zoomY = event.clientY;
      wheelState.hasZoom = true;
    } else {
      wheelState.panX += -event.deltaX;
      wheelState.panY += -event.deltaY;
    }

    queueWheelFrame();
  }, { passive: false });
}

// ── Pending home viewport guard (used by render dispatcher) ──
export function setPendingHomeViewportGuard(v) { pendingHomeViewportGuard = v; }
export function getPendingHomeViewportGuard() { return pendingHomeViewportGuard; }
