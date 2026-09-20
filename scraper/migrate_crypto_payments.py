"""Idempotent production schema migration for read-only Binance deposit payments."""
from __future__ import annotations

try:
    from scraper.migrate_schema import connection_config
except ModuleNotFoundError:
    from migrate_schema import connection_config


CREATE_INTENTS = """CREATE TABLE IF NOT EXISTS crypto_payment_intents (
  id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  tier_id INT NOT NULL,
  duration_days INT NOT NULL DEFAULT 30,
  base_amount DECIMAL(20,8) NOT NULL,
  expected_amount DECIMAL(20,8) NOT NULL,
  coin VARCHAR(16) NOT NULL,
  network VARCHAR(32) NOT NULL,
  address VARCHAR(255) NOT NULL,
  status ENUM('pending','confirming','paid','expired','cancelled') NOT NULL DEFAULT 'pending',
  tx_id VARCHAR(191) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  paid_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crypto_payment_tx (tx_id),
  KEY idx_crypto_payment_pending (status, expires_at),
  KEY idx_crypto_payment_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci"""


def main():
    import mysql.connector
    connection = mysql.connector.connect(**connection_config())
    try:
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='subscription_tiers' AND COLUMN_NAME='duration_days'",
                (connection.database,),
            )
            if cursor.fetchone() is None:
                cursor.execute(
                    "ALTER TABLE subscription_tiers ADD COLUMN duration_days INT NOT NULL DEFAULT 30 AFTER price"
                )
            cursor.execute(CREATE_INTENTS)
        connection.commit()
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='subscription_tiers' AND COLUMN_NAME='duration_days'",
                (connection.database,),
            )
            assert cursor.fetchone()['count'] == 1
            cursor.execute(
                "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='crypto_payment_intents'",
                (connection.database,),
            )
            assert cursor.fetchone()['count'] == 1
        print('Verified crypto payment schema.')
    finally:
        connection.close()


if __name__ == '__main__':
    main()
