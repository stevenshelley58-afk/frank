# Two-backup retention

Owner request: 14 September 2026. Retain the newest two **complete, checksum-verified** recovery sets per declared system, not two files across the whole server.

`retain-two.py` is the owner of local backup count retention. `install.sh` installs only committed source and enables an hourly systemd timer. Run without `--apply` for a read-only plan. `--series product` and `--series customer-crm` are called after the corresponding producer has atomically published its backup; the hourly timer also covers manual owner CRM/marketing sets.

The allowlist covers encrypted Blockwise product, encrypted customer CRM, owner CRM, owner marketing/ntfy, Frank full-state, central Hermes, recognized historical Blockwise research/product/Hermes sets, and standalone kids-router JSON recovery copies. Fewer than two existing sets are kept as-is; the pruner does not create a replacement or claim they were freshly restore-tested. Unknown named snapshots, credentials, escrow files, partial sets and malformed manifests are retained, not guessed into a series. These exceptions mean the total number of folders can exceed two. A new backup producer must register its complete-set contract here before its data can be pruned.

Guards: checksum manifest paths must stay inside an ordinary directory; symlinks are rejected; expected members must exist; encrypted sets must decrypt successfully; newer sets must cover the old set; active container mounts and process file handles protect their data; the two retained sets and deletion target must not change between validation and removal. A process merely having `/srv` as its current directory does not pin every backup. A single-instance lock prevents concurrent pruning. Producer partial directories are never selected. No database, key, published template or live volume is deleted.

Tests: `python3 test_retention.py`. Installation: from committed source, `bash install.sh`; then inspect `systemctl status vps-backup-retention.timer` and the actual service journal. The ordinary timer is silent on success in the app; systemd records errors. This is server-side housekeeping, not an AI reminder.

Backup integrity and restoration are different: checksum/decryption validates retained bytes, not a full application recovery. Product backups additionally have their existing isolated database/storage restore verifier. Preserve the last full Frank recovery set until a second complete successor exists; never manufacture a backup success claim.
