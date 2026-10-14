import { layerColors, renderBoardSvg, type GalleryBoard, type GalleryData, type GalleryResult } from "./galleryRenderer"

declare global {
  interface Window { SRJ18_GALLERY_GZIP: string; srj18GalleryReady: boolean }
}
type CardState = { element: HTMLElement; board: GalleryBoard; result: GalleryResult; variant: string; layer: string; imageUrl?: string }
const states = new Map<HTMLElement, CardState>()
const dialog = document.querySelector<HTMLDialogElement>("#detail")!
const detailImage = document.querySelector<HTMLImageElement>("#detail-image")!
const detailLayer = document.querySelector<HTMLSelectElement>("#detail-layer")!
let selected: CardState | undefined
let zoom = 1
let detailImageUrl: string | undefined

function imageFor(state: CardState): string {
  const svg = renderBoardSvg(state.board, state.result, state.layer)
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  const imageUrl = URL.createObjectURL(blob)
  return imageUrl
}

function renderCard(state: CardState): void {
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl)
  state.imageUrl = imageFor(state)
  const image = state.element.querySelector<HTMLImageElement>(".board-image")!
  image.src = state.imageUrl
  image.alt = `${state.board.name}; ${state.variant}; ${state.layer}; ${state.result.metrics.viaCount} vias`
  state.element.dataset.renderedLayer = state.layer
  state.element.querySelector<HTMLAnchorElement>(".download-svg")!.href = state.imageUrl
  state.element.querySelector<HTMLAnchorElement>(".download-svg")!.download = `${state.board.sample}-${state.variant}-${state.layer}.svg`
}

function updateDetail(): void {
  if (!selected) throw new Error("No route selected for inspection")
  if (detailImageUrl) URL.revokeObjectURL(detailImageUrl)
  detailImageUrl = imageFor({ ...selected, layer: detailLayer.value })
  detailImage.src = detailImageUrl
  detailImage.style.width = `${zoom * 100}%`
  document.querySelector("#zoom-label")!.textContent = `${Math.round(zoom*100)}%`
}

function openDetail(state: CardState): void {
  selected = state
  zoom = 1
  detailLayer.replaceChildren(...["all", ...state.board.layers].map(layer => new Option(layer === "all" ? "All copper layers" : layer, layer)))
  detailLayer.value = state.layer
  document.querySelector("#detail-title")!.textContent = `${state.board.name} · ${state.element.querySelector("h3")!.textContent}`
  updateDetail()
  dialog.showModal()
}

async function initialize(): Promise<void> {
  const encoded = Uint8Array.from(atob(window.SRJ18_GALLERY_GZIP), character => character.charCodeAt(0))
  const stream = new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip"))
  const data = JSON.parse(await new Response(stream).text()) as GalleryData
  if (data.boards.length !== 16 || data.variants.length !== 9) throw new Error("Incomplete recorded comparison")
  for (const board of data.boards) {
    const section = document.getElementById(board.sample)!
    for (const variant of data.variants) {
      const card = section.querySelector<HTMLElement>(`[data-variant="${variant.id}"]`)!
      const state: CardState = { element: card, board, result: board.results[variant.id], variant: variant.id, layer: "all" }
      states.set(card, state)
      card.querySelector(".inspect")!.addEventListener("click", () => openDetail(state))
      card.querySelector(".board-image")!.addEventListener("click", () => openDetail(state))
    }
    section.querySelector<HTMLSelectElement>(".board-layer")!.addEventListener("change", event => {
      const layer = (event.target as HTMLSelectElement).value
      for (const state of states.values()) {
        if (state.board.sample !== board.sample) continue
        state.layer = layer
        if (state.imageUrl) renderCard(state)
      }
    })
    for (const direction of [-1, 1]) section.querySelector(`[data-scroll="${direction}"]`)!.addEventListener("click", () => {
      const strip = section.querySelector<HTMLElement>(".router-row")!
      strip.scrollBy({ left: direction * 510, behavior: "smooth" })
    })
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const state = states.get(entry.target as HTMLElement)!
      if (!state.imageUrl) renderCard(state)
    }
  }, { rootMargin: "350px" })
  for (const card of states.keys()) observer.observe(card)
  document.querySelector<HTMLSelectElement>("#jump-board")!.addEventListener("change", event => {
    document.getElementById((event.target as HTMLSelectElement).value)!.scrollIntoView({ behavior: "smooth", block: "start" })
  })
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-jump-variant]")) link.addEventListener("click", () => {
    const section = document.querySelector<HTMLElement>(link.hash)!
    const card = section.querySelector<HTMLElement>(`[data-variant="${link.dataset.jumpVariant}"]`)!
    section.querySelector<HTMLElement>(".router-row")!.scrollTo({ left: card.offsetLeft, behavior: "smooth" })
    card.classList.add("highlight")
    setTimeout(() => card.classList.remove("highlight"), 1500)
  })
  document.querySelector("#detail-close")!.addEventListener("click", () => dialog.close())
  detailLayer.addEventListener("change", () => { zoom = 1; updateDetail() })
  for (const [id, factor] of [["zoom-in", 1.5], ["zoom-out", 1/1.5]] as const) {
    document.getElementById(id)!.addEventListener("click", () => { zoom = Math.min(8, Math.max(1, zoom*factor)); updateDetail() })
  }
  document.querySelector("#zoom-reset")!.addEventListener("click", () => { zoom = 1; updateDetail() })
  document.querySelector("#load-status")!.textContent = "144 recorded router outputs · every copper layer available"
  window.srj18GalleryReady = true
}

initialize().catch((error: unknown) => {
  document.querySelector("#load-status")!.textContent = `Images could not load: ${error instanceof Error ? error.message : String(error)}`
  document.querySelector("#load-status")!.classList.add("error")
  throw error
})
