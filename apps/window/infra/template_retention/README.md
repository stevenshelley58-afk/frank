# Published template draft retention

Host storage maintenance only. No generation, provider calls or database writes.
After a published run is completed, accepted and unchanged for 24 hours, delete
only PNG/JPEG/WebP files and redundant `artifact.json` packages in old
iterations, comparison previews and reusable-test renders. Draft artifact
packages must contain exactly `assets` and `template`, never review/score fields. Keep the best iteration and its previews, every final/review package,
all checkpoint/review JSON history and scores, demo assets and references. Historical draft-image
links may return 404 intentionally; the JSON history and pruning receipts remain.

Read the active library and asset paths from live PostgreSQL and job status from
Hermes SQLite read-only. Any nonterminal generation blocks cleanup. Hash live
published assets and every retained source file before/after. Never select an
unpublished directory. Receipts list each removed file and its original hash.

Run `python3 test_retention.py`, then `python3 prune.py` for a dry run. Commit
before running `install.sh`; installation pins the exact source revision. The
hourly timer applies the same policy and keeps durable per-run receipts.
