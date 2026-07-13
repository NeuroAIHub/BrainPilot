/**
 * vitest.setup.ts — global setup for the @brainpilot/app (CLI) test suite.
 *
 * #284: nearly every CLI test calls `up`/`scaffold`/`init`, each of which
 * scaffolds a fresh temp data dir and — before this switch — recursively copied
 * the entire bundled `@brainpilot/skills` tree (hundreds of files, growing with
 * every added skill). That copy is pure disk IO unrelated to the code under
 * test; on a contended 2-core CI runner it dominates wall-clock and flakily
 * blew the per-test timeout (e.g. up.test.ts port-precheck cases).
 *
 * Setting BP_SKIP_SKILL_COPY here makes `scaffold` skip the copy for the whole
 * CLI suite, so test time is flat with respect to skill-directory size. The
 * real skill copy is still exercised directly by the runtime's
 * materialize-skills tests, and a production launch (which never sets this flag)
 * still materialises skills — both via `scaffold` and again on server startup.
 *
 * Tests that need to assert the copy behaviour can override this per-call by
 * passing `{ skipSkillCopy: false }` to `scaffold` (see scaffold.test.ts).
 */
process.env.BP_SKIP_SKILL_COPY = "1";
