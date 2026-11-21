import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const [sample, variant, directory] = process.argv.slice(2)
const filename = resolve(directory, `${sample}.json`)
if (!existsSync(filename)) throw Error("No completed routing was exported")
const route = JSON.parse(readFileSync(filename, "utf8"))
if (!route.solved || route.failed || route.error || !route.validation.valid ||
    !route.validation.complete || !route.validation.matched)
  throw Error("Only completed, connected, DRC-valid and matched routes may be rendered")
const require = createRequire(resolve("base/package.json"))
const { convertCircuitJsonToPcbSvg } = require("circuit-to-svg")
const { Resvg } = require("@resvg/resvg-js")
const { nativePairCircuit } = await import(pathToFileURL(resolve("base/tests/fixtures/native-pair-circuit.ts")).href)
const circuit = nativePairCircuit({ input: route.input, traces: route.traces })
const bounds = route.input.bounds
circuit.push({
  type: "pcb_note_text", pcb_note_text_id: "validated_routing", pcb_group_id: "validated_routing",
  text: `${sample}: ${route.input.connections.length}/${route.input.connections.length} connected; DRC and matching passed`,
  anchor_position: { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + 2 },
  anchor_alignment: "center", font: "tscircuit2024", font_size: 0.65, layer: "top",
})
const svg = convertCircuitJsonToPcbSvg(circuit, {
  backgroundColor: "white", showSolderMask: false, shouldDrawRatsNest: false,
  width: 1200, height: 1000,
  viewport: { minX: bounds.minX - 1, maxX: bounds.maxX + 1, minY: bounds.minY - 1, maxY: bounds.maxY + 4 },
})
writeFileSync(resolve(directory, `${sample}.pcb.svg`), svg)
writeFileSync(resolve(directory, `${sample}.pcb.png`), new Resvg(svg).render().asPng())
console.log(`Exported validated ${variant} snapshot for ${sample}`)
