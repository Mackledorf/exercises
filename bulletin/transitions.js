/* ── bulletin · transitions.js ─ Board navigation transition animations ── */

import {
  currentTransform, currentView, activeBoardId,
  width, height, masterG,
  PIN_W, PIN_H, BOARD_NAV_OVERLAY_MS,
  getHomeLayoutMetrics,
} from "./state.js";

import {
  normalizeRect, scaleRectFromCenter, worldRectToScreenRect, unionRects,
  imageAspectCache, getPinImageSrc, loadImageAspect,
} from "./utils.js";

import {
  getPinsWorldBounds, computeBoardFitTransform,
  getBoardPinsForFitAndTransition, getBoardPlaceholderPinId,
} from "./viewport.js";

// ── Private state ────────────────────────────────
let boardNavTransition = null;
let boardNavTransitionSeq = 0;

export function isBoardNavTransitionActive() {
  return !!boardNavTransition;
}

// ── Helpers ──────────────────────────────────────

export function getBoardPinsForTransition(boardId) {
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

export function getBoardPinsScreenGeometry(boardId, transform) {
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

export function getHomeBoardNode(boardId) {
  const nodes = masterG.selectAll("g.board-node").nodes();
  return nodes.find((node) => node && node.__data__ && node.__data__.id === boardId) || null;
}

export function captureHomeBoardGeometryFromDOM(boardId) {
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

export function computeHomeBoardPreviewGeometry(boardId) {
  const posMap = _getHomeBoardGridPositions();
  const pos = posMap.get(boardId);
  if (!pos) return null;

  const metrics = getHomeLayoutMetrics();
  const bubbleR = metrics.boardRadius;

  const boardPins = Store.getPins(boardId);
  if (boardPins.length === 0) {
    return {
      anchor: { x: pos.x, y: pos.y },
      cardRect: {
        left: pos.x - bubbleR,
        top: pos.y - bubbleR,
        width: metrics.bubbleMedium,
        height: metrics.bubbleMedium,
      },
      pins: [
        {
          id: getBoardPlaceholderPinId(boardId),
          src: "",
          isPlaceholder: true,
          rect: { left: pos.x - 1, top: pos.y - 1, width: 2, height: 2 },
        },
      ],
    };
  }

  const pins = getBoardPinsForTransition(boardId);
  const bounds = getPinsWorldBounds(pins);
  if (!bounds) return null;

  const paddedW = bounds.width + metrics.previewPad * 2;
  const paddedH = bounds.height + metrics.previewPad * 2;
  const previewScale = Math.min(
    metrics.previewMaxW / paddedW,
    metrics.previewMaxH / paddedH
  );

  const previewCenterX = pos.x;
  const previewCenterY = pos.y;

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

  const cardRect = {
    left: pos.x - bubbleR,
    top: pos.y - bubbleR,
    width: metrics.bubbleMedium,
    height: metrics.bubbleMedium,
  };

  return {
    anchor: { x: previewCenterX, y: previewCenterY },
    cardRect,
    pins: pinRects,
  };
}

export function captureBoardGeometryFromDOM() {
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

export function warmBoardImageAspects(boardId) {
  const pins = Store.getPins(boardId);
  pins.forEach((pin) => {
    const src = getPinImageSrc(pin);
    if (!src || imageAspectCache.has(src)) return;
    loadImageAspect(src);
  });
}

// ── Transition layer ─────────────────────────────

export function ensureBoardNavTransitionLayer() {
  let layer = document.getElementById("board-nav-transition-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "board-nav-transition-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

export function setOverlayRect(node, rect) {
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

export function cleanupBoardNavTransition() {
  if (!boardNavTransition) return;
  clearTimeout(boardNavTransition.timer);
  boardNavTransition.layer.innerHTML = "";
  boardNavTransition.layer.classList.remove("visible");
  document.body.classList.remove("board-transition-enter-active");
  document.body.classList.remove("board-transition-exit-active");
  document.body.classList.remove("board-transition-mask-canvas");
  boardNavTransition = null;
}

export function playBoardNavTransition(direction, board, sourceGeometry, targetGeometry) {
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

// ── Callback for home layout positions ───────────
// Injected to avoid circular dependency with app.js home layout code.
let _getHomeBoardGridPositions = () => new Map();

export function initTransitions({ getHomeBoardGridPositions }) {
  if (getHomeBoardGridPositions) _getHomeBoardGridPositions = getHomeBoardGridPositions;
}
