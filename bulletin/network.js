/* ── bulletin · network.js ─ Pin/tag relationship graph ── */

let _render = null;
let _openAddPinModal = null;
let _openEditPinModal = null;
let _updateBreadcrumb = null;
let simulation = null;
let initialized = false;
let activeFocusId = null;
let hoveredNetworkNodeCount = 0;

const TAG_RADIUS = 24;
const PIN_RADIUS = 36;
const TAG_HOVER_RADIUS = 62;
const PIN_HOVER_SCALE = TAG_HOVER_RADIUS / PIN_RADIUS;
const NETWORK_COLLISION_PAD = 14;
const NETWORK_TAG_COLLISION_PAD = 8;
const NETWORK_HOVER_ALPHA = 0.075;
const UNTAGGED_TAG_ID = "tag:__untagged__";

export function init({ render, openAddPinModal, openEditPinModal, updateBreadcrumb }) {
  _render = render;
  _openAddPinModal = openAddPinModal;
  _openEditPinModal = openEditPinModal;
  _updateBreadcrumb = updateBreadcrumb;
}

export function destroyNetwork() {
  if (simulation) {
    simulation.stop();
    simulation = null;
  }
  activeFocusId = null;
  hoveredNetworkNodeCount = 0;
}

export function renderNetwork() {
  if (_updateBreadcrumb) _updateBreadcrumb();
  bindNetworkEvents();

  const svgEl = document.getElementById("network-svg");
  const wrap = document.getElementById("network-canvas-wrap");
  const empty = document.getElementById("network-empty");
  const emptyText = document.getElementById("network-empty-text");
  hoveredNetworkNodeCount = 0;
  if (!svgEl || !wrap) return;

  destroyNetwork();

  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  const width = Math.max(320, wrap.clientWidth || viewportWidth);
  const height = Math.max(320, wrap.clientHeight || viewportHeight - 140);
  const graph = buildNetworkGraph(getCurrentNetworkPins(), width, height);

  const svg = d3.select(svgEl)
    .attr("viewBox", [0, 0, width, height])
    .attr("width", width)
    .attr("height", height);

  svg.selectAll("*").remove();

  if (empty && emptyText) {
    empty.hidden = graph.pinCount > 0;
    if (graph.pinCount === 0) {
      emptyText.innerHTML = `<strong>No pins yet</strong><span>Add a pin to start building your tag network.</span>`;
    }
  }

  if (graph.pinCount === 0) {
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (empty && emptyText && graph.tagCount === 0) {
    empty.hidden = false;
    emptyText.innerHTML = `<strong>No tags yet</strong><span>These pins are waiting for tags before the network can connect them.</span>`;
  }

  const defs = svg.append("defs");
  defs.append("pattern")
    .attr("id", "network-grid-pattern")
    .attr("width", 28)
    .attr("height", 28)
    .attr("patternUnits", "userSpaceOnUse")
    .append("circle")
    .attr("cx", 1)
    .attr("cy", 1)
    .attr("r", 1)
    .attr("fill", "rgba(238, 235, 231, 0.08)");

  graph.nodes.filter(d => d.type === "pin" && getPinSrc(d.pin)).forEach(d => {
    defs.append("clipPath")
      .attr("id", `network-pin-clip-${cssId(d.id)}`)
      .append("circle")
      .attr("r", PIN_RADIUS)
      .attr("cx", 0)
      .attr("cy", 0);
  });

  const zoomLayer = svg.append("g").attr("class", "network-zoom-layer");
  zoomLayer.append("rect")
    .attr("class", "network-grid")
    .attr("x", -width * 4)
    .attr("y", -height * 4)
    .attr("width", width * 9)
    .attr("height", height * 9)
    .attr("fill", "url(#network-grid-pattern)");
  const linkLayer = zoomLayer.append("g").attr("class", "network-link-layer");
  const nodeLayer = zoomLayer.append("g").attr("class", "network-node-layer");

  svg.call(d3.zoom()
    .scaleExtent([0.35, 3])
    .on("zoom", (event) => {
      zoomLayer.attr("transform", event.transform);
    })
  ).on("dblclick.zoom", null);

  const links = linkLayer.selectAll("line")
    .data(graph.links)
    .join("line")
    .attr("class", d => `network-link network-link-${d.kind}`)
    .attr("stroke-width", 1.5);

  const nodes = nodeLayer.selectAll("g")
    .data(graph.nodes, d => d.id)
    .join("g")
    .attr("class", d => `network-node network-node-${d.type}`)
    .on("pointerenter", function(_, d) {
      setFocus(d.id, graph.adjacency, nodes, links);
      animateNetworkNodeHover(d3.select(this), d, true);
    })
    .on("pointerleave", function(_, d) {
      animateNetworkNodeHover(d3.select(this), d, false);
      clearFocus(nodes, links);
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.type === "pin" && _openEditPinModal) {
        _openEditPinModal(d.pin);
      } else if (d.type === "tag") {
        activeFocusId = activeFocusId === d.id ? null : d.id;
        if (activeFocusId) setFocus(activeFocusId, graph.adjacency, nodes, links);
        else clearFocus(nodes, links);
      }
    })
    .call(d3.drag()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.18).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        const previousX = d.fx ?? d.x;
        const previousY = d.fy ?? d.y;
        const next = constrainDraggedNode(d, event.x, event.y, graph.nodes, graph.adjacency);
        d.fx = next.x;
        d.fy = next.y;
        if (d.type === "tag") {
          moveConnectedPinsWithTag(d, next.x - previousX, next.y - previousY, graph.adjacency, graph.nodes);
        }
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      })
    );

  nodes.each(function(d) {
    const node = d3.select(this);
    if (d.type === "tag") renderTagNode(node, d);
    else renderPinNode(node, d);
  });

  simulation = d3.forceSimulation(graph.nodes)
    .velocityDecay(0.5)
    .alphaDecay(0.045)
    .force("link", d3.forceLink(graph.links).id(d => d.id).distance(d => d.kind === "untagged" ? 20 : 40).strength(0.5))
    .force("charge", d3.forceManyBody().strength(d => d.type === "tag" ? -400 : -20))
    .force("collide", d3.forceCollide().radius(networkCollisionRadius).strength(0.72).iterations(3))
    .force("pinOrbit", forcePinsAroundTags(graph.links).strength(0.12))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("x", d3.forceX(d => d.type === "tag" ? d.anchorX : width / 2).strength(d => d.type === "tag" ? 0.15 : 0.08))
    .force("y", d3.forceY(d => d.type === "tag" ? d.anchorY : height / 2).strength(d => d.type === "tag" ? 0.15 : 0.08))
    .on("tick", () => {
      links
        .attr("x1", d => linkEndpoint(d.source, d.target).x)
        .attr("y1", d => linkEndpoint(d.source, d.target).y)
        .attr("x2", d => linkEndpoint(d.target, d.source).x)
        .attr("y2", d => linkEndpoint(d.target, d.source).y);

      nodeLayer.raise();
      nodes.attr("transform", d => `translate(${d.x},${d.y})`);
    });

  if (graph.nodes.length < 24) {
    simulation.alpha(0.75);
  }

  if (window.lucide) lucide.createIcons();
}

