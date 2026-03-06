# Machines CLI

Simple command-line interface for Machines cards, disposable cards, and MCP host setup.

## Quick start

Recommended default (install once globally):

```bash
npm i -g @machines-cash/cli
machines
machines login
machines home
```

One-off fallback (no global install):

```bash
npx machines-cash@latest
npx machines-cash@latest home
npx machines-cash@latest login
npx machines-cash@latest login --browser
npx machines-cash@latest login --browser --no-launch-browser
npx machines-cash@latest login --browser --no-home
npx machines-cash@latest logout
npx machines-cash@latest user create --name=john --lastname=doe --birth-date=1990-01-01 --country-of-issue=US --national-id=123456789 --email=john@example.com --line1="123 main st" --city="new york" --region=NY --postal-code=10001 --country-code=US --occupation=SELFEMP --annual-salary="50k-99k" --account-purpose=testing --expected-monthly-volume="under-$1k"
npx machines-cash@latest create user --name=john --lastname=doe --birth-date=1990-01-01 --country-of-issue=US --national-id=123456789 --email=john@example.com --line1="123 main st" --city="new york" --region=NY --postal-code=10001 --country-code=US --occupation=SELFEMP --annual-salary="50k-99k" --account-purpose=testing --expected-monthly-volume="under-$1k" --open --wait
npx machines-cash@latest user create --from-file ./kyc-user.json --open --wait
npx machines-cash@latest user create --payload '{"firstName":"john","lastName":"doe","birthDate":"1990-01-01","countryOfIssue":"US","nationalId":"123456789","email":"john@example.com","address":{"line1":"123 main st","city":"new york","region":"NY","postalCode":"10001","countryCode":"US"},"occupation":"SELFEMP","annualSalary":"50000-75000","accountPurpose":"testing","expectedMonthlyVolume":"0-1000"}'
npx machines-cash@latest user create --interactive
npx machines-cash@latest kyc questionnaire
npx machines-cash@latest kyc status
npx machines-cash@latest kyc open --no-launch-browser
npx machines-cash@latest kyc wait --interval-seconds 5 --timeout-seconds 900
npx machines-cash@latest card create --name "ads-bot" --limit 250 --frequency per30DayPeriod
npx machines-cash@latest card create --name "ads-bot" --reveal
npx machines-cash@latest card list
npx machines-cash@latest card reveal --last4 4242
npx machines-cash@latest card update --last4 4242 --name "ads-bot-v2"
npx machines-cash@latest card lock --last4 4242
npx machines-cash@latest card unlock --last4 4242
npx machines-cash@latest card limit set --last4 4242 --amount 500 --frequency per30DayPeriod
npx machines-cash@latest card delete --last4 4242
npx machines-cash@latest disposable create --amount-cents 5000 --auto-cancel-after-auth
npx machines-cash@latest mcp install --host codex
npx machines-cash@latest mcp auth login
npx machines-cash@latest doctor
npx machines-cash@latest completion zsh
```

Canonical package name:

```bash
npx @machines-cash/cli
npx @machines-cash/cli home
npx @machines-cash/cli login
npx @machines-cash/cli login --browser
npx @machines-cash/cli login --browser --no-launch-browser
npx @machines-cash/cli login --browser --no-home
npx @machines-cash/cli logout
npx @machines-cash/cli user create --name=john --lastname=doe --birth-date=1990-01-01 --country-of-issue=US --national-id=123456789 --email=john@example.com --line1="123 main st" --city="new york" --region=NY --postal-code=10001 --country-code=US --occupation=SELFEMP --annual-salary="50k-99k" --account-purpose=testing --expected-monthly-volume="under-$1k"
npx @machines-cash/cli create user --name=john --lastname=doe --birth-date=1990-01-01 --country-of-issue=US --national-id=123456789 --email=john@example.com --line1="123 main st" --city="new york" --region=NY --postal-code=10001 --country-code=US --occupation=SELFEMP --annual-salary="50k-99k" --account-purpose=testing --expected-monthly-volume="under-$1k" --open --wait
npx @machines-cash/cli user create --from-file ./kyc-user.json --open --wait
npx @machines-cash/cli user create --payload '{"firstName":"john","lastName":"doe","birthDate":"1990-01-01","countryOfIssue":"US","nationalId":"123456789","email":"john@example.com","address":{"line1":"123 main st","city":"new york","region":"NY","postalCode":"10001","countryCode":"US"},"occupation":"SELFEMP","annualSalary":"50000-75000","accountPurpose":"testing","expectedMonthlyVolume":"0-1000"}'
npx @machines-cash/cli user create --interactive
npx @machines-cash/cli kyc questionnaire
npx @machines-cash/cli kyc status
npx @machines-cash/cli kyc open --no-launch-browser
npx @machines-cash/cli kyc wait --interval-seconds 5 --timeout-seconds 900
npx @machines-cash/cli card create --name "ads-bot" --limit 250 --frequency per30DayPeriod
npx @machines-cash/cli card create --name "ads-bot" --reveal
npx @machines-cash/cli card list
npx @machines-cash/cli card reveal --last4 4242
npx @machines-cash/cli card update --last4 4242 --name "ads-bot-v2"
npx @machines-cash/cli card lock --last4 4242
npx @machines-cash/cli card unlock --last4 4242
npx @machines-cash/cli card limit set --last4 4242 --amount 500 --frequency per30DayPeriod
npx @machines-cash/cli card delete --last4 4242
npx @machines-cash/cli disposable create --amount-cents 5000 --auto-cancel-after-auth
npx @machines-cash/cli mcp install --host codex
npx @machines-cash/cli mcp auth login
npx @machines-cash/cli doctor
npx @machines-cash/cli completion bash
```

