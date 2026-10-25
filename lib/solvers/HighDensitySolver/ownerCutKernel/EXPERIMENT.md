# Owner activation and geometric cuts experiment

The ordinary local Pipeline9 high-density A01 slot uses this candidate for
unscaled two-physical-layer nodes with both layers available, at most 2,048
states, 32 ports, eight connection owners, and via diameter at most 1 mm.
Other domains keep their existing candidate selection. The regular factory
enables this policy with its existing local `priorityDagSearch` context;
projected network requests leave that context disabled. The external A01
package and remote request protocol are unchanged. The owned MIT-attributed
kernel retains A01 occupancy, route conversion and rip/requeue rules.

Each connection query freezes committed copper, history prices and ports.
A finite Boolean master selects which existing connection owners may be
removed. A complete graph reachability oracle learns a boundary cut:

`OR over outgoing boundary edges e: AND over required owners o of e: x[o]`.

Parallel alternatives remain separate. A timeout, memory limit, invalid
physical witness or incomplete oracle never generates a cut. Every query
discards all cuts and graph caches before occupancy or history changes.
A `no_path` result means complete disconnection of this particular frozen
restricted graph; it is not a completeness claim about continuous PCB routing.

Native fixed ports and opposite-diagonal crossing restrictions remain hard,
even when their owner is permitted. Per-edge continuous copper checks add
missing mutable route owners. Repair04 checks immutable board obstacles with
net ownership and the dedicated via-to-pad rule. Allowed vias span the full
two-layer physical stack. The real board outline and whole-path geometry are
checked again at acceptance. A graph witness can still fail new-route drill
spacing, exact terminal preservation or board DRC; that result is UNKNOWN.
A commit cannot displace an owner absent from its graph witness.

The objective intentionally changes: minimize distinct-owner activation fee,
then shortest additive distance inside the deterministically selected
minimum-fee permission set. Equal-fee permission sets use discovery order;
there is no global distance tie-break across sets. Native residual movement,
history and contact penalties are retained; exact copper-only contacts add
one trace/via contact penalty per additional owner on that edge. This is not
native weighted A*'s combined fee-plus-distance policy.

Memory limits are 2,048 graph states, 20,480 cached hops, 32 cuts, eight owner
bits and 256 master assignments per enumeration. Output/preparation rejects
more than 8,192 route points. Scans, heap/master work, geometry preparation,
commit/halo/rip work and physical acceptance have explicit charged allowances.
The portfolio gives sixteen charged work units per original expansion
allowance, capped at 32 million total units; fitness and adaptive expansion
use the same conversion. Each query is additionally capped at sixteen times
its native per-search allowance. This conversion is an experimental resource
policy, not a claim of equal CPU time. Counters report raw charged work.

Focused tests cover exhaustive owner subsets, conjunctive/parallel cuts,
complete disconnection, UNKNOWN limits, native cut activation, immutable port
and diagonal rules, full via span, same-net drills, fixed copper, dedicated
via-to-pad clearance, collapsed terminals, physical acceptance, and scheduled
local Pipeline9 activation. Captured-node and full-board timing belong to the
central benchmark panel; these tests establish no speedup claim.
