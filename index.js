import fs from "fs";
import path from "path";
import WebPageTest from "webpagetest";

import { getConfig } from "./utils/config.js";
import { log } from "./utils/log.js";
import { Pool } from "./Pool.js";

const wpt = new WebPageTest("www.webpagetest.org");

const API_KEY = process.env.WPT_APIKEY;
if (!API_KEY) {
  throw new Error(
    "WPT_APIKEY was undefined. Please provide it as an environment variable"
  );
}

async function runTest({ url, runs = 1 }) {
  return new Promise((resolve, reject) => {
    wpt.runTest(
      url,
      {
        key: API_KEY,
        timeline: 1,
        profiler: 1,
        timelineCallStack: 5,
        firstViewOnly: true,
        runs,
        label: "wpt-gauntlet",
      },
      (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data);
      }
    );
  });
}

async function getTimelineData({ testId, run }) {
  return new Promise((resolve, reject) => {
    wpt.getTimelineData(
      testId,
      {
        key: API_KEY,
        run,
      },
      (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data);
      }
    );
  });
}

async function waitForTest({ testId, timeout, logOutput = true }) {
  const POLL_INTERVAL_MS = 5000;
  return new Promise((resolve, reject) => {
    const rejectTimer = setTimeout(() => {
      reject("Waiting for test timed out");
    }, timeout * 1000 * 60);

    setInterval(() => {
      wpt.getTestStatus(testId, (err, data) => {
        if (err) {
          clearTimeout(rejectTimer);
          reject(err);
        } else {
          if (data.statusCode === 200) {
            resolve(data);
            clearTimeout(rejectTimer);
          } else {
            log(`testId: ${testId} – ${data.statusText || "No status yet"}`);
          }
        }
      });
    }, POLL_INTERVAL_MS);
  });
}

/**
 * Collect summary test results from a particular test ID
 * @param { testId }
 * @returns An array of summary results, one for each run
 */
async function getTestResults({ testId }) {
  return new Promise((resolve, reject) => {
    wpt.getTestResults(
      testId,
      {
        key: API_KEY,
      },
      (err, result) => {
        if (err) {
          reject(err);
        }
        // Drill into firstView since we're currently always doing first view only
        resolve(Object.values(result.data.runs).map((run) => run.firstView));
      }
    );
  });
}

/**
 * Split a total into batches, Eg. batchSize=10, total=44, produces [10, 10, 10, 10, 4]
 * @param {*} total
 * @param {*} batchSize
 * @returns
 */
function splitIntoBatches(total, batchSize) {
  return [
    ...Array(Math.floor(total / batchSize)).fill(batchSize),
    total % batchSize,
  ].filter((n) => n > 0);
}

async function startTests({ url, runs, maxRunsPerTest, pool }) {
  const runsForTests = splitIntoBatches(runs, maxRunsPerTest);

  const tests = runsForTests.map((runs) =>
    pool.whenFree(async () => {
      return await runTest({ runs, url });
    })
  );

  const settledResults = await Promise.allSettled(tests);

  const testIdsToFetch = settledResults.map(
    ({
      value: {
        data: { testId },
      },
    }) => testId
  );

  return testIdsToFetch;
}

async function collectSummaries({
  testIds,
  timeout,
  output,
  outputDirectoryPath,
}) {
  const resultPromises = testIds.map((testId) => {
    return getTestResults({ testId, timeout });
  });

  const summaries = (await Promise.allSettled(resultPromises))
    .map((summary) => summary.value)
    .flat();

  summaries.forEach((summary, index) => {
    fs.writeFileSync(
      path.join(outputDirectoryPath, `${output}-summary-${index}.json`),
      JSON.stringify(summary)
    );
  });
}

async function collectProfiles({
  output,
  outputDirectoryPath,
  testStatuses,
  maxRunsPerTest,
  pool,
}) {
  const individualTimelines = testStatuses
    .map(
      (
        {
          value: {
            data: {
              id: testId,
              testInfo: { runs },
            },
          },
        },
        batch
      ) => {
        const timelinesToFetch = [];
        for (let i = 0; i < runs; i++) {
          timelinesToFetch.push({
            testId,
            run: i,
            index: batch * maxRunsPerTest + i,
          });
        }
        return timelinesToFetch;
      }
    )
    .flat();

  const outputWritePromises = individualTimelines.map(
    async ({ testId, run, index }) => {
      await pool.whenFree(async () => {
        const timelineData = await getTimelineData({ testId, run });
        fs.writeFileSync(
          path.join(outputDirectoryPath, `${output}-profile-${index}.json`),
          JSON.stringify(timelineData)
        );
      });
    }
  );

  await Promise.allSettled(outputWritePromises);
}

async function main(config) {
  const MAX_RUNS_PER_TEST = 10;

  const {
    url,
    runs,
    timeout,
    testIds,
    outputDirectory,
    output,
    resultType,
    batchSize,
    batchDelay,
  } = config;

  const outputDirectoryPath = path.resolve(outputDirectory);
  const shouldOutputSummary = resultType.includes("summary");
  const shouldOutputProfile = resultType.includes("profile");

  const pool = new Pool(config.pool);
  let testIdsToFetch = testIds ? testIds.split(",") : null;
  let testStatuses = [];

  if (!testIdsToFetch) {
    testIdsToFetch = [];
    const batchesToRun = splitIntoBatches(runs, batchSize);
    let batchIndex = 0;
    for (let batch of batchesToRun) {
      batchIndex++;
      const testIdsInBatch = await startTests({
        url,
        runs: batch,
        maxRunsPerTest: MAX_RUNS_PER_TEST,
        pool,
      });
      log(
        `Test batch ${batchIndex} of ${
          batchesToRun.length
        } started. testIds in batch: ${testIdsInBatch.join(",")}`
      );

      log(`Waiting ${timeout} minutes for tests to be completed`);

      const testStatusPromises = testIdsToFetch.map((testId) => {
        return waitForTest({ testId, timeout });
      });
      const testBatchStatuses = await Promise.allSettled(testStatusPromises);
      testStatuses.push(...testBatchStatuses);
      testIdsToFetch.push(...testIdsInBatch);
      log(`Batch completed.`);
    }
    log(`All tests complete. testIds: ${testIdsToFetch.join(",")}`);
  } else {
    log(
      `testIds provided: ${testIdsToFetch.join(
        ","
      )}. Skipped kicking off new tests.`
    );

    log(`Waiting ${timeout} minutes for tests to be completed`);

    const testStatusPromises = testIdsToFetch.map((testId) => {
      return waitForTest({ testId, timeout });
    });

    testStatuses = await Promise.allSettled(testStatusPromises);

    log(`All tests completed.`);
  }

  // Summary results
  if (shouldOutputSummary) {
    log(`Collecting summaries.`);
    await collectSummaries({
      outputDirectoryPath,
      testIds: testIdsToFetch,
      timeout,
      output,
    });
    log(`Summaries written to files in ${outputDirectoryPath}`);
  }

  // Profile results
  if (shouldOutputProfile) {
    log(`Collecting profiles.`);
    await collectProfiles({
      outputDirectoryPath,
      testStatuses,
      maxRunsPerTest: MAX_RUNS_PER_TEST,
      output,
      pool,
    });
    log(`Profiles written to files in ${outputDirectoryPath}`);
  }

  return Promise.resolve();
}

const config = getConfig();
main(config).then(() => {
  process.exit();
});