function bindNetworkEvents() {
  if (initialized) return;
  initialized = true;

  const addBtn = document.getElementById("btn-network-add-pin");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (_openAddPinModal) _openAddPinModal({ context: "network" });
    });
  }
}

function getCurrentNetworkPins() {
  return Store.getAllPins().filter(pin => {
    const boardIds = Array.isArray(pin.boardIds) ? pin.boardIds : [];
    return boardIds.length > 0 || pin.source === "network";
  });
}

function buildNetworkGraph(allPins, width, height) {
  const pins = dedupePins(allPins)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const nodes = [];
  const links = [];
  const tagMap = new Map();

  for (const pin of pins) {
    const pinNode = {
      id: `pin:${pin.id}`,
      type: "pin",
      pin,
      x: seedPosition(pin.id, 0),
      y: seedPosition(pin.id, 1),
    };
    nodes.push(pinNode);

    const tags = getEffectivePinTags(pin);
    if (tags.length === 0) continue;

    for (const tag of tags) {
      if (!tagMap.has(tag.key)) {
        tagMap.set(tag.key, {
          id: `tag:${tag.key}`,
          type: "tag",
          key: tag.key,
          label: tag.label,
          count: 0,
          x: seedPosition(tag.key, 0),
          y: seedPosition(tag.key, 1),
        });
      }
      const tagNode = tagMap.get(tag.key);
      tagNode.count += 1;
      if (!tagNode.pinIds) tagNode.pinIds = [];
      tagNode.pinIds.push(pinNode.id);
      links.push({
        id: `${pinNode.id}->${tagNode.id}`,
        source: pinNode.id,
        target: tagNode.id,
        kind: "tag",
        weight: tagNode.count,
      });
    }
  }

  const tagNodes = Array.from(tagMap.values());
  const tagOrbit = Math.max(150, Math.min(width, height) * 0.24);
  tagNodes.forEach((tag, index) => {
    const angle = (-Math.PI / 2) + (index / Math.max(1, tagNodes.length)) * Math.PI * 2;
    tag.anchorX = width / 2 + Math.cos(angle) * tagOrbit;
    tag.anchorY = height / 2 + Math.sin(angle) * tagOrbit;
    tag.x = tag.anchorX;
    tag.y = tag.anchorY;
  });
  nodes.push(...tagNodes);

  const untaggedPins = pins.filter(pin => getEffectivePinTags(pin).length === 0);
  if (untaggedPins.length > 0 && tagNodes.length > 0) {
    const untaggedNode = {
      id: UNTAGGED_TAG_ID,
      type: "tag",
      key: "__untagged__",
      label: "untagged",
      count: untaggedPins.length,
      muted: true,
    };
    nodes.push(untaggedNode);
    untaggedPins.forEach(pin => {
      links.push({
        id: `pin:${pin.id}->${UNTAGGED_TAG_ID}`,
        source: `pin:${pin.id}`,
        target: UNTAGGED_TAG_ID,
        kind: "untagged",
        weight: 1,
      });
    });
  }

  return {
    nodes,
    links,
    adjacency: buildAdjacency(links),
    pinCount: pins.length,
    tagCount: tagNodes.length,
  };
}

