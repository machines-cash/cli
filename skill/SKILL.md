---
name: machines-agent-skills
description: Use Machines MCP account actions for cards, balances, deposits, withdrawals, and safe card-detail reveal. Trigger when users ask to manage their Machines account or spend flows.
---

# Machines Agent Skills

Use the Machines MCP server at `https://mcp.machines.cash/mcp`.

## Defaults
- Prefer concise, end-user responses.
- For card lists, prefer `machines.user.cards.list`.
- For reads, prefer `machines.user.read` with end-user presentation.
- Never ask users for internal IDs when the tool can resolve them.

## Sensitive data
- Never print API keys, bearer tokens, or encrypted blobs.
- For full card details, use `machines.user.card_secrets.reveal` or `reveal_card_details`.
- Do not manually stitch secrets flows unless debugging.

## Common tasks
- Create card: `machines.user.write` (`group="cards"`, `method="POST"`, `path=""`).
- Update card limits/status: `machines.user.write` (`group="cards"`, `method="PATCH"`, `path="{cardId}"`).
- Balance: `machines.user.read` (`group="balances"`).
- Transactions: `machines.user.read` (`group="transactions"`).
- Scoped session mint (if needed): `machines.user.sessions.create`.

## Financial writes
- Include `idempotencyKey` for financial write groups.
- Surface short actionable errors; avoid internal route details.
