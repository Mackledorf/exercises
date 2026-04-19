/* ── bulletin · modals.js ─ Modals, forms, tags, pin picker, Arena, file drop, profile ── */

import {
  currentView, setCurrentView,
  activeBoardId, setActiveBoardId,
  selectedPinId,
  masterG, svg, width, height,
  PIN_W, PIN_H, GRID,
  emptyState, fabGroup, topbarEl, breadcrumb,
  currentTransform,
  multiSelectedBoardIds,
} from "./state.js";

import {
  escapeHtml,
  loadImageAspect,
  imageAspectCache,
  getPinImageSrc,
  roundToGrid,
} from "./utils.js";

import {
  rememberPinAdd,
  rememberPinDelete,
  deletePinWithHistory,
  pushPinHistory,
} from "./history.js";

// ── Callbacks (injected via init) ────────────────
let _renderBoard = null;
let _render = null;
let _enterBoard = null;
let _exitBoard = null;
let _deselectPin = null;
let _updateMinimap = null;
let _requestMinimapUpdate = null;
let _resetPinMoveHistory = null;

export function init({
  renderBoard,
  render,
  enterBoard,
  exitBoard,
  deselectPin,
  updateMinimap,
  requestMinimapUpdate,
  resetPinMoveHistory,
}) {
  _renderBoard = renderBoard;
  _render = render;
  _enterBoard = enterBoard;
  _exitBoard = exitBoard;
  _deselectPin = deselectPin;
  _updateMinimap = updateMinimap;
  _requestMinimapUpdate = requestMinimapUpdate;
  _resetPinMoveHistory = resetPinMoveHistory;
}

// ── Private state ────────────────────────────────
let currentPinTags = [];
let selectedSavedPinIds = new Set();
let pinToDelete = null;
let boardsToDelete = null;
let pendingPinPos = null;
let dragEnterCount = 0;

const SUPPORTED_DROP_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
];

// ── pendingPinPos accessors (used by quick-add in app.js) ──
export function getPendingPinPos() { return pendingPinPos; }
export function setPendingPinPos(pos) { pendingPinPos = pos; }

// ══════════════════════════════════════════════════
//  MODAL OPEN / CLOSE
// ══════════════════════════════════════════════════

export function openModal(id) {
  document.getElementById(id).hidden = false;
  if (id === "modal-board") {
    populateBoardGroupSelect("");
    if (window.lucide) lucide.createIcons();
  }
}

export function closeModal(id) {
  const el = document.getElementById(id);
  el.hidden = true;

  if (id === "modal-board") {
    const title = document.getElementById("modal-board-title");
    const idInput = document.getElementById("board-id");
    const descInput = document.getElementById("board-desc");
    const deleteBtn = document.getElementById("btn-delete-board");
    const saveBtn = document.getElementById("btn-save-board");
    const descField = document.querySelector(".board-field");
    const groupSection = document.querySelector(".board-section");
    const arenaBtn = document.getElementById("btn-board-to-arena");

    title.textContent = "New Board";
    idInput.value = "";
    descInput.value = "";
    deleteBtn.hidden = true;
    saveBtn.textContent = "Create";
    if (descField) descField.hidden = false;
    if (groupSection) groupSection.hidden = false;
    if (arenaBtn) arenaBtn.hidden = false;

    const groupSelect = document.getElementById("board-group");
    const newGroupInput = document.getElementById("board-new-group-name");
    if (groupSelect) groupSelect.value = "";
    if (newGroupInput) { newGroupInput.hidden = true; newGroupInput.value = ""; }
  }

  if (id === "modal-delete") {
    const check = document.getElementById("delete-confirm-check");
    if (check) check.checked = false;
    const btn = document.getElementById("btn-confirm-delete");
    if (btn) btn.disabled = false;
  }
}

export function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach(m => {
    if (!m.hidden) closeModal(m.id);
  });
}

// ══════════════════════════════════════════════════
//  BOARD MODAL
// ══════════════════════════════════════════════════

export function populateBoardGroupSelect(selectedGroupId) {
  const select = document.getElementById("board-group");
  if (!select) return;
  Array.from(select.options).forEach(opt => {
    if (opt.value && opt.value !== "__new__") opt.remove();
  });
  const groups = Store.getGroups();
  const insertBefore = select.querySelector('option[value="__new__"]');
  groups.forEach(group => {
    const opt = document.createElement("option");
    opt.value = group.id;
    opt.textContent = group.name;
    if (group.id === selectedGroupId) opt.selected = true;
    select.insertBefore(opt, insertBefore);
  });
  if (!selectedGroupId || !groups.find(g => g.id === selectedGroupId)) {
    select.value = "";
  }
  const newGroupInput = document.getElementById("board-new-group-name");
  if (newGroupInput) newGroupInput.hidden = true;
}

