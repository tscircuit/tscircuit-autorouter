import { createHash } from "node:crypto"
import { loadScenarios, parseDatasetName } from "./scenarios"

const dataset = parseDatasetName(process.argv[2] ?? "")
if (!dataset) throw new Error("A recognized dataset is required")
const scenarios = await loadScenarios(dataset, { effort: 1 })
console.log(JSON.stringify(scenarios.map(([scenarioName, scenario], index) => ({
  sampleNumber: index + 1,
  scenarioName,
  inputHash: createHash("sha256").update(JSON.stringify(scenario)).digest("hex"),
}))))
