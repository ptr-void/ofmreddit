type AnalysisData = {
  headers: string[]
  rows: string[][]
  timestamp: number
}

const STORAGE_KEY = "reddit_analysis_cache"

/**
 * Save analysis data to localStorage
 */
export function saveAnalysisData(data: AnalysisData): void {
  if (typeof window === "undefined") return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.error("[v0] Failed to save analysis data:", error)
  }
}

/**
 * Load analysis data from localStorage
 */
export function loadAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null

    const data = JSON.parse(stored) as AnalysisData
    return data
  } catch (error) {
    console.error("[v0] Failed to load analysis data:", error)
    return null
  }
}

/**
 * Clear analysis data from localStorage
 */
export function clearAnalysisData(): void {
  if (typeof window === "undefined") return

  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.error("[v0] Failed to clear analysis data:", error)
  }
}
