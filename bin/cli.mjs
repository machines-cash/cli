#!/usr/bin/env node

import { createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { createInterface } from "node:readline/promises";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = process.env.MACHINES_API_URL?.trim() || "https://api.machines.cash";
const USER_API_BASE_URL = `${API_BASE_URL.replace(/\/$/, "")}/user/v1`;
const WEB_APP_BASE_URL_OVERRIDE = process.env.MACHINES_WEB_APP_URL?.trim() || "";
const WEB_APP_BASE_URL = WEB_APP_BASE_URL_OVERRIDE || "https://app.machines.cash";

const MCP_BASE_URL = process.env.MACHINES_MCP_URL?.trim() || "https://mcp.machines.cash";
const MCP_SERVER_URL = `${MCP_BASE_URL.replace(/\/$/, "")}/mcp`;
const MCP_CONNECT_CLIENT_ID = process.env.MACHINES_MCP_CONNECT_CLIENT_ID?.trim() || "cli_native";

const CLI_AUTH_DIR = path.join(os.homedir(), ".machines", "cli");
const CLI_AUTH_PATH = path.join(CLI_AUTH_DIR, "auth.json");
const MCP_AUTH_PATH = path.join(CLI_AUTH_DIR, "mcp-auth.json");
const SKILL_NAME = "machines-agent-skills";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillSourceDir = path.resolve(__dirname, "..", "skill");

const DEFAULT_USER_SCOPES = [
  "users.read",
  "users.write",
  "kyc.read",
  "kyc.write",
  "agreements.read",
  "agreements.write",
  "onboarding.read",
  "onboarding.write",
  "cards.read",
  "cards.write",
  "cards.secrets.read",
  "folders.read",
  "folders.write",
  "balances.read",
  "contracts.read",
  "contracts.write",
  "deposits.read",
  "deposits.write",
  "deposits-swapped.read",
  "deposits-swapped.write",
  "withdrawals.write",
  "transactions.read",
  "tokens.read",
  "encryption.read",
  "encryption.write",
  "identity.read",
  "identity.write",
  "payments.read",
  "payments.write",
  "subscriptions.read",
  "subscriptions.write",
  "notifications.read",
  "notifications.write",
  "referrals.read",
  "referrals.write",
  "bills.read",
  "bills.write",
  "support.read",
  "spotlight.read",
  "keys.read",
  "keys.write",
  "sessions.write",
];

const DEFAULT_USER_POLICY = {
  maxAuthAmountCents: 1_000_000_000,
  dailySpendCapCents: 1_000_000_000,
  dailyWithdrawalCapCents: 1_000_000_000,
};

const CARD_STATUS_ALIASES = new Map([
  ["active", "active"],
  ["locked", "locked"],
  ["canceled", "canceled"],
  ["cancelled", "canceled"],
  ["notactivated", "notActivated"],
  ["not_activated", "notActivated"],
  ["not-activated", "notActivated"],
]);

const CARD_LIMIT_FREQUENCIES = new Set([
  "per24HourPeriod",
  "per7DayPeriod",
  "per30DayPeriod",
  "perYearPeriod",
  "allTime",
  "perAuthorization",
]);

const KYC_ANNUAL_SALARY_INPUT_MAP = new Map([
  ["<40k", "0-40000"],
  ["0-40000", "0-40000"],
  ["50k-99k", "50000-75000"],
  ["50k99k", "50000-75000"],
  ["50000-75000", "50000-75000"],
  ["100k-149k", "100000-149000"],
  ["100k149k", "100000-149000"],
  ["100000-149000", "100000-149000"],
  ["150k+", "150000+"],
  ["150000+", "150000+"],
]);

const KYC_EXPECTED_MONTHLY_VOLUME_INPUT_MAP = new Map([
  ["under$1k", "0-1000"],
  ["under-$1k", "0-1000"],
  ["0-1000", "0-1000"],
  ["$1k-$5k", "1000-5000"],
  ["$1k$5k", "1000-5000"],
  ["1000-5000", "1000-5000"],
  ["$5k-$20k", "5000-20000"],
  ["$5k$20k", "5000-20000"],
  ["5000-20000", "5000-20000"],
  ["$20k+", "20000+"],
  ["20000+", "20000+"],
]);

const KYC_ANNUAL_SALARY_OPTIONS = [
  { label: "Under $40k", value: "0-40000" },
  { label: "$50k-$99k", value: "50000-75000" },
  { label: "$100k-$149k", value: "100000-149000" },
  { label: "$150k+", value: "150000+" },
];

const KYC_ACCOUNT_PURPOSE_OPTIONS = [
  { label: "Everyday spend", value: "everyday spend" },
  { label: "Subscriptions", value: "subscriptions" },
  { label: "Business expenses", value: "business expenses" },
  { label: "Testing", value: "testing" },
  { label: "Other", value: "other" },
];

const KYC_EXPECTED_MONTHLY_VOLUME_OPTIONS = [
  { label: "Under $1k", value: "0-1000" },
  { label: "$1k-$5k", value: "1000-5000" },
  { label: "$5k-$20k", value: "5000-20000" },
  { label: "$20k+", value: "20000+" },
];

const KYC_OCCUPATION_OPTIONS = [
  { label: "Self-Employed", value: "SELFEMP" },
  { label: "Software Developer", value: "15-1132" },
  { label: "General and Operations Managers", value: "11-1021" },
  { label: "Unemployed", value: "UNEMPLO" },
  { label: "Retired", value: "RETIRED" },
  { label: "Other", value: "OTHERXX" },
];

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const RUNTIME_FLAGS = {
  nonInteractive: false,
  yes: false,
  noColor: false,
  homeEnabled: true,
  interactiveTty: false,
};
const ARROW_SELECT_HINT = "use up/down arrows and enter";
let hasShownArrowSelectHint = false;

function getGlobalRuntimeFlags() {
  return { ...RUNTIME_FLAGS };
}

function printRootHelp() {
  console.log(`machines

Usage:
  machines                                                   # interactive home (TTY)
  machines home
  machines login --browser [--no-launch-browser] [--no-home]
  machines login --agent [--address <0x...>] [--private-key <0x...>]
  machines login                                                # defaults to browser flow
  machines logout
  machines user create --browser [--no-launch-browser]         # open browser-first kyc flow
  machines user create --name <value> --lastname <value> --birth-date <YYYY-MM-DD> --country-of-issue <US> --email <value> --line1 <value> --city <value> --region <value> --postal-code <value> --country-code <US> --phone-country-code <value> --phone-number <value> --occupation <value> --annual-salary <value> --account-purpose <value> --expected-monthly-volume <value>
  machines user create --interactive                           # cli questionnaire
  machines create user --name <value> --lastname <value> ...   # alias of user create
  machines kyc questionnaire [--no-launch-browser]
  machines kyc wizard [--no-launch-browser]
  machines kyc status
  machines kyc open [--no-launch-browser]
  machines kyc wait [--interval-seconds <value>] [--timeout-seconds <value>]
  machines card create [--name <value>] [--limit <usd>] [--frequency <value>]
  machines card list [--json]
  machines card reveal [--id <card_id> | --last4 <1234>] [--json]
  machines card update (--id <card_id> | --last4 <1234>) [--name <value>] [--status <value>] [--limit <usd>] [--frequency <value>] [--json]
  machines card lock (--id <card_id> | --last4 <1234>) [--json]
  machines card unlock (--id <card_id> | --last4 <1234>) [--json]
  machines card delete (--id <card_id> | --last4 <1234>) [--json]
  machines card limit set (--id <card_id> | --last4 <1234>) --amount <usd> [--frequency <value>] [--json]
  machines disposable create --amount-cents <value> [--auto-cancel-after-auth]
  machines mcp install --host codex|claude|copilot|chatgpt|all
  machines mcp auth login [--manual-key]
  machines mcp doctor
  machines doctor
  machines completion [bash|zsh|fish]

Common flags:
  --json    output machine-friendly JSON
  --non-interactive  disable prompts and fail on missing required args
  --yes    skip confirmations for destructive steps
  --no-color    plain output
  --help    show help`);
}

function printUserHelp() {
  console.log(`machines user

Usage:
  machines user create --browser [--no-launch-browser] [--json]
  machines user create --name <value> --lastname <value> --birth-date <YYYY-MM-DD> --country-of-issue <US> --email <value> --line1 <value> --city <value> --region <value> --postal-code <value> --country-code <US> --phone-country-code <value> --phone-number <value> --occupation <value> --annual-salary <value> --account-purpose <value> --expected-monthly-volume <value> [--national-id <value>] [--line2 <value>] [--country <value>] [--referral-code <value>] [--open] [--wait] [--json]
  machines user create --interactive [--open] [--wait] [--no-launch-browser] [--json]
  machines user create --from-file <path/to/user.json> [--open] [--wait] [--json]
  machines user create --payload '{"firstName":"john", ...}' [--open] [--wait] [--json]

Aliases:
  --name       same as --first-name
  --lastname   same as --last-name`);
}

function printKycHelp() {
  console.log(`machines kyc

Usage:
  machines kyc questionnaire [--open] [--wait] [--no-launch-browser] [--json]
  machines kyc wizard [--open] [--wait] [--no-launch-browser] [--json]
  machines kyc status [--json]
  machines kyc open [--no-launch-browser] [--json]
  machines kyc wait [--interval-seconds <value>] [--timeout-seconds <value>] [--json]`);
}

function printCardHelp() {
  console.log(`machines card

Usage:
  machines card create [--name <value>] [--limit <usd>] [--frequency <value>] [--reveal] [--json]
  machines card list [--json]
  machines card reveal [--id <card_id> | --last4 <1234>] [--json]
  machines card update (--id <card_id> | --last4 <1234>) [--name <value>] [--status <value>] [--limit <usd>] [--frequency <value>] [--json]
  machines card lock (--id <card_id> | --last4 <1234>) [--json]
  machines card unlock (--id <card_id> | --last4 <1234>) [--json]
  machines card delete (--id <card_id> | --last4 <1234>) [--json]
  machines card limit set (--id <card_id> | --last4 <1234>) --amount <usd> [--frequency <value>] [--json]`);
}

function printCardLimitHelp() {
  console.log(`machines card limit

Usage:
  machines card limit set (--id <card_id> | --last4 <1234>) --amount <usd> [--frequency <value>] [--json]`);
}

function printDisposableHelp() {
  console.log(`machines disposable

Usage:
  machines disposable create --amount-cents <value> [--currency <USD>] [--auto-cancel-after-auth] [--name <value>] [--json]`);
}

function printMcpHelp() {
  console.log(`machines mcp

Usage:
  machines mcp install --host codex|claude|copilot|chatgpt|all
  machines mcp auth login [--manual-key]
  machines mcp doctor [--json]`);
}

function printHomeHelp() {
  console.log(`machines home

Usage:
  machines home

Notes:
  opens guided interactive mode for create card, list cards, mcp setup, and sign out.`);
}

function printCompletionHelp() {
  console.log(`machines completion

Usage:
  machines completion bash
  machines completion zsh
  machines completion fish`);
}

function parseOptions(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const equalIndex = token.indexOf("=");
    if (equalIndex > 2) {
      const key = token.slice(2, equalIndex);
      const value = token.slice(equalIndex + 1);
      out[key] = value;
      continue;
    }

    const key = token.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }

    out[key] = next;
    i += 1;
  }
  return out;
}

function parseBooleanFlagValue(value, fallback = true) {
  if (typeof value === "boolean") return value;
  const raw = asNonEmptyString(value);
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function isBooleanFlagInput(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return false;
  return ["1", "0", "true", "false", "yes", "no", "on", "off"].includes(raw.toLowerCase());
}

function extractGlobalFlags(args) {
  const flags = {
    nonInteractive: false,
    yes: false,
    noColor: false,
  };
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      rest.push(token);
      continue;
    }

    const equalIndex = token.indexOf("=");
    const key = equalIndex > 2 ? token.slice(2, equalIndex) : token.slice(2);
    const inlineValue = equalIndex > 2 ? token.slice(equalIndex + 1) : null;
    const next = inlineValue === null ? args[i + 1] : null;
    const canUseNextBooleanValue =
      inlineValue === null && next && !next.startsWith("--") && isBooleanFlagInput(next);
    const hasNextValue = inlineValue === null && next && !next.startsWith("--");
    const value = inlineValue ?? (canUseNextBooleanValue ? next : true);

    if (key === "non-interactive") {
      flags.nonInteractive = parseBooleanFlagValue(value, true);
      if (canUseNextBooleanValue) i += 1;
      continue;
    }
    if (key === "yes") {
      flags.yes = parseBooleanFlagValue(value, true);
      if (canUseNextBooleanValue) i += 1;
      continue;
    }
    if (key === "no-color") {
      flags.noColor = parseBooleanFlagValue(value, true);
      if (canUseNextBooleanValue) i += 1;
      continue;
    }

    rest.push(token);
    if (hasNextValue) {
      rest.push(next);
      i += 1;
    }
  }

  return { flags, args: rest };
}

function hasHelpFlag(args) {
  return args.includes("--help") || args.includes("-h");
}

