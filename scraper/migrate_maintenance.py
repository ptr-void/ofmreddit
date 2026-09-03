"""Add isolated, restorable maintenance bookkeeping; default is a read-only plan."""
import argparse

try:
    from scraper.migrate_schema import connection_config
except ModuleNotFoundError:
    from migrate_schema import connection_config

STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS subreddit_maintenance (
        subreddit_name VARCHAR(64) PRIMARY KEY,
        state VARCHAR(16) NOT NULL DEFAULT 'active',
        dead_checks INT NOT NULL DEFAULT 0,
        first_dead_at DATETIME NULL,
        last_dead_at DATETIME NULL,
        last_checked_at DATETIME NULL,
        last_evidence VARCHAR(500) NULL,
        archived_at DATETIME NULL,
        archive_json LONGTEXT NULL,
        discovery_json LONGTEXT NULL,
        requested_action VARCHAR(16) NULL,
        hold_until DATETIME NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB""",
    """CREATE TABLE IF NOT EXISTS subreddit_maintenance_control (
        id INT PRIMARY KEY,
        last_discovery_at DATETIME NULL,
        discovery_cursor INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB""",
    """CREATE TABLE IF NOT EXISTS subreddit_maintenance_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        subreddit_name VARCHAR(64) NOT NULL,
        action VARCHAR(32) NOT NULL,
        detail_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_maintenance_events_name (subreddit_name)
    ) ENGINE=InnoDB""",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply:
        print('\n;\n'.join(STATEMENTS))
        return
    import mysql.connector
    connection = mysql.connector.connect(**connection_config())
    try:
        with connection.cursor() as cursor:
            for statement in STATEMENTS:
                cursor.execute(statement)
            cursor.execute('INSERT IGNORE INTO subreddit_maintenance_control (id) VALUES (1)')
        print('Verified additive maintenance tables. Existing tables/data were not altered.')
    finally:
        connection.close()


if __name__ == '__main__':
    main()
