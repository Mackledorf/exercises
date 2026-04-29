/* ── bulletin · explore.js ─ Pinterest-style explore feed ── */

// ── Injected callbacks ───────────────────────────
let _render = null;

export function init({ render }) {
  _render = render;
}

// ── State ────────────────────────────────────────
let activePopoverPinId = null;
let searchQuery = "";
let isInitialized = false;

// ── Render ───────────────────────────────────────

export async function renderExplore() {
  const grid = document.getElementById("explore-grid");
  const searchInput = document.querySelector(".explore-search-input");
  if (!grid) return;

  if (!isInitialized && searchInput) {
    searchInput.disabled = false;
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderExplore();
    });
    isInitialized = true;
  }

  grid.innerHTML = '<p class="explore-empty-msg">Loading pins…</p>';

  let allPins;
  try {
    allPins = await Store.getAllPublicPins();
  } catch (err) {
    console.error("[Explore] Failed to load public pins:", err);
    allPins = Store.getAllPins(); // fallback to own pins
  }

  // Deduplicate by sharedPinId, keep newest
  const seen = new Map();
  for (const pin of allPins) {
    const key = pin.sharedPinId || pin.id;
    const existing = seen.get(key);
    if (!existing || pin.createdAt > existing.createdAt) {
      seen.set(key, pin);
    }
  }

  let pins = Array.from(seen.values())
    .filter(p => p.imageUrl)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (searchQuery) {
    pins = pins.filter(pin => {
      const matchTag = pin.tags.some(t => t.toLowerCase().includes(searchQuery));
      const matchBoard = (pin.boardNames || []).some(b => b.toLowerCase().includes(searchQuery));
      return matchTag || matchBoard;
    });
  }

  grid.innerHTML = "";

  if (pins.length === 0) {
    const empty = document.createElement("p");
    empty.className = "explore-empty-msg";
    empty.textContent = searchQuery ? `No results for "${searchQuery}"` : "Hmm... It's quiet in here.";
    grid.appendChild(empty);
    return;
  }

  for (const pin of pins) {
    grid.appendChild(createPinCard(pin));
  }

  if (window.lucide) lucide.createIcons();
}

export function destroyExplore() {
  dismissPopover();
  searchQuery = "";
  const searchInput = document.querySelector(".explore-search-input");
  if (searchInput) {
    searchInput.value = "";
  }
}

// ── Pin Card ─────────────────────────────────────

function createPinCard(pin) {
  const card = document.createElement("div");
  card.className = "explore-pin-card";
  card.dataset.pinId = pin.id;

  const img = document.createElement("img");
  img.src = pin.imageUrl || pin.imageData;
  img.alt = pin.tags ? pin.tags.join(", ") : "";
  img.loading = "lazy";
  img.draggable = false;
  card.appendChild(img);

  // Hover overlay
  const overlay = document.createElement("div");
  overlay.className = "explore-pin-overlay";

  const saveBtn = document.createElement("button");
  saveBtn.className = "explore-save-btn";
  saveBtn.type = "button";
  saveBtn.title = "Save to board";
  saveBtn.innerHTML = '<i data-lucide="pin" style="width:16px;height:16px;"></i>';
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBoardPicker(pin, saveBtn);
  });
  overlay.appendChild(saveBtn);

  card.appendChild(overlay);
  return card;
}

// ── Board Picker Popover ─────────────────────────

function toggleBoardPicker(pin, anchorEl) {
  if (activePopoverPinId === pin.id) {
    dismissPopover();
    return;
  }
  dismissPopover();
  activePopoverPinId = pin.id;
  showBoardPicker(pin, anchorEl);
}

function showBoardPicker(pin, anchorEl) {
  const boards = Store.getBoards();
  if (boards.length === 0) return;

  const popover = document.createElement("div");
  popover.className = "explore-board-picker";
  popover.id = "explore-board-picker";

  for (const board of boards) {
    const alreadySaved = pin.boardIds && pin.boardIds.includes(board.id);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "explore-board-option" + (alreadySaved ? " is-disabled" : "");
    row.disabled = alreadySaved;

    const dot = document.createElement("span");
    dot.className = "explore-board-dot";
    dot.style.background = board.color || "#EEEBE7";

    const name = document.createElement("span");
    name.className = "explore-board-name";
    name.textContent = board.name;

    row.appendChild(dot);
    row.appendChild(name);

    if (alreadySaved) {
      const check = document.createElement("span");
      check.className = "explore-board-check";
      check.textContent = "✓";
      row.appendChild(check);
    }

    if (!alreadySaved) {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        Store.attachPinToBoard(pin.id, board.id, { x: 0, y: 0 });
        showSavedConfirmation(anchorEl);
        dismissPopover();
      });
    }

    popover.appendChild(row);
  }

  // Position relative to the save button
  const rect = anchorEl.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = (rect.bottom + 6) + "px";
  popover.style.right = (window.innerWidth - rect.right) + "px";

  document.body.appendChild(popover);

  // Dismiss on outside click (delay to avoid immediate dismiss)
  requestAnimationFrame(() => {
    document.addEventListener("click", onPopoverOutsideClick, { once: false });
  });
}

function showSavedConfirmation(btnEl) {
  btnEl.classList.add("saved");
  btnEl.innerHTML = '<i data-lucide="check" style="width:16px;height:16px;"></i>';
  if (window.lucide) lucide.createIcons();
  setTimeout(() => {
    btnEl.classList.remove("saved");
    btnEl.innerHTML = '<i data-lucide="pin" style="width:16px;height:16px;"></i>';
    if (window.lucide) lucide.createIcons();
  }, 1500);
}

function onPopoverOutsideClick(e) {
  const popover = document.getElementById("explore-board-picker");
  if (popover && !popover.contains(e.target)) {
    dismissPopover();
  }
}

function dismissPopover() {
  activePopoverPinId = null;
  const existing = document.getElementById("explore-board-picker");
  if (existing) existing.remove();
  document.removeEventListener("click", onPopoverOutsideClick);
}
