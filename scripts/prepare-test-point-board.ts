/** Rebuild the pinned real-board fixture; no synthetic replacement geometry. */
import { writeFileSync, mkdirSync } from "node:fs"
const release = "57387f49-bd91-4277-8a82-706b1575c5ed"
const response = await fetch(`https://registry-api.tscircuit.com/package_files/get?package_release_id=${release}&file_path=dist%2Fboard%2Fcircuit.json`)
if (!response.ok) throw new Error(`Board download failed: ${response.status}`)
const { package_file } = await response.json()
const circuit = JSON.parse(package_file.content_text)
const board = circuit.find((e: any) => e.type === "pcb_board")
const layers = ["top", "inner1", "inner2", "bottom"]
const obstacles: any[] = []
for (const e of circuit) {
  let width: number, height: number, center: { x: number; y: number }, shape: "circle" | undefined
  let obstacleLayers = e.layers ?? [e.layer]
  if (e.type === "pcb_smtpad" || e.type === "pcb_plated_hole") {
    const points = e.points ?? e.polygon
    if (points) {
      const xs = points.map((p: any) => p.x), ys = points.map((p: any) => p.y)
      width = Math.max(...xs) - Math.min(...xs); height = Math.max(...ys) - Math.min(...ys)
      center = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 }
    } else {
      width = e.width ?? e.outer_width ?? (e.radius !== undefined ? e.radius * 2 : e.outer_diameter)
      height = e.height ?? e.outer_height ?? (e.radius !== undefined ? e.radius * 2 : e.outer_diameter)
      if (!Number.isFinite(width)) width = e.outer_diameter
      if (!Number.isFinite(height)) height = e.outer_diameter
      center = { x: e.x, y: e.y }
    }
  } else if (e.type === "pcb_via") {
    width = height = e.outer_diameter; center = { x: e.x, y: e.y }; shape = "circle"
  } else if (e.type === "pcb_hole") {
    width = e.hole_width ?? e.hole_diameter; height = e.hole_height ?? e.hole_diameter
    center = { x: e.x, y: e.y }; obstacleLayers = layers
  } else if (e.type === "pcb_keepout") {
    width = e.width ?? e.radius * 2; height = e.height ?? e.radius * 2; center = e.center
  } else if (e.type === "pcb_component" && !e.do_not_place) {
    // Probe access uses the actual component envelope as an additional keepout.
    width = e.width; height = e.height; center = e.center
  } else if (e.type === "pcb_copper_pour") {
    if (["top", "bottom"].includes(e.layer)) throw new Error("Outer copper pours require polygon obstacle conversion")
    continue // This board's pours are confined to inner layers, inaccessible to probes.
  } else continue
  if (![width, height, center.x, center.y].every(Number.isFinite)) throw new Error(`Unsupported geometry: ${JSON.stringify(e)}`)
  obstacles.push({ type: "rect", shape, obstacleId: e[`${e.type}_id`], layers: obstacleLayers,
    center, width, height, ccwRotationDegrees: e.ccw_rotation ?? e.rotation ?? 0, connectedTo: [] })
}
const traces = circuit.filter((e: any) => e.type === "pcb_trace").map((t: any) => ({
  type: "pcb_trace", pcb_trace_id: t.pcb_trace_id, connection_name: t.source_trace_id, route: t.route,
}))
const srj = { layerCount: 4, minTraceWidth: board.min_trace_width, minBoardEdgeClearance: board.min_board_edge_clearance,
  bounds: { minX: board.center.x - board.width / 2, maxX: board.center.x + board.width / 2,
    minY: board.center.y - board.height / 2, maxY: board.center.y + board.height / 2 }, obstacles, traces, connections: [] }
mkdirSync("tests/test-points/fixtures", { recursive: true })
writeFileSync("tests/test-points/fixtures/astra-pd-power-supply.srj.json", JSON.stringify(srj))
console.log({ traces: traces.length, obstacles: obstacles.length })
