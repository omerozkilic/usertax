# 0013. No LLM in the core

- Status: Accepted
- Date: 2026-11-03

## Context

AI-written summaries are easy to add but are non-deterministic, need API keys and can state
things that are not true. usertax's value is numbers people can trust and reproduce.

## Decision

Measurement, diffing, attribution, budgets and rendering are deterministic and need no API key.
Given the same inputs, usertax produces the same report. An AI summary may be added later as an
optional plugin that consumes the JSON report; it is never a dependency of `@usertax/core`,
`@usertax/measure`, the CLI or the action, and its output is labelled as AI-generated.

## Consequences

- Runs on every PR at no cost and without secrets.
- Explanations are limited to what can be derived from data (lockfile, source maps, curated
  alternatives).

## Alternatives considered

- Built-in LLM summary: rejected for the reasons above.
