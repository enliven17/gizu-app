# Gizu documentation

Documentation is organized by complexity, intended reader and purpose.

| Folder                                   | Complexity        | Expected depth                                                                                            |
| ---------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| [App guide](app-guide/README.md)         | **1 — Simple**    | Practical setup and operating steps, brief explanations and expected results.                             |
| [Internal](internal/README.md)           | **2 — Technical** | How the system works, debugging, implementation boundaries and verification evidence.                     |
| [Feature plans](feature-plans/README.md) | **3 — Detailed**  | Deep technical designs, contracts, alternatives, tradeoffs, implementation steps and acceptance criteria. |

Shared documentation diagrams and image assets live in [images/](images/README.md).

## Where a document belongs

- **How do I run, configure or distribute it?** → `app-guide/`
- **How does it work internally, or why did it fail?** → `internal/`
- **What should we build or change, and how will we validate it?** → `feature-plans/`

Use technical depth and required background to judge complexity, not word count.
When a document mixes levels, keep the simple procedure in `app-guide/` and link
to deeper explanations in `internal/` or detailed designs in `feature-plans/`.
Highly detailed existing designs can also live in `feature-plans/`; label them as
implemented or reference material so placement does not imply pending work.

Keep one canonical document for each topic and link across categories rather than
copying content. Add feature subfolders when needed, such as `internal/swap/` or
`feature-plans/swap/`.

Folder names describe audience and purpose, not access controls. Never store
credentials, private keys, wallet backups or unredacted sensitive logs here.

## Migration status

- Setup, deployment, signing and passkey configuration guides are in
  [App guide](app-guide/README.md).
- Debugging and implementation references are in [Internal](internal/README.md).
- Technical plans and supporting parity reference are in
  [Feature plans](feature-plans/README.md).
- Research documents remain under `research/`; indexes link to relevant evidence.
- Project/module READMEs and agent instructions remain alongside their code.

The migration changes organization, not document freshness. Review dated claims
against current source and services before relying on them.
