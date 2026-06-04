import { useMemo } from 'react'
import { CheckCircle, Loader } from 'lucide-react'
import type { TableEntry } from '../../lib/types'

interface SchemaTableBrowserProps {
  tables: TableEntry[]
  filter: string
  selectedSchema: string | null
  selectedTable: string | null
  selectedStatus?: 'ready' | 'fetching' | null
  filterPlaceholder?: string
  onFilterChange: (value: string) => void
  onSelect: (schema: string, table: string) => void
}

export default function SchemaTableBrowser({
  tables,
  filter,
  selectedSchema,
  selectedTable,
  selectedStatus = null,
  filterPlaceholder = 'Filter tables…',
  onFilterChange,
  onSelect,
}: SchemaTableBrowserProps) {
  const filteredTables = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q
      ? tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q))
      : tables
  }, [tables, filter])

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const t of filteredTables) {
      if (!map.has(t.schema)) map.set(t.schema, [])
      map.get(t.schema)!.push(t.name)
    }
    return map
  }, [filteredTables])

  if (!tables.length) return null

  return (
    <>
      <input
        className="node-input schema-filter nodrag"
        placeholder={filterPlaceholder}
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />

      {grouped.size > 0 && (
        <div className="schema-browser nowheel nodrag">
          {[...grouped.entries()].map(([schema, names]) => (
            <div key={schema} className="schema-group">
              <div className="schema-group-title">{schema}</div>
              {names.map((name) => {
                const isSel = selectedSchema === schema && selectedTable === name
                return (
                  <div
                    key={name}
                    className={`schema-table-row${isSel ? ' selected' : ''}`}
                    onClick={(e) => { e.stopPropagation(); onSelect(schema, name) }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <span className="schema-table-name">{name}</span>
                    {isSel && selectedStatus === 'ready' && (
                      <CheckCircle size={10} strokeWidth={2} className="schema-table-check" />
                    )}
                    {isSel && selectedStatus === 'fetching' && (
                      <Loader size={10} strokeWidth={2} className="spin schema-table-check" />
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </>
  )
}