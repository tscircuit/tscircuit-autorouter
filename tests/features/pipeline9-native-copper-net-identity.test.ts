import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { arePipeline9RoutesOnSameNet } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("saved copper retains net ownership through canonical and alias IDs", (): void => {
  const connMap = new ConnectivityMap({
    data: ["cpu-data", "ram-data"],
    clock: ["cpu-clock", "ram-clock"],
  })
  const saved = {
    connectionName: "saved-data-section",
    rootConnectionName: "data",
  }
  expect(
    arePipeline9RoutesOnSameNet(
      { left: { connectionName: "cpu-data" }, right: saved },
      connMap,
    ),
  ).toBeTrue()
  expect(
    arePipeline9RoutesOnSameNet(
      { left: { connectionName: "ram-data" }, right: saved },
      connMap,
    ),
  ).toBeTrue()
  expect(
    arePipeline9RoutesOnSameNet(
      { left: { connectionName: "cpu-clock" }, right: saved },
      connMap,
    ),
  ).toBeFalse()
  expect(
    arePipeline9RoutesOnSameNet(
      { left: { connectionName: "unrelated" }, right: saved },
      connMap,
    ),
  ).toBeFalse()
})
