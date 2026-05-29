/**
 * Test fixture generator.
 * Writes deterministic CSV files to a temp directory and returns the paths.
 * Call setup() in beforeAll, teardown() in afterAll.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── Raw CSV content ───────────────────────────────────────────────────────────

export const EMPLOYEES_CSV = `id,name,department,salary,country
1,Alice,Engineering,95000,US
2,Bob,Marketing,72000,UK
3,Carol,Engineering,88000,US
4,Dave,HR,61000,CA
5,Eve,Marketing,75000,UK
6,Frank,Engineering,102000,US
7,Grace,HR,63000,CA
8,Heidi,Sales,69000,AU
9,Ivan,Sales,71000,AU
10,Judy,Engineering,91000,US
11,Karl,Marketing,74000,UK
12,Lena,HR,60000,CA
13,Mike,Sales,68000,AU
14,Nora,Engineering,98000,US
15,Oscar,Marketing,76000,UK
16,Pat,Sales,67000,AU
17,Quinn,HR,62000,CA
18,Rose,Engineering,89000,US
19,Sam,Marketing,73000,UK
20,Tina,Sales,70000,AU
`

export const ORDERS_CSV = `order_id,employee_id,amount,status
1,1,150.00,complete
2,1,75.50,pending
3,2,200.00,complete
4,3,325.00,complete
5,3,45.00,cancelled
6,4,88.00,pending
7,5,410.00,complete
8,6,55.50,pending
9,7,129.00,complete
10,8,300.00,complete
11,8,22.00,cancelled
12,9,175.00,complete
13,10,450.00,complete
14,11,90.00,pending
15,12,140.00,complete
16,13,60.00,cancelled
17,14,520.00,complete
18,15,210.00,complete
19,16,85.00,pending
20,17,165.00,complete
21,18,380.00,complete
22,19,95.00,pending
23,20,240.00,complete
24,1,110.00,complete
25,2,55.00,cancelled
26,4,195.00,complete
27,6,430.00,complete
28,8,78.00,pending
29,10,290.00,complete
30,12,160.00,complete
`

export const REGIONS_CSV = `country,region
US,North America
UK,Europe
CA,North America
AU,Asia Pacific
DE,Europe
`

// Duplicate-heavy data for Unique node tests
export const DUPES_CSV = `id,category,value
1,A,10
2,A,20
3,B,30
4,B,40
5,C,50
6,A,15
7,B,35
`

// ── Setup / teardown ──────────────────────────────────────────────────────────

export interface Fixtures {
  dir: string
  employees: string
  orders: string
  regions: string
  dupes: string
}

export function setup(): Fixtures {
  const dir = mkdtempSync(join(tmpdir(), 'pipelines-test-'))
  const employees = join(dir, 'employees.csv')
  const orders    = join(dir, 'orders.csv')
  const regions   = join(dir, 'regions.csv')
  const dupes     = join(dir, 'dupes.csv')

  writeFileSync(employees, EMPLOYEES_CSV)
  writeFileSync(orders,    ORDERS_CSV)
  writeFileSync(regions,   REGIONS_CSV)
  writeFileSync(dupes,     DUPES_CSV)

  return { dir, employees, orders, regions, dupes }
}

export function teardown(f: Fixtures): void {
  rmSync(f.dir, { recursive: true, force: true })
}
