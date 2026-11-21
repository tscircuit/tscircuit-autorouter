import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

export declare function renderGamepad(
  solve: (input: SimpleRouteJson) => SimplifiedPcbTrace[],
): Promise<Array<{ message: string }>>
