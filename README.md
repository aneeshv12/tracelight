# tracelight

**See everything your Claude Code agent actually did.**

Your AI coding sessions are quietly saved to your laptop and never looked at again. tracelight turns that hidden history into a beautiful, searchable timeline you can actually read — every prompt, every thought, every tool call, every file edit, and exactly what it all cost.

One command. Runs on your machine. Nothing leaves it.

```bash
npx tracelight
```

<!-- Screenshot/GIF placeholders — record these and commit to docs/ before publishing. Run `node dist/cli.js` to open the app for capture. -->
![tracelight trace view](docs/trace-view.gif)
<!-- docs/trace-view.gif: a screen capture of the trace view scrolling through a real session with tool calls and a diff visible -->

---

## Why you'll want it

Every time you use Claude Code, a complete recording of the session is written to a hidden folder on your machine. It's a goldmine — and it's unreadable, buried in raw log files nobody opens.

tracelight is the missing viewer. Type one command and your whole agent history opens in your browser, rendered the way it should have been all along.

- **Relive any session** as a clean, top-to-bottom timeline instead of a wall of JSON.
- **Open the black box.** Expand the agent's hidden reasoning, every tool call, and every command it ran.
- **Read file edits as real diffs** — green for added, red for removed — not escaped JSON blobs.
- **Follow the agent's helpers.** When it spins up sub-agents, their work nests right under the call that launched them.
- **Know what it cost.** Per-session token and dollar breakdowns, your priciest and longest turns, and which tools you lean on most.
- **Find anything instantly** with full-text search across messages, reasoning, and tool activity.

## Private by design. Free to run.

No account. No API key. No upload. tracelight reads the files already on your disk and serves a local page in your browser — nothing is ever sent to a server, and there's no usage cost beyond your own laptop. Your conversations stay yours.

## Get started in 30 seconds

```bash
npx tracelight
```

That's it. tracelight finds your sessions, starts a local server, and opens your browser automatically.

```bash
npx tracelight --port 4000   # pick a specific port
npx tracelight --no-open     # start without opening the browser
```

Requires Node 18+. (Works with the standard Claude Code session folder at `~/.claude/projects/`.)

## What's inside

**The session list.** Every project and session, newest first, each with at-a-glance chips: when it ran, how long it took, turns, tokens, and the models involved.

**The trace.** The main event — one session as a vertical timeline:

- Your messages, the agent's replies, and its (normally hidden) thinking, in the exact order they happened. Reasoning is tucked behind a toggle so it never overwhelms the view.
- Tool calls as tidy cards: the tool, its pretty-printed input, and the result — long outputs collapsed with a one-click expand.
- File edits rendered as proper colored diffs instead of raw JSON.
- Sub-agent runs nested, indented, and collapsible under the call that spawned them.
- Routine scaffolding dimmed and folded away so the real story stands out.

**Search.** A live filter across messages, reasoning, tool names, inputs, and results — with a running "showing X of Y turns" count.

**Analytics.** Flip to the analytics tab for cost-by-model, a full token breakdown, your most-used tools, and your longest and most expensive turns.

> **About the cost numbers:** dollar figures are estimates from a built-in pricing table (current as of 2026-06-13). Check [anthropic.com/pricing](https://www.anthropic.com/pricing) for exact current rates, and note that models tracelight doesn't recognize show token counts without a cost estimate.

## Built to keep working

The Claude Code log format is undocumented and changes between versions. tracelight is built defensively: anything it doesn't recognize shows up as a clearly-marked block instead of crashing or silently vanishing — so your sessions stay readable even as the format evolves.

## For developers

Want to hack on it?

```bash
git clone https://github.com/aneeshv12/tracelight
cd tracelight
npm install
```

Run the UI with hot reload and the API server side by side:

```bash
npm run dev:ui                      # Vite dev server (UI)
npm run build:server && npm start   # compile + run the API server
```

Handy commands:

```bash
npm run build        # compile the server + build the UI bundle
npm test             # parser test suite (vitest)
npm run typecheck    # type-check server and UI
```

**Architecture.** A strict two-layer design: `src/parser/` is the only code that understands the raw transcript format — it normalizes each line into a stable internal model. The server and UI consume only that model (via shared JSON types in `src/apiTypes.ts`) and never touch the parser. When the log format shifts, only the parser changes. That's also what makes "support other agent frameworks" a feature rather than a rewrite.

## License

MIT