export function openEditBoardModal(board) {
  const title = document.getElementById("modal-board-title");
  const idInput = document.getElementById("board-id");
  const descInput = document.getElementById("board-desc");
  const deleteBtn = document.getElementById("btn-delete-board");
  const saveBtn = document.getElementById("btn-save-board");

  title.textContent = board.name || "Untitled";
  idInput.value = board.id || "";
  descInput.value = board.description || "";
  deleteBtn.hidden = false;
  saveBtn.textContent = "Save";

  const arenaBtn = document.getElementById("btn-board-to-arena");
  if (arenaBtn) arenaBtn.hidden = true;

  populateBoardGroupSelect(board.groupId || "");

  if (window.lucide) lucide.createIcons();
  openModal("modal-board");
}

// ══════════════════════════════════════════════════
//  PIN MODAL
// ══════════════════════════════════════════════════

export function openAddPinModal() {
  resetPinToggle();
  renderSavedPinsPicker();
  openModal("modal-pin");
}

export function openEditPinModal(pin) {
  resetPinToggle();

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
    document.querySelector(".pin-source-toggle [data-source='url']").click();
  } else {
    document.querySelector(".pin-source-toggle [data-source='file']").click();
  }

  openModal("modal-pin");
}

// ══════════════════════════════════════════════════
//  DELETE CONFIRMATION MODAL
// ══════════════════════════════════════════════════

export function openDeleteBoardConfirmation(boardIds) {
  if (!boardIds || boardIds.length === 0) return;
  boardsToDelete = boardIds;
  pinToDelete = null;

  const title = document.getElementById("modal-delete-title");
  const text = document.getElementById("modal-delete-text");
  const checkWrapper = document.getElementById("delete-confirmation-wrapper");
  const confirmBtn = document.getElementById("btn-confirm-delete");

  title.textContent = boardIds.length > 1 ? "Delete Boards?" : "Delete Board?";
  text.textContent = boardIds.length > 1
    ? `This action cannot be undone. Are you sure you want to remove these ${boardIds.length} boards and all their pins?`
    : "This action cannot be undone. Are you sure you want to remove this board and all its pins?";

  if (checkWrapper) checkWrapper.hidden = false;
  const checkInput = document.getElementById("delete-confirm-check");
  if (checkInput) checkInput.checked = false;
  if (confirmBtn) confirmBtn.disabled = true;

  openModal("modal-delete");
}

// ══════════════════════════════════════════════════
//  TAG INPUT
// ══════════════════════════════════════════════════

export function renderTagList() {
  const list = document.getElementById("tag-list");
  list.innerHTML = currentPinTags.map((t, i) =>
    `<span class="tag-pill">${escapeHtml(t)}<button type="button" data-idx="${i}">&times;</button></span>`
  ).join("");
}

