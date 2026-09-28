import { expect, test } from "bun:test"
import { bFamilySpine } from "../../scripts/differential-pair-portfolio/bFamilySpine"

test("restores B01 terminal via stations without moving explicit vias or endpoints", (): void => {
  let reproducedMovedTransition = false
  for (const reversed of [false, true]) {
    const terminals = [
      { x: 1.172847626501264, y: 0, z: 0 },
      { x: 8.325, y: 0, z: 0 },
    ]
    if (reversed) terminals.reverse()
    const adapter = bFamilySpine({
      bounds: { minX: -1, maxX: 13, minY: -4, maxY: 4 },
      layerCount: 2,
      start: terminals[0]!,
      end: terminals[1]!,
      traceWidth: 0.8,
      viaDiameter: 1.25,
      obstacleMargin: 0.15,
      obstacles: [
        {
          type: "rect",
          center: { x: 6, y: 0 },
          width: 1.5,
          height: 1,
          layers: ["top"],
          connectedTo: [],
        },
      ],
      existingTraces: [],
    })
    if (!adapter.solver) throw new Error("Expected a supported B01 window")
    adapter.solver.solve()
    expect(adapter.solver.solved).toBe(true)
    const raw = adapter.solver.getOutput()[0]!
    reproducedMovedTransition ||= raw.route.some((point, index) => {
      const previous = raw.route[index - 1]
      return (
        previous &&
        previous.z !== point.z &&
        Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-8
      )
    })
    const candidate = adapter.getCandidate()
    if (!candidate) throw new Error("Expected a completed spine")
    expect(candidate[0]).toEqual(terminals[0])
    expect(candidate.at(-1)).toEqual(terminals[1])
    let transitions = 0
    for (let index = 1; index < candidate.length; index++) {
      const previous = candidate[index - 1]!,
        point = candidate[index]!
      if (previous.z === point.z) continue
      transitions++
      expect(point.x).toBe(previous.x)
      expect(point.y).toBe(previous.y)
      expect(
        raw.vias.some((via) => via.x === point.x && via.y === point.y),
      ).toBe(true)
    }
    expect(transitions).toBe(raw.vias.length)
  }
  expect(reproducedMovedTransition).toBe(true)
})
