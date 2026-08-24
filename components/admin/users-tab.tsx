"use client"

import { Card } from "@/components/ui/card"
import { Users } from "lucide-react"
import { UserRow } from "./user-row"

type User = {
  id: number
  email: string
  username?: string | null
  is_admin: boolean
  email_verified: boolean
  created_at: string
  tier_name: string | null
  spa_uses: number
  checker_uses: number
  banned_id: number | null
  ban_reason: string | null
  banned_at: string | null
  custom_subreddit_checker_limit: number | null
}

type UsersTabProps = {
  users: User[]
  onBanUser: (userId: number, currentlyBanned: boolean) => Promise<void>
  onDeleteUser: (userId: number) => Promise<void>
  onUpdateUsername: (userId: number, username: string | null) => Promise<void>
  onUpdateCustomLimit: (userId: number, limit: number | null) => Promise<void>
  disabled: boolean
  savingMap: Record<number, boolean>
}

export function UsersTab({ users, onBanUser, onDeleteUser, onUpdateUsername, onUpdateCustomLimit, disabled, savingMap }: UsersTabProps) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-5 h-5" />
        <h2 className="text-xl font-semibold">User Management</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-sm font-medium">Email</th>
              <th className="text-left p-3 text-sm font-medium">Username</th>
              <th className="text-left p-3 text-sm font-medium">Tier</th>
              <th className="text-left p-3 text-sm font-medium">Limit</th>
              <th className="text-center p-3 text-sm font-medium" title="Subreddit Profile Analyzer Uses">SPA</th>
              <th className="text-center p-3 text-sm font-medium" title="Subreddit Checker Uses">Checker</th>
              <th className="text-left p-3 text-sm font-medium">Last Active</th>
              <th className="text-left p-3 text-sm font-medium">Joined</th>
              <th className="text-right p-3 text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                onBan={onBanUser}
                onDelete={onDeleteUser}
                onUpdateUsername={onUpdateUsername}
                onUpdateCustomLimit={onUpdateCustomLimit}
                disabled={disabled}
                saving={!!savingMap[user.id]} 
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
