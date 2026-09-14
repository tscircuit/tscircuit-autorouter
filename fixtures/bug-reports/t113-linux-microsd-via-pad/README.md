# T113-S3 microSD via-to-pad clearance repro

This fixture is the Pipeline9 input dumped directly from phase 28 of the
96-component T113-S3 Linux board. It is the five-component microSD stage and
contains the 274 traces produced by the preceding successful stages.

Before the fix, the stage placed a through via 0.008 mm from the microSD CLK
pad even though the board requires 0.1 mm. The regression renders the original
unrouted PCB beside the fully routed stage and checks that the stage introduces
no DRC errors, including via-to-pad clearance.
