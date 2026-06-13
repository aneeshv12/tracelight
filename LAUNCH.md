# Launch post drafts

Two variants below: a Show HN post and a short social version. Both describe only features that exist.

---

## Show HN: tracelight — local web viewer for Claude Code session transcripts

**Title:** Show HN: tracelight – browse your Claude Code session history as interactive traces (npx, local-only)

Every time you use Claude Code, it writes a JSONL file to `~/.claude/projects/`. After a few weeks of real work you have a goldmine of session history — every tool call, every file edit, every thinking block, every subagent spawn — sitting unread on your disk. There's no good way to explore it.

tracelight is a small Node CLI that reads those files and serves a local web UI. The home view lists your projects and sessions with summary chips (date, duration, turn count, tokens, estimated cost). The trace view renders each session as a vertical timeline: user and assistant turns in order, thinking blocks collapsed behind a toggle, tool calls as cards with pretty-printed input and truncated results, file edits (Edit/Write/MultiEdit) as colored line diffs, and nested subagent mini-timelines that expand inline under the spawning Agent call. There's also a per-session analytics panel with cost-by-model estimates, token breakdowns, tool-call frequency, and the longest and most expensive turns.

Everything runs locally. Nothing leaves your machine. There's no API key and no per-use cost. Cost figures are estimates from a hand-maintained pricing table (verified as of 2026-06-13 against Anthropic's public prices — check anthropic.com/pricing for current rates). The transcript format is undocumented, so the parser is written defensively: unrecognized line types surface in the UI rather than silently dropping.

```
npx tracelight
```

Source: https://github.com/aneeshv12/tracelight

---

## Short social/X version (under 280 characters)

Your Claude Code sessions are logged as JSONL in ~/.claude/projects/ — and go almost entirely unread. tracelight turns them into a local web UI: traces, diffs, subagent timelines, cost estimates. Nothing leaves your machine.

npx tracelight
