export type GalleryPoint = { x: number; y: number }
export type GalleryObstacle = {
  type: "rect" | "oval"
  center: GalleryPoint
  width: number
  height: number
  layers: string[]
  ccwRotationDegrees?: number
}
export type GalleryMetrics = {
  physicallyConnected: number
  routeRequiredConnections: number
  fullyConnected: boolean
  drcPass: boolean
  traceCount: number
  traceLengthMm: number
  viaCount: number
  elapsedMs: number
  solverStatus: string
  newShortPairs: number
  newClearancePairs: number
  belowMinWidthItems: number
  outsideCopperItems: number
  malformedRouteItems: number
  expandedStates: number | null
  processWallMs: number | null
  viaTransitionsPruned: number | null
}
export type GalleryResult = {
  segments: Record<string, Array<[number, number, number, number, number]>>
  vias: Array<[number, number, number, number, string[]]>
  metrics: GalleryMetrics
}
export type GalleryBoard = {
  sample: string
  name: string
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  layers: string[]
  outline: GalleryPoint[]
  obstacles: GalleryObstacle[]
  results: Record<string, GalleryResult>
}
export type GalleryData = {
  variants: Array<{ id: string; label: string }>
  boards: GalleryBoard[]
}

export const layerColors: Record<string, string> = {
  top: "#fb7185",
  bottom: "#60a5fa",
  inner1: "#34d399",
  inner2: "#facc15",
  inner3: "#fb923c",
  inner4: "#c084fc",
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    }
    return escaped[character]
  })
}

export function renderBoardSvg(
  board: GalleryBoard,
  result: GalleryResult,
  layer: string,
): string {
  if (layer !== "all" && !board.layers.includes(layer))
    throw new Error(`Unknown board layer ${layer}`)
  const margin = 1
  const { minX, maxX, minY, maxY } = board.bounds
  const view = `${minX - margin} ${-maxY - margin} ${maxX - minX + 2 * margin} ${maxY - minY + 2 * margin}`
  const active = layer === "all" ? board.layers : [layer]
  const shapes: string[] = []
  for (const obstacle of board.obstacles) {
    if (!obstacle.layers.some((name) => active.includes(name))) continue
    const { width: w, height: h } = obstacle
    const transform = `translate(${obstacle.center.x} ${obstacle.center.y}) rotate(${obstacle.ccwRotationDegrees ?? 0})`
    let shape: string
    if (obstacle.type === "rect") {
      shape = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="#64748b"/>`
    } else if (w === h) {
      shape = `<circle r="${w / 2}" fill="#64748b"/>`
    } else {
      const d = Math.abs(w - h) / 2
      const points = w > h ? `${-d} 0 L ${d} 0` : `0 ${-d} L 0 ${d}`
      shape = `<path d="M ${points}" fill="none" stroke="#64748b" stroke-width="${Math.min(w, h)}" stroke-linecap="round"/>`
    }
    shapes.push(
      `<g transform="${transform}" opacity="${layer === "all" ? 0.65 : 0.85}">${shape}</g>`,
    )
  }
  for (const name of active) {
    const byWidth = new Map<number, string[]>()
    for (const [width, x1, y1, x2, y2] of result.segments[name]) {
      const segments = byWidth.get(width) ?? []
      segments.push(`M ${x1} ${y1} L ${x2} ${y2}`)
      byWidth.set(width, segments)
    }
    for (const [width, segments] of byWidth) {
      shapes.push(
        `<path data-copper-layer="${escapeXml(name)}" d="${segments.join(" ")}" fill="none" stroke="${layerColors[name]}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${layer === "all" ? 0.8 : 1}"/>`,
      )
    }
  }
  for (const [x, y, diameter, hole, layers] of result.vias) {
    if (!layers.some((name) => active.includes(name))) continue
    shapes.push(
      `<g data-via="true" transform="translate(${x} ${y})"><circle r="${diameter / 2}" fill="#e879f9"/><circle r="${hole / 2}" fill="#081624"/></g>`,
    )
  }
  const outline = board.outline
    .map((point) => `${point.x},${point.y}`)
    .join(" ")
  shapes.push(
    `<polygon points="${outline}" fill="none" stroke="#cbd5e1" stroke-width="0.07"/>`,
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="${view}" role="img" aria-label="${escapeXml(`${board.name}, ${layer} copper, ${result.metrics.viaCount} vias`)}"><rect x="${minX - margin}" y="${-maxY - margin}" width="${maxX - minX + 2 * margin}" height="${maxY - minY + 2 * margin}" fill="#081624"/><g transform="scale(1 -1)">${shapes.join("")}</g></svg>`
}
