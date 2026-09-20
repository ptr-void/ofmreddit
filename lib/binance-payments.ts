import crypto from "node:crypto"
import { getPool, query, queryOne } from "@/lib/db"

const SCALE = 8
const DEFAULT_COIN = "USDT"
const DEFAULT_NETWORK = "TRX"

type PaymentIntentRow = {
  id: string
  user_id: number
  tier_id: number
  tier_name?: string
  duration_days: number
  base_amount: string | number
  expected_amount: string | number
  coin: string
  network: string
  address: string
  status: "pending" | "confirming" | "paid" | "expired" | "cancelled"
  tx_id: string | null
  created_at: Date | string
  expires_at: Date | string
  paid_at: Date | string | null
}

type BinanceDeposit = {
  amount: string
  coin: string
  network: string
  status: number
  address: string
  txId: string
  insertTime: number
}

const TRON_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"

function paymentConfig() {
  const apiKey = process.env.BINANCE_API_KEY?.trim()
  const secretKey = process.env.BINANCE_SECRET_KEY?.trim()
  const address = process.env.BINANCE_DEPOSIT_ADDRESS?.trim()
  if (!apiKey || !secretKey || !address) throw new Error("Crypto payments are not configured")
  return {
    apiKey,
    secretKey,
    address,
    coin: (process.env.BINANCE_COIN || DEFAULT_COIN).trim().toUpperCase(),
    network: (process.env.BINANCE_NETWORK || DEFAULT_NETWORK).trim().toUpperCase(),
  }
}

export function decimalToUnits(value: string | number, scale = SCALE): bigint {
  const text = String(value).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Invalid decimal amount")
  const [whole, fraction = ""] = text.split(".")
  return BigInt(whole) * BigInt(10) ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale))
}

export function formatUnits(value: bigint, scale = SCALE): string {
  const divisor = BigInt(10) ** BigInt(scale)
  const whole = value / divisor
  const fraction = (value % divisor).toString().padStart(scale, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function publicIntent(intent: PaymentIntentRow) {
  const networkLabel = intent.network === "TRX" ? "TRC20 (TRON)" : intent.network
  return {
    id: intent.id,
    tierId: Number(intent.tier_id),
    tierName: intent.tier_name || "Subscription",
    durationDays: Number(intent.duration_days),
    amount: String(intent.expected_amount),
    coin: intent.coin,
    network: intent.network,
    networkLabel,
    address: intent.address,
    status: intent.status,
    txId: intent.tx_id,
    expiresAt: new Date(intent.expires_at).toISOString(),
    paidAt: intent.paid_at ? new Date(intent.paid_at).toISOString() : null,
  }
}

async function signedBinanceGet(path: string, input: Record<string, string | number>) {
  const config = paymentConfig()
  let serverTime = Date.now()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const timeResponse = await fetch("https://api.binance.com/api/v3/time", { cache: "no-store" })
      if (timeResponse.ok) {
        const data = await timeResponse.json()
        if (Number.isFinite(Number(data.serverTime))) serverTime = Number(data.serverTime)
        break
      }
    } catch {
      // Vercel's clock is synchronized, so Date.now() remains a valid signed-request fallback.
    }
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...input, recvWindow: 10000, timestamp: serverTime })) {
    params.set(key, String(value))
  }
  const payload = params.toString()
  params.set("signature", crypto.createHmac("sha256", config.secretKey).update(payload).digest("hex"))
  const response = await fetch(`https://api.binance.com${path}?${params.toString()}`, {
    headers: { "X-MBX-APIKEY": config.apiKey },
    cache: "no-store",
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data && typeof data.msg === "string" ? data.msg : `HTTP ${response.status}`
    throw new Error(`Binance API error: ${message}`)
  }
  return data
}

export async function getBinancePermissions() {
  return signedBinanceGet("/sapi/v1/account/apiRestrictions", {})
}

