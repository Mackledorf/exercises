/* ── bulletin · home.js ─ Home view rendering & layout ── */

import {
  HOME_GRID_CELL_W, HOME_GRID_CELL_H, HOME_GRID_PAD_X, HOME_GRID_PAD_Y,
  HOME_SECTION_GAP, HOME_GROUP_CLUSTER_RADIUS, HOME_GROUP_CLUSTER_PAD,
  HOME_GROUP_HOVER_SCALE, HOME_GROUP_CIRCLE_RADIUS, HOME_GROUP_HOVER_RADIUS,
  BUBBLE_SMALL, BUBBLE_MEDIUM, BUBBLE_LARGE, BUBBLE_GAP,
  BOARD_SPREAD, PIN_W, PIN_H, GRID,
  BOARD_PREVIEW_OFFSET_Y, BOARD_PREVIEW_MAX_W, BOARD_PREVIEW_MAX_H, BOARD_PREVIEW_PAD,
  currentView, activeBoardId, selectionModeActive,
  multiSelectedBoardIds, multiSelectedPinIds,
  masterG, svg, width, height, emptyState, fabGroup, currentTransform,
  homeViewportInitialized, setHomeViewportInitialized,
} from "./state.js";

import {
  unionRects, normalizeRect, imageAspectCache,
  getPinImageSrc, loadImageAspect, escapeHtml, isSafariBrowser,
} from "./utils.js";

import {
  runZoomTransition, resetViewportToIdentity,
  computeFitTransformForWorldRect, getPinsWorldBounds, computeBoardFitTransform,
} from "./viewport.js";

// ── Private state ────────────────────────────────
let homePreviewHydrateQueued = false;
let lastHomeLayout = null;
let _bubbleNodes = [];       // deterministic bubble positions

const HOME_GROUP_COLORS = [
  "#c7f28a",
  "#ffd166",
  "#8ecae6",
  "#f4a261",
  "#e9ff70",
  "#b8f2e6",
  "#f7aef8",
  "#a0c4ff",
];

// ── Callback injection ───────────────────────────
let _enterBoard = null;
let _openModal = null;
let _openEditBoardModal = null;
let _openEditGroupModal = null;
let _openDeleteBoardConfirmation = null;
let _setSelectionModeActive = null;
let _render = null;
let _deselectPin = null;
let _isSelectionModeEnabled = null;
let _updateBreadcrumb = null;

export function init({
  enterBoard,
  openModal,
  openEditBoardModal,
  openEditGroupModal,
  openDeleteBoardConfirmation,
  setSelectionModeActive,
  render,
  deselectPin,
  isSelectionModeEnabled,
  updateBreadcrumb,
}) {
  _enterBoard = enterBoard;
  _openModal = openModal;
  _openEditBoardModal = openEditBoardModal;
  _openEditGroupModal = openEditGroupModal;
  _openDeleteBoardConfirmation = openDeleteBoardConfirmation;
  _setSelectionModeActive = setSelectionModeActive;
  _render = render;
  _deselectPin = deselectPin;
  _isSelectionModeEnabled = isSelectionModeEnabled;
  _updateBreadcrumb = updateBreadcrumb;
}

// ── Helpers ──────────────────────────────────────

