import fs from 'fs';
import path from 'path';

/**
 * Massive Car Dataset Generator
 *
 * Generates interconnected CSV files for:
 * - manufacturers
 * - models
 * - dealerships
 * - customers
 * - inventory
 * - sales
 * - service_records
 * - employees
 * - financing
 * - warranties
 *
 * Designed for:
 * - ETL pipeline testing
 * - database imports
 * - analytics workloads
 * - TanStack DB experiments
 * - query optimization
 * - stream processing
 * - large scale CSV ingestion
 *
 * ------------------------------------------
 * QUICK START
 * ------------------------------------------
 *
 * npm install faker
 *
 * ts-node generate.ts
 *
 * or
 *
 * npx tsx generate.ts
 *
 * ------------------------------------------
 * OUTPUT
 * ------------------------------------------
 * ./generated-data/
 *
 * manufacturers.csv
 * models.csv
 * dealerships.csv
 * employees.csv
 * customers.csv
 * inventory.csv
 * sales.csv
 * financing.csv
 * warranties.csv
 * service_records.csv
 *
 * ------------------------------------------
 * DEFAULT SCALE
 * ------------------------------------------
 * manufacturers:     ~25
 * models:            ~3,000
 * dealerships:       ~2,500
 * employees:         ~75,000
 * customers:         ~2,000,000
 * inventory:         ~5,000,000
 * sales:             ~8,000,000
 * financing:         ~5,000,000
 * warranties:        ~8,000,000
 * service_records:   ~20,000,000
 *
 * Some CSVs will be MANY GB in size.
 */

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const OUTPUT_DIR = path.join(process.cwd(), 'generated-data');

const CONFIG = {
  manufacturers: 25,
  modelsPerManufacturer: 120,
  dealerships: 2500,
  employeesPerDealership: 30,
  customers: 500_000,
  inventory: 800_000,
  sales: 1_000_000,
  serviceRecords: 1_200_000,
};

const YEARS = Array.from({ length: 30 }, (_, i) => 1995 + i);

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

const CAR_TYPES = [
  'Sedan',
  'SUV',
  'Truck',
  'Coupe',
  'Convertible',
  'Van',
  'Hybrid',
  'Electric',
  'Wagon',
  'Crossover',
];

