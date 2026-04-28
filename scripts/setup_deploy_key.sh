#!/usr/bin/env bash
set -euo pipefail

KEY_PATH="${FRANK_DEPLOY_KEY_PATH:-$HOME/.ssh/frank_hub_deploy}"
KEY_COMMENT="${FRANK_DEPLOY_KEY_COMMENT:-frank-hub-vps read-only deploy key for stevenshelley58-afk/frank}"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

if [ ! -f "$KEY_PATH" ]; then
  ssh-keygen -t ed25519 -C "$KEY_COMMENT" -f "$KEY_PATH" -N ""
else
  echo "Deploy key already exists at $KEY_PATH"
fi

chmod 600 "$KEY_PATH"
chmod 644 "$KEY_PATH.pub"

if command -v ssh-keyscan >/dev/null 2>&1; then
  touch "$HOME/.ssh/known_hosts"
  ssh-keyscan github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
  sort -u "$HOME/.ssh/known_hosts" -o "$HOME/.ssh/known_hosts"
  chmod 644 "$HOME/.ssh/known_hosts"
fi

echo
echo "Add this public key to GitHub as a read-only deploy key:"
echo "Repository: stevenshelley58-afk/frank"
echo "Path: Settings -> Deploy keys -> Add deploy key"
echo "Allow write access: unchecked"
echo
cat "$KEY_PATH.pub"
echo
echo "After GitHub accepts the key, clone with:"
echo "GIT_SSH_COMMAND='ssh -i $KEY_PATH -o IdentitiesOnly=yes' git clone git@github.com:stevenshelley58-afk/frank.git ."
