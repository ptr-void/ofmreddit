import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import nodemailer from "nodemailer"
import { getPool } from "@/lib/db"

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
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const email = String(body.email || "").trim().toLowerCase()
    const password = String(body.password || "")
    const inviteCode = String(body.inviteCode || "").trim().toUpperCase()
    const resend = body.op === "resend"
    if (!email || (!password && !resend)) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
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

    const hashedPassword = resend ? null : await bcrypt.hash(password, 10)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    const connection = await getPool().getConnection()
    let insertId = 0
    try {
      await connection.beginTransaction()
      const [existingRows]: any = await connection.execute(
        "SELECT id, email_verified, telegram_username FROM users WHERE email = ? FOR UPDATE",
        [email],
      )
      const user = existingRows[0]

      if (resend && !user) {
        await connection.rollback()
        return NextResponse.json({ error: "Registration was not found. Please register again." }, { status: 404 })
      }

      // Check the account before touching an invite code. The old order could
      // consume a fresh Telegram code for an email that was already registered.
      if (user?.email_verified) {
        await connection.rollback()
        return NextResponse.json(
          { error: "Email already registered. Please sign in instead." },
          { status: 409 },
        )
      }

      let telegramUsername: string | null = user?.telegram_username || null
      if (!telegramUsername) {
        if (!inviteCode) {
          await connection.rollback()
          return NextResponse.json({ error: "Telegram invite code is required" }, { status: 400 })
        }
        const [codeRows]: any = await connection.execute(
          "SELECT code, user_name FROM invite_codes WHERE code = ? FOR UPDATE",
          [inviteCode],
        )
        if (!codeRows.length) {
          await connection.rollback()
          return NextResponse.json(
            { error: "Invalid or already used Telegram invite code" },
            { status: 400 },
          )
        }
        telegramUsername = codeRows[0].user_name
        await connection.execute("DELETE FROM invite_codes WHERE code = ?", [inviteCode])
      }

      if (!user) {
        const [result]: any = await connection.execute(
          `INSERT INTO users
           (email, password, email_verified, verification_code, verification_expires_at, telegram_username, created_at)
           VALUES (?, ?, 0, ?, ?, ?, NOW())`,
          [email, hashedPassword, verificationCode, expiresAt, telegramUsername],
        )
        insertId = Number(result.insertId)
      } else {
        if (resend) {
          await connection.execute(
            `UPDATE users SET verification_code = ?, verification_expires_at = ? WHERE id = ?`,
            [verificationCode, expiresAt, user.id],
          )
        } else {
          await connection.execute(
            `UPDATE users
                SET verification_code = ?, verification_expires_at = ?, password = ?
              WHERE id = ?`,
            [verificationCode, expiresAt, hashedPassword, user.id],
          )
        }
        insertId = Number(user.id)
      }
      await connection.commit()
    } catch (dbErr) {
      await connection.rollback()
      throw dbErr
    } finally {
      connection.release()
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
