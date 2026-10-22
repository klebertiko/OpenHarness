/**
 * The main ruleset requires status checks by the exact check-run name a job
 * reports, which for GitHub Actions is the job's `name:` — not
 * "<workflow> / <job>" as the PR page displays it. A context no job reports
 * leaves every PR "Expected — waiting for status" forever.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github", "workflows");

function requiredContexts() {
  const ruleset = JSON.parse(readFileSync(join(root, ".github", "rulesets", "main.json"), "utf8"));
  return ruleset.rules
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => rule.parameters.required_status_checks.map((check) => check.context));
}

/** Every job's reported check-run name: its `name:`, or its id when unnamed. */
function reportedCheckNames() {
  const names = [];
  for (const file of readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split(/\r?\n/);
    const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
    if (jobsAt < 0) continue;
    let job = null;
    for (const line of lines.slice(jobsAt + 1)) {
      const jobId = line.match(/^ {2}([\w-]+):\s*$/);
      if (jobId) {
        if (job) names.push(job);
        job = { file, name: jobId[1] };
        continue;
      }
      const jobName = line.match(/^ {4}name:\s*["']?(.+?)["']?\s*$/);
      if (job && jobName) job.name = jobName[1];
    }
    if (job) names.push(job);
  }
  return names;
}

describe("main ruleset required checks", () => {
  const contexts = requiredContexts();
  const reported = reportedCheckNames();

  it("requires at least one check", () => {
    assert.ok(contexts.length > 0);
  });

  for (const context of contexts) {
    it(`"${context}" is reported by exactly one workflow job`, () => {
      const matches = reported.filter((job) => job.name === context);
      assert.equal(
        matches.length,
        1,
        `expected one job named "${context}", found ${JSON.stringify(matches)}`,
      );
    });
  }
});
