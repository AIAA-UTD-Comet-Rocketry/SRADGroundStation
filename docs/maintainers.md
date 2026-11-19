# Maintainers, workflow and handoff

How changes get into this repo, who can change its settings, and what to do when the people
maintaining it graduate. Some of this is a proposal: items marked **TODO** are not set up yet.

## Who owns the repo

The repo belongs to the club's GitHub organization (`AIAA-UTD-Comet-Rocketry`), not to any
student's personal account. People leaving does not take the repo, its history or its settings
with them.

| Level | Can do |
|---|---|
| Organization owner | Everything in the org: all repos, members, can make anyone a repo admin |
| Repo admin | This repo's settings: rulesets, collaborators, renaming or deleting the repo |
| Write | Push branches, open and merge pull requests (within the rules on `main`) |

Current leads: _fill in names / GitHub handles here and update each year._

## How changes get in (GitHub Flow)

`main` is always launch-ready: it is what the Pi runs. All work happens on a branch and comes in
through a pull request.

```bash
git switch main && git pull            # start from the latest main
git switch -c feat/short-description   # one branch per change
# ...edit, commit as often as you like...
git push -u origin feat/short-description
```

Then open a pull request on GitHub. CI (`.github/workflows/ci.yml`) runs automatically:

- `Backend tests (Python 3.11)`
- `Backend tests (Python 3.13)`
- `Frontend type-check + build`

Merge when they are green, then delete the branch. If something goes wrong after merging, revert
that one merge commit.

Branch name prefixes: `feat/` new feature, `fix/` bug fix, `docs/` documentation, `ci/` build and
test tooling, `chore/` cleanup.

To get merged changes onto the Pi: `git pull`, then `cd frontend && npm run build`, then restart
the ground station.

## Protecting `main` (TODO)

Not enabled yet. A repo admin sets it up under **Settings → Rules → Rulesets → New branch ruleset**:

- Name `protect main`, enforcement **Active**, target **Include default branch**.
- Restrict deletions.
- Block force pushes.
- Require a pull request before merging, with **0** required approvals while one person does most
  of the work (GitHub does not let you approve your own PR). Raise it to 1 once there is a team.
- Require status checks to pass: add the three CI jobs listed above.
- Leave the bypass list empty so the rules apply to admins too.

After this, pushing straight to `main` is rejected and a PR cannot merge while CI is red.

## Handing off when people graduate

The rules and history stay with the repo. What needs care is the people:

1. **Always keep at least 2 organization owners who are current students.** If every owner
   leaves, nobody can promote new admins. A faculty advisor as a permanent owner is a good
   safety net. Ask whoever runs the club's GitHub to add incoming owners before outgoing ones leave.
2. **Before you graduate, promote your replacement**: repo **Settings → Collaborators and teams**,
   set their role to Admin (or add them to the leads team, below). Update "Current leads" above.
3. **Use teams instead of individual people (TODO).** For example `ground-station` (Write) and
   `ground-station-leads` (Admin), given access to this repo. Each year only team membership
   changes; repo settings never need touching.
4. **CODEOWNERS (TODO, once there is a team).** A `.github/CODEOWNERS` file can request review
   from `ground-station-leads` on every pull request automatically.
5. Pass on anything that is not in the repo: Pi login details (never commit these), the hardware
   and where it is stored, and which config the launch uses.
