import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravelmultisection04 from "examples/legacy/assets/unravelmultisection04.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { UnravelMultiSectionSolver } from "lib/solvers/UnravelSolver/UnravelMultiSectionSolver"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new UnravelMultiSectionSolver({
        assignedSegments: unravelmultisection04[0].assignedSegments,
        nodes: unravelmultisection04[0].nodes as CapacityMeshNode[],
        colorMap: unravelmultisection04[0].colorMap,
      })

      return solver
    }}
  />
)
