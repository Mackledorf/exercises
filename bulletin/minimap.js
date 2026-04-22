/* ── bulletin · minimap.js ─ Minimap canvas rendering ── */

import * as S from "./state.js";
import { getABFlags, isSafariBrowser } from "./utils.js";

let mmW, mmH, mmDpr = 1;
let minimapRAF = null;
let lastMinimapDrawAt = 0;

const SAFARI_MINIMAP_INTERVAL_MS = 80;
const AB_FLAGS = getABFlags();

// ── Callbacks (injected by coordinator) ──────────
let _getPanBoundsWorld = null;

function shouldSkipMinimap() {
  return AB_FLAGS.noMinimap && (S.currentView === "board" || S.currentView === "home");
}

export function init({ getPanBoundsWorld }) {
  _getPanBoundsWorld = getPanBoundsWorld;

  mmW = S.minimapEl.width;
  mmH = S.minimapEl.height;
  setupMinimapCanvas();
}

export function setupMinimapCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = S.minimapEl.clientWidth || Number(S.minimapEl.getAttribute("width")) || 240;
  const cssH = S.minimapEl.clientHeight || Number(S.minimapEl.getAttribute("height")) || 160;

  mmW = Math.round(cssW);
  mmH = Math.round(cssH);

  const pixelW = Math.max(1, Math.round(mmW * dpr));
  const pixelH = Math.max(1, Math.round(mmH * dpr));

  if (S.minimapEl.width !== pixelW) S.minimapEl.width = pixelW;
  if (S.minimapEl.height !== pixelH) S.minimapEl.height = pixelH;

  if (S.minimapEl.style.width !== `${mmW}px`) S.minimapEl.style.width = `${mmW}px`;
  if (S.minimapEl.style.height !== `${mmH}px`) S.minimapEl.style.height = `${mmH}px`;

  mmDpr = dpr;
  S.mCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S.mCtx.imageSmoothingEnabled = false;
}

export function requestMinimapUpdate() {
  if (shouldSkipMinimap()) return;

  const isPanSensitiveView = S.currentView === "board" || S.currentView === "home";
  const isCameraMoving = !!S.masterG && S.masterG.classed("camera-moving");
  const safariMinimapInterval = AB_FLAGS.safariMinimapIntervalMs ?? SAFARI_MINIMAP_INTERVAL_MS;
  if (isPanSensitiveView && isCameraMoving && isSafariBrowser()) {
    const now = performance.now();
    if ((now - lastMinimapDrawAt) < safariMinimapInterval) {
      return;
    }
  }

  if (!minimapRAF) {
    minimapRAF = requestAnimationFrame(() => {
      updateMinimap();
      minimapRAF = null;
    });
  }
}

export function updateMinimap() {
  if (shouldSkipMinimap()) return;

  S.mCtx.clearRect(0, 0, mmW, mmH);
  drawMinimapFrame();
  const worldBounds = _getPanBoundsWorld();

  if (S.currentView === "home") {
    const boards = Store.getBoards();
    if (boards.length > 0) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(boards.length)));
      const projectedBoards = boards.map((b, i) => {
        const fallbackX = (i % cols) * S.BOARD_SPREAD + S.width / 2 - ((cols - 1) * S.BOARD_SPREAD) / 2;
        const fallbackY = Math.floor(i / cols) * S.BOARD_SPREAD + S.height / 2 - (Math.floor((boards.length - 1) / cols) * S.BOARD_SPREAD) / 2;
        return {
          x: Number.isFinite(b._x) ? b._x : fallbackX,
          y: Number.isFinite(b._y) ? b._y : fallbackY,
          color: b.color,
        };
      });
      drawProjectedMinimapNodes(
        projectedBoards,
        worldBounds
      );
    }
  } else {
    const pins = S.activePinsSnapshot;
    if (pins.length > 0) {
      drawProjectedMinimapNodes(
        pins,
        worldBounds
      );
    }
  }

  drawMinimapViewport(worldBounds);
  lastMinimapDrawAt = performance.now();
}

function drawMinimapFrame() {
  S.mCtx.strokeStyle = "rgba(238,235,231,0.3)";
  const lineW = 1 / mmDpr;
  const align = 0.5 / mmDpr;
  S.mCtx.lineWidth = lineW;
  S.mCtx.strokeRect(align, align, Math.max(0, mmW - lineW), Math.max(0, mmH - lineW));
}

function drawProjectedMinimapNodes(nodes, bounds) {
  if (nodes.length === 0) return;
  if (!bounds) return;

  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  if (worldW <= 0 || worldH <= 0) return;

  const sx = mmW / worldW;
  const sy = mmH / worldH;
  const markerSize = 2.5;

  nodes.forEach(n => {
    const nx = (n.x - bounds.minX) * sx;
    const ny = (n.y - bounds.minY) * sy;
    if (nx < -8 || nx > mmW + 8 || ny < -8 || ny > mmH + 8) return;

    S.mCtx.fillStyle = n.color || "#EEEBE7";
    S.mCtx.beginPath();
    S.mCtx.arc(nx, ny, markerSize, 0, Math.PI * 2);
    S.mCtx.fill();
  });
}

function drawMinimapViewport(bounds) {
  if (!bounds) return;

  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  if (worldW <= 0 || worldH <= 0) return;

  const t = S.currentTransform;
  const k = t.k || 1;

  const worldLeft = -t.x / k;
  const worldTop = -t.y / k;
  const worldRight = (S.width - t.x) / k;
  const worldBottom = (S.height - t.y) / k;

  const clampV = (v, min, max) => Math.max(min, Math.min(max, v));
  const clampedLeft = clampV(worldLeft, bounds.minX, bounds.maxX);
  const clampedTop = clampV(worldTop, bounds.minY, bounds.maxY);
  const clampedRight = clampV(worldRight, bounds.minX, bounds.maxX);
  const clampedBottom = clampV(worldBottom, bounds.minY, bounds.maxY);

  const sx = mmW / worldW;
  const sy = mmH / worldH;

  const vx = (clampedLeft - bounds.minX) * sx;
  const vy = (clampedTop - bounds.minY) * sy;
  const vw = Math.max(1, (clampedRight - clampedLeft) * sx);
  const vh = Math.max(1, (clampedBottom - clampedTop) * sy);

  S.mCtx.strokeStyle = "rgba(216, 216, 216, 0.9)";
  const lineW = 1 / mmDpr;
  const align = 0.5 / mmDpr;
  S.mCtx.lineWidth = lineW;
  S.mCtx.strokeRect(
    vx + align,
    vy + align,
    Math.max(0, vw - lineW),
    Math.max(0, vh - lineW)
  );
}
