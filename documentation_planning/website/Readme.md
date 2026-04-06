# Website And Docs Planning

This directory plans the future public website and docs experience.

The target structure is:

- Homepage
- Docs
	- End-user docs
	- Admin docs
	- Developer docs

## Planning Rules

- Do not link to files in the `documentation` folder from these planning docs
- The files in `documentation` are development-era source material to be carried over into the future website and docs
- Plan the future information architecture and page relationships here, not direct links to legacy markdown files
- Keep homepage planning separate from docs planning, even when both draw from the same product capabilities

## Current Planning Files

- [Homepage_planning.md](./Homepage_planning.md): homepage messaging, section order, CTA strategy, and information architecture
- [Homepage_text_copy.md](./Homepage_text_copy.md): draft homepage copy derived from the homepage plan
- [EndUserDocs_planning.md](./EndUserDocs_planning.md): task-oriented end-user docs structure, terminology, and coverage planning

Admin docs and developer docs are part of the target site structure, but they do not yet have dedicated planning files in this folder.

## Why The Split Exists

These content areas serve different jobs.

- The homepage should explain value quickly and help visitors decide whether to evaluate Sambee.
- End-user docs should help people complete tasks, understand limitations, and solve problems.
- Admin docs should cover deployment, configuration, operations, and troubleshooting for administrators.
- Developer docs should cover architecture, extension points, and implementation-facing guidance for contributors.

Mixing these goals in one file tends to produce content that is too vague for docs and too detailed for the homepage.

## Source Material To Carry Forward

The future website and docs should still be grounded in the same real product capabilities:

- SMB share browsing
- Local drive access via the companion app
- Rich file preview support
- Markdown editing
- Native desktop editing
- Dual-pane and keyboard-driven workflows
- Mobile support
- Docker-based deployment

Relevant material already exists in development-era docs, but it should be migrated into the new homepage, end-user docs, admin docs, and developer docs instead of being linked directly from this planning area.