## Notes

- `machines` (no args) opens guided home on interactive terminals.
- after your first login, run `machines` or `machines home` to reopen the action menu.
- signed-in users stay in a focused KYC flow until verification is complete.
- Writes execute directly.
- `--json` returns machine-friendly output.
- `--non-interactive` disables prompts and fails on missing required args.
- `--yes` skips confirmations for destructive operations (for example, `card delete`).
- `--no-color` forces plain output.
- Financial writes auto-attach idempotency keys.
- User auth is saved at `~/.machines/cli/auth.json`.
- MCP auth is saved at `~/.machines/cli/mcp-auth.json`.
- `login` defaults to browser auth. Use `--no-launch-browser` when you want to open the URL manually.
- if you are already signed in, `login` reuses the saved auth and reopens home instead of forcing a new browser round-trip.
- after browser login on interactive terminals, CLI opens guided home automatically.
- pass `--no-home` to return directly to shell after login.
- Browser login opens the hosted web app handoff page (`https://app.machines.cash/auth/cli`) by default.
- Override hosted web app URL with `MACHINES_WEB_APP_URL`.
- `login --agent` keeps fully CLI-based signature auth for agents and automation.
- Login provisions full user API scopes by default (no scope flags required).
- Provider-token exchange remains available for embedded-app handoff (`--id-token` or `--access-token`).
- `user create` submits full KYC application in one command; `create user` is an alias for agent-friendly grammar.
- if required profile fields are missing and you are in an interactive terminal, `user create` now offers two paths and defaults to browser-first KYC.
- `user create --browser` opens the web KYC flow directly.
- direct `user create` still requires phone fields.
- `user create --interactive` and `kyc questionnaire` run a guided KYC wizard with numbered choices.
- Input normalization is automatic for common formats:
  - phone `+1 (415) 555-0100` -> `phoneCountryCode=1`, `phoneNumber=4155550100`
  - birth date `01/31/1990` -> `1990-01-31`
  - country codes `u.s.` -> `US`
  - salary/volume labels like `50k-99k` or `under $1k` are mapped to API-safe values
- `kyc status|open|wait` supports hosted verification handoff and polling until approval.
- Flags support both `--key value` and `--key=value`.
- Generate shell completion with `machines completion bash|zsh|fish`.

## Local dev API testing (recommended)

Use the repo wrapper so local tests always point to dev infrastructure and never overwrite your normal `~/.machines` auth.

```bash
cd /path/to/machines-cash-monorepo

# login against dev api + sandbox web handoff
npm run cli:dev -- login

# then run any CLI command the same way
npm run cli:dev -- user create --interactive
npm run cli:dev -- card list --json

# run the full one-line agent smoke against dev api
npm run cli:smoke:dev
```

Defaults used by `npm run cli:dev`:

- `MACHINES_API_URL=https://dev-api.machines.cash`
- `MACHINES_WEB_APP_URL=https://sandbox.machines.cash`
- `HOME=<repo>/.tmp/machines-cli-dev-home` (isolated auth/session files)

Useful overrides:

```bash
# do not auto-open browser during login
MACHINES_DEV_NO_BROWSER=1 npm run cli:dev -- login

# point to a different API/web pair
MACHINES_DEV_API_URL=https://dev-api.machines.cash \
MACHINES_DEV_WEB_APP_URL=https://sandbox.machines.cash \
npm run cli:dev -- doctor
```

`npm run cli:smoke:dev` covers the non-interactive agent-style surface:

- `login --agent`
- `user create` direct, `create user`, `--payload`, `--from-file`, `--browser`
- `kyc status`, `kyc open`
- full card lifecycle, including prefixed global flags like `--yes` and `--non-interactive`
- `disposable create`
- `completion`
- `mcp install`, `mcp doctor`

It intentionally skips the two human-browser flows:

- `machines login` / `machines login --browser` completion
- `machines mcp auth login`
