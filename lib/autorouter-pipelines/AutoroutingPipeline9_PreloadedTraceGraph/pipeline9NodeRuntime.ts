// Loaded by URL only after Pipeline9 has detected a Bun/Node host. Keeping
// builtins in a separate package asset lets browser bundlers compile Pipeline9
// without resolving node:os or node:worker_threads.
export { availableParallelism } from "node:os"
export { Worker } from "node:worker_threads"
