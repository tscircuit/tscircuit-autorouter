import { expect, test } from "bun:test"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { CapacityMeshNode } from "lib/types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import {
  createTopologyMergingSolverFromPlanning,
  createTopologyPlanningSolverForMerging,
} from "tests/fixtures/topology-merging-test-utils"
import {
  createSrj24Sample4TopologyFixture,
  visualizeLayerAccess,
  visualizeMixedComponent,
} from "./fixtures/srj24-sample4-topology.fixture"

test("shows the srj24 sample 4 topology gap", async (): Promise<void> => {
  const fixture = createSrj24Sample4TopologyFixture()
  const componentDetectionSolver = new ComponentDetectionSolver({
    inputSrj: fixture.inputSrj,
  })
  componentDetectionSolver.solve()
  const detectedBga = componentDetectionSolver
    .getOutput()
    .find((component) => component.componentId === "mixed-pad-bga")

  const topologyPlanningSolver = createTopologyPlanningSolverForMerging(
    fixture.inputSrj,
  )
  topologyPlanningSolver.solve()
  const topologyPlanningOutput = topologyPlanningSolver.getOutput()
  const routeRootIds =
    fixture.inputSrj.connections[0]?.__rootConnectionNames ?? []
  const componentTopTarget = topologyPlanningOutput.componentMeshNodes
    .flat()
    .find(
      (node) =>
        node._containsTarget &&
        node.availableZ.includes(0) &&
        Math.abs(node.center.x) < 1e-6 &&
        Math.abs(node.center.y) < 1e-6,
    )
  const globalBottomTarget = topologyPlanningOutput.globalMeshNodes.find(
    (node) =>
      node._containsTarget &&
      node.availableZ.includes(5) &&
      Math.abs(node.center.x - 0.17) < 1e-6 &&
      Math.abs(node.center.y) < 1e-6,
  )
  const getRetainedRouteRoots = (node: CapacityMeshNode | undefined) => {
    const aliases = new Set([
      ...(node?._targetConnectionName ? [node._targetConnectionName] : []),
      ...(node?._connectedTo ?? []),
    ])
    return routeRootIds.filter((rootId) => aliases.has(rootId))
  }
  const componentTargetRoots = getRetainedRouteRoots(componentTopTarget)
  const globalTargetRoots = getRetainedRouteRoots(globalBottomTarget)
  const sharedTargetRoots = componentTargetRoots.filter((rootId) =>
    globalTargetRoots.includes(rootId),
  )
  const topologyMergingSolver = createTopologyMergingSolverFromPlanning({
    inputSrj: fixture.inputSrj,
    topologyPlanningSolver,
  })
  topologyMergingSolver.solve()
  const bottomPadBounds = {
    minX: 0.17 - 0.59 / 2,
    maxX: 0.17 + 0.59 / 2,
    minY: -0.64 / 2,
    maxY: 0.64 / 2,
  }
  const crossLayerTargetAccess = topologyMergingSolver
    .getOutput()
    .find((node) => {
      const minX = node.center.x - node.width / 2
      const maxX = node.center.x + node.width / 2
      const minY = node.center.y - node.height / 2
      const maxY = node.center.y + node.height / 2
      return (
        node._containsTarget &&
        node.availableZ.includes(0) &&
        node.availableZ.includes(5) &&
        minX >= bottomPadBounds.minX - 1e-6 &&
        maxX <= bottomPadBounds.maxX + 1e-6 &&
        minY >= bottomPadBounds.minY - 1e-6 &&
        maxY <= bottomPadBounds.maxY + 1e-6
      )
    })

  const globalObstacleIds = new Set(
    topologyPlanningOutput.globalNoConnectionSrj.obstacles.map(
      (obstacle) => obstacle.obstacleId,
    ),
  )
  const detectedCoreObstacleIds = new Set(
    detectedBga
      ? fixture.inputSrj.obstacles
          .filter(
            (obstacle) =>
              obstacle.componentId === detectedBga.componentId &&
              obstacle.center.x >= detectedBga.bounds.minX &&
              obstacle.center.x <= detectedBga.bounds.maxX &&
              obstacle.center.y >= detectedBga.bounds.minY &&
              obstacle.center.y <= detectedBga.bounds.maxY,
          )
          .map((obstacle) => obstacle.obstacleId!)
      : [],
  )
  const hasDetectedBga = detectedBga !== undefined

  expect(componentTargetRoots).toContain(routeRootIds[0])
  expect(globalTargetRoots).toContain(routeRootIds[1])
  expect(crossLayerTargetAccess !== undefined).toBe(
    sharedTargetRoots.length > 0,
  )
  expect(
    [...fixture.nonCoreObstacleIds].every((obstacleId) =>
      globalObstacleIds.has(obstacleId),
    ),
  ).toBe(true)
  expect(
    [...fixture.bgaCoreObstacleIds].every((obstacleId) =>
      globalObstacleIds.has(obstacleId),
    ),
  ).toBe(!hasDetectedBga)
  const accessNodes = [
    { ...componentTopTarget!, capacityMeshNodeId: "BGA target" },
    ...(crossLayerTargetAccess
      ? [
          {
            ...crossLayerTargetAccess,
            capacityMeshNodeId: "regular access region",
            _isBgaViaRegion: true,
          },
        ]
      : []),
    { ...globalBottomTarget!, capacityMeshNodeId: "global target" },
  ]
  const accessEdges = crossLayerTargetAccess
    ? [
        {
          capacityMeshEdgeId: "top-to-access",
          nodeIds: ["BGA target", "regular access region"] as [string, string],
        },
        {
          capacityMeshEdgeId: "access-to-bottom",
          nodeIds: ["regular access region", "global target"] as [
            string,
            string,
          ],
        },
      ]
    : []
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: mixed pad package",
        step: 0,
        iteration: 0,
        graphics: visualizeMixedComponent({ inputSrj: fixture.inputSrj }),
      },
      {
        name: hasDetectedBga
          ? "Fix 1: BGA core detected"
          : "Issue 1: BGA core not detected",
        step: 1,
        iteration: componentDetectionSolver.iterations,
        graphics: visualizeMixedComponent({
          inputSrj: fixture.inputSrj,
          selectedObstacleIds: detectedCoreObstacleIds,
        }),
      },
      {
        name:
          sharedTargetRoots.length > 0
            ? "Target identity: shared electrical root"
            : "Issue: BGA target lost the net root",
        step: 2,
        iteration: topologyPlanningSolver.iterations,
        graphics: visualizeMixedComponent({
          inputSrj: fixture.inputSrj,
          selectedObstacleIds: new Set([
            "core-2-2",
            "stacked-bottom-pad",
          ]),
          globalObstacleIds,
          notes: [
            `route roots: ${routeRootIds.join(" + ")}`,
            `BGA target kept: ${componentTargetRoots.join(", ") || "none"}`,
            `global target kept: ${globalTargetRoots.join(", ") || "none"}`,
            `shared root: ${sharedTargetRoots.join(", ") || "none"}`,
          ],
        }),
      },
      {
        name: crossLayerTargetAccess
          ? "Result: regular z0/z5 access region"
          : "Failure: no regular z0/z5 access region",
        step: 3,
        iteration: topologyMergingSolver.iterations,
        graphics: visualizeLayerAccess({
          nodes: accessNodes,
          edges: accessEdges,
        }),
      },
    ],
    columns: 2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
