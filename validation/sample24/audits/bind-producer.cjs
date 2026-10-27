const fs = require("node:fs")
const path = require("node:path")

module.exports = async ({ github, context, core }) => {
  const binding = JSON.parse(fs.readFileSync(path.join(__dirname, "producer-binding.json"), "utf8"))
  const rawRunId = process.env.PRODUCER_RUN_ID
  if (!/^\d+$/.test(rawRunId) || Number(rawRunId) !== binding.runId) {
    throw new Error("The audit requires the explicitly bound producer run")
  }
  const parameters = { owner: context.repo.owner, repo: context.repo.repo, run_id: binding.runId }
  const { data: run } = await github.rest.actions.getWorkflowRun(parameters)
  const repository = `${context.repo.owner}/${context.repo.repo}`
  if (run.status !== "completed" || run.event !== "workflow_dispatch" ||
      run.head_sha !== binding.transportCommit || run.head_branch !== binding.branch ||
      run.head_repository?.full_name !== repository) {
    throw new Error("Producer run status, source commit, branch or repository differs")
  }
  const { data: result } = await github.rest.actions.listWorkflowRunArtifacts({ ...parameters, per_page: 100 })
  const artifacts = binding.artifactNames.map((name) => {
    const matches = result.artifacts.filter((artifact) => artifact.name === name && !artifact.expired)
    if (matches.length !== 1 || matches[0].size_in_bytes <= 0 ||
        matches[0].workflow_run?.id !== binding.runId ||
        matches[0].workflow_run?.head_sha !== binding.transportCommit) {
      throw new Error(`Missing, ambiguous or mismatched producer artifact: ${name}`)
    }
    const item = matches[0]
    return { name, id: item.id, runId: binding.runId, headSha: binding.transportCommit, bytes: item.size_in_bytes, digest: item.digest }
  })
  const evidence = {
    scope: "EXACT_OWNED_PRODUCER_RUN_AND_ARTIFACT_BINDING_NOT_BOARD_COMPLETION",
    binding,
    runId: run.id,
    headSha: run.head_sha,
    status: run.status,
    event: run.event,
    headBranch: run.head_branch,
    repositoryFullName: repository,
    producerURL: run.html_url,
    producerTransportCommit: run.head_sha,
    producerConclusion: run.conclusion,
    artifacts,
  }
  fs.writeFileSync("producer-run-binding.json", JSON.stringify(evidence, null, 2) + "\n")
  core.setOutput("sha", run.head_sha)
  console.log(JSON.stringify(evidence))
}