export function measureBoardActionRowWidth() {
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

function hashString(value) {
  const str = String(value || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getGroupColor(groupId) {
  const group = Store.getGroup(groupId);
  if (group && group.color) return group.color;
  return HOME_GROUP_COLORS[hashString(groupId) % HOME_GROUP_COLORS.length];
}

function makeStraightPath(x1, y1, x2, y2) {
  return `M${x1},${y1}L${x2},${y2}`;
}

export function ensureHomeAddBoardButton() {
  let group = document.getElementById("home-add-board-group");
  if (!group) {
    group = document.createElement("div");
    group.id = "home-add-board-group";
    group.className = "home-add-board-group fab-center-group visible";

    const btnWrapper = document.createElement("div");
    btnWrapper.className = "fab-main-row";

    const button = document.createElement("button");
    button.id = "btn-home-add-board";
    button.className = "btn btn-primary fab-add-pin-btn home-add-board-btn";
    button.textContent = "+ Add Board";
    button.addEventListener("click", () => {
      if (multiSelectedBoardIds.size > 1) {
        openGroupModal();
      } else {
        _openModal("modal-board");
      }
    });

    const selectBtn = document.createElement("button");
    selectBtn.id = "btn-home-selection-mode";
    selectBtn.className = "fab-select-btn";
    selectBtn.title = "Selection Mode";
    selectBtn.innerHTML = `<i data-lucide="square-dashed-mouse-pointer"></i>`;
    selectBtn.addEventListener("click", () => {
      _setSelectionModeActive(!selectionModeActive);
    });

    btnWrapper.appendChild(button);
    btnWrapper.appendChild(selectBtn);
    group.appendChild(btnWrapper);
    document.body.appendChild(group);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  const button = document.getElementById("btn-home-add-board");
  if (button) {
    const widthPx = measureBoardActionRowWidth();
  }

  updateHomeActionRow();

  return group;
}

export function updateHomeActionRow() {
  const button = document.getElementById("btn-home-add-board");

  if (!button) return;

  if (multiSelectedBoardIds.size > 1) {
    button.textContent = "Group";
    button.classList.remove("home-add-board-btn");
    button.style.backgroundColor = "#fff";
    button.style.color = "#171717";
  } else {
    button.textContent = "+ Add Board";
    button.classList.add("home-add-board-btn");
    button.style.backgroundColor = "";
    button.style.color = "";
  }
}

export function openGroupModal() {
  const title = document.getElementById("modal-board-title");
  const idInput = document.getElementById("board-id");
  const descField = document.querySelector(".board-field");
  const groupSection = document.querySelector(".board-section");
  const saveBtn = document.getElementById("btn-save-board");
  const arenaBtn = document.getElementById("btn-board-to-arena");

  title.textContent = "Group";
  idInput.value = "__group_mode__";
  if (descField) descField.hidden = true;
  if (groupSection) groupSection.hidden = true;
  if (arenaBtn) arenaBtn.hidden = true;
  saveBtn.textContent = "Create";

  _openModal("modal-board");
}

export function scheduleHomePreviewHydrate() {
  if (homePreviewHydrateQueued) return;
  homePreviewHydrateQueued = true;
  requestAnimationFrame(() => {
    homePreviewHydrateQueued = false;
    if (currentView !== "home") return;
    _render();
  });
}

// ── Layout computation ───────────────────────────

export function computeRadialFallbackLayout(boards, centerX, centerY) {
  const count = Math.max(1, boards.length);
  const boardPositions = new Map();
  const baseRadius = Math.max(BUBBLE_MEDIUM * 1.2, 100);

  boards.forEach((board, i) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * i) / count);
    const x = centerX + Math.cos(angle) * baseRadius;
    const y = centerY + Math.sin(angle) * baseRadius;
    boardPositions.set(board.id, { x, y });
  });

  return { boardPositions };
}

export function stopAllGroupSimulations() {
  _bubbleNodes = [];
}

export function computeGroupForceLayout(groupId, boards, centerX, centerY) {
  if (!Array.isArray(boards) || boards.length === 0) {
    return { boardPositions: new Map() };
  }

  const boardPositions = new Map();
  const boardR = BUBBLE_MEDIUM / 2;
  const groupR = BUBBLE_SMALL / 2;
  const minChord = BUBBLE_MEDIUM + BUBBLE_GAP;

  // The minimum ring radius so that `k` boards fit with BUBBLE_GAP between edges.
  // Derived from: chord between adjacent centers >= minChord
  //   chord = 2r·sin(π/k)  →  r = minChord / (2·sin(π/k))
  // Also must clear the inner structure (group or previous ring) + GAP.
  const radiusForCount = (k, floorR) => {
    if (k <= 1) return floorR;
    return Math.max(floorR, minChord / (2 * Math.sin(Math.PI / k)));
  };

  // Fill rings from inside out. Each ring expands to fit its boards.
  // Ring 0 may grow up to 3× the tight-fit radius so the first ring
  // absorbs as many boards as possible before overflow.
  const baseMinR = groupR + BUBBLE_GAP + boardR;
  const maxR0 = baseMinR * 3;

  let remaining = [...boards];
  let prevOuterEdge = groupR; // outer edge of innermost object so far
  let ring = 0;

  while (remaining.length > 0) {
    const ringMinR = prevOuterEdge + BUBBLE_GAP + boardR;
    const maxRingR = ring === 0 ? maxR0 : ringMinR + BUBBLE_MEDIUM + BUBBLE_GAP;

    // Find the largest count that fits within maxRingR
    let count = remaining.length;
    while (count > 1 && radiusForCount(count, ringMinR) > maxRingR) count--;

    const batch = remaining.splice(0, count);
    const r = radiusForCount(batch.length, ringMinR);

    batch.forEach((board, i) => {
      const angle = (Math.PI * 2 * i) / batch.length - Math.PI / 2;
      boardPositions.set(board.id, {
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
      });
    });

    prevOuterEdge = r + boardR;
    ring++;
  }

  return { boardPositions };
}

export function computeHomeLayout() {
  const boards = Store.getBoards();
  const groups = typeof Store.getGroups === "function" ? Store.getGroups() : [];

  const usableW = Math.max(1, width - HOME_GRID_PAD_X * 2);
  const maxCols = Math.max(1, Math.floor(usableW / HOME_GRID_CELL_W));

  const ungrouped = boards.filter(b => !b.groupId);
  const groupedMap = new Map();
  boards.filter(b => b.groupId).forEach(b => {
    if (!groupedMap.has(b.groupId)) groupedMap.set(b.groupId, []);
    groupedMap.get(b.groupId).push(b);
  });

  const groupedNodes = [];
  groups.forEach((group) => {
    const gBoards = groupedMap.get(group.id);
    if (gBoards && gBoards.length > 0) groupedNodes.push({ group, boards: gBoards });
  });

  const allBoardPositions = new Map();
  const ungroupedPositions = new Map();
  const groupNodes = [];
  const groupBounds = new Map();

  const hasUngrouped = ungrouped.length > 0;
  const ungroupedCols = Math.max(1, Math.min(maxCols, Math.max(1, ungrouped.length)));
  const ungroupedRows = hasUngrouped ? Math.max(1, Math.ceil(ungrouped.length / ungroupedCols)) : 0;
  const ungroupedSpanH = hasUngrouped ? (ungroupedRows - 1) * HOME_GRID_CELL_H : 0;

  if (hasUngrouped) {
    const boardsInLastRow = ungrouped.length - (ungroupedRows - 1) * ungroupedCols;
    const gridW = Math.max(0, (ungroupedCols - 1) * HOME_GRID_CELL_W);
    const startX = width / 2 - gridW / 2;
    const startY = Math.max(HOME_GRID_PAD_Y + 10, height * 0.24);

    ungrouped.forEach((board, i) => {
      const row = Math.floor(i / ungroupedCols);
      const col = i % ungroupedCols;
      const rowCols = row === ungroupedRows - 1 ? boardsInLastRow : ungroupedCols;
      const rowOffset = (ungroupedCols - rowCols) * HOME_GRID_CELL_W / 2;
      const pos = {
        x: startX + rowOffset + col * HOME_GRID_CELL_W,
        y: startY + row * HOME_GRID_CELL_H,
      };
      ungroupedPositions.set(board.id, pos);
      allBoardPositions.set(board.id, pos);
    });
  }

  if (groupedNodes.length > 0) {
    const groupsPerRow = Math.max(1, Math.floor(usableW / (HOME_GROUP_CLUSTER_RADIUS * 2 + HOME_GROUP_CLUSTER_PAD)));
    const rowGap = HOME_GROUP_CLUSTER_RADIUS * 2 + HOME_GROUP_CLUSTER_PAD * 2;
    const colGap = HOME_GROUP_CLUSTER_RADIUS * 2 + HOME_GROUP_CLUSTER_PAD;
    const groupsStartY = (hasUngrouped
      ? Math.max(HOME_GRID_PAD_Y + ungroupedSpanH + HOME_SECTION_GAP * 2 + 90, height * 0.52)
      : Math.max(HOME_GRID_PAD_Y + 70, height * 0.36));

    groupedNodes.forEach((entry, i) => {
      const row = Math.floor(i / groupsPerRow);
      const col = i % groupsPerRow;
      const rowCount = Math.min(groupsPerRow, groupedNodes.length - row * groupsPerRow);
      const rowWidth = Math.max(0, (rowCount - 1) * colGap);
      const rowStartX = width / 2 - rowWidth / 2;
      const cx = rowStartX + col * colGap;
      const cy = groupsStartY + row * rowGap;

      const forceLayout = computeGroupForceLayout(entry.group.id, entry.boards, cx, cy);
      const boardIds = entry.boards.map(b => b.id);
      const r = BUBBLE_MEDIUM / 2;

      entry.boards.forEach((board) => {
        const pos = forceLayout.boardPositions.get(board.id) || { x: cx, y: cy };
        allBoardPositions.set(board.id, pos);
      });

      const rects = boardIds.map((boardId) => {
        const p = allBoardPositions.get(boardId) || { x: cx, y: cy };
        return {
          left: p.x - r,
          top: p.y - r,
          width: BUBBLE_MEDIUM,
          height: BUBBLE_MEDIUM,
        };
      });
      const bounds = unionRects(rects) || {
        left: cx - HOME_GROUP_CLUSTER_RADIUS,
        top: cy - HOME_GROUP_CLUSTER_RADIUS,
        width: HOME_GROUP_CLUSTER_RADIUS * 2,
        height: HOME_GROUP_CLUSTER_RADIUS * 2,
      };

      groupBounds.set(entry.group.id, {
        left: bounds.left,
        top: bounds.top,
        right: bounds.left + bounds.width,
        bottom: bounds.top + bounds.height,
        width: bounds.width,
        height: bounds.height,
        cx,
        cy,
      });

      groupNodes.push({
        groupId: entry.group.id,
        groupName: entry.group.name,
        groupColor: getGroupColor(entry.group.id),
        cx,
        cy,
        boardIds,
        boardPositions: forceLayout.boardPositions,
      });
    });
  }

  return {
    boardPositions: allBoardPositions,
    allBoardPositions,
    ungroupedPositions,
    groupNodes,
    groupBounds,
  };
}

export function getHomeBoardGridPositions() {
  return computeHomeLayout().allBoardPositions;
}

export function computeGroupFocusBounds(groupNode, layout) {
  if (!groupNode) return null;
  const direct = layout?.groupBounds?.get(groupNode.groupId);
  if (direct) return direct;

  const r = BUBBLE_MEDIUM / 2;
  const rects = (groupNode.boardIds || []).map((boardId) => {
    const p = layout?.allBoardPositions?.get(boardId);
    if (!p) return null;
    return { left: p.x - r, top: p.y - r, width: BUBBLE_MEDIUM, height: BUBBLE_MEDIUM };
  }).filter(Boolean);
  return unionRects(rects);
}

export function zoomToGroupNode(groupNode, layout) {
  const raw = computeGroupFocusBounds(groupNode, layout);
  if (!raw) return;
  const padded = {
    left: raw.left - 140,
    top: raw.top - 140,
    width: raw.width + 280,
    height: raw.height + 280,
  };
  runZoomTransition(computeFitTransformForWorldRect(padded));
}

export function computeHomeFitTransform(layout) {
  const { allBoardPositions, groupBounds } = layout || lastHomeLayout || {};
  if (!allBoardPositions || allBoardPositions.size === 0) return null;

  const r = BUBBLE_MEDIUM / 2;
  const rects = [];

  allBoardPositions.forEach((pos) => {
    rects.push({ left: pos.x - r, top: pos.y - r, width: BUBBLE_MEDIUM, height: BUBBLE_MEDIUM });
  });

  if (groupBounds) {
    groupBounds.forEach((bounds) => {
      rects.push({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height });
    });
  }

  const worldRect = unionRects(rects);
  if (!worldRect) return null;
  return computeFitTransformForWorldRect(worldRect, 180);
}

export function resetHomeViewport() {
  setHomeViewportInitialized(false);
}

function shouldSuspendHomeMotionEffects() {
  return currentView === "home" && isSafariBrowser() && masterG.classed("camera-moving");
}

// ── Deterministic overlap resolver (replaces D3 simulation) ──

/** Iteratively push overlapping bubbles apart until all have BUBBLE_GAP clearance */
function _resolveOverlaps() {
  if (shouldSuspendHomeMotionEffects()) return;
  const nodes = _bubbleNodes;
  for (let iter = 0; iter < 40; iter++) {
    let anyMoved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        if (a.fixed && b.fixed) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const minDist = a.radius + b.radius + BUBBLE_GAP;
        if (dist >= minDist) continue;
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        if (a.fixed) {
          b.x += nx * overlap;
          b.y += ny * overlap;
        } else if (b.fixed) {
          a.x -= nx * overlap;
          a.y -= ny * overlap;
        } else {
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
        }
        anyMoved = true;
      }
    }
    if (!anyMoved) break;
  }
}

