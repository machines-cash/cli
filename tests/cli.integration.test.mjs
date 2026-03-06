import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "..", "bin", "cli.mjs");
const REQUIRED_FULL_SCOPES = [
  "users.read",
  "users.write",
  "kyc.read",
  "kyc.write",
  "agreements.read",
  "agreements.write",
  "cards.read",
  "cards.write",
  "cards.secrets.read",
  "balances.read",
  "transactions.read",
  "withdrawals.write",
  "payments.write",
  "deposits.write",
  "subscriptions.write",
  "referrals.write",
  "bills.write",
  "keys.read",
  "keys.write",
  "sessions.write",
];

const REQUIRED_DEFAULT_POLICY = {
  maxAuthAmountCents: 1_000_000_000,
  dailySpendCapCents: 1_000_000_000,
  dailyWithdrawalCapCents: 1_000_000_000,
};

function parseJsonOutput(output) {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const startIndexes = [];
    for (let index = trimmed.lastIndexOf("{"); index >= 0; index = trimmed.lastIndexOf("{", index - 1)) {
      startIndexes.push(index);
    }
    for (let index = trimmed.lastIndexOf("["); index >= 0; index = trimmed.lastIndexOf("[", index - 1)) {
      startIndexes.push(index);
    }
    startIndexes.sort((a, b) => b - a);

    for (const start of startIndexes) {
      const candidate = trimmed.slice(start).trim();
      try {
        return JSON.parse(candidate);
      } catch {
        // keep scanning
      }
    }
    throw new Error(`unable to parse JSON from output:\n${output}`);
  }
}

function assertIncludesFullScopes(scopes) {
  assert.equal(Array.isArray(scopes), true, "scopes must be an array");
  for (const scope of REQUIRED_FULL_SCOPES) {
    assert.equal(scopes.includes(scope), true, `missing default scope: ${scope}`);
  }
}

function assertIncludesDefaultPolicy(policy) {
  assert.equal(typeof policy, "object", "policy must be an object");
  for (const [key, value] of Object.entries(REQUIRED_DEFAULT_POLICY)) {
    assert.equal(policy?.[key], value, `missing default policy value: ${key}`);
  }
}

function encryptRainValue(secretKeyHex, plainText) {
  const key = Buffer.from(secretKeyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-128-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    data: Buffer.concat([encrypted, tag]).toString("base64"),
  };
}

