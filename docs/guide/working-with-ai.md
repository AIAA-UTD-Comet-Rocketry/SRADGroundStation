# Working on the ground station (with or without AI)

You're building on an existing system, not starting over. Most of what you need to know is
already written down. Here's how to use it.

## The workflow

1. `git switch main && git pull`
2. Make a branch named for your change: `git switch -c feat/what-youre-adding`
   (`fix/` for bugs, `docs/` for docs).
3. Make the change. Run the tests (`cd backend && .venv/bin/python -m pytest -q`) and the
   build (`cd frontend && npm run build`).
4. Push and open a pull request. Wait for the green checks, then merge.

Never commit straight to `main`: it's what flies. More in [maintainers.md](../maintainers.md).

## Coding with an AI agent (Claude Code, Codex, Cursor, Copilot...)

The repo has an **`AGENTS.md`** at the top level (and a `CLAUDE.md` that points to it). AI
tools read it automatically. It tells the agent the safety rules, where everything is, how to
run the tests and how to add things. You don't have to explain the project from scratch.

Tips:

- **Open the agent in the repo folder** so it finds `AGENTS.md`.
- **Ask it to explain before it changes.** "How does a packet get from the radio to the
  screen?" is a great first question.
- **Read the diff before you merge.** You're responsible for what lands in `main`, not the AI.
- **Make it update the docs.** When the change affects how something works, ask: "Update
  AGENTS.md and the docs for this." The next team only knows what's written down.
- **Write down the why.** If you decided something non-obvious (a packet format, a radio
  setting, a trade-off), add a line to [decisions.md](../decisions.md).
- **Never paste passwords or keys** into the chat or the code: not the Pi's login, not API keys.

## The rules that matter most

Short version of the list in `AGENTS.md`:

- The ground station **only listens**. Never add anything that sends commands to the rocket.
- **No hardcoded radio frequencies.**
- **Save before display**, and a disk error must never stop the data from showing.
- **Missing data is "NO DATA", never 0.**
- **It must work with no internet.** No online maps, fonts or scripts.
- The rocket decides its flight state, not the ground station.

## When you're stuck

- [How it works](how-it-works.md) for the big picture
- [architecture.md](../architecture.md) for the technical detail
- [telemetry-schema.md](../telemetry-schema.md) for anything about packets
- Ask the agent: "Read AGENTS.md and docs/, then tell me where X is handled."
