import { runSample } from "./runSample"

await runSample({
  sample: Number(process.argv[2]),
  effort: Number(process.argv[3]),
  outFile: process.argv[4]!,
  detailed: process.env.SRJ18_DETAILED_PROFILE === "1",
})
