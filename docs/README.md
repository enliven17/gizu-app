# Gizu documentation

Documentation is organized by its intended reader and purpose.

| Folder                                   | Audience                                            | Purpose                                                                                                |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Internal](internal/README.md)           | Engineers and maintainers investigating the system  | Debugging, implementation internals, incident findings and diagnostic evidence.                        |
| [Feature plans](feature-plans/README.md) | Engineers and technical reviewers designing changes | Detailed feature specifications, architecture decisions, implementation plans and acceptance criteria. |
| [App guide](app-guide/README.md)         | Developers, testers and operators running the app   | Setup, configuration, local development, devices, builds, releases and deployment.                     |

## Where a document belongs

- **How do I run, configure or distribute it?** → `app-guide/`
- **How does it work internally, or why did it fail?** → `internal/`
- **What should we build or change, and how will we validate it?** → `feature-plans/`

Keep one canonical document for each topic and link across categories rather than
copying content. Add feature subfolders when needed, such as `internal/swap/` or
`feature-plans/swap/`.

Folder names describe audience and purpose, not access controls. Never store
credentials, private keys, wallet backups or unredacted sensitive logs here.

## Migration status

- Setup, deployment, signing and passkey configuration guides are in
  [App guide](app-guide/README.md).
- Debugging and implementation references are in [Internal](internal/README.md).
- Technical plans, the mobile roadmap and supporting parity reference are in
  [Feature plans](feature-plans/README.md).
- Research documents remain under `research/`; indexes link to relevant evidence.
- Project/module READMEs and agent instructions remain alongside their code.

The migration changes organization, not document freshness. Review dated claims
against current source and services before relying on them.