function dedupePins(pins) {
  const seen = new Map();
  for (const pin of pins) {
    const key = pin.sharedPinId || pin.id;
    const existing = seen.get(key);
    if (!existing || (pin.createdAt || 0) > (existing.createdAt || 0)) {
      seen.set(key, pin);
    }
  }
  return Array.from(seen.values());
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Map();
  for (const raw of tags) {
    const label = String(raw || "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, { key, label });
  }
  return Array.from(seen.values());
}

function getEffectivePinTags(pin) {
  return normalizeTags(Array.isArray(pin.tags) ? pin.tags : []);
}

function buildAdjacency(links) {
  const adjacency = new Map();
  const add = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  links.forEach(link => {
    const source = typeof link.source === "string" ? link.source : link.source.id;
    const target = typeof link.target === "string" ? link.target : link.target.id;
    add(source, target);
    add(target, source);
  });
  return adjacency;
}

function setFocus(id, adjacency, nodes, links) {
  const connected = adjacency.get(id) || new Set();
  nodes.classed("is-focused", d => d.id === id || connected.has(d.id));
  links.classed("is-focused", d => {
    const source = typeof d.source === "string" ? d.source : d.source.id;
    const target = typeof d.target === "string" ? d.target : d.target.id;
    return source === id || target === id;
  });
}

function clearFocus(nodes, links) {
  if (activeFocusId) return;
  nodes.classed("is-dimmed", false).classed("is-focused", false);
  links.classed("is-dimmed", false).classed("is-focused", false);
}

function networkCollisionRadius(d) {
  if (Number.isFinite(d.collisionRadius)) return d.collisionRadius;
  if (d.type === "tag") return TAG_RADIUS + NETWORK_TAG_COLLISION_PAD;
  return PIN_RADIUS + NETWORK_COLLISION_PAD;
}

function networkHoverCollisionRadius(d, hovered) {
  if (d.type === "tag") return (hovered ? TAG_HOVER_RADIUS : TAG_RADIUS) + NETWORK_TAG_COLLISION_PAD;
  return (hovered ? TAG_HOVER_RADIUS : PIN_RADIUS) + NETWORK_COLLISION_PAD;
}

function warmNetworkSimulation(alphaTarget = NETWORK_HOVER_ALPHA) {
  if (!simulation) return;
  simulation.force("collide")?.radius(networkCollisionRadius);
  simulation.alphaTarget(alphaTarget);
  if (simulation.alpha() < alphaTarget) simulation.alpha(alphaTarget);
  simulation.restart();
}

function coolNetworkSimulationSoon() {
  if (!simulation) return;
  window.setTimeout(() => {
    if (simulation && hoveredNetworkNodeCount === 0) simulation.alphaTarget(0);
  }, 180);
}

function linkRadius(d) {
  return d.type === "tag" ? TAG_RADIUS + 5 : PIN_RADIUS + 6;
}

function linkEndpoint(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const offset = linkRadius(from);
  return {
    x: from.x + (dx / dist) * offset,
    y: from.y + (dy / dist) * offset,
  };
}

function constrainDraggedNode(draggedNode, proposedX, proposedY, nodes, adjacency) {
  if (draggedNode.type !== "tag") return { x: proposedX, y: proposedY };

  let x = proposedX;
  let y = proposedY;
  const connectedIds = adjacency.get(draggedNode.id) || new Set();
  const draggedRadius = networkCollisionRadius(draggedNode);

  for (let pass = 0; pass < 4; pass++) {
    for (const other of nodes) {
      if (other.id === draggedNode.id || connectedIds.has(other.id)) continue;
      const otherRadius = networkCollisionRadius(other);
      const minDistance = draggedRadius + otherRadius + 10;
      let dx = x - other.x;
      let dy = y - other.y;
      let distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= minDistance) continue;

      if (!distance) {
        const angle = (hashString(`${draggedNode.id}:${other.id}`) % 360) * Math.PI / 180;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }

      const push = (minDistance - distance) / distance;
      x += dx * push * 0.62;
      y += dy * push * 0.62;
    }
  }

  return { x, y };
}

