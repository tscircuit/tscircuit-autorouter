import {
  AssignableAutoroutingPipeline2,
} from "./lib"
import bugReport from "./fixtures/bug-reports/bugreport22-2a75ce/bugreport22-2a75ce.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "./lib/types"
import { JumperHighDensitySolver } from "./lib/autorouter-pipelines/AssignableAutoroutingPipeline2/JumperHighDensitySolver"

const solver = new AssignableAutoroutingPipeline2(
  bugReport as SimpleRouteJson,
)

// Step until we get to the high density solver phase
while (solver.getCurrentPhase() !== "highDensitySolver" && !solver.solved && !solver.failed) {
  solver.step()
}

console.log("Current phase:", solver.getCurrentPhase())

// Step one more time to initialize the highDensitySolver
solver.step()

const hdSolver = solver.highDensitySolver as JumperHighDensitySolver | undefined
if (hdSolver) {
  console.log("\n=== JumperHighDensitySolver Analysis ===")
  console.log("Total nodes:", hdSolver.allNodes.length)
  console.log("Nodes without crossings:", hdSolver.nodesWithoutCrossings.length)
  console.log("Nodes with crossings:", hdSolver.nodesWithCrossings.length)
  console.log("Current phase:", hdSolver.phase)

  console.log("\n=== Node Analyses ===")
  for (const analysis of hdSolver.nodeAnalyses.slice(0, 10)) {
    console.log(`Node ${analysis.node.capacityMeshNodeId}:`)
    console.log(`  - Port points: ${analysis.node.portPoints.length}`)
    console.log(`  - isSingleLayer: ${analysis.isSingleLayer}`)
    console.log(`  - hasCrossings: ${analysis.hasCrossings}`)
    console.log(`  - numSameLayerCrossings: ${analysis.numSameLayerCrossings}`)

    // Check z values
    const zValues = analysis.node.portPoints.map(p => p.z)
    const uniqueZ = [...new Set(zValues)]
    console.log(`  - z values: ${uniqueZ.join(", ")} (unique: ${uniqueZ.length})`)
  }

  // Count nodes with crossings that might need jumpers
  const potentialJumperNodes = hdSolver.nodeAnalyses.filter(a => a.hasCrossings)
  console.log("\n=== Nodes with crossings ===")
  console.log("Count:", potentialJumperNodes.length)
  for (const analysis of potentialJumperNodes) {
    console.log(`Node ${analysis.node.capacityMeshNodeId}:`)
    console.log(`  - Port points: ${analysis.node.portPoints.length}`)
    console.log(`  - isSingleLayer: ${analysis.isSingleLayer}`)
    console.log(`  - numSameLayerCrossings: ${analysis.numSameLayerCrossings}`)
    const zValues = analysis.node.portPoints.map(p => p.z)
    const uniqueZ = [...new Set(zValues)]
    console.log(`  - z values: ${uniqueZ.join(", ")} (unique: ${uniqueZ.length})`)
  }
} else {
  console.log("No highDensitySolver found")
}