const COLORS = [
  'Black',
  'White',
  'Silver',
  'Gray',
  'Blue',
  'Red',
  'Green',
  'Orange',
  'Yellow',
  'Brown',
  'Purple',
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

const CITIES = [
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
  'San Antonio', 'San Diego', 'Dallas', 'Austin', 'Jacksonville', 'Columbus',
  'Charlotte', 'Indianapolis', 'Seattle', 'Denver', 'Boston', 'Nashville',
  'Portland', 'Las Vegas', 'Detroit', 'Atlanta', 'Miami', 'Orlando',
  'Minneapolis', 'Cincinnati', 'St. Louis', 'Kansas City', 'Milwaukee'
];

const MANUFACTURERS = [
  'Toyota',
  'Honda',
  'Ford',
  'Chevrolet',
  'BMW',
  'Mercedes-Benz',
  'Audi',
  'Nissan',
  'Hyundai',
  'Kia',
  'Volkswagen',
  'Subaru',
  'Mazda',
  'Lexus',
  'Jeep',
  'Ram',
  'Dodge',
  'Tesla',
  'Volvo',
  'Porsche',
  'Ferrari',
  'Lamborghini',
  'Mitsubishi',
  'Genesis',
  'Acura',
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

function randomDate(startYear = 2010, endYear = 2025): string {
  const year = rand(startYear, endYear);
  const month = rand(1, 12).toString().padStart(2, '0');
  const day = rand(1, 28).toString().padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function randomPrice(min: number, max: number): number {
  return Number((Math.random() * (max - min) + min).toFixed(2));
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

function randomVin(): string {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

  let vin = '';

  for (let i = 0; i < 17; i++) {
    vin += chars[rand(0, chars.length - 1)];
  }

  return vin;
}

function randomPhone(): string {
  return `${rand(200, 999)}-${rand(100, 999)}-${rand(1000, 9999)}`;
}

function randomEmail(first: string, last: string): string {
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

  return `${first.toLowerCase()}.${last.toLowerCase()}${rand(1, 9999)}@${pick(domains)}`;
}

function randomAddress() {
  return `${rand(100, 9999)} ${pick(STREET_NAMES)} St`;
}

function memoryUsage() {
  const used = process.memoryUsage();

  console.log({
    rssMB: (used.rss / 1024 / 1024).toFixed(2),
    heapUsedMB: (used.heapUsed / 1024 / 1024).toFixed(2),
  });
}

// --------------------------------------------------
// DATA CACHES
// --------------------------------------------------

const manufacturerIds: number[] = [];
const modelIds: number[] = [];
const dealershipIds: number[] = [];
const customerIds: number[] = [];
const inventoryIds: number[] = [];
const employeeIds: number[] = [];

// --------------------------------------------------
// GENERATORS
// --------------------------------------------------

async function generateManufacturers() {
  console.log('Generating manufacturers...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'manufacturers.csv'));

  writeRow(file, [
    'manufacturer_id',
    'name',
    'country',
    'founded_year',
    'luxury_brand',
  ]);

  const countries = [
    'Japan',
    'United States',
    'Germany',
    'South Korea',
    'Italy',
    'Sweden',
  ];

  MANUFACTURERS.forEach((name, index) => {
    const id = index + 1;

    manufacturerIds.push(id);

    writeRow(file, [
      id,
      name,
      pick(countries),
      rand(1910, 2015),
      chance(20),
    ]);
  });

  file.end();
}

async function generateModels() {
  console.log('Generating models...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'models.csv'));

  writeRow(file, [
    'model_id',
    'manufacturer_id',
    'year',
    'make',
    'model',
    'trim',
    'body_type',
    'msrp',
    'horsepower',
    'mpg_city',
    'mpg_highway',
  ]);

  const trims = ['Base', 'Sport', 'Limited', 'Touring', 'Premium', 'SE', 'XLE', 'GT'];

  let modelId = 1;

  for (const manufacturerId of manufacturerIds) {
    const make = MANUFACTURERS[manufacturerId - 1];

    for (let i = 0; i < CONFIG.modelsPerManufacturer; i++) {
      for (const year of YEARS) {
        modelIds.push(modelId);

        writeRow(file, [
          modelId,
          manufacturerId,
          year,
          make,
          `${make}-${i + 1}`,
          pick(trims),
          pick(CAR_TYPES),
          randomPrice(18000, 160000),
          rand(90, 1200),
          rand(10, 60),
          rand(15, 75),
        ]);

        modelId++;
      }
    }
  }

  file.end();
}

async function generateDealerships() {
  console.log('Generating dealerships...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'dealerships.csv'));

  writeRow(file, [
    'dealership_id',
    'name',
    'city',
    'state',
    'address',
    'zip_code',
    'opened_date',
    'franchise_manufacturer_id',
  ]);

  for (let i = 1; i <= CONFIG.dealerships; i++) {
    dealershipIds.push(i);

    writeRow(file, [
      i,
      `${pick(LAST_NAMES)} Auto Group ${i}`,
      pick(CITIES),
      pick(STATES),
      randomAddress(),
      rand(10000, 99999),
      randomDate(1980, 2022),
      pick(manufacturerIds),
    ]);
  }

  file.end();
}

async function generateEmployees() {
  console.log('Generating employees...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'employees.csv'));

  writeRow(file, [
    'employee_id',
    'dealership_id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'role',
    'hire_date',
    'salary',
  ]);

  const roles = [
    'Sales Associate',
    'Sales Manager',
    'Finance Manager',
    'Service Advisor',
    'Technician',
    'General Manager',
    'Receptionist',
  ];

  let employeeId = 1;

  for (const dealershipId of dealershipIds) {
    for (let i = 0; i < CONFIG.employeesPerDealership; i++) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);

      employeeIds.push(employeeId);

      writeRow(file, [
        employeeId,
        dealershipId,
        first,
        last,
        randomEmail(first, last),
        randomPhone(),
        pick(roles),
        randomDate(2005, 2025),
        rand(35000, 220000),
      ]);

      employeeId++;
    }
  }

  file.end();
}

async function generateCustomers() {
  console.log('Generating customers...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'customers.csv'));

  writeRow(file, [
    'customer_id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'date_of_birth',
    'address',
    'city',
    'state',
    'zip_code',
    'credit_score',
    'annual_income',
  ]);

  for (let i = 1; i <= CONFIG.customers; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);

    customerIds.push(i);

    writeRow(file, [
      i,
      first,
      last,
      randomEmail(first, last),
      randomPhone(),
      randomDate(1945, 2005),
      randomAddress(),
      pick(CITIES),
      pick(STATES),
      rand(10000, 99999),
      rand(450, 850),
      rand(25000, 500000),
    ]);

    if (i % 100_000 === 0) {
      console.log(`customers: ${i.toLocaleString()}`);
      memoryUsage();
    }
  }

  file.end();
}

async function generateInventory() {
  console.log('Generating inventory...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'inventory.csv'));

  writeRow(file, [
    'inventory_id',
    'dealership_id',
    'model_id',
    'vin',
    'color',
    'mileage',
    'condition',
    'purchase_price',
    'listing_price',
    'arrival_date',
    'sold',
  ]);

  for (let i = 1; i <= CONFIG.inventory; i++) {
    inventoryIds.push(i);

    const purchase = randomPrice(12000, 90000);

    writeRow(file, [
      i,
      pick(dealershipIds),
      pick(modelIds),
      randomVin(),
      pick(COLORS),
      rand(0, 250000),
      chance(70) ? 'Used' : 'New',
      purchase,
      Number((purchase * (1 + Math.random() * 0.3)).toFixed(2)),
      randomDate(2015, 2025),
      chance(65),
    ]);

    if (i % 250_000 === 0) {
      console.log(`inventory: ${i.toLocaleString()}`);
      memoryUsage();
    }
  }

  file.end();
}

async function generateSales() {
  console.log('Generating sales...');

  const salesFile = fs.createWriteStream(path.join(OUTPUT_DIR, 'sales.csv'));
  const financingFile = fs.createWriteStream(path.join(OUTPUT_DIR, 'financing.csv'));
  const warrantyFile = fs.createWriteStream(path.join(OUTPUT_DIR, 'warranties.csv'));

  writeRow(salesFile, [
    'sale_id',
    'inventory_id',
    'customer_id',
    'dealership_id',
    'employee_id',
    'sale_date',
    'sale_price',
    'trade_in',
    'trade_in_value',
    'tax_amount',
    'fees',
    'payment_method',
  ]);

  writeRow(financingFile, [
    'financing_id',
    'sale_id',
    'bank_name',
    'loan_amount',
    'interest_rate',
    'term_months',
    'monthly_payment',
    'approved',
  ]);

  writeRow(warrantyFile, [
    'warranty_id',
    'sale_id',
    'warranty_type',
    'coverage_years',
    'coverage_miles',
    'price',
  ]);

  const banks = [
    'Capital One',
    'Chase',
    'Wells Fargo',
    'Bank of America',
    'Ally',
    'US Bank',
    'TD Auto Finance',
  ];

  const paymentMethods = [
    'Cash',
    'Finance',
    'Lease',
  ];

  const warrantyTypes = [
    'Basic',
    'Powertrain',
    'Extended',
    'Premium',
  ];

  for (let i = 1; i <= CONFIG.sales; i++) {
    const salePrice = randomPrice(15000, 140000);
    const paymentMethod = pick(paymentMethods);

    writeRow(salesFile, [
      i,
      pick(inventoryIds),
      pick(customerIds),
      pick(dealershipIds),
      pick(employeeIds),
      randomDate(2015, 2025),
      salePrice,
      chance(35),
      randomPrice(0, 45000),
      Number((salePrice * 0.07).toFixed(2)),
      randomPrice(100, 2500),
      paymentMethod,
    ]);

    if (paymentMethod !== 'Cash') {
      const loanAmount = salePrice * (Math.random() * 0.8 + 0.2);
      const interest = Number((Math.random() * 8 + 1.9).toFixed(2));
      const term = pick([24, 36, 48, 60, 72, 84]);

      writeRow(financingFile, [
        i,
        i,
        pick(banks),
        loanAmount.toFixed(2),
        interest,
        term,
        Number((loanAmount / term).toFixed(2)),
        chance(92),
      ]);
    }

    writeRow(warrantyFile, [
      i,
      i,
      pick(warrantyTypes),
      pick([3, 5, 7, 10]),
      pick([36000, 60000, 100000, 150000]),
      randomPrice(800, 8000),
    ]);

    if (i % 250_000 === 0) {
      console.log(`sales: ${i.toLocaleString()}`);
      memoryUsage();
    }
  }

  salesFile.end();
  financingFile.end();
  warrantyFile.end();
}

async function generateServiceRecords() {
  console.log('Generating service records...');

  const file = fs.createWriteStream(path.join(OUTPUT_DIR, 'service_records.csv'));

  writeRow(file, [
    'service_record_id',
    'customer_id',
    'inventory_id',
    'dealership_id',
    'service_date',
    'service_type',
    'mileage',
    'cost',
    'technician_employee_id',
    'notes',
  ]);

  const serviceTypes = [
    'Oil Change',
    'Brake Service',
    'Transmission Repair',
    'Battery Replacement',
    'Tire Rotation',
    'Engine Repair',
    'Air Filter Replacement',
    'Inspection',
    'Alignment',
    'Coolant Flush',
  ];

  for (let i = 1; i <= CONFIG.serviceRecords; i++) {
    writeRow(file, [
      i,
      pick(customerIds),
      pick(inventoryIds),
      pick(dealershipIds),
      randomDate(2015, 2025),
      pick(serviceTypes),
      rand(5000, 300000),
      randomPrice(50, 8000),
      pick(employeeIds),
      'Customer reported issue resolved successfully',
    ]);

    if (i % 500_000 === 0) {
      console.log(`service records: ${i.toLocaleString()}`);
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
  console.log(' MASSIVE CAR DATASET GENERATOR');
  console.log('---------------------------------------');

  ensureDir();

  const start = Date.now();

  await generateManufacturers();
  await generateModels();
  await generateDealerships();
  await generateEmployees();
  await generateCustomers();
  await generateInventory();
  await generateSales();
  await generateServiceRecords();

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
