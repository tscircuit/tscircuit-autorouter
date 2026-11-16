import { createHash } from "node:crypto"

const sha = (value) => createHash("sha256").update(value).digest("hex")

/** A joint diagnostic hypothesis; neither individual change has qualified. */
export function applyCombinedCandidate(source, { experiment, regions }) {
  if (!experiment.frozen) throw new Error("Combined candidate is not frozen")
  const inputSha256 = sha(source)
  if (inputSha256 !== experiment.originalCoreSha256)
    throw new Error("Expected exact published Core input")
  if (sha(JSON.stringify(regions) + "\n") !== experiment.regionsSha256)
    throw new Error("Unexpected engine-derived function regions")
  const changes = []
  for (const region of regions) {
    const start = source.indexOf(region.start)
    const end = source.indexOf(region.end, start + region.start.length)
    if (start < 0 || end < 0 || source.indexOf(region.start, start + 1) !== -1)
      throw new Error(`Nonunique combined candidate region: ${region.start}`)
    const current = source.slice(start, end)
    if (current !== region.before || sha(current) !== region.beforeSha256)
      throw new Error(`Published function preimage differs: ${region.start}`)
    if (sha(region.after) !== region.afterSha256)
      throw new Error(`Candidate function differs: ${region.start}`)
    source = source.slice(0, start) + region.after + source.slice(end)
    changes.push({ start: region.start, beforeSha256: region.beforeSha256,
      afterSha256: region.afterSha256, changes: region.changes })
  }
  const outputSha256 = sha(source)
  if (outputSha256 !== experiment.candidateCoreSha256)
    throw new Error("Combined output differs from the frozen candidate")
  return { source, proof: {
    inputSha256, outputSha256, changes,
    hypothesis: "intermediate-via-pour antipads plus existing pad-edge retry enumeration",
    changesCombined: 2,
    individualBenefitAttribution: false,
    busObserverAdded: false,
    rulesAndBudgetsChanged: false,
  } }
}
