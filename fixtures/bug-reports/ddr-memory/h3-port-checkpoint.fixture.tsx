import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { ReactElement } from "react"
import captured from "../../../tests/fixtures/assets/h3-ddr-displaced-port-pair.json"

const nodes: NodeWithPortPoints[] = captured.nodes
const ownerIds: [string, string] = [
  nodes[0]!.capacityMeshNodeId,
  nodes[1]!.capacityMeshNodeId,
]

export default function H3PortCheckpointRepro(): ReactElement {
  return (
    <div>
      <p>
        Real H3 shared-edge checkpoint. Step or Solve, then zoom to the
        lower-left shared edge. This runs the current revision's actual
        Pipeline9 distribution policy. Compare the repro branch with #3332. Dots
        are virtual region crossings, not component pads.
      </p>
      <GenericSolverDebugger
        createSolver={() => {
          const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
            layerCount: 2,
            minTraceWidth: captured.traceWidth,
            bounds: { minX: 100, maxX: 160, minY: -100, maxY: -30 },
            obstacles: [],
            connections: [],
          })
          Object.assign(pipeline, {
            portPointPathingSolver: {
              getOutput: () => ({
                nodesWithPortPoints: structuredClone(nodes),
                inputNodeWithPortPoints: nodes.map((node) => ({
                  ...node,
                  availableZ: node.availableZ!,
                  portPoints: node.portPoints.map((port) => ({
                    ...port,
                    portPointId: port.portPointId!,
                    connectionNodeIds: ownerIds,
                    distToCentermostPortOnZ: 0,
                  })),
                })),
              }),
            },
          })
          const stage = pipeline.pipelineDef.find(
            (entry) => entry.solverName === "uniformPortDistributionSolver",
          )!
          const [params] = stage.getConstructorParams(pipeline)
          return new UniformPortDistributionSolver(
            params as UniformPortDistributionSolverInput,
          )
        }}
      />
    </div>
  )
}
