import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY
    const sheetUrl = process.env.SUBREDDIT_SHEET_URL
    const range = "Sheet3!A:Z" 

    
    const sheetId = sheetUrl?.split('/d/')[1]?.split('/')[0]

    if (!apiKey || !sheetId) {
      console.error("MISSING ENV VARS: API Key or Sheet URL")
      return NextResponse.json({ error: "Missing API Key or invalid Sheet URL" }, { status: 500 })
    }

    console.log(`Fetching Sheet3... ID: ${sheetId}`)

    
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`
    const res = await fetch(apiUrl)
    
    if (!res.ok) {
      const text = await res.text()
      console.error(`GOOGLE ERROR (${res.status}):`, text)
      return NextResponse.json({ error: text }, { status: res.status })
    }

    const data = await res.json()
    const values = data.values

    if (!values || values.length === 0) {
      console.error("Sheet3 is EMPTY")
      return NextResponse.json({ error: "No data found in Sheet3" }, { status: 404 })
    }

    return NextResponse.json({ 
      headers: values[0], 
      rows: values.slice(1) 
    })

  } catch (error: any) {
    console.error("CRASH:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}