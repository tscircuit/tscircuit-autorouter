import { expect, test } from "bun:test"
import sample11 from "fixtures/datasets/dataset-srj15/sample11-region-reroute.srj.json" with {
  type: "json",
}
import edgeSolverInput from "tests/features/assets/pipeline4-dataset-srj15-sample11-edgeSolver_input.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

const getEdgeSolverFixtureNodes = (): CapacityMeshNode[] =>
  structuredClone(
    ((edgeSolverInput as unknown as CapacityMeshNode[][])[0] ??
      edgeSolverInput) as CapacityMeshNode[],
  )

test(
  "pipeline4 dataset-srj15 sample11 edgeSolver fixture fails at portPointPathing static reachability precheck",
  () => {
    const pipeline = new AutoroutingPipelineSolver4(
      structuredClone(sample11 as SimpleRouteJson),
    )

    pipeline.solveUntilPhase("edgeSolver")

    const capacityNodes = getEdgeSolverFixtureNodes()

    const edgeSolver = new CapacityMeshEdgeSolver2_NodeTreeOptimization(
      capacityNodes,
    )
    edgeSolver.solve()

    const availableSegmentPointSolver = new AvailableSegmentPointSolver({
      nodes: capacityNodes,
      edges: edgeSolver.edges,
      traceWidth: pipeline.minTraceWidth,
      colorMap: pipeline.colorMap,
      shouldReturnCrampedPortPoints: true,
    })
    availableSegmentPointSolver.solve()

    const necessaryCrampedPortPointSolver =
      new MultiTargetNecessaryCrampedPortPointSolver({
        capacityMeshNodes: capacityNodes,
        sharedEdgeSegments: availableSegmentPointSolver.getOutput(),
        simpleRouteJson: pipeline.srjWithPointPairs!,
        numberOfCrampedPortPointsToKeep: 5,
      })
    necessaryCrampedPortPointSolver.solve()

    const sharedEdgeSegments = necessaryCrampedPortPointSolver.getOutput()
    const { graph, connections } = buildHyperGraph({
      capacityMeshNodes: capacityNodes,
      layerCount: pipeline.srj.layerCount,
      segmentPortPoints: sharedEdgeSegments.flatMap(
        (segment) => segment.portPoints,
      ),
      simpleRouteJsonConnections: pipeline.srjWithPointPairs!.connections,
    })

    const portPointPathingSolver = new TinyHypergraphPortPointPathingSolver({
      graph,
      connections,
      layerCount: pipeline.srj.layerCount,
      effort: pipeline.effort,
      minViaPadDiameter: pipeline.viaDiameter,
      flags: {
        FORCE_CENTER_FIRST: true,
        RIPPING_ENABLED: true,
      },
      weights: {
        SHUFFLE_SEED: 0,
        MEMORY_PF_FACTOR: 4,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        CENTER_OFFSET_FOCUS_SHIFT: 0,
        NODE_PF_FACTOR: 0,
        LAYER_CHANGE_COST: 0,
        RIPPING_PF_COST: 0.0,
        NODE_PF_MAX_PENALTY: 100,
        BASE_CANDIDATE_COST: 0.6,
        MAX_ITERATIONS_PER_PATH: 0,
        RANDOM_WALK_DISTANCE: 0,
        START_RIPPING_PF_THRESHOLD: 0.3,
        END_RIPPING_PF_THRESHOLD: 1,
        MAX_RIPS: 1000,
        RANDOM_RIP_FRACTION: 0.3,
        STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
        GREEDY_MULTIPLIER: 0.7,
        MIN_ALLOWED_BOARD_SCORE: -10000,
      },
    })
    portPointPathingSolver.solve()

    expect(portPointPathingSolver.failed).toBe(true)
    expect(
      getLastStepSvg(portPointPathingSolver.visualize()),
    ).toMatchSvgSnapshot(import.meta.path)
  },
  { timeout: 20_000 },
)