/** D3-transition every board node <g> to its current _bubbleNodes position */
function _transitionBubbles(durationMs) {
  if (shouldSuspendHomeMotionEffects()) return;
  const nodesById = new Map(_bubbleNodes.map(node => [node.id, node]));

  _bubbleNodes.forEach(node => {
    if (node.isCenter) return;
    masterG.selectAll("g.board-node")
      .filter(d => d.id === node.id)
      .transition("bubble-pos")
      .duration(durationMs)
      .ease(d3.easeCubicInOut)
      .attr("transform", `translate(${node.x},${node.y})`);
  });

  masterG.selectAll("path.group-board-arm")
    .transition("bubble-pos")
    .duration(durationMs)
    .ease(d3.easeCubicInOut)
    .attr("d", d => {
      const groupNode = nodesById.get(`gc-${d.groupId}`);
      const boardNode = nodesById.get(d.boardId);
      if (!groupNode || !boardNode) return d.path;
      return makeStraightPath(groupNode.x, groupNode.y, boardNode.x, boardNode.y);
    });

}

/** Called on hover enter/leave — changes a node's radius, resolves, transitions */
function _setNodeHoverRadius(nodeId, visualRadius) {
  if (shouldSuspendHomeMotionEffects()) return;
  const node = _bubbleNodes.find(n => n.id === nodeId);
  if (!node) return;
  node.radius = visualRadius;

  // Reset every non-fixed node to its rest position, then resolve from scratch
  _bubbleNodes.forEach(n => {
    if (!n.fixed) {
      n.x = n.restX;
      n.y = n.restY;
    }
  });

  _resolveOverlaps();
  _transitionBubbles(400);
}

