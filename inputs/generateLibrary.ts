import fs from 'fs';
import path from 'path';

/**
 * Library Dataset Generator
 *
 * Generates interconnected CSV files for:
 * - libraries
 * - authors
 * - books
 * - guests
 * - checkouts
 *
 * Designed for:
 * - ETL testing
 * - relational database imports
 * - analytics pipelines
 * - data warehouse experiments
 * - query optimization practice
 * - CSV ingestion testing
 *
 * ------------------------------------------
 * QUICK START
 * ------------------------------------------
 *
 * npx tsx generate-library-data.ts
 *
 * OR
 *
 * ts-node generate-library-data.ts
 *
 * ------------------------------------------
 * OUTPUT
 * ------------------------------------------
 * ./generated-library-data/
 *
 * libraries.csv
 * authors.csv
 * books.csv
 * guests.csv
 * checkouts.csv
 *
 * ------------------------------------------
 * DEFAULT SCALE
 * ------------------------------------------
 * libraries:    250
 * authors:      15,000
 * books:        500,000
 * guests:       2,000,000
 * checkouts:    15,000,000
 *
 * Large enough to stress pipelines,
 * but simpler than the automotive dataset.
 */

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const OUTPUT_DIR = path.join(process.cwd(), 'generated-library-data');

const CONFIG = {
  libraries: 250,
  authors: 15_000,
  books: 500_000,
  guests: 1_000_000,
  checkouts: 2_000_000,
};

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

const CITIES = [
  'New York',
  'Los Angeles',
  'Chicago',
  'Houston',
  'Phoenix',
  'Philadelphia',
  'San Antonio',
  'San Diego',
  'Dallas',
  'Austin',
  'Seattle',
  'Denver',
  'Boston',
  'Portland',
  'Nashville',
  'Detroit',
  'Atlanta',
  'Miami',
  'Orlando',
  'Indianapolis',
];

const FIRST_NAMES = [
  'James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','William','Elizabeth',
  'David','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen',
  'Christopher','Nancy','Daniel','Lisa','Matthew','Betty','Anthony','Margaret','Mark','Sandra',
  'Donald','Ashley','Steven','Kimberly','Paul','Emily','Andrew','Donna','Joshua','Michelle',
  'Kenneth','Dorothy','Kevin','Carol','Brian','Amanda','George','Melissa','Edward','Deborah'
];

const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
  'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin',
  'Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson',
  'Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores'
];

const STREET_NAMES = [
  'Main', 'Oak', 'Pine', 'Maple', 'Cedar', 'Elm', 'Washington', 'Lake', 'Hill', 'Sunset',
  'Park', 'Lincoln', 'Jefferson', 'River', 'Madison', 'Cherry', 'Highland', 'Forest', 'Center'
];

const GENRES = [
  'Fantasy',
  'Science Fiction',
  'Mystery',
  'Thriller',
  'Romance',
  'Historical Fiction',
  'Biography',
  'Horror',
  'Self Help',
  'Business',
  'Philosophy',
  'Poetry',
  'Adventure',
  'Young Adult',
  'Children',
  'Classic',
  'Drama',
  'Crime',
  'Education',
  'Technology',
];

const BOOK_WORDS = [
  'Shadow', 'Empire', 'Dream', 'Fire', 'Moon', 'Kingdom', 'Secret', 'Chronicle', 'Memory', 'Storm',
  'Whisper', 'Night', 'Journey', 'Legacy', 'Echo', 'Heart', 'Silence', 'Truth', 'Code', 'Garden',
  'River', 'Light', 'Fate', 'Machine', 'Winter', 'Summer', 'Blood', 'Star', 'World', 'Glass'
];

// --------------------------------------------------
// UTILITIES
// --------------------------------------------------

function ensureDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)];
}

