import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Library Pipeline Result Comparer
 *
 * Compares your pipeline output against:
 *
 * expected_pipeline_output.csv
 *
 * ------------------------------------------
 * USAGE
 * ------------------------------------------
 *
 * npx tsx compare-results.ts ./my-output.csv
 *
 * OR
 *
 * ts-node compare-results.ts ./my-output.csv
 *
 * ------------------------------------------
 * WHAT IT CHECKS
 * ------------------------------------------
 *
 * - Row counts
 * - Column counts
 * - Missing rows
 * - Extra rows
 * - Hash equality
 * - Exact row matches
 * - Data mismatches
 * - Order-independent validation
 *
 * ------------------------------------------
 * EXPECTED OUTPUT FORMAT
 * ------------------------------------------
 *
 * checkout_id
 * customer_name
 * book_title
 * library_name
 * author_name_last_comma_first
 * genre
 * checkout_date
 * return_date
 * late_fee
 * book_age_years
 * customer_state
 * is_overdue
 */

const EXPECTED_FILE = path.join(
  process.cwd(),
  'generated-library-data',
  'expected_pipeline_output.csv'
);

const actualFile = process.argv[2];

if (!actualFile) {
  console.error('\nERROR: Missing actual result CSV path\n');
  console.log('Usage:');
  console.log('npx tsx compare-results.ts ./my-output.csv\n');
  process.exit(1);
}

if (!fs.existsSync(actualFile)) {
  console.error(`\nERROR: File does not exist -> ${actualFile}\n`);
  process.exit(1);
}

if (!fs.existsSync(EXPECTED_FILE)) {
  console.error('\nERROR: expected_pipeline_output.csv not found\n');
  console.error(`Expected path: ${EXPECTED_FILE}\n`);
  process.exit(1);
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function normalizeRow(row: string): string {
  return row
    .trim()
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ');
}

function hashRow(row: string): string {
  return crypto
    .createHash('sha256')
    .update(row)
    .digest('hex');
}

function hashFile(rows: string[]): string {
  const hash = crypto.createHash('sha256');

  for (const row of rows) {
    hash.update(row);
  }

  return hash.digest('hex');
}

function loadCsv(filePath: string) {
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map(normalizeRow)
    .filter(Boolean);

  const header = lines[0];
  const rows = lines.slice(1);

  return {
    header,
    rows,
  };
}

function printDivider() {
  console.log('------------------------------------------------------------');
}

// --------------------------------------------------
// LOAD FILES
// --------------------------------------------------

console.log('\nLoading files...\n');

const expected = loadCsv(EXPECTED_FILE);
const actual = loadCsv(actualFile);

// --------------------------------------------------
// HEADER VALIDATION
// --------------------------------------------------

printDivider();
console.log('HEADER VALIDATION');
printDivider();

if (expected.header === actual.header) {
  console.log('PASS: Headers match exactly');
} else {
  console.log('FAIL: Headers do not match');
  console.log('\nExpected:');
  console.log(expected.header);
  console.log('\nActual:');
  console.log(actual.header);
}

// --------------------------------------------------
// ROW COUNT VALIDATION
// --------------------------------------------------

printDivider();
console.log('ROW COUNT VALIDATION');
printDivider();

console.log(`Expected Rows: ${expected.rows.length.toLocaleString()}`);
console.log(`Actual Rows:   ${actual.rows.length.toLocaleString()}`);

if (expected.rows.length === actual.rows.length) {
  console.log('PASS: Row counts match');
} else {
  console.log('FAIL: Row counts differ');
}

// --------------------------------------------------
// HASH VALIDATION
// --------------------------------------------------

printDivider();
console.log('FILE HASH VALIDATION');
printDivider();

const expectedHash = hashFile(expected.rows);
const actualHash = hashFile(actual.rows);

console.log(`Expected Hash: ${expectedHash}`);
console.log(`Actual Hash:   ${actualHash}`);

if (expectedHash === actualHash) {
  console.log('PASS: Entire datasets match exactly');
} else {
  console.log('FAIL: Dataset hashes differ');
}

// --------------------------------------------------
// ORDER-INDEPENDENT VALIDATION
// --------------------------------------------------

printDivider();
console.log('ORDER-INDEPENDENT VALIDATION');
printDivider();

const expectedSet = new Set(expected.rows.map(hashRow));
const actualSet = new Set(actual.rows.map(hashRow));

let missingCount = 0;
let extraCount = 0;

const missingExamples: string[] = [];
const extraExamples: string[] = [];

for (const row of expected.rows) {
  const hash = hashRow(row);

  if (!actualSet.has(hash)) {
    missingCount++;

    if (missingExamples.length < 5) {
      missingExamples.push(row);
    }
  }
}

for (const row of actual.rows) {
  const hash = hashRow(row);

  if (!expectedSet.has(hash)) {
    extraCount++;

    if (extraExamples.length < 5) {
      extraExamples.push(row);
    }
  }
}

console.log(`Missing Rows: ${missingCount.toLocaleString()}`);
console.log(`Extra Rows:   ${extraCount.toLocaleString()}`);

if (missingCount === 0 && extraCount === 0) {
  console.log('PASS: Order-independent comparison succeeded');
} else {
  console.log('FAIL: Dataset contents differ');
}

// --------------------------------------------------
// EXAMPLES
// --------------------------------------------------

if (missingExamples.length > 0) {
  printDivider();
  console.log('MISSING ROW EXAMPLES');
  printDivider();

  for (const row of missingExamples) {
    console.log(row);
  }
}

if (extraExamples.length > 0) {
  printDivider();
  console.log('EXTRA ROW EXAMPLES');
  printDivider();

  for (const row of extraExamples) {
    console.log(row);
  }
}

// --------------------------------------------------
// FINAL RESULT
// --------------------------------------------------

printDivider();
console.log('FINAL RESULT');
printDivider();

const success =
  expected.header === actual.header &&
  expected.rows.length === actual.rows.length &&
  missingCount === 0 &&
  extraCount === 0;

if (success) {
  console.log('SUCCESS: Your pipeline output matches expected_pipeline_output.csv');
  process.exit(0);
} else {
  console.log('FAILURE: Your pipeline output does not match expected results');
  process.exit(1);
}
