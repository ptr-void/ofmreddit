export type BooleanFilter = "all" | "yes" | "no"
export type DatabaseFlagFilters = { cta: BooleanFilter; verification: BooleanFilter; botBouncer: BooleanFilter }

export function filterDatabaseFlags(headers: string[], rows: string[][], filters: DatabaseFlagFilters): string[][] {
  const columns = [["cta captions", filters.cta], ["verification", filters.verification], ["bot bouncer", filters.botBouncer]]
  return rows.filter(row => columns.every(([header, selected]) => {
    if (selected === "all") return true
    const index = headers.findIndex(item => item.trim().toLowerCase() === header)
    // Unknown/missing is not No. Only matching observed flags qualify.
    return index >= 0 && String(row[index] || "").trim().toLowerCase() === selected
  }))
}