function isTruthyEnv(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldSkipBrowserLaunch(options = null) {
  if (options && options["no-launch-browser"] === true) return true;
  return isTruthyEnv(process.env.MACHINES_NO_LAUNCH_BROWSER);
}

function isInteractiveTerminal() {
  if (isTruthyEnv(process.env.MACHINES_CLI_TEST_TTY)) return true;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function canPrompt(options = null) {
  if (RUNTIME_FLAGS.nonInteractive) return false;
  if (options && options.json === true) return false;
  if (isTruthyEnv(process.env.MACHINES_CLI_ALLOW_PROMPTS)) return true;
  if (!RUNTIME_FLAGS.interactiveTty) return false;
  return true;
}

function shouldOpenHomeAfterLogin({ options, json, mode }) {
  if (json) return false;
  if (RUNTIME_FLAGS.nonInteractive) return false;
  if (!RUNTIME_FLAGS.homeEnabled) return false;
  if (!RUNTIME_FLAGS.interactiveTty) return false;
  if (mode !== "browser") return false;
  if (isTruthyEnv(process.env.MACHINES_LOGIN_NO_HOME)) return false;

  if (Object.prototype.hasOwnProperty.call(options, "no-home")) {
    return !parseBooleanFlagValue(options["no-home"], true);
  }
  if (Object.prototype.hasOwnProperty.call(options, "home")) {
    return parseBooleanFlagValue(options.home, true);
  }

  return true;
}

function buildCliWebAuthUrl(requestToken, code = null) {
  const token = asNonEmptyString(requestToken);
  if (!token) return null;
  try {
    const webApp = new URL(WEB_APP_BASE_URL);
    if (!["https:", "http:"].includes(webApp.protocol)) return null;
    webApp.pathname = "/auth/cli";
    webApp.search = "";
    webApp.searchParams.set("request", token);
    const normalizedCode = asNonEmptyString(code);
    if (normalizedCode) {
      webApp.searchParams.set("code", normalizedCode);
    }
    return webApp.toString();
  } catch {
    return null;
  }
}

function asNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskAddress(address) {
  const normalized = asNonEmptyString(address);
  if (!normalized || normalized.length < 10) return normalized ?? "";
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function normalizeLast4(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const match = raw.match(/(\d{4})/);
  return match?.[1] ?? null;
}

function formatUsdFromCents(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  const dollars = value / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(dollars);
}

function formatLimit(limit) {
  if (!limit || typeof limit !== "object") return "no limit";
  const amount = typeof limit.amount === "number" ? limit.amount : null;
  const frequency = asNonEmptyString(limit.frequency) ?? "unknown";
  if (amount === null) return `limit (${frequency})`;
  return `${formatUsdFromCents(amount)}/${frequency}`;
}

function printActionOutcome({ status, result, next = null }) {
  const statusLine = asNonEmptyString(status);
  const resultLine = asNonEmptyString(result);
  const nextLine = asNonEmptyString(next);
  if (statusLine) {
    console.log(`status: ${statusLine}`);
  }
  if (resultLine) {
    console.log(`result: ${resultLine}`);
  }
  if (nextLine) {
    console.log(`next: ${nextLine}`);
  }
}

const MACHINES_ASCII = [
  "███   ███  █████   ██████  ██   ██ ██ ███   ██ ███████ ███████",
  "████ ████ ██   ██ ██      ██   ██ ██ ████  ██ ██      ██     ",
  "██ ███ ██ ███████ ██      ███████ ██ ██ ██ ██ █████   ███████",
  "██  █  ██ ██   ██ ██      ██   ██ ██ ██  ████ ██           ██",
  "██     ██ ██   ██  ██████ ██   ██ ██ ██   ███ ███████ ███████",
].join("\n");

function printMachinesAscii() {
  console.log(MACHINES_ASCII);
}

function buildWebAppUrl(pathname) {
  try {
    const webApp = new URL(WEB_APP_BASE_URL);
    if (!["https:", "http:"].includes(webApp.protocol)) return null;
    webApp.pathname = pathname;
    webApp.search = "";
    return webApp.toString();
  } catch {
    return null;
  }
}

function formatCardNumber(pan) {
  const digits = pan.replace(/\s+/g, "");
  if (!/^\d{12,19}$/.test(digits)) return pan;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function normalizeExpiryMonth(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value)).padStart(2, "0");
  }
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  return digits ? digits.slice(-2).padStart(2, "0") : raw;
}

function normalizeExpiryYear(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return asNonEmptyString(value);
}

function buildBootstrapMessage({ address, nonce, issuedAt, expiresAt }) {
  return [
    "Machines Cash Bootstrap",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
  ].join("\n");
}

function createPkceVerifier() {
  return randomBytes(48).toString("base64url");
}

function createPkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function createState() {
  return randomBytes(24).toString("hex");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

let promptInterface = null;

function getPromptInterface() {
  if (!promptInterface) {
    promptInterface = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return promptInterface;
}

function closePromptInterface() {
  if (!promptInterface) return;
  promptInterface.close();
  promptInterface = null;
}

async function prompt(question) {
  if (!canPrompt()) {
    throw new CliError("interactive input is not available. retry in a terminal or pass required flags");
  }
  const rl = getPromptInterface();
  const answer = await rl.question(question);
  return answer.trim();
}

async function promptInput(options) {
  const {
    label,
    defaultValue = null,
    optional = false,
    validate = null,
    normalize = null,
  } = options;
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : optional ? " (optional)" : "";
    const answerRaw = await prompt(`${label}${suffix}: `);
    const rawValue =
      answerRaw.length === 0 && defaultValue !== null ? String(defaultValue) : answerRaw;
    const normalized =
      typeof normalize === "function" ? normalize(rawValue) : rawValue;
    const value = asNonEmptyString(normalized);
    if (!value) {
      if (optional) return null;
      console.log("required field");
      continue;
    }
    if (typeof validate === "function") {
      const error = validate(value);
      if (error) {
        console.log(error);
        continue;
      }
    }
    return value;
  }
}

async function promptYesNo(options) {
  const { label, defaultValue = false } = options;
  while (true) {
    const suffix = defaultValue ? " [Y/n]" : " [y/N]";
    const answer = await prompt(`${label}${suffix}: `);
    const raw = asNonEmptyString(answer);
    if (!raw) return defaultValue;
    const normalized = raw.toLowerCase();
    if (["y", "yes"].includes(normalized)) return true;
    if (["n", "no"].includes(normalized)) return false;
    console.log("enter y or n");
  }
}

async function promptSelectOption(options) {
  const {
    title,
    choices,
    defaultValue = null,
    allowCustom = false,
    customLabel = "Custom value",
    customPromptLabel = "enter custom value",
    customValidate = null,
    customNormalize = null,
  } = options;
  console.log(title);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}) ${choice.label}`);
  });
  const customIndex = choices.length + 1;
  if (allowCustom) {
    console.log(`  ${customIndex}) ${customLabel}`);
  }

  const max = allowCustom ? customIndex : choices.length;
  const resolvedDefaultIndex = (() => {
    if (defaultValue === null || defaultValue === undefined) return null;
    const index = choices.findIndex((choice) => choice.value === defaultValue);
    if (index >= 0) return index + 1;
    if (allowCustom && defaultValue === "__custom__") return customIndex;
    return null;
  })();
  while (true) {
    const selected = await promptInput({
      label: `select 1-${max}`,
      defaultValue:
        resolvedDefaultIndex !== null ? String(resolvedDefaultIndex) : null,
      validate: (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) {
          return `enter a number from 1 to ${max}`;
        }
        return null;
      },
      normalize: (value) => String(value).trim(),
    });
    const index = Number.parseInt(selected, 10);
    if (allowCustom && index === customIndex) {
      return promptInput({
        label: customPromptLabel,
        validate: customValidate,
        normalize: customNormalize,
      });
    }
    return choices[index - 1]?.value ?? null;
  }
}

async function promptArrowSelect(options) {
  const choices = Array.isArray(options?.choices) ? options.choices : [];
  if (choices.length === 0) {
    throw new CliError("no selectable options available");
  }
  if (!canPrompt()) {
    const fallback = choices.find((entry) => entry?.value !== undefined) ?? choices[0];
    return fallback?.value ?? null;
  }

  const title = asNonEmptyString(options?.title) || "select an option";
  const hint = asNonEmptyString(options?.hint) || ARROW_SELECT_HINT;
  const shouldRenderHint =
    hint.trim().toLowerCase() === ARROW_SELECT_HINT && !hasShownArrowSelectHint;
  if (shouldRenderHint) {
    hasShownArrowSelectHint = true;
  }
  const defaultIndex = Number.isInteger(options?.defaultIndex)
    ? Math.max(0, Math.min(choices.length - 1, Number(options.defaultIndex)))
    : 0;

  const stdin = process.stdin;
  const stdout = process.stdout;
  readline.emitKeypressEvents(stdin);

  return new Promise((resolve, reject) => {
    let settled = false;
    let selectedIndex = defaultIndex;
    let renderedLines = 0;
    const hadRawMode = typeof stdin.isRaw === "boolean" ? stdin.isRaw : false;
    const canSetRaw = typeof stdin.setRawMode === "function" && Boolean(stdin.isTTY);
    let cursorHidden = false;

    function cleanup() {
      if (canSetRaw) {
        stdin.setRawMode(hadRawMode);
      }
      stdin.off("keypress", onKeypress);
      if (renderedLines > 0) {
        readline.cursorTo(stdout, 0);
        readline.moveCursor(stdout, 0, -renderedLines + 1);
        readline.clearScreenDown(stdout);
      }
      if (cursorHidden) {
        stdout.write("\u001B[?25h");
        cursorHidden = false;
      }
      stdout.write("\n");
    }

    function render() {
      const lines = [];
      lines.push(title);
      if (shouldRenderHint) {
        lines.push(hint);
      }
      for (let index = 0; index < choices.length; index += 1) {
        const choice = choices[index];
        const marker = index === selectedIndex ? ">" : " ";
        lines.push(`${marker} ${choice.label}`);
      }

      if (renderedLines > 0) {
        readline.cursorTo(stdout, 0);
        readline.moveCursor(stdout, 0, -renderedLines + 1);
      }
      readline.clearScreenDown(stdout);
      stdout.write(lines.join("\n"));
      renderedLines = lines.length;
    }

    function settle(value, error = null) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    }

    function onKeypress(_, key = {}) {
      if (key.ctrl && key.name === "c") {
        settle(null, new CliError("cancelled"));
        return;
      }
      if (key.name === "up" || key.name === "k") {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const selected = choices[selectedIndex];
        settle(selected?.value ?? null);
      }
    }

    if (canSetRaw) {
      stdin.setRawMode(true);
    }
    stdout.write("\u001B[?25l");
    cursorHidden = true;
    stdin.on("keypress", onKeypress);
    render();
  });
}

function createPlainPromptDriver() {
  return {
    kind: "plain",
    select: async ({ title, choices }) =>
      promptSelectOption({
        title,
        choices,
        allowCustom: false,
      }),
    input: async (options) => promptInput(options),
    confirm: async ({ label, defaultValue = false }) =>
      promptYesNo({ label, defaultValue }),
  };
}

function createArrowPromptDriver() {
  return {
    kind: "arrow",
    select: async ({ title, choices, hint = ARROW_SELECT_HINT, defaultIndex = 0 }) =>
      promptArrowSelect({
        title,
        hint,
        choices,
        defaultIndex,
      }),
    input: async (options) => promptInput(options),
    confirm: async ({ label, defaultValue = false }) =>
      promptYesNo({ label, defaultValue }),
  };
}

function createPromptDriver(preferred = "arrow") {
  const envPreferred = asNonEmptyString(process.env.MACHINES_PROMPT_DRIVER)?.toLowerCase();
  if (envPreferred === "plain" || envPreferred === "arrow") {
    preferred = envPreferred;
  }
  if (!canPrompt()) {
    return createPlainPromptDriver();
  }
  if (preferred === "arrow") {
    return createArrowPromptDriver();
  }
  return createPlainPromptDriver();
}

async function requestJson(url, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 15_000,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const initHeaders = {
      accept: "application/json",
      ...headers,
    };

    let payload;
    if (body !== undefined) {
      initHeaders["content-type"] = initHeaders["content-type"] || "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(url, {
      method,
      headers: initHeaders,
      body: payload,
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      text,
    };
  } catch (error) {
    if (error && typeof error === "object" && error.name === "AbortError") {
      throw new CliError(`request timed out: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return fallback;

  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;

  if (payload.data && typeof payload.data === "object") {
    if (typeof payload.data.message === "string") return payload.data.message;
    if (typeof payload.data.error === "string") return payload.data.error;
  }

  return fallback;
}

function withOnboardingHint(message) {
  const normalized = asNonEmptyString(message);
  if (!normalized) {
    return message;
  }
  if (/user not found/i.test(normalized)) {
    return `${normalized}. complete onboarding in app (KYC/identity), then retry`;
  }
  return message;
}

function withKycSubmitHint(message) {
  const normalized = asNonEmptyString(message);
  if (!normalized) return message;
  if (
    /phonecountrycode/i.test(normalized) &&
    /missing required property/i.test(normalized)
  ) {
    return `${normalized}. add --phone-country-code and --phone-number`;
  }
  return message;
}

async function loadUserAuth() {
  if (!(await pathExists(CLI_AUTH_PATH))) {
    throw new CliError("not logged in. run: machines login");
  }
  return readJson(CLI_AUTH_PATH);
}

async function readUserAuthIfExists() {
  if (!(await pathExists(CLI_AUTH_PATH))) {
    return null;
  }
  try {
    return await readJson(CLI_AUTH_PATH);
  } catch {
    return null;
  }
}

async function saveUserAuth(auth) {
  await writeJson(CLI_AUTH_PATH, auth);
}

function sessionExpiresSoon(auth, safetySeconds = 60) {
  const expiresAt = asNonEmptyString(auth.sessionExpiresAt);
  if (!expiresAt) return true;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return true;
  return ms - Date.now() <= safetySeconds * 1000;
}

function parseSessionResponse(payload) {
  if (!payload || typeof payload !== "object") return null;
  const sessionToken = asNonEmptyString(payload.sessionToken);
  const sessionId = asNonEmptyString(payload.sessionId);
  const expiresAt = asNonEmptyString(payload.expiresAt);
  const scopes = Array.isArray(payload.scopes)
    ? payload.scopes.map((scope) => asNonEmptyString(scope)).filter(Boolean)
    : [];

  if (!sessionToken || !sessionId || !expiresAt) return null;
  return {
    sessionToken,
    sessionId,
    expiresAt,
    scopes,
  };
}

async function createSessionFromKey(userApiKey, options = {}) {
  const body = {};
  if (Array.isArray(options.scopes) && options.scopes.length > 0) {
    body.scopes = options.scopes;
  }
  if (options.policy && typeof options.policy === "object") {
    body.policy = options.policy;
  }
  if (typeof options.ttlSeconds === "number") {
    body.ttlSeconds = options.ttlSeconds;
  }

  return requestJson(`${USER_API_BASE_URL}/sessions`, {
    method: "POST",
    headers: {
      "X-User-Key": userApiKey,
    },
    body,
  });
}

async function refreshSessionIfNeeded(auth, options = {}) {
  const force = Boolean(options.force);
  if (!force && !sessionExpiresSoon(auth)) {
    return auth;
  }

  const response = await createSessionFromKey(auth.userApiKey, {
    scopes: Array.isArray(auth.scopes) ? auth.scopes : DEFAULT_USER_SCOPES,
    policy: DEFAULT_USER_POLICY,
  });

  if (!response.ok) {
    const message = extractErrorMessage(response.data, "unable to refresh session");
    throw new CliError(`${message}. run: machines login`);
  }

  const session = parseSessionResponse(response.data);
  if (!session) {
    throw new CliError("session refresh returned invalid payload");
  }

  const nextAuth = {
    ...auth,
    sessionToken: session.sessionToken,
    sessionId: session.sessionId,
    sessionExpiresAt: session.expiresAt,
    scopes: session.scopes.length > 0 ? session.scopes : auth.scopes,
    refreshedAt: new Date().toISOString(),
  };

  await saveUserAuth(nextAuth);
  return nextAuth;
}

async function userApiRequest(pathname, options = {}) {
  const method = options.method || "GET";
  const idempotencyKey = asNonEmptyString(options.idempotencyKey);
  const keyAuth = Boolean(options.keyAuth);

  let auth = await loadUserAuth();
  if (!keyAuth) {
    auth = await refreshSessionIfNeeded(auth);
  }

  const headers = {
    ...(options.headers || {}),
  };

  if (keyAuth) {
    headers["X-User-Key"] = auth.userApiKey;
  } else {
    headers.Authorization = `Bearer ${auth.sessionToken}`;
  }

  if (idempotencyKey) {
    headers["idempotency-key"] = idempotencyKey;
  }

  const request = async () =>
    requestJson(`${USER_API_BASE_URL}${pathname}`, {
      method,
      headers,
      body: options.body,
      timeoutMs: options.timeoutMs,
    });

  let response = await request();
  if (!keyAuth && response.status === 401) {
    auth = await refreshSessionIfNeeded(auth, { force: true });
    headers.Authorization = `Bearer ${auth.sessionToken}`;
    response = await request();
  }

  return { auth, response };
}

async function encryptValue(value) {
  const trimmed = asNonEmptyString(value);
  if (!trimmed) return null;

  const { response } = await userApiRequest("/crypto/encrypt", {
    method: "POST",
    body: {
      items: [{ id: "value", value: trimmed }],
    },
  });

  if (!response.ok) {
    const message = extractErrorMessage(response.data, "unable to encrypt value");
    throw new CliError(message);
  }

  const items = Array.isArray(response.data?.items) ? response.data.items : [];
  const item = items[0];
  if (!item || item.ok !== true || !item.encrypted) {
    throw new CliError("unable to encrypt value");
  }
  return item.encrypted;
}

async function decryptCardNames(cards) {
  const items = [];
  for (const card of cards) {
    const encrypted = card?.encryptedName;
    if (!encrypted || typeof encrypted !== "object") continue;
    items.push({ id: String(card.id), encrypted });
  }

  if (items.length === 0) {
    return new Map();
  }

  const { response } = await userApiRequest("/crypto/decrypt", {
    method: "POST",
    body: { items },
  });

  if (!response.ok) {
    return new Map();
  }

  const out = new Map();
  const decryptedItems = Array.isArray(response.data?.items) ? response.data.items : [];
  for (const item of decryptedItems) {
    if (item?.ok === true && typeof item.id === "string" && typeof item.value === "string") {
      out.set(item.id, item.value);
    }
  }
  return out;
}

function extractCards(payload) {
  if (payload && Array.isArray(payload.cards)) return payload.cards;
  if (payload?.data && Array.isArray(payload.data.cards)) return payload.data.cards;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function pickCardForReveal(cards, requestedLast4, requestedId = null) {
  const normalizedId = asNonEmptyString(requestedId);
  if (normalizedId) {
    return cards.find((card) => asNonEmptyString(card.id) === normalizedId) ?? null;
  }

  const filtered = requestedLast4
    ? cards.filter((card) => asNonEmptyString(card.last4) === requestedLast4)
    : cards;

  if (filtered.length === 0) return null;

  const active = filtered.filter(
    (card) => (asNonEmptyString(card.status) ?? "").toLowerCase() === "active",
  );

  const pool = active.length > 0 ? active : filtered;

  return [...pool].sort((a, b) => {
    const left = Date.parse(asNonEmptyString(a.createdAt) ?? "");
    const right = Date.parse(asNonEmptyString(b.createdAt) ?? "");
    const leftValue = Number.isNaN(left) ? 0 : left;
    const rightValue = Number.isNaN(right) ? 0 : right;
    return rightValue - leftValue;
  })[0];
}

function decryptRainSecret({ secretKeyHex, ivBase64, dataBase64 }) {
  const key = Buffer.from(secretKeyHex, "hex");
  const iv = Buffer.from(ivBase64, "base64");
  const payload = Buffer.from(dataBase64, "base64");
  const tagLength = 16;
  const tag = payload.subarray(payload.length - tagLength);
  const cipher = payload.subarray(0, payload.length - tagLength);

  const decipher = createDecipheriv("aes-128-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
  return plain.toString("utf8");
}

async function signBootstrapMessage(message, privateKey) {
  const normalized = asNonEmptyString(privateKey);
  if (!normalized) return null;

  let Wallet;
  try {
    ({ Wallet } = await import("ethers"));
  } catch {
    throw new CliError("private-key signing requires ethers. install dependency and retry");
  }

  const wallet = new Wallet(normalized);
  return wallet.signMessage(message);
}

function parseNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`${label} must be a valid number`);
  }
  return parsed;
}

function parseInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`${label} must be an integer`);
  }
  return parsed;
}

function parseCardStatus(value) {
  const raw = asNonEmptyString(value);
  if (!raw) {
    throw new CliError("status is required");
  }
  const normalized = CARD_STATUS_ALIASES.get(raw.replace(/[\s_-]+/g, "").toLowerCase());
  if (!normalized) {
    const expected = Array.from(new Set(CARD_STATUS_ALIASES.values())).join(", ");
    throw new CliError(`status must be one of: ${expected}`);
  }
  return normalized;
}

function parseCardLimitFrequency(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return "per30DayPeriod";
  if (!CARD_LIMIT_FREQUENCIES.has(raw)) {
    throw new CliError(
      `frequency must be one of: ${Array.from(CARD_LIMIT_FREQUENCIES).join(", ")}`,
    );
  }
  return raw;
}

async function resolveRequiredInput({
  options,
  currentValue,
  label,
  example = null,
  normalize = null,
  validate = null,
  json = false,
}) {
  const hasCurrent = currentValue !== undefined && currentValue !== null;
  const normalizedCurrent =
    hasCurrent && typeof normalize === "function" ? normalize(currentValue) : currentValue;
  const current = asNonEmptyString(normalizedCurrent);
  if (current) {
    if (typeof validate === "function") {
      const error = validate(current);
      if (error) {
        throw new CliError(error);
      }
    }
    return current;
  }

  if (!canPrompt({ json }) || RUNTIME_FLAGS.nonInteractive) {
    const suffix = example ? ` (example: ${example})` : "";
    throw new CliError(`missing required input: ${label}${suffix}`);
  }

  return promptInput({
    label,
    validate,
    normalize,
  });
}

function normalizeWhitespace(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeBirthDateInput(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const trimmed = raw.trim();
  const compact = trimmed.replace(/\s+/g, "");

  let year = null;
  let month = null;
  let day = null;

  let match = compact.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (match) {
    year = Number.parseInt(match[1], 10);
    month = Number.parseInt(match[2], 10);
    day = Number.parseInt(match[3], 10);
  } else {
    match = compact.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (match) {
      month = Number.parseInt(match[1], 10);
      day = Number.parseInt(match[2], 10);
      year = Number.parseInt(match[3], 10);
    }
  }

  if (year !== null && month !== null && day !== null) {
    const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isValidIsoDate(iso)) return iso;
  }

  if (isValidIsoDate(compact)) return compact;
  return trimmed;
}

