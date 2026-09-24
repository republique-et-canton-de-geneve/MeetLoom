#!/usr/bin/env node
// `npm run lint`: ESLint with a two-way warning budget.
//
// Errors always fail. Warnings are findings that predate the linter (React
// hooks rules of the React Compiler era and jsx-a11y): the count may not rise,
// and when a change removes some, lower BUDGET in the same change, otherwise
// the freed slots would silently be spent by the next warning.
import { ESLint } from "eslint";

const BUDGET = 80;

const eslint = new ESLint();
const results = await eslint.lintFiles(["."]);
const errors = results.reduce((sum, result) => sum + result.errorCount, 0);
const warnings = results.reduce((sum, result) => sum + result.warningCount, 0);
const formatter = await eslint.loadFormatter("stylish");
const output = await formatter.format(
  errors ? results.filter((result) => result.errorCount) : results,
);
if (errors || warnings > BUDGET) process.stdout.write(output);

if (errors) {
  console.error(`\nlint: ${errors} error(s). Errors always fail.`);
  process.exit(1);
}
if (warnings > BUDGET) {
  console.error(
    `\nlint: ${warnings} warnings, budget ${BUDGET}. Fix the new warnings; never raise the budget.`,
  );
  process.exit(1);
}
if (warnings < BUDGET) {
  console.error(
    `\nlint: ${warnings} warnings, budget ${BUDGET}. Well done: lower BUDGET in scripts/lint.mjs to ${warnings} in this change.`,
  );
  process.exit(1);
}
console.log(`lint: 0 errors, ${warnings}/${BUDGET} budgeted warnings.`);