export function resetPinToggle() {
  document.querySelectorAll(".pin-source-toggle .toggle-btn").forEach((b, i) =>
    b.classList.toggle("active", i === 0));
  document.getElementById("pin-url-panel").hidden = true;
  document.getElementById("pin-file-panel").hidden = false;
  document.getElementById("pin-saved-panel").hidden = true;
  document.getElementById("pin-saved-toggle").hidden = false;

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

// ══════════════════════════════════════════════════
//  SAVED PINS PICKER
// ══════════════════════════════════════════════════

export function getSavedPinsWithImages() {
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

export function renderSavedPinGrid(container, pins, options = {}) {
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

export function renderSavedPinsPicker() {
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

// ══════════════════════════════════════════════════
//  ADD PIN & PLACEMENT
// ══════════════════════════════════════════════════

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

export function addPinAndRender(pinData) {
  if (pendingPinPos) {
    pinData.x = pendingPinPos.x;
    pinData.y = pendingPinPos.y;
    pendingPinPos = null;
  } else {
    const cx = (-currentTransform.x + width / 2) / currentTransform.k;
    const cy = (-currentTransform.y + height / 2) / currentTransform.k;
    const ox = (Math.random() - 0.5) * 200;
    const oy = (Math.random() - 0.5) * 200;
    pinData.x = Math.round((cx + ox) / GRID) * GRID;
    pinData.y = Math.round((cy + oy) / GRID) * GRID;
  }

  const pin = Store.addPin(pinData);
  rememberPinAdd(pin);
  _renderBoard(activeBoardId);
}

// ══════════════════════════════════════════════════
//  PROFILE VIEW
// ══════════════════════════════════════════════════

export function renderProfileView() {
  updateBreadcrumb(null);

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
    card.addEventListener("click", () => _enterBoard(board.id));

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

  const allPins = getSavedPinsWithImages();
  const pinsRow = document.getElementById("profile-pins-row");
  renderSavedPinGrid(pinsRow, allPins, { columnCount: 4, emptyMessage: "No saved pins yet." });
}

// ══════════════════════════════════════════════════
//  BREADCRUMB
// ══════════════════════════════════════════════════

export function updateBreadcrumb(board) {
  breadcrumb.innerHTML = "";

  const home = document.createElement("span");
  home.className = "crumb";
  home.classList.add("crumb-home");
  home.textContent = "My Boards";
  home.dataset.view = "home";
  home.addEventListener("click", () => {
    hideAddPinButton();
    _exitBoard();
  });
  breadcrumb.appendChild(home);

  if (board) {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "/";
    breadcrumb.appendChild(sep);

    const crumb = document.createElement("span");
    crumb.className = "crumb";
    crumb.classList.add("crumb-current");
    crumb.textContent = board.name;
    breadcrumb.appendChild(crumb);

    const editBtn = document.createElement("button");
    editBtn.className = "crumb-edit-btn";
    editBtn.type = "button";
    editBtn.title = "Edit Board Settings";
    editBtn.innerHTML = `<i data-lucide="settings"></i>`;
    editBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditBoardModal(board);
    });
    breadcrumb.appendChild(editBtn);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}

export function hideAddPinButton() {
  const btn = document.getElementById("fab-add-pin");
  if (btn) btn.classList.remove("visible");
}

// ══════════════════════════════════════════════════
//  ARENA INTEGRATION
// ══════════════════════════════════════════════════

export function refreshArenaModal() {
  const content = document.getElementById("arena-content");
  if (!Arena.isConnected()) {
    content.innerHTML = `
      <div class="arena-panel">
        <p class="arena-status">Connect your Are.na account to import channels as boards.</p>
        <div class="arena-actions-row">
          <button class="btn btn-primary" id="btn-arena-auth-inner">Authorize Are.na</button>
        </div>
      </div>
    `;
    content.querySelector("#btn-arena-auth-inner").addEventListener("click", () => Arena.startAuth());
    return;
  }

  content.innerHTML = '<div class="arena-panel"><p class="arena-status">Loading your channels\u2026</p></div>';

  Arena.fetchChannels().then(channels => {
    if (!channels.length) {
      content.innerHTML = '<div class="arena-panel"><p class="arena-status">No channels found on your account.</p></div>';
      return;
    }

    let html = '<div class="arena-panel">';
    html += '<p class="arena-status">Select channels to import as boards.</p>';
    html += '<div class="arena-channels-stack">';
    channels.forEach(ch => {
      const count = ch.length || ch.counts?.contents || 0;
      const slug = ch.slug || "";
      const safeTitle = escapeHtml(ch.title || "Untitled channel");
      const safeSlug = escapeHtml(slug);
      html += `
        <label class="arena-channel-card">
          <input class="arena-channel-check" type="checkbox" value="${ch.id}" data-slug="${slug}" data-title="${safeTitle}">
          <span class="arena-channel-copy">
            <span class="arena-channel-name">${safeTitle}</span>
            <span class="arena-channel-meta">/${safeSlug || "channel"} · ${count} blocks</span>
          </span>
        </label>`;
    });
    html += '</div>';
    html += '<div class="arena-actions-row"><button class="btn btn-primary" id="btn-arena-import">Import Selected</button></div>';
    html += '</div>';
    content.innerHTML = html;

    content.querySelector("#btn-arena-import").addEventListener("click", async () => {
      const checked = content.querySelectorAll('input[type="checkbox"]:checked');
      if (checked.length === 0) return;

      const selected = Array.from(checked).map(el => ({
        id:    el.value,
        slug:  el.dataset.slug,
        title: el.dataset.title,
      }));

      content.innerHTML = '<div class="arena-panel"><p class="arena-status">Importing\u2026 this may take a moment.</p></div>';

      try {
        await Arena.importChannels(selected);
        closeModal("modal-arena");
        setCurrentView("home");
        setActiveBoardId(null);
        _render();
      } catch (err) {
        content.innerHTML = '<div class="arena-panel"><p class="arena-status">Import failed: ' + escapeHtml(err.message) + '</p></div>';
      }
    });
  }).catch(err => {
    content.innerHTML = '<div class="arena-panel"><p class="arena-status">Failed to load channels: ' + escapeHtml(err.message) + '</p></div>';
  });
}

// ══════════════════════════════════════════════════
//  FILE DROP
// ══════════════════════════════════════════════════

export function initFileDrop() {
  const dropOverlay = document.getElementById("drop-overlay");

  document.addEventListener("dragenter", (e) => {
    if (currentView !== "board") return;
    const hasFile = e.dataTransfer && [...e.dataTransfer.items].some(
      it => it.kind === "file" && SUPPORTED_DROP_TYPES.includes(it.type)
    );
    if (!hasFile) return;
    dragEnterCount++;
    dropOverlay.hidden = false;
  });

  document.addEventListener("dragleave", () => {
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

    const dropWorldX = (e.clientX - currentTransform.x) / currentTransform.k;
    const dropWorldY = (e.clientY - currentTransform.y) / currentTransform.k;

    files.forEach((file, i) => {
      const offset = i * GRID * 2;
      const px = Math.round((dropWorldX + offset) / GRID) * GRID;
      const py = Math.round((dropWorldY + offset) / GRID) * GRID;

      Store.uploadImage(file).then((imageUrl) => {
        const pin = Store.addPin({
          boardId: activeBoardId,
          tags: [],
          imageUrl,
          source: "local",
          x: px,
          y: py,
        });
        rememberPinAdd(pin);
        if (i === files.length - 1) _renderBoard(activeBoardId);
      }).catch((err) => {
        console.error("Drop upload failed:", err);
        // Fallback: read as base64
        const reader = new FileReader();
        reader.onload = () => {
          const pin = Store.addPin({
            boardId: activeBoardId,
            tags: [],
            imageData: reader.result,
            source: "local",
            x: px,
            y: py,
          });
          rememberPinAdd(pin);
          if (i === files.length - 1) _renderBoard(activeBoardId);
        };
        reader.readAsDataURL(file);
      });
    });
  });
}

// ══════════════════════════════════════════════════
//  DOM EVENT BINDINGS (call once at startup)
// ══════════════════════════════════════════════════

export function bindModalEvents() {
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

  // Group select: show/hide create-new-group input
  document.getElementById("board-group").addEventListener("change", e => {
    const newGroupInput = document.getElementById("board-new-group-name");
    if (newGroupInput) {
      newGroupInput.hidden = e.target.value !== "__new__";
      if (!newGroupInput.hidden) newGroupInput.focus();
    }
  });

  // Prevent newlines in editable title
  document.getElementById("modal-board-title").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  });

  // Arena shortcut from board modal
  document.getElementById("btn-board-to-arena").addEventListener("click", () => {
    document.getElementById("modal-board").hidden = true;
    refreshArenaModal();
    openModal("modal-arena");
  });

  // ── Board form submit ──────────────────────────
  document.getElementById("form-board").addEventListener("submit", async e => {
    e.preventDefault();
    const id    = document.getElementById("board-id").value;
    const name  = document.getElementById("modal-board-title").textContent.trim();
    if (!name) return;

    if (id === "__group_mode__") {
      const newGroup = Store.addGroup({ name });
      const boardIds = Array.from(multiSelectedBoardIds);
      boardIds.forEach(bid => {
        Store.updateBoard(bid, { groupId: newGroup.id });
      });
      multiSelectedBoardIds.clear();
      // Selection mode is managed by the caller via callbacks if needed
    } else {
      const desc  = document.getElementById("board-desc").value.trim();
      const color = "#EEEBE7";

      let groupId = document.getElementById("board-group").value;
      if (groupId === "__new__") {
        const newNameInput = document.getElementById("board-new-group-name");
        const newName = newNameInput ? newNameInput.value.trim() : "";
        if (newName) {
          const newGroup = Store.addGroup({ name: newName });
          groupId = newGroup.id;
        } else {
          groupId = "";
        }
      }

      if (id && id !== "__group_mode__") {
        Store.updateBoard(id, { name, description: desc, color, groupId: groupId || null });

        if (currentView === "board" && activeBoardId === id) {
          closeModal("modal-board");
          const updatedBoard = Store.getBoard(id);
          updateBreadcrumb(updatedBoard);
          _render();
          return;
        }
      } else if (!id) {
        Store.addBoard({ name, description: desc, color, groupId: groupId || null });
      }
    }

    closeModal("modal-board");
    if (e.target.reset) e.target.reset();

    setCurrentView("home");
    setActiveBoardId(null);
    _render();
  });

  // ── Delete board button inside board modal ─────
  const deleteBtn = document.getElementById("btn-delete-board");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      const id = document.getElementById("board-id").value;
      if (!id) return;
      if (confirm("Are you sure you want to delete this board? This action cannot be undone.")) {
        Store.deleteBoard(id);
        closeModal("modal-board");
        setCurrentView("home");
        setActiveBoardId(null);
        _render();
      }
    });
  }

  // ── Pin source toggle ──────────────────────────
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

  // ── Pin form submit ────────────────────────────
  document.getElementById("form-pin").addEventListener("submit", async (e) => {
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
        _renderBoard(activeBoardId);
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
        _renderBoard(activeBoardId);
        closeModal("modal-pin");
        e.target.reset();
        resetPinToggle();
        return;
      }
      if (!file) return;

      try {
        const imageUrl = await Store.uploadImage(file);
        if (pinId) {
          Store.updatePin(pinId, { tags, imageUrl, imageData: null });
          _renderBoard(activeBoardId);
        } else {
          addPinAndRender({ boardId: activeBoardId, tags, imageUrl });
        }
      } catch (err) {
        console.error("Image upload failed:", err);
        // Fallback: read as base64 for local preview
        const reader = new FileReader();
        reader.onload = () => {
          if (pinId) {
            Store.updatePin(pinId, { tags, imageData: reader.result, imageUrl: null });
            _renderBoard(activeBoardId);
          } else {
            addPinAndRender({ boardId: activeBoardId, tags, imageData: reader.result });
          }
        };
        reader.readAsDataURL(file);
      }
      closeModal("modal-pin");
      e.target.reset();
      resetPinToggle();
    } else if (activeSource === "saved") {
      if (selectedSavedPinIds.size === 0) return;

      Array.from(selectedSavedPinIds).forEach((selectedId, index) => {
        const placement = getNewPinPlacement(index);
        const sourcePin = Store.getPin(selectedId);
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
      _renderBoard(activeBoardId);
    }
  });

  // ── Tag input ──────────────────────────────────
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

  // ── Pin delete button (opens delete confirmation) ──
  document.getElementById("btn-pin-delete").addEventListener("click", () => {
    pinToDelete = document.getElementById("pin-id").value;
    if (pinToDelete) {
      const title = document.getElementById("modal-delete-title");
      const text = document.getElementById("modal-delete-text");
      const checkWrapper = document.getElementById("delete-confirmation-wrapper");
      const confirmBtn = document.getElementById("btn-confirm-delete");

      title.textContent = "Delete Pin?";
      text.textContent = "This action cannot be undone. Are you sure you want to remove this pin?";
      if (checkWrapper) checkWrapper.hidden = true;
      if (confirmBtn) confirmBtn.disabled = false;
      boardsToDelete = null;

      openModal("modal-delete");
    }
  });

  // ── Delete confirmation checkbox ───────────────
  const deleteCheckInput = document.getElementById("delete-confirm-check");
  if (deleteCheckInput) {
    deleteCheckInput.addEventListener("change", (e) => {
      const confirmBtn = document.getElementById("btn-confirm-delete");
      if (confirmBtn) confirmBtn.disabled = !e.target.checked;
    });
  }

  // ── Confirm delete ─────────────────────────────
  document.getElementById("btn-confirm-delete").addEventListener("click", () => {
    if (pinToDelete) {
      deletePinWithHistory(pinToDelete);
      closeModal("modal-delete");
      _renderBoard(activeBoardId);
      pinToDelete = null;
    } else if (boardsToDelete) {
      boardsToDelete.forEach(id => Store.deleteBoard(id));
      multiSelectedBoardIds.clear();
      boardsToDelete = null;
      closeModal("modal-delete");
      _render();
    }
  });

  // ── New board button (empty state) ─────────────
  document.getElementById("btn-new-board").addEventListener("click", () => openModal("modal-board"));

  // ── Arena auth button ──────────────────────────
  document.getElementById("btn-arena-auth").addEventListener("click", () => {
    if (typeof Arena !== "undefined") Arena.startAuth();
  });

  // ── Arena connect buttons ──────────────────────
  document.getElementById("btn-connect-arena").addEventListener("click", () => {
    refreshArenaModal();
    openModal("modal-arena");
  });
  document.getElementById("btn-profile-arena").addEventListener("click", () => {
    refreshArenaModal();
    openModal("modal-arena");
  });

  // ── File drop ──────────────────────────────────
  initFileDrop();
}
