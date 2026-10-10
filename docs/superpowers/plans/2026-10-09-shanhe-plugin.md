# Shanhe CodexBar Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal CodexBar JavaScript provider for Shanhe usage monitoring.

**Architecture:** Use CodexBar's `defineProvider` manifest and browser-cookie session support. Request the server-rendered dashboard with `cookieSession`, parse the visible usage labels, and expose the cycle meter plus dashboard details.

**Tech Stack:** JavaScript, CodexBar provider runtime, Node.js syntax/fixture check.

---

### Task 1: Provider

- [x] Create `shanhe.js` with provider metadata, browser-cookie session handling, HTTP status handling, dashboard parsing, and usage mapping.

### Task 2: Fixture and docs

- [x] Add `fixtures/dashboard.html`, `check.mjs`, and `README.md` documenting browser sign-in and dashboard fields.

### Task 3: Verification

- [x] Run `node check.mjs` and inspect the final diff.

## Protocol note

The public Shanhe API documentation confirms Bearer authentication but does not expose a billing or usage endpoint. The dashboard's server-rendered HTML is the current source of truth; its labels may require parser updates if the vendor changes the page.
