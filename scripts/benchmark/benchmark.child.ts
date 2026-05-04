#!/usr/bin/env bun

import * as readline from "node:readline"
import { runTask } from "./benchmark-run-task"
import type { WorkerResultMessage, WorkerTaskMessage } from "./benchmark-types"

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

for await (const line of rl) {
  const trimmed = line.trim()
  if (!trimmed) {
    continue
  }

  let message: WorkerTaskMessage
  try {
    message = JSON.parse(trimmed) as WorkerTaskMessage
  } catch (error) {
    console.error(
      `[benchmark-child] Failed to parse task message: ${error instanceof Error ? error.message : String(error)}`,
    )
    continue
  }

  try {
    const result = await runTask(message.task, {
      onProgress: (progress) => {
        const payload = {
          taskId: message.taskId,
          progress,
        }
        process.stdout.write(`${JSON.stringify(payload)}\n`)
      },
    })
    const payload: WorkerResultMessage = {
      taskId: message.taskId,
      result,
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  } catch (error) {
    const payload: WorkerResultMessage = {
      taskId: message.taskId,
      result: {
        solverName: message.task.solverName,
        scenarioName: message.task.scenarioName,
        sampleNumber: message.task.sampleNumber,
        elapsedTimeMs: 0,
        didSolve: false,
        didTimeout: false,
        relaxedDrcPassed: false,
        error: error instanceof Error ? error.message : String(error),
      },
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  }
}
