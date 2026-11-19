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
    arePipeline9RoutesOnSameNet({ connectionName: "cpu-data" }, saved, connMap),
  ).toBeTrue()
  expect(
    arePipeline9RoutesOnSameNet({ connectionName: "ram-data" }, saved, connMap),
  ).toBeTrue()
  expect(
    arePipeline9RoutesOnSameNet(
      { connectionName: "cpu-clock" },
      saved,
      connMap,
    ),
  ).toBeFalse()
  expect(
    arePipeline9RoutesOnSameNet(
      { connectionName: "unrelated" },
      saved,
      connMap,
    ),
  ).toBeFalse()
})
