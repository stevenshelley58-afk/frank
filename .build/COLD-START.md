# Cold start — read this if you are a replacement agent

Read `.build/STATE.md` and `.build/DECISIONS.md`.
Find the first task with status READY whose dependencies are all DONE.
Read `.build/tasks/<ID>*.md`.
Claim it by setting IN_PROGRESS in STATE.md and committing that single line.
Do the work. Touch only the files that task lists as allowed.
Commit at every green checkpoint using the format in EXECUTION-PLAN.md section 1.
Finish by setting DONE (or BLOCKED with the reason in .build/tasks/<ID>*.md), commit, push.

Never force-push. Never touch an unclaimed task or another agent's branch.
Never leave uncommitted work.
