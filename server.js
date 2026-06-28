"use strict";

const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const crypto = require("crypto");
const { spawn } = require("child_process");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

const PORT = process.env.PORT || 10000;
const PROMETHEUS_DIR = process.env.PROMETHEUS_DIR || path.join(__dirname, "prometheus");
const LUA_BIN = process.env.LUA_BIN || "lua5.1";
const MAX_CODE_BYTES = Number(process.env.MAX_CODE_BYTES || 200 * 1024); // 200 KB
const OBFUSCATE_TIMEOUT_MS = Number(process.env.OBFUSCATE_TIMEOUT_MS || 20_000);

// Mirrors src/presets.lua in the Prometheus engine. Kept here only for
// validation + UI copy — the actual transformation logic lives in Lua.
const PRESETS = {
  Minify: "Strips whitespace and shortens names. No real protection.",
  Weak: "Light obfuscation. Fast, easy to reverse.",
  Medium: "Balanced: renamed locals, encoded strings, flattened blocks.",
  Strong: "Heaviest preset: control-flow flattening, constant encryption, virtualised constants.",
};

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const obfuscateLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_PER_MINUTE || 12),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Slow down and try again in a minute." },
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/presets", (req, res) => {
  res.json({ presets: PRESETS });
});

app.post("/api/obfuscate", obfuscateLimiter, async (req, res) => {
  const body = req.body || {};
  const code = body.code;
  const preset = body.preset || "Medium";

  if (typeof code !== "string" || code.trim().length === 0) {
    return res.status(400).json({ success: false, error: "Send Lua source as a non-empty string in `code`." });
  }
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    return res.status(413).json({
      success: false,
      error: `Source is too large. Limit is ${Math.round(MAX_CODE_BYTES / 1024)} KB.`,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) {
    return res.status(400).json({
      success: false,
      error: `Unknown preset "${preset}". Choose one of: ${Object.keys(PRESETS).join(", ")}.`,
    });
  }

  const jobId = crypto.randomUUID();
  const inPath = path.join(os.tmpdir(), `cinder-${jobId}.in.lua`);
  const outPath = path.join(os.tmpdir(), `cinder-${jobId}.out.lua`);
  const startedAt = Date.now();

  try {
    await fs.writeFile(inPath, code, "utf8");
    await runObfuscator({ preset, inPath, outPath });
    const output = await fs.readFile(outPath, "utf8");

    res.json({
      success: true,
      preset,
      output,
      bytesIn: Buffer.byteLength(code, "utf8"),
      bytesOut: Buffer.byteLength(output, "utf8"),
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    res.status(422).json({ success: false, error: err.message || "Obfuscation failed." });
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
});

function runObfuscator({ preset, inPath, outPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      LUA_BIN,
      ["cli.lua", "--preset", preset, "--nocolors", "--out", outPath, inPath],
      { cwd: PROMETHEUS_DIR }
    );

    let stderr = "";
    let stdout = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, OBFUSCATE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the obfuscator: ${err.message}`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("Obfuscation timed out — the script may be too large or too complex for this preset."));
        return;
      }
      if (exitCode !== 0) {
        const detail = (stderr || stdout).trim();
        reject(new Error(detail || `The obfuscator exited with code ${exitCode}. Check that the source is valid Lua.`));
        return;
      }
      resolve();
    });
  });
}

app.use((req, res) => res.status(404).json({ success: false, error: "Not found." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`Cinder is listening on port ${PORT}`);
});
