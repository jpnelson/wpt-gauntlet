import yargs from "yargs";
import { cosmiconfigSync } from "cosmiconfig";

const optionsSchema = {
  url: {
    default: null,
    type: "string",
    describe: "The url to test",
  },
  script: {
    default: null,
    type: "string",
    describe: "A script to run",
  },
  output: {
    default: "test",
    type: "string",
    describe:
      "The output profile name prefix. Will be suffixed with the count, eg. ${output}-1.json",
  },
  outputDirectory: {
    default: "output",
    type: "string",
    describe: "The output directory for profiles",
  },
  runs: {
    default: 1,
    type: "number",
    describe: "The number of runs to perform",
  },
  timeout: {
    default: 2,
    type: "number",
    describe: "Max number of minutes to wait for test result",
  },
  pool: {
    default: 10,
    type: "number",
    describe: "The max pool size, for parallel requests",
  },
  batchSize: {
    default: 20,
    type: "number",
    describe: "The max number of tests to allow running at once",
  },
  batchDelay: {
    default: 0,
    type: "number",
    describe: "The amount of time to allow between tests",
  },
  offsetIndex: {
    default: 0,
    type: "number",
    describe:
      "The index to offset by when naming files, useful for extending batches",
  },
  resultType: {
    default: "profile",
    type: "string",
    describe:
      "Comma separated list of data to collect. Options include profile,summary",
  },
  testIds: {
    default: null,
    type: "string",
    describe:
      "Comma separated list of test ids to fetch. If provided, skips running the tests and just fetches results",
  },
};

const yargv = yargs(process.argv.slice(2));
Object.keys(optionsSchema).forEach((optionName) => {
  yargv.option(optionName, optionsSchema[optionName]);
});

const { argv } = yargv;

export function getConfig() {
  // Try config file
  const explorerSync = cosmiconfigSync("wpt-gauntlet");
  const { config: configFromFile } = explorerSync.search() || { config: {} };

  const config = {};
  Object.keys(optionsSchema).forEach((optionName) => {
    config[optionName] =
      argv[optionName] ??
      configFromFile[optionName] ??
      optionsSchema[optionName].default;
  });

  return config;
}
