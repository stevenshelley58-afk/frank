# Project knowledge generation

Frank uses Hindsight for durable project memory and FSoft CodeWiki for a
source-grounded application wiki. CodeWiki is a pinned MIT-licensed batch CLI;
it is not another web application, database, agent runtime, or Docker stack.

The generator reads a clean clone of the current committed project revision and
writes rebuildable Markdown and Mermaid artifacts beneath
`/srv/frank/data/window/knowledge/<slug>`. Frank reads those files through its
existing `/data` mount. The canonical `/projects/<slug>` checkout is never
modified, including when its working tree is dirty.

Install the pinned generator from the committed Frank checkout:

```bash
cd /projects/frank
bash apps/window/infra/knowledge/deploy.sh
```

Generate or refresh one project wiki:

```bash
frank-project-wiki blockwise
```

The command runs natively on the VPS and uses the existing Codex CLI
subscription. It never requires a local Docker runtime.

## Mini Frank staged project seed

`project-seeds/mini-frank` is the reviewed bootstrap for the ordinary
`/projects/mini-frank` Hermes project. It contains versioned Markdown knowledge,
source manifests, schemas, an external-repository candidate, and retrieval
fixtures. `mini_frank_knowledge.py` validates and compiles it into the existing
project knowledge artifact root. It adds no runtime, database, memory provider,
model client, scheduler, or public endpoint.
