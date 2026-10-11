# Completion-only goal-ball experiment

The `goal-balls` option now retains the native indexed parent search. It allocates
the heuristic graph and prepares its four landmarks and net goal balls only near
the original iteration cap, when native final acceptance can authorize the
cost-aware attempt. Saved-solution acceptance, disabled completion, empty routes,
and ordinary-greedy-only completion skip that preparation.

This remains experimental. The accepted benchmark policy is `indexed`; these
functional checks do not establish a performance improvement.

Samples001 and016 match indexed parent output, PF statistics, and route iteration
counts exactly, without a goal-ball graph or preparation jobs. Sample016 also
passes the full downstream check: 59 connected nets, 273 covered pairs, 269 traces,
zero DRC errors, and no more than 389 odd-angle lint issues.

On sample006, the parent state, committed segments, and statistics are identical
to indexed routing immediately before completion at its original 2,000,000-step
cap. With the same input and original 4,000,000-step completion cap:

| Cost-aware completion | Iterations | Rerips | Result |
| --- | ---: | ---: | --- |
| Native indexed | 3,683,422 | 5 | Solved |
| Goal-ball and ALT bounds | 2,774,950 | 6 | Exhausted the remaining six-rip budget |

The native ordinary greedy attempt then succeeds in 5,669 iterations, within its
unchanged 50,000-step cap. Its graph congestion is substantially higher:
maximum region cost 27,467.63 versus 19.60 for the successful native cost-aware
completion. A full local functional solve has 255 traces, 265 vias, zero DRC errors,
and all 66 nets/255 pairs connected, but 1,247 odd-angle issues versus 932 in the
frozen baseline. Consequently the completion-only goal-ball policy fails the
current quality acceptance requirement for sample006.

Sample006 has no initial assignments. A separate inheritance discrepancy remains
in this experiment for preloaded inputs: its enhanced child inherits indexed
initial-assignment preservation, while the original cost-aware child inherits
the selective-rerip policy. That discrepancy does not explain the sample006
failure and is not changed by this policy revision.
