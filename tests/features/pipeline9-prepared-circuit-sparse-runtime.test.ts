import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("prepared conversion retains native access and errors for sparse and null runtime route arrays", (): void => {
  const outcome = (operation: () => unknown): unknown => {
    try { return { value: operation() } } catch (error) {
      return { errorName: (error as Error).name, error: (error as Error).message }
    }
  }
  for (const withConnections of [false, true]) {
    for (const invalid of [undefined, null]) {
      const { srj, hdRoutes } = createPreparedRepairCircuitInput(0)
      if (!withConnections) srj.connections = []
      const routes = [hdRoutes[0]!, invalid, hdRoutes[1]!] as HighDensityRoute[]
      expect(outcome(() => createPreparedRepairCircuitJsonConverter(srj, {}, createPreparedRepairCircuitStats())(routes)))
        .toEqual(outcome(() => convertToCircuitJson(srj, routes)))
      delete routes[1]
      expect(outcome(() => createPreparedRepairCircuitJsonConverter(srj, {}, createPreparedRepairCircuitStats())(routes)))
        .toEqual(outcome(() => convertToCircuitJson(srj, routes)))
    }
  }
})
