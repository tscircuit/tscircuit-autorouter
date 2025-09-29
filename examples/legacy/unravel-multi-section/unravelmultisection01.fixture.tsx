import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel3 from "examples/legacy/assets/unravel3.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { UnravelMultiSectionSolver } from "lib/solvers/UnravelSolver/UnravelMultiSectionSolver"

export default function UnravelMultiSection01() {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new UnravelMultiSectionSolver({
          assignedSegments: unravel3.assignedSegments,
          nodes: unravel3.nodes as CapacityMeshNode[],
          colorMap: unravel3.colorMap,
        })

        return solver
      }}
    />
  )
}
