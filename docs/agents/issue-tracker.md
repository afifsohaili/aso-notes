# Issue tracker: Local Markdown (`plans/`)

Specs and implementation tickets for this repo live as markdown files in `plans/`.

## Conventions

- One feature per directory: `plans/<NNN>-<feature-slug>/`, numbered from `001`
- The spec is `plans/<NNN>-<feature-slug>/spec.md`
- Implementation tickets are one file each at `plans/<NNN>-<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is a `**Status:**` line near the top of the file (values per `triage-labels.md`, e.g. `ready-for-agent`, `done`)
- Blocking edges are a `**Blocked by:**` line near the top of a ticket
- Implementation notes and divergences append under a `## Implementation notes / divergences` heading

## When a skill says "publish to the issue tracker"

Create the file under `plans/<NNN>-<feature-slug>/` (new directory with the next number for a new feature).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path directly.
