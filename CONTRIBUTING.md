# Contributing to Teleport

First — thank you. Whether you're fixing a typo, filing a bug report, or shipping a new feature, your help is genuinely appreciated.

## Quick rules

- **One PR = one concern.** Don't bundle a bugfix with a refactor with a new feature. We'll ask you to split it.
- **Tests are required** for any non-cosmetic change. Cosmetic = README, comments, formatting.
- **Be kind in reviews.** See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/teleport.git
cd teleport

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest                            # tests should pass before you start

# Frontend (in another terminal)
cd ../frontend
npm install
npm run lint                      # should be clean
npm run typecheck                 # should be clean
```

Run both at once: `docker compose -f deploy/docker-compose.dev.yml up`.

## Picking what to work on

- **First-time contributors:** look at issues tagged [`good-first-issue`](https://github.com/OWNER/teleport/issues?q=label%3Agood-first-issue).
- **Bigger ideas:** open an issue *before* writing code, so we can agree on the approach. We don't enjoy declining a finished PR.
- **Bugs you found:** file an issue with reproduction steps, then feel free to fix it yourself.

## Code style

### Frontend (TypeScript)

- ESLint + Next.js rules. `npm run lint` must pass.
- Strict TypeScript. No `any` unless you can explain why in a comment.
- Components are functional, hooks-based.
- Filenames: `PascalCase.tsx` for components, `useThing.ts` for hooks, `kebab-or-snake.ts` for utilities.

### Backend (Python)

- [Ruff](https://docs.astral.sh/ruff/) for linting + formatting (`ruff check && ruff format`).
- [mypy](https://www.mypy-lang.org/) strict mode (`mypy app/`).
- Full type hints on public APIs. FastAPI relies on them.
- Async by default. Don't introduce sync DB calls.

## Tests

### Backend

```bash
cd backend && pytest
```

Add tests in `backend/tests/`. We have:

- **Protocol tests** (`test_signaling_protocol.py`): two simulated WebSocket clients exchange offers/answers/ICE.
- **Lifecycle tests** (`test_room_lifecycle.py`): room creation, joining, TTL cleanup.

Cover any new behavior with at least one test. If you added a new message type, add a protocol test for it.

### Frontend

```bash
cd frontend && npm run typecheck && npm run lint
```

We don't currently have UI tests — that's an open area for contribution. If you want to add Playwright tests, please open an issue first so we can align on framework choice.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(frontend): add resumable file transfers
fix(backend): close stale WebSockets after TTL
docs(readme): clarify TURN setup
test(signaling): cover glare resolution
```

Scopes: `frontend`, `backend`, `deploy`, `docs`, `ci`.

## Pull requests

- Target the `main` branch.
- Fill out the PR template (it's short).
- Link the issue you're fixing: `Closes #42`.
- CI must be green before review.
- Expect 1–2 rounds of feedback. We're picky about API design and security; we're forgiving about everything else.

## What we will not merge

- Code that adds tracking, analytics, or telemetry of any kind.
- Code that adds a third-party CDN dependency to the frontend.
- Features that require user accounts. Teleport is anonymous on purpose.
- Breaking protocol changes without a migration plan.
- Crypto changes without an explicit security review request and at least one independent review.

## Questions?

Open a [discussion](https://github.com/OWNER/teleport/discussions) or drop into an issue. We answer.
