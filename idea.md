# Candidate fixes

1. Make selective reripping avoid cramped-port crossings when a non-cramped
   alternative is available, rather than treating cramped traversals as free.
2. Bound or escalate repeated relaxed blocker searches so the same ownership
   conflict cannot consume the solve budget indefinitely.
3. Preserve the sample 6 selective-rerip regression test and add sample 14
   coverage for the chosen fix.