async function getDeposits(startTime: number): Promise<BinanceDeposit[]> {
  const config = paymentConfig()
  if (config.coin === "USDT" && config.network === "TRX") {
    const params = new URLSearchParams({
      only_confirmed: "true",
      only_to: "true",
      limit: "200",
      contract_address: TRON_USDT_CONTRACT,
      min_timestamp: String(Math.max(0, startTime)),
    })
    const response = await fetch(
      `https://api.trongrid.io/v1/accounts/${encodeURIComponent(config.address)}/transactions/trc20?${params}`,
      { cache: "no-store" },
    )
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
      throw new Error("TRON payment confirmation service is temporarily unavailable")
    }
    return payload.data
      .filter((item: any) => String(item.to || "") === config.address)
      .map((item: any) => {
        const decimals = Math.max(0, Number(item.token_info?.decimals ?? 6))
        const raw = BigInt(String(item.value || "0"))
        return {
          amount: formatUnits(raw * BigInt(10) ** BigInt(Math.max(0, SCALE - decimals))),
          coin: "USDT",
          network: "TRX",
          status: 1,
          address: String(item.to || ""),
          txId: String(item.transaction_id || ""),
          insertTime: Number(item.block_timestamp || 0),
        }
      })
      .filter((item: BinanceDeposit) => Boolean(item.txId))
  }

  const { coin } = config
  const data = await signedBinanceGet("/sapi/v1/capital/deposit/hisrec", {
    coin,
    startTime: Math.max(Date.now() - 89 * 86400_000, startTime),
    endTime: Date.now(),
    limit: 1000,
  })
  return Array.isArray(data) ? data : []
}

