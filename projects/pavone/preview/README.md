# Pavone visualizer — preview skeleton

Self-contained static page (no deps, no backend, no secrets — safe for the
public preview lane). Placeholder shading via CSS darken; the photoreal AI
render replaces it in P1 (see `../BUILD_PLAN.md` §3).

Deploy per RULE 0 (from any machine with the files + vps access):

```bash
scp -r projects/pavone/preview vps:/tmp/pavone-preview
ssh vps '/srv/frank/infra/preview-deploy.sh pavone-visualizer /tmp/pavone-preview/'
# → https://preview.frank.fail/pavone-visualizer-v1/
```

Iterate in place with `--update`; bump versions for anything worth comparing.
