"use client"

import { useEffect, useState } from "react"
import { Pencil, Trash2, CheckCircle2, AlertTriangle } from "lucide-react"
import type { CreatorProfileValues } from "./creator-profile"

export default function SavedProfiles({ 
  onBack, 
  onEdit, 
  onApply 
}: { 
  onBack: () => void, 
  onEdit: (p: CreatorProfileValues) => void,
  onApply: (p: CreatorProfileValues) => void 
}) {
  const [profiles, setProfiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // State for the custom delete confirmation pop-up
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchProfiles = async () => {
    const token = localStorage.getItem("token")
    try {
      const res = await fetch("/api/reddit-database/creator-profile", {
        headers: { "Authorization": `Bearer ${token}` }
      })
      const data = await res.json()
      setProfiles(data.profiles || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProfiles() }, [])

  const handleConfirmDelete = async () => {
    if (!deleteId) return
    
    setIsDeleting(true)
    const token = localStorage.getItem("token")
    try {
      const res = await fetch(`/api/reddit-database/creator-profile?id=${deleteId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      })
      if (res.ok) {
        setProfiles(prev => prev.filter(p => p.id !== deleteId))
        setDeleteId(null)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsDeleting(false)
    }
  }

  const getAllTags = (profile: CreatorProfileValues) => {
    if (!profile?.include) return []
    return Object.values(profile.include).flat().filter(Boolean)
  }

  const parseProfile = (data: any): CreatorProfileValues => {
    return typeof data === 'string' ? JSON.parse(data) : data
  }

  return (
    <div className="relative rounded-2xl border border-border bg-card p-4 md:p-6 space-y-6">
      
      {/* Native-style Delete Confirmation Pop-up */}
      {deleteId !== null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 mb-4 text-destructive">
              <div className="rounded-full bg-destructive/10 p-2">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold">Delete Profile?</h3>
            </div>
            
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete this profile? This action cannot be undone.
            </p>

            <div className="flex justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setDeleteId(null)} 
                disabled={isDeleting}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleConfirmDelete} 
                disabled={isDeleting}
                className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-sm hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                {isDeleting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Saved Profiles</h2>
        <button onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent">
          Back to Database
        </button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background text-muted-foreground">
          <p className="text-sm font-medium">No Saved Profiles</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles.map((item) => {
            const profile = parseProfile(item.profile_data)
            const tags = getAllTags(profile)
            return (
              <div key={item.id} className="flex flex-col justify-between rounded-xl border border-border bg-background p-4 shadow-sm">
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-foreground">{item.name}</h3>
                  <div className="mb-5 flex flex-wrap gap-1.5">
                    {tags.length > 0 ? tags.slice(0, 6).map((tag, i) => (
                      <span key={i} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-foreground">
                        {tag}
                      </span>
                    )) : <span className="text-xs text-muted-foreground">No tags</span>}
                    {tags.length > 6 && (
                      <span className="rounded-full bg-accent/50 px-3 py-1 text-xs font-medium text-muted-foreground">
                        +{tags.length - 6} more
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="space-y-2 border-t border-border pt-4">
                  <button 
                    onClick={() => onApply(profile)} 
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Apply Profile
                  </button>
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => onEdit(profile)} 
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button 
                      onClick={() => setDeleteId(item.id)} 
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/10 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}