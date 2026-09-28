import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { generateCorpus } from "../scripts/differential-pair-corpus/generateCorpus"
import { validateCorpus } from "../scripts/differential-pair-corpus/validateCorpus"

test("validator rejects resistor net merges, misowned ports, missing witnesses and fake infeasibility", () => {
  const samples = generateCorpus({ seed: 20260928, count: 80, sourceRoot: resolve(import.meta.dir, "..") })
  const merged = structuredClone(samples[0]!)
  const path = merged.logicalPaths[0]!
  const resistor = path.seriesComponents[0]!
  const pad = merged.srj.obstacles.find((obstacle) => obstacle.obstacleId === resistor.inputPortId)!
  pad.connectedTo.push(resistor.downstreamConnectionName)
  expect(validateCorpus([merged]).errors.some((error) => error.includes("distinct logical path copper nets"))).toBe(true)
  const misowned = structuredClone(samples[0]!)
  misowned.logicalPaths[0]!.seriesComponents[0]!.outputPortId = "missing_port"
  expect(validateCorpus([misowned]).errors.some((error) => error.includes("pad ownership"))).toBe(true)
  const noWitness = structuredClone(samples[0]!)
  delete noWitness.controlWitness
  expect(validateCorpus([noWitness]).valid).toBe(false)
  const infeasible = structuredClone(samples.find((sample) => sample.kind === "infeasible")!)
  infeasible.srj.obstacles = infeasible.srj.obstacles.filter((obstacle) => obstacle.obstacleId !== "deliberate_all_layer_barrier")
  expect(validateCorpus([infeasible]).errors.some((error) => error.includes("separating barrier"))).toBe(true)
})