async function activateIntent(intentId: string, deposit: BinanceDeposit) {
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    const [intentRows]: any = await connection.execute(
      `SELECT * FROM crypto_payment_intents WHERE id = ? FOR UPDATE`,
      [intentId],
    )
    const intent = intentRows[0] as PaymentIntentRow | undefined
    if (!intent || intent.status === "paid") {
      await connection.rollback()
      return
    }

    const [claimed]: any = await connection.execute(
      `SELECT id FROM crypto_payment_intents WHERE tx_id = ? AND id <> ? LIMIT 1 FOR UPDATE`,
      [deposit.txId, intentId],
    )
    if (claimed.length) {
      await connection.rollback()
      return
    }

    const [activeRows]: any = await connection.execute(
      `SELECT id, tier_id, ends_at FROM user_subscriptions
        WHERE user_id = ? AND starts_at <= NOW()
          AND (ends_at IS NULL OR ends_at >= NOW())
        ORDER BY starts_at DESC LIMIT 1 FOR UPDATE`,
      [intent.user_id],
    )
    const active = activeRows[0]
    const days = Math.max(1, Number(intent.duration_days || 30))
    if (active && Number(active.tier_id) === Number(intent.tier_id)) {
      if (active.ends_at !== null) {
        await connection.execute(
          `UPDATE user_subscriptions
              SET ends_at = DATE_ADD(GREATEST(ends_at, NOW()), INTERVAL ? DAY)
            WHERE id = ?`,
          [days, active.id],
        )
      }
    } else {
      if (active) {
        await connection.execute("UPDATE user_subscriptions SET ends_at = NOW() WHERE id = ?", [active.id])
      }
      await connection.execute(
        `INSERT INTO user_subscriptions (user_id, tier_id, starts_at, ends_at, cooldown)
         VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), '10')`,
        [intent.user_id, intent.tier_id, days],
      )
    }
    await connection.execute(
      `UPDATE crypto_payment_intents
          SET status = 'paid', tx_id = ?, paid_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [deposit.txId, intentId],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function reconcileRows(intents: PaymentIntentRow[]) {
  if (!intents.length) return { checked: 0, paid: 0, confirming: 0 }
  const { coin, network, address } = paymentConfig()
  const oldest = Math.min(...intents.map((intent) => new Date(intent.created_at).getTime())) - 5 * 60_000
  const deposits = await getDeposits(oldest)
  let paid = 0
  let confirming = 0

  for (const intent of intents) {
    const expected = decimalToUnits(intent.expected_amount)
    const deposit = deposits.find((item) =>
      item.coin?.toUpperCase() === coin &&
      item.network?.toUpperCase() === network &&
      item.address === address &&
      item.insertTime >= new Date(intent.created_at).getTime() - 5 * 60_000 &&
      decimalToUnits(item.amount) === expected,
    )
    if (!deposit) continue
    if (deposit.status === 1) {
      await activateIntent(intent.id, deposit)
      paid += 1
    } else if (deposit.status === 6 && intent.status !== "confirming") {
      await query("UPDATE crypto_payment_intents SET status='confirming', updated_at=NOW() WHERE id=? AND status='pending'", [intent.id])
      confirming += 1
    }
  }
  return { checked: intents.length, paid, confirming }
}

const intentSelect = `SELECT p.*, t.name AS tier_name
  FROM crypto_payment_intents p
  JOIN subscription_tiers t ON t.id = p.tier_id`

export async function createPaymentIntent(userId: number, tierId: number) {
  const config = paymentConfig()
  const tier = await queryOne<{ id: number; name: string; price: string | number | null; duration_days: number }>(
    `SELECT id, name, price, duration_days FROM subscription_tiers WHERE id=? AND is_active=1 LIMIT 1`,
    [tierId],
  )
  if (!tier) throw new Error("Subscription tier not found")
  if (tier.price === null || decimalToUnits(tier.price) <= BigInt(0)) throw new Error("This tier does not have a payment price yet")

  const existing = await queryOne<PaymentIntentRow>(
    `${intentSelect}
      WHERE p.user_id=? AND p.tier_id=? AND p.base_amount=?
        AND p.status IN ('pending','confirming') AND p.expires_at > NOW()
      ORDER BY p.created_at DESC LIMIT 1`,
    [userId, tierId, tier.price],
  )
  if (existing) return publicIntent(existing)

  const base = decimalToUnits(tier.price)
  let amount = ""
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix = BigInt(crypto.randomInt(1, 10_000)) * BigInt(100)
    amount = formatUnits(base + suffix)
    const collision = await queryOne<{ id: string }>(
      `SELECT id FROM crypto_payment_intents
        WHERE expected_amount=? AND coin=? AND network=? AND address=?
          AND status IN ('pending','confirming') AND expires_at > NOW() LIMIT 1`,
      [amount, config.coin, config.network, config.address],
    )
    if (!collision) break
    amount = ""
  }
  if (!amount) throw new Error("A unique payment amount could not be reserved")

  const id = crypto.randomUUID()
  await query(
    `INSERT INTO crypto_payment_intents
      (id, user_id, tier_id, duration_days, base_amount, expected_amount, coin, network, address, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [id, userId, tierId, Math.max(1, Number(tier.duration_days || 30)), tier.price, amount, config.coin, config.network, config.address],
  )
  const created = await queryOne<PaymentIntentRow>(`${intentSelect} WHERE p.id=? LIMIT 1`, [id])
  if (!created) throw new Error("Payment request could not be created")
  return publicIntent(created)
}

export async function getAndReconcilePaymentIntent(userId: number, intentId: string) {
  await query(
    `UPDATE crypto_payment_intents SET status='expired', updated_at=NOW()
      WHERE id=? AND user_id=? AND status IN ('pending','confirming') AND expires_at <= NOW()`,
    [intentId, userId],
  )
  let intent = await queryOne<PaymentIntentRow>(`${intentSelect} WHERE p.id=? AND p.user_id=? LIMIT 1`, [intentId, userId])
  if (!intent) throw new Error("Payment request not found")
  if (intent.status === "pending" || intent.status === "confirming") {
    await reconcileRows([intent])
    intent = await queryOne<PaymentIntentRow>(`${intentSelect} WHERE p.id=? AND p.user_id=? LIMIT 1`, [intentId, userId])
  }
  return publicIntent(intent!)
}

export async function reconcilePendingPayments() {
  await query(
    `UPDATE crypto_payment_intents SET status='expired', updated_at=NOW()
      WHERE status IN ('pending','confirming') AND expires_at <= NOW()`,
  )
  const intents = await query<PaymentIntentRow>(
    `${intentSelect} WHERE p.status IN ('pending','confirming') AND p.expires_at > NOW() ORDER BY p.created_at ASC LIMIT 100`,
  )
  return reconcileRows(intents)
}

