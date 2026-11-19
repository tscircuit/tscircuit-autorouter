import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"

const [harnessModules, fanoutModules] = process.argv.slice(2)
const { convertCircuitJsonToPcbSvg } = await import(resolve(harnessModules, "circuit-to-svg/dist/index.js"))
const { getSvgFromGraphicsObject } = await import(resolve(fanoutModules, "graphics-debug/dist/lib/index.js"))
const root = import.meta.dir
for (const phase of process.argv.slice(4)) {
  mkdirSync(`${root}/pcb/${phase}`, { recursive: true })
  for (const boardName of ["orangecrab", "h616", "butterstick", "glider", "imx6", "icepi"]) {
    const circuit = JSON.parse(gunzipSync(readFileSync(`${root}/${phase}/boards/${boardName}/circuit.json.gz`)).toString())
    const board = circuit.find((element) => element.type === "pcb_board")
    if (!board) throw new Error(`Missing native PCB for ${boardName}`)
    writeFileSync(`${root}/pcb/${phase}/${boardName}.svg`, convertCircuitJsonToPcbSvg(circuit, {
      width: 1400, height: 950, backgroundColor: "white",
      shouldDrawRatsNest: false, shouldDrawErrors: false, showPcbGroups: false, showPcbNotes: false,
      viewport: {
        minX: board.center.x - board.width / 2 - 2, maxX: board.center.x + board.width / 2 + 2,
        minY: board.center.y - board.height / 2 - 2, maxY: board.center.y + board.height / 2 + 2,
      },
    }))
  }
}
