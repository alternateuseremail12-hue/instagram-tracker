// ─── DASHBOARD PAGE ───
async function renderDashboard() {
    const container = document.getElementById('pageContainer');
    container.innerHTML = `<div class="fade-in">
        <div class="page-header"><h2>Dashboard</h2><p>Overview of all tracked Instagram creators</p></div>
        <div class="stats-grid" id="dashStats"></div>
        <div class="grid-2" style="margin-bottom:24px">
            <div class="card"><div class="card-header"><span class="card-title">Recent Master Lists</span></div><div id="dashLists"></div></div>
            <div class="card"><div class="card-header"><span class="card-title">Recent Scrape Activity</span></div><div id="dashLogs"></div></div>
        </div>
    </div>`;
    try {
        const lists = await API.get('/api/master-lists');
        let totalCreators = 0, totalFollowers = 0;
        lists.forEach(l => totalCreators += (l.creator_count || 0));
        const creators = await API.get('/api/creators');
        creators.forEach(c => totalFollowers += (c.latest_followers || 0));
        const avgEng = creators.length ? creators.reduce((s, c) => s + (c.latest_engagement || 0), 0) / creators.length : 0;

        document.getElementById('dashStats').innerHTML = `
            <div class="stat-card"><div class="stat-card-icon purple">📋</div><div class="stat-card-label">Master Lists</div><div class="stat-card-value">${lists.length}</div></div>
            <div class="stat-card"><div class="stat-card-icon cyan">👤</div><div class="stat-card-label">Creators</div><div class="stat-card-value">${totalCreators}</div></div>
            <div class="stat-card"><div class="stat-card-icon pink">👥</div><div class="stat-card-label">Combined Followers</div><div class="stat-card-value">${formatNumber(totalFollowers)}</div></div>
            <div class="stat-card"><div class="stat-card-icon green">📈</div><div class="stat-card-label">Avg Engagement</div><div class="stat-card-value">${avgEng.toFixed(2)}%</div></div>
            <div class="stat-card"><div class="stat-card-icon yellow">📊</div><div class="stat-card-label">Total Content</div><div class="stat-card-value">${creators.reduce((s, c) => s + (c.total_content || 0), 0)}</div></div>`;

        document.getElementById('dashLists').innerHTML = lists.length ? lists.slice(0, 5).map(l => `
            <div class="log-entry" style="cursor:pointer" onclick="navigate('list-detail',{id:'${l.id}',name:'${l.name}'})">
                <span style="color:var(--accent-primary)">📋</span>
                <span style="flex:1;font-weight:600">${l.name}</span>
                <span class="tag tag-purple">${l.creator_count || 0} creators</span>
            </div>`).join('') : '<div class="empty-state"><p>No lists yet. Create one to get started!</p></div>';

        const scraper = await API.get('/api/scraper/status');
        document.getElementById('dashLogs').innerHTML = scraper.recentLogs?.length ? scraper.recentLogs.slice(0, 8).map(l => `
            <div class="log-entry">
                <div class="log-status ${l.status}"></div>
                <span style="font-weight:600">@${l.username}</span>
                <span style="flex:1;color:var(--text-muted)">${l.new_posts_found || 0} new</span>
                <span style="color:var(--text-dim);font-size:12px">${timeAgo(l.started_at)}</span>
            </div>`).join('') : '<div style="color:var(--text-muted);font-size:13px;padding:16px">No scrape activity yet</div>';
    } catch (e) { console.error(e); }
}

