/* ── bulletin · utils.js ─ Pure utilities & image cache ── */

import { PIN_W, PIN_H, GRID, currentTransform } from "./state.js";

// ── Image aspect cache ───────────────────────────
export const imageAspectCache = new Map();
const imageAspectPending = new Map();

export function getPinImageSrc(pin) {
  return pin.imageData || pin.imageUrl || "";
}

let isSafariBrowserCache;

export function isSafariBrowser() {
  if (isSafariBrowserCache !== undefined) return isSafariBrowserCache;

  const ua = typeof navigator !== "undefined" ? (navigator.userAgent || "") : "";
  isSafariBrowserCache = /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)/i.test(ua);
  return isSafariBrowserCache;
}

let abFlagsCache;

function parseBoolLike(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function getABFlags() {
  if (abFlagsCache) return abFlagsCache;

  const defaults = {
    noMinimap: false,
    noGrid: false,
    imageMode: "decode",
  };

  if (typeof window === "undefined") {
    abFlagsCache = defaults;
    return abFlagsCache;
  }

  const params = new URLSearchParams(window.location.search || "");
  const ls = window.localStorage;

  const noMinimapRaw = params.get("abNoMinimap") ?? ls.getItem("abNoMinimap");
  const noGridRaw = params.get("abNoGrid") ?? ls.getItem("abNoGrid");
  const imageModeRaw = (params.get("abImageMode") ?? ls.getItem("abImageMode") ?? defaults.imageMode).toLowerCase();

  const imageMode = ["decode", "immediate", "idle"].includes(imageModeRaw) ? imageModeRaw : defaults.imageMode;

  abFlagsCache = {
    noMinimap: parseBoolLike(noMinimapRaw),
    noGrid: parseBoolLike(noGridRaw),
    imageMode,
  };

  return abFlagsCache;
}

export function loadImageAspect(src) {
  if (!src) return Promise.resolve(PIN_H / PIN_W);
  if (imageAspectCache.has(src)) return Promise.resolve(imageAspectCache.get(src));
  if (imageAspectPending.has(src)) return imageAspectPending.get(src);

  const pending = new Promise((resolve, reject) => {
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
      reject(new Error("Failed to load image"));
    };
    img.src = src;
  });

  imageAspectPending.set(src, pending);
  return pending;
}

// ── Geometry helpers ─────────────────────────────
export function normalizeRect(rect) {
  return {
    left: Number.isFinite(rect.left) ? rect.left : 0,
    top: Number.isFinite(rect.top) ? rect.top : 0,
    width: Math.max(1, Number.isFinite(rect.width) ? rect.width : 1),
    height: Math.max(1, Number.isFinite(rect.height) ? rect.height : 1),
  };
}

export function unionRects(rects) {
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

export function scaleRectFromCenter(rect, factor) {
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

export function worldRectToScreenRect(cx, cy, w, h, transform) {
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

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function roundToGrid(value) {
  return Math.round(value / GRID) * GRID;
}

// ── Coordinate conversion ────────────────────────
export function screenToWorld(clientX, clientY) {
  return [
    (clientX - currentTransform.x) / currentTransform.k,
    (clientY - currentTransform.y) / currentTransform.k,
  ];
}

// ── Sort helpers ─────────────────────────────────
export function compareByXThenYThenId(a, b) {
  if (a.x !== b.x) return a.x - b.x;
  if (a.y !== b.y) return a.y - b.y;
  return String(a.id).localeCompare(String(b.id));
}

export function compareByYThenXThenId(a, b) {
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return String(a.id).localeCompare(String(b.id));
}

// ── Misc ─────────────────────────────────────────
export function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
