import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import nodemailer from "nodemailer"
import { query } from "@/lib/db"
import type { ResultSetHeader } from "mysql2"

const lastSent = new Map<string, number>()
const RESEND_COOLDOWN_MS = 30_000   
async function sendVerificationEmail(to: string, code: string) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER || "beteaj9@gmail.com",
      pass: process.env.SMTP_PASS || "jayyan459",
    },
  })

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verify Your Email</title>
  <style>
    body { margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; }
    .container { max-width:480px; margin:40px auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,.08); }
    .header { background:#4F46E5; color:#fff; padding:24px; text-align:center; }
    .header h1 { margin:0; font-size:1.5rem; }
    .body { padding:32px; text-align:center; }
    .code { font-size:2.5rem; font-weight:bold; letter-spacing:8px; color:#4F46E5; margin:20px 0; }
    .footer { background:#f9f9f9; padding:20px; font-size:0.85rem; color:#666; text-align:center; }
    .btn { display:inline-block; background:#4F46E5; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; margin-top:16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>OFMReddit</h1></div>
    <div class="body">
      <h2 style="margin-top:0;">Verify Your Email</h2>
      <p><strong>Do not share this code with anyone. If you didn’t request this, please ignore this message.</strong></p>
      <div class="code">${code}</div>
      <p>This code expires in <strong>15 minutes</strong>.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} OFMReddit. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `

  await transporter.sendMail({
    from: `"OFMReddit" <${process.env.SMTP_USER}>`,
    to,
    subject: "Your Verification Code – OFMReddit",
    text: `Your verification code is: ${code}\nIt expires in 15 minutes.`,
    html,
  })
}
import fs from "fs"
import path from "path"

export async function POST(request: Request) {
  try {
    const { email, password, inviteCode } = await request.json()
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }
    
    if (!inviteCode) {
      return NextResponse.json(
        { error: "Telegram invite code is required" },
        { status: 400 }
      )
    }

    // Verify Telegram Invite Code
    const codesPath = path.join(process.cwd(), 'scripts', 'invite_codes.json')
    if (fs.existsSync(codesPath)) {
      const data = JSON.parse(fs.readFileSync(codesPath, 'utf8'))
      const codeIndex = data.codes.findIndex((c: any) => c.code === inviteCode.toUpperCase())
      
      if (codeIndex === -1) {
        return NextResponse.json(
          { error: "Invalid or already used Telegram invite code" },
          { status: 400 }
        )
      }
      
      // Remove used code
      data.codes.splice(codeIndex, 1)
      fs.writeFileSync(codesPath, JSON.stringify(data, null, 2))
    } else {
       return NextResponse.json(
        { error: "Verification system offline. Please contact admin." },
        { status: 500 }
      )
    }

    const now = Date.now()
    const last = lastSent.get(email) ?? 0
    if (now - last < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000)
      return NextResponse.json(
        { error: `Please wait ${wait}s before requesting another code` },
        { status: 429 }
      )
    }

    const existing = await query(
      "SELECT id, email_verified FROM users WHERE email = ?",
      [email]
    )

    const hashedPassword = await bcrypt.hash(password, 10)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) 

    let insertId: number

    if ((existing as any[]).length === 0) {
      const result = (await query(
        `INSERT INTO users
         (email, password, email_verified, verification_code, verification_expires_at, created_at)
         VALUES (?, ?, 0, ?, ?, NOW())`,
        [email, hashedPassword, verificationCode, expiresAt]
      )) as unknown as ResultSetHeader

      insertId = result.insertId
    } else {
      const user = (existing as any[])[0]

      if (user.email_verified) {
        return NextResponse.json(
          { error: "Email already registered and verified" },
          { status: 400 }
        )
      }

      await query(
        `UPDATE users
         SET verification_code = ?,
             verification_expires_at = ?,
             password = ?
         WHERE email = ?`,
        [verificationCode, expiresAt, hashedPassword, email]
      )

      insertId = user.id
    }

    await sendVerificationEmail(email, verificationCode)

    lastSent.set(email, Date.now())

    return NextResponse.json(
      {
        message: "Verification code (re)sent!",
        userId: insertId,
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Registration error:", error)
    return NextResponse.json(
      { error: error.message || "Registration failed" },
      { status: 500 }
    )
  }
}