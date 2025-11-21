type AnalysisRow = {
  subreddit: string
  snapshotEngagementRatio: string
  barrierToVisibility: string
  topSlotDiversityIndex: string
  upvoteToRootCommentRatio: string
  simpIntensityScore: string
}

/**
 * Convert analysis data to CSV format and trigger download
 */
export function downloadAnalysisAsCSV(rows: AnalysisRow[], filename: string): void {
  if (typeof window === "undefined") return

  try {
    // Define CSV headers
    const headers = [
      "Subreddit",
      "Snapshot Engagement Ratio (%)",
      "Barrier to Visibility (BTV)",
      "Top Slot Diversity Index (TSDI)",
      "Upvote to Root Comment Ratio",
      "Simp Intensity Score",
    ]

    // Create CSV content
    const csvRows: string[] = []

    // Add header row
    csvRows.push(headers.join(","))

    // Add data rows
    for (const row of rows) {
      const values = [
        escapeCSV(row.subreddit),
        escapeCSV(row.snapshotEngagementRatio),
        escapeCSV(row.barrierToVisibility),
        escapeCSV(row.topSlotDiversityIndex),
        escapeCSV(row.upvoteToRootCommentRatio),
        escapeCSV(row.simpIntensityScore),
      ]
      csvRows.push(values.join(","))
    }

    const csvContent = csvRows.join("\n")

    // Create blob and trigger download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob)
      link.setAttribute("href", url)
      link.setAttribute("download", filename)
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }
  } catch (error) {
    console.error("[v0] Failed to download analysis as CSV:", error)
    alert("Failed to download CSV file. Please try again.")
  }
}

/**
 * Escape CSV values properly (handle commas, quotes, newlines)
 */
function escapeCSV(value: string): string {
  if (!value) return ""

  const stringValue = String(value)

  // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}
