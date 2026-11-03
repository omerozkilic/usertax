# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-03

## Context

usertax is built in milestones, partly with an AI coding assistant. Decisions such as the
security model or how base reports are found must survive between sessions and be
explainable to contributors and reviewers.

## Decision

Significant decisions are recorded as ADRs in `docs/adr/`, numbered sequentially, written in
English, in the format of [`template.md`](template.md). A pull request that changes a decision
updates or supersedes the relevant ADR in the same PR.

## Consequences

Decisions are reviewable in PRs and have a stable link. Writing an ADR costs a few minutes per
decision; trivial choices do not need one.

## Alternatives considered

- Decisions in issues or PR descriptions: hard to find later, not versioned with the code.
