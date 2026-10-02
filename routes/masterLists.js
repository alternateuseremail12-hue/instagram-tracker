const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/schema');

// GET all master lists
router.get('/', (req, res) => {
    const db = getDatabase();
    try {
        const lists = db.prepare(`
            SELECT ml.*, 
                   COUNT(DISTINCT c.id) as creator_count,
                   GROUP_CONCAT(DISTINCT t.name) as tags
            FROM master_lists ml
            LEFT JOIN creators c ON c.master_list_id = ml.id
            LEFT JOIN master_list_tags mlt ON mlt.master_list_id = ml.id
            LEFT JOIN tags t ON t.id = mlt.tag_id
            GROUP BY ml.id
            ORDER BY ml.date_modified DESC
        `).all();

        lists.forEach(l => {
            l.tags = l.tags ? l.tags.split(',') : [];
        });

        res.json(lists);
    } finally {
        db.close();
    }
});

// GET single master list with creators
router.get('/:id', (req, res) => {
    const db = getDatabase();
    try {
        const list = db.prepare(`SELECT * FROM master_lists WHERE id = ?`).get(req.params.id);
        if (!list) return res.status(404).json({ error: 'Master list not found' });

        const tags = db.prepare(`
            SELECT t.name FROM tags t
            JOIN master_list_tags mlt ON mlt.tag_id = t.id
            WHERE mlt.master_list_id = ?
        `).all(req.params.id).map(t => t.name);

        const creators = db.prepare(`
            SELECT c.*,
                   (SELECT followers FROM profile_snapshots WHERE creator_id = c.id ORDER BY date_captured DESC LIMIT 1) as latest_followers,
                   (SELECT engagement_rate FROM profile_snapshots WHERE creator_id = c.id ORDER BY date_captured DESC LIMIT 1) as latest_engagement
            FROM creators c
            WHERE c.master_list_id = ?
            ORDER BY c.username ASC
        `).all(req.params.id);

        res.json({ ...list, tags, creators });
    } finally {
        db.close();
    }
});

// POST create master list
router.post('/', (req, res) => {
    const db = getDatabase();
    try {
        const { name, description, tags } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });

        const id = uuidv4();
        db.prepare(`INSERT INTO master_lists (id, name, description) VALUES (?, ?, ?)`).run(id, name, description || '');

        if (tags && Array.isArray(tags)) {
            for (const tagName of tags) {
                const trimmed = tagName.trim().toLowerCase();
                if (!trimmed) continue;
                let tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(trimmed);
                if (!tag) {
                    const tagId = uuidv4();
                    db.prepare(`INSERT INTO tags (id, name) VALUES (?, ?)`).run(tagId, trimmed);
                    tag = { id: tagId };
                }
                db.prepare(`INSERT OR IGNORE INTO master_list_tags (master_list_id, tag_id) VALUES (?, ?)`).run(id, tag.id);
            }
        }

        res.status(201).json({ id, name, description: description || '', tags: tags || [] });
    } finally {
        db.close();
    }
});

// PUT update master list
router.put('/:id', (req, res) => {
    const db = getDatabase();
    try {
        const { name, description, tags } = req.body;
        const existing = db.prepare(`SELECT * FROM master_lists WHERE id = ?`).get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Master list not found' });

        db.prepare(`UPDATE master_lists SET name = ?, description = ?, date_modified = datetime('now') WHERE id = ?`)
            .run(name || existing.name, description !== undefined ? description : existing.description, req.params.id);

        if (tags && Array.isArray(tags)) {
            db.prepare(`DELETE FROM master_list_tags WHERE master_list_id = ?`).run(req.params.id);
            for (const tagName of tags) {
                const trimmed = tagName.trim().toLowerCase();
                if (!trimmed) continue;
                let tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(trimmed);
                if (!tag) {
                    const tagId = uuidv4();
                    db.prepare(`INSERT INTO tags (id, name) VALUES (?, ?)`).run(tagId, trimmed);
                    tag = { id: tagId };
                }
                db.prepare(`INSERT OR IGNORE INTO master_list_tags (master_list_id, tag_id) VALUES (?, ?)`).run(req.params.id, tag.id);
            }
        }

        res.json({ success: true });
    } finally {
        db.close();
    }
});

// DELETE master list
router.delete('/:id', (req, res) => {
    const db = getDatabase();
    try {
        const result = db.prepare(`DELETE FROM master_lists WHERE id = ?`).run(req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Master list not found' });
        res.json({ success: true });
    } finally {
        db.close();
    }
});

// GET all tags
router.get('/tags/all', (req, res) => {
    const db = getDatabase();
    try {
        const tags = db.prepare(`SELECT * FROM tags ORDER BY name ASC`).all();
        res.json(tags);
    } finally {
        db.close();
    }
});

module.exports = router;
