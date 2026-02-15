import { NextRequest, NextResponse } from "next/server"

type SheetData = {
  title: string
  headers: string[]
  rows: string[][]
}

type IncludedTags = {
  ethnicity?: string[]
  bodyType?: string[]
  age?: string[]
  bodyPart?: string[]
  boobSubCategory?: string[]
  assSubCategory?: string[]
  others?: string[]
}

type CreatorProfile = {
  include?: IncludedTags
}

type RequestBody = {
  sheetData: SheetData
  tagSheet: SheetData
  profile?: CreatorProfile
  normalizedProfile?: unknown
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^r\//, "")
}

function split(cell: string | undefined): string[] {
  if (!cell) return []
  return cell
    .split(/[,;\n]/g)
    .map((v) => normalize(v))
    .filter(Boolean)
}

function hasAnySelected(include: IncludedTags | undefined) {
  if (!include) return false
  return Object.values(include).some((arr) => Array.isArray(arr) && arr.length > 0)
}

export async function POST(req: NextRequest) {
  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { sheetData, tagSheet, profile } = body
  if (!sheetData || !tagSheet) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 })
  }

  const include = profile?.include ?? {}
  const useInclude = hasAnySelected(include)

  const tagIndex = new Map<string, string[]>()

  tagSheet.rows.forEach((row) => {
    const key = normalize(row[0])
    tagIndex.set(key, row)
  })

  const headerMap = new Map<string, number>()
  tagSheet.headers.forEach((h, i) => headerMap.set(normalize(h), i))

  const filteredRows = sheetData.rows.filter((row) => {
    if (!useInclude) return true

    const key = normalize(row[0])
    const tagRow = tagIndex.get(key)
    if (!tagRow) return false

    for (const [category, values] of Object.entries(include)) {
      if (!values || values.length === 0) continue
      const idx = headerMap.get(normalize(category.replace(/([A-Z])/g, " $1")))
      if (idx === undefined) continue
      const tags = split(tagRow[idx])
      if (values.some((v) => tags.includes(normalize(v)))) return true
    }

    return false
  })

  return NextResponse.json({
    title: sheetData.title,
    headers: sheetData.headers,
    rows: filteredRows,
  })
}
  