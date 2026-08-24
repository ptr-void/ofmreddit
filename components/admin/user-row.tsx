"use client"

import { Pencil, X, Check } from "lucide-react"
import { useEffect, useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Ban, UserX, Trash2 } from "lucide-react"
import s from "@/styles/scraper.module.css"

type User = {
  id: number
  email: string
  username?: string | null
  is_admin: boolean
  email_verified: boolean
  created_at: string
  post_count: number
  copied_count: number
  banned_id: number | null
  ban_reason: string | null
  banned_at: string | null
  custom_subreddit_checker_limit: number | null
}

type UserRowProps = {
  user: User
  onBan: (userId: number, currentlyBanned: boolean) => Promise<void>
  onDelete: (userId: number) => Promise<void>
  onUpdateUsername: (userId: number, username: string | null) => Promise<void>
  onUpdateCustomLimit: (userId: number, limit: number | null) => Promise<void>
  disabled: boolean
  saving?: boolean
}

export function UserRow({ user, onBan, onDelete, onUpdateUsername, onUpdateCustomLimit, disabled, saving }: UserRowProps) {
  const [editing, setEditing] = useState(false)
  const original = useMemo(() => user.username ?? "", [user.username])
  const [name, setName] = useState(original)
  
  const [editingLimit, setEditingLimit] = useState(false)
  const originalLimit = useMemo(() => (user.custom_subreddit_checker_limit === null ? "" : String(user.custom_subreddit_checker_limit)), [user.custom_subreddit_checker_limit])
  const [limitStr, setLimitStr] = useState(originalLimit)

  const USERNAME_COL_WIDTH = "min-w-[240px] max-w-[240px] w-[240px]"
  const LIMIT_COL_WIDTH = "min-w-[120px] max-w-[120px] w-[120px]"

  const noSubmit =
    (fn: () => void) =>
      (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        fn()
      }

  useEffect(() => setName(original), [original])
  useEffect(() => setLimitStr(originalLimit), [originalLimit])

  const startEdit = () => setEditing(true)
  const startEditLimit = () => setEditingLimit(true)

  const cancelEdit = () => {
    setName(original)
    setEditing(false)
  }
  
  const cancelEditLimit = () => {
    setLimitStr(originalLimit)
    setEditingLimit(false)
  }

  const saveEdit = async () => {
    const trimmed = name.trim()
    const normalized = trimmed === "" ? null : trimmed
    if ((original || "") === (trimmed || "")) {
      setEditing(false)
      return
    }
    await onUpdateUsername(user.id, normalized)
    setEditing(false)
  }
  
  const saveEditLimit = async () => {
    const trimmed = limitStr.trim()
    if (trimmed === originalLimit) {
      setEditingLimit(false)
      return
    }
    const val = trimmed === "" ? null : Number(trimmed)
    if (val !== null && isNaN(val)) {
      setEditingLimit(false)
      return
    }
    await onUpdateCustomLimit(user.id, val)
    setEditingLimit(false)
  }

  useEffect(() => {
    setName(user.username ?? "")
  }, [user.username])
  
  useEffect(() => {
    setLimitStr(user.custom_subreddit_checker_limit === null ? "" : String(user.custom_subreddit_checker_limit))
  }, [user.custom_subreddit_checker_limit])

  return (
    <tr className="border-b border-border hover:bg-muted/50">
      <td className="p-3">
        <div>
          <p className="text-sm font-medium">{user.email}</p>
          {user.is_admin ? (
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">Admin</span>
          ) : (
            <span className="text-xs bg-muted text-foreground/70 px-2 py-0.5 rounded">User</span>
          )}
        </div>
      </td>
      <td className="p-3 text-sm">
        {!editing ? (
          <div className={`flex items-center justify-between gap-2 ${USERNAME_COL_WIDTH}`}>
            <span className={`truncate ${user.username ? "" : "text-muted-foreground/70 italic"}`}>
              {user.username && user.username.trim() !== "" ? user.username : "None"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setEditing(true)
              }}
              className="inline-flex items-center rounded px-2 py-1 hover:bg-muted transition-colors"
              disabled={disabled}
              aria-label="Edit username"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className={`flex items-center gap-2 ${USERNAME_COL_WIDTH}`}>
            <input
              className={`${s.csvinput} w-full`}
              placeholder="None"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); saveEdit() }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelEdit() }
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                cancelEdit()
              }}
              className={`${s.btn2} !p-3`}
            >
              <span className="text-xs flex items-center gap-1">
                <X className="w-4 h-4" />
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                saveEdit()
              }}
              className={`${s.btn} !p-3`}
              disabled={disabled || saving}
            >
              <span className="flex items-center justify-center">
                {saving ? (
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" >
                    <circle
                      className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" ></path>
                  </svg>
                ) : (
                  <Check className="w-4 h-4" />
                )}
              </span>
            </button>
          </div>
        )}
      </td>
      <td className="p-3 text-sm">
        {!editingLimit ? (
          <div className={`flex items-center justify-between gap-2 ${LIMIT_COL_WIDTH}`}>
            <span className={`truncate ${user.custom_subreddit_checker_limit !== null ? "" : "text-muted-foreground/70 italic"}`}>
              {user.custom_subreddit_checker_limit !== null ? user.custom_subreddit_checker_limit : "Tier Def"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setEditingLimit(true)
              }}
              className="inline-flex items-center rounded px-2 py-1 hover:bg-muted transition-colors"
              disabled={disabled}
              aria-label="Edit limit"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className={`flex items-center gap-2 ${LIMIT_COL_WIDTH}`}>
            <input
              className={`${s.csvinput} w-full`}
              placeholder="Tier Def"
              value={limitStr}
              onChange={(e) => setLimitStr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); saveEditLimit() }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelEditLimit() }
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                cancelEditLimit()
              }}
              className={`${s.btn2} !p-3`}
            >
              <span className="text-xs flex items-center gap-1">
                <X className="w-4 h-4" />
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                saveEditLimit()
              }}
              className={`${s.btn1} !p-3`}
            >
              <span className="text-xs flex items-center gap-1">
                <Check className="w-4 h-4" />
              </span>
            </button>
          </div>
        )}
      </td>
      <td className="p-3 text-sm">{user.post_count}</td>
      <td className="p-3 text-sm">{user.copied_count}</td>
      <td className="p-3">
        {user.banned_id ? (
          <span className="text-xs bg-destructive/20 text-destructive px-2 py-1 rounded">Banned</span>
        ) : (
          <span className="text-xs bg-green-500/20 text-green-600 px-2 py-1 rounded">Active</span>
        )}
      </td>
      <td className="p-3 text-sm text-muted-foreground">{new Date(user.created_at).toLocaleDateString()}</td>
      <td className="p-3">
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBan(user.id, !!user.banned_id)}
            disabled={user.is_admin || disabled}
          >
            {user.banned_id ? (
              <>
                <UserX className="w-4 h-4 mr-1" />
                Unban
              </>
            ) : (
              <>
                <Ban className="w-4 h-4 mr-1" />
                Ban
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDelete(user.id)}
            disabled={user.is_admin || disabled}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </td>
    </tr>
  )
}
