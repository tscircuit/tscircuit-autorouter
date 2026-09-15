# T113-S3 uniform distribution onto a foreign terminal

This fixture is the exact `UniformPortDistributionSolver` input captured from
the real 96-component T113-S3 Linux board.

On the captured input, port point `ce750_pp1_z0::0` starts at
`x=3.098215714285714`, but uniform distribution moves it to `x=4.2`. That is
the position of the foreign U1 terminal
`tiny-terminal:end-port:breakout:pcb_breakout_point_5`.

The file is deterministically gzip-compressed with `mtime=0`. The test reuses
the exact board Circuit JSON and Simple Route JSON from
`t113-linux-exact-pipeline9-root`.
