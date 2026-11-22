import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import "../fixtures/svg-matcher"
import { loadDdrForceClearanceFixture } from "../fixtures/loadDdrForceClearanceFixture"

test("Pipeline9 force improvement BGA pad via clearance snapshot", async (): Promise<void> => {
  const fixture = loadDdrForceClearanceFixture()
  const regionId = "topology_merge_26131"
  const hdRoutes = fixture.hdRoutes.filter(
    (route) => route.regionId === regionId,
  )
  const nodeWithPortPoints = fixture.nodeWithPortPoints.filter(
    (node) => node.capacityMeshNodeId === regionId,
  )
  const foreignBgaPad = {
    type: "rect" as const,
    center: { x: 14.06, y: 0.89 },
    width: 0.36,
    height: 0.36,
    layers: ["top"],
    connectedTo: ["pcb_smtpad_foreign_bga", "foreign_bga_net"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "pcb_smtpad_foreign_bga",
    },
  }
  const inputSrj = {
    ...fixture.inputSrj,
    bounds: { minX: 13.35, maxX: 14.35, minY: 0.6, maxY: 1.9 },
    connections: [],
    obstacles: [foreignBgaPad],
  }
  const baseParams = {
    hdRoutes: structuredClone(hdRoutes),
    nodeWithPortPoints: structuredClone(nodeWithPortPoints),
    totalStepsPerNode: 20,
    preserveTopologyPortAnchors: true,
  }
  const proposal = new HighDensityForceImproveSolver(baseParams)
  proposal.solve()
  const rejectedVia = proposal
    .getOutput()
    .find((route) => route.connectionName === "source_net_114_mst1")!.vias[0]!

  const solver = new Pipeline9HighDensityForceImproveSolver({
    ...structuredClone(baseParams),
    inputSrj,
  })
  solver.solve()
  const retainedRoute = solver
    .getOutput()
    .find((route) => route.connectionName === "source_net_114_mst1")!
  const retainedVia = retainedRoute.vias[0]!

  const routedGraphics = convertSrjToGraphicsObject({
    ...inputSrj,
    traces: solver.getOutput().map((route, index) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `${route.connectionName}_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, inputSrj.layerCount),
    })),
  })
  const graphics: GraphicsObject = {
    ...routedGraphics,
    rects: [
      ...(routedGraphics.rects ?? []),
      {
        center: foreignBgaPad.center,
        width: foreignBgaPad.width + 0.2,
        height: foreignBgaPad.height + 0.2,
        fill: "rgba(239, 68, 68, 0.08)",
        stroke: "#dc2626",
        label: "0.10mm required pad clearance",
      },
    ],
    circles: [
      ...(routedGraphics.circles ?? []),
      {
        center: rejectedVia,
        radius: retainedRoute.viaDiameter / 2,
        fill: "rgba(217, 70, 239, 0.22)",
        stroke: "#a21caf",
        label: "rejected proposal (0.060mm gap)",
      },
      {
        center: retainedVia,
        radius: retainedRoute.viaDiameter / 2,
        fill: "rgba(22, 163, 74, 0.18)",
        stroke: "#15803d",
        label: "retained via (0.147mm gap)",
      },
    ],
  }
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
