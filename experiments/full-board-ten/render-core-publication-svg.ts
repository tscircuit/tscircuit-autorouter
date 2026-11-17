import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

const [outputArgument] = process.argv.slice(2)
if (!outputArgument) throw new Error("Expected actual native output directory")
const output = resolve(outputArgument)
const circuitJson = JSON.parse(gunzipSync(readFileSync(join(output, "circuit.json.gz"))).toString())
const svg = convertCircuitJsonToPcbSvg(circuitJson, {
  width: 1600,
  height: 1100,
  backgroundColor: "white",
  shouldDrawRatsNest: false,
  shouldDrawErrors: false,
  showPcbGroups: false,
})
writeFileSync(join(output, "pcb.svg.gz"), gzipSync(svg, { level: 1 }))
