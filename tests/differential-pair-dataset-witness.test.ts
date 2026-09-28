import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { generateCorpus } from "../scripts/differential-pair-corpus/generateCorpus"
import { validateControlWitness } from "../scripts/differential-pair-corpus/validateControlWitness"

test("constructive controls reject an unrelated copper pad across their witness route", () => {
  const sample = generateCorpus({
    seed: 20260928,
    count: 1,
    sourceRoot: resolve(import.meta.dir, ".."),
  })[0]!
  expect(validateControlWitness(sample)).toEqual([])
  const [start, end] = sample.controlWitness![0]!.route
  if (
    !start ||
    !end ||
    start.route_type !== "wire" ||
    end.route_type !== "wire"
  )
    throw new Error("Missing straight witness")
  sample.srj.obstacles.push({
    obstacleId: "foreign_pad",
    type: "rect",
    layers: [start.layer],
    center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    width: 1,
    height: 1,
    connectedTo: [],
  })
  expect(
    validateControlWitness(sample).some((error) =>
      error.includes("pad clearance"),
    ),
  ).toBe(true)
})
