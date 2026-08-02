# Flows

A **flow** is what Steven calls a pipeline or graph — a `pipeline.v1` DAG plus
any campaign config that drives the pipeline runner
(`packages/pipeline-graph`, the `runCampaign`/`executePipeline` engine).

Drop one folder per flow here, each containing its `pipeline.json` (and
`campaign.json` when it's a multi-touch sequence). The Frank Console **Files**
module browses this directory read-only, so anything you add shows up
automatically — no registration step.

Layout convention:

```
flows/
  blockwise-cold-email/
    pipeline.json      # the touch DAG
    campaign.json      # fan-out / delays / reply-branching (optional)
    README.md          # what it does, who it targets
```
