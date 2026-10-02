// ─── API HELPERS ───
const API = {
    async get(url) { const r = await fetch(url); return r.json(); },
    async post(url, data) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return r.json(); },
    async put(url, data) { const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return r.json(); },
    async del(url) { const r = await fetch(url, { method: 'DELETE' }); return r.json(); }
};

// ─── STATE ───
let currentPage = 'dashboard';
let masterLists = [];
let chartInstances = {};

// ─── UTILITIES ───
function formatNumber(n) {
    if (n === null || n === undefined) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}
function timeAgo(dateStr) {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}
function destroyCharts() { Object.values(chartInstances).forEach(c => c.destroy()); chartInstances = {}; }

// ─── TOAST ───
function showToast(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${msg}`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ─── MODALS ───
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function openCreateListModal() { openModal('createListModal'); }
function openAddCreatorModal(listId) {
    document.getElementById('creatorMasterListId').value = listId;
    document.getElementById('creatorUsername').value = '';
    openModal('addCreatorModal');
}

// ─── NAVIGATION ───
function navigate(page, data) {
    currentPage = page;
    destroyCharts();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');
    const bc = document.getElementById('breadcrumb');

    switch (page) {
        case 'dashboard': bc.innerHTML = '<span>InstaTrack</span><span class="breadcrumb-sep">›</span><span class="current">Dashboard</span>'; renderDashboard(); break;
        case 'lists': bc.innerHTML = '<span>InstaTrack</span><span class="breadcrumb-sep">›</span><span class="current">Master Lists</span>'; renderListsPage(); break;
        case 'list-detail': bc.innerHTML = `<span class="current">${data?.name || 'List'}</span>`; renderListDetail(data.id); break;
        case 'creator-detail': bc.innerHTML = `<span class="current">@${data?.username || 'Creator'}</span>`; renderCreatorDetail(data.id); break;
        case 'scraper': bc.innerHTML = '<span>InstaTrack</span><span class="breadcrumb-sep">›</span><span class="current">Scraper</span>'; renderScraperPage(); break;
        case 'settings': bc.innerHTML = '<span>InstaTrack</span><span class="breadcrumb-sep">›</span><span class="current">Settings</span>'; renderSettingsPage(); break;
    }
}

// ─── SIDEBAR ───
async function loadSidebar() {
    try {
        masterLists = await API.get('/api/master-lists');
        document.getElementById('listCount').textContent = masterLists.length;
        const nav = document.getElementById('masterListNav');
        nav.innerHTML = masterLists.slice(0, 8).map(l => `
            <div class="nav-item master-list-nav-item" onclick="navigate('list-detail', {id:'${l.id}',name:'${l.name}'})">
                <span class="dot"></span> ${l.name}
                <span class="nav-item-badge">${l.creator_count || 0}</span>
            </div>
        `).join('');
    } catch (e) { console.error('Sidebar load error:', e); }
}

// ─── FORM HANDLERS ───
async function handleCreateList(e) {
    e.preventDefault();
    const name = document.getElementById('listName').value.trim();
    const description = document.getElementById('listDescription').value.trim();
    const tags = document.getElementById('listTags').value.split(',').map(t => t.trim()).filter(Boolean);
    if (!name) return;
    try {
        await API.post('/api/master-lists', { name, description, tags });
        closeModal('createListModal');
        document.getElementById('listName').value = '';
        document.getElementById('listDescription').value = '';
        document.getElementById('listTags').value = '';
        showToast('Master list created!', 'success');
        await loadSidebar();
        if (currentPage === 'lists' || currentPage === 'dashboard') navigate(currentPage);
    } catch (e) { showToast('Failed to create list', 'error'); }
}

async function handleAddCreator(e) {
    e.preventDefault();
    const username = document.getElementById('creatorUsername').value.trim();
    const master_list_id = document.getElementById('creatorMasterListId').value;
    if (!username) return;
    try {
        const result = await API.post('/api/creators', { username, master_list_id });
        if (result.error) { showToast(result.error, 'error'); return; }
        closeModal('addCreatorModal');
        showToast(`@${result.username} added!`, 'success');
        await loadSidebar();
        navigate('list-detail', { id: master_list_id, name: '' });
    } catch (e) { showToast('Failed to add creator', 'error'); }
}

async function triggerFullScrape() {
    try {
        await API.post('/api/scraper/scrape-all');
        showToast('Full scrape cycle started', 'info');
        updateScraperStatus();
    } catch (e) { showToast('Failed to start scrape', 'error'); }
}

async function updateScraperStatus() {
    try {
        const s = await API.get('/api/scraper/status');
        const dot = document.getElementById('scraperDot');
        const text = document.getElementById('scraperStatusText');
        dot.className = `scraper-status-dot ${s.isRunning ? 'running' : 'idle'}`;
        text.textContent = s.isRunning ? `Scraping @${s.currentCreator || '...'}` : 'Scraper idle';
    } catch (e) { }
}

// ─── CHART HELPER ───
function createChart(canvasId, config) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    Chart.defaults.color = '#9898b0';
    Chart.defaults.borderColor = 'rgba(139,92,246,0.1)';
    Chart.defaults.font.family = 'Inter';
    chartInstances[canvasId] = new Chart(ctx, config);
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', () => {
    loadSidebar();
    navigate('dashboard');
    updateScraperStatus();
    setInterval(updateScraperStatus, 15000);
});
