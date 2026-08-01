# Hallmark — project skill

Anti-AI-slop design skill for pi sessions in this repo. Makes generated UIs
look made, not generated: 21 macrostructures, 20 themes, 58 slop-test gates,
and four verbs (`hallmark audit <target>` · `hallmark redesign <target>`
· `hallmark study <url|screenshot>` · default build flow).

## Provenance

- **Source:** https://github.com/Nutlope/hallmark (`skills/hallmark/`), v1.1.0
- **Licence:** MIT (see `LICENSE`)
- **Ported:** copied verbatim plus the repo's referenced assets
  (`site/css/tokens.css`, `site/examples/cobalt-01/`, `site/_tests/*`,
  `docs/recipes.md`, `docs/study-examples.md`) so the skill is fully
  self-contained.
- **Patched:** relative links that escaped the skill directory were rewritten
  to resolve inside `.pi/skills/hallmark/`; added `license` frontmatter.
  One upstream dead link (`docs/study-examples.md` → `study.md`) was fixed to
  point at `references/study.md`.

## Updating

Re-sync from upstream when the repo moves past v1.1.0:

```bash
git clone --depth 1 https://github.com/Nutlope/hallmark /tmp/hallmark
# re-apply: copy skills/hallmark/*, site/css/tokens.css, site/examples/cobalt-01/,
# the 8 site/_tests/* dirs, docs/recipes.md, docs/study-examples.md, LICENSE
# then re-run the link-patch table below (see commit history for the exact patch)
```

`npx skills add nutlope/hallmark` is the upstream installer; it copies to the
harness default skill locations. This port exists so the skill ships with the
repo and works with pi's project-skill discovery (`.pi/skills/`).