function chance(percent: number): boolean {
  return Math.random() * 100 < percent;
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';

  const str = String(value);

  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function writeRow(stream: fs.WriteStream, values: any[]) {
  stream.write(values.map(csvEscape).join(',') + '\n');
}

function randomDate(startYear = 2015, endYear = 2025): string {
  const year = rand(startYear, endYear);
  const month = rand(1, 12).toString().padStart(2, '0');
  const day = rand(1, 28).toString().padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function randomPhone(): string {
  return `${rand(200, 999)}-${rand(100, 999)}-${rand(1000, 9999)}`;
}

function randomAddress(): string {
  return `${rand(100, 9999)} ${pick(STREET_NAMES)} St`;
}

function randomEmail(first: string, last: string): string {
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

  return `${first.toLowerCase()}.${last.toLowerCase()}${rand(1, 99999)}@${pick(domains)}`;
}

function randomBookTitle(): string {
  return `${pick(BOOK_WORDS)} of the ${pick(BOOK_WORDS)}`;
}

function randomISBN(): string {
  let isbn = '978';

  for (let i = 0; i < 10; i++) {
    isbn += rand(0, 9);
  }

  return isbn;
}

function memoryUsage() {
  const used = process.memoryUsage();

  console.log({
    rssMB: (used.rss / 1024 / 1024).toFixed(2),
    heapUsedMB: (used.heapUsed / 1024 / 1024).toFixed(2),
  });
}

// --------------------------------------------------
// ID CACHES
// --------------------------------------------------

const libraryIds: number[] = [];
const authorIds: number[] = [];
const bookIds: number[] = [];
const guestIds: number[] = [];

// --------------------------------------------------
// GENERATORS
// --------------------------------------------------

async function generateLibraries() {
  console.log('Generating libraries...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'libraries.csv'));

  writeRow(file, [
    'library_id',
    'name',
    'city',
    'state',
    'address',
    'zip_code',
    'opened_year',
  ]);

  for (let i = 1; i <= CONFIG.libraries; i++) {
    libraryIds.push(i);

    writeRow(file, [
      i,
      `${pick(CITIES)} Public Library ${i}`,
      pick(CITIES),
      pick(STATES),
      randomAddress(),
      rand(10000, 99999),
      rand(1880, 2020),
    ]);
  }

  file.end();
}

async function generateAuthors() {
  console.log('Generating authors...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'authors.csv'));

  writeRow(file, [
    'author_id',
    'first_name',
    'last_name',
    'birth_year',
    'country',
  ]);

  const countries = [
    'United States',
    'Canada',
    'United Kingdom',
    'Germany',
    'France',
    'Japan',
    'Australia',
    'Brazil',
    'Italy',
    'Spain',
  ];

  for (let i = 1; i <= CONFIG.authors; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);

    authorIds.push(i);

    writeRow(file, [
      i,
      first,
      last,
      rand(1940, 2000),
      pick(countries),
    ]);

    if (i % 5000 === 0) {
      console.log(`authors: ${i.toLocaleString()}`);
    }
  }

  file.end();
}

async function generateBooks() {
  console.log('Generating books...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'books.csv'));

  writeRow(file, [
    'book_id',
    'author_id',
    'library_id',
    'title',
    'genre',
    'isbn',
    'published_year',
    'page_count',
    'language',
    'copies_available',
  ]);

  const languages = [
    'English',
    'Spanish',
    'French',
    'German',
    'Japanese',
  ];

  for (let i = 1; i <= CONFIG.books; i++) {
    bookIds.push(i);

    writeRow(file, [
      i,
      pick(authorIds),
      pick(libraryIds),
      randomBookTitle(),
      pick(GENRES),
      randomISBN(),
      rand(1950, 2025),
      rand(80, 1200),
      pick(languages),
      rand(0, 15),
    ]);

    if (i % 100_000 === 0) {
      console.log(`books: ${i.toLocaleString()}`);
      memoryUsage();
    }
  }

  file.end();
}

async function generateGuests() {
  console.log('Generating guests...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'guests.csv'));

  writeRow(file, [
    'guest_id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'address',
    'city',
    'state',
    'zip_code',
    'member_since',
    'active_member',
  ]);

  for (let i = 1; i <= CONFIG.guests; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);

    guestIds.push(i);

    writeRow(file, [
      i,
      first,
      last,
      randomEmail(first, last),
      randomPhone(),
      randomAddress(),
      pick(CITIES),
      pick(STATES),
      rand(10000, 99999),
      randomDate(2005, 2025),
      chance(92),
    ]);

    if (i % 100_000 === 0) {
      console.log(`guests: ${i.toLocaleString()}`);
      memoryUsage();
    }
  }

  file.end();
}

async function generateCheckouts() {
  console.log('Generating checkouts...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'checkouts.csv'));

  writeRow(file, [
    'checkout_id',
    'guest_id',
    'book_id',
    'library_id',
    'checkout_date',
    'due_date',
    'return_date',
    'late_fee',
    'returned',
  ]);

  for (let i = 1; i <= CONFIG.checkouts; i++) {
    const checkoutDate = randomDate(2018, 2025);
    const returned = chance(88);

    writeRow(file, [
      i,
      pick(guestIds),
      pick(bookIds),
      pick(libraryIds),
      checkoutDate,
      randomDate(2018, 2025),
      returned ? randomDate(2018, 2025) : '',
      returned ? (chance(15) ? rand(1, 50) : 0) : rand(0, 100),
      returned,
    ]);

    if (i % 250_000 === 0) {
      console.log(`checkouts: ${i.toLocaleString()}`);
      memoryUsage();
    }
  }

  file.end();
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------

async function main() {
  console.log('---------------------------------------');
  console.log(' LIBRARY DATASET GENERATOR');
  console.log('---------------------------------------');

  ensureDir();

  const start = Date.now();

  await generateLibraries();
  await generateAuthors();
  await generateBooks();
  await generateGuests();
  await generateCheckouts();

  const end = Date.now();

  console.log('---------------------------------------');
  console.log(' COMPLETE');
  console.log('---------------------------------------');
  console.log(`Time: ${((end - start) / 1000).toFixed(2)}s`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// --------------------------------------------------
// PIPELINE VALIDATION TEST SUITE
// --------------------------------------------------

/**
 * This section generates:
 *
 * expected_pipeline_output.csv
 *
 * The file acts as a validation target for your ETL/data pipeline.
 *
 * Your challenge:
 *
 * Starting with the normalized CSVs:
 * - libraries
 * - authors
 * - books
 * - guests
 * - checkouts
 *
 * Build a pipeline that transforms the data into the
 * exact same output shape as expected_pipeline_output.csv.
 *
 * This lets you:
 * - validate joins
 * - validate denormalization
 * - validate aggregation logic
 * - validate formatting
 * - compare row counts
 * - compare hashes/checksums
 * - benchmark transformations
 */

async function generateExpectedPipelineOutput() {
  console.log('Generating expected pipeline output...');

  const outputFile = fs.createWriteStream(
    path.join(OUTPUT_DIR, 'expected_pipeline_output.csv')
  );

  writeRow(outputFile, [
    'checkout_id',
    'customer_name',
    'book_title',
    'library_name',
    'author_name_last_comma_first',
    'genre',
    'checkout_date',
    'return_date',
    'late_fee',
    'book_age_years',
    'customer_state',
    'is_overdue',
  ]);

  // --------------------------------------------------
  // LOAD SMALLER TABLES INTO MEMORY
  // --------------------------------------------------

  const libraries = new Map<number, any>();
  const authors = new Map<number, any>();
  const books = new Map<number, any>();
  const guests = new Map<number, any>();

  // LIBRARIES
  const libraryLines = fs
    .readFileSync(path.join(OUTPUT_DIR, 'libraries.csv'), 'utf8')
    .split('')
    .slice(1)
    .filter(Boolean);

  for (const line of libraryLines) {
    const cols = line.split(',');

    libraries.set(Number(cols[0]), {
      id: Number(cols[0]),
      name: cols[1],
    });
  }

  // AUTHORS
  const authorLines = fs
    .readFileSync(path.join(OUTPUT_DIR, 'authors.csv'), 'utf8')
    .split('')
    .slice(1)
    .filter(Boolean);

  for (const line of authorLines) {
    const cols = line.split(',');

    authors.set(Number(cols[0]), {
      id: Number(cols[0]),
      first: cols[1],
      last: cols[2],
    });
  }

  // BOOKS
  const bookLines = fs
    .readFileSync(path.join(OUTPUT_DIR, 'books.csv'), 'utf8')
    .split('')
    .slice(1)
    .filter(Boolean);

  for (const line of bookLines) {
    const cols = line.split(',');

    books.set(Number(cols[0]), {
      id: Number(cols[0]),
      authorId: Number(cols[1]),
      libraryId: Number(cols[2]),
      title: cols[3],
      genre: cols[4],
      publishedYear: Number(cols[6]),
    });
  }

  // GUESTS
  const guestLines = fs
    .readFileSync(path.join(OUTPUT_DIR, 'guests.csv'), 'utf8')
    .split('')
    .slice(1)
    .filter(Boolean);

  for (const line of guestLines) {
    const cols = line.split(',');

    guests.set(Number(cols[0]), {
      id: Number(cols[0]),
      first: cols[1],
      last: cols[2],
      state: cols[7],
    });
  }

  // --------------------------------------------------
  // STREAM CHECKOUTS
  // --------------------------------------------------

  const checkoutLines = fs
    .readFileSync(path.join(OUTPUT_DIR, 'checkouts.csv'), 'utf8')
    .split('')
    .slice(1)
    .filter(Boolean);

  const currentYear = new Date().getFullYear();

  for (let i = 0; i < checkoutLines.length; i++) {
    const cols = checkoutLines[i].split(',');

    const checkoutId = Number(cols[0]);
    const guestId = Number(cols[1]);
    const bookId = Number(cols[2]);
    const libraryId = Number(cols[3]);
    const checkoutDate = cols[4];
    const returnDate = cols[6];
    const lateFee = Number(cols[7]);
    const returned = cols[8] === 'true';

    const guest = guests.get(guestId);
    const book = books.get(bookId);
    const library = libraries.get(libraryId);

    if (!guest || !book || !library) {
      continue;
    }

    const author = authors.get(book.authorId);

    const customerName = `${guest.first} ${guest.last}`;
    const authorName = `${author.last}, ${author.first}`;
    const bookAge = currentYear - book.publishedYear;

    writeRow(outputFile, [
      checkoutId,
      customerName,
      book.title,
      library.name,
      authorName,
      book.genre,
      checkoutDate,
      returnDate,
      lateFee,
      bookAge,
      guest.state,
      !returned,
    ]);

    if (i % 250_000 === 0 && i !== 0) {
      console.log(`pipeline output rows: ${i.toLocaleString()}`);
      memoryUsage();
    }
  }

  outputFile.end();
}

