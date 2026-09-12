import { expect, test } from "bun:test"
import { initializeTinyHypergraphBindings } from "lib/bindings/initializeTinyHypergraphBindings"
import { TinyHyperGraphSolver } from "../rust/tiny-hypergraph-bindings/ts"
import { createTinyHypergraphInput } from "tests/fixtures/createTinyHypergraphInput"

test("tiny-hypergraph JSON transport preserves typed arrays and metadata semantics", () => {
  initializeTinyHypergraphBindings()
  const { topology, problem, options } = createTinyHypergraphInput()
  const metadata = {
    null: null,
    undefined: undefined,
    numbers: [NaN, Infinity, -Infinity, -0],
    bigints: [0n, 42n, 9007199254740991n],
    largeNumbers: [1e16, 1e30],
    unicode: "x\ud800",
    map: new Map<string, number | undefined>([
      ["present", undefined],
      ["zero", -0],
    ]),
  }
  const solver = new TinyHyperGraphSolver(
    {
      ...topology,
      portY: new Float64Array([-0, 0]),
      portMetadata: [
        { serializedPortId: "p0", custom: metadata },
        { serializedPortId: "p1" },
      ],
    },
    problem,
    { ...options, RIP_THRESHOLD_START: Infinity, DISTANCE_TO_COST: -0 },
  )
  try {
    expect(solver.solve().solved).toBe(true)
    const output = solver.getOutput()
    expect(Object.is(output.ports[0].d.y, -0)).toBe(true)
    expect(output.ports[0].d.custom).toEqual({
      null: undefined,
      undefined: undefined,
      numbers: [undefined, undefined, undefined, 0],
      bigints: [0, 42, 9007199254740991],
      largeNumbers: [1e16, 1e30],
      unicode: "x\ufffd",
      map: { present: undefined, zero: 0 },
    })
    expect(Object.keys(output.ports[0].d.custom)).toEqual(Object.keys(metadata))
    expect(solver.getRoutingSnapshot().currentRouteId).toBeUndefined()
    expect(metadata.null).toBeNull()
    expect(Number.isNaN(metadata.numbers[0])).toBe(true)
    expect(Object.is(metadata.numbers[3], -0)).toBe(true)
    expect(metadata.unicode).toBe("x\ud800")
  } finally {
    solver.dispose()
  }
})
