/* ── bulletin · app.js ──────────────────────────── */

(function () {
  "use strict";

  // ── Constants ──────────────────────────────────
  const GRID          = 24;     // dot-grid spacing (matches CSS)
  const PIN_W         = 144;    // pin card width (aligned to 24 * 6)
  const PIN_H         = 192;    // pin card height (aligned to 24 * 8)
  const PIN_GAP       = 8;      // min visual gap between pins when edge-snapping
  const SNAP_THRESH   = 12;     // proximity in world px for edge-snap to activate
  const TRANSITION_MS = 500;
  const BOARD_NAV_OVERLAY_MS = TRANSITION_MS + 180;
  const BOARD_SPREAD  = 288;    // spacing between board nodes (24 * 12)
  const WHEEL_ZOOM_SENS = 0.01;
  const ZOOM_SETTLE_MS = 150;
  const PAN_BOUND_SCREENS = 2.5;
  const MOVE_HISTORY_LIMIT = 100;
  const TOPBAR_CLIP_BUFFER = 6;
  const BOARD_LOADING_MIN_PINS = 20;
  const BOARD_LOADING_TARGET_READY = 6;
  const BOARD_LOADING_TIMEOUT_MS = 1500;
  const BOARD_PREVIEW_OFFSET_Y = 76;
  const BOARD_PREVIEW_MAX_W = 220;
  const BOARD_PREVIEW_MAX_H = 148;
  const BOARD_PREVIEW_PAD = 96;
  const HOME_WHEEL_GUARD_MS = 220;
  const HOME_GRID_CELL_W = 296;
  const HOME_GRID_CELL_H = 264;
  const HOME_GRID_PAD_X = 80;
  const HOME_GRID_PAD_Y = 110;

  // ── State ──────────────────────────────────────
  let currentView   = "home";   // "home" | "board"
  let activeBoardId = null;
  let selectedPinId = null;     // id of currently-selected pin
  let pinMoveUndoStack = [];
  let pinMoveRedoStack = [];
  let boardRenderToken = 0;
  let suppressHistoryRender = false;
  let selectionModeActive = false;
  let shiftSelectHeld = false;
  let multiSelectedPinIds = new Set();
  let spacebarHeld = false;
  let marqueeStart = null;
  let marqueeCurrent = null;
  let marqueePointerId = null;
  let skipNextBoardAutoFit = false;

  // ── DOM ────────────────────────────────────────
  const svg         = d3.select("#canvas");
  const emptyState  = document.getElementById("empty-state");
  const fabGroup    = document.getElementById("fab-group");
  const topbarEl    = document.querySelector(".topbar");
  const breadcrumb  = document.getElementById("breadcrumb");
  const topbarLogo  = document.getElementById("topbar-logo");
  const topbarProfileBtn = document.getElementById("topbar-profile");
  const profileView = document.getElementById("profile-view");
  const zoomLabel   = document.getElementById("zoom-indicator");
  const minimapEl   = document.getElementById("minimap");
  const minimapContainerEl = document.querySelector(".minimap-container");
  const mCtx        = minimapEl.getContext("2d");

  // ── SVG setup ──────────────────────────────────
  let width  = window.innerWidth;
  let height = window.innerHeight;
  svg.attr("viewBox", [0, 0, width, height]);

  const masterG = svg.append("g");

  // ── Zoom behavior ──────────────────────────────
  // Limit zoom-out to 25%
  // Limit zoom-in to 500%
  const zoom = d3.zoom()
    .scaleExtent([0.25, 5.0])
    .constrain((transform) => constrainTransformToPanBounds(transform))
    .on("zoom", onZoom)
    .filter(event => {
      // Let our custom wheel handler manage scroll/pinch.
      // D3 handles click-drag panning and programmatic transforms.
      if (event.type === 'wheel') return false;
      return !event.button;
    });

  svg.call(zoom)
    .on("dblclick.zoom", null); // Disable double-click zoom

  // Block browser default double-tap-to-zoom (especially on mobile/trackpads)
  document.addEventListener("dblclick", (e) => {
    e.preventDefault();
  }, { passive: false });

  let currentTransform = d3.zoomIdentity;
  let zoomSettleTimer = null;
  let isZooming = false;
  let isProgrammaticZoom = false;
  let hasScaleInteraction = false;
  let gridUpdateRAF = null;
  let pendingGridTransform = currentTransform;
  let lastGridX = NaN;
  let lastGridY = NaN;
  let lastGridK = NaN;
  let zoomRenderRAF = null;
  let lastZoomLabelText = "100%";
  let boardLoadingTimer = null;
  let topbarVisibilityRAF = null;
  let isTopbarAutoHidden = false;
  let boardNavTransition = null;
  let boardNavTransitionSeq = 0;
  let homePreviewHydrateQueued = false;
  let suppressHomeWheelUntil = 0;
  let pendingHomeViewportGuard = false;

  function measureBoardActionRowWidth() {
    const probe = document.createElement("div");
    probe.className = "fab-main-row";
    probe.style.position = "fixed";
    probe.style.left = "-9999px";
    probe.style.top = "-9999px";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";

    const addPinProbe = document.createElement("button");
    addPinProbe.className = "btn btn-primary fab-add-pin-btn";
    addPinProbe.textContent = "+ Add Pin";

    const selectProbe = document.createElement("button");
    selectProbe.className = "fab-select-btn";
    selectProbe.setAttribute("aria-hidden", "true");

    probe.appendChild(addPinProbe);
    probe.appendChild(selectProbe);
    document.body.appendChild(probe);

    const widthPx = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    return widthPx;
  }

  function ensureHomeAddBoardButton() {
    let group = document.getElementById("home-add-board-group");
    if (!group) {
      group = document.createElement("div");
      group.id = "home-add-board-group";
      group.className = "home-add-board-group";

      const button = document.createElement("button");
      button.id = "btn-home-add-board";
      button.className = "btn btn-primary fab-add-pin-btn home-add-board-btn";
      button.textContent = "+ Add Board";
      button.addEventListener("click", () => openModal("modal-board"));

      group.appendChild(button);
      document.body.appendChild(group);
    }

    const button = document.getElementById("btn-home-add-board");
    if (button) {
      const widthPx = measureBoardActionRowWidth();
      button.style.width = `${widthPx}px`;
    }

    return group;
  }

  function scheduleHomePreviewHydrate() {
    if (homePreviewHydrateQueued) return;
    homePreviewHydrateQueued = true;
    requestAnimationFrame(() => {
      homePreviewHydrateQueued = false;
      if (currentView !== "home") return;
      render();
    });
  }

  function resetViewportToIdentity() {
    currentTransform = d3.zoomIdentity;
    masterG.attr("transform", currentTransform);
    applyGridTransform(currentTransform, true);
    svg.property("__zoom", d3.zoomIdentity);
  }

  function getPanBoundsWorld() {
    return {
      minX: -width * PAN_BOUND_SCREENS,
      maxX: width * (1 + PAN_BOUND_SCREENS),
      minY: -height * PAN_BOUND_SCREENS,
      maxY: height * (1 + PAN_BOUND_SCREENS),
    };
  }

  function constrainTransformToPanBounds(transform) {
    const bounds = getPanBoundsWorld();
    const k = transform.k;
    let x = transform.x;
    let y = transform.y;

    const minTx = width - bounds.maxX * k;
    const maxTx = -bounds.minX * k;
    const minTy = height - bounds.maxY * k;
    const maxTy = -bounds.minY * k;

    // If the viewport becomes larger than the bounds at this zoom level,
    // center the camera within the bounded region.
    x = minTx <= maxTx ? Math.max(minTx, Math.min(maxTx, x)) : (minTx + maxTx) / 2;
    y = minTy <= maxTy ? Math.max(minTy, Math.min(maxTy, y)) : (minTy + maxTy) / 2;

    return d3.zoomIdentity.translate(x, y).scale(k);
  }

  const imageAspectCache = new Map();
  const imageAspectPending = new Map();

  function getPinImageSrc(pin) {
    return pin.imageData || pin.imageUrl || "";
  }

  function loadImageAspect(src) {
    if (!src) return Promise.resolve(PIN_H / PIN_W);
    if (imageAspectCache.has(src)) return Promise.resolve(imageAspectCache.get(src));
    if (imageAspectPending.has(src)) return imageAspectPending.get(src);

    const pending = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || PIN_W;
        const h = img.naturalHeight || PIN_H;
        const aspect = h / w;
        imageAspectCache.set(src, aspect);
        imageAspectPending.delete(src);
        resolve(aspect);
      };
      img.onerror = () => {
        const fallback = PIN_H / PIN_W;
        imageAspectCache.set(src, fallback);
        imageAspectPending.delete(src);
        resolve(fallback);
      };
      img.src = src;
    });

    imageAspectPending.set(src, pending);
    return pending;
  }

  // Batch high-frequency wheel events into one transform update per frame.
  const wheelState = {
    raf: null,
    panX: 0,
    panY: 0,
    zoomLog2: 0,
    zoomX: 0,
    zoomY: 0,
    hasZoom: false,
  };

  function writeGridTransform(transform) {
    const { x, y, k } = transform;
    const canvasNode = svg.node();

    if (x !== lastGridX || y !== lastGridY) {
      canvasNode.style.backgroundPosition = `${x}px ${y}px`;
      lastGridX = x;
      lastGridY = y;
    }

    // During active scale gestures, reduce background-size churn to cut paint cost.
    const scaleDeltaThreshold = hasScaleInteraction ? 0.012 : 0.0001;
    if (!Number.isFinite(lastGridK) || Math.abs(k - lastGridK) >= scaleDeltaThreshold) {
      canvasNode.style.backgroundSize = `${GRID * k}px ${GRID * k}px`;
      lastGridK = k;
    }
  }

  function applyGridTransform(transform, immediate) {
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

  function resetWheelState() {
    wheelState.panX = 0;
    wheelState.panY = 0;
    wheelState.zoomLog2 = 0;
    wheelState.hasZoom = false;
  }

  function clearViewportInputCarryover() {
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

  function guardHomeWheelInput() {
    suppressHomeWheelUntil = Date.now() + HOME_WHEEL_GUARD_MS;
  }

  function finishZoomInteraction() {
    isZooming = false;
    isProgrammaticZoom = false;
    hasScaleInteraction = false;
    document.body.classList.remove("is-zooming");
    masterG.classed("camera-moving", false);
    applyGridTransform(currentTransform, true);
    requestMinimapUpdate();
  }

  function cancelZoomInteraction() {
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

  function scheduleZoomSettle() {
    if (zoomSettleTimer) clearTimeout(zoomSettleTimer);
    zoomSettleTimer = setTimeout(() => {
      zoomSettleTimer = null;
      finishZoomInteraction();
    }, ZOOM_SETTLE_MS);
  }

  function startZoomInteraction(isScaleChange) {
    hasScaleInteraction = hasScaleInteraction || isScaleChange;
    if (!isZooming) {
      isZooming = true;
    }
    // Dismiss quick-add bubble only when the user zooms (not on pan)
    if (quickAddActive && isScaleChange) hideQuickAdd();
    masterG.classed("camera-moving", true);
    if (hasScaleInteraction) document.body.classList.add("is-zooming");
    scheduleZoomSettle();
  }

  function runZoomTransition(transform, onDone, options = {}) {
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

  function getPinsWorldBounds(pins) {
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

  function computeBoardFitTransform(pins) {
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

  function getBoardPlaceholderPinId(boardId) {
    return `__empty-board-placeholder__${boardId}`;
  }

  function createBoardPlaceholderPin(boardId) {
    // Synthetic hidden pin used only for camera fit + nav transition math.
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

  function getBoardPinsForFitAndTransition(boardId) {
    const pins = Store.getPins(boardId);
    if (pins.length > 0) return pins;
    return [createBoardPlaceholderPin(boardId)];
  }

  function normalizeRect(rect) {
    return {
      left: Number.isFinite(rect.left) ? rect.left : 0,
      top: Number.isFinite(rect.top) ? rect.top : 0,
      width: Math.max(1, Number.isFinite(rect.width) ? rect.width : 1),
      height: Math.max(1, Number.isFinite(rect.height) ? rect.height : 1),
    };
  }

  function unionRects(rects) {
    if (!rects || rects.length === 0) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    rects.forEach((raw) => {
      if (!raw) return;
      const rect = normalizeRect(raw);
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.left + rect.width);
      bottom = Math.max(bottom, rect.top + rect.height);
    });
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  function scaleRectFromCenter(rect, factor) {
    const safe = normalizeRect(rect);
    const nextW = Math.max(6, safe.width * factor);
    const nextH = Math.max(6, safe.height * factor);
    const cx = safe.left + safe.width / 2;
    const cy = safe.top + safe.height / 2;
    return {
      left: cx - nextW / 2,
      top: cy - nextH / 2,
      width: nextW,
      height: nextH,
    };
  }

  function worldRectToScreenRect(cx, cy, w, h, transform) {
    const k = transform.k;
    const sx = transform.x + cx * k;
    const sy = transform.y + cy * k;
    return {
      left: sx - (w * k) / 2,
      top: sy - (h * k) / 2,
      width: Math.max(1, w * k),
      height: Math.max(1, h * k),
    };
  }

  function getHomeBoardGridPositions() {
    const boards = Store.getBoards();
    const usableW = Math.max(1, width - HOME_GRID_PAD_X * 2);
    const maxCols = Math.max(1, Math.floor(usableW / HOME_GRID_CELL_W));
    const boardCount = Math.max(1, boards.length);
    const cols = Math.max(1, Math.min(maxCols, boardCount));
    const rows = Math.max(1, Math.ceil(boardCount / cols));
    const boardsInLastRow = boardCount - (rows - 1) * cols;
    const gridW = Math.max(0, (cols - 1) * HOME_GRID_CELL_W);
    const gridH = Math.max(0, (rows - 1) * HOME_GRID_CELL_H);
    const startX = width / 2 - gridW / 2;
    const startY = height / 2 - gridH / 2;

    const map = new Map();
    boards.forEach((board, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const rowCols = row === rows - 1 ? boardsInLastRow : cols;
      const rowOffset = (cols - rowCols) * HOME_GRID_CELL_W / 2;
      map.set(board.id, {
        x: startX + rowOffset + col * HOME_GRID_CELL_W,
        y: startY + row * HOME_GRID_CELL_H,
      });
    });

    return map;
  }

  function getBoardPinsForTransition(boardId) {
    return getBoardPinsForFitAndTransition(boardId).map((pin) => {
      const src = getPinImageSrc(pin);
      const aspect = imageAspectCache.get(src) || pin._aspect || (PIN_H / PIN_W);
      const pw = pin.pinW || pin._pw || PIN_W;
      const ph = Math.round(pw * aspect);
      return {
        id: pin.id,
        x: pin.x,
        y: pin.y,
        pw,
        ph,
        src,
        isPlaceholder: !!pin._placeholder,
      };
    });
  }

  function getBoardPinsScreenGeometry(boardId, transform) {
    const pins = getBoardPinsForTransition(boardId);
    const pinRects = pins.map((pin) => ({
      id: pin.id,
      src: pin.src,
      isPlaceholder: pin.isPlaceholder,
      rect: worldRectToScreenRect(pin.x, pin.y, pin.pw, pin.ph, transform),
    }));
    const cardRect = unionRects(pinRects.map((pin) => pin.rect)) || {
      left: width / 2 - 100,
      top: height / 2 - 80,
      width: 200,
      height: 160,
    };
    return { pins: pinRects, cardRect };
  }

  function getHomeBoardNode(boardId) {
    const nodes = masterG.selectAll("g.board-node").nodes();
    return nodes.find((node) => node && node.__data__ && node.__data__.id === boardId) || null;
  }

  function captureHomeBoardGeometryFromDOM(boardId) {
    const node = getHomeBoardNode(boardId);
    if (!node) return null;

    const cardRectRaw = node.getBoundingClientRect();
    const pins = [];
    node.querySelectorAll("g.board-preview-pin").forEach((group) => {
      const id = group.__data__ && group.__data__.id;
      if (!id) return;
      const bg = group.querySelector(".board-preview-pin-bg") || group;
      const img = group.querySelector(".board-preview-pin-img");
      const src = (img && (img.getAttribute("href") || img.getAttribute("xlink:href"))) || "";
      pins.push({
        id,
        src,
        rect: normalizeRect(bg.getBoundingClientRect()),
      });
    });

    const cardRect = unionRects([normalizeRect(cardRectRaw), ...pins.map((pin) => pin.rect)]) || normalizeRect(cardRectRaw);
    return { cardRect, pins };
  }

  function computeHomeBoardPreviewGeometry(boardId) {
    const posMap = getHomeBoardGridPositions();
    const pos = posMap.get(boardId);
    if (!pos) return null;

    const boardPins = Store.getPins(boardId);
    if (boardPins.length === 0) {
      const previewCenterX = pos.x;
      const previewCenterY = pos.y + BOARD_PREVIEW_OFFSET_Y;
      return {
        anchor: {
          x: previewCenterX,
          y: previewCenterY,
        },
        cardRect: {
          left: pos.x - 130,
          top: pos.y - 36,
          width: 260,
          height: 170,
        },
        pins: [
          {
            id: getBoardPlaceholderPinId(boardId),
            src: "",
            isPlaceholder: true,
            rect: {
              left: previewCenterX - 1,
              top: previewCenterY - 1,
              width: 2,
              height: 2,
            },
          },
        ],
      };
    }

    const pins = getBoardPinsForTransition(boardId);

    const bounds = getPinsWorldBounds(pins);
    if (!bounds) return null;

    const paddedW = bounds.width + BOARD_PREVIEW_PAD * 2;
    const paddedH = bounds.height + BOARD_PREVIEW_PAD * 2;
    const previewScale = Math.min(
      BOARD_PREVIEW_MAX_W / paddedW,
      BOARD_PREVIEW_MAX_H / paddedH
    );

    const previewCenterX = pos.x;
    const previewCenterY = pos.y + BOARD_PREVIEW_OFFSET_Y;

    const pinRects = pins.map((pin) => {
      const localX = (pin.x - bounds.cx) * previewScale;
      const localY = (pin.y - bounds.cy) * previewScale;
      const w = pin.pw * previewScale;
      const h = pin.ph * previewScale;
      return {
        id: pin.id,
        src: pin.src,
        rect: {
          left: previewCenterX + localX - w / 2,
          top: previewCenterY + localY - h / 2,
          width: Math.max(1, w),
          height: Math.max(1, h),
        },
      };
    });

    const previewRect = unionRects(pinRects.map((pin) => pin.rect)) || {
      left: previewCenterX - 110,
      top: previewCenterY - 74,
      width: 220,
      height: 148,
    };

    const cardRect = {
      left: Math.min(previewRect.left - 18, pos.x - 130),
      top: pos.y - 38,
      width: Math.max(260, previewRect.width + 36),
      height: Math.max(170, (previewRect.top + previewRect.height) - (pos.y - 38) + 16),
    };

    return {
      anchor: {
        x: previewCenterX,
        y: previewCenterY,
      },
      cardRect,
      pins: pinRects,
    };
  }

  function captureBoardGeometryFromDOM() {
    const nodes = masterG.selectAll("g.pin-group").nodes();
    if (!nodes || nodes.length === 0) return null;

    const pins = nodes.map((node) => {
      const id = node.getAttribute("data-id") || (node.__data__ && node.__data__.id);
      const bg = node.querySelector(".pin-bg") || node;
      const img = node.querySelector(".pin-img");
      const src = (img && (img.getAttribute("href") || img.getAttribute("xlink:href"))) || "";
      return {
        id,
        src,
        rect: normalizeRect(bg.getBoundingClientRect()),
      };
    }).filter((pin) => !!pin.id);

    if (pins.length === 0) return null;
    const cardRect = unionRects(pins.map((pin) => pin.rect)) || normalizeRect(nodes[0].getBoundingClientRect());
    return { cardRect, pins };
  }

  function warmBoardImageAspects(boardId) {
    const pins = Store.getPins(boardId);
    pins.forEach((pin) => {
      const src = getPinImageSrc(pin);
      if (!src || imageAspectCache.has(src)) return;
      loadImageAspect(src);
    });
  }

  function ensureBoardNavTransitionLayer() {
    let layer = document.getElementById("board-nav-transition-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "board-nav-transition-layer";
      document.body.appendChild(layer);
    }
    return layer;
  }

  function setOverlayRect(node, rect) {
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }

  function cleanupBoardNavTransition() {
    if (!boardNavTransition) return;
    clearTimeout(boardNavTransition.timer);
    boardNavTransition.layer.innerHTML = "";
    boardNavTransition.layer.classList.remove("visible");
    document.body.classList.remove("board-transition-enter-active");
    document.body.classList.remove("board-transition-exit-active");
    document.body.classList.remove("board-transition-mask-canvas");
    boardNavTransition = null;
  }

  function playBoardNavTransition(direction, board, sourceGeometry, targetGeometry) {
    if (!sourceGeometry || !targetGeometry) return;
    cleanupBoardNavTransition();

    const layer = ensureBoardNavTransitionLayer();
    const seq = ++boardNavTransitionSeq;
    layer.innerHTML = "";
    layer.classList.add("visible");

    const shell = document.createElement("div");
    shell.className = "board-nav-transition-shell";
    setOverlayRect(shell, sourceGeometry.cardRect);
    layer.appendChild(shell);

    const sourcePinsById = new Map((sourceGeometry.pins || []).map((pin) => [pin.id, pin]));
    const targetPins = targetGeometry.pins || [];
    targetPins.forEach((targetPin) => {
      const sourcePin = sourcePinsById.get(targetPin.id);
      const isPlaceholderPin = !!targetPin.isPlaceholder || !!(sourcePin && sourcePin.isPlaceholder);
      const fromRect = sourcePin ? sourcePin.rect : scaleRectFromCenter(sourceGeometry.cardRect, 0.18);
      const fromSrc = sourcePin && sourcePin.src ? sourcePin.src : "";

      const pinNode = document.createElement("div");
      pinNode.className = "board-nav-transition-pin";
      if (!fromSrc) pinNode.classList.add("skeleton");
      setOverlayRect(pinNode, fromRect);
      if (isPlaceholderPin) pinNode.style.opacity = "0";

      if (fromSrc) {
        const img = document.createElement("img");
        img.src = fromSrc;
        img.alt = "";
        pinNode.appendChild(img);
      }

      layer.appendChild(pinNode);

      requestAnimationFrame(() => {
        pinNode.style.transition = `left ${BOARD_NAV_OVERLAY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), top ${BOARD_NAV_OVERLAY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), width ${BOARD_NAV_OVERLAY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), height ${BOARD_NAV_OVERLAY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${BOARD_NAV_OVERLAY_MS}ms ease`;
        setOverlayRect(pinNode, targetPin.rect);
        pinNode.style.opacity = isPlaceholderPin ? "0" : "1";
        if (fromSrc && targetPin.src && fromSrc !== targetPin.src) {
          const img = pinNode.querySelector("img");
          if (img) img.src = targetPin.src;
        }
      });
    });

    requestAnimationFrame(() => {
      shell.style.transition = `left ${BOARD_NAV_OVERLAY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), top ${BOARD_NAV_OVERLAY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), width ${BOARD_NAV_OVERLAY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), height ${BOARD_NAV_OVERLAY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${BOARD_NAV_OVERLAY_MS}ms ease`;
      setOverlayRect(shell, targetGeometry.cardRect);
      shell.style.opacity = "0.55";
    });

    document.body.classList.toggle("board-transition-enter-active", direction === "enter");
    document.body.classList.toggle("board-transition-exit-active", direction === "exit");
    document.body.classList.toggle("board-transition-mask-canvas", direction === "exit");

    boardNavTransition = {
      seq,
      layer,
      timer: setTimeout(() => {
        if (!boardNavTransition || boardNavTransition.seq !== seq) return;
        cleanupBoardNavTransition();
      }, BOARD_NAV_OVERLAY_MS + 40),
    };
  }

  function flushWheelFrame() {
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

  function queueWheelFrame() {
    if (!wheelState.raf) {
      wheelState.raf = requestAnimationFrame(flushWheelFrame);
    }
  }

  // Trackpad / Scrollwheel — single custom handler
  svg.on("wheel", (event) => {
    if (currentView !== "board" && currentView !== "home") return;
    event.preventDefault();

    if (currentView === "home" && Date.now() < suppressHomeWheelUntil) {
      resetWheelState();
      return;
    }

    if (event.ctrlKey) {
      // Pinch-to-zoom (trackpad sends ctrl + wheel for pinch)
      wheelState.zoomLog2 += -event.deltaY * WHEEL_ZOOM_SENS;
      wheelState.zoomX = event.clientX;
      wheelState.zoomY = event.clientY;
      wheelState.hasZoom = true;
    } else {
      // Two-finger translation (natural scrolling)
      wheelState.panX += -event.deltaX;
      wheelState.panY += -event.deltaY;
    }

    queueWheelFrame();
  }, { passive: false });

  // ── Quick-add bubble (SVG circle inside masterG) ───
  let pendingPinPos = null;
  let quickAddG = null;
  let quickAddActive = false;
  let quickAddTimeout = null;
  let suppressQuickAddUntil = 0;

  function showQuickAdd(clientX, clientY) {
    if (currentView !== "board") return;

    // Convert screen coords to world coords, snap to grid
    const wx = (clientX - currentTransform.x) / currentTransform.k;
    const wy = (clientY - currentTransform.y) / currentTransform.k;
    const sx = Math.round(wx / GRID) * GRID;
    const sy = Math.round(wy / GRID) * GRID;

    // Save position before any reset
    pendingPinPos = { x: sx, y: sy };

    // Reset existing bubble if one is already showing
    removeQuickAddDOM();

    quickAddG = masterG.append("g")
      .attr("class", "quick-add-group")
      .attr("transform", `translate(${sx},${sy})`)
      .style("cursor", "pointer");

    // White circle
    quickAddG.append("circle")
      .attr("r", 18)
      .attr("fill", "#fff")
      .attr("class", "quick-add-circle");

    // Plus text
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

  function removeQuickAddDOM() {
    if (quickAddTimeout) { clearTimeout(quickAddTimeout); quickAddTimeout = null; }
    if (quickAddG) {
      quickAddG.remove();
      quickAddG = null;
    }
    quickAddActive = false;
  }

  function hideQuickAdd() {
    removeQuickAddDOM();
    pendingPinPos = null;
  }

  function setSelectionModeActive(nextActive) {
    selectionModeActive = !!nextActive;
    if (!selectionModeActive) {
      clearMultiSelection();
      spacebarHeld = false;
    } else {
      deselectPin();
    }
    syncSelectionModeUI();
    updatePanBinding();
  }

  function isSelectionModeEnabled() {
    return selectionModeActive || shiftSelectHeld;
  }

  function clearMultiSelection() {
    multiSelectedPinIds.clear();
    masterG.selectAll(".pin-multi-select-outline").remove();
    updateAlignmentPanelVisibility();
  }

  function renderMultiSelection() {
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

  function updateAlignmentPanelVisibility() {
    const panel = document.getElementById("align-panel");
    if (!panel) return;
    panel.classList.toggle("visible", multiSelectedPinIds.size >= 2);
  }

  function getSelectedPinsForAlignment() {
    if (!activeBoardId || multiSelectedPinIds.size < 2) return [];

    const selected = [];
    masterG.selectAll("g.pin-group").each(function (pin) {
      if (multiSelectedPinIds.has(pin.id)) {
        selected.push(pin);
      }
    });
    return selected;
  }

  function roundToGrid(value) {
    return Math.round(value / GRID) * GRID;
  }

  function compareByXThenYThenId(a, b) {
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return String(a.id).localeCompare(String(b.id));
  }

  function compareByYThenXThenId(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return String(a.id).localeCompare(String(b.id));
  }

  function getSelectionBounds(pins) {
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

  function getPinAnchorValue(pin, axis, anchor) {
    if (axis === "x") {
      if (anchor === "left") return pin.x - pin._pw / 2;
      if (anchor === "right") return pin.x + pin._pw / 2;
      return pin.x;
    }

    if (anchor === "top") return pin.y - pin._ph / 2;
    if (anchor === "bottom") return pin.y + pin._ph / 2;
    return pin.y;
  }

  function getCenterFromAnchor(pin, axis, anchor, target) {
    if (axis === "x") {
      if (anchor === "left") return target + pin._pw / 2;
      if (anchor === "right") return target - pin._pw / 2;
      return target;
    }

    if (anchor === "top") return target + pin._ph / 2;
    if (anchor === "bottom") return target - pin._ph / 2;
    return target;
  }

  function alignSelectionToAnchor(axis, anchor) {
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

  function applyBatchPinPositions(nextPositions, options = {}) {
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
      syncRenderedPinPosition(pinId, toPos.x, toPos.y);

      movedEntries.push({
        type: "move",
        pinId,
        boardId: activeBoardId,
        fromPos,
        toPos,
      });
    });

    if (movedEntries.length === 0) return;

    pushPinHistory({ type: "batch", entries: movedEntries });
    updateMinimap();
    renderMultiSelection();
  }

  function alignSelectionLeft() {
    alignSelectionToAnchor("x", "left");
  }

  function alignSelectionCenterHorizontal() {
    alignSelectionToAnchor("x", "center");
  }

  function alignSelectionRight() {
    alignSelectionToAnchor("x", "right");
  }

  function alignSelectionTop() {
    alignSelectionToAnchor("y", "top");
  }

  function alignSelectionCenterVertical() {
    alignSelectionToAnchor("y", "center");
  }

  function alignSelectionBottom() {
    alignSelectionToAnchor("y", "bottom");
  }

  function distributeSelectionHorizontal() {
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

  function distributeSelectionVertical() {
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

  function handleAlignmentAction(action) {
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

  function syncSelectionModeUI() {
    const selectBtn = document.getElementById("btn-selection-mode");
    if (selectBtn) selectBtn.classList.toggle("active", isSelectionModeEnabled());
    updateAlignmentPanelVisibility();

    const canvasNode = svg.node();
    if (!canvasNode) return;
    if (currentView !== "board") {
      canvasNode.style.removeProperty("cursor");
      return;
    }
    if (!isSelectionModeEnabled()) {
      canvasNode.style.removeProperty("cursor");
      return;
    }

    canvasNode.style.cursor = spacebarHeld ? "grab" : "crosshair";
  }

  function updatePanBinding() {
    if (currentView !== "board") return;
    if (isSelectionModeEnabled() && !spacebarHeld && marqueePointerId == null) {
      svg.on(".zoom", null);
      return;
    }
    svg.call(zoom).on("dblclick.zoom", null);
  }

  function removeMarquee() {
    masterG.selectAll(".selection-marquee").remove();
    marqueeStart = null;
    marqueeCurrent = null;
    marqueePointerId = null;
  }

  function drawMarquee() {
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

  function commitMarqueeSelection() {
    if (!marqueeStart || !marqueeCurrent || !activeBoardId) {
      removeMarquee();
      return;
    }

    const x0 = Math.min(marqueeStart.x, marqueeCurrent.x);
    const y0 = Math.min(marqueeStart.y, marqueeCurrent.y);
    const x1 = Math.max(marqueeStart.x, marqueeCurrent.x);
    const y1 = Math.max(marqueeStart.y, marqueeCurrent.y);
    const isClickLike = (x1 - x0) < 3 && (y1 - y0) < 3;

    if (isClickLike) {
      clearMultiSelection();
      renderMultiSelection();
      removeMarquee();
      return;
    }

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
    removeMarquee();
  }

  // Listen for clicks on empty canvas area (board view only)
  svg.on("click.quickadd", (event) => {
    if (currentView !== "board") return;
    if (isSelectionModeEnabled() && !spacebarHeld) return;
    if (Date.now() < suppressQuickAddUntil) return;

    // Deselect pin when clicking outside any pin group
    const wasSelected = !!selectedPinId;
    if (!event.target.closest?.("g.pin-group")) deselectPin();

    // If we just deselected a pin, or clicked a pin, dismiss bubble and stop
    if (wasSelected || event.target.classList?.contains("pin-hit-area")) {
      hideQuickAdd();
      return;
    }

    // Don't re-trigger if clicking the bubble itself
    if (quickAddActive && quickAddG) {
      const target = event.target;
      if (quickAddG.node().contains(target)) return;
    }

    // Only allow if clicking background (svg or the transparent hit-rect)
    // AND NOT if clicking a pin's interaction layer
    if (event.target.classList && event.target.classList.contains("pin-hit-area")) return;

    if (event.target !== svg.node() && event.target.tagName !== "rect") return;

    showQuickAdd(event.clientX, event.clientY);
  });

  // Separate listener for clicks on the bubble (use mousedown to beat svg click)
  svg.on("mousedown.quickadd-click", (event) => {
    if (isSelectionModeEnabled() && !spacebarHeld) return;
    if (!quickAddActive || !quickAddG || !pendingPinPos || !activeBoardId) return;
    if (quickAddG.node().contains(event.target)) {
      event.stopPropagation();
      event.preventDefault();
      const pos = { ...pendingPinPos };
      hideQuickAdd(); // fully cleanup bubble + timeout
      pendingPinPos = pos; // restore pos for modal
      openAddPinModal();
    }
  });

  // Minimap throttle
  let minimapRAF = null;
  function requestMinimapUpdate() {
    if (!minimapRAF) {
      minimapRAF = requestAnimationFrame(() => {
        updateMinimap();
        minimapRAF = null;
      });
    }
  }

  function setTopbarAutoHidden(hidden) {
    if (isTopbarAutoHidden === hidden) return;
    isTopbarAutoHidden = hidden;
    document.body.classList.toggle("topbar-auto-hidden", hidden);
  }

  function shouldHideTopbarForPinOverlap() {
    if (!topbarEl || currentView !== "board" || !activeBoardId) return false;

    const t = currentTransform;
    const k = t.k;

    // Keep header hidden once zoom is 126% or greater.
    // This prevents it from dropping down due to overlap heuristics.
    if (k >= 1.26) return true;

    // Below threshold, keep header visible.
    if (k <= 1.25) return false;

    const pins = Store.getPins(activeBoardId);
    if (pins.length === 0) return false;

    // Use a fixed header height for calculation to avoid layout jitter 
    // when the element itself is moving/transforming.
    const headerHeight = 44; 
    const hideThreshold = headerHeight + TOPBAR_CLIP_BUFFER;
    const showThreshold = hideThreshold + 10; // 10px hysteresis buffer

    let anyOverlap = false;

    for (const pin of pins) {
      const pinW = pin._pw || pin.pinW || PIN_W;
      const pinH = pin._ph || Math.round(pinW * (pin._aspect || (PIN_H / PIN_W)));

      const screenLeft = (pin.x - pinW / 2) * k + t.x;
      const screenRight = (pin.x + pinW / 2) * k + t.x;
      if (screenRight < 0 || screenLeft > width) continue;

      const screenTop = (pin.y - pinH / 2) * k + t.y;
      const screenBottom = (pin.y + pinH / 2) * k + t.y;
      
      // If we are currently showing header, check against tight threshold
      // If we are currently hidden, check against relaxed threshold to prevent flickering
      const threshold = isTopbarAutoHidden ? showThreshold : hideThreshold;
      
      if (screenBottom > 0 && screenTop < threshold) {
        anyOverlap = true;
        break;
      }
    }

    return anyOverlap;
  }

  function updateTopbarAutoVisibility() {
    const shouldHide = shouldHideTopbarForPinOverlap();
    setTopbarAutoHidden(shouldHide);
  }

  function requestTopbarVisibilityUpdate() {
    if (topbarVisibilityRAF) return;
    topbarVisibilityRAF = requestAnimationFrame(() => {
      topbarVisibilityRAF = null;
      updateTopbarAutoVisibility();
    });
  }

  // Track semantic zoom level for CSS class toggles
  let lastZoomTier = "normal"; // "normal" | "far" | "very-far"

  function updateBoardZoomUIVisibility() {
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
  }

  // ── Keyboard shortcuts ─────────────────────────
  document.addEventListener("keydown", (e) => {
    const isInput = ["INPUT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable;
    const hasOpenModal = !!document.querySelector(".modal-overlay:not([hidden])");
    if (isInput || hasOpenModal || !activeBoardId) return;

    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      if (!selectionModeActive) {
        shiftSelectHeld = true;
        syncSelectionModeUI();
        updatePanBinding();
      }
      return;
    }

    if (isSelectionModeEnabled() && e.code === "Space") {
      e.preventDefault();
      if (!spacebarHeld) {
        spacebarHeld = true;
        syncSelectionModeUI();
        updatePanBinding();
      }
      return;
    }

    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redoPinMove();
      else undoPinMove();
      return;
    }

    if (isSelectionModeEnabled() && multiSelectedPinIds.size > 0 && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      const pinsToDelete = Array.from(multiSelectedPinIds)
        .map((id) => Store.getPin(id, activeBoardId))
        .filter((pin) => !!pin);

      if (pinsToDelete.length > 0) {
        pinsToDelete.forEach((pin) => {
          removePinMoveHistory(pin.id);
          Store.detachPinFromBoard(pin.id, activeBoardId);
        });

        pushPinHistory({
          type: "batch",
          entries: pinsToDelete.map((pin) => ({
            type: "delete",
            pinId: pin.id,
            boardId: pin.boardId,
            pin: clonePin(pin),
          })),
        });
      }

      clearMultiSelection();
      renderBoard(activeBoardId);
      return;
    }

    if (selectedPinId && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      deletePinWithHistory(selectedPinId);
      deselectPin();
      renderBoard(activeBoardId);
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      shiftSelectHeld = false;
      syncSelectionModeUI();
      updatePanBinding();
      return;
    }

    if (e.code !== "Space") return;
    if (!isSelectionModeEnabled()) return;
    spacebarHeld = false;
    syncSelectionModeUI();
    updatePanBinding();
  });

  function resetPinMoveHistory() {
    pinMoveUndoStack = [];
    pinMoveRedoStack = [];
  }

  function removePinMoveHistory(pinId) {
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

  function pushPinHistory(entry) {
    pinMoveUndoStack.push(entry);
    if (pinMoveUndoStack.length > MOVE_HISTORY_LIMIT) pinMoveUndoStack.shift();
    pinMoveRedoStack = [];
  }

  function rememberPinMove(pinId, boardId, fromPos, toPos) {
    if (fromPos.x === toPos.x && fromPos.y === toPos.y) return;

    pushPinHistory({
      type: "move",
      pinId,
      boardId,
      fromPos,
      toPos,
    });
  }

  function rememberPinResize(pinId, boardId, fromState, toState) {
    if (fromState.x === toState.x && fromState.y === toState.y && fromState.pinW === toState.pinW) return;

    pushPinHistory({
      type: "resize",
      pinId,
      boardId,
      fromState,
      toState,
    });
  }

  function rememberPinAdd(pin) {
    pushPinHistory({
      type: "add",
      pinId: pin.id,
      boardId: pin.boardId,
      pin: clonePin(pin),
    });
  }

  function rememberPinDelete(pin) {
    pushPinHistory({
      type: "delete",
      pinId: pin.id,
      boardId: pin.boardId,
      pin: clonePin(pin),
    });
  }

  function deletePinWithHistory(pinId) {
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
      updateMinimap();
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
      renderBoard(entry.boardId);
    }

    return true;
  }

  function applyPinAddHistoryEntry(entry, isUndo) {
    if (isUndo) {
      const pin = Store.getPin(entry.pinId, entry.boardId);
      if (!pin) return false;
      Store.detachPinFromBoard(entry.pinId, entry.boardId);
      if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) {
        if (selectedPinId === entry.pinId) deselectPin();
        renderBoard(entry.boardId);
      }
      return true;
    }

    const restored = restorePinFromSnapshot(entry.pin);
    if (!restored) return false;
    if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) renderBoard(entry.boardId);
    return true;
  }

  function applyPinDeleteHistoryEntry(entry, isUndo) {
    if (isUndo) {
      const restored = restorePinFromSnapshot(entry.pin);
      if (!restored) return false;
      if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) renderBoard(entry.boardId);
      return true;
    }

    const pin = Store.getPin(entry.pinId, entry.boardId);
    if (!pin) return false;
    Store.detachPinFromBoard(entry.pinId, entry.boardId);
    if (!suppressHistoryRender && currentView === "board" && activeBoardId === entry.boardId) {
      if (selectedPinId === entry.pinId) deselectPin();
      renderBoard(entry.boardId);
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
        renderBoard(activeBoardId);
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

  function undoPinMove() {
    while (pinMoveUndoStack.length > 0) {
      const entry = pinMoveUndoStack.pop();
      if (!applyPinHistoryEntry(entry, true)) continue;
      pinMoveRedoStack.push(entry);
      return true;
    }

    return false;
  }

  function redoPinMove() {
    while (pinMoveRedoStack.length > 0) {
      const entry = pinMoveRedoStack.pop();
      if (!applyPinHistoryEntry(entry, false)) continue;
      pinMoveUndoStack.push(entry);
      return true;
    }

    return false;
  }

  function flushZoomRender() {
    zoomRenderRAF = null;
    const { k } = currentTransform;

    masterG.attr("transform", currentTransform);
    applyGridTransform(currentTransform, true);
    requestMinimapUpdate();
    requestTopbarVisibilityUpdate();

    // Semantic zoom via CSS classes (no per-element queries)
    // Keep pin placeholders visible until 20% zoom.
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

  function onZoom(event) {
    const prevK = currentTransform.k;
    currentTransform = event.transform;
    const isScaleChange = Math.abs(prevK - currentTransform.k) > 0.0001;

    if (currentView === "board" && !isProgrammaticZoom) {
      startZoomInteraction(isScaleChange);
    }

    if (!zoomRenderRAF) zoomRenderRAF = requestAnimationFrame(flushZoomRender);
  }

  const canvasNode = svg.node();
  canvasNode.addEventListener("pointerdown", (event) => {
    if (currentView !== "board" || !isSelectionModeEnabled() || spacebarHeld) return;
    if (event.button !== 0) return;
    if (event.target.closest && event.target.closest("g.pin-group")) return;

    const [wx, wy] = screenToWorld(event.clientX, event.clientY);
    marqueeStart = { x: wx, y: wy };
    marqueeCurrent = { x: wx, y: wy };
    marqueePointerId = event.pointerId;
    try { canvasNode.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }

    deselectPin();
    svg.on(".zoom", null);
    drawMarquee();
    event.preventDefault();
  });

  canvasNode.addEventListener("pointermove", (event) => {
    if (currentView !== "board") return;
    if (marqueePointerId == null || event.pointerId !== marqueePointerId) return;

    const [wx, wy] = screenToWorld(event.clientX, event.clientY);
    marqueeCurrent = { x: wx, y: wy };
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
  canvasNode.addEventListener("dblclick", (event) => {
    if (currentView !== "board") return;
    suppressQuickAddUntil = Date.now() + 250;
    hideQuickAdd();
    if (!isSelectionModeEnabled()) {
      setSelectionModeActive(true);
      return;
    }

    if (event.target.closest && event.target.closest("g.pin-group")) return;
    shiftSelectHeld = false;
    setSelectionModeActive(false);
  });

  // ── Render dispatcher ──────────────────────────
  function render() {
    const boards = Store.getBoards();
    const hasBoards = boards.length > 0;

    document.body.classList.toggle("profile-mode", currentView === "profile");

    if (currentView === "profile") {
      setTopbarAutoHidden(false);
      document.body.classList.remove("zoom-ui-hidden");
      svg.node().style.cursor = "default";
      emptyState.hidden = true;
      fabGroup.hidden = true;
      profileView.hidden = false;
      cancelZoomInteraction();
      resetViewportToIdentity();
      svg.on(".zoom", null);
      document.getElementById("zoom-indicator").style.display = "none";
      if (minimapContainerEl) minimapContainerEl.style.display = "none";
      renderProfileView();
    } else {
      profileView.hidden = true;
      emptyState.hidden = hasBoards;
      fabGroup.hidden = !hasBoards;

      if (currentView === "home") {
        setTopbarAutoHidden(false);
        document.body.classList.remove("zoom-ui-hidden");
        svg.node().style.removeProperty("cursor");
        cancelZoomInteraction();
        if (pendingHomeViewportGuard) {
          clearViewportInputCarryover();
          guardHomeWheelInput();
          pendingHomeViewportGuard = false;
        }
        resetViewportToIdentity();
        renderHome(boards);
        svg.call(zoom).on("dblclick.zoom", null); // Enable movable grid pan on home page
        document.getElementById("zoom-indicator").style.display = "none";
        if (minimapContainerEl) minimapContainerEl.style.display = "none";
      } else if (currentView === "board") {
        svg.node().style.removeProperty("cursor");
        svg.call(zoom).on("dblclick.zoom", null); // Re-enable zoom in board view
        document.getElementById("zoom-indicator").style.display = "block";
        if (minimapContainerEl) minimapContainerEl.style.display = "flex";
        renderBoard(activeBoardId);
      }
    }

    const fabCenter = document.getElementById("fab-center-group");
    if (fabCenter) {
      fabCenter.classList.toggle("visible", currentView === "board");
    }

    const homeAddBoardGroup = ensureHomeAddBoardButton();
    homeAddBoardGroup.hidden = !(currentView === "home" && hasBoards);

    syncSelectionModeUI();
    updatePanBinding();

    updateMinimap();
    updateBoardZoomUIVisibility();
    requestTopbarVisibilityUpdate();
  }

  // ══════════════════════════════════════════════
  //  LEVEL 1 — HOME / ALL BOARDS
  // ══════════════════════════════════════════════

  function renderHome(boards) {
    masterG.selectAll("*").remove();
    updateBreadcrumb(null);

    // Snap camera to identity so world coords match screen coords (no stale transform).
    resetViewportToIdentity();

    // Position boards in a fixed responsive grid for the My Boards page.
    const usableW = Math.max(1, width - HOME_GRID_PAD_X * 2);
    const maxCols = Math.max(1, Math.floor(usableW / HOME_GRID_CELL_W));
    const boardCount = Math.max(1, boards.length);
    const cols = Math.max(1, Math.min(maxCols, boardCount));
    const rows = Math.max(1, Math.ceil(boardCount / cols));
    const boardsInLastRow = boardCount - (rows - 1) * cols;
    const gridW = Math.max(0, (cols - 1) * HOME_GRID_CELL_W);
    const gridH = Math.max(0, (rows - 1) * HOME_GRID_CELL_H);
    const startX = width / 2 - gridW / 2;
    const startY = height / 2 - gridH / 2;

    boards.forEach((b, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const rowCols = row === rows - 1 ? boardsInLastRow : cols;
      const rowOffset = (cols - rowCols) * HOME_GRID_CELL_W / 2;

      b._x = startX + rowOffset + col * HOME_GRID_CELL_W;
      b._y = startY + row * HOME_GRID_CELL_H;
    });

    const boardGroups = masterG.selectAll("g.board-node")
      .data(boards, d => d.id)
      .join("g")
      .attr("class", "board-node")
      .attr("transform", d => `translate(${d._x},${d._y})`)
      .on("click", (event, d) => enterBoard(d.id, event))
      .style("cursor", "pointer");

    // Board name label
    const label = boardGroups.append("text")
      .attr("class", "board-label")
      .attr("y", 0)
      .text(d => d.name)
      .attr("fill", d => d.color);

    // Board edit icon
    boardGroups.append("foreignObject")
      .attr("class", "board-edit-icon")
      .attr("width", 24)
      .attr("height", 24)
      .each(function(d) {
        // Measure the actual width of the text element to get precise alignment
        const group = d3.select(this.parentNode);
        const textNode = group.select(".board-label").node();
        const textWidth = textNode ? textNode.getBBox().width : (d.name.length * 8);
        d3.select(this).attr("transform", `translate(${textWidth / 2 + 10}, -12)`);
      })
      .attr("pointer-events", "all")
      .html(`
        <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.01); pointer-events: all; cursor: pointer;">
          <i data-lucide="square-pen" style="width: 16px; height: 16px; stroke: #EEEBE7; stroke-width: 1.5; pointer-events: none;"></i>
        </div>
      `)
      .on("click", (event, d) => {
        event.stopPropagation();
        openEditBoardModal(d);
      });
    
    // Initialize icons for the newly added board nodes
    if (window.lucide) {
      window.lucide.createIcons();
    }

    // Pin count subtitle
    boardGroups.append("text")
      .attr("class", "board-count")
      .attr("y", 28)
      .text(d => {
        const count = Store.getPins(d.id).length;
        return count === 0 ? "no pins yet" : count + (count === 1 ? " pin" : " pins");
      });

    const defs = masterG.append("defs");

    // Mini live pin preview for each board
    boardGroups.each(function (board) {
      const pins = Store.getPins(board.id);
      if (pins.length === 0) return;

      const bounds = getPinsWorldBounds(pins);
      if (!bounds) return;

      const paddedW = bounds.width + BOARD_PREVIEW_PAD * 2;
      const paddedH = bounds.height + BOARD_PREVIEW_PAD * 2;
      const previewScale = Math.min(
        BOARD_PREVIEW_MAX_W / paddedW,
        BOARD_PREVIEW_MAX_H / paddedH
      );

      const previewRoot = d3.select(this)
        .append("g")
        .attr("class", "board-pin-preview")
        .attr("transform", `translate(0, ${BOARD_PREVIEW_OFFSET_Y})`)
        .attr("data-preview-scale", previewScale)
        .attr("data-preview-cx", bounds.cx)
        .attr("data-preview-cy", bounds.cy);

      // Keep a visible tiny corner radius after world-layer scaling.
      const previewCornerRadius = Math.max(1, 1 / Math.max(previewScale, 0.001));

      const worldLayer = previewRoot.append("g")
        .attr("class", "board-pin-preview-world")
        .attr("transform", `scale(${previewScale}) translate(${-bounds.cx}, ${-bounds.cy})`);

      const previewPins = pins.map((pin) => {
        const src = getPinImageSrc(pin);
        const hasKnownAspect = imageAspectCache.has(src) || Number.isFinite(pin._aspect);
        const aspect = imageAspectCache.get(src) || pin._aspect || (PIN_H / PIN_W);
        const pw = pin.pinW || pin._pw || PIN_W;
        const ph = Math.round(pw * aspect);

        if (!hasKnownAspect && src) {
          loadImageAspect(src).then(() => {
            if (currentView === "home") scheduleHomePreviewHydrate();
          });
        }

        return {
          id: pin.id,
          x: pin.x,
          y: pin.y,
          pw,
          ph,
          src,
          hasKnownAspect,
          clipId: `home-pin-clip-${board.id}-${pin.id}`,
        };
      });

      previewPins.forEach((pin) => {
        defs.append("clipPath")
          .attr("id", pin.clipId)
          .append("rect")
          .attr("x", -pin.pw / 2)
          .attr("y", -pin.ph / 2)
          .attr("width", pin.pw)
          .attr("height", pin.ph)
              .attr("rx", previewCornerRadius)
              .attr("ry", previewCornerRadius);
      });

      const pinGroups = worldLayer.selectAll("g.board-preview-pin")
        .data(previewPins, d => d.id)
        .join("g")
        .attr("class", "board-preview-pin")
        .attr("transform", d => `translate(${d.x},${d.y})`);

      pinGroups.append("rect")
        .attr("class", "board-preview-pin-bg")
        .attr("x", d => -d.pw / 2)
        .attr("y", d => -d.ph / 2)
        .attr("width", d => d.pw)
        .attr("height", d => d.ph)
        .attr("rx", previewCornerRadius)
        .attr("ry", previewCornerRadius);

      pinGroups.append("image")
        .attr("class", "board-preview-pin-img")
        .attr("href", d => d.src)
        // Avoid initial over-crop before real aspect is known.
        .attr("x", d => -d.pw / 2)
        .attr("y", d => -d.ph / 2)
        .attr("width", d => d.pw)
        .attr("height", d => d.ph)
        .attr("preserveAspectRatio", d => d.hasKnownAspect ? "xMidYMid slice" : "xMidYMid meet")
        .attr("clip-path", d => `url(#${d.clipId})`);
    });

    // Home view remains static (no camera motion).
  }

  // ══════════════════════════════════════════════
  //  LEVEL 2 — BOARD DETAIL / MOOD BOARD
  // ══════════════════════════════════════════════

  function enterBoard(boardId, event) {
    if (boardNavTransition) return;
    if (activeBoardId !== boardId || currentView !== "board") {
      resetPinMoveHistory();
    }
    setSelectionModeActive(false);

    if (currentView === "home") {
      resetViewportToIdentity();
      const pins = getBoardPinsForFitAndTransition(boardId);
      const targetTransform = computeBoardFitTransform(pins);
      const pinBounds = getPinsWorldBounds(pins);
      const board = Store.getBoard(boardId);
      const sourceGeometry = captureHomeBoardGeometryFromDOM(boardId) || computeHomeBoardPreviewGeometry(boardId);
      const targetGeometry = getBoardPinsScreenGeometry(boardId, targetTransform);

      warmBoardImageAspects(boardId);

      if (sourceGeometry && targetGeometry && targetGeometry.pins.length > 0) {
        playBoardNavTransition("enter", board, sourceGeometry, targetGeometry);
      }

      svg.call(zoom).on("dblclick.zoom", null);
      skipNextBoardAutoFit = true;
      runZoomTransition(targetTransform, () => {
        currentView = "board";
        activeBoardId = boardId;
        render();
      }, pinBounds ? {
        anchorWorld: { x: pinBounds.cx, y: pinBounds.cy },
        anchorScreen: { x: width / 2, y: height / 2 },
      } : { lockPan: true });
      return;
    }

    currentView = "board";
    activeBoardId = boardId;
    render();
  }

  function exitBoard() {
    if (boardNavTransition) return;
    resetPinMoveHistory();
    setSelectionModeActive(false);

    if (currentView === "board") {
      const boardId = activeBoardId;
      const board = Store.getBoard(boardId);
      const sourceGeometry = captureBoardGeometryFromDOM() || getBoardPinsScreenGeometry(boardId, currentTransform);
      const targetGeometry = computeHomeBoardPreviewGeometry(boardId);

      if (sourceGeometry && targetGeometry) {
        playBoardNavTransition("exit", board, sourceGeometry, targetGeometry);
      }

      runZoomTransition(d3.zoomIdentity, () => {
        currentView = "home";
        activeBoardId = null;
        pendingHomeViewportGuard = true;
        resetViewportToIdentity();
        render();
      });
      return;
    }

    currentView = "home";
    activeBoardId = null;
    render();
  }

  // ── Coordinate conversion (module-level) ───────
  function screenToWorld(clientX, clientY) {
    return [
      (clientX - currentTransform.x) / currentTransform.k,
      (clientY - currentTransform.y) / currentTransform.k,
    ];
  }

  function renderBoard(boardId) {
    boardRenderToken++;
    const renderToken = boardRenderToken;
    selectedPinId = null;
    masterG.selectAll("*").remove();

    const existingVeil = document.getElementById("board-loading-veil");
    if (existingVeil) existingVeil.remove();
    if (boardLoadingTimer) {
      clearTimeout(boardLoadingTimer);
      boardLoadingTimer = null;
    }

    const board = Store.getBoard(boardId);
    if (!board) { exitBoard(); return; }

    updateBreadcrumb(board);

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
        handleAlignmentAction(btn.dataset.align);
      });

      const actionRow = document.createElement("div");
      actionRow.className = "fab-main-row";
      
      const addPinBtn = document.createElement("button");
      addPinBtn.id = "fab-add-pin";
      addPinBtn.className = "btn btn-primary fab-add-pin-btn";
      addPinBtn.textContent = "+ Add Pin";
      addPinBtn.addEventListener("click", () => openAddPinModal());
      
      const selectBtn = document.createElement("button");
      selectBtn.id = "btn-selection-mode";
      selectBtn.className = "fab-select-btn";
      selectBtn.title = "Selection Mode";
      selectBtn.innerHTML = `<i data-lucide="square-dashed-mouse-pointer"></i>`;
      selectBtn.addEventListener("click", () => {
        setSelectionModeActive(!selectionModeActive);
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
    syncSelectionModeUI();

    if (pins.length === 0) {
      // Empty board hint
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

    // Per-pin clip paths for rounded corners (each pin has unique size)
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

    // Background rect (card body) — per-pin size
    pinGroups.append("rect")
      .attr("class", "pin-bg")
      .attr("width", d => d._pw)
      .attr("height", d => d._ph)
      .attr("x", d => -d._pw / 2)
      .attr("y", d => -d._ph / 2)
      .attr("rx", 6)
      .attr("ry", 6)
      .attr("fill", "#2c2c2c");

    // SVG <image> — per-pin size, no preserveAspectRatio needed since box matches
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

    // Interaction layer — invisible SVG rect on top for drag + click
    pinGroups.append("rect")
      .attr("class", "pin-hit-area")
      .attr("width", d => d._pw)
      .attr("height", d => d._ph)
      .attr("x", d => -d._pw / 2)
      .attr("y", d => -d._ph / 2)
      .attr("fill", "transparent")
      .attr("cursor", "grab");

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
      });
    });

    // ── Pin drag via native pointer events on SVG hit-rect ──

    // Edge-snap: try to align with nearest sibling pin edges (+gap), fall back to grid
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
        // My left edge → their right edge + gap
        const dxLR = Math.abs(myL - (pR + PIN_GAP));
        if (dxLR < bestDX) { bestDX = dxLR; bestX = pR + PIN_GAP + d._pw / 2; }
        // My right edge → their left edge - gap
        const dxRL = Math.abs(myR - (pL - PIN_GAP));
        if (dxRL < bestDX) { bestDX = dxRL; bestX = pL - PIN_GAP - d._pw / 2; }
        // Left-to-left alignment
        const dxLL = Math.abs(myL - pL);
        if (dxLL < bestDX) { bestDX = dxLL; bestX = pL + d._pw / 2; }
        // Right-to-right alignment
        const dxRR = Math.abs(myR - pR);
        if (dxRR < bestDX) { bestDX = dxRR; bestX = pR - d._pw / 2; }
        // Center-to-center X
        const dxCC = Math.abs(d.x - p.x);
        if (dxCC < bestDX) { bestDX = dxCC; bestX = p.x; }

        // ── Y-axis candidates ──
        // My top → their bottom + gap
        const dyTB = Math.abs(myT - (pB + PIN_GAP));
        if (dyTB < bestDY) { bestDY = dyTB; bestY = pB + PIN_GAP + d._ph / 2; }
        // My bottom → their top - gap
        const dyBT = Math.abs(myB - (pT - PIN_GAP));
        if (dyBT < bestDY) { bestDY = dyBT; bestY = pT - PIN_GAP - d._ph / 2; }
        // Top-to-top
        const dyTT = Math.abs(myT - pT);
        if (dyTT < bestDY) { bestDY = dyTT; bestY = pT + d._ph / 2; }
        // Bottom-to-bottom
        const dyBB = Math.abs(myB - pB);
        if (dyBB < bestDY) { bestDY = dyBB; bestY = pB - d._ph / 2; }
        // Center-to-center Y
        const dyCCy = Math.abs(d.y - p.y);
        if (dyCCy < bestDY) { bestDY = dyCCy; bestY = p.y; }
      }

      // Use edge snap if within threshold, otherwise grid snap
      d.x = (bestX !== null && bestDX <= SNAP_THRESH)
        ? bestX
        : Math.round(d.x / GRID) * GRID;
      d.y = (bestY !== null && bestDY <= SNAP_THRESH)
        ? bestY
        : Math.round(d.y / GRID) * GRID;
    }

    const pinById = new Map(pins.map(pin => [pin.id, pin]));

    pinGroups.each(function (d) {
      const gEl = this;
      const hitRect = gEl.querySelector(".pin-hit-area");
      let originX, originY, startWX, startWY, moved;
      let dragIds = [];
      let dragOrigins = new Map();

      hitRect.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (isSelectionModeEnabled() && spacebarHeld) return;

        e.stopPropagation();
        hitRect.setPointerCapture(e.pointerId);

        originX = d.x;
        originY = d.y;
        [startWX, startWY] = screenToWorld(e.clientX, e.clientY);
        moved = false;

        dragIds = (isSelectionModeEnabled() && !spacebarHeld && multiSelectedPinIds.has(d.id))
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
        // Removed filter/opacity change on click
        hitRect.style.cursor = "grabbing";

        // Freeze viewport so currentTransform stays constant
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

        // Re-enable viewport zoom according to mode
        updatePanBinding();

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
            updateMinimap();
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

          if (isSelectionModeEnabled() && !spacebarHeld) {
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
            renderMultiSelection();
            if (multiSelectedPinIds.size > 0 && !selectionModeActive) {
              setSelectionModeActive(true);
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
        openEditPinModal(d);
      });
      hitRect.addEventListener("pointercancel", () => {
        d3.select(gEl).attr("opacity", 1);
        hitRect.style.cursor = "grab";
        updatePanBinding();
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

    renderMultiSelection();

    // Zoom to fit pins, or keep transform when already coming from a home->board transition.
    if (skipNextBoardAutoFit) {
      skipNextBoardAutoFit = false;
    } else {
      runZoomTransition(computeBoardFitTransform(pins.length > 0 ? pins : getBoardPinsForFitAndTransition(boardId)));
    }

    if (!shouldShowVeil) hideBoardLoadingVeil();
    requestTopbarVisibilityUpdate();
  }

  // ── Pin Selection + Resize ─────────────────────
  const PIN_HANDLE_R = 5;
  const PIN_SEL_EDIT_H = 26;
  const PIN_SEL_EDIT_W = 54;

  function deselectPin() {
    if (!selectedPinId) return;
    masterG.select(`g.pin-group[data-id="${selectedPinId}"]`)
      .selectAll(".pin-select-outline, .pin-handle, .pin-sel-edit")
      .remove();
    selectedPinId = null;
  }

  function selectPin(d, gEl) {
    clearMultiSelection();
    deselectPin();
    selectedPinId = d.id;
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

    editG.on("click", (e) => { e.stopPropagation(); openEditPinModal(d); });
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
      let pivotX, pivotY; // The opposite corner that stays fixed
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

        // Pivot is the opposite corner in world space
        pivotX = d.x + ((key === "tl" || key === "bl") ? d._pw / 2 : -d._pw / 2);
        pivotY = d.y + ((key === "tl" || key === "tr") ? d._ph / 2 : -d._ph / 2);
      });

      hNode.addEventListener("pointermove", (e) => {
        if (!resizing) return;
        const [wx, wy] = screenToWorld(e.clientX, e.clientY);
        
        // Target width based on distance from pivot to pointer along X
        let targetW = Math.abs(wx - pivotX);
        targetW = Math.max(70, Math.min(560, Math.round(targetW / GRID) * GRID));
        
        const targetH = Math.round(targetW * d._aspect);
        
        // Update pin width/height
        d._pw = targetW;
        d._ph = targetH;

        // The center must shift because the pivot corner is fixed.
        // New center is half-way between pivot and the new corner position.
        const sigX = (key === "tl" || key === "bl") ? -1 : 1;
        const sigY = (key === "tl" || key === "tr") ? -1 : 1;
        
        d.x = pivotX + (sigX * d._pw / 2);
        d.y = pivotY + (sigY * d._ph / 2);

        // Update SVG group transform
        gEl.setAttribute("transform", `translate(${d.x},${d.y})`);

        // Update all sized elements within the group (which is now centered at the new d.x/d.y)
        const g = d3.select(gEl);
        const setBox = (s) => s
          .attr("x", -d._pw / 2).attr("y", -d._ph / 2)
          .attr("width", d._pw).attr("height", d._ph);
        
        setBox(g.select(".pin-bg"));
        setBox(g.select(".pin-img"));
        setBox(g.select(".pin-hit-area"));
        setBox(g.select(".pin-select-outline"));

        // Update clip path rect
        d3.select(`#pin-clip-${d.id} rect`)
          .attr("x", -d._pw / 2).attr("y", -d._ph / 2)
          .attr("width", d._pw).attr("height", d._ph);

        // Reposition corner circles
        g.selectAll(".pin-handle").each(function () {
          const k = this.dataset.corner;
          this.setAttribute("cx", (k === "tl" || k === "bl") ? -d._pw / 2 : d._pw / 2);
          this.setAttribute("cy", (k === "tl" || k === "tr") ? -d._ph / 2 : d._ph / 2);
        });

        // Reposition edit button (under pin)
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
        updateMinimap();
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

  // ── Breadcrumb ─────────────────────────────────
  function updateBreadcrumb(board) {
    breadcrumb.innerHTML = "";

    const home = document.createElement("span");
    home.className = "crumb" + (board ? "" : " active");
    home.textContent = "My Boards";
    home.dataset.view = "home";
    home.addEventListener("click", () => {
      hideAddPinButton();
      exitBoard();
    });
    breadcrumb.appendChild(home);

    if (board) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "/";
      breadcrumb.appendChild(sep);

      const crumb = document.createElement("span");
      crumb.className = "crumb active";
      crumb.textContent = board.name;
      crumb.style.color = board.color;
      breadcrumb.appendChild(crumb);
    }
  }

  function hideAddPinButton() {
    const btn = document.getElementById("fab-add-pin");
    if (btn) btn.classList.remove("visible");
  }

  function getSavedPinsWithImages() {
    const seenSharedPins = new Set();

    return Store.getAllPins()
      .filter((pin) => pin.imageData || pin.imageUrl)
      .sort((a, b) => {
        const aCreatedAt = Number.isFinite(a.createdAt) ? a.createdAt : Number(a.createdAt) || 0;
        const bCreatedAt = Number.isFinite(b.createdAt) ? b.createdAt : Number(b.createdAt) || 0;
        return bCreatedAt - aCreatedAt;
      })
      .filter((pin) => {
        const sharedPinId = pin.sharedPinId || pin.id;
        if (seenSharedPins.has(sharedPinId)) return false;
        seenSharedPins.add(sharedPinId);
        return true;
      });
  }

  function renderSavedPinGrid(container, pins, options = {}) {
    const {
      columnCount = 4,
      selectable = false,
      selectedIds = new Set(),
      disabledIds = new Set(),
      onTileClick = null,
      emptyMessage = "No saved pins yet.",
    } = options;

    container.innerHTML = "";
    container.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;

    if (pins.length === 0) {
      const empty = document.createElement("p");
      empty.className = "profile-empty-msg";
      empty.textContent = emptyMessage;
      container.appendChild(empty);
      return;
    }

    const columns = Array.from({ length: columnCount }, () => {
      const col = document.createElement("div");
      col.className = container.id === "profile-pins-row" ? "profile-pins-col" : "saved-pins-col";
      container.appendChild(col);
      return col;
    });

    pins.forEach((pin, idx) => {
      const tile = document.createElement("button");
      const isSelected = selectable && selectedIds.has(pin.id);
      const isDisabled = selectable && disabledIds.has(pin.id);
      tile.type = "button";
      tile.className = `${container.id === "profile-pins-row" ? "profile-pin-tile" : "saved-pin-tile"}${isSelected ? " is-selected" : ""}${isDisabled ? " is-disabled" : ""}`;
      tile.disabled = isDisabled;
      tile.setAttribute("aria-pressed", isSelected ? "true" : "false");

      const img = document.createElement("img");
      img.src = pin.imageData || pin.imageUrl;
      img.alt = pin.tags ? pin.tags.join(", ") : "";
      tile.appendChild(img);

      if (selectable) {
        const badge = document.createElement("span");
        badge.className = "saved-pin-check";
        badge.setAttribute("aria-hidden", "true");
        badge.innerHTML = "<span class=\"saved-pin-check-icon\">&check;</span>";
        tile.appendChild(badge);
      }

      if (selectable && !isDisabled && typeof onTileClick === "function") {
        tile.addEventListener("click", () => onTileClick(pin));
      }

      columns[idx % columnCount].appendChild(tile);
    });
  }

  function renderSavedPinsPicker() {
    const grid = document.getElementById("pin-saved-grid");
    const meta = document.getElementById("pin-saved-meta");
    if (!grid || !meta) return;

    const pins = getSavedPinsWithImages();
    renderSavedPinGrid(grid, pins, {
      columnCount: 5,
      selectable: true,
      selectedIds: selectedSavedPinIds,
      emptyMessage: "No saved pins available.",
      onTileClick: (pin) => {
        if (selectedSavedPinIds.has(pin.id)) selectedSavedPinIds.delete(pin.id);
        else selectedSavedPinIds.add(pin.id);
        renderSavedPinsPicker();
      },
    });

    meta.textContent = `${selectedSavedPinIds.size} selected`;
  }

  function openAddPinModal() {
    resetPinToggle();
    renderSavedPinsPicker();
    openModal("modal-pin");
  }

  function getNewPinPlacement(index = 0) {
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

  // ── Profile View ───────────────────────────────
  function renderProfileView() {
    updateBreadcrumb(null);

    // ── Boards grid ──
    const boards = Store.getBoards();
    const grid = document.getElementById("profile-boards-grid");
    grid.innerHTML = "";

    if (boards.length === 0) {
      const empty = document.createElement("p");
      empty.className = "profile-empty-msg";
      empty.textContent = "No boards yet. Create one from the home view.";
      grid.appendChild(empty);
    }

    boards.forEach(board => {
      const pins = Store.getPins(board.id);

      const card = document.createElement("div");
      card.className = "profile-board-card";
      card.addEventListener("click", () => enterBoard(board.id));

      // Mosaic: 1 large slot (left, spans 2 rows) + 2 small slots (right column)
      const mosaic = document.createElement("div");
      mosaic.className = "board-mosaic";

      [0, 1, 2].forEach((i) => {
        const slot = document.createElement("div");
        slot.className = "mosaic-slot" + (i === 0 ? " mosaic-slot-large" : "");

        const pin = pins[i];
        if (pin) {
          const src = pin.imageData || pin.imageUrl;
          if (src) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            img.onerror = () => { slot.style.background = board.color + "22"; img.remove(); };
            slot.appendChild(img);
          } else {
            slot.style.background = board.color + "22";
          }
        } else {
          slot.style.background = board.color + "22";
        }
        mosaic.appendChild(slot);
      });

      card.appendChild(mosaic);

      const info = document.createElement("div");
      info.className = "board-card-info";

      const name = document.createElement("div");
      name.className = "board-card-name";
      name.textContent = board.name;

      const count = document.createElement("div");
      count.className = "board-card-count";
      const n = pins.length;
      count.textContent = n === 0 ? "No pins yet" : n + (n === 1 ? " Pin" : " Pins");

      info.appendChild(name);
      info.appendChild(count);
      card.appendChild(info);
      grid.appendChild(card);
    });

    // ── Saved pins row ──
    const allPins = getSavedPinsWithImages();
    const pinsRow = document.getElementById("profile-pins-row");
    renderSavedPinGrid(pinsRow, allPins, { columnCount: 4, emptyMessage: "No saved pins yet." });
  }


  let mmW = minimapEl.width;
  let mmH = minimapEl.height;
  let mmDpr = 1;

  function setupMinimapCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = minimapEl.clientWidth || Number(minimapEl.getAttribute("width")) || 180;
    const cssH = minimapEl.clientHeight || Number(minimapEl.getAttribute("height")) || 120;

    mmW = Math.round(cssW);
    mmH = Math.round(cssH);

    const pixelW = Math.max(1, Math.round(mmW * dpr));
    const pixelH = Math.max(1, Math.round(mmH * dpr));

    if (minimapEl.width !== pixelW) minimapEl.width = pixelW;
    if (minimapEl.height !== pixelH) minimapEl.height = pixelH;

    if (minimapEl.style.width !== `${mmW}px`) minimapEl.style.width = `${mmW}px`;
    if (minimapEl.style.height !== `${mmH}px`) minimapEl.style.height = `${mmH}px`;

    mmDpr = dpr;
    mCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mCtx.imageSmoothingEnabled = false;
  }

  setupMinimapCanvas();

  function updateMinimap() {
    mCtx.clearRect(0, 0, mmW, mmH);
    drawMinimapFrame();
    const worldBounds = getPanBoundsWorld();

    if (currentView === "home") {
      const boards = Store.getBoards();
      if (boards.length > 0) {
        const cols = Math.max(1, Math.ceil(Math.sqrt(boards.length)));
        boards.forEach((b, i) => {
          b._x = (i % cols) * BOARD_SPREAD + width / 2 - ((cols - 1) * BOARD_SPREAD) / 2;
          b._y = Math.floor(i / cols) * BOARD_SPREAD + height / 2 - (Math.floor((boards.length - 1) / cols) * BOARD_SPREAD) / 2;
        });
        drawProjectedMinimapNodes(
          boards.map(b => ({ x: b._x, y: b._y, color: b.color })),
          worldBounds
        );
      }
    } else {
      const pins = Store.getPins(activeBoardId);
      if (pins.length > 0) {
        drawProjectedMinimapNodes(
          pins.map(p => ({ x: p.x, y: p.y, color: "#EEEBE7" })),
          worldBounds
        );
      }
    }

    drawMinimapViewport(worldBounds);
  }

  function drawMinimapFrame() {
    mCtx.strokeStyle = "rgba(238,235,231,0.3)";
    const lineW = 1 / mmDpr;
    const align = 0.5 / mmDpr;
    mCtx.lineWidth = lineW;
    mCtx.strokeRect(align, align, Math.max(0, mmW - lineW), Math.max(0, mmH - lineW));
  }

  function drawProjectedMinimapNodes(nodes, bounds) {
    if (nodes.length === 0) return;
    if (!bounds) return;

    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxY - bounds.minY;
    if (worldW <= 0 || worldH <= 0) return;

    const sx = mmW / worldW;
    const sy = mmH / worldH;
    const markerSize = 2;

    nodes.forEach(n => {
      const nx = (n.x - bounds.minX) * sx;
      const ny = (n.y - bounds.minY) * sy;
      if (nx < -8 || nx > mmW + 8 || ny < -8 || ny > mmH + 8) return;

      mCtx.fillStyle = n.color;
      mCtx.fillRect(nx - markerSize / 2, ny - markerSize / 2, markerSize, markerSize);
    });
  }

  function drawMinimapViewport(bounds) {
    if (!bounds) return;

    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxY - bounds.minY;
    if (worldW <= 0 || worldH <= 0) return;

    const t = currentTransform;
    const k = t.k || 1;

    const worldLeft = -t.x / k;
    const worldTop = -t.y / k;
    const worldRight = (width - t.x) / k;
    const worldBottom = (height - t.y) / k;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const clampedLeft = clamp(worldLeft, bounds.minX, bounds.maxX);
    const clampedTop = clamp(worldTop, bounds.minY, bounds.maxY);
    const clampedRight = clamp(worldRight, bounds.minX, bounds.maxX);
    const clampedBottom = clamp(worldBottom, bounds.minY, bounds.maxY);

    const sx = mmW / worldW;
    const sy = mmH / worldH;

    const vx = (clampedLeft - bounds.minX) * sx;
    const vy = (clampedTop - bounds.minY) * sy;
    const vw = Math.max(1, (clampedRight - clampedLeft) * sx);
    const vh = Math.max(1, (clampedBottom - clampedTop) * sy);

    mCtx.strokeStyle = "rgba(216, 216, 216, 0.9)";
    const lineW = 1 / mmDpr;
    const align = 0.5 / mmDpr;
    mCtx.lineWidth = lineW;
    mCtx.strokeRect(
      vx + align,
      vy + align,
      Math.max(0, vw - lineW),
      Math.max(0, vh - lineW)
    );
  }

  // ══════════════════════════════════════════════
  //  MODALS
  // ══════════════════════════════════════════════

  function openModal(id) {
    document.getElementById(id).hidden = false;
  }

  function openEditBoardModal(board) {
    const title = document.getElementById("modal-board-title");
    const nameInput = document.getElementById("board-name");
    const idInput = document.getElementById("board-id");
    const descInput = document.getElementById("board-desc");
    const deleteBtn = document.getElementById("btn-delete-board");
    const saveBtn = document.getElementById("btn-save-board");

    title.textContent = "Edit Board";
    nameInput.value = board.name;
    idInput.value = board.id;
    descInput.value = board.description || "";
    deleteBtn.hidden = false;
    saveBtn.textContent = "Save Changes";

    // Set swatch
    document.querySelectorAll("#board-colors .swatch").forEach(s => {
      s.classList.toggle("selected", s.dataset.color === board.color);
    });

    openModal("modal-board");
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    el.hidden = true;

    // Reset board modal if it was open
    if (id === "modal-board") {
      const title = document.getElementById("modal-board-title");
      const nameInput = document.getElementById("board-name");
      const idInput = document.getElementById("board-id");
      const descInput = document.getElementById("board-desc");
      const deleteBtn = document.getElementById("btn-delete-board");
      const saveBtn = document.getElementById("btn-save-board");

      title.textContent = "New Board";
      nameInput.value = "";
      idInput.value = "";
      descInput.value = "";
      deleteBtn.hidden = true;
      saveBtn.textContent = "Create Board";

      document.querySelectorAll("#board-colors .swatch").forEach((s, i) =>
        s.classList.toggle("selected", i === 0));
    }
  }

  // Close on overlay click or [data-dismiss]
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });
  document.querySelectorAll("[data-dismiss]").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".modal-overlay").hidden = true;
    });
  });

  // ── Color swatch selection ─────────────────────
  document.getElementById("board-colors").addEventListener("click", e => {
    const swatch = e.target.closest(".swatch");
    if (!swatch) return;
    document.querySelectorAll("#board-colors .swatch").forEach(s => s.classList.remove("selected"));
    swatch.classList.add("selected");
  });

  // ── Create/Edit Board form ──────────────────────────
  document.getElementById("form-board").addEventListener("submit", e => {
    e.preventDefault();
    const id    = document.getElementById("board-id").value;
    const name  = document.getElementById("board-name").value.trim();
    const desc  = document.getElementById("board-desc").value.trim();
    const color = document.querySelector("#board-colors .swatch.selected")?.dataset.color || "#EEEBE7";

    if (!name) return;

    if (id) {
      Store.updateBoard(id, { name, description: desc, color });
    } else {
      Store.addBoard({ name, description: desc, color });
    }

    closeModal("modal-board");
    e.target.reset();

    currentView = "home";
    activeBoardId = null;
    render();
  });

  const deleteBtn = document.getElementById("btn-delete-board");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      const id = document.getElementById("board-id").value;
      if (!id) return;
      if (confirm("Are you sure you want to delete this board? This action cannot be undone.")) {
        Store.deleteBoard(id);
        closeModal("modal-board");
        currentView = "home";
        activeBoardId = null;
        render();
      }
    });
  }

  // ── Add Pin form ───────────────────────────────
  // Source toggle
  document.querySelectorAll(".pin-source-toggle .toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pin-source-toggle .toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("pin-url-panel").hidden  = btn.dataset.source !== "url";
      document.getElementById("pin-file-panel").hidden = btn.dataset.source !== "file";
      document.getElementById("pin-saved-panel").hidden = btn.dataset.source !== "saved";
      if (btn.dataset.source === "saved") renderSavedPinsPicker();
    });
  });

  document.getElementById("form-pin").addEventListener("submit", e => {
    e.preventDefault();
    if (!activeBoardId) return;

    const tags = currentPinTags.slice();
    const pinId = document.getElementById("pin-id").value;
    const activeSource = document.querySelector(".pin-source-toggle .toggle-btn.active")?.dataset.source;

    if (activeSource === "url") {
      const url = document.getElementById("pin-url").value.trim();
      if (!url) return;
      
      if (pinId) {
        Store.updatePin(pinId, { tags, imageUrl: url, imageData: null });
        renderBoard(activeBoardId);
        closeModal("modal-pin");
      } else {
        addPinAndRender({ boardId: activeBoardId, tags, imageUrl: url });
        closeModal("modal-pin");
      }
      e.target.reset();
      resetPinToggle();
    } else if (activeSource === "file") {
      const file = document.getElementById("pin-file").files[0];
      if (!file && pinId) {
        Store.updatePin(pinId, { tags });
        renderBoard(activeBoardId);
        closeModal("modal-pin");
        e.target.reset();
        resetPinToggle();
        return;
      }
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        if (pinId) {
          Store.updatePin(pinId, { tags, imageData: reader.result, imageUrl: null });
          renderBoard(activeBoardId);
        } else {
          addPinAndRender({ boardId: activeBoardId, tags, imageData: reader.result });
        }
        closeModal("modal-pin");
        e.target.reset();
        resetPinToggle();
      };
      reader.readAsDataURL(file);
    } else if (activeSource === "saved") {
      if (selectedSavedPinIds.size === 0) return;

      Array.from(selectedSavedPinIds).forEach((selectedPinId, index) => {
        const placement = getNewPinPlacement(index);
        const sourcePin = Store.getPin(selectedPinId);
        if (!sourcePin) return;

        const attachedPin = Store.addPin({
          sharedPinId: sourcePin.sharedPinId || sourcePin.id,
          boardId: activeBoardId,
          tags: Array.isArray(sourcePin.tags) ? sourcePin.tags.slice() : [],
          imageUrl: sourcePin.imageUrl,
          imageData: sourcePin.imageData,
          source: sourcePin.source,
          arenaBlockId: sourcePin.arenaBlockId,
          createdAt: sourcePin.createdAt,
          x: placement.x,
          y: placement.y,
          pinW: sourcePin.pinW ?? null,
        });
        if (attachedPin) rememberPinAdd(attachedPin);
      });

      closeModal("modal-pin");
      e.target.reset();
      resetPinToggle();
      renderBoard(activeBoardId);
    }
  });

  function addPinAndRender(pinData) {
    // Use pending position from quick-add bubble if available
    if (pendingPinPos) {
      pinData.x = pendingPinPos.x;
      pinData.y = pendingPinPos.y;
      pendingPinPos = null;
    } else {
      // Place new pin near viewport center, snapped to grid
      const cx = (-currentTransform.x + width / 2) / currentTransform.k;
      const cy = (-currentTransform.y + height / 2) / currentTransform.k;
      const ox = (Math.random() - 0.5) * 200;
      const oy = (Math.random() - 0.5) * 200;
      pinData.x = Math.round((cx + ox) / GRID) * GRID;
      pinData.y = Math.round((cy + oy) / GRID) * GRID;
    }

    const pin = Store.addPin(pinData);
    rememberPinAdd(pin);
    renderBoard(activeBoardId);
  }

  // ── Tag Input ──────────────────────────────────
  let currentPinTags = [];
  let selectedSavedPinIds = new Set();

  function renderTagList() {
    const list = document.getElementById("tag-list");
    list.innerHTML = currentPinTags.map((t, i) =>
      `<span class="tag-pill">${escapeHtml(t)}<button type="button" data-idx="${i}">&times;</button></span>`
    ).join("");
  }

  document.getElementById("pin-tags-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = e.target.value.trim().replace(/,$/g, "");
      if (val && !currentPinTags.includes(val)) {
        currentPinTags.push(val);
        renderTagList();
      }
      e.target.value = "";
    }
    if (e.key === "Backspace" && e.target.value === "" && currentPinTags.length) {
      currentPinTags.pop();
      renderTagList();
    }
  });

  document.getElementById("tag-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-idx]");
    if (!btn) return;
    currentPinTags.splice(Number(btn.dataset.idx), 1);
    renderTagList();
  });

  function resetPinToggle() {
    document.querySelectorAll(".pin-source-toggle .toggle-btn").forEach((b, i) =>
      b.classList.toggle("active", i === 0));
    document.getElementById("pin-url-panel").hidden = true;
    document.getElementById("pin-file-panel").hidden = false;
    document.getElementById("pin-saved-panel").hidden = true;
    document.getElementById("pin-saved-toggle").hidden = false;
    
    // Reset to Add Pin mode
    document.getElementById("modal-pin-title").textContent = "Add Pin";
    document.getElementById("pin-id").value = "";
    document.querySelector("#form-pin button[type='submit']").textContent = "Add Pin";
    document.getElementById("btn-pin-delete").textContent = "Remove";
    document.getElementById("btn-pin-delete").hidden = true;
    currentPinTags = [];
    selectedSavedPinIds.clear();
    renderTagList();
    renderSavedPinsPicker();
    document.getElementById("pin-tags-input").value = "";
    document.getElementById("pin-url").value = "";
    document.getElementById("pin-file").value = "";
  }

  function openEditPinModal(pin) {
    resetPinToggle(); // Start from clean state
    
    document.getElementById("modal-pin-title").textContent = "Edit Pin";
    document.getElementById("pin-id").value = pin.id;
    currentPinTags = Array.isArray(pin.tags) ? pin.tags.slice() : [];
    renderTagList();
    document.querySelector("#form-pin button[type='submit']").textContent = "Update";
    document.getElementById("btn-pin-delete").textContent = "Remove";
    document.getElementById("btn-pin-delete").hidden = false;
    document.getElementById("pin-saved-toggle").hidden = true;
    document.getElementById("pin-saved-panel").hidden = true;

    if (pin.imageUrl) {
      document.getElementById("pin-url").value = pin.imageUrl;
      // Ensure URL panel is shown
      document.querySelector(".pin-source-toggle [data-source='url']").click();
    } else {
      // If it's a file, we can't easily set file input, but we can switch tabs
      document.querySelector(".pin-source-toggle [data-source='file']").click();
    }

    openModal("modal-pin");
  }

  // ── Delete Pin Flow ────────────────────────────
  let pinToDelete = null;

  document.getElementById("btn-pin-delete").addEventListener("click", () => {
    pinToDelete = document.getElementById("pin-id").value;
    if (pinToDelete) {
      openModal("modal-delete");
    }
  });

  document.getElementById("btn-confirm-delete").addEventListener("click", () => {
    if (pinToDelete) {
      deletePinWithHistory(pinToDelete);
      closeAllModals();
      renderBoard(activeBoardId);
      pinToDelete = null;
    }
  });

  function closeAllModals() {
    document.querySelectorAll(".modal-overlay").forEach(m => m.hidden = true);
  }

  // ── Global file drop-to-pin ────────────────────
  // Drop image files from the OS onto the canvas → auto-create pin at drop position
  const SUPPORTED_DROP_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];

  const dropOverlay = document.getElementById("drop-overlay");

  let dragEnterCount = 0;

  document.addEventListener("dragenter", (e) => {
    if (currentView !== "board") return;
    const hasFile = e.dataTransfer && [...e.dataTransfer.items].some(
      it => it.kind === "file" && SUPPORTED_DROP_TYPES.includes(it.type)
    );
    if (!hasFile) return;
    dragEnterCount++;
    dropOverlay.hidden = false;
  });

  document.addEventListener("dragleave", (e) => {
    dragEnterCount--;
    if (dragEnterCount <= 0) {
      dragEnterCount = 0;
      dropOverlay.hidden = true;
    }
  });

  document.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragEnterCount = 0;
    dropOverlay.hidden = true;

    if (currentView !== "board") return;

    const files = [...e.dataTransfer.files].filter(
      f => SUPPORTED_DROP_TYPES.includes(f.type)
    );
    if (!files.length) return;

    // Convert drop screen coords to world coords
    const dropWorldX = (e.clientX - currentTransform.x) / currentTransform.k;
    const dropWorldY = (e.clientY - currentTransform.y) / currentTransform.k;

    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Stagger multiple drops on the grid
        const offset = i * GRID * 2;
        const px = Math.round((dropWorldX + offset) / GRID) * GRID;
        const py = Math.round((dropWorldY + offset) / GRID) * GRID;
        const pin = Store.addPin({
          boardId: activeBoardId,
          tags: [],
          imageData: reader.result,
          source: "local",
          x: px,
          y: py,
        });
        rememberPinAdd(pin);
        if (i === files.length - 1) renderBoard(activeBoardId);
      };
      reader.readAsDataURL(file);
    });
  });

  // ── Button bindings ────────────────────────────
  document.getElementById("btn-new-board").addEventListener("click", () => openModal("modal-board"));

  // Are.na auth button
  document.getElementById("btn-arena-auth").addEventListener("click", () => {
    if (typeof Arena !== "undefined") Arena.startAuth();
  });

  // Are.na import modal — show channels or auth button depending on state
  function refreshArenaModal() {
    const content = document.getElementById("arena-content");
    if (!Arena.isConnected()) {
      content.innerHTML = `
        <p class="arena-status">Connect your Are.na account to import channels as boards.</p>
        <button class="btn btn-primary" id="btn-arena-auth-inner">Authorize Are.na</button>
      `;
      content.querySelector("#btn-arena-auth-inner").addEventListener("click", () => Arena.startAuth());
      return;
    }

    content.innerHTML = '<p class="arena-status">Loading your channels\u2026</p>';

    Arena.fetchChannels().then(channels => {
      if (!channels.length) {
        content.innerHTML = '<p class="arena-status">No channels found on your account.</p>';
        return;
      }

      let html = '<div class="arena-channels">';
      channels.forEach(ch => {
        const count = ch.length || ch.counts?.contents || 0;
        html += `
          <label class="arena-channel">
            <input type="checkbox" value="${ch.id}" data-slug="${ch.slug || ""}" data-title="${escapeHtml(ch.title || "")}">
            <span class="arena-channel-name">${escapeHtml(ch.title)}</span>
            <span class="arena-channel-count">${count} blocks</span>
          </label>`;
      });
      html += '</div>';
      html += '<button class="btn btn-primary" id="btn-arena-import">Import Selected</button>';
      content.innerHTML = html;

      content.querySelector("#btn-arena-import").addEventListener("click", async () => {
        const checked = content.querySelectorAll('input[type="checkbox"]:checked');
        if (checked.length === 0) return;

        const selected = Array.from(checked).map(el => ({
          id:    el.value,
          slug:  el.dataset.slug,
          title: el.dataset.title,
        }));

        content.innerHTML = '<p class="arena-status">Importing\u2026 this may take a moment.</p>';

        try {
          await Arena.importChannels(selected);
          closeModal("modal-arena");
          currentView = "home";
          activeBoardId = null;
          render();
        } catch (err) {
          content.innerHTML = '<p class="arena-status">Import failed: ' + escapeHtml(err.message) + '</p>';
        }
      });
    }).catch(err => {
      content.innerHTML = '<p class="arena-status">Failed to load channels: ' + escapeHtml(err.message) + '</p>';
    });
  }

  // Override arena modal open to refresh state
  document.getElementById("btn-map-pin-house").addEventListener("click", () => {
    if (currentView === "board") {
      const pins = Store.getPins(activeBoardId);
      if (pins.length > 0) {
        const pad = 200;
        const xs = pins.map(p => p.x);
        const ys = pins.map(p => p.y);
        const x0 = d3.min(xs) - pad, x1 = d3.max(xs) + pad;
        const y0 = d3.min(ys) - pad, y1 = d3.max(ys) + pad;
        const dx = x1 - x0, dy = y1 - y0;
        const scale = 1; // Always return to 100%
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const tx = (innerWidth / 2) - (cx * scale);
        const ty = (innerHeight / 2) - (cy * scale);
        runZoomTransition(d3.zoomIdentity.translate(tx, ty).scale(scale));
      } else {
        runZoomTransition(d3.zoomIdentity);
      }
    }
  });

  document.getElementById("btn-connect-arena").addEventListener("click", () => {
    refreshArenaModal();
    openModal("modal-arena");
  });
  document.getElementById("btn-profile-arena").addEventListener("click", () => {
    refreshArenaModal();
    openModal("modal-arena");
  });

  // ── Helpers ────────────────────────────────────
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Resize ─────────────────────────────────────
  window.addEventListener("resize", () => {
    width = window.innerWidth;
    height = window.innerHeight;
    svg.attr("viewBox", [0, 0, width, height]);
    setupMinimapCanvas();
    ensureHomeAddBoardButton();
    applyGridTransform(currentTransform, true);
    requestMinimapUpdate();
    requestTopbarVisibilityUpdate();
  });

  // ── Init ───────────────────────────────────────
  // Handle Are.na callback on page load
  if (typeof Arena !== "undefined") {
    Arena.handleCallback().then(authed => {
      if (authed) {
        refreshArenaModal();
        openModal("modal-arena");
        render();
      }
    });
  }

  // Use FontFaceSet to block initial render until fonts are ready,
  // preventing the "wrong typeface" flicker.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      render();
    });
  } else {
    render();
  }

  topbarLogo.addEventListener("click", () => {
    hideAddPinButton();
    exitBoard();
  });

  topbarProfileBtn.addEventListener("click", () => {
    hideAddPinButton();
    currentView = "profile";
    render();
  });

})();
