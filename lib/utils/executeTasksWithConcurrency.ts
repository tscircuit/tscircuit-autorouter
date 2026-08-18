/**
 * Executes independent tasks with a fixed concurrency limit while preserving
 * input order in the returned results.
 */
export async function executeTasksWithConcurrency<Task, Result>(
  tasks: Task[],
  concurrency: number,
  execute: (task: Task) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(tasks.length)
  let nextTaskIndex = 0

  const runNextTasks = async (): Promise<void> => {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex
      nextTaskIndex += 1
      results[taskIndex] = await execute(tasks[taskIndex]!)
    }
  }

  const workerCount = Math.min(concurrency, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, () => runNextTasks()))
  return results
}