function isValidIsoDate(value) {
  const raw = asNonEmptyString(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [yearRaw, monthRaw, dayRaw] = raw.split("-");
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function normalizeCountryCodeInput(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const lettersOnly = raw.toUpperCase().replace(/[^A-Z]/g, "");
  return asNonEmptyString(lettersOnly);
}

function normalizeEmailInput(value) {
  const raw = normalizeWhitespace(value);
  return raw ? raw.toLowerCase() : null;
}

function normalizePhoneCountryCodeInput(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  return asNonEmptyString(digits);
}

function normalizePhoneNumberInput(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  return asNonEmptyString(digits);
}

function normalizeNationalIdInput(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return asNonEmptyString(compact);
}

function normalizePostalCodeInput(value) {
  const raw = normalizeWhitespace(value);
  return raw ? raw.toUpperCase() : null;
}

function normalizeRegionInput(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;
  if (/^[a-z]{2,3}$/i.test(raw)) {
    return raw.toUpperCase();
  }
  return raw;
}

function normalizeAccountPurposeInput(value) {
  const raw = normalizeWhitespace(value);
  return raw ? raw.toLowerCase() : null;
}

function normalizeOccupationCodeInput(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return asNonEmptyString(compact);
}

function isUsCountryCode(value) {
  return normalizeCountryCodeInput(value) === "US";
}

function isCanadaCountryCode(value) {
  return normalizeCountryCodeInput(value) === "CA";
}

function requiresCliNationalId(countryCode) {
  return isUsCountryCode(countryCode) || isCanadaCountryCode(countryCode);
}

function getKycNationalIdLabel(countryCode) {
  if (isUsCountryCode(countryCode)) {
    return "social security number (ssn)";
  }
  if (isCanadaCountryCode(countryCode)) {
    return "social insurance number or driver's licence";
  }
  return "national id";
}

function getKycRegionLabel(countryCode) {
  if (isUsCountryCode(countryCode)) {
    return "state";
  }
  if (isCanadaCountryCode(countryCode)) {
    return "province";
  }
  return "state/region";
}

function normalizeKycInputKey(value) {
  return value
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeKycAnnualSalary(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return raw;
  const key = normalizeKycInputKey(raw);
  return KYC_ANNUAL_SALARY_INPUT_MAP.get(key) || raw;
}

function normalizeKycExpectedMonthlyVolume(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return raw;
  const key = normalizeKycInputKey(raw);
  return KYC_EXPECTED_MONTHLY_VOLUME_INPUT_MAP.get(key) || raw;
}

function extractCardFromPayload(payload) {
  if (payload?.card && typeof payload.card === "object") return payload.card;
  if (payload?.data?.card && typeof payload.data.card === "object") return payload.data.card;
  return null;
}

async function revealCardDetailsForCard(card, options = {}) {
  const cardId = asNonEmptyString(card?.id);
  if (!cardId) {
    throw new CliError("selected card has no id");
  }

  const secretsSessionResponse = await userApiRequest("/cards/secrets/session", {
    method: "POST",
    body: {},
  });
  if (!secretsSessionResponse.response.ok) {
    const message = extractErrorMessage(
      secretsSessionResponse.response.data,
      "unable to start card reveal session",
    );
    throw new CliError(message);
  }

  const revealSecrets = secretsSessionResponse.response.data?.secrets ||
    secretsSessionResponse.response.data?.data?.secrets ||
    null;
  const revealSessionId = asNonEmptyString(revealSecrets?.sessionId);
  const secretKey = asNonEmptyString(revealSecrets?.secretKey);
  if (!revealSessionId || !secretKey) {
    throw new CliError("card reveal session is missing secret payload");
  }

  const secretsResponse = await userApiRequest(`/cards/${cardId}/secrets`, {
    method: "POST",
    body: {
      sessionId: revealSessionId,
    },
  });
  if (!secretsResponse.response.ok) {
    const message = withOnboardingHint(
      extractErrorMessage(secretsResponse.response.data, "unable to reveal card details"),
    );
    throw new CliError(message);
  }

  const encryptedSecrets = secretsResponse.response.data?.secrets ||
    secretsResponse.response.data?.data?.secrets ||
    null;
  const encryptedPan = encryptedSecrets?.encryptedPan;
  const encryptedCvc = encryptedSecrets?.encryptedCvc;
  if (!encryptedPan || !encryptedCvc) {
    throw new CliError("card secrets payload is missing encrypted data");
  }

  const pan = decryptRainSecret({
    secretKeyHex: secretKey,
    ivBase64: encryptedPan.iv,
    dataBase64: encryptedPan.data,
  });
  const cvc = decryptRainSecret({
    secretKeyHex: secretKey,
    ivBase64: encryptedCvc.iv,
    dataBase64: encryptedCvc.data,
  });

  const number = formatCardNumber(pan);
  const expirationMonth = normalizeExpiryMonth(card.expirationMonth);
  const expirationYear = normalizeExpiryYear(card.expirationYear);

  return {
    cardId,
    last4: asNonEmptyString(card.last4),
    number,
    cvc,
    expirationMonth,
    expirationYear,
    card: {
      ...card,
      expirationMonth,
      expirationYear,
    },
    ...(options.includeCard ? { createdCard: card } : {}),
  };
}

function printRevealedCardDetails(revealPayload, options = {}) {
  const showSummary = options.showSummary !== false;
  if (showSummary) {
    printActionOutcome({
      status: "revealed",
      result: `card ending ${revealPayload.last4 ?? "----"}`,
      next: "copy securely. details are sensitive.",
    });
  }
  console.log(`number: ${revealPayload.number}`);
  console.log(`cvc: ${revealPayload.cvc}`);
  console.log(`expires: ${revealPayload.expirationMonth ?? "--"}/${revealPayload.expirationYear ?? "----"}`);
}

async function resolveCardTarget(options, context = {}) {
  const requestedId = asNonEmptyString(options.id) || asNonEmptyString(options["card-id"]);
  const requestedLast4 = normalizeLast4(options.last4);
  const json = Boolean(context.json);

  if (requestedId && requestedLast4) {
    throw new CliError("provide only one selector: --id or --last4");
  }

  if (requestedId) {
    return {
      cardId: requestedId,
      selector: "id",
      selectorValue: requestedId,
    };
  }

  const listResponse = await userApiRequest("/cards", { method: "GET" });
  if (!listResponse.response.ok) {
    const message = withOnboardingHint(extractErrorMessage(listResponse.response.data, "unable to list cards"));
    throw new CliError(message);
  }

  const cards = extractCards(listResponse.response.data);
  if (!requestedLast4) {
    if (cards.length === 0) {
      throw new CliError("no card available. create one with: machines card create");
    }

    if (!canPrompt({ json })) {
      throw new CliError("card selector required: use --id or --last4");
    }

    const namesById = await decryptCardNames(cards).catch(() => new Map());
    const choices = cards.map((card) => {
      const id = asNonEmptyString(card.id) || "";
      const last4 = asNonEmptyString(card.last4) || "----";
      const status = asNonEmptyString(card.status) || "unknown";
      const name = namesById.get(id) || "card";
      return {
        label: `${name} ••••${last4} (${status})`,
        value: id,
      };
    }).filter((entry) => asNonEmptyString(entry.value));

    const driver = createPromptDriver("arrow");
    const selectedId = await driver.select({
      title: "select card",
      choices,
      hint: "use up/down arrows and enter",
    });
    const selectedCard = cards.find((card) => asNonEmptyString(card.id) === selectedId);
    if (!selectedCard) {
      throw new CliError("no card selected");
    }
    const selectedCardId = asNonEmptyString(selectedCard.id);
    if (!selectedCardId) {
      throw new CliError("selected card has no id");
    }
    return {
      cardId: selectedCardId,
      selector: "id",
      selectorValue: selectedCardId,
    };
  }

  const selected = pickCardForReveal(cards, requestedLast4);
  if (!selected) {
    throw new CliError(`no card found ending with ${requestedLast4}`);
  }

  const cardId = asNonEmptyString(selected.id);
  if (!cardId) {
    throw new CliError("selected card has no id");
  }

  return {
    cardId,
    selector: "last4",
    selectorValue: requestedLast4,
  };
}

function printJsonIfRequested(flag, value) {
  if (!flag) return false;
  console.log(JSON.stringify(value, null, 2));
  return true;
}

function extractApplicationFromPayload(payload) {
  if (payload?.application && typeof payload.application === "object") return payload.application;
  if (payload?.data?.application && typeof payload.data.application === "object") {
    return payload.data.application;
  }
  if (payload && typeof payload === "object" && typeof payload.status === "string") {
    return payload;
  }
  return null;
}

function normalizeKycStatus(status) {
  const raw = asNonEmptyString(status) || "not_submitted";
  const normalized = raw.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  switch (normalized) {
    case "approved":
    case "accepted":
      return "approved";
    case "pending":
      return "pending";
    case "manualreview":
      return "manual_review";
    case "needsverification":
      return "needs_verification";
    case "needsinformation":
      return "needs_information";
    case "denied":
      return "denied";
    case "locked":
      return "locked";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "notsubmitted":
      return "not_submitted";
    default:
      return raw;
  }
}

function classifyKycStatus(status) {
  const normalized = normalizeKycStatus(status);
  if (normalized === "approved") return "approved";
  if (normalized === "needs_verification" || normalized === "needs_information") {
    return "action_required";
  }
  if (normalized === "denied" || normalized === "locked" || normalized === "canceled") {
    return "rejected";
  }
  if (normalized === "not_submitted") return "not_submitted";
  return "pending";
}

function hasAcceptedCliAgreements(application) {
  return Boolean(application?.isTermsOfServiceAccepted);
}

function isCliReadyForHome(application) {
  return normalizeKycStatus(application?.status) === "approved" && hasAcceptedCliAgreements(application);
}

function buildVerificationUrl(link) {
  const asString = asNonEmptyString(link);
  if (asString) return asString;
  if (!link || typeof link !== "object" || Array.isArray(link)) {
    return null;
  }
  const url = asNonEmptyString(link.url);
  if (!url) return null;
  const params =
    link.params && typeof link.params === "object" && !Array.isArray(link.params)
      ? link.params
      : null;
  if (!params) return url;
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      parsed.searchParams.set(String(key), String(value));
    }
    return parsed.toString();
  } catch {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      search.set(String(key), String(value));
    }
    const suffix = search.toString();
    if (!suffix) return url;
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}${suffix}`;
  }
}

function resolveVerificationUrl(application) {
  return (
    buildVerificationUrl(application?.externalVerificationLink) ||
    buildVerificationUrl(application?.completionLink)
  );
}

function resolveKycBrowserUrl(application = null) {
  return resolveVerificationUrl(application) || buildWebAppUrl("/identity/kyc");
}

async function openKycBrowserFlow(options = {}) {
  const noLaunchBrowser = Boolean(options.noLaunchBrowser);
  const json = Boolean(options.json);
  const quiet = Boolean(options.quiet);
  const application = options.application ?? null;
  const url = resolveKycBrowserUrl(application);
  if (!url) {
    throw new CliError("web kyc url is not configured");
  }

  if (!noLaunchBrowser) {
    try {
      openBrowser(url);
    } catch {
      // user can open the URL manually
    }
  }

  if (quiet) {
    return { url, openedBrowser: !noLaunchBrowser };
  }

  if (
    printJsonIfRequested(json, {
      mode: "browser",
      verificationUrl: url,
      openedBrowser: !noLaunchBrowser,
    })
  ) {
    return { url, openedBrowser: !noLaunchBrowser };
  }

  if (noLaunchBrowser) {
    printActionOutcome({
      status: "ready",
      result: "finish verification in browser",
      next: "open the URL and continue",
    });
    console.log(`open this URL: ${url}`);
  } else {
    printActionOutcome({
      status: "ready",
      result: "opened browser verification flow",
      next: "finish verification in browser, then return here",
    });
    console.log(`opened verification URL: ${url}`);
  }

  return { url, openedBrowser: !noLaunchBrowser };
}

async function promptUserCreateMode() {
  console.log("start verification");
  console.log("browser is the simplest path.");
  return promptSelectOption({
    title: "choose how to continue",
    defaultValue: "browser",
    choices: [
      { label: "continue in browser (recommended)", value: "browser" },
      { label: "continue in cli", value: "cli" },
    ],
  });
}

async function fetchKycStatus() {
  const { response } = await userApiRequest("/kyc/status", {
    method: "GET",
  });

  if (response.status === 404) {
    return {
      sourceStatusCode: 404,
      application: {
        status: "not_submitted",
        reason: null,
        completionLink: null,
        externalVerificationLink: null,
        isActive: null,
        isTermsOfServiceAccepted: false,
      },
    };
  }

  if (!response.ok) {
    const message = extractErrorMessage(response.data, "unable to read kyc status");
    throw new CliError(message);
  }

  const application = extractApplicationFromPayload(response.data);
  if (!application) {
    throw new CliError("kyc status payload is invalid");
  }

  return {
    sourceStatusCode: response.status,
    application,
  };
}

async function waitForKycApproval(options = {}) {
  const intervalSecondsRaw =
    options.intervalSeconds !== undefined ? options.intervalSeconds : 5;
  const timeoutSecondsRaw =
    options.timeoutSeconds !== undefined ? options.timeoutSeconds : 15 * 60;

  const intervalSeconds = parseInteger(intervalSecondsRaw, "interval-seconds");
  const timeoutSeconds = parseInteger(timeoutSecondsRaw, "timeout-seconds");
  if (intervalSeconds <= 0) {
    throw new CliError("interval-seconds must be greater than zero");
  }
  if (timeoutSeconds <= 0) {
    throw new CliError("timeout-seconds must be greater than zero");
  }

  const quiet = Boolean(options.quiet);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastNormalized = null;

  while (Date.now() <= deadline) {
    const statusPayload = await fetchKycStatus();
    const application = statusPayload.application;
    const normalized = normalizeKycStatus(application.status);
    const classification = classifyKycStatus(normalized);
    const verificationUrl = resolveVerificationUrl(application);

    if (!quiet && normalized !== lastNormalized) {
      console.log(`kyc status: ${normalized}`);
      if (
        classification === "action_required" &&
        verificationUrl &&
        verificationUrl.length > 0
      ) {
        console.log(`verification link: ${verificationUrl}`);
      }
    }

    if (classification === "approved") {
      return application;
    }

    if (classification === "rejected") {
      throw new CliError(`kyc ended in terminal status: ${normalized}`);
    }

    if (classification === "not_submitted") {
      throw new CliError("kyc is not submitted. run: machines user create ...");
    }

    lastNormalized = normalized;
    await sleep(intervalSeconds * 1000);
  }

  throw new CliError(`kyc wait timed out after ${timeoutSeconds} seconds`);
}

async function buildCreateUserPayloadFromOptions(options) {
  const fromFilePath = asNonEmptyString(options["from-file"]);
  let filePayload = {};
  if (fromFilePath) {
    try {
      const text = await fs.readFile(fromFilePath, "utf8");
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new CliError("--from-file must point to a JSON object");
      }
      filePayload = parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(`unable to read --from-file payload: ${message}`);
    }
  }

  const payloadRaw = asNonEmptyString(options.payload);
  let inlinePayload = {};
  if (payloadRaw) {
    try {
      const parsed = JSON.parse(payloadRaw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new CliError("--payload must be a JSON object");
      }
      inlinePayload = parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(`unable to parse --payload JSON: ${message}`);
    }
  }

  const merged = {
    ...filePayload,
    ...inlinePayload,
  };

  const getOption = (...keys) => {
    for (const key of keys) {
      const cliValue = asNonEmptyString(options[key]);
      if (cliValue) return cliValue;
      const mergedValue = asNonEmptyString(merged?.[key]);
      if (mergedValue) return mergedValue;
    }
    return null;
  };

  const firstName = normalizeWhitespace(getOption("first-name", "firstname", "firstName", "name"));
  const lastName = normalizeWhitespace(getOption("last-name", "lastname", "lastName"));
  const birthDate = normalizeBirthDateInput(getOption("birth-date", "birthdate", "birthDate", "dob"));
  const countryOfIssue = normalizeCountryCodeInput(getOption("country-of-issue", "countryOfIssue"));
  const nationalId = normalizeNationalIdInput(getOption("national-id", "nationalId"));
  const email = normalizeEmailInput(getOption("email"));
  const addressFromMerged =
    merged.address && typeof merged.address === "object" ? merged.address : {};
  const line1 =
    normalizeWhitespace(getOption("line1", "address-line1", "addressLine1")) ||
    normalizeWhitespace(addressFromMerged.line1);
  const line2 =
    normalizeWhitespace(getOption("line2", "address-line2", "addressLine2")) ||
    normalizeWhitespace(addressFromMerged.line2);
  const city = normalizeWhitespace(getOption("city")) || normalizeWhitespace(addressFromMerged.city);
  const region =
    normalizeRegionInput(getOption("region", "state", "province")) ||
    normalizeRegionInput(addressFromMerged.region);
  const postalCode =
    normalizePostalCodeInput(getOption("postal-code", "postalCode", "zip", "zip-code")) ||
    normalizePostalCodeInput(addressFromMerged.postalCode);
  const countryCode =
    normalizeCountryCodeInput(getOption("country-code", "countryCode")) ||
    normalizeCountryCodeInput(addressFromMerged.countryCode);
  const country =
    normalizeWhitespace(getOption("country-name", "countryName")) ||
    normalizeWhitespace(addressFromMerged.country);
  const phoneCountryCode = normalizePhoneCountryCodeInput(
    getOption("phone-country-code", "phoneCountryCode"),
  );
  const phoneNumber = normalizePhoneNumberInput(getOption("phone-number", "phoneNumber"));
  const occupation = normalizeOccupationCodeInput(getOption("occupation"));
  const annualSalary = getOption("annual-salary", "annualSalary");
  const accountPurpose = normalizeAccountPurposeInput(getOption("account-purpose", "accountPurpose"));
  const expectedMonthlyVolume = getOption(
    "expected-monthly-volume",
    "expectedMonthlyVolume",
  );
  const referralCode = normalizeWhitespace(getOption("referral-code", "referralCode"));
  const walletLabel = normalizeWhitespace(getOption("wallet-label", "walletLabel"));
  const walletImage = normalizeWhitespace(getOption("wallet-image", "walletImage"));

  const payload = {
    ...merged,
    firstName,
    lastName,
    birthDate,
    countryOfIssue,
    email,
    occupation,
    annualSalary: normalizeKycAnnualSalary(annualSalary),
    accountPurpose,
    expectedMonthlyVolume: normalizeKycExpectedMonthlyVolume(expectedMonthlyVolume),
    ...(nationalId ? { nationalId } : {}),
    ...(referralCode ? { referralCode: referralCode.toUpperCase() } : {}),
    ...(walletLabel ? { walletLabel } : {}),
    ...(walletImage ? { walletImage } : {}),
    address: {
      ...addressFromMerged,
      line1,
      ...(line2 ? { line2 } : {}),
      city,
      region,
      postalCode,
      countryCode,
      ...(country ? { country } : {}),
    },
    ...(phoneCountryCode ? { phoneCountryCode } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
  };

  const requiredFields = [
    [payload.firstName, "--name or --first-name"],
    [payload.lastName, "--lastname or --last-name"],
    [payload.birthDate, "--birth-date"],
    [payload.countryOfIssue, "--country-of-issue"],
    [payload.email, "--email"],
    [payload.phoneCountryCode, "--phone-country-code"],
    [payload.phoneNumber, "--phone-number"],
    [payload.address?.line1, "--line1"],
    [payload.address?.city, "--city"],
    [payload.address?.region, "--region"],
    [payload.address?.postalCode, "--postal-code"],
    [payload.address?.countryCode, "--country-code"],
    [payload.occupation, "--occupation"],
    [payload.annualSalary, "--annual-salary"],
    [payload.accountPurpose, "--account-purpose"],
    [payload.expectedMonthlyVolume, "--expected-monthly-volume"],
  ];

  const missing = requiredFields
    .filter(([value]) => !asNonEmptyString(value))
    .map(([, label]) => label);

  if (requiresCliNationalId(payload.countryOfIssue) && !asNonEmptyString(payload.nationalId)) {
    missing.push("--national-id (required for US/CA)");
  }

  if (payload.birthDate && !isValidIsoDate(payload.birthDate)) {
    missing.push("--birth-date must be a valid date (accepted: YYYY-MM-DD or MM/DD/YYYY)");
  }
  if (payload.countryOfIssue && !/^[A-Z]{2}$/.test(payload.countryOfIssue)) {
    missing.push("--country-of-issue must be a 2-letter country code");
  }
  if (payload.address?.countryCode && !/^[A-Z]{2}$/.test(payload.address.countryCode)) {
    missing.push("--country-code must be a 2-letter country code");
  }
  if (payload.phoneCountryCode && !/^\d{1,3}$/.test(payload.phoneCountryCode)) {
    missing.push("--phone-country-code must be 1-3 digits (for example +1 -> 1)");
  }
  if (payload.phoneNumber && !/^\d{4,15}$/.test(payload.phoneNumber)) {
    missing.push("--phone-number must be 4-15 digits (formatting chars are auto-removed)");
  }
  if (payload.nationalId && !/^[0-9A-Za-z-]+$/.test(payload.nationalId)) {
    missing.push("--national-id may only include letters, numbers, and hyphen");
  }
  if (payload.referralCode && !/^[A-Z]{6}$/.test(payload.referralCode)) {
    missing.push("--referral-code must be 6 letters");
  }

  if (missing.length > 0) {
    throw new CliError(`invalid or missing user create fields: ${missing.join(", ")}`);
  }

  return payload;
}

function buildKycSummaryRows(payload) {
  const nationalId = asNonEmptyString(payload.nationalId);
  const maskedNationalId = nationalId
    ? `${"*".repeat(Math.max(0, nationalId.length - 4))}${nationalId.slice(-4)}`
    : null;
  return [
    ["first name", payload.firstName],
    ["last name", payload.lastName],
    ["country of issue", payload.countryOfIssue],
    ["birth date", payload.birthDate],
    [getKycNationalIdLabel(payload.countryOfIssue), maskedNationalId || "not provided"],
    ["email", payload.email],
    [
      "phone",
      payload.phoneCountryCode && payload.phoneNumber
        ? `+${payload.phoneCountryCode} ${payload.phoneNumber}`
        : "not provided",
    ],
    [
      "address",
      `${payload.address?.line1}${payload.address?.line2 ? `, ${payload.address.line2}` : ""}, ${payload.address?.city}, ${payload.address?.region}, ${payload.address?.postalCode}, ${payload.address?.countryCode}`,
    ],
    ["occupation", payload.occupation],
    ["annual salary", payload.annualSalary],
    ["account purpose", payload.accountPurpose],
    ["expected monthly volume", payload.expectedMonthlyVolume],
    ["referral code", payload.referralCode || "none"],
  ];
}

async function promptKycQuestionnaire(options) {
  void options;
  console.log("kyc questionnaire");
  printKycBanner();

  const countryOfIssue = await promptSelectOption({
    title: "country of issue",
    choices: [
      { label: "united states", value: "US" },
      { label: "canada", value: "CA" },
    ],
    allowCustom: true,
    customLabel: "enter country code manually",
    customPromptLabel: "country of issue (2 letters)",
    customValidate: (value) =>
      /^[A-Z]{2}$/.test(value) ? null : "use a 2-letter country code",
    customNormalize: normalizeCountryCodeInput,
  });

  const firstName = await promptInput({
    label: "first name",
    normalize: normalizeWhitespace,
  });
  const lastName = await promptInput({
    label: "last name",
    normalize: normalizeWhitespace,
  });
  const birthDate = await promptInput({
    label: "birth date (YYYY-MM-DD or MM/DD/YYYY)",
    normalize: normalizeBirthDateInput,
    validate: (value) =>
      isValidIsoDate(value)
        ? null
        : "enter a valid date (for example 1990-01-01 or 01/01/1990)",
  });

  const needsNationalId = requiresCliNationalId(countryOfIssue);
  const nationalId = await promptInput({
    label: getKycNationalIdLabel(countryOfIssue),
    optional: !needsNationalId,
    normalize: normalizeNationalIdInput,
    validate: (value) =>
      /^[0-9A-Za-z-]+$/.test(value)
        ? null
        : "use letters, numbers, and hyphen only",
  });

  const email = await promptInput({
    label: "email",
    validate: (value) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "enter a valid email",
    normalize: normalizeEmailInput,
  });

  const defaultPhoneCountryCode = isUsCountryCode(countryOfIssue) || isCanadaCountryCode(countryOfIssue)
    ? "1"
    : null;
  const phoneCountryCode = await promptInput({
    label: "phone country code (digits only, no +)",
    defaultValue: defaultPhoneCountryCode,
    validate: (value) =>
      /^\d{1,3}$/.test(value) ? null : "enter 1 to 3 digits",
    normalize: normalizePhoneCountryCodeInput,
  });
  const phoneNumber = await promptInput({
    label: "phone number",
    validate: (value) =>
      /^\d{4,15}$/.test(value)
        ? null
        : "enter at least 4 digits (symbols are removed automatically)",
    normalize: normalizePhoneNumberInput,
  });

  const line1 = await promptInput({ label: "address line 1", normalize: normalizeWhitespace });
  const line2 = await promptInput({
    label: "address line 2",
    optional: true,
    normalize: normalizeWhitespace,
  });
  const city = await promptInput({ label: "city", normalize: normalizeWhitespace });
  const region = await promptInput({
    label: getKycRegionLabel(countryOfIssue),
    normalize: normalizeRegionInput,
  });
  const postalCode = await promptInput({
    label: "postal/zip code",
    normalize: normalizePostalCodeInput,
  });
  const countryCode = (
    await promptInput({
      label: "address country code (2 letters)",
      defaultValue: countryOfIssue,
      validate: (value) =>
        /^[A-Z]{2}$/.test(value) ? null : "use a 2-letter country code",
      normalize: normalizeCountryCodeInput,
    })
  );

  const occupation = await promptSelectOption({
    title: "occupation",
    choices: KYC_OCCUPATION_OPTIONS,
    allowCustom: true,
    customLabel: "Enter occupation code manually",
    customPromptLabel: "occupation code (for example 49-3023, SELFEMP)",
    customValidate: (value) =>
      /^[A-Z0-9-]{2,32}$/.test(value)
        ? null
        : "use letters, numbers, and hyphen only",
    customNormalize: normalizeOccupationCodeInput,
  });

  const annualSalary = await promptSelectOption({
    title: "annual salary range",
    choices: KYC_ANNUAL_SALARY_OPTIONS,
  });

  const accountPurpose = await promptSelectOption({
    title: "account purpose",
    choices: KYC_ACCOUNT_PURPOSE_OPTIONS,
  });

  const expectedMonthlyVolume = await promptSelectOption({
    title: "expected monthly volume",
    choices: KYC_EXPECTED_MONTHLY_VOLUME_OPTIONS,
  });

  const referralCode = await promptInput({
    label: "referral code",
    optional: true,
    normalize: (value) => String(value).trim().toUpperCase(),
    validate: (value) =>
      /^[A-Z]{6}$/.test(value) ? null : "referral code must be 6 letters",
  });

  const openAfterSubmit = await promptYesNo({
    label: "open verification link after submit",
    defaultValue: true,
  });

  const payload = {
    firstName,
    lastName,
    birthDate,
    countryOfIssue,
    ...(nationalId ? { nationalId } : {}),
    email,
    address: {
      line1,
      ...(line2 ? { line2 } : {}),
      city,
      region,
      postalCode,
      countryCode,
    },
    ...(phoneCountryCode && phoneNumber ? { phoneCountryCode, phoneNumber } : {}),
    occupation,
    annualSalary,
    accountPurpose,
    expectedMonthlyVolume,
    ...(referralCode ? { referralCode } : {}),
  };

  console.log("");
  console.log("review");
  for (const [label, value] of buildKycSummaryRows(payload)) {
    console.log(`- ${label}: ${value}`);
  }
  console.log("");

  const shouldSubmit = await promptYesNo({
    label: "submit this kyc application",
    defaultValue: true,
  });
  if (!shouldSubmit) {
    throw new CliError("kyc submit cancelled by user", 0);
  }

  return {
    payload,
    openAfterSubmit,
    waitAfterSubmit: false,
  };
}

async function submitUserKyc(payload, options = {}) {
  const { response } = await userApiRequest("/kyc", {
    method: "POST",
    body: payload,
  });

  if (!response.ok) {
    const baseMessage = withKycSubmitHint(
      extractErrorMessage(response.data, "unable to create user / submit kyc"),
    );
    const message = withOnboardingHint(baseMessage);
    throw new CliError(message);
  }

  const application = extractApplicationFromPayload(response.data);
  if (!application) {
    throw new CliError("kyc submit payload is invalid");
  }

  const shouldOpen = Boolean(options.open);
  const shouldWait = Boolean(options.wait);
  const noLaunchBrowser = Boolean(options.noLaunchBrowser);
  const json = Boolean(options.json);
  const verificationUrl = resolveVerificationUrl(application);

  if (shouldOpen && verificationUrl) {
    if (!noLaunchBrowser) {
      try {
        openBrowser(verificationUrl);
      } catch {
        // no-op
      }
    }
  }

  let finalApplication = application;
  if (shouldWait) {
    finalApplication = await waitForKycApproval({
      intervalSeconds: options.intervalSeconds,
      timeoutSeconds: options.timeoutSeconds,
      quiet: json,
    });
  }

  return {
    application: finalApplication,
    initialStatus: normalizeKycStatus(application.status),
    finalStatus: normalizeKycStatus(finalApplication.status),
    verificationUrl,
    openedBrowser: shouldOpen && Boolean(verificationUrl) && !noLaunchBrowser,
    waitingEnabled: shouldWait,
  };
}

async function createCliAuthFromWebToken({
  webToken,
  sessionWallet,
  sessionUserId,
  loginMethod,
}) {
  const keyCreateResponse = await requestJson(`${API_BASE_URL.replace(/\/$/, "")}/identity/user-api-keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${webToken}`,
    },
    body: {
      scopes: DEFAULT_USER_SCOPES,
      policy: DEFAULT_USER_POLICY,
    },
  });

  if (!keyCreateResponse.ok) {
    const message = extractErrorMessage(
      keyCreateResponse.data,
      "login could not create user api key",
    );
    throw new CliError(message);
  }

  const userApiKey =
    asNonEmptyString(keyCreateResponse.data?.userApiKey) ||
    asNonEmptyString(keyCreateResponse.data?.consumerApiKey);
  const userKeyId =
    asNonEmptyString(keyCreateResponse.data?.userKeyId) ||
    asNonEmptyString(keyCreateResponse.data?.consumerKeyId);

  if (!userApiKey || !userKeyId) {
    throw new CliError("login key creation returned invalid payload");
  }

  const mintedSessionResponse = await createSessionFromKey(userApiKey, {
    scopes: DEFAULT_USER_SCOPES,
    policy: DEFAULT_USER_POLICY,
  });

  if (!mintedSessionResponse.ok) {
    const message = extractErrorMessage(mintedSessionResponse.data, "login could not mint api session");
    throw new CliError(message);
  }

  const session = parseSessionResponse(mintedSessionResponse.data);
  if (!session) {
    throw new CliError("login session payload is invalid");
  }

  const auth = {
    version: 1,
    apiBaseUrl: API_BASE_URL,
    walletAddress:
      sessionWallet ||
      asNonEmptyString(keyCreateResponse.data?.walletAddress) ||
      "embedded-wallet",
    userId: sessionUserId || asNonEmptyString(keyCreateResponse.data?.userId),
    userApiKey,
    userKeyId,
    sessionToken: session.sessionToken,
    sessionId: session.sessionId,
    sessionExpiresAt: session.expiresAt,
    scopes: session.scopes.length > 0 ? session.scopes : DEFAULT_USER_SCOPES,
    obtainedAt: new Date().toISOString(),
    loginMethod,
  };

  await saveUserAuth(auth);
  return auth;
}

function printLoginSummary(auth, json, label = "logged in") {
  if (printJsonIfRequested(json, auth)) {
    return;
  }

  console.log(`${label}: ${maskAddress(auth.walletAddress)}`);
  console.log(`session expires: ${auth.sessionExpiresAt}`);
  console.log("saved auth: ~/.machines/cli/auth.json");
  console.log("menu: run `machines` or `machines home` anytime");
}

async function commandLoginWithEmailTokens(options, json) {
  const idToken = asNonEmptyString(options["id-token"]);
  const emailAccessToken = asNonEmptyString(options["access-token"]);
  if (!idToken && !emailAccessToken) {
    throw new CliError("--id-token or --access-token is required for token login");
  }

  const exchangeResponse = await requestJson(`${API_BASE_URL.replace(/\/$/, "")}/auth/email/exchange`, {
    method: "POST",
    body: {
      ...(idToken ? { idToken } : {}),
      ...(emailAccessToken ? { accessToken: emailAccessToken } : {}),
    },
  });

  if (!exchangeResponse.ok) {
    const message = extractErrorMessage(exchangeResponse.data, "email login failed");
    throw new CliError(message);
  }

  const webToken = asNonEmptyString(exchangeResponse.data?.token);
  const sessionWallet = asNonEmptyString(exchangeResponse.data?.session?.address);
  const sessionUserId = asNonEmptyString(exchangeResponse.data?.session?.userId);

  if (!webToken) {
    throw new CliError("email login succeeded but session token is missing");
  }

  const auth = await createCliAuthFromWebToken({
    webToken,
    sessionWallet,
    sessionUserId,
    loginMethod: "email",
  });

  printLoginSummary(auth, json, "logged in (email)");
}

async function commandLoginWithBrowser(options, json) {
  const noLaunchBrowser = shouldSkipBrowserLaunch(options);

  const startResponse = await requestJson(`${API_BASE_URL.replace(/\/$/, "")}/auth/cli/start`, {
    method: "POST",
    body: {},
  });

  if (!startResponse.ok) {
    const message = extractErrorMessage(
      startResponse.data,
      "browser login unavailable",
    );
    throw new CliError(message);
  }

  const requestToken = asNonEmptyString(startResponse.data?.requestToken);
  const loginCode = asNonEmptyString(startResponse.data?.code);
  const browserUrl = WEB_APP_BASE_URL_OVERRIDE
    ? buildCliWebAuthUrl(requestToken, loginCode)
    : asNonEmptyString(startResponse.data?.url) ??
      buildCliWebAuthUrl(requestToken, loginCode);
  const expiresAt = asNonEmptyString(startResponse.data?.expiresAt);
  const pollIntervalMsRaw = Number(startResponse.data?.pollIntervalMs);
  const pollIntervalMs = Number.isFinite(pollIntervalMsRaw) && pollIntervalMsRaw > 0
    ? Math.min(pollIntervalMsRaw, 5000)
    : 1500;

  if (!requestToken || !browserUrl) {
    throw new CliError("browser login payload is incomplete");
  }

  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Date.now() + 5 * 60_000;
  const deadline = Number.isNaN(expiresAtMs) ? Date.now() + 5 * 60_000 : expiresAtMs;

  if (!json) {
    console.log("browser login started");
    console.log(`open this URL: ${browserUrl}`);
    if (loginCode) {
      console.log(`login code: ${loginCode}`);
    }
    if (noLaunchBrowser) {
      console.log("open the URL in any browser, complete sign-in, then return here.");
    }
  }

  if (!noLaunchBrowser) {
    try {
      openBrowser(browserUrl);
    } catch {
      // user can open the URL manually
    }
  }

  while (Date.now() < deadline) {
    const completeResponse = await requestJson(`${API_BASE_URL.replace(/\/$/, "")}/auth/cli/poll`, {
      method: "POST",
      body: {
        requestToken,
      },
    });

    const status = asNonEmptyString(completeResponse.data?.status);
    if (completeResponse.status === 202 || status === "pending") {
      await sleep(pollIntervalMs);
      continue;
    }

    if (!completeResponse.ok) {
      const message = extractErrorMessage(completeResponse.data, "browser login failed");
      throw new CliError(message);
    }

    const webToken = asNonEmptyString(completeResponse.data?.token);
    const sessionWallet = asNonEmptyString(completeResponse.data?.session?.address);
    const sessionUserId = asNonEmptyString(completeResponse.data?.session?.userId);
    if (!webToken) {
      throw new CliError("browser login succeeded but token is missing");
    }

    const auth = await createCliAuthFromWebToken({
      webToken,
      sessionWallet,
      sessionUserId,
      loginMethod: "browser",
    });

    printLoginSummary(auth, json, "logged in (browser)");
    return;
  }

  throw new CliError("browser login timed out");
}

async function commandLoginWithAgentSignature(options, json) {
  const address = asNonEmptyString(options.address) || asNonEmptyString(process.env.MACHINES_WALLET_ADDRESS) || await prompt("wallet address: ");
  if (!address) {
    throw new CliError("wallet address is required");
  }

  const issuedAtDate = asNonEmptyString(options["issued-at"])
    ? new Date(options["issued-at"])
    : new Date();
  if (Number.isNaN(issuedAtDate.getTime())) {
    throw new CliError("invalid --issued-at timestamp");
  }

  const expiresAtDate = asNonEmptyString(options["expires-at"])
    ? new Date(options["expires-at"])
    : new Date(issuedAtDate.getTime() + 5 * 60_000);
  if (Number.isNaN(expiresAtDate.getTime())) {
    throw new CliError("invalid --expires-at timestamp");
  }

  const issuedAt = issuedAtDate.toISOString();
  const expiresAt = expiresAtDate.toISOString();
  const nonce = asNonEmptyString(options.nonce) || randomUUID();

  const keyScopes = [...DEFAULT_USER_SCOPES];
  const sessionScopes = [...DEFAULT_USER_SCOPES];
  const sessionTtlSeconds = asNonEmptyString(options["session-ttl"])
    ? parseInteger(options["session-ttl"], "session ttl")
    : undefined;

  const message = buildBootstrapMessage({ address, nonce, issuedAt, expiresAt });

  let signature = asNonEmptyString(options.signature) || null;
  if (!signature) {
    const privateKey =
      asNonEmptyString(options["private-key"]) ||
      asNonEmptyString(process.env.MACHINES_WALLET_PRIVATE_KEY) ||
      null;
    if (privateKey) {
      signature = await signBootstrapMessage(message, privateKey);
    }
  }

  if (!signature) {
    console.log("sign this exact message, then paste the signature:");
    console.log("---");
    console.log(message);
    console.log("---");
    signature = await prompt("signature: ");
  }

  if (!signature) {
    throw new CliError("signature is required");
  }

  const bootstrapResponse = await requestJson(`${USER_API_BASE_URL}/bootstrap`, {
    method: "POST",
    body: {
      address,
      signature,
      nonce,
      issuedAt,
      expiresAt,
      connector: asNonEmptyString(options.connector) || "unknown",
      chainId: asNonEmptyString(options["chain-id"]) || "unknown",
      walletLabel: asNonEmptyString(options["wallet-label"]) || "Machines CLI",
      scopes: keyScopes,
      sessionScopes,
      policy: DEFAULT_USER_POLICY,
      sessionPolicy: DEFAULT_USER_POLICY,
      ...(sessionTtlSeconds ? { sessionTtlSeconds } : {}),
    },
  });

  if (!bootstrapResponse.ok) {
    const message = extractErrorMessage(bootstrapResponse.data, "bootstrap login failed");
    throw new CliError(message);
  }

  const payload = bootstrapResponse.data;
  const userApiKey = asNonEmptyString(payload?.userApiKey) || asNonEmptyString(payload?.consumerApiKey);
  const userKeyId = asNonEmptyString(payload?.userKeyId) || asNonEmptyString(payload?.consumerKeyId);

  if (!userApiKey || !userKeyId) {
    throw new CliError("bootstrap succeeded but user key data is missing");
  }

  const fallbackSession = parseSessionResponse(payload);
  const mintedSessionResponse = await createSessionFromKey(userApiKey, {
    scopes: sessionScopes,
    policy: DEFAULT_USER_POLICY,
    ...(sessionTtlSeconds ? { ttlSeconds: sessionTtlSeconds } : {}),
  });

  let session = null;
  if (mintedSessionResponse.ok) {
    session = parseSessionResponse(mintedSessionResponse.data);
  }
  if (!session) {
    session = fallbackSession;
  }
  if (!session) {
    throw new CliError("login succeeded but session token is missing");
  }

  const auth = {
    version: 1,
    apiBaseUrl: API_BASE_URL,
    walletAddress: asNonEmptyString(payload?.walletAddress) || address,
    userId: asNonEmptyString(payload?.userId),
    userApiKey,
    userKeyId,
    sessionToken: session.sessionToken,
    sessionId: session.sessionId,
    sessionExpiresAt: session.expiresAt,
    scopes: session.scopes.length > 0 ? session.scopes : sessionScopes,
    obtainedAt: new Date().toISOString(),
    loginMethod: "agent",
  };

  await saveUserAuth(auth);
  printLoginSummary(auth, json, "logged in");
}

async function commandLogin(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const positionalMode = asNonEmptyString(options._?.[0])?.toLowerCase() || null;
  const idToken = asNonEmptyString(options["id-token"]);
  const emailAccessToken = asNonEmptyString(options["access-token"]);
  const hasAgentInputs = Boolean(
    asNonEmptyString(options.address) ||
      asNonEmptyString(options.signature) ||
      asNonEmptyString(options["private-key"]) ||
      asNonEmptyString(options.nonce) ||
      asNonEmptyString(options["issued-at"]) ||
      asNonEmptyString(options["expires-at"]) ||
      asNonEmptyString(options["chain-id"]) ||
      asNonEmptyString(options["wallet-label"]) ||
      asNonEmptyString(options.connector) ||
      asNonEmptyString(options["session-ttl"]),
  );
  const hasExplicitLoginRequest = Boolean(
    positionalMode ||
      options.browser === true ||
      options.agent === true ||
      options.email === true ||
      options.token === true ||
      idToken ||
      emailAccessToken ||
      hasAgentInputs,
  );

  if (!hasExplicitLoginRequest) {
    const existingAuth = await readUserAuthIfExists();
    if (existingAuth) {
      try {
        const refreshedAuth = await refreshSessionIfNeeded(existingAuth);
        printLoginSummary(refreshedAuth, json, "already signed in");
        if (shouldOpenHomeAfterLogin({ options, json, mode: "browser" })) {
          await commandHome([]);
        }
        return;
      } catch {
        // fall through to a fresh login flow if the saved auth can no longer refresh
      }
    }
  }

  let mode = positionalMode;
  if (options.browser === true) mode = "browser";
  if (options.agent === true) mode = "agent";
  if (options.email === true) mode = "email";
  if (options.token === true) mode = "token";
  if (!mode && (idToken || emailAccessToken)) mode = "token";
  if (!mode) mode = hasAgentInputs ? "agent" : "browser";

  if (mode === "browser") {
    await commandLoginWithBrowser(options, json);
    if (shouldOpenHomeAfterLogin({ options, json, mode })) {
      await commandHome([]);
    }
    return;
  }

  if (mode === "email") {
    throw new CliError(
      "email otp login in CLI is not available yet. use `machines login --browser` or provider token exchange for now",
    );
  }

  if (mode === "token") {
    await commandLoginWithEmailTokens(options, json);
    return;
  }

  if (mode && mode !== "agent") {
    throw new CliError("login mode must be one of: browser, email, agent");
  }

  await commandLoginWithAgentSignature(options, json);
}

async function commandUserCreate(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const browserMode = Boolean(options.browser);
  const interactiveMode = Boolean(options.interactive) || Boolean(options.questionnaire);
  const hasOpenOverride = Object.prototype.hasOwnProperty.call(options, "open");
  const hasWaitOverride = Object.prototype.hasOwnProperty.call(options, "wait");
  let shouldOpen = Boolean(options.open);
  let shouldWait = Boolean(options.wait);
  const noLaunchBrowser = shouldSkipBrowserLaunch(options);

  if (browserMode) {
    await openKycBrowserFlow({ json, noLaunchBrowser });
    return;
  }

  let payload;
  if (interactiveMode) {
    const asked = await promptKycQuestionnaire(options);
    payload = asked.payload;
    if (!hasOpenOverride) shouldOpen = asked.openAfterSubmit;
    if (!hasWaitOverride) shouldWait = asked.waitAfterSubmit;
  } else {
    try {
      payload = await buildCreateUserPayloadFromOptions(options);
    } catch (error) {
      if (
        error instanceof CliError &&
        /invalid or missing user create fields:/i.test(error.message) &&
        canPrompt({ json })
      ) {
        const startMode = await promptUserCreateMode();
        if (startMode === "browser") {
          await openKycBrowserFlow({ json, noLaunchBrowser });
          return;
        }
        const asked = await promptKycQuestionnaire(options);
        payload = asked.payload;
        if (!hasOpenOverride) shouldOpen = asked.openAfterSubmit;
        if (!hasWaitOverride) shouldWait = asked.waitAfterSubmit;
      } else {
        throw error;
      }
    }
  }

  const result = await submitUserKyc(payload, {
    open: shouldOpen,
    wait: shouldWait,
    noLaunchBrowser,
    intervalSeconds: options["interval-seconds"],
    timeoutSeconds: options["timeout-seconds"],
    json,
  });

  if (
    printJsonIfRequested(json, {
      application: result.application,
      status: result.finalStatus,
      verificationUrl: result.verificationUrl,
      openedBrowser: result.openedBrowser,
      waitingEnabled: result.waitingEnabled,
    })
  ) {
    return;
  }

  printActionOutcome({
    status: result.initialStatus,
    result: "user created / kyc submitted",
    next: result.verificationUrl
      ? "continue in hosted verification"
      : "run `machines kyc status`",
  });
  if (result.verificationUrl) {
    console.log(`verification link: ${result.verificationUrl}`);
    if (shouldOpen) {
      if (noLaunchBrowser) {
        console.log("browser launch skipped (--no-launch-browser)");
      } else {
        console.log("opened verification link in browser");
      }
    }
  }
  if (!result.verificationUrl) {
    console.log("verification link not available yet");
  }
  if (result.waitingEnabled) {
    console.log(`kyc final status: ${result.finalStatus}`);
  }
}

async function commandUser(args) {
  if (args.length === 0 || hasHelpFlag(args)) {
    printUserHelp();
    return;
  }

  const command = args[0];
  if (command === "create") {
    await commandUserCreate(args.slice(1));
    return;
  }

  throw new CliError(`unknown user command: ${command}`);
}

async function commandKycStatus(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const statusPayload = await fetchKycStatus();
  const application = statusPayload.application;
  const normalizedStatus = normalizeKycStatus(application.status);
  const verificationUrl = resolveVerificationUrl(application);

  if (
    printJsonIfRequested(json, {
      application,
      status: normalizedStatus,
      classification: classifyKycStatus(normalizedStatus),
      verificationUrl,
    })
  ) {
    return;
  }

  printActionOutcome({
    status: normalizedStatus,
    result: "kyc status",
    next: normalizedStatus === "approved" ? "run `machines card create`" : "run `machines kyc open` to continue",
  });
  if (asNonEmptyString(application.reason)) {
    console.log(`reason: ${application.reason}`);
  }
  if (verificationUrl) {
    console.log(`verification link: ${verificationUrl}`);
  }
}

async function commandKycOpen(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const noLaunchBrowser = shouldSkipBrowserLaunch(options);
  const statusPayload = await fetchKycStatus();
  const application = statusPayload.application;
  const status = normalizeKycStatus(application.status);

  if (status === "approved") {
    if (
      printJsonIfRequested(json, {
        status,
        verificationUrl: null,
        openedBrowser: false,
      })
    ) {
      return;
    }
    printActionOutcome({
      status,
      result: "kyc already complete",
      next: "run `machines card create`",
    });
    return;
  }

  const opened = await openKycBrowserFlow({ application, noLaunchBrowser, quiet: json });
  if (
    printJsonIfRequested(json, {
      status,
      verificationUrl: opened.url,
      openedBrowser: opened.openedBrowser,
    })
  ) {
    return;
  }
  console.log(`kyc status: ${status}`);
  if (opened?.url && resolveVerificationUrl(application) !== opened.url) {
    console.log("opened web kyc page because a direct verification link is not available yet.");
  }
}

async function commandKycWait(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);

  const application = await waitForKycApproval({
    intervalSeconds: options["interval-seconds"],
    timeoutSeconds: options["timeout-seconds"],
    quiet: json,
  });

  if (printJsonIfRequested(json, { application, status: normalizeKycStatus(application.status) })) {
    return;
  }

  printActionOutcome({
    status: normalizeKycStatus(application.status),
    result: "kyc approved",
    next: "run `machines card create`",
  });
}

async function commandKycQuestionnaire(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const noLaunchBrowser = shouldSkipBrowserLaunch(options);
  const hasOpenOverride = Object.prototype.hasOwnProperty.call(options, "open");
  const hasWaitOverride = Object.prototype.hasOwnProperty.call(options, "wait");
  const asked = await promptKycQuestionnaire(options);
  const shouldOpen = hasOpenOverride ? Boolean(options.open) : asked.openAfterSubmit;
  const shouldWait = hasWaitOverride ? Boolean(options.wait) : asked.waitAfterSubmit;

  const result = await submitUserKyc(asked.payload, {
    open: shouldOpen,
    wait: shouldWait,
    noLaunchBrowser,
    intervalSeconds: options["interval-seconds"],
    timeoutSeconds: options["timeout-seconds"],
    json,
  });

  if (
    printJsonIfRequested(json, {
      application: result.application,
      status: result.finalStatus,
      verificationUrl: result.verificationUrl,
      openedBrowser: result.openedBrowser,
      waitingEnabled: result.waitingEnabled,
      mode: "questionnaire",
    })
  ) {
    return;
  }

  printActionOutcome({
    status: result.initialStatus,
    result: "kyc submitted",
    next: result.waitingEnabled ? "waiting completed" : "run `machines kyc status`",
  });
  if (result.verificationUrl) {
    console.log(`verification link: ${result.verificationUrl}`);
  }
  if (result.waitingEnabled) {
    console.log(`kyc final status: ${result.finalStatus}`);
  }
}

async function commandKyc(args) {
  if (args.length === 0 || hasHelpFlag(args)) {
    printKycHelp();
    return;
  }

  const command = args[0];
  if (command === "questionnaire" || command === "wizard") {
    await commandKycQuestionnaire(args.slice(1));
    return;
  }
  if (command === "status") {
    await commandKycStatus(args.slice(1));
    return;
  }
  if (command === "open") {
    await commandKycOpen(args.slice(1));
    return;
  }
  if (command === "wait") {
    await commandKycWait(args.slice(1));
    return;
  }

  throw new CliError(`unknown kyc command: ${command}`);
}

async function createCardRecord(options = {}) {
  const name = asNonEmptyString(options.name);
  const limitValue = options.limit !== undefined && options.limit !== null
    ? parseNumber(options.limit, "limit")
    : null;
  if (limitValue !== null && limitValue <= 0) {
    throw new CliError("limit must be greater than zero");
  }

  const frequency =
    asNonEmptyString(options.frequency) ||
    (limitValue !== null ? "per30DayPeriod" : null);

  const body = {};
  if (name) {
    body.encryptedName = await encryptValue(name);
  }
  if (limitValue !== null) {
    body.limit = {
      amount: limitValue,
      frequency,
    };
  }

  const { response } = await userApiRequest("/cards", {
    method: "POST",
    body,
    idempotencyKey: randomUUID(),
  });

  if (!response.ok) {
    const message = withOnboardingHint(extractErrorMessage(response.data, "unable to create card"));
    throw new CliError(message);
  }

  const card = extractCardFromPayload(response.data);
  if (!card) {
    throw new CliError("card create response is missing card");
  }

  return {
    response,
    card,
  };
}

async function commandCardCreate(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const shouldReveal = parseBooleanFlagValue(options.reveal, false);

  const { response, card } = await createCardRecord({
    name: options.name,
    limit: options.limit,
    frequency: options.frequency,
  });

  if (shouldReveal) {
    const revealPayload = await revealCardDetailsForCard(card);
    const output = {
      ...response.data,
      reveal: revealPayload,
    };
    if (printJsonIfRequested(json, output)) {
      return;
    }
    printActionOutcome({
      status: asNonEmptyString(card?.status) || "active",
      result: "card created",
      next: "details shown below",
    });
    printRevealedCardDetails(revealPayload, { showSummary: false });
    return;
  }

  if (printJsonIfRequested(json, response.data)) {
    return;
  }

  const last4 = asNonEmptyString(card?.last4) || "----";
  printActionOutcome({
    status: asNonEmptyString(card?.status) || "active",
    result: `card created: ••••${last4}`,
    next: "run `machines card list`",
  });
}

async function commandCardList(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);

  const { response } = await userApiRequest("/cards", { method: "GET" });
  if (!response.ok) {
    const message = withOnboardingHint(extractErrorMessage(response.data, "unable to list cards"));
    throw new CliError(message);
  }

  const cards = extractCards(response.data);
  const namesById = await decryptCardNames(cards).catch(() => new Map());
  const normalizedCards = cards.map((card) => ({
    ...card,
    name: namesById.get(String(card.id)) || null,
  }));

  if (printJsonIfRequested(json, { cards: normalizedCards })) {
    return;
  }

  if (normalizedCards.length === 0) {
    console.log("no cards found");
    return;
  }

  for (const card of normalizedCards) {
    const label = card.name || `card ••••${asNonEmptyString(card.last4) || "----"}`;
    const status = asNonEmptyString(card.status) || "unknown";
    const limit = formatLimit(card.limit);
    const expMonth = normalizeExpiryMonth(card.expirationMonth) || "--";
    const expYear = normalizeExpiryYear(card.expirationYear) || "----";
    console.log(`${label} | ${status} | ${limit} | exp ${expMonth}/${expYear}`);
  }
}

async function commandCardReveal(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);

  const requestedId = asNonEmptyString(options.id);
  const requestedLast4 = normalizeLast4(options.last4);

  const listResponse = await userApiRequest("/cards", { method: "GET" });
  if (!listResponse.response.ok) {
    const message = withOnboardingHint(extractErrorMessage(listResponse.response.data, "unable to list cards"));
    throw new CliError(message);
  }

  const cards = extractCards(listResponse.response.data);
  const selected = pickCardForReveal(cards, requestedLast4, requestedId);
  if (!selected) {
    throw new CliError(
      requestedId
        ? `no card found with id ${requestedId}`
        : requestedLast4
          ? `no card found ending with ${requestedLast4}`
          : "no card available to reveal",
    );
  }
  const revealPayload = await revealCardDetailsForCard(selected);

  if (printJsonIfRequested(json, revealPayload)) {
    return;
  }

  printRevealedCardDetails(revealPayload);
}

async function commandCardUpdate(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);

  const target = await resolveCardTarget(options, { json });
  const name = asNonEmptyString(options.name);
  const status = options.status !== undefined ? parseCardStatus(options.status) : null;
  const limitInput = options.limit !== undefined ? options.limit : options.amount;
  const hasLimit = limitInput !== undefined;

  const body = {};

  if (name) {
    body.encryptedName = await encryptValue(name);
  }

  if (status) {
    body.status = status;
  }

  if (hasLimit) {
    const limitAmount = parseNumber(limitInput, "limit");
    if (limitAmount <= 0) {
      throw new CliError("limit must be greater than zero");
    }
    const limitFrequency = parseCardLimitFrequency(options.frequency);
    body.limit = {
      amount: limitAmount,
      frequency: limitFrequency,
    };
  }

  if (Object.keys(body).length === 0) {
    throw new CliError("provide at least one update: --name, --status, --limit, or --amount");
  }

  const { response } = await userApiRequest(`/cards/${target.cardId}`, {
    method: "PATCH",
    body,
    idempotencyKey: randomUUID(),
  });

  if (!response.ok) {
    const message = withOnboardingHint(extractErrorMessage(response.data, "unable to update card"));
    throw new CliError(message);
  }

  if (printJsonIfRequested(json, response.data)) {
    return;
  }

  const card = extractCardFromPayload(response.data);
  const last4 = asNonEmptyString(card?.last4) || (target.selector === "last4" ? target.selectorValue : null) || "----";
  printActionOutcome({
    status: "updated",
    result: `card updated: ••••${last4}`,
    next: "run `machines card list`",
  });
  if (status) {
    console.log(`status: ${status}`);
  }
  if (body.limit) {
    const currentLimit = body.limit || card?.limit;
    console.log(`limit: ${formatLimit(currentLimit)}`);
  }
}

async function commandCardSetStatus(args, nextStatus, actionLabel) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const target = await resolveCardTarget(options, { json });

  const { response } = await userApiRequest(`/cards/${target.cardId}`, {
    method: "PATCH",
    body: {
      status: nextStatus,
    },
    idempotencyKey: randomUUID(),
  });

  if (!response.ok) {
    const message = withOnboardingHint(extractErrorMessage(response.data, `unable to ${actionLabel} card`));
    throw new CliError(message);
  }

  if (printJsonIfRequested(json, response.data)) {
    return;
  }

  const card = extractCardFromPayload(response.data);
  const last4 = asNonEmptyString(card?.last4) || (target.selector === "last4" ? target.selectorValue : null) || "----";
  printActionOutcome({
    status: nextStatus,
    result: `card ${actionLabel}ed: ••••${last4}`,
    next: "run `machines card list`",
  });
}

async function commandCardDelete(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const target = await resolveCardTarget(options, { json });

  if (!RUNTIME_FLAGS.yes && canPrompt({ json })) {
    const shouldDelete = await promptYesNo({
      label: "delete this card now",
      defaultValue: false,
    });
    if (!shouldDelete) {
      throw new CliError("card delete cancelled by user", 0);
    }
  }

  const { response } = await userApiRequest(`/cards/${target.cardId}/delete-now`, {
    method: "POST",
    body: {},
    idempotencyKey: randomUUID(),
  });

  if (!response.ok) {
    const message = withOnboardingHint(extractErrorMessage(response.data, "unable to delete card"));
    throw new CliError(message);
  }

  if (printJsonIfRequested(json, response.data)) {
    return;
  }

  const card = extractCardFromPayload(response.data);
  const last4 = asNonEmptyString(card?.last4) || (target.selector === "last4" ? target.selectorValue : null) || "----";
  printActionOutcome({
    status: "deleted",
    result: `card deleted: ••••${last4}`,
    next: "run `machines card create` to issue a new card",
  });
}

async function commandCardLimitSet(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);

  const amountInput = await resolveRequiredInput({
    options,
    currentValue: options.amount !== undefined ? options.amount : options.limit,
    label: "amount (usd)",
    example: "500",
    normalize: (value) => String(value).trim(),
    validate: (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return "amount must be greater than zero";
      }
      return null;
    },
    json,
  });

  const amount = parseNumber(amountInput, "amount");
  if (amount <= 0) {
    throw new CliError("amount must be greater than zero");
  }

  const target = await resolveCardTarget(options, { json });
  const frequency = parseCardLimitFrequency(options.frequency);
  const { response } = await userApiRequest(`/cards/${target.cardId}`, {
    method: "PATCH",
    body: {
      limit: {
        amount,
        frequency,
      },
    },
    idempotencyKey: randomUUID(),
  });

  if (!response.ok) {
    const message = withOnboardingHint(extractErrorMessage(response.data, "unable to set card limit"));
    throw new CliError(message);
  }

  if (printJsonIfRequested(json, response.data)) {
    return;
  }

  const card = extractCardFromPayload(response.data);
  const last4 = asNonEmptyString(card?.last4) || (target.selector === "last4" ? target.selectorValue : null) || "----";
  printActionOutcome({
    status: "updated",
    result: `limit updated: ••••${last4}`,
    next: "run `machines card list`",
  });
  console.log(`limit: ${formatLimit({ amount, frequency })}`);
}

async function commandCardLimit(args) {
  if (args.length === 0 || hasHelpFlag(args)) {
    printCardLimitHelp();
    return;
  }

  const subcommand = args[0];
  if (subcommand === "set") {
    await commandCardLimitSet(args.slice(1));
    return;
  }

  throw new CliError(`unknown card limit command: ${subcommand}`);
}

async function commandDisposableCreate(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);

  const amountCentsInput = await resolveRequiredInput({
    options,
    currentValue: options["amount-cents"],
    label: "amount-cents",
    example: "5000",
    normalize: (value) => String(value).trim(),
    validate: (value) => {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return "amount-cents must be greater than zero";
      }
      return null;
    },
    json,
  });

  const amountCents = parseInteger(amountCentsInput, "amount-cents");
  if (amountCents <= 0) {
    throw new CliError("amount-cents must be greater than zero");
  }

  const currency = (asNonEmptyString(options.currency) || "USD").toUpperCase();
  const limitFrequency = asNonEmptyString(options.frequency) || "perAuthorization";
  const autoCancelAfterAuth =
    options["no-auto-cancel-after-auth"] === true
      ? false
      : options["auto-cancel-after-auth"] === true
        ? true
        : undefined;

  const encryptedName = asNonEmptyString(options.name)
    ? await encryptValue(options.name)
    : undefined;

  const proposalIdempotencyKey = randomUUID();
  const proposalResponse = await userApiRequest("/cards/disposable/proposals", {
    method: "POST",
    idempotencyKey: proposalIdempotencyKey,
    body: {
      amountCents,
      currency,
      limitFrequency,
      ...(typeof autoCancelAfterAuth === "boolean" ? { autoCancelAfterAuth } : {}),
    },
  });

  if (!proposalResponse.response.ok) {
    const message = withOnboardingHint(extractErrorMessage(proposalResponse.response.data, "unable to create disposable proposal"));
    throw new CliError(message);
  }

  const proposal = proposalResponse.response.data?.disposable ||
    proposalResponse.response.data?.data?.disposable ||
    null;
  const proposalId = asNonEmptyString(proposal?.proposalId);
  if (!proposalId) {
    throw new CliError("disposable proposal id is missing");
  }

  const executeIdempotencyKey = randomUUID();
  const executeResponse = await userApiRequest("/cards/disposable/execute", {
    method: "POST",
    idempotencyKey: executeIdempotencyKey,
    body: {
      proposalId,
      ...(encryptedName ? { encryptedName } : {}),
    },
  });

  if (!executeResponse.response.ok) {
    const message = withOnboardingHint(extractErrorMessage(executeResponse.response.data, "unable to execute disposable proposal"));
    throw new CliError(message);
  }

  const card = executeResponse.response.data?.card ||
    executeResponse.response.data?.data?.card ||
    null;

  const payload = {
    proposal: executeResponse.response.data?.disposable || proposal,
    card,
  };

  if (printJsonIfRequested(json, payload)) {
    return;
  }

  const last4 = asNonEmptyString(card?.last4) || "----";
  printActionOutcome({
    status: "ready",
    result: `disposable card ready: ••••${last4}`,
    next: "use card immediately or reveal details",
  });
  console.log(`amount: ${formatUsdFromCents(amountCents)} (${limitFrequency})`);
}

async function copyDir(sourceDir, targetDir) {
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

function upsertCodexMcpSection(configToml) {
  const sectionName = "[mcp_servers.machines]";
  const sectionBody = `${sectionName}\nurl = \"${MCP_SERVER_URL}\"\n`;
  const sectionRegex = /^\[mcp_servers\.machines\][\s\S]*?(?=^\[[^\]]+\]|\Z)/m;

  if (sectionRegex.test(configToml)) {
    return configToml.replace(sectionRegex, sectionBody);
  }

  const suffix = configToml.endsWith("\n") ? "" : "\n";
  return `${configToml}${suffix}\n${sectionBody}`;
}

