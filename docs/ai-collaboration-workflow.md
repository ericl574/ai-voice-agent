# AI Collaboration Workflow

This document describes how AI tools and humans collaborate to build and ship FrontDesk AI.

## Roles

### ChatGPT — Product Manager & QA Reviewer
ChatGPT acts as the product manager and QA reviewer. It defines product requirements, writes
feature specs, reviews pull requests for correctness and product fit, and signs off on
implementations before the founder approves a merge.

### Claude — Implementation Engineer
Claude acts as the implementation engineer. It reads issue specs, writes code, creates pull
requests, and responds to review feedback. Claude follows the guidelines in `CLAUDE.md` and
stays within the scope defined by each issue.

### Human Founder (Eric) — Decision Maker & Merge Approver
Eric owns the product vision and has final say on all merges. He reviews both the PR and
the QA sign-off before merging. Eric also approves any actions that carry risk (destructive
git operations, schema changes, new dependencies, model upgrades).

## Workflow

### 1. Spec via GitHub Issue
ChatGPT or Eric opens a GitHub Issue describing a feature, bug fix, or task. The issue
acts as the source of truth for what needs to be built.

### 2. Implementation via Claude
Claude is triggered on the issue (via `@claude` mention or GitHub Action). It reads the
issue, inspects the relevant code, implements the change on a feature branch, and opens
a pull request.

### 3. Review via Pull Request
The PR contains a summary of what changed and why. ChatGPT reviews it for product
correctness and edge cases. Claude responds to feedback and pushes fixes if needed.

### 4. Merge Approval by Eric
Once ChatGPT signs off, Eric reviews the final diff and merges the PR into `main`.
No merge happens without explicit human approval.

## Key Principles

- **AI writes, humans decide.** Claude and ChatGPT accelerate execution; Eric retains control.
- **Issues are specs.** All work traces back to a GitHub Issue with clear acceptance criteria.
- **PRs are the review surface.** All code changes go through a pull request — no direct
  commits to `main`.
- **Safety rules are non-negotiable.** Claude follows `CLAUDE.md` strictly: no secrets
  committed, no destructive operations without approval, no restaurant-only assumptions
  in shared code.

## Product-direction guardrails

The current direction is an **after-hours / missed-call capture** service whose main deliverable is
one daily report (`CLAUDE.md` → "Current MVP direction", `docs/product-scope.md`). Eric and ChatGPT
own product direction; Claude implements within it and must not drift back to superseded assumptions:

- **Don't revive dashboard-heavy / operations-cockpit assumptions.** The dashboard is secondary
  (settings / history / report archive), not a daily operations system.
- **Don't treat SMS as required.** Email report + CSV is primary; SMS is an optional short alert.
- **Don't block approved Twilio/Resend maintenance** because older docs once said "no SMS / no
  Twilio." Existing reporting integrations are approved and maintained within the MVP (see the
  updated `CLAUDE.md` safety rule on integrations).
- **Update docs in the same task when product architecture changes** — never leave docs (this file,
  `CLAUDE.md`, or anything in `docs/`) contradicting the current direction or the code.
