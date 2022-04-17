const fs = require("fs");
const WebPageTest = require("webpagetest");
const wpt = new WebPageTest("www.webpagetest.org");

const { cosmiconfigSync } = require("cosmiconfig");
const explorerSync = cosmiconfigSync("wpt-gauntlet");
const loadedConfig = explorerSync.search();

const API_KEY = process.env.WPT_API_KEY;

async function runTest() {
  return new Promise((resolve, reject) => {
    wpt.runTest(
      "https://google.com",
      {
        key: API_KEY,
        timeline: 1,
        timelineCallStack: 5,
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

async function getTimelineData({ testId }) {
  return new Promise((resolve, reject) => {
    wpt.getTimelineData(
      testId,
      {
        key: API_KEY,
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

async function main() {
  // const { data: { testId } } = await runTest();
  // console.log(testId);
  const data = await getTimelineData({ testId: "220417_AiDcTQ_86R" });
  console.log(data);
  fs.writeFileSync("profile.json", JSON.stringify(data));
}

main();
