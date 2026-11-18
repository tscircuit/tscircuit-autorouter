import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { AnyCircuitElement } from "circuit-json"

const [rendererRoot, inputPath, outputPath] = process.argv.slice(2)
const { convertCircuitJsonToPcbSvg } = await import(resolve(rendererRoot, "dist/index.js"))
const circuit: AnyCircuitElement[] = JSON.parse(readFileSync(inputPath, "utf8"))
const board = circuit.find((element) => element.type === "pcb_board")
if (!board) throw new Error("Native output has no PCB board")
writeFileSync(outputPath, convertCircuitJsonToPcbSvg(circuit, {
  width: 1400,
  height: 950,
  backgroundColor: "white",
  shouldDrawRatsNest: false,
  shouldDrawErrors: false,
  showPcbGroups: false,
  showPcbNotes: false,
  viewport: {
    minX: board.center.x - board.width / 2 - 2,
    maxX: board.center.x + board.width / 2 + 2,
    minY: board.center.y - board.height / 2 - 2,
    maxY: board.center.y + board.height / 2 + 2,
  },
}))
