# Shanhe CodexBar Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal CodexBar JavaScript provider for Shanhe usage monitoring.

**Architecture:** Use CodexBar's `defineProvider` manifest, secure bearer API-key settings, and one HTTP usage request. Parse a small set of compatible numeric usage shapes and expose one primary usage meter.

**Tech Stack:** JavaScript, CodexBar provider runtime, Node.js syntax/fixture check.

---

### Task 1: Provider

- [x] Create `shanhe.js` with provider metadata, secure API key, configurable endpoint/path, HTTP status handling, JSON parsing, and usage mapping.

### Task 2: Fixture and docs

- [x] Add `fixtures/usage.json`, `check.mjs`, and `README.md` documenting installation and the provisional response contract.

### Task 3: Verification

- [ ] Run `node check.mjs` and inspect the final diff.
