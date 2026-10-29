/*
 * Runs every live-audit proof in order against one backend.
 *
 * The proof list lives in package.json (`verify:audit:steps`) so the npm
 * scripts and this runner cannot drift apart. Each step is spawned with a
 * preload that waits out the sign-in throttle when a proof reaches it; the
 * throttle itself stays at its production setting and is still exercised.
 *
 * A browser proof that fails is retried once before the run stops. The retry
 * is printed with the step number, so a flaky step is visible rather than
 * silent; a proof that fails twice still stops the audit.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

const STEP_ATTEMPTS = 2;

const pkg = require("../package.json");
const chain = (pkg.scripts || {})["verify:audit:steps"];
if (!chain) {
  console.error("verify:audit:steps is missing from package.json.");
  process.exit(1);
}

const helper = path.join(__dirname, "helpers", "throttle-retry.cjs").replace(/\\/g, "/");
const steps = chain
  .split(" && ")
  .map((step) => step.trim())
  .filter(Boolean);

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require="${helper}"`.trim(),
};

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step, { shell: true, stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${step} stopped by signal ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  console.log(`Live audit: ${steps.length} steps, one backend, in order.`);
  const startedAt = Date.now();
  const retried = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    let code = 1;
    for (let attempt = 1; attempt <= STEP_ATTEMPTS; attempt += 1) {
      console.log(`\n> [audit ${index + 1}/${steps.length}] ${step}`);
      if (attempt > 1) {
        console.warn(`Retrying this step once before stopping the audit.`);
        retried.push(step);
      }
      code = await runStep(step);
      if (code === 0) break;
    }
    if (code !== 0) {
      console.error(
        `\nLive audit stopped: step ${index + 1}/${steps.length} failed twice (${step}).`
      );
      process.exit(code);
    }
  }
  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
  const retryNote = retried.length
    ? `; retried once and passed: ${retried.join(", ")}`
    : "";
  console.log(
    `\nLive audit passed: ${steps.length}/${steps.length} steps in ${minutes} minutes${retryNote}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
