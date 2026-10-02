const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'tracker.db');

function ensureDataDir() {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function initializeDatabase() {
    ensureDataDir();
    const db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent read performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // ── Master Lists ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS master_lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            date_created TEXT NOT NULL DEFAULT (datetime('now')),
            date_modified TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);

    // ── Tags ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        )
    `);

    // ── Master List Tags (many-to-many) ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS master_list_tags (
            master_list_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            PRIMARY KEY (master_list_id, tag_id),
            FOREIGN KEY (master_list_id) REFERENCES master_lists(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
    `);

    // ── Creators ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS creators (
            id TEXT PRIMARY KEY,
            master_list_id TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT DEFAULT '',
            instagram_url TEXT NOT NULL,
            profile_picture_path TEXT DEFAULT '',
            biography TEXT DEFAULT '',
            external_website TEXT DEFAULT '',
            is_verified INTEGER DEFAULT 0,
            date_first_tracked TEXT NOT NULL DEFAULT (datetime('now')),
            last_scraped_date TEXT DEFAULT NULL,
            last_scraped_instagram_id TEXT DEFAULT NULL,
            tracking_enabled INTEGER DEFAULT 1,
            FOREIGN KEY (master_list_id) REFERENCES master_lists(id) ON DELETE CASCADE
        )
    `);

    // ── Profile Snapshots ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS profile_snapshots (
            id TEXT PRIMARY KEY,
            creator_id TEXT NOT NULL,
            followers INTEGER DEFAULT 0,
            following INTEGER DEFAULT 0,
            total_posts INTEGER DEFAULT 0,
            total_reels INTEGER DEFAULT 0,
            stories_visible INTEGER DEFAULT 0,
            average_likes REAL DEFAULT 0,
            average_comments REAL DEFAULT 0,
            engagement_rate REAL DEFAULT 0,
            date_captured TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
        )
    `);

    // ── Content Items ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS content_items (
            id TEXT PRIMARY KEY,
            creator_id TEXT NOT NULL,
            instagram_id TEXT DEFAULT '',
            url TEXT DEFAULT '',
            caption TEXT DEFAULT '',
            publish_date TEXT DEFAULT '',
            publish_time TEXT DEFAULT '',
            content_type TEXT CHECK(content_type IN ('image', 'carousel', 'video', 'reel')) DEFAULT 'image',
            num_media_items INTEGER DEFAULT 1,
            download_location TEXT DEFAULT '',
            is_deleted INTEGER DEFAULT 0,
            date_first_scraped TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
        )
    `);

    // ── Engagement Snapshots ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS engagement_snapshots (
            id TEXT PRIMARY KEY,
            content_id TEXT NOT NULL,
            likes INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            views INTEGER DEFAULT 0,
            date_collected TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE
        )
    `);

    // ── Hashtags ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS hashtags (
            id TEXT PRIMARY KEY,
            tag TEXT NOT NULL UNIQUE,
            date_first_used TEXT NOT NULL DEFAULT (datetime('now')),
            date_last_used TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);

    // ── Content Hashtags (many-to-many) ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS content_hashtags (
            content_id TEXT NOT NULL,
            hashtag_id TEXT NOT NULL,
            PRIMARY KEY (content_id, hashtag_id),
            FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE,
            FOREIGN KEY (hashtag_id) REFERENCES hashtags(id) ON DELETE CASCADE
        )
    `);

    // ── Mentions ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS mentions (
            id TEXT PRIMARY KEY,
            content_id TEXT NOT NULL,
            mentioned_username TEXT NOT NULL,
            date_used TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE
        )
    `);

    // ── Stories ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS stories (
            id TEXT PRIMARY KEY,
            creator_id TEXT NOT NULL,
            date_collected TEXT NOT NULL DEFAULT (datetime('now')),
            num_stories INTEGER DEFAULT 0,
            download_location TEXT DEFAULT '',
            FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
        )
    `);

    // ── Scrape Log ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS scrape_log (
            id TEXT PRIMARY KEY,
            creator_id TEXT NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT DEFAULT NULL,
            status TEXT CHECK(status IN ('running', 'success', 'failed')) DEFAULT 'running',
            error_message TEXT DEFAULT '',
            new_posts_found INTEGER DEFAULT 0,
            FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
        )
    `);

    // ── App Settings ──
    db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    // Default settings
    const insertSetting = db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`);
    insertSetting.run('scrape_interval_minutes', '60');
    insertSetting.run('download_media', 'true');
    insertSetting.run('max_posts_per_scrape', '12');
    insertSetting.run('scraper_status', 'idle');

    // ── Create Indexes ──
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_creators_master_list ON creators(master_list_id);
        CREATE INDEX IF NOT EXISTS idx_profile_snapshots_creator ON profile_snapshots(creator_id);
        CREATE INDEX IF NOT EXISTS idx_content_items_creator ON content_items(creator_id);
        CREATE INDEX IF NOT EXISTS idx_content_items_instagram_id ON content_items(instagram_id);
        CREATE INDEX IF NOT EXISTS idx_engagement_snapshots_content ON engagement_snapshots(content_id);
        CREATE INDEX IF NOT EXISTS idx_content_hashtags_content ON content_hashtags(content_id);
        CREATE INDEX IF NOT EXISTS idx_content_hashtags_hashtag ON content_hashtags(hashtag_id);
        CREATE INDEX IF NOT EXISTS idx_mentions_content ON mentions(content_id);
        CREATE INDEX IF NOT EXISTS idx_stories_creator ON stories(creator_id);
        CREATE INDEX IF NOT EXISTS idx_scrape_log_creator ON scrape_log(creator_id);
    `);

    // ── Migration: add last_scraped_instagram_id if missing ──
    try {
        db.exec(`ALTER TABLE creators ADD COLUMN last_scraped_instagram_id TEXT DEFAULT NULL`);
    } catch (e) {
        // Column already exists, ignore
    }

    return db;
}

function getDatabase() {
    ensureDataDir();
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
}

module.exports = { initializeDatabase, getDatabase, DB_PATH };
