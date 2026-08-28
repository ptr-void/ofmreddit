import { type NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { signToken } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    const users = await query<{
      id: number
      email: string
      password: string
      is_admin: boolean
      email_verified: boolean
      telegram_username: string | null
    }>("SELECT id, email, password, is_admin, email_verified, telegram_username FROM users WHERE email = ?", [
      email,
    ])

    console.log("Login - Database query result:", {
      userCount: users.length,
      user: users[0]
        ? {
            id: users[0].id,
            email: users[0].email,
            is_admin: users[0].is_admin,
            is_admin_type: typeof users[0].is_admin,
            email_verified: users[0].email_verified,
          }
        : null,
    })

    if (users.length === 0) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    const user = users[0]

    if (!user.email_verified) {
      return NextResponse.json(
        { error: "Please verify your email address before logging in." },
        { status: 403 }
      )
    }

    const bannedUsers = await query<{ id: number }>(
      "SELECT id FROM banned_users WHERE user_id = ?",
      [user.id]
    )

    if (bannedUsers.length > 0) {
      return NextResponse.json({ error: "Your account has been banned" }, { status: 403 })
    }

    const isValidPassword = await bcrypt.compare(password, user.password)

    if (!isValidPassword) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      isAdmin: user.is_admin,
      hasTelegramLinked: !!user.telegram_username,
    }
    console.log("Login - Token payload:", tokenPayload)

    const token = signToken(tokenPayload)

    const responseData = {
      token,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.is_admin,
        emailVerified: user.email_verified,
        hasTelegramLinked: !!user.telegram_username,
      },
    }
    console.log("Login - Response data:", responseData)

    return NextResponse.json(responseData)
  } catch (error: any) {
    console.error("Login error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}