import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravelmultisection03 from "examples/legacy/assets/unravelmultisection03.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { UnravelMultiSectionSolver } from "lib/solvers/UnravelSolver/UnravelMultiSectionSolver"

export default function UnravelMultiSection03() {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new UnravelMultiSectionSolver({
          assignedSegments: unravelmultisection03[0].assignedSegments,
          nodes: unravelmultisection03[0].nodes as CapacityMeshNode[],
          colorMap: unravelmultisection03[0].colorMap,
        })

        return solver
      }}
    />
  )
}
