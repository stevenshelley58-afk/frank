#!/usr/bin/env bash
set -euo pipefail
# Native Hermes deterministic script job, paused until this explicit activation.
cli=/home/hermes/.hermes/hermes-agent/venv/bin/hermes
script=/home/hermes/.hermes/scripts/owner-crm-contact-sync.py
$cli cron list | grep -Fq 'owner-crm-contact-sync' && { echo 'job already exists'; exit 2; }
$cli cron create '15m' --name owner-crm-contact-sync --script "$script" --no-agent --workdir /projects/frank
echo 'created native Hermes no-agent job; use hermes cron disable <id> to pause'
