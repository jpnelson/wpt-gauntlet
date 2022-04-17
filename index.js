import fs from "fs";
import path from "path";
import WebPageTest from "webpagetest";

import { getConfig } from "./utils/config.js";
import { log } from "./utils/log.js";
import { Pool } from "./Pool.js";

const wpt = new WebPageTest("www.webpagetest.org");

const API_KEY = process.env.WPT_APIKEY;

async function runTest({ url, runs = 1 }) {
  return new Promise((resolve, reject) => {
    wpt.runTest(
      url,
      {
        key: API_KEY,
        timeline: 1,
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
async function main(config) {
  const MAX_RUNS_PER_TEST = 10;

  const { url, runs, output, timeout, testIds, outputDirectory } = config;
  const pool = new Pool(config.pool);
  let testIdsToFetch = testIds ? testIds.split(",") : null;

  if (!testIdsToFetch) {
    // Eg. MAX_RUNS_PER_TEST=10, runs=44, produces [10, 10, 10, 10, 4]
    const testBatches = [
      ...Array(Math.floor(runs / MAX_RUNS_PER_TEST)).fill(MAX_RUNS_PER_TEST),
      runs % MAX_RUNS_PER_TEST,
    ];

    const tests = testBatches.map((runs) =>
      pool.whenFree(async () => {
        return await runTest({ runs, url });
      })
    );

    const settledResults = await Promise.allSettled(tests);

    testIdsToFetch = settledResults.map(
      ({
        value: {
          data: { testId },
        },
      }) => testId
    );

    log(`Tests started. test ids: ${JSON.stringify(testIdsToFetch)}`);
  } else {
    log(
      `testIds provided: ${JSON.stringify(
        testIdsToFetch
      )}. Skipped kicking off new tests`
    );
  }

  log(`Waiting ${timeout} minutes for tests to be completed`);

  const timelineStatusPromises = testIdsToFetch.map((testId) => {
    return waitForTest({ testId, timeout });
  });

  const timelineStatuses = await Promise.allSettled(timelineStatusPromises);

  log(`All tests completed.`);

  const outputDirectoryPath = path.resolve(outputDirectory);
  const individualTimelines = timelineStatuses
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
            index: batch * MAX_RUNS_PER_TEST + i,
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
          path.join(outputDirectoryPath, `${output}-${index}.json`),
          JSON.stringify(timelineData)
        );
      });
    }
  );

  await Promise.allSettled(outputWritePromises);

  log(`Test output written to files in ${outputDirectoryPath}`);

  return Promise.resolve();
}

const config = getConfig();
main(config).then(() => {
  process.exit();
});
