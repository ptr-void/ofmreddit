import { google, type sheets_v4 } from "googleapis"

export type SheetData = {
  title: string
  headers: string[]
  rows: string[][]
}

type ServiceAccountInfo = {
  project_id?: string
  client_email: string
  private_key: string
}

export function parseSpreadsheetUrl(url: string): { spreadsheetId: string; gid: string | null } | null {
  const spreadsheetId = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1]
  const gid = url.match(/[#&]gid=([0-9]+)/)?.[1] ?? null
  return spreadsheetId ? { spreadsheetId, gid } : null
}

function serviceAccountInfo(): ServiceAccountInfo | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return null

  let parsed: ServiceAccountInfo
  try {
    parsed = JSON.parse(raw) as ServiceAccountInfo
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON")
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key")
  }
  return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") }
}

function createSheetsClient(): sheets_v4.Sheets {
  const credentials = serviceAccountInfo()
  if (credentials) {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    })
    return google.sheets({ version: "v4", auth })
  }

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY?.trim()
  if (!apiKey) throw new Error("Google Sheets credentials are not configured")
  return google.sheets({ version: "v4", auth: apiKey })
}

function quoteSheetName(name: string) {
  return `'${name.replace(/'/g, "''")}'`
}

export async function createWorkbookReader(spreadsheetId: string) {
  const client = createSheetsClient()
  const metadata = await client.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties",
  })
  const workbookTitle = metadata.data.properties?.title || "Google Sheet"
  const sheetProperties = metadata.data.sheets?.map((sheet) => sheet.properties).filter(Boolean) || []

  const read = async (sheetName: string): Promise<SheetData> => {
    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheetName(sheetName)}!A:ZZ`,
    })
    const values = (response.data.values || []).map((row) => row.map((cell) => String(cell ?? "")))
    return {
      title: `${workbookTitle} - ${sheetName}`,
      headers: values[0] || [],
      rows: values.slice(1),
    }
  }

  const readByGid = async (gid: string | null): Promise<SheetData> => {
    const properties = gid
      ? sheetProperties.find((sheet) => String(sheet?.sheetId) === gid)
      : sheetProperties[0]
    if (!properties?.title) {
      throw new Error(gid ? `Sheet with GID ${gid} was not found` : "The spreadsheet has no sheets")
    }
    return read(properties.title)
  }

  const readByName = async (name: string): Promise<SheetData> => {
    const properties = sheetProperties.find(
      (sheet) => sheet?.title?.trim().toLowerCase() === name.trim().toLowerCase(),
    )
    if (!properties?.title) throw new Error(`Sheet named ${name} was not found`)
    return read(properties.title)
  }

  return { readByGid, readByName }
}
