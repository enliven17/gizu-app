# Technical feature plans

**Audience:** engineers and technical reviewers planning implementation.

Use this folder for detailed feature specifications, technical improvements,
architecture decisions and migration plans.

A plan should explain:

1. The problem, intended user behavior and success criteria.
2. Current implementation and supporting evidence.
3. Scope and explicit exclusions.
4. Proposed architecture, contracts and platform responsibilities.
5. State transitions, errors, security and recovery where applicable.
6. Implementation steps, dependencies and rollout or migration needs.
7. Tests, acceptance criteria and open decisions.

Identify the owner when known, status (`draft`, `approved`, `in progress`,
`implemented` or `superseded`), and last review date. Link to implementation and
verification evidence when complete; a completed plan is not automatically a
current description of the system.

Debugging details belong in [Internal](../internal/README.md).
Instructions for running the delivered feature belong in
[App guide](../app-guide/README.md).

## Plans

| Document                                                         | Role                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Mobile roadmap](MOBILE_ROADMAP.md)                              | Dated implementation roadmap and remaining acceptance boundaries.  |
| [Shared iOS/Android portfolio](GIZU-1_IOS_MONAD_PORTFOLIO.md)    | GIZU-1 technical plan, implementation outcome and verification.    |
| [Signer migration](SIGNER_MIGRATION.md)                          | Historical stored-wallet migration phases and acceptance criteria. |
| [Analytics review](ANALYTICS_REVIEW.md)                          | Dated review, improvement plan and implementation status.          |
| [Confidential Earn plan](2026-09-30-confidential-earn-mobile.md) | Detailed mobile integration plan.                                  |
| [Product capabilities and parity](PARITY.md)                     | Supporting capability reference; not a future-work backlog.        |

Moving a document here does not reopen completed work or approve a proposal.
Check each document's date, implementation status and current code before planning
new work. Research documents remain under `research/`.
