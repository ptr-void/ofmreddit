import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY
    const sheetUrl = process.env.SUBREDDIT_SHEET_URL
    const range = "Sheet3!A:Z" 

    // 1. Extract ID
    const sheetId = sheetUrl?.split('/d/')[1]?.split('/')[0]

    if (!apiKey || !sheetId) {
      console.error("❌ MISSING ENV VARS: API Key or Sheet URL")
      return NextResponse.json({ error: "Missing API Key or invalid Sheet URL" }, { status: 500 })
    }

    console.log(`🔍 [API] Fetching Sheet3... ID: ${sheetId}`)

    // 2. Fetch
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`
    const res = await fetch(apiUrl)
    
    if (!res.ok) {
      const text = await res.text()
      console.error(`❌ [API] GOOGLE ERROR (${res.status}):`, text)
      return NextResponse.json({ error: text }, { status: res.status })
    }

    const data = await res.json()
    const values = data.values

    if (!values || values.length === 0) {
      console.error("❌ [API] Sheet3 is EMPTY")
      return NextResponse.json({ error: "No data found in Sheet3" }, { status: 404 })
    }

    // --- LOGGING THE DATA HERE ---
    console.log("✅ [API] SUCCESS! Fetched", values.length, "rows from Sheet3.")
    console.log("📋 [API] HEADERS:", values[0])
    console.log("📋 [API] FIRST ROW:", values[1])
    // -----------------------------

    return NextResponse.json({ 
      headers: values[0], 
      rows: values.slice(1) 
    })

  } catch (error: any) {
    console.error("❌ [API] CRASH:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}