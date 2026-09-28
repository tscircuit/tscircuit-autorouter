import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { generateCorpus } from "../scripts/differential-pair-corpus/generateCorpus"
import { selectPilot } from "../scripts/differential-pair-corpus/generate"
import { validateCorpus } from "../scripts/differential-pair-corpus/validateCorpus"

test("seeded corpus validates 2048 unique boards with stable prefix and disjoint source families", () => {
  const options = { seed: 20260928, count: 2048, sourceRoot: resolve(import.meta.dir, "..") }
  const samples = generateCorpus(options)
  const validation = validateCorpus(samples)
  expect(validation.errors).toEqual([])
  expect(validation.exactDuplicateGroups).toEqual([])
  expect(validation.shapeGroups).toEqual([])
  expect(generateCorpus({ ...options, count: 80 })).toEqual(samples.slice(0, 80))
  const pilot = selectPilot(samples.slice(0, 80))
  expect(new Set(pilot.map((sample) => sample.kind)).size).toBe(3)
  expect(new Set(pilot.map((sample) => sample.provenance.familyId)).size).toBe(3)
  expect(pilot.some((sample) => sample.srj.connections.some((connection) =>
    new Set(connection.pointsToConnect.map((point) => point.layer)).size > 1))).toBe(true)
  expect(samples.filter((sample) => sample.kind === "control").every((sample) =>
    sample.controlWitness?.length === sample.srj.connections.length)).toBe(true)
})