// ─── LISTS PAGE ───
async function renderListsPage() {
    const container = document.getElementById('pageContainer');
    container.innerHTML = `<div class="fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
            <div><h2>Master Lists</h2><p>Organize and track competitor groups</p></div>
            <button class="btn btn-primary" onclick="openCreateListModal()">＋ New List</button>
        </div>
        <div id="listsGrid" class="grid-3"></div>
    </div>`;
    try {
        const lists = await API.get('/api/master-lists');
        const grid = document.getElementById('listsGrid');
        if (!lists.length) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📋</div><h3>No Master Lists Yet</h3><p>Create your first list to start tracking Instagram competitors.</p><button class="btn btn-primary" onclick="openCreateListModal()">＋ Create List</button></div>`;
            return;
        }
        grid.innerHTML = lists.map(l => `
            <div class="list-card" onclick="navigate('list-detail',{id:'${l.id}',name:'${l.name}'})">
                <div class="list-card-icon">📊</div>
                <h3>${l.name}</h3>
                <p>${l.description || 'No description'}</p>
                <div class="tags-container" style="margin-bottom:12px">${(l.tags || []).map(t => `<span class="tag tag-purple">${t}</span>`).join('')}</div>
                <div class="list-card-meta">
                    <span>👤 ${l.creator_count || 0} creators</span>
                    <span>📅 ${new Date(l.date_created).toLocaleDateString()}</span>
                </div>
            </div>`).join('');
    } catch (e) { console.error(e); }
}

// Global date range state for master lists
let _listDateRange = { startDate: '', endDate: '' };

function getListDateParams() {
    const p = new URLSearchParams();
    if (_listDateRange.startDate) p.set('startDate', _listDateRange.startDate);
    if (_listDateRange.endDate) p.set('endDate', _listDateRange.endDate);
    return p.toString() ? '?' + p.toString() : '';
}

function applyListDateFilter(listId) {
    _listDateRange.startDate = document.getElementById('listDateStart').value;
    _listDateRange.endDate = document.getElementById('listDateEnd').value;
    renderListDetail(listId);
}

function clearListDateFilter(listId) {
    _listDateRange = { startDate: '', endDate: '' };
    renderListDetail(listId);
}

// ─── LIST DETAIL PAGE ───
async function renderListDetail(listId) {
    const container = document.getElementById('pageContainer');
    container.innerHTML = '<div class="loading-spinner" style="padding:48px;text-align:center"><div class="spinner"></div> Loading...</div>';
    try {
        const dp = getListDateParams();
        const list = await API.get(`/api/master-lists/${listId}`);
        const dashboard = await API.get(`/api/analytics/master-list/${listId}/dashboard${dp}`);
        const comparison = await API.get(`/api/analytics/master-list/${listId}/comparison${dp}`);

        container.innerHTML = `<div class="fade-in">
            <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                    <h2>${list.name}</h2>
                    <p>${list.description || 'No description'}</p>
                    <div class="tags-container" style="margin-top:8px">${(list.tags || []).map(t => `<span class="tag tag-purple">${t}</span>`).join('')}</div>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn btn-secondary btn-sm" onclick="openAddCreatorModal('${listId}')">＋ Add Creator</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteList('${listId}')">🗑 Delete</button>
                </div>
            </div>

            <!-- Date Range Filter -->
            <div class="card" style="margin-bottom:16px;padding:12px 16px">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                    <span style="font-size:13px;font-weight:600;color:var(--text-muted)">📅 Filter by date range:</span>
                    <input type="date" id="listDateStart" class="form-input" style="width:auto;padding:6px 10px;font-size:13px" value="${_listDateRange.startDate}" />
                    <span style="color:var(--text-dim)">→</span>
                    <input type="date" id="listDateEnd" class="form-input" style="width:auto;padding:6px 10px;font-size:13px" value="${_listDateRange.endDate}" />
                    <button class="btn btn-secondary btn-sm" onclick="applyListDateFilter('${listId}')">Apply</button>
                    <button class="btn btn-sm" style="opacity:0.7" onclick="clearListDateFilter('${listId}')">Clear</button>
                    ${_listDateRange.startDate || _listDateRange.endDate ? '<span style="font-size:11px;color:var(--accent-primary)">✓ Filter active</span>' : ''}
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card"><div class="stat-card-icon purple">👤</div><div class="stat-card-label">Creators</div><div class="stat-card-value">${dashboard.total_creators}</div></div>
                <div class="stat-card"><div class="stat-card-icon cyan">👥</div><div class="stat-card-label">Combined Followers</div><div class="stat-card-value">${formatNumber(dashboard.combined_followers)}</div><div class="stat-card-change" style="font-size:10px;color:rgba(255,255,255,0.4)">for selected period</div></div>
                <div class="stat-card"><div class="stat-card-icon pink">📈</div><div class="stat-card-label">Avg Engagement</div><div class="stat-card-value">${dashboard.avg_engagement}%</div><div class="stat-card-change" style="font-size:10px;color:rgba(255,255,255,0.4)">for selected period</div></div>
                <div class="stat-card"><div class="stat-card-icon green">📝</div><div class="stat-card-label">Posts (Period)</div><div class="stat-card-value">${dashboard.posts_this_week}</div></div>
                <div class="stat-card"><div class="stat-card-icon yellow">🎬</div><div class="stat-card-label">Reels (Period)</div><div class="stat-card-value">${dashboard.reels_this_week}</div></div>
            </div>
            ${comparison.highlights?.most_active ? `
            <div class="card" style="margin-bottom:24px">
                <div class="card-header"><span class="card-title">🏆 Highlights</span></div>
                <div class="grid-3">
                    <div class="insight-card"><div class="insight-icon high">🔥</div><div><div class="insight-type" style="color:var(--accent-tertiary)">Most Active</div><div class="insight-text">@${comparison.highlights.most_active?.username} — ${comparison.highlights.most_active?.posting_frequency} posts (period)</div></div></div>
                    <div class="insight-card"><div class="insight-icon insight">🚀</div><div><div class="insight-type" style="color:var(--accent-info)">Fastest Growing</div><div class="insight-text">@${comparison.highlights.fastest_growing?.username} — ${comparison.highlights.fastest_growing?.follower_growth}% growth</div></div></div>
                    <div class="insight-card"><div class="insight-icon warning">⚡</div><div><div class="insight-type" style="color:var(--accent-warning)">Top Engagement</div><div class="insight-text">@${comparison.highlights.highest_engagement?.username} — ${comparison.highlights.highest_engagement?.avg_engagement}%</div></div></div>
                </div>
            </div>` : ''}
            <div class="card"><div class="card-header"><span class="card-title">Tracked Creators</span></div>
                ${list.creators.length ? `<div class="grid-3" id="creatorsGrid">${list.creators.map(c => `
                    <div class="creator-card" onclick="navigate('creator-detail',{id:'${c.id}',username:'${c.username}'})">
                        <div class="creator-card-header">
                            <div class="creator-avatar">${c.display_name ? c.display_name[0].toUpperCase() : c.username[0].toUpperCase()}</div>
                            <div class="creator-info">
                                <h3>${c.display_name || c.username} ${c.is_verified ? '<span class="verified">✓</span>' : ''}</h3>
                                <div class="username">@${c.username}</div>
                            </div>
                        </div>
                        <div class="creator-stats">
                            <div class="creator-stat"><div class="creator-stat-value">${formatNumber(c.latest_followers || 0)}</div><div class="creator-stat-label">Followers</div></div>
                            <div class="creator-stat"><div class="creator-stat-value">${(c.latest_engagement || 0).toFixed(1)}%</div><div class="creator-stat-label">Engagement</div></div>
                            <div class="creator-stat"><div class="creator-stat-value">${timeAgo(c.last_scraped_date)}</div><div class="creator-stat-label">Last Scraped</div></div>
                        </div>
                    </div>`).join('')}</div>`
                : '<div class="empty-state"><div class="empty-state-icon">👤</div><h3>No Creators</h3><p>Add Instagram creators to start tracking.</p></div>'}
            </div>
            ${comparison.creators?.length ? `<div class="card" style="margin-top:24px"><div class="card-header">
                <span class="card-title">Creator Comparison</span>
                <span style="font-size:12px;color:rgba(255,255,255,0.4);font-family:monospace;display:block;margin-top:4px"># compares engagement and growth across all creators solely within the selected date range</span>
                </div>
                <div class="table-container"><table><thead><tr><th>Creator</th><th>Followers</th><th>Engagement</th><th>Avg Likes</th><th>Avg Comments</th><th>Posts (Period)</th><th>Growth</th></tr></thead>
                <tbody>${comparison.creators.map(c => `<tr style="cursor:pointer" onclick="navigate('creator-detail',{id:'${c.id}',username:'${c.username}'})">
                    <td style="font-weight:600">@${c.username}</td><td>${formatNumber(c.followers)}</td><td>${c.avg_engagement}%</td>
                    <td>${formatNumber(c.avg_likes)}</td><td>${formatNumber(c.avg_comments)}</td><td>${c.posting_frequency}</td>
                    <td><span class="stat-card-change ${c.follower_growth >= 0 ? 'positive' : 'negative'}">${c.follower_growth >= 0 ? '↑' : '↓'} ${Math.abs(c.follower_growth)}%</span></td>
                </tr>`).join('')}</tbody></table></div></div>` : ''}
        </div>`;
    } catch (e) { console.error(e); container.innerHTML = '<div class="empty-state"><h3>Error loading list</h3></div>'; }
}

async function deleteList(id) {
    if (!confirm('Delete this master list and all its data?')) return;
    await API.del(`/api/master-lists/${id}`);
    showToast('List deleted', 'success');
    await loadSidebar();
    navigate('lists');
}
