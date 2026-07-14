const BENCHMARK_DATASETS = [
  { name: "dataset01", label: "Default benchmark" },
  { name: "srj18", label: "srj18" },
  { name: "srj19", label: "srj19" },
  { name: "srj20", label: "srj20" },
  { name: "srj21", label: "srj21" },
  { name: "srj23", label: "srj23" },
]

const splitShellArgs = (input) => {
  const args = []
  let current = ""
  let quote = null
  let escaping = false
  let tokenStarted = false

  const pushCurrent = () => {
    if (!tokenStarted) return
    args.push(current)
    current = ""
    tokenStarted = false
  }

  for (const char of input) {
    if (escaping) {
      if (quote === '"' && char === "\n") {
        escaping = false
        continue
      }
      if (quote === '"' && !['"', "\\", "$", "`"].includes(char)) {
        current += "\\"
      }
      current += char
      tokenStarted = true
      escaping = false
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
      tokenStarted = true
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = null
      else if (char === "\\") escaping = true
      else current += char
      tokenStarted = true
      continue
    }
    if (/\s/.test(char)) {
      pushCurrent()
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      tokenStarted = true
      continue
    }
    if (char === "\\") {
      escaping = true
      tokenStarted = true
      continue
    }
    current += char
    tokenStarted = true
  }
  if (escaping) current += "\\"
  if (quote !== null) throw new Error("Unterminated quote in /benchmark command")
  pushCurrent()
  return args
}

const removeDatasetArgs = (args) => {
  const sanitized = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dataset") {
      const datasetValue = args[index + 1]
      if (!datasetValue || datasetValue.startsWith("-")) {
        throw new Error("`--dataset` requires a dataset value")
      }
      index += 1
      continue
    }
    if (args[index] === "--dataset=") {
      throw new Error("`--dataset` requires a dataset value")
    }
    if (args[index].startsWith("--dataset=")) continue
    sanitized.push(args[index])
  }
  return sanitized
}

const parseBenchmarkCommand = (commentBody) => {
  const commandPattern = /^\/benchmark(?:\s|$)/
  if (!commandPattern.test(commentBody)) return null

  const commandArgsText = commentBody.replace(/^\/benchmark\b/, "").trim()
  const commandArgs = splitShellArgs(commandArgsText)
  return removeDatasetArgs(commandArgs)
}

const rejectCommand = async ({ github, context, message }) => {
  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
    body: `## Benchmark command rejected\n\n${message}`,
  })
}

const dispatchBenchmarkWorkflows = async ({ github, context, core }) => {
  const commentBody = context.payload.comment.body.trim()
  let commandArgs
  try {
    commandArgs = parseBenchmarkCommand(commentBody)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to parse the benchmark command"
    await rejectCommand({ github, context, message })
    throw error
  }
  if (commandArgs === null) return

  const pr = await github.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.issue.number,
  })
  const ref = pr.data.head.sha
  const workflowRef = context.payload.repository.default_branch
  const workflowsUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/workflows/benchmark.yml`
  const failedDatasets = []

  for (const dataset of BENCHMARK_DATASETS) {
    let statusCommentId = null
    try {
      const statusComment = await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: `## ${dataset.label}\n\nQueued on \`${ref.slice(0, 7)}\`.\n\nWorkflow: [View benchmark workflows](${workflowsUrl})`,
      })
      statusCommentId = statusComment.data.id
      await github.rest.actions.createWorkflowDispatch({
        owner: context.repo.owner,
        repo: context.repo.repo,
        workflow_id: "benchmark.yml",
        ref: workflowRef,
        inputs: {
          benchmark_args_json: JSON.stringify(commandArgs),
          dataset_name: dataset.name,
          ref,
          pr_number: String(context.issue.number),
          status_comment_id: String(statusCommentId),
        },
      })
    } catch {
      failedDatasets.push(dataset.label)
      if (statusCommentId !== null) {
        try {
          await github.rest.issues.updateComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            comment_id: statusCommentId,
            body: `## ${dataset.label}\n\nThe benchmark workflow could not be dispatched.\n\nWorkflow: [View benchmark workflows](${workflowsUrl})`,
          })
        } catch {
          core.warning(`Could not update the failed ${dataset.label} dispatch comment`)
        }
      }
    }
  }

  if (failedDatasets.length > 0) {
    throw new Error(
      `Failed to dispatch benchmark workflows for: ${failedDatasets.join(", ")}`,
    )
  }
}

module.exports = {
  BENCHMARK_DATASETS,
  dispatchBenchmarkWorkflows,
  parseBenchmarkCommand,
}
