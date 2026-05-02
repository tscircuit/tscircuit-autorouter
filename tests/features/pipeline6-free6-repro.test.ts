import { expect, test } from "bun:test"
import { AttachProjectedRectsSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AttachProjectedRectsSolver"
import { PolySingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/PolySingleIntraNodeSolver"

test("pipeline6 free-6 extracted node uses conservative sliver projection", () => {
  const polygon = [
    { x: -3.2750030000000003, y: 2.625 },
    { x: -3.2750000000000004, y: 1.999998 },
    { x: -3.2749970000000004, y: 1.374999 },
    { x: -2.7299990000000003, y: -4.087643169956141 },
    { x: -2.7249969999999997, y: 1.375001 },
    { x: -2.7249969999999997, y: 1.999998 },
    { x: -2.725001, y: 2.624999 },
    { x: -3.2700010000000024, y: 9.08764216995614 },
  ]

  const attachProjectedRectsSolver = new AttachProjectedRectsSolver({
    equivalentAreaExpansionFactor: 2,
    minProjectedRectDimension: 0.45,
    traceWidth: 0.15,
    viaDiameter: 0.6,
    obstacleMargin: 0.15,
    nodesWithPortPoints: [
      {
        capacityMeshNodeId: "free-6",
        polygon,
        center: { x: -3.006238873758835, y: 2.318894296998632 },
        width: 0.5042195299138056,
        height: 11.869310003953185,
        availableZ: [0, 1],
        portPoints: [
          {
            portPointId: "p1",
            x: -3.256382871980899,
            y: 1.188425249868615,
            z: 0,
            connectionName: "source_net_3_mst1",
            rootConnectionName: "source_net_3",
          },
          {
            portPointId: "p2",
            x: -2.7251686887605406,
            y: 1.1875010786054316,
            z: 0,
            connectionName: "source_net_3_mst1",
            rootConnectionName: "source_net_3",
          },
          {
            portPointId: "p3",
            x: -3.2701461224892903,
            y: 8.90014222611758,
            z: 0,
            connectionName: "source_net_12_mst2",
            rootConnectionName: "source_net_12",
          },
          {
            portPointId: "p4",
            x: -3.254244898165465,
            y: 8.900805355449524,
            z: 0,
            connectionName: "source_net_12_mst2",
            rootConnectionName: "source_net_12",
          },
          {
            portPointId: "p5",
            x: -3.251382871980899,
            y: 1.1934252498686149,
            z: 1,
            connectionName: "source_net_0_mst1",
            rootConnectionName: "source_net_0",
          },
          {
            portPointId: "p6",
            x: -2.71999819999808,
            y: 2.19249799999616,
            z: 1,
            connectionName: "source_net_0_mst1",
            rootConnectionName: "source_net_0",
          },
          {
            portPointId: "p7",
            x: -2.861450848899501,
            y: -2.770070604337339,
            z: 0,
            connectionName: "source_net_10_mst0",
            rootConnectionName: "source_net_10",
          },
          {
            portPointId: "p8",
            x: -2.7282744370798198,
            y: -2.204261806172571,
            z: 0,
            connectionName: "source_net_10_mst0",
            rootConnectionName: "source_net_10",
          },
          {
            portPointId: "p9",
            x: -2.917869709339701,
            y: -2.2045711965936325,
            z: 0,
            connectionName: "source_net_13",
            rootConnectionName: "source_net_13",
          },
          {
            portPointId: "p10",
            x: -2.72775681235994,
            y: -1.6389679920429034,
            z: 0,
            connectionName: "source_net_13",
            rootConnectionName: "source_net_13",
          },
          {
            portPointId: "p11",
            x: -3.2749985000000006,
            y: 1.6874985,
            z: 0,
            connectionName: "source_net_1_mst1",
            rootConnectionName: "source_net_1",
          },
          {
            portPointId: "p12",
            x: -2.740757101834537,
            y: 2.811835814506616,
            z: 0,
            connectionName: "source_net_1_mst1",
            rootConnectionName: "source_net_1",
          },
          {
            portPointId: "p13",
            x: -3.2651461224892904,
            y: 8.905142226117581,
            z: 1,
            connectionName: "source_net_15_mst0",
            rootConnectionName: "source_net_15",
          },
          {
            portPointId: "p14",
            x: -3.249244898165465,
            y: 8.905805355449525,
            z: 1,
            connectionName: "source_net_15_mst0",
            rootConnectionName: "source_net_15",
          },
        ],
      },
    ],
  })
  attachProjectedRectsSolver.solve()

  const nodeWithPortPoints = attachProjectedRectsSolver.outputNodes[0]!
  const solver = new PolySingleIntraNodeSolver({
    nodeWithPortPoints,
    traceWidth: 0.15,
    viaDiameter: 0.6,
    obstacleMargin: 0.15,
    effort: 1,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes.length).toBeGreaterThan(0)
  expect(
    attachProjectedRectsSolver.projectionAdjustmentByNodeId.get("free-6"),
  ).toBe("corridor-expansion-factor-1")
  expect(nodeWithPortPoints.projectedRect?.equivalentAreaExpansionFactor).toBe(
    1,
  )
})