function moveConnectedPinsWithTag(tagNode, dx, dy, adjacency, nodes) {
  if (!dx && !dy) return;
  const connectedIds = adjacency.get(tagNode.id) || new Set();
  for (const node of nodes) {
    if (node.type !== "pin" || !connectedIds.has(node.id) || node.fx != null || node.fy != null) continue;
    node.x += dx * 0.65;
    node.y += dy * 0.65;
    node.vx = (node.vx || 0) + dx * 0.04;
    node.vy = (node.vy || 0) + dy * 0.04;
  }
}

function forcePinsAroundTags(links) {
  let strength = 0.035;

  function force(alpha) {
    for (const link of links) {
      if (link.kind !== "tag") continue;
      const source = link.source;
      const target = link.target;
      const pin = source.type === "pin" ? source : target.type === "pin" ? target : null;
      const tag = source.type === "tag" ? source : target.type === "tag" ? target : null;
      if (!pin || !tag) continue;

      const siblings = Array.isArray(tag.pinIds) && tag.pinIds.length ? tag.pinIds : [pin.id];
      const index = Math.max(0, siblings.indexOf(pin.id));
      const angle = (-Math.PI / 2) + (index / Math.max(1, siblings.length)) * Math.PI * 2;
      const radius = Math.max(82, Math.min(142, 78 + siblings.length * 5));
      const targetX = tag.x + Math.cos(angle) * radius;
      const targetY = tag.y + Math.sin(angle) * radius;

      pin.vx += (targetX - pin.x) * strength * alpha;
      pin.vy += (targetY - pin.y) * strength * alpha;
    }
  }

  force.strength = function(nextStrength) {
    if (!arguments.length) return strength;
    strength = +nextStrength;
    return force;
  };

  return force;
}

