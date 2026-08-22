# Mini Frank knowledge project seed

This directory is the reviewed, repository-backed bootstrap source for the
ordinary `/projects/mini-frank` Hermes project workspace. It is knowledge and
reusable build material only. It is not another Frank checkout, application,
runtime, API, database, memory provider, or skills tree.

At runtime, Hermes creates the project workspace in its existing `default`
profile. The seed is copied once into that workspace; the project copy then
becomes canonical. Hindsight retains project decisions and outcomes, while
these files remain the source of truth for durable knowledge.

Validate the seed locally:

```bash
python apps/window/infra/knowledge/mini_frank_knowledge.py validate \
  --source apps/window/infra/knowledge/project-seeds/mini-frank \
  --verify-local-sources
```

Compile and atomically publish derived files on the VPS after the project
workspace exists:

```bash
bash /projects/frank/apps/window/infra/knowledge/generate-mini-frank.sh
```

The command publishes to `/srv/frank/data/window/knowledge/mini-frank`.
Generated catalogs are disposable projections. Never edit them as knowledge.
