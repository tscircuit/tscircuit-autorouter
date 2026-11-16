import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import { getH616PowerCrossingSnapshots } from "tests/fixtures/getH616PowerCrossingSnapshots"
import { HighDensitySolverB01 } from "@tscircuit/high-density-b01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreloadedInnerLayerPortValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreloadedInnerLayerPortValidator"
import { normalizePipeline9NodeRootConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

type H616CrossingFixture = {
  circuitJson: AnyCircuitElement[]
  srj: SimpleRouteJson
  nodes: NodeWithPortPoints[]
  inputNodes: InputNodeWithPortPoints[]
  netMap: ConstructorParameters<typeof ConnectivityMap>[0]
  b01: ConstructorParameters<typeof HighDensitySolverB01>[0]
}

test("H616 ground crossings beside completed DDR copper", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-power-crossing.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as H616CrossingFixture
  const centeredSolver = new HighDensitySolverB01(fixture.b01)
  centeredSolver.solve()
  expect(centeredSolver.failed).toBeTrue()
  const connMap = new ConnectivityMap(fixture.netMap)
  const isPortPointClear = createPreloadedInnerLayerPortValidator({
    srj: fixture.srj,
    connMap,
    traceWidth: fixture.srj.minTraceWidth,
    viaDiameter: getViaDimensions(fixture.srj).padDiameter,
  })
  const distribution = new UniformPortDistributionSolver({
    nodeWithPortPoints: fixture.nodes,
    inputNodesWithPortPoints: fixture.inputNodes,
    obstacles: fixture.srj.obstacles,
    layerCount: fixture.srj.layerCount,
    useLayerAwareGeometry: true,
    preserveSolitaryPorts: true,
    isPortPointClear,
  })
  distribution.solve()
  expect(distribution.solved).toBeTrue()
  const node = distribution
    .getOutput()
    .find(
      (candidate) =>
        candidate.capacityMeshNodeId ===
        fixture.b01.nodeWithPortPoints.capacityMeshNodeId,
    )!
  const normalizedNode = normalizePipeline9NodeRootConnectionNames(
    node,
    connMap,
  )
  const solver = new HighDensitySolverB01({
    ...fixture.b01,
    nodeWithPortPoints: normalizedNode,
  })
  solver.solve()
  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  const routes = solver.solved ? solver.getOutput() : []
  expect(routes).toHaveLength(0)
  for (const route of routes) {
    const terminals = normalizedNode.portPoints.filter(
      (point) => point.connectionName === route.connectionName,
    )
    expect(terminals).toHaveLength(2)
    expect(route.route[0]).toMatchObject({
      x: terminals[0]!.x,
      y: terminals[0]!.y,
      z: terminals[0]!.z,
    })
    expect(route.route.at(-1)).toMatchObject({
      x: terminals[1]!.x,
      y: terminals[1]!.y,
      z: terminals[1]!.z,
    })
  }
  const crossing = normalizedNode.portPoints.find(
    (point) => point.portPointId === "ce66867_pp2_z2::2",
  )!
  const ddrWire = fixture.b01.obstacles!.find(
    (obstacle) =>
      obstacle.type === "route" &&
      obstacle.connectionName === "source_net_23_fixed_100_14",
  )!
  if (ddrWire.type !== "route") throw new Error("Missing native DDR wire")
  const clearanceMm =
    pointToSegmentDistance(crossing, ddrWire.route[0]!, ddrWire.route[1]!) -
    (ddrWire.traceThickness + fixture.srj.minTraceWidth) / 2
  expect(
    fixture.circuitJson.filter(
      (element) => element.type === "source_component",
    ),
  ).toHaveLength(125)
  const snapshots = getH616PowerCrossingSnapshots({
    circuitJson: fixture.circuitJson,
    srj: fixture.srj,
    connMap,
    node: normalizedNode,
    routes,
    crossing,
    clearanceMm,
  })
  await expect(snapshots.board).toMatchSvgSnapshot(import.meta.path)
  await expect(snapshots.crossing).toMatchSvgSnapshot(import.meta.path, {
    svgName: "crossing",
  })
})
