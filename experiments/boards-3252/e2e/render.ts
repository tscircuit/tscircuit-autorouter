import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

const [beforePath, afterPath, outputDirectory] = process.argv.slice(2)
if (!beforePath || !afterPath || !outputDirectory) {
  throw new Error("Usage: bun render.ts before.circuit.json.gz after.circuit.json.gz output-directory")
}
mkdirSync(outputDirectory, { recursive: true })
for (const [label, path] of [["before", beforePath], ["after", afterPath]]) {
  const circuitJson = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"))
  const svg = convertCircuitJsonToPcbSvg(circuitJson, {
    width: 1200,
    height: 1000,
    backgroundColor: "white",
  })
  writeFileSync(`${outputDirectory}/icepi-local-${label}.svg`, svg)
  console.log(label, createHash("sha256").update(svg).digest("hex"))
}
