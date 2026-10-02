const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./database/schema');
const { startScheduler } = require('./scraper/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
console.log('📦 Initializing database...');
const db = initializeDatabase();
db.close();
console.log('✅ Database ready');

// API Routes
app.use('/api/master-lists', require('./routes/masterLists'));
app.use('/api/creators', require('./routes/creators'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/scraper', require('./routes/scraper'));

// SPA fallback (Express v5 uses '{*any}' instead of '*')
app.get('/{*any}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Instagram Competitor Tracker running at http://localhost:${PORT}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Start background scheduler
    startScheduler();
});
