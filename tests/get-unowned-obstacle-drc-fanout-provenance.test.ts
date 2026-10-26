import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import { getUnownedObstacleDrcErrors } from "lib/testing/getUnownedObstacleDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"
import inputFixture from "./repro/assets/pipeline9-bga36-phase2.json"

function getErrors(
  inputSrj: SimpleRouteJson,
): ReturnType<typeof getUnownedObstacleDrcErrors> {
  const snapshot = structuredClone(inputSrj)
  const jointTraces = inputSrj.traces!
  const circuitJson = convertToCircuitJson(inputSrj, jointTraces)
  const errors = getUnownedObstacleDrcErrors({
    inputSrj,
    jointTraces,
    circuitJson,
  })
  expect(inputSrj).toEqual(snapshot)
  return errors
}

test("reference obstacle DRC distinguishes completed fanout planning footprints from physical barriers", (): void => {
  const input = structuredClone(inputFixture) as SimpleRouteJson
  const original = structuredClone(input)
  const planningIndex = input.obstacles.findIndex(
    (obstacle) => obstacle.isFanoutSourceKeepout === true,
  )
  const planning = input.obstacles[planningIndex]!
  expect(planningIndex).toBe(8)
  expect(input.traces).toHaveLength(8)
  expect(planning).toMatchObject({
    componentId: "pcb_component_0",
    center: { x: 0, y: 0 },
    width: 4.35,
    height: 4.35,
    connectedTo: [],
  })

  // Core replaces the completed source pads with this downstream planning
  // footprint, while retaining all eight physical fanout traces inside it.
  expect(getErrors(input)).toEqual([])
  for (const obstacleId of ["opaque-planning-region", undefined]) {
    const renamed: SimpleRouteJson = {
      ...input,
      obstacles: input.obstacles.map((obstacle, index) =>
        index === planningIndex ? { ...obstacle, obstacleId } : obstacle,
      ),
    }
    expect(getErrors(renamed)).toEqual([])
  }

  const { isFanoutSourceKeepout: _, ...unmarked } = planning
  for (const physicalBarrier of [
    unmarked,
    { ...planning, isFanoutSourceKeepout: false },
  ]) {
    const physicalInput: SimpleRouteJson = {
      ...input,
      obstacles: input.obstacles.map((obstacle, index) =>
        index === planningIndex ? physicalBarrier : obstacle,
      ),
    }
    const errors = getErrors(physicalInput)
    expect(errors).toHaveLength(8)
    expect(new Set(errors.map((error) => error.pcb_trace_id))).toEqual(
      new Set(input.traces!.map((trace) => trace.pcb_trace_id)),
    )
    expect(
      errors.every((error) => error.srj_obstacle_index === planningIndex),
    ).toBe(true)
    expect(errors.every((error) => error.actual_clearance === -0.05)).toBe(true)
  }

  const withPhysicalBarrier: SimpleRouteJson = {
    ...input,
    obstacles: [
      ...input.obstacles,
      { ...unmarked, obstacleId: "ordinary-raw-barrier" },
    ],
  }
  const physicalErrors = getErrors(withPhysicalBarrier)
  expect(physicalErrors).toHaveLength(8)
  expect(physicalErrors.every((error) => error.srj_obstacle_index === 9)).toBe(
    true,
  )
  expect(
    physicalErrors.every(
      (error) => error.srj_obstacle_id === "ordinary-raw-barrier",
    ),
  ).toBe(true)

  // Reference physical DRC must not erase the downstream routing constraint.
  expect(isOpaqueUnownedObstacle(planning)).toBe(true)
  const route: HighDensityRoute = {
    connectionName: "downstream-route",
    rootConnectionName: "downstream-route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const validate = createPipeline9PhysicalRouteValidator({
    physicalSrj: { ...input, obstacles: [planning] },
    connMap: new ConnectivityMap({}),
    obstacleMargin: 0,
  })
  expect(validate([route])).toBe(false)
  expect(input).toEqual(original)
})
