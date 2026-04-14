/* ── netwrk · app.js ──────────────────────────── */

(function () {
  "use strict";

  // ── Constants ──────────────────────────────────
  const GRID          = 24;     // dot-grid spacing (matches CSS)
  const PIN_W         = 144;    // pin card width (aligned to 24 * 6)
  const PIN_H         = 192;    // pin card height (aligned to 24 * 8)
  const PIN_GAP       = 8;      // min visual gap between pins when edge-snapping
  const SNAP_THRESH   = 12;     // proximity in world px for edge-snap to activate
  const TRANSITION_MS = 500;
  const BOARD_SPREAD  = 288;    // spacing between board nodes (24 * 12)
  const WHEEL_ZOOM_SENS = 0.01;
  const ZOOM_SETTLE_MS = 150;

  // ── State ──────────────────────────────────────
  let currentView   = "home";   // "home" | "board"
  let activeBoardId = null;
  let selectedPinId = null;     // id of currently-selected pin

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
  // Limit zoom-out to 30% (when culling starts)
  // Limit zoom-in to 500%
  const zoom = d3.zoom()
    .scaleExtent([0.3, 5.0])
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

  function applyGridTransform(transform) {
    const { x, y, k } = transform;
    const canvasNode = svg.node();
    canvasNode.style.backgroundPosition = `${x}px ${y}px`;
    canvasNode.style.backgroundSize = `${GRID * k}px ${GRID * k}px`;
  }

  function resetWheelState() {
    wheelState.panX = 0;
    wheelState.panY = 0;
    wheelState.zoomLog2 = 0;
    wheelState.hasZoom = false;
  }

  function finishZoomInteraction() {
    isZooming = false;
    document.body.classList.remove("is-zooming");
    applyGridTransform(currentTransform);
    requestMinimapUpdate();
  }

  function cancelZoomInteraction() {
    if (zoomSettleTimer) {
      clearTimeout(zoomSettleTimer);
      zoomSettleTimer = null;
    }
    isZooming = false;
    document.body.classList.remove("is-zooming");
  }

  function scheduleZoomSettle() {
    if (zoomSettleTimer) clearTimeout(zoomSettleTimer);
    zoomSettleTimer = setTimeout(() => {
      zoomSettleTimer = null;
      finishZoomInteraction();
    }, ZOOM_SETTLE_MS);
  }

  function startZoomInteraction() {
    if (!isZooming) {
      isZooming = true;
      document.body.classList.add("is-zooming");
    }
    scheduleZoomSettle();
  }

  function flushWheelFrame() {
    wheelState.raf = null;
    if (currentView !== "board") {
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
    if (currentView !== "board") return;
    event.preventDefault();

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

  function showQuickAdd(clientX, clientY) {
    if (currentView !== "board") return;

    // Convert screen coords to world coords, snap to grid
    const wx = (clientX - currentTransform.x) / currentTransform.k;
    const wy = (clientY - currentTransform.y) / currentTransform.k;
    const sx = Math.round(wx / GRID) * GRID;
    const sy = Math.round(wy / GRID) * GRID;

    // Save position before any reset
    pendingPinPos = { x: sx, y: sy };

    // Reset existing bubble and timer
    removeQuickAddDOM();
    if (quickAddTimeout) clearTimeout(quickAddTimeout);

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

    // Auto-hide after 3 seconds
    quickAddTimeout = setTimeout(() => {
      hideQuickAdd();
    }, 3000);
  }

  function removeQuickAddDOM() {
    if (quickAddG) {
      quickAddG.remove();
      quickAddG = null;
    }
    quickAddActive = false;
  }

  function hideQuickAdd() {
    removeQuickAddDOM();
    pendingPinPos = null;
    if (quickAddTimeout) {
      clearTimeout(quickAddTimeout);
      quickAddTimeout = null;
    }
  }

  // Listen for clicks on empty canvas area (board view only)
  svg.on("click.quickadd", (event) => {
    if (currentView !== "board") return;

    // Deselect pin when clicking outside any pin group
    const wasSelected = !!selectedPinId;
    if (!event.target.closest?.("g.pin-group")) deselectPin();

    // If we just deselected a pin, prevent the quick-add from appearing on this click
    if (wasSelected) return;

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
    if (!quickAddActive || !quickAddG || !pendingPinPos || !activeBoardId) return;
    if (quickAddG.node().contains(event.target)) {
      event.stopPropagation();
      event.preventDefault();
      const pos = { ...pendingPinPos };
      hideQuickAdd(); // fully cleanup bubble + timeout
      pendingPinPos = pos; // restore pos for modal
      openModal("modal-pin");
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

  // Track semantic zoom level for CSS class toggles
  let lastZoomTier = "normal"; // "normal" | "far" | "very-far"

  // ── Keyboard shortcuts ─────────────────────────
  document.addEventListener("keydown", (e) => {
    // Only handle if in board view and not currently typing in a form/input
    if (activeBoardId && selectedPinId) {
      const isInput = ["INPUT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable;
      if (isInput) return;

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        Store.deletePin(selectedPinId);
        deselectPin();
        renderBoard(activeBoardId);
      }
    }
  });

  function onZoom(event) {
    currentTransform = event.transform;
    const { k } = currentTransform;

    masterG.attr("transform", currentTransform);

    if (currentView === "board") startZoomInteraction();
    else applyGridTransform(currentTransform);

    // Semantic zoom via CSS classes (no per-element queries)
    const tier = k < 0.3 ? "very-far" : k < 0.6 ? "far" : "normal";
    if (tier !== lastZoomTier) {
      masterG.classed("zoom-far", tier === "far")
             .classed("zoom-very-far", tier === "very-far");
      lastZoomTier = tier;
    }

    zoomLabel.textContent = Math.round(k * 100) + "%";
  }

  // ── Render dispatcher ──────────────────────────
  function render() {
    const boards = Store.getBoards();
    const hasBoards = boards.length > 0;

    emptyState.hidden = hasBoards;
    fabGroup.hidden = !hasBoards;

    if (currentView === "home") {
      cancelZoomInteraction();
      renderHome(boards);
      svg.on(".zoom", null); // Disable zoom on home page
      document.getElementById("zoom-indicator").style.display = "none";
      minimapEl.style.display = "none";
    } else if (currentView === "board") {
      svg.call(zoom).on("dblclick.zoom", null); // Re-enable zoom in board view
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

  // ── Coordinate conversion (module-level) ───────
  function screenToWorld(clientX, clientY) {
    return [
      (clientX - currentTransform.x) / currentTransform.k,
      (clientY - currentTransform.y) / currentTransform.k,
    ];
  }

  function renderBoard(boardId) {
    selectedPinId = null;
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

    // ── Pre-load images to get natural dimensions ──
    function loadPinImages(pins) {
      return Promise.all(pins.map(d => new Promise(resolve => {
        if (d._pw && d._ph) { resolve(); return; }
        const img = new Image();
        img.onload = () => {
          const aspect = img.naturalHeight / img.naturalWidth;
          d._aspect = aspect;
          d._pw = d.pinW || PIN_W;
          d._ph = Math.round(d._pw * aspect);
          resolve();
        };
        img.onerror = () => {
          d._aspect = PIN_H / PIN_W;
          d._pw = d.pinW || PIN_W;
          d._ph = PIN_H;
          resolve();
        };
        img.src = d.imageData || d.imageUrl;
      })));
    }

    loadPinImages(pins).then(() => {
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

    // Drop shadow filter
    const shadowFilter = defs.append("filter")
      .attr("id", "pin-shadow")
      .attr("x", "-50%").attr("y", "-50%")
      .attr("width", "200%").attr("height", "200%");
    shadowFilter.append("feDropShadow")
      .attr("dx", 0).attr("dy", 2)
      .attr("stdDeviation", 4)
      .attr("flood-color", "rgba(0,0,0,0.4)");

    // Elevated shadow for dragging
    const dragShadowFilter = defs.append("filter")
      .attr("id", "pin-shadow-drag")
      .attr("x", "-50%").attr("y", "-50%")
      .attr("width", "200%").attr("height", "200%");
    dragShadowFilter.append("feDropShadow")
      .attr("dx", 0).attr("dy", 6)
      .attr("stdDeviation", 12)
      .attr("flood-color", "rgba(0,0,0,0.6)");

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
    pinGroups.append("image")
      .attr("class", "pin-img")
      .attr("href", d => d.imageData || d.imageUrl)
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

    // Apply shadow filter to each pin group
    pinGroups.attr("filter", "url(#pin-shadow)");

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

    pinGroups.each(function (d) {
      const gEl = this;
      const hitRect = gEl.querySelector(".pin-hit-area");
      let originX, originY, startWX, startWY, moved;

      hitRect.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        hitRect.setPointerCapture(e.pointerId);

        originX = d.x;
        originY = d.y;
        [startWX, startWY] = screenToWorld(e.clientX, e.clientY);
        moved = false;

        d3.select(gEl).raise();
        d3.select(gEl).attr("filter", "url(#pin-shadow-drag)").attr("opacity", 0.92);
        hitRect.style.cursor = "grabbing";

        // Freeze viewport so currentTransform stays constant
        svg.on(".zoom", null);
      });

      hitRect.addEventListener("pointermove", (e) => {
        if (originX == null) return;

        const [wx, wy] = screenToWorld(e.clientX, e.clientY);
        d.x = originX + (wx - startWX);
        d.y = originY + (wy - startWY);

        if (!moved && (Math.abs(d.x - originX) + Math.abs(d.y - originY) > 3)) {
          moved = true;
        }

        gEl.setAttribute("transform", `translate(${d.x},${d.y})`);
      });

      function endDrag(e) {
        if (originX == null) return;
        hitRect.releasePointerCapture(e.pointerId);

        d3.select(gEl).attr("filter", "url(#pin-shadow)").attr("opacity", 1);
        hitRect.style.cursor = "grab";

        // Re-enable viewport zoom
        svg.call(zoom).on("dblclick.zoom", null);

        if (moved) {
          snapPosition(d, pins);
          d3.select(gEl)
            .transition().duration(150)
            .attr("transform", `translate(${d.x},${d.y})`);
          Store.updatePin(d.id, { x: d.x, y: d.y });
          updateMinimap();
        } else {
          d.x = originX;
          d.y = originY;
          selectPin(d, gEl);
        }

        originX = originY = null;
      }

      hitRect.addEventListener("pointerup", endDrag);
      hitRect.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        openEditPinModal(d);
      });
      hitRect.addEventListener("pointercancel", () => {
        d3.select(gEl).attr("filter", "url(#pin-shadow)").attr("opacity", 1);
        hitRect.style.cursor = "grab";
        svg.call(zoom).on("dblclick.zoom", null);
        if (originX != null) {
          d.x = originX;
          d.y = originY;
          gEl.setAttribute("transform", `translate(${d.x},${d.y})`);
        }
        originX = originY = null;
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
    }); // end loadPinImages().then
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

      hNode.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        hNode.setPointerCapture(e.pointerId);
        resizing = true;
        svg.on(".zoom", null);

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
      });

      hNode.addEventListener("pointerup", (e) => {
        if (!resizing) return;
        resizing = false;
        hNode.releasePointerCapture(e.pointerId);
        svg.call(zoom).on("dblclick.zoom", null);
        d.pinW = d._pw;
        Store.updatePin(d.id, { x: d.x, y: d.y, pinW: d._pw });
        updateMinimap();
      });

      hNode.addEventListener("pointercancel", () => {
        resizing = false;
        svg.call(zoom).on("dblclick.zoom", null);
      });
    });
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
    document.getElementById("btn-pin-delete").hidden = true;
    currentPinTags = [];
    renderTagList();
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
    document.getElementById("btn-pin-delete").hidden = false;

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
      Store.deletePin(pinToDelete);
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
        Store.addPin({
          boardId: activeBoardId,
          tags: [],
          imageData: reader.result,
          source: "local",
          x: px,
          y: py,
        });
        if (i === files.length - 1) renderBoard(activeBoardId);
      };
      reader.readAsDataURL(file);
    });
  });

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
    Arena.handleCallback().then(authed => {
      if (authed) {
        refreshArenaModal();
        openModal("modal-arena");
        render();
      }
    });
  }

  render();

})();
