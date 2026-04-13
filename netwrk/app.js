/* ── netwrk · app.js ──────────────────────────── */

(function () {
  "use strict";

  // ── Constants ──────────────────────────────────
  const GRID          = 24;     // dot-grid spacing (matches CSS)
  const PIN_W         = 140;    // pin card width
  const PIN_H         = 180;    // pin card height
  const TRANSITION_MS = 500;
  const BOARD_SPREAD  = 280;    // spacing between board nodes

  // ── State ──────────────────────────────────────
  let currentView  = "home";   // "home" | "board"
  let activeBoardId = null;

  // ── DOM ────────────────────────────────────────
  const svg         = d3.select("#canvas");
  const emptyState  = document.getElementById("empty-state");
  const fabGroup    = document.getElementById("fab-group");
  const breadcrumb  = document.getElementById("breadcrumb");
  const zoomLabel   = document.getElementById("zoom-indicator");
  const minimapEl   = document.getElementById("minimap");
  const mCtx        = minimapEl.getContext("2d");

  // ── SVG setup ──────────────────────────────────
  const width  = window.innerWidth;
  const height = window.innerHeight;
  svg.attr("viewBox", [0, 0, width, height]);

  const masterG = svg.append("g");

  // ── Zoom behavior ──────────────────────────────
  const zoom = d3.zoom()
    .scaleExtent([0.1, 10])
    .on("zoom", onZoom)
    .filter(event => {
      // Let our custom wheel handler manage scroll/pinch.
      // D3 handles click-drag panning and programmatic transforms.
      if (event.type === 'wheel') return false;
      return !event.button;
    });

  // Trackpad / Scrollwheel — single custom handler
  svg.on("wheel", (event) => {
    if (currentView !== "board") return;
    event.preventDefault();

    if (event.ctrlKey) {
      // Pinch-to-zoom (trackpad sends ctrl + wheel for pinch)
      const factor = Math.pow(2, -event.deltaY * 0.01);
      svg.call(zoom.scaleBy, factor, [event.clientX, event.clientY]);
    } else {
      // Two-finger translation (natural scrolling)
      svg.call(zoom.translateBy, -event.deltaX / currentTransform.k, -event.deltaY / currentTransform.k);
    }
  }, { passive: false });

  svg.call(zoom);

  let currentTransform = d3.zoomIdentity;

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

  // Track semantic zoom level for CSS class toggles
  let lastZoomTier = "normal"; // "normal" | "far" | "very-far"

  function onZoom(event) {
    currentTransform = event.transform;
    const { x, y, k } = currentTransform;

    masterG.attr("transform", currentTransform);

    // Sync CSS background grid (GPU-accelerated)
    const canvasNode = svg.node();
    canvasNode.style.backgroundPosition = `${x}px ${y}px`;
    canvasNode.style.backgroundSize = `${GRID * k}px ${GRID * k}px`;

    // Semantic zoom via CSS classes (no per-element queries)
    const tier = k < 0.3 ? "very-far" : k < 0.6 ? "far" : "normal";
    if (tier !== lastZoomTier) {
      masterG.classed("zoom-far", tier === "far")
             .classed("zoom-very-far", tier === "very-far");
      lastZoomTier = tier;
    }

    zoomLabel.textContent = Math.round(k * 100) + "%";
    requestMinimapUpdate();
  }

  // ── Render dispatcher ──────────────────────────
  function render() {
    const boards = Store.getBoards();
    const hasBoards = boards.length > 0;

    emptyState.hidden = hasBoards;
    fabGroup.hidden = !hasBoards;

    if (currentView === "home") {
      renderHome(boards);
      svg.on(".zoom", null); // Disable zoom on home page
      document.getElementById("zoom-indicator").style.display = "none";
      minimapEl.style.display = "none";
    } else if (currentView === "board") {
      svg.call(zoom); // Re-enable zoom in board view
      document.getElementById("zoom-indicator").style.display = "block";
      minimapEl.style.display = "block";
      renderBoard(activeBoardId);
    }

    updateMinimap();
  }

  // ══════════════════════════════════════════════
  //  LEVEL 1 — HOME / ALL BOARDS
  // ══════════════════════════════════════════════

  function renderHome(boards) {
    masterG.selectAll("*").remove();
    updateBreadcrumb(null);

    // Position boards in a grid-like spread
    const cols = Math.max(1, Math.ceil(Math.sqrt(boards.length)));
    boards.forEach((b, i) => {
      b._x = (i % cols) * BOARD_SPREAD + width / 2 - ((cols - 1) * BOARD_SPREAD) / 2;
      b._y = Math.floor(i / cols) * BOARD_SPREAD + height / 2 - (Math.floor((boards.length - 1) / cols) * BOARD_SPREAD) / 2;
    });

    const boardGroups = masterG.selectAll("g.board-node")
      .data(boards, d => d.id)
      .join("g")
      .attr("class", "board-node")
      .attr("transform", d => `translate(${d._x},${d._y})`)
      .on("click", (event, d) => enterBoard(d.id))
      .style("cursor", "pointer");

    // Board name label
    boardGroups.append("text")
      .attr("class", "board-label")
      .attr("y", 0)
      .text(d => d.name)
      .attr("fill", d => d.color);

    // Pin count subtitle
    boardGroups.append("text")
      .attr("class", "board-count")
      .attr("y", 28)
      .text(d => {
        const count = Store.getPins(d.id).length;
        return count === 0 ? "no pins yet" : count + (count === 1 ? " pin" : " pins");
      });

    // Small dot cluster to hint at pins
    boardGroups.each(function (board) {
      const pins = Store.getPins(board.id);
      const g = d3.select(this).append("g")
        .attr("class", "board-dot-cluster")
        .attr("transform", "translate(0, 52)");

      const dotCount = Math.min(pins.length, 20);
      const dotCols = Math.ceil(Math.sqrt(dotCount));
      for (let i = 0; i < dotCount; i++) {
        g.append("circle")
          .attr("class", "board-dot")
          .attr("cx", (i % dotCols - (dotCols - 1) / 2) * 8)
          .attr("cy", Math.floor(i / dotCols) * 8)
          .attr("r", 2.5)
          .attr("fill", board.color);
      }
    });

    // Reset zoom to center
    svg.transition().duration(TRANSITION_MS)
      .call(zoom.transform, d3.zoomIdentity);
  }

  // ══════════════════════════════════════════════
  //  LEVEL 2 — BOARD DETAIL / MOOD BOARD
  // ══════════════════════════════════════════════

  function enterBoard(boardId) {
    currentView = "board";
    activeBoardId = boardId;
    render();
  }

  function exitBoard() {
    currentView = "home";
    activeBoardId = null;
    render();
  }

  function renderBoard(boardId) {
    masterG.selectAll("*").remove();

    const board = Store.getBoard(boardId);
    if (!board) { exitBoard(); return; }

    updateBreadcrumb(board);

    const pins = Store.getPins(boardId);

    // Show "Add Pin" button
    let addPinBtn = document.getElementById("fab-add-pin");
    if (!addPinBtn) {
      addPinBtn = document.createElement("button");
      addPinBtn.id = "fab-add-pin";
      addPinBtn.className = "btn btn-primary fab-add-pin visible";
      addPinBtn.textContent = "+ Add Pin";
      document.body.appendChild(addPinBtn);
      addPinBtn.addEventListener("click", () => openModal("modal-pin"));
    }
    addPinBtn.classList.add("visible");

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

    // Render pin cards
    const pinGroups = masterG.selectAll("g.pin-group")
      .data(pins, d => d.id)
      .join("g")
      .attr("class", "pin-group")
      .attr("transform", d => `translate(${d.x},${d.y})`);

    // Display layer — foreignObject for images (no pointer events)
    pinGroups.append("foreignObject")
      .attr("class", "pin-card-fo")
      .attr("width", PIN_W)
      .attr("height", 600)
      .attr("x", -PIN_W / 2)
      .attr("y", -PIN_H / 2)
      .style("pointer-events", "none")
      .append("xhtml:div")
      .attr("class", "pin-card")
      .html(d => {
        const src = d.imageData || d.imageUrl;
        const tags = d.tags && d.tags.length ? d.tags : [];
        const tagsHtml = tags.length
          ? `<div class="pin-tags">${tags.map(t => `<span class="pin-tag">${escapeHtml(t)}</span>`).join("")}</div>`
          : "";
        return `<img src="${encodeURI(src)}" alt="${escapeHtml(tags.join(', '))}" loading="lazy" />${tagsHtml}`;
      });

    // Interaction layer — invisible SVG rect on top for drag + click
    pinGroups.append("rect")
      .attr("class", "pin-hit-area")
      .attr("width", PIN_W)
      .attr("height", PIN_H)
      .attr("x", -PIN_W / 2)
      .attr("y", -PIN_H / 2)
      .attr("fill", "transparent")
      .attr("cursor", "grab");

    // Drag + click via pointer events on the SVG hit-area rect
    pinGroups.each(function (d) {
      const gEl = this;
      const hitRect = gEl.querySelector(".pin-hit-area");
      let startX, startY, dragging, totalDist;

      hitRect.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        startY = e.clientY;
        dragging = false;
        totalDist = 0;
        hitRect.setPointerCapture(e.pointerId);
        d3.select(gEl).raise();
        // Disable pan while dragging a pin
        svg.on(".zoom", null);
      });

      hitRect.addEventListener("pointermove", (e) => {
        if (startX == null) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;
        totalDist += Math.abs(dx) + Math.abs(dy);
        if (totalDist > 4) dragging = true;
        if (!dragging) return;

        d.x += dx / currentTransform.k;
        d.y += dy / currentTransform.k;
        gEl.setAttribute("transform", `translate(${d.x},${d.y})`);
        gEl.querySelector(".pin-card")?.classList.add("dragging");
        hitRect.style.cursor = "grabbing";
      });

      function finishDrag(e) {
        if (startX == null) return;
        hitRect.releasePointerCapture(e.pointerId);

        if (dragging) {
          d.x = Math.round(d.x / GRID) * GRID;
          d.y = Math.round(d.y / GRID) * GRID;
          d3.select(gEl)
            .transition().duration(120)
            .attr("transform", `translate(${d.x},${d.y})`);
          gEl.querySelector(".pin-card")?.classList.remove("dragging");
          hitRect.style.cursor = "grab";
          Store.updatePin(d.id, { x: d.x, y: d.y });
          updateMinimap();
        } else {
          openEditPinModal(d);
        }

        startX = startY = null;
        dragging = false;
        svg.call(zoom);
      }

      hitRect.addEventListener("pointerup", finishDrag);
      hitRect.addEventListener("pointercancel", (e) => {
        startX = startY = null;
        dragging = false;
        gEl.querySelector(".pin-card")?.classList.remove("dragging");
        hitRect.style.cursor = "grab";
        svg.call(zoom);
      });
    });

    // Zoom to fit pins, or center if empty
    if (pins.length > 0) {
      const pad = 200;
      const xs = pins.map(p => p.x);
      const ys = pins.map(p => p.y);
      const x0 = d3.min(xs) - pad, x1 = d3.max(xs) + pad;
      const y0 = d3.min(ys) - pad, y1 = d3.max(ys) + pad;
      const dx = x1 - x0, dy = y1 - y0;
      const scale = Math.min(width / dx, height / dy, 2);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const tx = width / 2 - cx * scale;
      const ty = height / 2 - cy * scale;

      svg.transition().duration(TRANSITION_MS)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    } else {
      svg.transition().duration(TRANSITION_MS)
        .call(zoom.transform, d3.zoomIdentity);
    }
  }

  // ── Breadcrumb ─────────────────────────────────
  function updateBreadcrumb(board) {
    breadcrumb.innerHTML = "";

    const home = document.createElement("span");
    home.className = "crumb" + (board ? "" : " active");
    home.textContent = "All Boards";
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

  // ── Minimap ────────────────────────────────────
  const mmW = minimapEl.width;
  const mmH = minimapEl.height;

  function updateMinimap() {
    mCtx.clearRect(0, 0, mmW, mmH);

    if (currentView === "home") {
      const boards = Store.getBoards();
      if (boards.length === 0) return;
      const cols = Math.max(1, Math.ceil(Math.sqrt(boards.length)));
      boards.forEach((b, i) => {
        b._x = (i % cols) * BOARD_SPREAD + width / 2 - ((cols - 1) * BOARD_SPREAD) / 2;
        b._y = Math.floor(i / cols) * BOARD_SPREAD + height / 2 - (Math.floor((boards.length - 1) / cols) * BOARD_SPREAD) / 2;
      });
      drawMinimapNodes(boards.map(b => ({ x: b._x, y: b._y, color: b.color })));
    } else {
      const pins = Store.getPins(activeBoardId);
      if (pins.length === 0) return;
      drawMinimapNodes(pins.map(p => ({ x: p.x, y: p.y, color: "#EEEBE7" })));
    }
  }

  function drawMinimapNodes(nodes) {
    if (nodes.length === 0) return;
    const pad = 80;
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const minX = d3.min(xs) - pad, maxX = d3.max(xs) + pad;
    const minY = d3.min(ys) - pad, maxY = d3.max(ys) + pad;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const s = Math.min(mmW / rangeX, mmH / rangeY);
    const offX = (mmW - rangeX * s) / 2;
    const offY = (mmH - rangeY * s) / 2;

    nodes.forEach(n => {
      const nx = (n.x - minX) * s + offX;
      const ny = (n.y - minY) * s + offY;
      mCtx.beginPath();
      mCtx.arc(nx, ny, 2.5, 0, Math.PI * 2);
      mCtx.fillStyle = n.color;
      mCtx.fill();
    });

    // Viewport rect
    const t = currentTransform;
    const vx = (-t.x / t.k - minX) * s + offX;
    const vy = (-t.y / t.k - minY) * s + offY;
    const vw = (width / t.k) * s;
    const vh = (height / t.k) * s;
    mCtx.strokeStyle = "rgba(238,235,231,0.3)";
    mCtx.lineWidth = 1;
    mCtx.strokeRect(vx, vy, vw, vh);
  }

  // ══════════════════════════════════════════════
  //  MODALS
  // ══════════════════════════════════════════════

  function openModal(id) {
    document.getElementById(id).hidden = false;
  }

  function closeModal(id) {
    document.getElementById(id).hidden = true;
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

  // ── Create Board form ──────────────────────────
  document.getElementById("form-board").addEventListener("submit", e => {
    e.preventDefault();
    const name  = document.getElementById("board-name").value.trim();
    const desc  = document.getElementById("board-desc").value.trim();
    const color = document.querySelector("#board-colors .swatch.selected")?.dataset.color || "#EEEBE7";

    if (!name) return;

    Store.addBoard({ name, description: desc, color });
    closeModal("modal-board");
    e.target.reset();
    // Re-select first swatch
    document.querySelectorAll("#board-colors .swatch").forEach((s, i) =>
      s.classList.toggle("selected", i === 0));

    currentView = "home";
    activeBoardId = null;
    render();
  });

  // ── Add Pin form ───────────────────────────────
  // Source toggle
  document.querySelectorAll(".pin-source-toggle .toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pin-source-toggle .toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("pin-url-panel").hidden  = btn.dataset.source !== "url";
      document.getElementById("pin-file-panel").hidden = btn.dataset.source !== "file";
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
    } else {
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
    }
  });

  function addPinAndRender(pinData) {
    // Place new pin near viewport center, snapped to grid
    const cx = (-currentTransform.x + width / 2) / currentTransform.k;
    const cy = (-currentTransform.y + height / 2) / currentTransform.k;
    // Slight random offset so pins don't stack exactly
    const ox = (Math.random() - 0.5) * 200;
    const oy = (Math.random() - 0.5) * 200;
    pinData.x = Math.round((cx + ox) / GRID) * GRID;
    pinData.y = Math.round((cy + oy) / GRID) * GRID;

    Store.addPin(pinData);
    renderBoard(activeBoardId);
  }

  // ── Tag Input ──────────────────────────────────
  let currentPinTags = [];

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
    document.getElementById("pin-url-panel").hidden = false;
    document.getElementById("pin-file-panel").hidden = true;
    
    // Reset to Add Pin mode
    document.getElementById("modal-pin-title").textContent = "Add Pin";
    document.getElementById("pin-id").value = "";
    document.querySelector("#form-pin button[type='submit']").textContent = "Add Pin";
    currentPinTags = [];
    renderTagList();
    document.getElementById("pin-tags-input").value = "";
  }

  function openEditPinModal(pin) {
    resetPinToggle(); // Start from clean state
    
    document.getElementById("modal-pin-title").textContent = "Edit Pin";
    document.getElementById("pin-id").value = pin.id;
    currentPinTags = Array.isArray(pin.tags) ? pin.tags.slice() : [];
    renderTagList();
    document.querySelector("#form-pin button[type='submit']").textContent = "Update";

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

  // ── Button bindings ────────────────────────────
  document.getElementById("btn-new-board").addEventListener("click", () => openModal("modal-board"));
  document.getElementById("fab-add-board").addEventListener("click", () => openModal("modal-board"));

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
  document.getElementById("btn-connect-arena").addEventListener("click", () => {
    refreshArenaModal();
    openModal("modal-arena");
  });
  document.getElementById("fab-arena").addEventListener("click", () => {
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
    svg.attr("viewBox", [0, 0, window.innerWidth, window.innerHeight]);
  });

  // ── Init ───────────────────────────────────────
  // Handle Are.na callback on page load
  if (typeof Arena !== "undefined") {
    Arena.handleCallback().then(imported => {
      if (imported) render();
    });
  }

  render();

})();
