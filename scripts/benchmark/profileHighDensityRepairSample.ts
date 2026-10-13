import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { solveHighDensityRepairSample, type HighDensityRepairSampleInput } from "../../lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"

const inputs: HighDensityRepairSampleInput[] = JSON.parse(readFileSync(process.argv[2], "utf8"))
const input = inputs.find((entry): boolean => entry.sample.nodeWithPortPoints?.capacityMeshNodeId === process.argv[3])
if (!input) throw new Error(`Repair profile node ${process.argv[3]} is missing`)
const result = solveHighDensityRepairSample(input)
console.log(`Profile output SHA-256: ${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`)