function decodeEncryptedField(encrypted) {
  if (!encrypted || typeof encrypted !== "object") return null;
  if (typeof encrypted.ct !== "string") return null;
  try {
    return Buffer.from(encrypted.ct, "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function buildTestCard(overrides = {}) {
  return {
    id: randomUUID(),
    last4: "4242",
    status: "active",
    limit: null,
    expirationMonth: 12,
    expirationYear: 2033,
    createdAt: new Date().toISOString(),
    encryptedName: null,
    ...overrides,
  };
}

async function startMockServer() {
  const state = {
    requests: [],
    cards: [],
    sessionCounter: 0,
    cardCounter: 0,
    proposalCounter: 0,
    proposals: new Map(),
    kycApplication: null,
    kycStatusQueue: [],
    cliAuthRequestToken: "18357287-ae16-45e4-b09a-c0f0173776b0",
    cliAuthCode: "M4CH1N3S",
    cardSecretsSessionId: "card-secrets-session-1",
    cardSecretsKeyHex: randomBytes(16).toString("hex"),
    userApiKey: "mc_user_key_test_123",
    userKeyId: "user_key_test_123",
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const body = await readJsonBody(req);
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    state.requests.push({
      method,
      path: pathname,
      headers: req.headers,
      body,
    });

    if (method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
      return writeJson(res, 200, {
        issuer: "https://mcp.machines.cash",
      });
    }

    if (method === "POST" && pathname === "/user/v1/bootstrap") {
      return writeJson(res, 200, {
        userApiKey: state.userApiKey,
        userKeyId: state.userKeyId,
        walletAddress: typeof body?.address === "string" ? body.address : "0x0000000000000000000000000000000000000000",
        userId: "user_test_1",
      });
    }

    if (method === "POST" && pathname === "/user/v1/sessions") {
      state.sessionCounter += 1;
      const scopes = Array.isArray(body?.scopes)
        ? body.scopes.filter((entry) => typeof entry === "string")
        : ["cards.read", "cards.write"];
      return writeJson(res, 200, {
        sessionToken: `session-token-${state.sessionCounter}`,
        sessionId: `session-id-${state.sessionCounter}`,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        scopes,
      });
    }

    if (method === "POST" && pathname === "/identity/user-api-keys") {
      const authHeader = req.headers.authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        return writeJson(res, 401, {
          error: "unauthorized",
          message: "missing bearer token",
        });
      }
      return writeJson(res, 200, {
        userApiKey: state.userApiKey,
        userKeyId: state.userKeyId,
        userId: "user_test_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
      });
    }

    if (method === "POST" && pathname === "/auth/cli/start") {
      return writeJson(res, 200, {
        requestToken: state.cliAuthRequestToken,
        code: state.cliAuthCode,
        url: "https://app.machines.cash/auth/cli?request=18357287-ae16-45e4-b09a-c0f0173776b0",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        pollIntervalMs: 10,
      });
    }

    if (method === "POST" && pathname === "/auth/cli/poll") {
      if (body?.requestToken !== state.cliAuthRequestToken) {
        return writeJson(res, 404, {
          error: "challenge_not_found",
          message: "browser sign in session not found",
        });
      }
      return writeJson(res, 200, {
        status: "completed",
        token: "web-session-token-1",
        session: {
          userId: "user_test_1",
          address: "0x1111111111111111111111111111111111111111",
          sessionId: "web-session-1",
        },
      });
    }

    if (method === "POST" && pathname === "/user/v1/crypto/encrypt") {
      const items = Array.isArray(body?.items) ? body.items : [];
      return writeJson(res, 200, {
        items: items.map((item) => ({
          id: String(item?.id ?? ""),
          ok: true,
          encrypted: {
            ct: Buffer.from(String(item?.value ?? ""), "utf8").toString("base64"),
            iv: "iv",
            v: 1,
          },
        })),
      });
    }

    if (method === "POST" && pathname === "/user/v1/crypto/decrypt") {
      const items = Array.isArray(body?.items) ? body.items : [];
      return writeJson(res, 200, {
        items: items.map((item) => ({
          id: String(item?.id ?? ""),
          ok: true,
          value: decodeEncryptedField(item?.encrypted) ?? "",
        })),
      });
    }

    if (method === "POST" && pathname === "/user/v1/kyc") {
      const required = [
        "firstName",
        "lastName",
        "birthDate",
        "countryOfIssue",
        "email",
        "occupation",
        "annualSalary",
        "accountPurpose",
        "expectedMonthlyVolume",
      ];
      for (const key of required) {
        if (typeof body?.[key] !== "string" || body[key].trim().length === 0) {
          return writeJson(res, 400, {
            error: "invalid_request",
            message: `${key} is required`,
          });
        }
      }
      if (!body?.address || typeof body.address !== "object") {
        return writeJson(res, 400, {
          error: "invalid_request",
          message: "address is required",
        });
      }
      state.kycApplication = {
        id: "user_test_1",
        status: "needsVerification",
        reason: null,
        completionLink: "https://sumsub.example/complete",
        externalVerificationLink: {
          url: "https://sumsub.example/verify",
          params: { applicantId: "applicant-1" },
        },
        isActive: true,
        isTermsOfServiceAccepted: true,
      };
      return writeJson(res, 201, {
        application: state.kycApplication,
      });
    }

    if (method === "GET" && pathname === "/user/v1/kyc/status") {
      if (!state.kycApplication) {
        return writeJson(res, 404, {
          error: "not_found",
          message: "application not found",
        });
      }
      if (state.kycStatusQueue.length > 0) {
        const nextStatus = state.kycStatusQueue.shift();
        if (typeof nextStatus === "string" && nextStatus.length > 0) {
          state.kycApplication.status = nextStatus;
        }
      }
      return writeJson(res, 200, {
        application: state.kycApplication,
      });
    }

    if (method === "GET" && pathname === "/user/v1/cards") {
      return writeJson(res, 200, {
        cards: state.cards.filter((card) => card.status !== "canceled"),
      });
    }

    if (method === "POST" && pathname === "/user/v1/cards") {
      state.cardCounter += 1;
      const last4 = String(4200 + state.cardCounter).slice(-4);
      const card = buildTestCard({
        id: randomUUID(),
        last4,
        limit: body?.limit ?? null,
        encryptedName: body?.encryptedName ?? null,
      });
      state.cards.push(card);
      return writeJson(res, 200, {
        card,
      });
    }

    const patchCardMatch = pathname.match(/^\/user\/v1\/cards\/([^/]+)$/);
    if (method === "PATCH" && patchCardMatch) {
      const cardId = decodeURIComponent(patchCardMatch[1]);
      const card = state.cards.find((entry) => entry.id === cardId);
      if (!card) {
        return writeJson(res, 404, {
          error: "not_found",
          message: "card not found",
        });
      }

      if (typeof body?.status === "string") {
        card.status = body.status;
      }
      if (body?.limit && typeof body.limit === "object") {
        card.limit = body.limit;
      }
      if (body?.encryptedName && typeof body.encryptedName === "object") {
        card.encryptedName = body.encryptedName;
      }

      return writeJson(res, 200, {
        card,
      });
    }

    const deleteCardMatch = pathname.match(/^\/user\/v1\/cards\/([^/]+)\/delete-now$/);
    if (method === "POST" && deleteCardMatch) {
      const cardId = decodeURIComponent(deleteCardMatch[1]);
      const card = state.cards.find((entry) => entry.id === cardId);
      if (!card) {
        return writeJson(res, 404, {
          error: "not_found",
          message: "card not found",
        });
      }
      card.status = "canceled";
      return writeJson(res, 200, {
        card,
      });
    }

    if (method === "POST" && pathname === "/user/v1/cards/secrets/session") {
      return writeJson(res, 200, {
        secrets: {
          sessionId: state.cardSecretsSessionId,
          secretKey: state.cardSecretsKeyHex,
        },
      });
    }

    const revealCardMatch = pathname.match(/^\/user\/v1\/cards\/([^/]+)\/secrets$/);
    if (method === "POST" && revealCardMatch) {
      const cardId = decodeURIComponent(revealCardMatch[1]);
      const card = state.cards.find((entry) => entry.id === cardId);
      if (!card) {
        return writeJson(res, 404, {
          error: "not_found",
          message: "card not found",
        });
      }
      const pan = `411111111111${card.last4}`;
      return writeJson(res, 200, {
        secrets: {
          encryptedPan: encryptRainValue(state.cardSecretsKeyHex, pan),
          encryptedCvc: encryptRainValue(state.cardSecretsKeyHex, "123"),
        },
      });
    }

    if (method === "POST" && pathname === "/user/v1/cards/disposable/proposals") {
      state.proposalCounter += 1;
      const proposalId = `proposal-${state.proposalCounter}`;
      const proposal = {
        proposalId,
        status: "proposed",
        amountCents: body?.amountCents ?? 0,
        currency: body?.currency ?? "USD",
        limitFrequency: body?.limitFrequency ?? "perAuthorization",
        autoCancelAfterAuth: Boolean(body?.autoCancelAfterAuth),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
        cardId: null,
      };
      state.proposals.set(proposalId, proposal);
      return writeJson(res, 200, {
        disposable: proposal,
      });
    }

    if (method === "POST" && pathname === "/user/v1/cards/disposable/execute") {
      const proposalId = typeof body?.proposalId === "string" ? body.proposalId : "";
      const proposal = state.proposals.get(proposalId);
      if (!proposal) {
        return writeJson(res, 404, {
          error: "not_found",
          message: "proposal not found",
        });
      }

      state.cardCounter += 1;
      const last4 = String(5200 + state.cardCounter).slice(-4);
      const card = buildTestCard({
        id: randomUUID(),
        last4,
        status: "active",
        limit: {
          amount: proposal.amountCents,
          frequency: proposal.limitFrequency,
        },
        encryptedName: body?.encryptedName ?? null,
      });
      state.cards.push(card);

      const nextProposal = {
        ...proposal,
        status: "executed",
        executedAt: new Date().toISOString(),
        cardId: card.id,
      };
      state.proposals.set(proposalId, nextProposal);

      return writeJson(res, 200, {
        disposable: nextProposal,
        card,
      });
    }

    return writeJson(res, 404, {
      error: "not_found",
      message: `no route for ${method} ${pathname}`,
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("unable to bind mock server");
  }

  return {
    state,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function runCli(args, { env, cwd, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        ...process.env,
        ...env,
      },
      cwd,
      stdio: "pipe",
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    if (typeof input === "string") {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function runCliInteractive(args, { env, cwd, prompts, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        ...process.env,
        MACHINES_CLI_ALLOW_PROMPTS: "1",
        ...env,
      },
      cwd,
      stdio: "pipe",
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutText = "";
    let promptIndex = 0;
    let searchStart = 0;
    let settled = false;

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const maybeAnswerPrompts = () => {
      if (!Array.isArray(prompts) || prompts.length === 0) return;
      while (promptIndex < prompts.length) {
        const prompt = prompts[promptIndex];
        const waitFor = String(prompt?.waitFor ?? "");
        const answer = String(prompt?.answer ?? "");
        if (waitFor.length === 0) break;
        const foundAt = stdoutText.indexOf(waitFor, searchStart);
        if (foundAt < 0) break;
        child.stdin.write(`${answer}\n`);
        promptIndex += 1;
        searchStart = stdoutText.length;
        if (promptIndex === prompts.length) {
          child.stdin.end();
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      stdoutText += chunk.toString("utf8");
      maybeAnswerPrompts();
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      finalize({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    const timeout = setTimeout(() => {
      const pendingPrompt =
        Array.isArray(prompts) && promptIndex < prompts.length
          ? String(prompts[promptIndex]?.waitFor ?? "")
          : "";
      child.kill("SIGKILL");
      finalize({
        code: 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr:
          `${Buffer.concat(stderrChunks).toString("utf8")}\ninteractive command timed out` +
          (pendingPrompt ? ` waiting for: ${pendingPrompt}` : ""),
      });
    }, timeoutMs);

    if (!Array.isArray(prompts) || prompts.length === 0) {
      child.stdin.end();
    }
  });
}

async function runCliOk(args, context) {
  const result = await runCli(args, context);
  assert.equal(result.code, 0, `command failed: machines ${args.join(" ")}\n${result.stderr}`);
  return result;
}

async function withMockEnvironment(run, options = {}) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "machines-cli-test-"));
  const homeDir = path.join(tmpRoot, "home");
  const workspaceDir = path.join(tmpRoot, "workspace");
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  const mock = await startMockServer();
  const env = {
    MACHINES_API_URL: mock.baseUrl,
    MACHINES_MCP_URL: mock.baseUrl,
    MACHINES_NO_LAUNCH_BROWSER: "1",
    HOME: homeDir,
    ...(options.env ?? {}),
  };

  try {
    await run({ env, homeDir, workspaceDir, cwd: workspaceDir, mock });
  } finally {
    await mock.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function loginForTests(context) {
  const issuedAt = "2026-03-02T00:00:00.000Z";
  const expiresAt = "2026-03-02T00:05:00.000Z";

  const result = await runCliOk(
    [
      "login",
      "--address",
      "0x1111111111111111111111111111111111111111",
      "--signature",
      "0xdeadbeef",
      "--nonce",
      "nonce-test-1",
      "--issued-at",
      issuedAt,
      "--expires-at",
      expiresAt,
      "--json",
    ],
    context,
  );

  const payload = parseJsonOutput(result.stdout);
  assert.equal(payload.walletAddress, "0x1111111111111111111111111111111111111111");

  const bootstrapRequest = context.mock.state.requests.find(
    (request) => request.method === "POST" && request.path === "/user/v1/bootstrap",
  );
  assert.ok(bootstrapRequest);
  assertIncludesFullScopes(bootstrapRequest.body?.scopes);
  assertIncludesFullScopes(bootstrapRequest.body?.sessionScopes);
  assertIncludesDefaultPolicy(bootstrapRequest.body?.policy);
  assertIncludesDefaultPolicy(bootstrapRequest.body?.sessionPolicy);

  const mintedSessionRequest = context.mock.state.requests.find(
    (request) => request.method === "POST" && request.path === "/user/v1/sessions",
  );
  assert.ok(mintedSessionRequest);
  assertIncludesDefaultPolicy(mintedSessionRequest.body?.policy);

  const authPath = path.join(context.homeDir, ".machines", "cli", "auth.json");
  const authStats = await fs.stat(authPath);
  assert.equal(authStats.mode & 0o077, 0, "auth file should not be readable by group/others");
}

describe("machines cli integration", () => {
  it("defaults login to browser flow when no agent inputs are provided", async () => {
    await withMockEnvironment(async (context) => {
      const result = await runCliOk(["login", "--json"], context);
      const payload = parseJsonOutput(result.stdout);
      assert.equal(payload.loginMethod, "browser");

      const channelRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === "/auth/cli/start",
      );
      assert.ok(channelRequest);

      const keyCreateRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === "/identity/user-api-keys",
      );
      assert.ok(keyCreateRequest);
      assertIncludesFullScopes(keyCreateRequest.body?.scopes);
      assertIncludesDefaultPolicy(keyCreateRequest.body?.policy);

      const mintedSessionRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === "/user/v1/sessions",
      );
      assert.ok(mintedSessionRequest);
      assertIncludesFullScopes(mintedSessionRequest.body?.scopes);
      assertIncludesDefaultPolicy(mintedSessionRequest.body?.policy);
    });
  });

  it("opens home automatically after browser login on interactive terminals", async () => {
    await withMockEnvironment(async (context) => {
      context.mock.state.kycApplication = {
        id: "user_test_1",
        status: "approved",
        reason: null,
        completionLink: null,
        externalVerificationLink: null,
        isActive: true,
        isTermsOfServiceAccepted: true,
      };
      const result = await runCliInteractive(
        ["login", "--browser", "--no-launch-browser"],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
            MACHINES_PROMPT_DRIVER: "plain",
          },
          prompts: [
            { waitFor: "select 1-6:", answer: "6" },
          ],
        },
      );
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /logged in \(browser\):/);
      assert.match(result.stdout, /cards/);
      assert.doesNotMatch(result.stdout, /status row:/);
    });
  });

  it("supports --no-home to exit immediately after login", async () => {
    await withMockEnvironment(async (context) => {
      const result = await runCliOk(
        ["login", "--browser", "--no-launch-browser", "--no-home"],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
          },
        },
      );
      assert.match(result.stdout, /logged in \(browser\):/);
      assert.doesNotMatch(result.stdout, /status row: kyc/);
    });
  });

  it("reuses saved auth when login is run again without explicit login inputs", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);
      context.mock.state.kycApplication = {
        id: "user_test_1",
        status: "approved",
        reason: null,
        completionLink: null,
        externalVerificationLink: null,
        isActive: true,
        isTermsOfServiceAccepted: true,
      };

      const result = await runCliInteractive(
        ["login"],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
            MACHINES_PROMPT_DRIVER: "plain",
          },
          prompts: [
            { waitFor: "select 1-6:", answer: "6" },
          ],
        },
      );

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /already signed in:/);
      assert.match(result.stdout, /menu: run `machines` or `machines home` anytime/);

      const browserStartRequests = context.mock.state.requests.filter(
        (request) => request.method === "POST" && request.path === "/auth/cli/start",
      );
      assert.equal(browserStartRequests.length, 0);
    });
  });

  it("prefers MACHINES_WEB_APP_URL when browser login url is printed", async () => {
    await withMockEnvironment(
      async (context) => {
        const result = await runCliOk(["login", "--no-launch-browser"], context);
        assert.match(
          result.stdout,
          /open this URL: https:\/\/sandbox\.machines\.cash\/auth\/cli\?request=[^&]+&code=[A-Z0-9]+/,
        );
      },
      {
        env: {
          MACHINES_WEB_APP_URL: "https://sandbox.machines.cash",
        },
      },
    );
  });

  it("covers card lifecycle commands including update/delete/lock/unlock/limit", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const created = await runCliOk(
        [
          "card",
          "create",
          "--name",
          "ads-bot",
          "--limit",
          "250",
          "--frequency",
          "per30DayPeriod",
          "--json",
        ],
        context,
      );
      const createdPayload = parseJsonOutput(created.stdout);
      const cardId = createdPayload.card.id;
      const cardLast4 = createdPayload.card.last4;

      const listed = await runCliOk(["card", "list", "--json"], context);
      const listedPayload = parseJsonOutput(listed.stdout);
      assert.equal(listedPayload.cards.length, 1);
      assert.equal(listedPayload.cards[0].last4, cardLast4);
      assert.equal(listedPayload.cards[0].name, "ads-bot");

      const updated = await runCliOk(
        [
          "card",
          "update",
          "--last4",
          cardLast4,
          "--name",
          "ads-bot-v2",
          "--limit",
          "300",
          "--frequency",
          "per7DayPeriod",
          "--json",
        ],
        context,
      );
      const updatedPayload = parseJsonOutput(updated.stdout);
      assert.equal(updatedPayload.card.limit.amount, 300);
      assert.equal(updatedPayload.card.limit.frequency, "per7DayPeriod");

      const locked = await runCliOk(
        ["card", "lock", "--id", cardId, "--json"],
        context,
      );
      const lockedPayload = parseJsonOutput(locked.stdout);
      assert.equal(lockedPayload.card.status, "locked");

      const unlocked = await runCliOk(
        ["card", "unlock", "--last4", cardLast4, "--json"],
        context,
      );
      const unlockedPayload = parseJsonOutput(unlocked.stdout);
      assert.equal(unlockedPayload.card.status, "active");

      const limitSet = await runCliOk(
        [
          "card",
          "limit",
          "set",
          "--id",
          cardId,
          "--amount",
          "500",
          "--frequency",
          "per24HourPeriod",
          "--json",
        ],
        context,
      );
      const limitPayload = parseJsonOutput(limitSet.stdout);
      assert.equal(limitPayload.card.limit.amount, 500);
      assert.equal(limitPayload.card.limit.frequency, "per24HourPeriod");

      const revealed = await runCliOk(
        ["card", "reveal", "--last4", cardLast4, "--json"],
        context,
      );
      const revealPayload = parseJsonOutput(revealed.stdout);
      assert.equal(revealPayload.last4, cardLast4);
      assert.equal(revealPayload.cvc, "123");
      assert.equal(revealPayload.number.endsWith(cardLast4), true);

      const deleted = await runCliOk(
        ["card", "delete", "--id", cardId, "--json"],
        context,
      );
      const deletedPayload = parseJsonOutput(deleted.stdout);
      assert.equal(deletedPayload.card.status, "canceled");

      const listedAfterDelete = await runCliOk(["card", "list", "--json"], context);
      const listedAfterDeletePayload = parseJsonOutput(listedAfterDelete.stdout);
      assert.equal(listedAfterDeletePayload.cards.length, 0);

      const patchRequests = context.mock.state.requests.filter(
        (request) => request.method === "PATCH" && request.path === `/user/v1/cards/${cardId}`,
      );
      assert.equal(patchRequests.length, 4);
      for (const request of patchRequests) {
        assert.ok(typeof request.headers["idempotency-key"] === "string");
      }

      const createRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === "/user/v1/cards",
      );
      assert.ok(createRequest);
      assert.ok(typeof createRequest.headers["idempotency-key"] === "string");

      const deleteRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === `/user/v1/cards/${cardId}/delete-now`,
      );
      assert.ok(deleteRequest);
      assert.ok(typeof deleteRequest.headers["idempotency-key"] === "string");
    });
  });

  it("reveals the selected card by id without a second confirmation step", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const first = parseJsonOutput((await runCliOk(
        ["card", "create", "--name", "primary", "--json"],
        context,
      )).stdout);
      const second = parseJsonOutput((await runCliOk(
        ["card", "create", "--name", "backup", "--json"],
        context,
      )).stdout);

      const result = await runCliInteractive(
        ["card", "reveal", "--id", first.card.id],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
            MACHINES_PROMPT_DRIVER: "plain",
          },
        },
      );

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`card ending ${first.card.last4}`));
      assert.doesNotMatch(result.stdout, new RegExp(`card ending ${second.card.last4}`));
      assert.match(result.stdout, new RegExp(`1111 ${first.card.last4}`));
      assert.doesNotMatch(result.stdout, /reveal card details now/i);
    });
  });

  it("supports perAuthorization when updating an existing card limit", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);
      const createdPayload = parseJsonOutput((await runCliOk(
        ["card", "create", "--name", "single-use-check", "--json"],
        context,
      )).stdout);

      const result = await runCliOk(
        [
          "card",
          "limit",
          "set",
          "--id",
          createdPayload.card.id,
          "--amount",
          "50",
          "--frequency",
          "perAuthorization",
          "--json",
        ],
        context,
      );

      const payload = parseJsonOutput(result.stdout);
      assert.equal(payload.card.limit.amount, 50);
      assert.equal(payload.card.limit.frequency, "perAuthorization");

      const patchRequests = context.mock.state.requests.filter(
        (request) => request.method === "PATCH" && request.path === `/user/v1/cards/${createdPayload.card.id}`,
      );
      assert.equal(patchRequests.length, 1);
    });
  });

  it("covers disposable create with idempotent writes", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const result = await runCliOk(
        [
          "disposable",
          "create",
          "--amount-cents",
          "5000",
          "--auto-cancel-after-auth",
          "--name",
          "ad-campaign",
          "--json",
        ],
        context,
      );

      const payload = parseJsonOutput(result.stdout);
      assert.equal(payload.proposal.status, "executed");
      assert.equal(payload.card.status, "active");

      const proposalRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === "/user/v1/cards/disposable/proposals",
      );
      assert.ok(proposalRequest);
      assert.ok(typeof proposalRequest.headers["idempotency-key"] === "string");

      const executeRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === "/user/v1/cards/disposable/execute",
      );
      assert.ok(executeRequest);
      assert.ok(typeof executeRequest.headers["idempotency-key"] === "string");
    });
  });

  it("covers single-command user create plus kyc status/open/wait flows", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const created = await runCliOk(
        [
          "create",
          "user",
          "--name=john",
          "--lastname=doe",
          "--birth-date=03/04/1990",
          "--country-of-issue=u.s.",
          "--national-id=123 45 6789",
          "--email=John.Doe+kyc@Example.COM",
          "--line1=123   main    st",
          "--city= new    york ",
          "--region=NY",
          "--postal-code=10001-1234",
          "--country-code=us",
          "--phone-country-code=+1",
          "--phone-number=(212) 555-0101",
          "--occupation=SELFEMP",
          "--annual-salary=50k-99k",
          "--account-purpose=Testing",
          "--expected-monthly-volume=under $1k",
          "--json",
        ],
        context,
      );
      const createdPayload = parseJsonOutput(created.stdout);
      assert.equal(createdPayload.status, "needs_verification");
      assert.equal(
        createdPayload.verificationUrl,
        "https://sumsub.example/verify?applicantId=applicant-1",
      );

      const createRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === "/user/v1/kyc",
      );
      assert.ok(createRequest);
      assert.equal(createRequest.body.firstName, "john");
      assert.equal(createRequest.body.lastName, "doe");
      assert.equal(createRequest.body.birthDate, "1990-03-04");
      assert.equal(createRequest.body.countryOfIssue, "US");
      assert.equal(createRequest.body.nationalId, "123456789");
      assert.equal(createRequest.body.email, "john.doe+kyc@example.com");
      assert.equal(createRequest.body.phoneCountryCode, "1");
      assert.equal(createRequest.body.phoneNumber, "2125550101");
      assert.equal(createRequest.body.address.line1, "123 main st");
      assert.equal(createRequest.body.address.city, "new york");
      assert.equal(createRequest.body.address.countryCode, "US");
      assert.equal(createRequest.body.accountPurpose, "testing");
      assert.equal(createRequest.body.expectedMonthlyVolume, "0-1000");

      const status = await runCliOk(["kyc", "status", "--json"], context);
      const statusPayload = parseJsonOutput(status.stdout);
      assert.equal(statusPayload.status, "needs_verification");

      const openResult = await runCliOk(
        ["kyc", "open", "--no-launch-browser", "--json"],
        context,
      );
      const openPayload = parseJsonOutput(openResult.stdout);
      assert.equal(openPayload.openedBrowser, false);
      assert.equal(
        openPayload.verificationUrl,
        "https://sumsub.example/verify?applicantId=applicant-1",
      );

      context.mock.state.kycStatusQueue.push("pending", "manualReview", "approved");
      const waitResult = await runCliOk(
        [
          "kyc",
          "wait",
          "--interval-seconds",
          "1",
          "--timeout-seconds",
          "10",
          "--json",
        ],
        context,
      );
      const waitPayload = parseJsonOutput(waitResult.stdout);
      assert.equal(waitPayload.status, "approved");
    });
  });

  it("requires phone fields for direct user create", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const result = await runCli(
        [
          "create",
          "user",
          "--name=john",
          "--lastname=approved",
          "--birth-date=1990-03-04",
          "--country-of-issue=us",
          "--national-id=123-45-6789",
          "--email=john.approved@example.com",
          "--line1=123 Main St",
          "--city=New York",
          "--region=NY",
          "--postal-code=10001",
          "--country-code=us",
          "--occupation=SELFEMP",
          "--annual-salary=50k-99k",
          "--account-purpose=testing",
          "--expected-monthly-volume=under $1k",
        ],
        context,
      );
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /--phone-country-code/);
      assert.match(result.stderr, /--phone-number/);
    });
  });

  it("does not reopen browser KYC when the user is already approved", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);
      context.mock.state.kycApplication = {
        id: "user_test_1",
        status: "approved",
        reason: null,
        completionLink: null,
        externalVerificationLink: null,
        isActive: true,
        isTermsOfServiceAccepted: true,
      };

      const result = await runCliOk(
        ["kyc", "open", "--no-launch-browser", "--json"],
        context,
      );
      const payload = parseJsonOutput(result.stdout);
      assert.equal(payload.status, "approved");
      assert.equal(payload.verificationUrl, null);
      assert.equal(payload.openedBrowser, false);
    });
  });

  it("defaults missing-field user create into browser-first verification", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const result = await runCliInteractive(
        ["user", "create", "--no-launch-browser"],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
            MACHINES_PROMPT_DRIVER: "plain",
          },
          prompts: [
            { waitFor: "select 1-2 [1]:", answer: "" },
          ],
        },
      );

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /browser is the simplest path\./);
      assert.match(result.stdout, /open this URL: https:\/\/app\.machines\.cash\/identity\/kyc/);
      assert.doesNotMatch(result.stdout, /kyc questionnaire/);
    });
  });

  it("covers interactive kyc questionnaire flow with normalized inputs", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const result = await runCliInteractive(
        ["kyc", "questionnaire", "--no-launch-browser", "--json"],
        {
          ...context,
          prompts: [
            { waitFor: "select 1-3:", answer: "1" },
            { waitFor: "first name:", answer: "john" },
            { waitFor: "last name:", answer: "approved" },
            { waitFor: "birth date (YYYY-MM-DD or MM/DD/YYYY):", answer: "01/02/1991" },
            { waitFor: "social security number (ssn):", answer: "123 45 6789" },
            { waitFor: "email:", answer: "John.Approved@Example.COM" },
            { waitFor: "phone country code (digits only, no +)", answer: "+1" },
            { waitFor: "phone number:", answer: "(416) 555-0199" },
            { waitFor: "address line 1:", answer: "500   Queen   St" },
            { waitFor: "address line 2 (optional):", answer: "" },
            { waitFor: "city:", answer: "toronto" },
            { waitFor: "state:", answer: "ny" },
            { waitFor: "postal/zip code:", answer: "m5v 2b6" },
            { waitFor: "address country code (2 letters) [US]:", answer: "ca" },
            { waitFor: "select 1-7:", answer: "1" },
            { waitFor: "select 1-4:", answer: "2" },
            { waitFor: "select 1-5:", answer: "4" },
            { waitFor: "select 1-4:", answer: "1" },
            { waitFor: "referral code (optional):", answer: "" },
            { waitFor: "open verification link after submit [Y/n]:", answer: "n" },
            { waitFor: "submit this kyc application [Y/n]:", answer: "y" },
          ],
        },
      );
      assert.equal(
        result.code,
        0,
        `command failed: machines kyc questionnaire --json\n${result.stderr}`,
      );
      const payload = parseJsonOutput(result.stdout);
      assert.equal(payload.mode, "questionnaire");
      assert.equal(payload.status, "needs_verification");
      assert.equal(payload.openedBrowser, false);

      const createRequest = context.mock.state.requests.find(
        (request) => request.method === "POST" && request.path === "/user/v1/kyc",
      );
      assert.ok(createRequest);
      assert.equal(createRequest.body.firstName, "john");
      assert.equal(createRequest.body.lastName, "approved");
      assert.equal(createRequest.body.birthDate, "1991-01-02");
      assert.equal(createRequest.body.countryOfIssue, "US");
      assert.equal(createRequest.body.nationalId, "123456789");
      assert.equal(createRequest.body.email, "john.approved@example.com");
      assert.equal(createRequest.body.phoneCountryCode, "1");
      assert.equal(createRequest.body.phoneNumber, "4165550199");
      assert.equal(createRequest.body.address.line1, "500 Queen St");
      assert.equal(createRequest.body.address.city, "toronto");
      assert.equal(createRequest.body.address.region, "NY");
      assert.equal(createRequest.body.address.postalCode, "M5V 2B6");
      assert.equal(createRequest.body.address.countryCode, "CA");
      assert.equal(createRequest.body.annualSalary, "50000-75000");
      assert.equal(createRequest.body.accountPurpose, "testing");
      assert.equal(createRequest.body.expectedMonthlyVolume, "0-1000");
      assert.equal("referralCode" in createRequest.body, false);
    });
  });

  it("covers mcp install + doctor commands and card help surface", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      await runCliOk(["mcp", "install", "--host", "all"], context);

      const codexConfigPath = path.join(context.homeDir, ".codex", "config.toml");
      const codexConfig = await fs.readFile(codexConfigPath, "utf8");
      assert.match(codexConfig, /\[mcp_servers\.machines\]/);

      const copilotConfigPath = path.join(context.workspaceDir, ".vscode", "mcp.json");
      const copilotConfig = JSON.parse(await fs.readFile(copilotConfigPath, "utf8"));
      assert.equal(copilotConfig.servers.machines.url, `${context.mock.baseUrl}/mcp`);

      const mcpDoctor = await runCliOk(["mcp", "doctor", "--json"], context);
      const mcpDoctorPayload = parseJsonOutput(mcpDoctor.stdout);
      assert.equal(Array.isArray(mcpDoctorPayload.checks), true);
      assert.equal(mcpDoctorPayload.oauthMetadata.ok, true);

      const doctor = await runCliOk(["doctor", "--json"], context);
      const doctorPayload = parseJsonOutput(doctor.stdout);
      assert.equal(doctorPayload.checks[0].exists, true);
      assert.equal(doctorPayload.apiProbe.ok, true);
      assert.equal(doctorPayload.mcpProbe.ok, true);

      const cardHelp = await runCliOk(["card", "--help"], context);
      assert.match(cardHelp.stdout, /card update/);
      assert.match(cardHelp.stdout, /card delete/);
      assert.match(cardHelp.stdout, /card limit set/);

      const rootHelp = await runCliOk(["--help"], context);
      assert.match(rootHelp.stdout, /create user/);
      assert.match(rootHelp.stdout, /kyc questionnaire/);
      assert.match(rootHelp.stdout, /kyc wait/);
      assert.match(rootHelp.stdout, /machines home/);
      assert.match(rootHelp.stdout, /machines logout/);
      assert.match(rootHelp.stdout, /--non-interactive/);
    });
  });

  it("supports home flow, completion, and logout commands", async () => {
    await withMockEnvironment(async (context) => {
      const signedOutHome = await runCliInteractive(
        ["home"],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
            MACHINES_PROMPT_DRIVER: "plain",
          },
          prompts: [
            { waitFor: "select 1-3:", answer: "3" },
          ],
        },
      );
      assert.equal(signedOutHome.code, 0, signedOutHome.stderr);
      assert.match(signedOutHome.stdout, /sign in/);

      await loginForTests(context);
      context.mock.state.kycApplication = {
        id: "user_test_1",
        status: "approved",
        reason: null,
        completionLink: null,
        externalVerificationLink: null,
        isActive: true,
        isTermsOfServiceAccepted: true,
      };
      await runCliOk(["card", "create", "--name", "home-card", "--json"], context);

      const signedInHome = await runCliInteractive(
        ["home"],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
            MACHINES_PROMPT_DRIVER: "plain",
          },
          prompts: [
            { waitFor: "select 1-6:", answer: "2" }, // list cards
            { waitFor: "select 1-2:", answer: "1" }, // choose card
            { waitFor: "select 1-6:", answer: "6" }, // card actions back
            { waitFor: "select 1-2:", answer: "2" }, // list cards back
            { waitFor: "select 1-6:", answer: "3" }, // mcp
            { waitFor: "select 1-4:", answer: "4" }, // mcp back
            { waitFor: "select 1-6:", answer: "4" }, // doctor
            { waitFor: "continue (optional):", answer: "" },
            { waitFor: "select 1-6:", answer: "5" }, // sign out
            { waitFor: "sign out now [y/N]:", answer: "n" },
            { waitFor: "select 1-6:", answer: "6" }, // close
          ],
        },
      );
      assert.equal(signedInHome.code, 0, signedInHome.stderr);
      assert.match(signedInHome.stdout, /list cards/);
      assert.match(signedInHome.stdout, /sign out now \[y\/N\]:/);

      const completionBash = await runCliOk(["completion", "bash"], context);
      assert.match(completionBash.stdout, /_machines_complete/);

      const completionZsh = await runCliOk(["completion", "zsh"], context);
      assert.match(completionZsh.stdout, /compdef _machines_complete machines/);

      const completionFish = await runCliOk(["completion", "fish"], context);
      assert.match(completionFish.stdout, /complete -c machines -f/);

      const logoutResult = await runCliOk(["logout", "--json"], context);
      const logoutPayload = parseJsonOutput(logoutResult.stdout);
      assert.equal(logoutPayload.loggedOut, true);
      assert.equal(logoutPayload.clearedUserAuth, true);

      const authPath = path.join(context.homeDir, ".machines", "cli", "auth.json");
      await assert.rejects(() => fs.access(authPath));
    });
  });

  it("routes incomplete kyc users into the gated home flow", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);
      context.mock.state.kycApplication = {
        id: "user_test_1",
        status: "needsVerification",
        reason: null,
        completionLink: "https://sumsub.example/complete",
        externalVerificationLink: {
          url: "https://sumsub.example/verify",
          params: { applicantId: "applicant-1" },
        },
        isActive: true,
        isTermsOfServiceAccepted: false,
      };

      const result = await runCliInteractive(
        ["home"],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
            MACHINES_PROMPT_DRIVER: "plain",
          },
          prompts: [
            { waitFor: "select 1-4:", answer: "4" },
          ],
        },
      );

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /id verification is required for a Visa card\./);
      assert.match(result.stdout, /kyc processed by Sumsub\./);
      assert.doesNotMatch(result.stdout, /complete verification/);
      assert.doesNotMatch(result.stdout, /mcp setup/);
    });
  });

  it("routes brand new users to browser-first verification in home", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const result = await runCliInteractive(
        ["home"],
        {
          ...context,
          env: {
            ...context.env,
            MACHINES_CLI_TEST_TTY: "1",
            MACHINES_PROMPT_DRIVER: "plain",
          },
          prompts: [
            { waitFor: "select 1-4:", answer: "1" },
            { waitFor: "continue (optional):", answer: "" },
            { waitFor: "select 1-4:", answer: "4" },
          ],
        },
      );

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /continue in browser/);
      assert.match(result.stdout, /continue in cli/);
      assert.doesNotMatch(result.stdout, /kyc questionnaire/);
    });
  });

  it("enforces non-interactive mode and confirmation behavior on destructive commands", async () => {
    await withMockEnvironment(async (context) => {
      await loginForTests(context);

      const created = await runCliOk(
        ["card", "create", "--name", "delete-check", "--json"],
        context,
      );
      const createdPayload = parseJsonOutput(created.stdout);
      const cardId = createdPayload.card.id;

      const nonInteractiveLimit = await runCli(
        ["card", "limit", "set", "--id", cardId, "--non-interactive"],
        context,
      );
      assert.equal(nonInteractiveLimit.code, 1);
      assert.match(nonInteractiveLimit.stderr, /missing required input: amount \(usd\)/);

      const cancelDelete = await runCliInteractive(
        ["card", "delete", "--id", cardId],
        {
          ...context,
          prompts: [{ waitFor: "delete this card now [y/N]:", answer: "n" }],
        },
      );
      assert.equal(cancelDelete.code, 0);
      assert.match(cancelDelete.stderr, /card delete cancelled by user/);

      const afterCancelList = await runCliOk(["card", "list", "--json"], context);
      const afterCancelPayload = parseJsonOutput(afterCancelList.stdout);
      assert.equal(afterCancelPayload.cards.length, 1);

      const forceDelete = await runCliOk(
        ["card", "delete", "--id", cardId, "--yes", "--json"],
        context,
      );
      const forceDeletePayload = parseJsonOutput(forceDelete.stdout);
      assert.equal(forceDeletePayload.card.status, "canceled");

      const listAfterDelete = await runCliOk(["card", "list", "--json"], context);
      const listAfterDeletePayload = parseJsonOutput(listAfterDelete.stdout);
      assert.equal(listAfterDeletePayload.cards.length, 0);

      const revealCreated = await runCliOk(
        ["card", "create", "--name", "with-reveal", "--reveal", "--json"],
        context,
      );
      const revealCreatedPayload = parseJsonOutput(revealCreated.stdout);
      assert.equal(revealCreatedPayload.reveal.last4, revealCreatedPayload.card.last4);
      assert.match(revealCreatedPayload.reveal.number, new RegExp(`${revealCreatedPayload.card.last4}$`));

      const prefixFlagCard = parseJsonOutput((await runCliOk(
        ["card", "create", "--name", "prefix-flags", "--json"],
        context,
      )).stdout).card;

      const prefixedNonInteractive = await runCliOk(
        [
          "--non-interactive",
          "card",
          "limit",
          "set",
          "--id",
          prefixFlagCard.id,
          "--amount",
          "33",
          "--frequency",
          "perAuthorization",
          "--json",
        ],
        context,
      );
      const prefixedNonInteractivePayload = parseJsonOutput(prefixedNonInteractive.stdout);
      assert.equal(prefixedNonInteractivePayload.card.limit.amount, 33);
      assert.equal(prefixedNonInteractivePayload.card.limit.frequency, "perAuthorization");

      const prefixedDelete = await runCliOk(
        ["--yes", "card", "delete", "--id", prefixFlagCard.id, "--json"],
        context,
      );
      const prefixedDeletePayload = parseJsonOutput(prefixedDelete.stdout);
      assert.equal(prefixedDeletePayload.card.status, "canceled");
    });
  });
});