// ── Main render ──────────────────────────────────

export function renderHome(boards) {
  stopAllGroupSimulations();
  masterG.selectAll("*").remove();
  _updateBreadcrumb(null);

  const layout = computeHomeLayout();
  const { allBoardPositions, groupNodes, groupBounds } = layout;
  const groupsById = new Map(groupNodes.map(groupNode => [groupNode.groupId, groupNode]));
  const boardGroupIds = new Map(boards.map(board => [board.id, board.groupId || null]));

  boards.forEach(b => {
    const pos = allBoardPositions.get(b.id);
    if (pos) { b._x = pos.x; b._y = pos.y; }
    b._groupColor = b.groupId ? getGroupColor(b.groupId) : null;
  });

  // ── Build bubble nodes for deterministic overlap resolution ──
  _bubbleNodes = [];

  // Ungrouped boards
  const ungroupedBoards = boards.filter(b => !b.groupId);
  ungroupedBoards.forEach(b => {
    const pos = allBoardPositions.get(b.id) || { x: width / 2, y: height / 2 };
    _bubbleNodes.push({
      id: b.id, type: "board",
      x: pos.x, y: pos.y,
      restX: pos.x, restY: pos.y,
      radius: BUBBLE_MEDIUM / 2, restRadius: BUBBLE_MEDIUM / 2,
      fixed: false, isCenter: false,
    });
  });

  // Group centers (fixed) + grouped boards
  groupNodes.forEach(gn => {
    _bubbleNodes.push({
      id: `gc-${gn.groupId}`, type: "group",
      x: gn.cx, y: gn.cy,
      restX: gn.cx, restY: gn.cy,
      radius: BUBBLE_SMALL / 2, restRadius: BUBBLE_SMALL / 2,
      fixed: true, isCenter: true,
      groupId: gn.groupId,
    });
    gn.boardIds.forEach(boardId => {
      const pos = allBoardPositions.get(boardId) || { x: gn.cx, y: gn.cy };
      _bubbleNodes.push({
        id: boardId, type: "board",
        x: pos.x, y: pos.y,
        restX: pos.x, restY: pos.y,
        radius: BUBBLE_MEDIUM / 2, restRadius: BUBBLE_MEDIUM / 2,
        fixed: false, isCenter: false,
        groupId: gn.groupId,
      });
    });
  });

  // Resolve any initial overlaps and lock in rest positions
  _resolveOverlaps();
  _bubbleNodes.forEach(n => {
    if (n.isCenter) return;
    n.restX = n.x;
    n.restY = n.y;
    allBoardPositions.set(n.id, { x: n.x, y: n.y });
    const b = boards.find(board => board.id === n.id);
    if (b) { b._x = n.x; b._y = n.y; }
  });

  // On first home entry (or when no viewport has been set), fit all boards into view
  if (!homeViewportInitialized && boards.length > 0) {
    setHomeViewportInitialized(true);
    const fitTransform = computeHomeFitTransform(layout);
    if (fitTransform) {
      resetViewportToIdentity();
      runZoomTransition(fitTransform, null, { skipConstrain: false });
    } else {
      resetViewportToIdentity();
    }
  }

  const defs = masterG.append("defs");

  const groupArmData = [];
  groupNodes.forEach((groupNode) => {
    groupNode.boardIds.forEach((boardId) => {
      const boardPos = allBoardPositions.get(boardId);
      if (!boardPos) return;
      groupArmData.push({
        id: `${groupNode.groupId}:${boardId}`,
        groupId: groupNode.groupId,
        boardId,
        color: groupNode.groupColor,
        x1: groupNode.cx,
        y1: groupNode.cy,
        x2: boardPos.x,
        y2: boardPos.y,
        path: makeStraightPath(groupNode.cx, groupNode.cy, boardPos.x, boardPos.y),
      });
    });
  });

  function applyHomeFocus(focus) {
    const hasFocus = !!focus;
    const relatedBoardIds = new Set();
    const relatedGroupIds = new Set();

    if (focus?.groupId) {
      relatedGroupIds.add(focus.groupId);
      const groupNode = groupsById.get(focus.groupId);
      groupNode?.boardIds.forEach(boardId => relatedBoardIds.add(boardId));
    }

    if (focus?.boardId) {
      relatedBoardIds.add(focus.boardId);
      const groupId = boardGroupIds.get(focus.boardId);
      if (groupId) {
        relatedGroupIds.add(groupId);
        groupsById.get(groupId)?.boardIds.forEach(boardId => relatedBoardIds.add(boardId));
      }
    }

    masterG.classed("home-focus-active", hasFocus);
    masterG.selectAll("g.board-node")
      .classed("is-focused", d => hasFocus && relatedBoardIds.has(d.id))
      .classed("is-dimmed", d => hasFocus && !relatedBoardIds.has(d.id));
    masterG.selectAll("g.group-node")
      .classed("is-focused", d => hasFocus && relatedGroupIds.has(d.groupId))
      .classed("is-dimmed", d => hasFocus && !relatedGroupIds.has(d.groupId));
    masterG.selectAll("path.group-board-arm")
      .classed("is-focused", d => hasFocus && relatedGroupIds.has(d.groupId) && relatedBoardIds.has(d.boardId))
      .classed("is-dimmed", d => hasFocus && !(relatedGroupIds.has(d.groupId) && relatedBoardIds.has(d.boardId)));
  }

  masterG.selectAll("path.group-board-arm")
    .data(groupArmData, d => d.id)
    .join("path")
    .attr("class", "group-board-arm")
    .attr("d", d => d.path)
    .attr("stroke", d => d.color);

  // ── Group center bubbles (white) ───────────────
  const groupVisuals = masterG.selectAll("g.group-node")
    .data(groupNodes, d => d.groupId)
    .join("g")
    .attr("class", "group-node")
    .attr("transform", d => `translate(${d.cx},${d.cy})`)
    .on("click", (event, d) => {
      event.stopPropagation();
      if (_isSelectionModeEnabled()) return;
      zoomToGroupNode(d, layout);
    })
    .on("mouseenter", function(event, d) {
      if (shouldSuspendHomeMotionEffects()) return;
      applyHomeFocus({ groupId: d.groupId });
      d3.select(this).raise();
      d3.select(this).select(".group-bubble")
        .transition("bubble-hover").duration(280)
        .ease(d3.easeCubicOut)
        .attr("r", BUBBLE_LARGE / 2);
      _setNodeHoverRadius(`gc-${d.groupId}`, BUBBLE_LARGE / 2);
    })
    .on("mouseleave", function(event, d) {
      if (shouldSuspendHomeMotionEffects()) return;
      applyHomeFocus(null);
      d3.select(this).select(".group-bubble")
        .transition("bubble-hover").duration(240)
        .ease(d3.easeCubicInOut)
        .attr("r", BUBBLE_SMALL / 2);
      _setNodeHoverRadius(`gc-${d.groupId}`, BUBBLE_SMALL / 2);
    });

  groupVisuals.each(function(groupNode) {
    const g = d3.select(this);

    g.append("circle")
      .attr("class", "group-halo")
      .attr("r", BUBBLE_SMALL / 2 + 10)
      .attr("stroke", groupNode.groupColor);

    g.append("circle")
      .attr("class", "group-bubble")
      .attr("r", BUBBLE_SMALL / 2);

    g.append("text")
      .attr("class", "group-name")
      .attr("x", 0)
      .attr("y", 0)
      .text(groupNode.groupName || "Untitled Group");

    // Group Edit Icon
    const groupEditIcon = g.append("g")
      .attr("class", "group-edit-icon")
      .attr("transform", "translate(0, 22)")
      .on("click", (event) => {
        event.stopPropagation();
        const group = Store.getGroups().find(gr => gr.id === groupNode.groupId);
        if (group && _openEditGroupModal) {
          _openEditGroupModal(group);
        }
      });

    groupEditIcon.append("circle")
      .attr("r", 15) // Back to slightly larger hit area for easier clicking
      .attr("fill", "rgba(255,255,255,0.01)");

    groupEditIcon.append("path")
      .attr("d", "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z")
      .attr("fill", "none")
      .attr("stroke", "#000")
      .attr("stroke-width", "2")
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round")
      .attr("transform", "translate(-8, -8) scale(0.65)");

    g.append("circle")
      .attr("class", "group-hit-area")
      .attr("r", BUBBLE_LARGE / 2)
      .style("pointer-events", "auto") // Re-enable pointer events
      .style("fill", "transparent");  // Keep it invisible but interactive

    // Move the edit icon to the front so it's above the hit-area
    groupEditIcon.raise();
  });

  // ── Board bubbles (dark grey circles) ──────────
  const boardR = BUBBLE_MEDIUM / 2;

  const boardGroups = masterG.selectAll("g.board-node")
    .data(boards, d => d.id)
    .join("g")
    .attr("class", "board-node")
    .attr("transform", d => `translate(${d._x},${d._y})`)
    .on("click", (event, d) => {
      if (event.altKey) return;
      if (_isSelectionModeEnabled()) {
        if (multiSelectedBoardIds.has(d.id)) {
          multiSelectedBoardIds.delete(d.id);
        } else {
          multiSelectedBoardIds.add(d.id);
        }
        _render();
        return;
      }
      _enterBoard(d.id, event);
    })
    .style("cursor", "pointer");

  // Circular clip for pin preview inside bubble
  boardGroups.each(function(d) {
    const clipId = `bubble-clip-${d.id}`;
    defs.append("clipPath")
      .attr("id", clipId)
      .append("circle")
      .attr("cx", 0)
      .attr("cy", 0)
      .attr("r", boardR - 2);
  });

  // Board bubble circle (dark grey)
  boardGroups.append("circle")
    .attr("class", "board-bubble")
    .attr("r", boardR);

  boardGroups.each(function(d) {
    if (!d._groupColor) return;
    d3.select(this).insert("circle", ".board-bubble")
      .attr("class", "board-group-ring")
      .attr("r", boardR + 7)
      .attr("stroke", d._groupColor);
  });

  // Selection outline
  boardGroups.each(function(d) {
    if (multiSelectedBoardIds.has(d.id)) {
      d3.select(this).insert("circle", ":first-child")
        .attr("class", "pin-multi-select-outline")
        .attr("r", boardR + 6)
        .attr("fill", "none")
        .attr("stroke", "rgba(100,149,237,0.7)")
        .attr("stroke-width", 3);
    }
  });

  // Mini live pin preview clipped to circle
  boardGroups.each(function (board) {
    const pins = Store.getPins(board.id);
    if (pins.length === 0) return;

    const bounds = getPinsWorldBounds(pins);
    if (!bounds) return;

    // Fit the pin layout into the bubble circle with some padding
    const bubbleDiameter = BUBBLE_MEDIUM - 16; // inset so pins don't touch edge
    const paddedW = bounds.width + BOARD_PREVIEW_PAD * 2;
    const paddedH = bounds.height + BOARD_PREVIEW_PAD * 2;
    const previewScale = Math.min(
      bubbleDiameter / paddedW,
      bubbleDiameter / paddedH
    );

    const clipId = `bubble-clip-${board.id}`;
    const previewRoot = d3.select(this)
      .append("g")
      .attr("class", "board-pin-preview")
      .attr("clip-path", `url(#${clipId})`)
      .attr("data-preview-scale", previewScale)
      .attr("data-preview-cx", bounds.cx)
      .attr("data-preview-cy", bounds.cy)
      .style("pointer-events", "none");

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
        pinClipId: `home-pin-clip-${board.id}-${pin.id}`,
      };
    });

    previewPins.forEach((pin) => {
      defs.append("clipPath")
        .attr("id", pin.pinClipId)
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
      .attr("x", d => -d.pw / 2)
      .attr("y", d => -d.ph / 2)
      .attr("width", d => d.pw)
      .attr("height", d => d.ph)
      .attr("preserveAspectRatio", d => d.hasKnownAspect ? "xMidYMid slice" : "xMidYMid meet")
      .attr("clip-path", d => `url(#${d.pinClipId})`);
  });

  // Dark contrast overlay rendered ON TOP of pins (for all boards)
  boardGroups.append("circle")
    .attr("class", "board-bubble-overlay")
    .attr("r", boardR)
    .style("fill", "rgba(0, 0, 0, 0)")
    .style("mix-blend-mode", "multiply")
    .style("pointer-events", "none");

  // Board name (visible on hover, rendered on top)
  boardGroups.append("text")
    .attr("class", "board-label")
    .attr("y", 4)
    .text(d => d.name);

  // Pin count (visible on hover)
  boardGroups.append("text")
    .attr("class", "board-count")
    .attr("y", 22)
    .text(d => {
      const count = Store.getPins(d.id).length;
      return count === 0 ? "no pins yet" : count + (count === 1 ? " pin" : " pins");
    });

  // Board edit icon (visible on hover)
  const editIconGroup = boardGroups.append("g")
    .attr("class", "board-edit-icon")
    .attr("transform", `translate(0, ${boardR + 12})`) // Moved to bottom
    .attr("pointer-events", "all")
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      event.stopPropagation();
      _openEditBoardModal(d);
    });

  editIconGroup.append("circle")
    .attr("r", 15) // Slightly larger hit area
    .attr("fill", "rgba(255,255,255,0.01)");

  // Using a path for the edit icon
  editIconGroup.append("path")
    .attr("d", "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z")
    .attr("fill", "none")
    .attr("stroke", "#FFF")
    .attr("stroke-width", "2")
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("transform", "translate(-8, -8) scale(0.65)"); // Centered and scaled down properly

  if (window.lucide) {
    window.lucide.createIcons();
  }

  // ── Board bubble hover animation (d3 transitions) ──
  boardGroups
    .on("mouseenter.bubble", function(event, d) {
      if (shouldSuspendHomeMotionEffects()) return;
      applyHomeFocus({ boardId: d.id });
      const g = d3.select(this);
      g.raise(); // paint on top
      g.select(".board-bubble")
        .transition("bubble-hover").duration(280)
        .ease(d3.easeCubicOut)
        .attr("r", BUBBLE_LARGE / 2);
      g.select(".board-bubble-overlay")
        .transition("bubble-hover").duration(280)
        .ease(d3.easeCubicOut)
        .attr("r", BUBBLE_LARGE / 2)
        .style("fill", "rgba(0, 0, 0, 0.55)");
      d3.select(`#bubble-clip-${d.id} circle`)
        .transition("bubble-hover").duration(280)
        .ease(d3.easeCubicOut)
        .attr("r", BUBBLE_LARGE / 2 - 2);
      _setNodeHoverRadius(d.id, BUBBLE_LARGE / 2);
    })
    .on("mouseleave.bubble", function(event, d) {
      if (shouldSuspendHomeMotionEffects()) return;
      applyHomeFocus(null);
      const g = d3.select(this);
      g.select(".board-bubble")
        .transition("bubble-hover").duration(240)
        .ease(d3.easeCubicInOut)
        .attr("r", BUBBLE_MEDIUM / 2);
      g.select(".board-bubble-overlay")
        .transition("bubble-hover").duration(240)
        .ease(d3.easeCubicInOut)
        .attr("r", BUBBLE_MEDIUM / 2)
        .style("fill", "rgba(0, 0, 0, 0)");
      d3.select(`#bubble-clip-${d.id} circle`)
        .transition("bubble-hover").duration(240)
        .ease(d3.easeCubicInOut)
        .attr("r", BUBBLE_MEDIUM / 2 - 2);
      _setNodeHoverRadius(d.id, BUBBLE_MEDIUM / 2);
    });

  svg.on("mousemove.connDrag", null);
  svg.on("mouseup.connDrag", null);

  // Stash layout for hover repulsion
  lastHomeLayout = layout;
}
