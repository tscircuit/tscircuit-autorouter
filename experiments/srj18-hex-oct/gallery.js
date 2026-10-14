(() => {
  // src/galleryRenderer.ts
  var layerColors = {
    top: "#fb7185",
    bottom: "#60a5fa",
    inner1: "#34d399",
    inner2: "#facc15",
    inner3: "#fb923c",
    inner4: "#c084fc"
  };
  function escapeXml(value) {
    return value.replace(/[&<>"']/g, (character) => {
      const escaped = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
      return escaped[character];
    });
  }
  function renderBoardSvg(board, result, layer) {
    if (layer !== "all" && !board.layers.includes(layer))
      throw new Error(`Unknown board layer ${layer}`);
    const margin = 1;
    const { minX, maxX, minY, maxY } = board.bounds;
    const view = `${minX - margin} ${-maxY - margin} ${maxX - minX + 2 * margin} ${maxY - minY + 2 * margin}`;
    const active = layer === "all" ? board.layers : [layer];
    const shapes = [];
    for (const obstacle of board.obstacles) {
      if (!obstacle.layers.some((name) => active.includes(name)))
        continue;
      const { width: w, height: h } = obstacle;
      const transform = `translate(${obstacle.center.x} ${obstacle.center.y}) rotate(${obstacle.ccwRotationDegrees ?? 0})`;
      let shape;
      if (obstacle.type === "rect") {
        shape = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="#64748b"/>`;
      } else if (w === h) {
        shape = `<circle r="${w / 2}" fill="#64748b"/>`;
      } else {
        const d = Math.abs(w - h) / 2;
        const points = w > h ? `${-d} 0 L ${d} 0` : `0 ${-d} L 0 ${d}`;
        shape = `<path d="M ${points}" fill="none" stroke="#64748b" stroke-width="${Math.min(w, h)}" stroke-linecap="round"/>`;
      }
      shapes.push(`<g transform="${transform}" opacity="${layer === "all" ? 0.65 : 0.85}">${shape}</g>`);
    }
    for (const name of active) {
      const byWidth = new Map;
      for (const [width, x1, y1, x2, y2] of result.segments[name]) {
        const segments = byWidth.get(width) ?? [];
        segments.push(`M ${x1} ${y1} L ${x2} ${y2}`);
        byWidth.set(width, segments);
      }
      for (const [width, segments] of byWidth) {
        shapes.push(`<path data-copper-layer="${escapeXml(name)}" d="${segments.join(" ")}" fill="none" stroke="${layerColors[name]}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${layer === "all" ? 0.8 : 1}"/>`);
      }
    }
    for (const [x, y, diameter, hole, layers] of result.vias) {
      if (!layers.some((name) => active.includes(name)))
        continue;
      shapes.push(`<g data-via="true" transform="translate(${x} ${y})"><circle r="${diameter / 2}" fill="#e879f9"/><circle r="${hole / 2}" fill="#081624"/></g>`);
    }
    const outline = board.outline.map((point) => `${point.x},${point.y}`).join(" ");
    shapes.push(`<polygon points="${outline}" fill="none" stroke="#cbd5e1" stroke-width="0.07"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="${view}" role="img" aria-label="${escapeXml(`${board.name}, ${layer} copper, ${result.metrics.viaCount} vias`)}"><rect x="${minX - margin}" y="${-maxY - margin}" width="${maxX - minX + 2 * margin}" height="${maxY - minY + 2 * margin}" fill="#081624"/><g transform="scale(1 -1)">${shapes.join("")}</g></svg>`;
  }

  // src/galleryApp.ts
  var states = new Map;
  var dialog = document.querySelector("#detail");
  var detailImage = document.querySelector("#detail-image");
  var detailLayer = document.querySelector("#detail-layer");
  var selected;
  var zoom = 1;
  var detailImageUrl;
  function imageFor(state) {
    const svg = renderBoardSvg(state.board, state.result, state.layer);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const imageUrl = URL.createObjectURL(blob);
    return imageUrl;
  }
  function renderCard(state) {
    if (state.imageUrl)
      URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = imageFor(state);
    const image = state.element.querySelector(".board-image");
    image.src = state.imageUrl;
    image.alt = `${state.board.name}; ${state.variant}; ${state.layer}; ${state.result.metrics.viaCount} vias`;
    state.element.dataset.renderedLayer = state.layer;
    state.element.querySelector(".download-svg").href = state.imageUrl;
    state.element.querySelector(".download-svg").download = `${state.board.sample}-${state.variant}-${state.layer}.svg`;
  }
  function updateDetail() {
    if (!selected)
      throw new Error("No route selected for inspection");
    if (detailImageUrl)
      URL.revokeObjectURL(detailImageUrl);
    detailImageUrl = imageFor({ ...selected, layer: detailLayer.value });
    detailImage.src = detailImageUrl;
    detailImage.style.width = `${zoom * 100}%`;
    document.querySelector("#zoom-label").textContent = `${Math.round(zoom * 100)}%`;
  }
  function openDetail(state) {
    selected = state;
    zoom = 1;
    detailLayer.replaceChildren(...["all", ...state.board.layers].map((layer) => new Option(layer === "all" ? "All copper layers" : layer, layer)));
    detailLayer.value = state.layer;
    document.querySelector("#detail-title").textContent = `${state.board.name} · ${state.element.querySelector("h3").textContent}`;
    updateDetail();
    dialog.showModal();
  }
  async function initialize() {
    const encoded = Uint8Array.from(atob(window.SRJ18_GALLERY_GZIP), (character) => character.charCodeAt(0));
    const stream = new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip"));
    const data = JSON.parse(await new Response(stream).text());
    if (data.boards.length !== 16 || data.variants.length !== 9)
      throw new Error("Incomplete recorded comparison");
    for (const board of data.boards) {
      const section = document.getElementById(board.sample);
      for (const variant of data.variants) {
        const card = section.querySelector(`[data-variant="${variant.id}"]`);
        const state = { element: card, board, result: board.results[variant.id], variant: variant.id, layer: "all" };
        states.set(card, state);
        card.querySelector(".inspect").addEventListener("click", () => openDetail(state));
        card.querySelector(".board-image").addEventListener("click", () => openDetail(state));
      }
      section.querySelector(".board-layer").addEventListener("change", (event) => {
        const layer = event.target.value;
        for (const state of states.values()) {
          if (state.board.sample !== board.sample)
            continue;
          state.layer = layer;
          if (state.imageUrl)
            renderCard(state);
        }
      });
      for (const direction of [-1, 1])
        section.querySelector(`[data-scroll="${direction}"]`).addEventListener("click", () => {
          const strip = section.querySelector(".router-row");
          strip.scrollBy({ left: direction * 510, behavior: "smooth" });
        });
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting)
          continue;
        const state = states.get(entry.target);
        if (!state.imageUrl)
          renderCard(state);
      }
    }, { rootMargin: "350px" });
    for (const card of states.keys())
      observer.observe(card);
    document.querySelector("#jump-board").addEventListener("change", (event) => {
      document.getElementById(event.target.value).scrollIntoView({ behavior: "smooth", block: "start" });
    });
    for (const link of document.querySelectorAll("[data-jump-variant]"))
      link.addEventListener("click", () => {
        const section = document.querySelector(link.hash);
        const card = section.querySelector(`[data-variant="${link.dataset.jumpVariant}"]`);
        section.querySelector(".router-row").scrollTo({ left: card.offsetLeft, behavior: "smooth" });
        card.classList.add("highlight");
        setTimeout(() => card.classList.remove("highlight"), 1500);
      });
    document.querySelector("#detail-close").addEventListener("click", () => dialog.close());
    detailLayer.addEventListener("change", () => {
      zoom = 1;
      updateDetail();
    });
    for (const [id, factor] of [["zoom-in", 1.5], ["zoom-out", 1 / 1.5]]) {
      document.getElementById(id).addEventListener("click", () => {
        zoom = Math.min(8, Math.max(1, zoom * factor));
        updateDetail();
      });
    }
    document.querySelector("#zoom-reset").addEventListener("click", () => {
      zoom = 1;
      updateDetail();
    });
    document.querySelector("#load-status").textContent = "144 recorded router outputs · every copper layer available";
    window.srj18GalleryReady = true;
  }
  initialize().catch((error) => {
    document.querySelector("#load-status").textContent = `Images could not load: ${error instanceof Error ? error.message : String(error)}`;
    document.querySelector("#load-status").classList.add("error");
    throw error;
  });
})();
