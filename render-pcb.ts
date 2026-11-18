import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { AnyCircuitElement, PcbTraceRoutePointWire } from "circuit-json"

type CopperPoint = Pick<PcbTraceRoutePointWire, "x" | "y">
const [rendererRoot, inputPath, outputPath] = process.argv.slice(2)
const { convertCircuitJsonToPcbSvg } = await import(
  resolve(rendererRoot, "dist/index.js")
)
const circuit: AnyCircuitElement[] = JSON.parse(readFileSync(inputPath, "utf8"))
const board = circuit.find((element) => element.type === "pcb_board")
if (!board) throw new Error("Native output has no PCB board")
const copperPoints = circuit.flatMap((element): CopperPoint[] => {
  if (element.type === "pcb_trace") {
    return element.route.flatMap((point): CopperPoint[] =>
      point.route_type === "through_pad" ? [point.start, point.end] : [point],
    )
  }
  if (element.type === "pcb_smtpad" && element.shape === "polygon") {
    return element.points
  }
  if (element.type === "pcb_smtpad" || element.type === "pcb_plated_hole" || element.type === "pcb_via") {
    return [{ x: element.x, y: element.y }]
  }
  return []
})
if (!copperPoints.length) throw new Error("Native output has no copper geometry")
const viewport = inputPath.includes("/full/")
  ? {
      minX: board.center.x - board.width / 2 - 1,
      maxX: board.center.x + board.width / 2 + 1,
      minY: board.center.y - board.height / 2 - 1,
      maxY: board.center.y + board.height / 2 + 1,
    }
  : {
      minX: Math.min(...copperPoints.map((point) => point.x)) - 1.5,
      maxX: Math.max(...copperPoints.map((point) => point.x)) + 1.5,
      minY: Math.min(...copperPoints.map((point) => point.y)) - 1.5,
      maxY: Math.max(...copperPoints.map((point) => point.y)) + 1.5,
    }
writeFileSync(outputPath, convertCircuitJsonToPcbSvg(circuit, {
  width: 1400,
  height: 950,
  backgroundColor: "white",
  shouldDrawRatsNest: false,
  shouldDrawErrors: false,
  showPcbGroups: false,
  showPcbNotes: false,
  viewport,
}))
