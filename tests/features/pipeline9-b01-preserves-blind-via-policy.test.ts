import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("Pipeline9 preserves blind-via policy in detailed routing", (): void => {
  for (const allowBlindAndBuriedVias of [false, true]) {
    const solver = new Pipeline9HighDensitySolver({
      nodePortPoints: [
        {
          capacityMeshNodeId: "blind-via-window",
          center: { x: 0, y: 0 },
          width: 0.4,
          height: 0.4,
          availableZ: [0, 1, 2, 3],
          portPoints: [
            { x: 0, y: 0, z: 0, connectionName: "signal" },
            { x: 0, y: 0, z: 1, connectionName: "signal" },
          ],
        },
      ],
      fixedHdRoutes: [],
      connMap: new ConnectivityMap({ signal: ["signal"] }),
      obstacles: [
        {
          type: "rect",
          layers: ["inner2"],
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          connectedTo: ["foreign-net"],
        },
      ],
      layerCount: 4,
      allowBlindAndBuriedVias,
      viaDiameter: 0.2032,
      traceWidth: 0.1524,
      minimumTraceWidth: 0.1524,
      obstacleMargin: 0.15,
      traceToPadClearance: 0.1,
      effort: 1,
      includeBoardObstacles: true,
      enableRegionalFallback: false,
    })
    solver.step()
    expect(solver.activeB01Solver?.allowBlindAndBuriedVias).toBe(
      allowBlindAndBuriedVias,
    )
    expect(solver.activeB01Solver?.useExactPortCoordinates).toBeTrue()
    solver.solve()
    expect(solver.solved).toBe(allowBlindAndBuriedVias)
    expect(solver.failed).toBe(!allowBlindAndBuriedVias)
    expect(solver.routes.length).toBe(allowBlindAndBuriedVias ? 1 : 0)
  }
})
