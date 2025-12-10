/**
 * Update an SRJ JSON file with a given number of layers.
 *
 * - Adds/updates `layerCount` at the top level of the SRJ.
 * - Regenerates `obstacles[*].layers` with names:
 *   - ["top"] if count = 1
 *   - ["top", "bottom"] if count = 2
 *   - ["top", "inner1", ..., "innerN", "bottom"] for count >= 3
 *
 * Usage:
 *   bun run scripts/update-layer-count.ts <path-to-srj.json> <layerCount>
 *   npx ts-node scripts/update-layer-count.ts <path-to-srj.json> <layerCount>
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const srjArg = process.argv[2]
const layerArg = process.argv[3]

if (!srjArg || !layerArg) {
  console.error(
    "Usage: bun run scripts/update-layer-count.ts <path-to-srj.json> <layerCount>",
  )
  process.exit(1)
}

const layerCount = Number.parseInt(layerArg, 10)

if (!Number.isFinite(layerCount) || layerCount < 1) {
  console.error("layerCount must be an integer >= 1")
  process.exit(1)
}

function buildLayers(count: number): string[] {
  if (count === 1) {
    return ["top"]
  }
  if (count === 2) {
    return ["top", "bottom"]
  }

  const layers: string[] = ["top"]
  for (let i = 1; i <= count - 2; i++) {
    layers.push(`inner${i}`)
  }
  layers.push("bottom")
  return layers
}

const layers = buildLayers(layerCount)

// Resolve SRJ path relative to current working directory
const srjPath = resolve(process.cwd(), srjArg)

const raw = readFileSync(srjPath, "utf8")
const data: any = JSON.parse(raw)

// 1) add / update layerCount at the top level
data.layerCount = layerCount

// 2) set obstacles[*].layers
if (Array.isArray(data.obstacles)) {
  data.obstacles = data.obstacles.map((obstacle: any) => ({
    ...obstacle,
    layers,
  }))
}

writeFileSync(srjPath, `${JSON.stringify(data, null, 2)}\n`, "utf8")

console.log(
  `Updated ${srjPath} with layerCount=${layerCount} and ${layers.length} layer names.`,
)