async function installCodex() {
  const home = os.homedir();
  const codexSkillDir = path.join(home, ".codex", "skills", SKILL_NAME);
  const codexConfigPath = path.join(home, ".codex", "config.toml");

  await copyDir(skillSourceDir, codexSkillDir);

  let configToml = "";
  if (await pathExists(codexConfigPath)) {
    configToml = await fs.readFile(codexConfigPath, "utf8");
  }

  const nextConfigToml = upsertCodexMcpSection(configToml);
  await ensureDir(path.dirname(codexConfigPath));
  await fs.writeFile(codexConfigPath, nextConfigToml, "utf8");

  return {
    configPath: codexConfigPath,
    skillPath: codexSkillDir,
  };
}

async function installClaude() {
  const home = os.homedir();
  const claudeSkillDir = path.join(home, ".claude", "skills", SKILL_NAME);
  const claudeSettingsPath = path.join(home, ".claude", "settings.json");

  await copyDir(skillSourceDir, claudeSkillDir);

  let settings = {};
  if (await pathExists(claudeSettingsPath)) {
    try {
      settings = JSON.parse(await fs.readFile(claudeSettingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    settings = {};
  }

  if (!settings.mcpServers || typeof settings.mcpServers !== "object" || Array.isArray(settings.mcpServers)) {
    settings.mcpServers = {};
  }

  settings.mcpServers.machines = {
    transport: "http",
    url: MCP_SERVER_URL,
  };

  await ensureDir(path.dirname(claudeSettingsPath));
  await fs.writeFile(claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  return {
    settingsPath: claudeSettingsPath,
    skillPath: claudeSkillDir,
  };
}

async function installCopilot() {
  const configPath = path.join(process.cwd(), ".vscode", "mcp.json");

  let config = {};
  if (await pathExists(configPath)) {
    try {
      config = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch {
      config = {};
    }
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    config = {};
  }

  const servers = config.servers && typeof config.servers === "object" && !Array.isArray(config.servers)
    ? config.servers
    : {};

  servers.machines = {
    type: "http",
    url: MCP_SERVER_URL,
    headers: {
      "X-User-Key": "${input:machines_user_key}",
    },
  };

  const inputs = Array.isArray(config.inputs) ? [...config.inputs] : [];
  const hasPrompt = inputs.some((entry) => entry && entry.id === "machines_user_key");
  if (!hasPrompt) {
    inputs.push({
      id: "machines_user_key",
      type: "promptString",
      description: "Machines user API key",
      password: true,
    });
  }

  const nextConfig = {
    ...config,
    servers,
    inputs,
  };

  await ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  return {
    configPath,
  };
}

async function installChatgpt() {
  const outputPath = path.join(CLI_AUTH_DIR, "chatgpt-mcp.json");
  const config = {
    mcpEndpoint: MCP_SERVER_URL,
    authorizationServer: `${MCP_BASE_URL.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
    oauthRegisterEndpoint: `${MCP_BASE_URL.replace(/\/$/, "")}/oauth/register`,
    notes: [
      "ChatGPT connector setup is done in ChatGPT settings.",
      "Use this file as a copy-ready reference.",
    ],
  };
  await writeJson(outputPath, config);
  return { outputPath };
}

function openBrowser(url) {
  const openArgsByPlatform = {
    darwin: ["open", [url]],
    win32: ["cmd", ["/c", "start", "", url]],
    linux: ["xdg-open", [url]],
  };

  const [command, args] = openArgsByPlatform[process.platform] || openArgsByPlatform.linux;
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function buildCallbackPageHtml(message) {
  return `<!doctype html><html><head><meta charset=\"utf-8\"/><title>Machines Auth</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/></head><body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b0b0b;color:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;\"><div style=\"max-width:420px;padding:16px;border:1px solid #2a2a2a;border-radius:12px;background:#111\">${message}<div style=\"margin-top:8px;color:#9ca3af;font-size:13px\">You can close this window.</div></div></body></html>`;
}

async function exchangeOAuthCode(options) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: options.clientId,
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  });

  const response = await requestJson(`${MCP_BASE_URL.replace(/\/$/, "")}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const message = extractErrorMessage(response.data, "token exchange failed");
    throw new CliError(message);
  }

  if (!response.data || typeof response.data !== "object" || typeof response.data.access_token !== "string") {
    throw new CliError("invalid token response");
  }

  return response.data;
}

async function saveMcpAuth(payload) {
  const out = {
    mcpBaseUrl: MCP_BASE_URL,
    mcpServerUrl: MCP_SERVER_URL,
    clientId: MCP_CONNECT_CLIENT_ID,
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null,
    scope: typeof payload.scope === "string" ? payload.scope : "*",
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    obtainedAt: new Date().toISOString(),
  };

  await writeJson(MCP_AUTH_PATH, out);
  return out;
}

async function commandMcpInstall(args) {
  const options = parseOptions(args);
  const host = (asNonEmptyString(options.host) || "all").toLowerCase();
  if (!["codex", "claude", "copilot", "chatgpt", "all", "both"].includes(host)) {
    throw new CliError("--host must be codex, claude, copilot, chatgpt, or all");
  }

  const installs = [];

  if (["codex", "all", "both"].includes(host)) {
    const result = await installCodex();
    installs.push({ host: "codex", ...result });
  }

  if (["claude", "all", "both"].includes(host)) {
    const result = await installClaude();
    installs.push({ host: "claude", ...result });
  }

  if (["copilot", "all"].includes(host)) {
    const result = await installCopilot();
    installs.push({ host: "copilot", ...result });
  }

  if (["chatgpt", "all"].includes(host)) {
    const result = await installChatgpt();
    installs.push({ host: "chatgpt", ...result });
  }

  for (const install of installs) {
    console.log(`installed ${install.host}`);
    if (install.configPath) console.log(`  config: ${install.configPath}`);
    if (install.settingsPath) console.log(`  settings: ${install.settingsPath}`);
    if (install.skillPath) console.log(`  skill: ${install.skillPath}`);
    if (install.outputPath) console.log(`  reference: ${install.outputPath}`);
  }

  if (host === "chatgpt" || host === "all") {
    console.log("chatgpt connector setup: open ChatGPT settings > connectors and add remote MCP endpoint");
    console.log(`endpoint: ${MCP_SERVER_URL}`);
  }
}

async function commandMcpAuthLogin(args) {
  const options = parseOptions(args);
  const manualKey = Boolean(options["manual-key"]);
  const noLaunchBrowser = shouldSkipBrowserLaunch(options);

  const state = createState();
  const codeVerifier = createPkceVerifier();
  const codeChallenge = createPkceChallenge(codeVerifier);

  const authResult = await new Promise((resolve, reject) => {
    const timeoutMs = 5 * 60_000;
    let settled = false;
    let timeout;
    let redirectUri = "";

    const closeServer = (server) =>
      new Promise((done) => server.close(() => done()));

    const server = createServer(async (req, res) => {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/callback") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }

      const incomingState = requestUrl.searchParams.get("state");
      if (!incomingState || incomingState !== state) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(buildCallbackPageHtml("Invalid OAuth state."));
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          await closeServer(server);
          reject(new CliError("state mismatch during OAuth callback"));
        }
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const errorDescription = requestUrl.searchParams.get("error_description");
      const code = requestUrl.searchParams.get("code");

      if (error) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(buildCallbackPageHtml(`Authorization failed: ${errorDescription || error}`));
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          await closeServer(server);
          reject(new CliError(errorDescription || error));
        }
        return;
      }

      if (!code) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(buildCallbackPageHtml("Missing authorization code."));
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          await closeServer(server);
          reject(new CliError("authorization code missing"));
        }
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(buildCallbackPageHtml("Authorization complete."));

      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        await closeServer(server);
        resolve({ code, redirectUri });
      }
    });

    server.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      if (!port) {
        reject(new CliError("failed to bind local callback server"));
        return;
      }

      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authorizeUrl = new URL(`${MCP_BASE_URL.replace(/\/$/, "")}/oauth/authorize`);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", MCP_CONNECT_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("scope", "*");
      authorizeUrl.searchParams.set("code_challenge", codeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      if (manualKey) {
        authorizeUrl.searchParams.set("auth_mode", "consumer_key");
      }

      console.log("opening browser for Machines MCP login...");
      console.log(`if browser does not open, visit: ${authorizeUrl.toString()}`);
      if (!noLaunchBrowser) {
        try {
          openBrowser(authorizeUrl.toString());
        } catch {
          // no-op, user can open URL manually
        }
      } else {
        console.log("browser launch skipped (MACHINES_NO_LAUNCH_BROWSER or --no-launch-browser)");
      }

      timeout = setTimeout(async () => {
        if (settled) return;
        settled = true;
        await closeServer(server);
        reject(new CliError("oauth login timed out"));
      }, timeoutMs);
    });
  });

  const tokenPayload = await exchangeOAuthCode({
    clientId: MCP_CONNECT_CLIENT_ID,
    code: authResult.code,
    redirectUri: authResult.redirectUri,
    codeVerifier,
  });

  await saveMcpAuth(tokenPayload);
  console.log("mcp login complete: ~/.machines/cli/mcp-auth.json");
}

async function commandMcpDoctor(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const home = os.homedir();

  const checks = [
    {
      name: "codex config",
      path: path.join(home, ".codex", "config.toml"),
    },
    {
      name: "codex skill",
      path: path.join(home, ".codex", "skills", SKILL_NAME, "SKILL.md"),
    },
    {
      name: "claude settings",
      path: path.join(home, ".claude", "settings.json"),
    },
    {
      name: "claude skill",
      path: path.join(home, ".claude", "skills", SKILL_NAME, "SKILL.md"),
    },
    {
      name: "copilot config",
      path: path.join(process.cwd(), ".vscode", "mcp.json"),
    },
    {
      name: "chatgpt reference",
      path: path.join(CLI_AUTH_DIR, "chatgpt-mcp.json"),
    },
    {
      name: "mcp auth cache",
      path: MCP_AUTH_PATH,
    },
  ];

  const results = [];
  for (const check of checks) {
    const exists = await pathExists(check.path);
    results.push({
      ...check,
      exists,
    });
  }

  let oauthStatus = null;
  try {
    const response = await requestJson(`${MCP_BASE_URL.replace(/\/$/, "")}/.well-known/oauth-authorization-server`, {
      timeoutMs: 8_000,
    });
    oauthStatus = {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    oauthStatus = {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const output = {
    checks: results,
    oauthMetadata: oauthStatus,
  };

  if (printJsonIfRequested(json, output)) {
    return;
  }

  for (const result of results) {
    console.log(`${result.exists ? "ok" : "missing"}  ${result.name}: ${result.path}`);
  }

  if (oauthStatus.ok) {
    console.log(`ok  oauth metadata: ${oauthStatus.status}`);
  } else {
    console.log(`warn  oauth metadata: ${oauthStatus?.error || oauthStatus?.status || "unreachable"}`);
  }
}

async function commandDoctor(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);

  const checks = [];
  const authExists = await pathExists(CLI_AUTH_PATH);
  checks.push({
    name: "cli auth",
    path: CLI_AUTH_PATH,
    exists: authExists,
  });

  let apiProbe = null;
  if (authExists) {
    try {
      const { response } = await userApiRequest("/cards", {
        method: "GET",
        timeoutMs: 8_000,
      });
      apiProbe = {
        ok: response.ok,
        status: response.status,
      };
    } catch (error) {
      apiProbe = {
        ok: false,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  let mcpProbe = null;
  try {
    const response = await requestJson(`${MCP_BASE_URL.replace(/\/$/, "")}/.well-known/oauth-authorization-server`, {
      timeoutMs: 8_000,
    });
    mcpProbe = {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    mcpProbe = {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const output = {
    checks,
    apiProbe,
    mcpProbe,
  };

  if (printJsonIfRequested(json, output)) {
    return;
  }

  for (const check of checks) {
    console.log(`${check.exists ? "ok" : "missing"}  ${check.name}: ${check.path}`);
  }

  if (apiProbe) {
    if (apiProbe.ok) {
      console.log(`ok  user api probe: ${apiProbe.status}`);
    } else {
      console.log(`warn  user api probe: ${apiProbe.error || apiProbe.status || "failed"}`);
    }
  }

  if (mcpProbe.ok) {
    console.log(`ok  mcp oauth metadata: ${mcpProbe.status}`);
  } else {
    console.log(`warn  mcp oauth metadata: ${mcpProbe.error || mcpProbe.status || "failed"}`);
  }
}

async function commandLogout(args) {
  const options = parseOptions(args);
  const json = Boolean(options.json);
  const clearAll = Boolean(options.all);
  const payload = await clearCliAuth({ all: clearAll });

  if (printJsonIfRequested(json, payload)) {
    return;
  }

  printActionOutcome({
    status: "signed_out",
    result: "logout complete",
    next: "run `machines login` to sign in again",
  });
  if (clearAll && hadMcp) {
    console.log("cleared mcp auth cache");
  }
}

function buildCompletionScript(shell) {
  const scriptBase = `
_machines_complete()
{
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  opts="home login logout user create kyc card disposable mcp doctor completion --help --json --non-interactive --yes --no-color"
  COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
  return 0
}
`;
  if (shell === "bash") {
    return `${scriptBase}\ncomplete -F _machines_complete machines\n`;
  }
  if (shell === "zsh") {
    return `#compdef machines\n_machines_complete() {\n  local -a opts\n  opts=(home login logout user create kyc card disposable mcp doctor completion --help --json --non-interactive --yes --no-color)\n  _describe 'command' opts\n}\ncompdef _machines_complete machines\n`;
  }
  if (shell === "fish") {
    return `complete -c machines -f\ncomplete -c machines -a "home login logout user create kyc card disposable mcp doctor completion"\ncomplete -c machines -l help\ncomplete -c machines -l json\ncomplete -c machines -l non-interactive\ncomplete -c machines -l yes\ncomplete -c machines -l no-color\n`;
  }
  throw new CliError("completion shell must be one of: bash, zsh, fish");
}

async function commandCompletion(args) {
  if (args.length === 0 || hasHelpFlag(args)) {
    printCompletionHelp();
    return;
  }
  const shell = asNonEmptyString(args[0])?.toLowerCase();
  if (!shell) {
    throw new CliError("completion shell is required");
  }
  console.log(buildCompletionScript(shell));
}

function formatSessionExpiry(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return "unknown";
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw;
  return new Date(ms).toISOString();
}

async function fetchCardsWithNamesForHome() {
  const { response } = await userApiRequest("/cards", { method: "GET" });
  if (!response.ok) {
    const message = withOnboardingHint(extractErrorMessage(response.data, "unable to list cards"));
    throw new CliError(message);
  }
  const cards = extractCards(response.data);
  const namesById = await decryptCardNames(cards).catch(() => new Map());
  return cards.map((card) => ({
    ...card,
    name: namesById.get(String(card.id)) || null,
  }));
}

function clearScreen() {
  if (!RUNTIME_FLAGS.noColor && process.stdout.isTTY) {
    process.stdout.write("\u001Bc");
  }
}

function printHomeFrame(title, subtitle = null) {
  clearScreen();
  printMachinesAscii();
  console.log("");
  const normalizedTitle = asNonEmptyString(title);
  if (normalizedTitle) {
    console.log(normalizedTitle);
  }
  if (subtitle) {
    console.log(subtitle);
  }
}

function printKycBanner() {
  console.log("id verification is required for a Visa card.");
  console.log("machines does not store your data.");
  console.log("kyc processed by Sumsub.");
  console.log("");
}

function printHomeError(error, fallback = "unable to continue.") {
  const message = error instanceof CliError
    ? error.message
    : error instanceof Error
      ? error.message
      : String(error);
  console.log(`${fallback} ${message}`.trim());
}

async function pauseInHome(driver) {
  await driver.input({
    label: "continue",
    optional: true,
  });
}

async function runHomeAction(driver, action) {
  try {
    await action();
  } catch (error) {
    printHomeError(error);
  }
  await pauseInHome(driver);
}

async function clearCliAuth(options = {}) {
  const clearAll = Boolean(options.all);
  const hadAuth = await pathExists(CLI_AUTH_PATH);
  const hadMcp = await pathExists(MCP_AUTH_PATH);

  if (hadAuth) {
    await fs.rm(CLI_AUTH_PATH, { force: true });
  }
  if (clearAll && hadMcp) {
    await fs.rm(MCP_AUTH_PATH, { force: true });
  }

  return {
    loggedOut: true,
    clearedUserAuth: hadAuth,
    clearedMcpAuth: clearAll ? hadMcp : false,
  };
}

async function confirmHomeSignOut(driver) {
  return driver.confirm({
    label: "sign out now",
    defaultValue: false,
  });
}

function formatHomeCardLabel(card) {
  const name = asNonEmptyString(card.name) || "card";
  const last4 = asNonEmptyString(card.last4) || "----";
  const status = asNonEmptyString(card.status) || "unknown";
  return `${name} ••••${last4} (${status})`;
}

async function promptHomeCardLimit(driver, cardId) {
  const amount = await driver.input({
    label: "limit amount in usd",
    normalize: (value) => String(value).trim(),
    validate: (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return "amount must be greater than zero";
      return null;
    },
  });
  const frequency = await driver.select({
    title: "frequency",
    choices: Array.from(CARD_LIMIT_FREQUENCIES).map((value) => ({
      label: value,
      value,
    })),
  });
  await runHomeAction(driver, async () => {
    await commandCardLimitSet(["--id", cardId, "--amount", amount, "--frequency", frequency]);
  });
}

async function runHomeCreatedCard(driver, card) {
  const selectedCardId = asNonEmptyString(card?.id);
  if (!selectedCardId) {
    throw new CliError("card create response is missing card id");
  }

  const revealPayload = await revealCardDetailsForCard(card);
  while (true) {
    printHomeFrame("card created", "details shown below");
    console.log("");
    printRevealedCardDetails(revealPayload, { showSummary: false });
    console.log("");

    const action = await driver.select({
      title: "next",
      choices: [
        { label: "set limit", value: "limit" },
        { label: "create another", value: "again" },
        { label: "done", value: "done" },
      ],
    });

    if (action === "done") {
      return;
    }
    if (action === "again") {
      return "again";
    }
    if (action === "limit") {
      await promptHomeCardLimit(driver, selectedCardId);
    }
  }
}

async function runHomeCardCreateFlow(driver) {
  while (true) {
    try {
      printHomeFrame("create card", "name is optional");
      console.log("");
      const name = await driver.input({
        label: "name",
        optional: true,
        normalize: normalizeWhitespace,
      });
      const { card } = await createCardRecord({ name });
      const nextStep = await runHomeCreatedCard(driver, card);
      if (nextStep === "again") {
        continue;
      }
      return;
    } catch (error) {
      printHomeError(error, "unable to create card.");
      await pauseInHome(driver);
      return;
    }
  }
}

async function runHomeCardListFlow(driver) {
  while (true) {
    let cards;
    try {
      cards = await fetchCardsWithNamesForHome();
    } catch (error) {
      printHomeFrame("list cards");
      console.log("");
      printHomeError(error, "unable to load cards.");
      await pauseInHome(driver);
      return;
    }

    if (cards.length === 0) {
      printHomeFrame("list cards");
      console.log("");
      console.log("no cards");
      await pauseInHome(driver);
      return;
    }

    printHomeFrame("list cards");
    console.log("");
    const selectedCardId = await driver.select({
      title: "select card",
      choices: [
        ...cards.map((card) => ({
          label: formatHomeCardLabel(card),
          value: asNonEmptyString(card.id) || "",
        })).filter((entry) => asNonEmptyString(entry.value)),
        { label: "back", value: "back" },
      ],
    });

    if (selectedCardId === "back") {
      return;
    }

    const selectedCard = cards.find((card) => asNonEmptyString(card.id) === selectedCardId);
    if (!selectedCard) {
      return;
    }

    while (true) {
      const isLocked = (asNonEmptyString(selectedCard.status) || "").toLowerCase() === "locked";
      printHomeFrame("card actions", formatHomeCardLabel(selectedCard));
      console.log("");
      const action = await driver.select({
        title: "choose action",
        choices: [
          { label: "card details", value: "reveal" },
          { label: "rename", value: "rename" },
          { label: "set limit", value: "limit" },
          { label: isLocked ? "unlock" : "lock", value: isLocked ? "unlock" : "lock" },
          { label: "delete", value: "delete" },
          { label: "back", value: "back" },
        ],
      });

      if (action === "back") {
        break;
      }
      if (action === "reveal") {
        await runHomeAction(driver, async () => commandCardReveal(["--id", selectedCardId]));
        continue;
      }
      if (action === "rename") {
        const nextName = await driver.input({
          label: "new name",
          normalize: normalizeWhitespace,
        });
        await runHomeAction(driver, async () => commandCardUpdate(["--id", selectedCardId, "--name", nextName]));
        break;
      }
      if (action === "limit") {
        await promptHomeCardLimit(driver, selectedCardId);
        break;
      }
      if (action === "lock") {
        await runHomeAction(driver, async () => commandCardSetStatus(["--id", selectedCardId], "locked", "lock"));
        break;
      }
      if (action === "unlock") {
        await runHomeAction(driver, async () => commandCardSetStatus(["--id", selectedCardId], "active", "unlock"));
        break;
      }
      if (action === "delete") {
        await runHomeAction(driver, async () => commandCardDelete(["--id", selectedCardId]));
        break;
      }
    }
  }
}

async function runHomeCardsMenu(driver) {
  while (true) {
    printHomeFrame("cards");
    console.log("");
    const action = await driver.select({
      title: "choose action",
      choices: [
        { label: "create card", value: "create" },
        { label: "list cards", value: "list" },
        { label: "back", value: "back" },
      ],
    });
    if (action === "back") return;
    if (action === "create") {
      await runHomeCardCreateFlow(driver);
      continue;
    }
    if (action === "list") {
      await runHomeCardListFlow(driver);
    }
  }
}

async function runHomeMcpMenu(driver) {
  while (true) {
    printHomeFrame("mcp setup");
    console.log("");
    const action = await driver.select({
      title: "choose action",
      choices: [
        { label: "install", value: "install" },
        { label: "auth login", value: "auth_login" },
        { label: "doctor", value: "doctor" },
        { label: "back", value: "back" },
      ],
    });
    if (action === "back") return;
    if (action === "install") {
      await runHomeAction(driver, async () => {
        const host = await driver.select({
          title: "install host",
          choices: [
            { label: "codex", value: "codex" },
            { label: "claude", value: "claude" },
            { label: "copilot", value: "copilot" },
            { label: "chatgpt", value: "chatgpt" },
            { label: "all", value: "all" },
          ],
        });
        await commandMcpInstall(["--host", host]);
      });
      continue;
    }
    if (action === "auth_login") {
      await runHomeAction(driver, async () => commandMcpAuthLogin([]));
      continue;
    }
    if (action === "doctor") {
      await runHomeAction(driver, async () => commandMcpDoctor([]));
      continue;
    }
  }
}

async function runHomeKycGate(driver, options = {}) {
  void options;

  while (true) {
    const auth = await readUserAuthIfExists();
    if (!auth) {
      return "signed_out";
    }

    let application;
    try {
      const statusPayload = await fetchKycStatus();
      application = statusPayload.application;
    } catch (error) {
      printHomeFrame("verification");
      console.log("");
      printKycBanner();
      printHomeError(error, "unable to load status.");
      console.log("");
      const failureAction = await driver.select({
        title: "choose action",
        choices: [
          { label: "refresh", value: "refresh" },
          { label: "sign out", value: "signout" },
          { label: "close", value: "close" },
        ],
      });
      if (failureAction === "close") return "close";
      if (failureAction === "signout") {
        if (await confirmHomeSignOut(driver)) {
          await clearCliAuth();
          return "signed_out";
        }
      }
      continue;
    }

    if (isCliReadyForHome(application)) {
      return "ready";
    }

    const normalizedStatus = normalizeKycStatus(application?.status);
    printHomeFrame(
      normalizedStatus === "manual_review"
        ? "in review"
        : normalizedStatus === "pending"
          ? "loading"
          : normalizedStatus === "approved"
            ? "finish on web"
            : normalizedStatus === "denied" || normalizedStatus === "locked" || normalizedStatus === "canceled"
              ? "verification unsuccessful"
              : "",
    );
    console.log("");
    printKycBanner();

    if (normalizedStatus === "approved" && !hasAcceptedCliAgreements(application)) {
      console.log("finish agreements in web.");
      console.log("");
      const finishAction = await driver.select({
        title: "choose action",
        choices: [
          { label: "finish on web", value: "web" },
          { label: "refresh", value: "refresh" },
          { label: "sign out", value: "signout" },
          { label: "close", value: "close" },
        ],
      });
      if (finishAction === "close") return "close";
      if (finishAction === "signout") {
        if (await confirmHomeSignOut(driver)) {
          await clearCliAuth();
          return "signed_out";
        }
        continue;
      }
      if (finishAction === "web") {
        try {
          await openKycBrowserFlow({ noLaunchBrowser: shouldSkipBrowserLaunch(), application });
        } catch (error) {
          printHomeError(error, "unable to open web kyc.");
        }
        await pauseInHome(driver);
      }
      continue;
    }

    if (normalizedStatus === "pending") {
      console.log("your status will be updated shortly.");
      console.log("");
      const pendingAction = await driver.select({
        title: "choose action",
        choices: [
          { label: "refresh", value: "refresh" },
          { label: "sign out", value: "signout" },
          { label: "close", value: "close" },
        ],
      });
      if (pendingAction === "close") return "close";
      if (pendingAction === "signout") {
        if (await confirmHomeSignOut(driver)) {
          await clearCliAuth();
          return "signed_out";
        }
      }
      continue;
    }

    if (normalizedStatus === "manual_review") {
      console.log("manual review in progress.");
      console.log("");
      const reviewAction = await driver.select({
        title: "choose action",
        choices: [
          { label: "refresh", value: "refresh" },
          { label: "sign out", value: "signout" },
          { label: "close", value: "close" },
        ],
      });
      if (reviewAction === "close") return "close";
      if (reviewAction === "signout") {
        if (await confirmHomeSignOut(driver)) {
          await clearCliAuth();
          return "signed_out";
        }
      }
      continue;
    }

    if (normalizedStatus === "denied" || normalizedStatus === "locked" || normalizedStatus === "canceled") {
      const reason = asNonEmptyString(application?.reason);
      if (reason) {
        console.log(reason);
        console.log("");
      }
      const rejectedAction = await driver.select({
        title: "choose action",
        choices: [
          { label: "sign out", value: "signout" },
          { label: "close", value: "close" },
        ],
      });
      if (rejectedAction === "close") return "close";
      if (await confirmHomeSignOut(driver)) {
        await clearCliAuth();
        return "signed_out";
      }
      continue;
    }

    if (normalizedStatus === "not_submitted") {
      const startAction = await driver.select({
        title: "choose action",
        choices: [
          { label: "continue in browser", value: "browser" },
          { label: "continue in cli", value: "cli" },
          { label: "sign out", value: "signout" },
          { label: "close", value: "close" },
        ],
      });
      if (startAction === "close") return "close";
      if (startAction === "signout") {
        if (await confirmHomeSignOut(driver)) {
          await clearCliAuth();
          return "signed_out";
        }
        continue;
      }
      try {
        if (startAction === "browser") {
          await openKycBrowserFlow({ noLaunchBrowser: shouldSkipBrowserLaunch() });
          await pauseInHome(driver);
        } else {
          await commandKycQuestionnaire([]);
        }
      } catch (error) {
        printHomeError(error, "unable to continue.");
        await pauseInHome(driver);
      }
      continue;
    }

    const verificationAction = await driver.select({
      title: "choose action",
      choices: [
        { label: "continue", value: "continue" },
        { label: "refresh", value: "refresh" },
        { label: "sign out", value: "signout" },
        { label: "close", value: "close" },
      ],
    });
    if (verificationAction === "close") return "close";
    if (verificationAction === "signout") {
      if (await confirmHomeSignOut(driver)) {
        await clearCliAuth();
        return "signed_out";
      }
      continue;
    }
    if (verificationAction === "continue") {
      try {
        await commandKycOpen([]);
      } catch (error) {
        printHomeError(error, "unable to continue.");
      }
      await pauseInHome(driver);
    }
  }
}

async function commandHome(args) {
  if (hasHelpFlag(args)) {
    printHomeHelp();
    return;
  }
  if (!RUNTIME_FLAGS.interactiveTty || RUNTIME_FLAGS.nonInteractive) {
    throw new CliError("home requires an interactive terminal");
  }

  const driver = createPromptDriver("arrow");

  while (true) {
    const auth = await readUserAuthIfExists();

    if (!auth) {
      printHomeFrame("home");
      console.log("");
      const signedOutAction = await driver.select({
        title: "choose action",
        choices: [
          { label: "sign in", value: "signin" },
          { label: "doctor", value: "doctor" },
          { label: "close", value: "close" },
        ],
      });
      if (signedOutAction === "close") return;
      if (signedOutAction === "doctor") {
        await runHomeAction(driver, async () => commandDoctor([]));
        continue;
      }
      try {
        await commandLoginWithBrowser({}, false);
      } catch (error) {
        printHomeFrame("home");
        console.log("");
        printHomeError(error, "unable to sign in.");
        await pauseInHome(driver);
      }
      continue;
    }

    const gateResult = await runHomeKycGate(driver);
    if (gateResult === "close") return;
    if (gateResult === "signed_out") continue;

    printHomeFrame("home");
    console.log("");
    const action = await driver.select({
      title: "choose action",
      choices: [
        { label: "create card", value: "card_create" },
        { label: "list cards", value: "card_list" },
        { label: "mcp setup", value: "mcp" },
        { label: "doctor", value: "doctor" },
        { label: "sign out", value: "signout" },
        { label: "close", value: "close" },
      ],
    });

    if (action === "close") return;
    if (action === "card_create") {
      await runHomeCardCreateFlow(driver);
      continue;
    }
    if (action === "card_list") {
      await runHomeCardListFlow(driver);
      continue;
    }
    if (action === "mcp") {
      await runHomeMcpMenu(driver);
      continue;
    }
    if (action === "doctor") {
      await runHomeAction(driver, async () => commandDoctor([]));
      continue;
    }
    if (action === "signout") {
      const shouldSignOut = await confirmHomeSignOut(driver);
      if (!shouldSignOut) {
        continue;
      }
      await clearCliAuth();
    }
  }
}

async function commandMcp(args) {
  if (args.length === 0 || hasHelpFlag(args)) {
    printMcpHelp();
    return;
  }

  const command = args[0];
  if (command === "install") {
    await commandMcpInstall(args.slice(1));
    return;
  }

  if (command === "auth") {
    const sub = args[1];
    if (sub === "login") {
      await commandMcpAuthLogin(args.slice(2));
      return;
    }
    throw new CliError("mcp auth subcommand must be: login");
  }

  if (command === "doctor") {
    await commandMcpDoctor(args.slice(1));
    return;
  }

  throw new CliError(`unknown mcp command: ${command}`);
}

async function commandCard(args) {
  if (args.length === 0 || hasHelpFlag(args)) {
    printCardHelp();
    return;
  }

  const command = args[0];
  if (command === "create") {
    await commandCardCreate(args.slice(1));
    return;
  }

  if (command === "list") {
    await commandCardList(args.slice(1));
    return;
  }

  if (command === "reveal") {
    await commandCardReveal(args.slice(1));
    return;
  }

  if (command === "update") {
    await commandCardUpdate(args.slice(1));
    return;
  }

  if (command === "lock") {
    await commandCardSetStatus(args.slice(1), "locked", "lock");
    return;
  }

  if (command === "unlock") {
    await commandCardSetStatus(args.slice(1), "active", "unlock");
    return;
  }

  if (command === "delete") {
    await commandCardDelete(args.slice(1));
    return;
  }

  if (command === "limit") {
    await commandCardLimit(args.slice(1));
    return;
  }

  throw new CliError(`unknown card command: ${command}`);
}

async function commandDisposable(args) {
  if (args.length === 0 || hasHelpFlag(args)) {
    printDisposableHelp();
    return;
  }

  const command = args[0];
  if (command === "create") {
    await commandDisposableCreate(args.slice(1));
    return;
  }

  throw new CliError(`unknown disposable command: ${command}`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const { flags, args } = extractGlobalFlags(rawArgs);

  RUNTIME_FLAGS.nonInteractive = Boolean(flags.nonInteractive);
  RUNTIME_FLAGS.yes = Boolean(flags.yes);
  RUNTIME_FLAGS.noColor = Boolean(flags.noColor) || isTruthyEnv(process.env.NO_COLOR);
  RUNTIME_FLAGS.interactiveTty = isInteractiveTerminal();
  RUNTIME_FLAGS.homeEnabled =
    process.env.MACHINES_EXPERIMENTAL_HOME === undefined
      ? true
      : isTruthyEnv(process.env.MACHINES_EXPERIMENTAL_HOME);

  if (RUNTIME_FLAGS.noColor) {
    process.env.NO_COLOR = "1";
  }

  if (args.length === 0) {
    if (RUNTIME_FLAGS.homeEnabled && RUNTIME_FLAGS.interactiveTty && !RUNTIME_FLAGS.nonInteractive) {
      await commandHome([]);
      return;
    }
    printRootHelp();
    return;
  }

  if (args[0] === "--help" || args[0] === "-h") {
    printRootHelp();
    return;
  }

  const command = args[0];

  if (command === "home") {
    await commandHome(args.slice(1));
    return;
  }

  if (command === "login") {
    await commandLogin(args.slice(1));
    return;
  }

  if (command === "logout") {
    await commandLogout(args.slice(1));
    return;
  }

  if (command === "card") {
    await commandCard(args.slice(1));
    return;
  }

  if (command === "user") {
    await commandUser(args.slice(1));
    return;
  }

  if (command === "create") {
    const sub = args[1];
    if (sub !== "user") {
      throw new CliError("create subcommand must be: user");
    }
    await commandUserCreate(args.slice(2));
    return;
  }

  if (command === "kyc") {
    await commandKyc(args.slice(1));
    return;
  }

  if (command === "disposable") {
    await commandDisposable(args.slice(1));
    return;
  }

  if (command === "mcp") {
    await commandMcp(args.slice(1));
    return;
  }

  if (command === "doctor") {
    await commandDoctor(args.slice(1));
    return;
  }

  if (command === "completion") {
    await commandCompletion(args.slice(1));
    return;
  }

  throw new CliError(`unknown command: ${command}`);
}

main()
  .catch((error) => {
    if (error instanceof CliError) {
      console.error(`machines error: ${error.message}`);
      process.exitCode = error.exitCode ?? 1;
      return;
    }
    console.error(`machines error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    closePromptInterface();
  });
