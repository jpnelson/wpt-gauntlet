import chalk from "chalk";

export function error(message) {
  console.error(chalk.red("[⚔️ wpt-gauntlet]"), message);
}