function renderTagNode(node, d) {
  node.classed("is-muted", !!d.muted);
  const body = node.append("g")
    .attr("class", "network-tag-body");

  body.append("circle")
    .attr("class", "network-tag-bubble")
    .attr("r", TAG_RADIUS);

  const label = body.append("text")
    .attr("class", "network-tag-label")
    .attr("y", -8);

  wrapTagLabel(d.label).forEach((line, index, lines) => {
    label.append("tspan")
      .attr("x", 0)
      .attr("dy", index === 0 ? `${-(lines.length - 1) * 5}px` : "11px")
      .text(line);
  });

  body.append("text")
    .attr("class", "network-tag-count")
    .attr("y", 22)
    .text(d.count);
}

function wrapTagLabel(text, maxChars = 12) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  words.forEach(word => {
    if (!currentLine) {
      currentLine = word;
      return;
    }
    if (`${currentLine} ${word}`.length <= maxChars) {
      currentLine += ` ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  });

  if (currentLine) lines.push(currentLine);
  return lines.slice(0, 4);
}

function renderPinNode(node, d) {
  const src = getPinSrc(d.pin);
  const body = node.append("g")
    .attr("class", "network-pin-body");

  body.append("circle")
    .attr("class", "network-pin-ring")
    .attr("r", PIN_RADIUS + 4);

  if (src) {
    body.append("image")
      .attr("class", "network-pin-image")
      .attr("href", src)
      .attr("x", -PIN_RADIUS)
      .attr("y", -PIN_RADIUS)
      .attr("width", PIN_RADIUS * 2)
      .attr("height", PIN_RADIUS * 2)
      .attr("preserveAspectRatio", "xMidYMid slice")
      .attr("clip-path", `url(#network-pin-clip-${cssId(d.id)})`);
  } else {
    body.append("circle")
      .attr("class", "network-pin-fallback")
      .attr("r", PIN_RADIUS);
  }
}

function animateNetworkNodeHover(node, d, hovered) {
  node.raise();
  if (hovered && !d.hovered) hoveredNetworkNodeCount++;
  if (!hovered && d.hovered) hoveredNetworkNodeCount = Math.max(0, hoveredNetworkNodeCount - 1);
  d.hovered = hovered;
  node.classed("is-hovered", hovered);

  const collisionStart = networkCollisionRadius(d);
  const collisionEnd = networkHoverCollisionRadius(d, hovered);
  const hoverDuration = hovered ? 360 : 280;

  node.transition("network-collision-hover")
    .duration(hoverDuration)
    .ease(d3.easeCubicOut)
    .tween("collisionRadius", () => {
      const interpolateRadius = d3.interpolateNumber(collisionStart, collisionEnd);
      return (t) => {
        d.collisionRadius = interpolateRadius(t);
        warmNetworkSimulation(hovered ? NETWORK_HOVER_ALPHA : 0.035);
      };
    })
    .on("end", () => {
      d.collisionRadius = collisionEnd;
      warmNetworkSimulation(hovered ? NETWORK_HOVER_ALPHA : 0.02);
      if (!hovered) coolNetworkSimulationSoon();
    });

  if (d.type === "tag") {
    node.select(".network-tag-bubble")
      .transition("tag-hover")
      .duration(hoverDuration)
      .ease(hovered ? d3.easeCubicOut : d3.easeCubicInOut)
      .attr("r", hovered ? TAG_HOVER_RADIUS : TAG_RADIUS)
      .attr("stroke-width", hovered ? 2 : 1.2);
    return;
  }

  node.select(".network-pin-body")
    .transition("pin-hover")
    .duration(hoverDuration)
    .ease(hovered ? d3.easeCubicOut : d3.easeCubicInOut)
    .attr("transform", hovered ? `scale(${PIN_HOVER_SCALE})` : "scale(1)");
  node.select(".network-pin-ring")
    .transition("pin-hover")
    .duration(hoverDuration)
    .ease(hovered ? d3.easeCubicOut : d3.easeCubicInOut)
    .attr("stroke-width", hovered ? 1.6 : 1);
}

function getPinSrc(pin) {
  return pin.imageData || pin.imageUrl || "";
}

function seedPosition(value, axis) {
  const hash = hashString(`${value}:${axis}`);
  const span = axis === 0 ? window.innerWidth : window.innerHeight;
  return Math.max(120, (hash % Math.max(360, span || 720)) + 40);
}

function hashString(value) {
  let hash = 0;
  const str = String(value || "");
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function cssId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}
