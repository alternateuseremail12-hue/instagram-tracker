const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/schema');

// GET all creators (optional filter by master_list_id)
router.get('/', (req, res) => {
    const db = getDatabase();
    try {
        let query = `
            SELECT c.*,
                   ml.name as master_list_name,
                   (SELECT followers FROM profile_snapshots WHERE creator_id = c.id ORDER BY date_captured DESC LIMIT 1) as latest_followers,
                   (SELECT following FROM profile_snapshots WHERE creator_id = c.id ORDER BY date_captured DESC LIMIT 1) as latest_following,
                   (SELECT engagement_rate FROM profile_snapshots WHERE creator_id = c.id ORDER BY date_captured DESC LIMIT 1) as latest_engagement,
                   (SELECT average_likes FROM profile_snapshots WHERE creator_id = c.id ORDER BY date_captured DESC LIMIT 1) as latest_avg_likes,
                   (SELECT average_comments FROM profile_snapshots WHERE creator_id = c.id ORDER BY date_captured DESC LIMIT 1) as latest_avg_comments,
                   (SELECT COUNT(*) FROM content_items WHERE creator_id = c.id) as total_content
            FROM creators c
            LEFT JOIN master_lists ml ON ml.id = c.master_list_id
        `;
        const params = [];
        if (req.query.master_list_id) {
            query += ` WHERE c.master_list_id = ?`;
            params.push(req.query.master_list_id);
        }
        query += ` ORDER BY c.username ASC`;

        const creators = db.prepare(query).all(...params);
        res.json(creators);
    } finally {
        db.close();
    }
});

// GET single creator with full details
router.get('/:id', (req, res) => {
    const db = getDatabase();
    try {
        const creator = db.prepare(`
            SELECT c.*, ml.name as master_list_name
            FROM creators c
            LEFT JOIN master_lists ml ON ml.id = c.master_list_id
            WHERE c.id = ?
        `).get(req.params.id);
        if (!creator) return res.status(404).json({ error: 'Creator not found' });

        // Latest snapshot
        const latestSnapshot = db.prepare(`
            SELECT * FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1
        `).get(req.params.id);

        // All snapshots for historical charts
        const snapshots = db.prepare(`
            SELECT * FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured ASC
        `).all(req.params.id);

        // Recent content
        const content = db.prepare(`
            SELECT ci.*,
                   (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as latest_likes,
                   (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as latest_comments,
                   (SELECT views FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as latest_views
            FROM content_items ci
            WHERE ci.creator_id = ?
            ORDER BY ci.publish_date DESC
            LIMIT 50
        `).all(req.params.id);

        // Scrape history
        const scrapeHistory = db.prepare(`
            SELECT * FROM scrape_log WHERE creator_id = ? ORDER BY started_at DESC LIMIT 20
        `).all(req.params.id);

        res.json({
            ...creator,
            latestSnapshot,
            snapshots,
            content,
            scrapeHistory
        });
    } finally {
        db.close();
    }
});

// POST add creator
router.post('/', (req, res) => {
    const db = getDatabase();
    try {
        const { username, master_list_id } = req.body;
        if (!username || !master_list_id) {
            return res.status(400).json({ error: 'Username and master_list_id are required' });
        }

        // Check master list exists
        const list = db.prepare(`SELECT id FROM master_lists WHERE id = ?`).get(master_list_id);
        if (!list) return res.status(404).json({ error: 'Master list not found' });

        // Clean username
        let cleanUsername = username.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');

        // Check uniqueness
        const existing = db.prepare(`SELECT id FROM creators WHERE username = ?`).get(cleanUsername);
        if (existing) return res.status(409).json({ error: 'Creator already exists' });

        const id = uuidv4();
        const instagramUrl = `https://www.instagram.com/${cleanUsername}/`;

        db.prepare(`
            INSERT INTO creators (id, master_list_id, username, instagram_url)
            VALUES (?, ?, ?, ?)
        `).run(id, master_list_id, cleanUsername, instagramUrl);

        res.status(201).json({ id, username: cleanUsername, instagram_url: instagramUrl, master_list_id });
    } finally {
        db.close();
    }
});

// PUT update creator
router.put('/:id', (req, res) => {
    const db = getDatabase();
    try {
        const existing = db.prepare(`SELECT * FROM creators WHERE id = ?`).get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Creator not found' });

        const { master_list_id, tracking_enabled, display_name } = req.body;

        if (master_list_id !== undefined) {
            db.prepare(`UPDATE creators SET master_list_id = ? WHERE id = ?`).run(master_list_id, req.params.id);
        }
        if (tracking_enabled !== undefined) {
            db.prepare(`UPDATE creators SET tracking_enabled = ? WHERE id = ?`).run(tracking_enabled ? 1 : 0, req.params.id);
        }
        if (display_name !== undefined) {
            db.prepare(`UPDATE creators SET display_name = ? WHERE id = ?`).run(display_name, req.params.id);
        }

        res.json({ success: true });
    } finally {
        db.close();
    }
});

// DELETE creator
router.delete('/:id', (req, res) => {
    const db = getDatabase();
    try {
        const result = db.prepare(`DELETE FROM creators WHERE id = ?`).run(req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Creator not found' });
        res.json({ success: true });
    } finally {
        db.close();
    }
});

module.exports = router;
