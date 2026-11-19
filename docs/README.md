# Docs: start here

New to the ground station? Read these in order. Each one is short.

| # | Read this | When |
|---|---|---|
| 1 | [What it is and how it works](guide/how-it-works.md) | First. The big picture in plain English. |
| 2 | [Getting started](guide/getting-started.md) | Running it on your laptop, about 10 minutes. |
| 3 | [Working on it (with or without AI)](guide/working-with-ai.md) | Before you change anything. |
| 4 | [Launch day checklist](guide/launch-day.md) | Before and at a launch. |
| 5 | [Where things stand](roadmap.md) | What's done, what's blocked, what's next. |

## Reference (look things up when you need them)

| Doc | What's in it |
|---|---|
| [architecture.md](architecture.md) | How the pieces fit together, in more technical detail |
| [telemetry-schema.md](telemetry-schema.md) | Every telemetry field, the radio packet byte by byte, open questions for avionics |
| [hardware-inventory.md](hardware-inventory.md) | Radios, antennas, Pi, video parts and their status |
| [decisions.md](decisions.md) | Why things are built the way they are |
| [maintainers.md](maintainers.md) | GitHub workflow, who owns the repo, handing off when people graduate |
| [../AGENTS.md](../AGENTS.md) | The detailed briefing for AI coding agents. Dense, but also a good cheat sheet for humans. |

## Two kinds of docs

- **Guides** (`docs/guide/`) are for people. Short, plain English, step by step.
- **`AGENTS.md`** is for AI coding tools. It's the full rulebook and file map, so an agent
  starts with everything the last team knew instead of guessing.

Both live in the repo, so the knowledge stays with the club, not in someone's chat history.
When you change how something works, update the doc in the same pull request.
