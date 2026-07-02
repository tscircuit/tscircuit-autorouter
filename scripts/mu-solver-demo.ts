#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { MuSolver, type MuSolverInput } from "../lib/solvers/MuSolver/MuSolver"
import {
  buildAllButOneTopologyExample,
  buildTwoBgaTopologyExample,
} from "../lib/solvers/MuSolver/examples/twoBgaTopologies"
import {
  visualizeTopologyIsometric,
  visualizeTopologySlices,
} from "../lib/solvers/MuSolver/visualizeMergedTopology3D"
import type { CapacityMeshNode } from "../lib/types"
import { classifyLayerSpan } from "../lib/solvers/MuSolver/topologySpan"

const countSpanKinds = (
  regions: CapacityMeshNode[],
  layerCount: number,
): Record<string, number> => {
  const counts: Record<string, number> = {
    single: 0,
    every: 0,
    "all-but-one": 0,
  }
  for (const region of regions) {
    counts[classifyLayerSpan(region, layerCount)] += 1
  }
  return counts
}

const runExample = async (
  name: string,
  example: MuSolverInput,
  outDir: string,
): Promise<void> => {
  const solver = new MuSolver(example)
  solver.solve()

  const merged = solver.getOutput().routingRegions

  const isoSvg = getSvgFromGraphicsObject(visualizeTopologyIsometric(merged), {
    backgroundColor: "white",
  })
  const sliceSvg = getSvgFromGraphicsObject(
    visualizeTopologySlices(merged, example.layerCount),
    { backgroundColor: "white" },
  )

  await writeFile(path.join(outDir, `${name}-isometric.svg`), isoSvg)
  await writeFile(path.join(outDir, `${name}-slices.svg`), sliceSvg)

  console.log(`\n=== ${name} (layerCount=${example.layerCount}) ===`)
  console.log(
    "  span kinds (merged):",
    JSON.stringify(countSpanKinds(merged, example.layerCount)),
  )
  console.log(
    "  seam regions by case:",
    JSON.stringify(solver.stats.seamsByCase),
  )
  console.log("  total seam regions:", solver.stats.seamRegionCount)
  console.log(`  wrote ${name}-isometric.svg and ${name}-slices.svg`)
}

const main = async (): Promise<void> => {
  const outDir = path.join(process.cwd(), "tmp", "mu-solver-demo")
  await mkdir(outDir, { recursive: true })

  await runExample("two-bga", buildTwoBgaTopologyExample(), outDir)
  await runExample("all-but-one", buildAllButOneTopologyExample(), outDir)

  console.log(`\nOutput written to ${outDir}`)
  console.log("View the .svg files in any browser or image viewer.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
