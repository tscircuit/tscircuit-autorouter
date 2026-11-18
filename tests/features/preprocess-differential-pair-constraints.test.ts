import { expect, test } from "bun:test"
import { PreprocessSimpleRouteJsonSolver } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver"
import type { DifferentialPair, SimpleRouteJson } from "lib/types"

test("both preprocessors reject invalid pair constraints and preserve valid declarations", (): void => {
  const inputSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "D+",
        pointsToConnect: [
          { x: -3, y: 0.5, layer: "top" },
          { x: 3, y: 0.5, layer: "top" },
        ],
      },
      {
        name: "D-",
        pointsToConnect: [
          { x: -3, y: -0.5, layer: "top" },
          { x: 3, y: -0.5, layer: "top" },
        ],
      },
    ],
  }
  const validPair: DifferentialPair = {
    connectionNames: ["D+", "D-"],
    lengthTolerance: 0.1,
  }
  const invalidDeclarations = [
    {
      serialized: '[{"connectionNames":["D+","D-"]}]',
      field: "lengthTolerance",
    },
    {
      serialized: '[{"connectionNames":["D+","D-"],"lengthTolerance":null}]',
      field: "lengthTolerance",
    },
    {
      serialized: '[{"connectionNames":["D+","D-"],"lengthTolerance":"0.1"}]',
      field: "lengthTolerance",
    },
    {
      serialized: '[{"connectionNames":["D+","D-"],"lengthTolerance":-0.1}]',
      field: "lengthTolerance",
    },
    {
      serialized: '[{"connectionNames":["D+","D-"],"lengthTolerance":1e999}]',
      field: "lengthTolerance",
    },
    {
      serialized:
        '[{"connectionNames":["D+","D-"],"lengthTolerance":0.1,"traceGap":-0.1}]',
      field: "traceGap",
    },
    {
      serialized:
        '[{"connectionNames":["D+","D-"],"lengthTolerance":0.1,"traceGap":1e999}]',
      field: "traceGap",
    },
    {
      serialized:
        '[{"connectionNames":["D+","D-"],"lengthTolerance":0.1,"maxUncoupledLength":-1}]',
      field: "maxUncoupledLength",
    },
    {
      serialized:
        '[{"connectionNames":["D+","D-"],"lengthTolerance":0.1,"maxUncoupledLength":1e999}]',
      field: "maxUncoupledLength",
    },
    {
      serialized: '[{"connectionNames":["D+"],"lengthTolerance":0.1}]',
      field: "two distinct",
    },
    {
      serialized: '[{"connectionNames":["D+","D+"],"lengthTolerance":0.1}]',
      field: "two distinct",
    },
    {
      serialized: '[{"connectionNames":["D+",""],"lengthTolerance":0.1}]',
      field: "non-empty",
    },
    { serialized: "[null]", field: "two distinct" },
    { serialized: "null", field: "must be an array" },
  ]
  for (const declaration of invalidDeclarations) {
    const invalidInput: SimpleRouteJson = {
      ...inputSrj,
      differentialPairs: JSON.parse(declaration.serialized),
    }
    const originalInput = JSON.stringify(invalidInput)
    for (const Solver of [
      PreprocessSimpleRouteJsonSolver,
      PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver,
    ]) {
      const solver = new Solver(invalidInput)
      solver.solve()
      expect(solver.failed).toBe(true)
      expect(solver.solved).toBe(false)
      expect(solver.error).toContain(declaration.field)
      expect(solver.outputSrj).toBeUndefined()
    }
    expect(JSON.stringify(invalidInput)).toBe(originalInput)
  }

  const validDeclarations: (DifferentialPair[] | undefined)[] = [
    undefined,
    [],
    [validPair],
    [{ ...validPair, lengthTolerance: 0, traceGap: 0, maxUncoupledLength: 0 }],
    [{ ...validPair, traceGap: 0.2, maxUncoupledLength: 2 }],
    [{ connectionNames: ["legacyP", "legacyN"], lengthTolerance: 0.1 }],
  ]
  for (const differentialPairs of validDeclarations) {
    const validInput = { ...inputSrj, differentialPairs }
    const originalInput = JSON.stringify(validInput)
    for (const Solver of [
      PreprocessSimpleRouteJsonSolver,
      PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver,
    ]) {
      const solver = new Solver(validInput)
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(solver.error).toBeNull()
      expect(solver.getOutputSimpleRouteJson().differentialPairs).toEqual(
        differentialPairs,
      )
    }
    expect(JSON.stringify(validInput)).toBe(originalInput)
  }

  const orderedInput: SimpleRouteJson = {
    ...inputSrj,
    differentialPairs: [validPair],
    connections: inputSrj.connections.map((connection) => ({
      ...connection,
      pointsToConnect: [
        {
          x: -3,
          y: connection.pointsToConnect[0]!.y,
          layer: "top",
          pointId: `${connection.name}:start`,
        },
        {
          x: 0,
          y: connection.pointsToConnect[0]!.y,
          layer: "top",
          pointId: `${connection.name}:middle`,
        },
        {
          x: 3,
          y: connection.pointsToConnect[0]!.y,
          layer: "top",
          pointId: `${connection.name}:end`,
        },
      ],
      path: [
        `${connection.name}:start`,
        `${connection.name}:middle`,
        `${connection.name}:end`,
      ],
    })),
  }
  const originalOrderedInput = JSON.stringify(orderedInput)
  for (const Solver of [
    PreprocessSimpleRouteJsonSolver,
    PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver,
  ]) {
    const solver = new Solver(orderedInput)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.getOutputSimpleRouteJson().differentialPairs).toEqual(
      orderedInput.differentialPairs,
    )
    expect(solver.getOutputSimpleRouteJson().connections).toEqual(
      orderedInput.connections,
    )
  }
  expect(JSON.stringify(orderedInput)).toBe(originalOrderedInput)
})
