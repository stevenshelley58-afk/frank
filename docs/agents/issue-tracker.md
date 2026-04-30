# Issue Tracker

Frank uses GitHub Issues as the canonical tracker for PRDs, implementation
slices, triage, and follow-up work.

## GitHub CLI

Run `gh` commands from the repository root so the remote is inferred from
`origin`.

- Create an issue: `gh issue create --title "..." --body "..."`
- View an issue: `gh issue view <number> --comments`
- List issues: `gh issue list --state open`
- Comment on an issue: `gh issue comment <number> --body "..."`
- Add a label: `gh issue edit <number> --add-label "..."`
- Remove a label: `gh issue edit <number> --remove-label "..."`

Use heredocs or temporary editor flows for multi-line issue bodies. Do not put
secrets, tokens, private URLs, or production environment values into issues.

## Skill Publishing Rules

- PRDs from `to-prd` become GitHub Issues.
- Vertical slices from `to-issues` become independently implementable GitHub
  Issues.
- Triage output from `triage` updates labels and comments on GitHub Issues.
- Do not create issues automatically during planning unless the user explicitly
  asks for issue creation.
