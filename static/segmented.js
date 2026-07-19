const SEG_DAY_START = 7;
const SEG_DAY_END = 23;
const SEG_TOTAL_MIN = (SEG_DAY_END - SEG_DAY_START) * 60;
const SEG_DEFAULT_COLOR = '#2e5c8a';
const SEG_JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const SEG_MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const SEG_SNAP_MIN = 15;
const SEG_REFRESH_MS = 3000;

let segMonday = segMondayOf(new Date());
let segUsers = [];       // liste brute des utilisateurs (/api/all-users)
let segColumns = [];     // colonnes affichees : {type:'shared'|'user', id, label, isMe}
let segCategories = [];
let segEvents = [];
let segIsInteracting = false;

function segMondayOf(d) {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
}
function segFmtDate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function segAddDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function segIsSameDay(a, b) { return segFmtDate(a) === segFmtDate(b); }
function segTimeToMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m - SEG_DAY_START * 60; }
function segMinToTime(min) {
    min = Math.max(0, Math.min(SEG_TOTAL_MIN, min));
    const total = SEG_DAY_START * 60 + min;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function segPct(min) { return (min / SEG_TOTAL_MIN) * 100; }
function segWeekLabel(monday) {
    const sunday = segAddDays(monday, 6);
    return `${monday.getDate()} ${SEG_MOIS[monday.getMonth()]} - ${sunday.getDate()} ${SEG_MOIS[sunday.getMonth()]} ${sunday.getFullYear()}`;
}
function segEl(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}
function segEscapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

// ---------------- Permissions ----------------

function segCanEditColumn(col) {
    if (window.USER_ROLE === 'admin' || window.USER_ROLE === 'editor') return true;
    if (window.USER_ROLE === 'user') {
        if (col.type === 'shared') return true;
        return !!col.isMe;
    }
    return false; // viewer
}
function segIsLocked(ev) {
    return !!ev.uneditable && window.USER_ROLE !== 'admin';
}

// ---------------- Data loading ----------------

async function segLoadUsers() {
    const res = await fetch('/api/all-users');
    segUsers = await res.json();
    segColumns = [{ type: 'shared', id: null, label: 'Partage' }].concat(
        segUsers.map(u => ({ type: 'user', id: u.id, label: u.username, isMe: u.id === window.CURRENT_USER_ID, role: u.role }))
    );
}

async function segLoadCategories() {
    const res = await fetch('/api/categories');
    segCategories = await res.json();
    const select = document.getElementById('seg-category');
    if (select) {
        const current = select.value;
        select.innerHTML = '<option value="">Aucune</option>' +
            segCategories.map(c => `<option value="${c.id}" data-color="${c.couleur}">${segEscapeHtml(c.nom)}</option>`).join('');
        select.value = current;
    }
}

async function segLoadWeek() {
    document.getElementById('seg-week-label').textContent = segWeekLabel(segMonday);
    const start = segFmtDate(segMonday);
    const end = segFmtDate(segAddDays(segMonday, 6));
    const res = await fetch(`/api/rdv?start=${start}&end=${end}&scope=all`);
    segEvents = await res.json();
    segRenderGrid();
}

// ---------------- Rendering ----------------

function segRenderGrid() {
    const hoursBody = document.getElementById('seg-hours-body');
    const daysWrap = document.getElementById('seg-days');
    hoursBody.innerHTML = '';
    daysWrap.innerHTML = '';

    for (let h = SEG_DAY_START; h <= SEG_DAY_END; h++) {
        const lbl = segEl('div', 'tt-hour-label', `${h}h`);
        lbl.style.top = segPct((h - SEG_DAY_START) * 60) + '%';
        hoursBody.appendChild(lbl);
    }

    const today = new Date();

    for (let i = 0; i < 7; i++) {
        const d = segAddDays(segMonday, i);
        const dateStr = segFmtDate(d);
        const isToday = segIsSameDay(d, today);

        const col = segEl('div', 'seg-day-col');
        const header = segEl('div', 'seg-day-header' + (isToday ? ' today' : ''));
        header.innerHTML = `${SEG_JOURS[i]}<small>${d.getDate()}/${d.getMonth() + 1}</small>`;
        col.appendChild(header);

        const subcols = segEl('div', 'seg-subcols');

        segColumns.forEach(column => {
            const sub = segEl('div', 'seg-subcol');
            const head = segEl('div', 'seg-subcol-header' + (column.type === 'shared' ? ' shared' : (column.isMe ? ' me' : '')), column.label);
            sub.appendChild(head);

            const body = segEl('div', 'seg-subcol-body');
            body.dataset.date = dateStr;

            for (let h = SEG_DAY_START; h <= SEG_DAY_END; h++) {
                const line = segEl('div', 'seg-gridline');
                line.style.top = segPct((h - SEG_DAY_START) * 60) + '%';
                body.appendChild(line);
            }

            const dayEvents = segEvents.filter(e => {
                const matchesColumn = column.type === 'shared' ? e.owner_id == null : e.owner_id === column.id;
                return matchesColumn && e.date <= dateStr && (e.date_fin || e.date) >= dateStr;
            });

            dayEvents.forEach(ev => segRenderBlock(body, ev, column, dateStr));

            segAttachSelection(body, column);
            sub.appendChild(body);
            subcols.appendChild(sub);
        });

        col.appendChild(subcols);
        daysWrap.appendChild(col);
    }
}

function segRenderBlock(body, ev, column, dateStr) {
    const color = ev.couleur || SEG_DEFAULT_COLOR;
    const isStartDay = ev.date === dateStr;
    const isEndDay = (ev.date_fin || ev.date) === dateStr;

    if (ev.is_balisage) {
        const top = segPct(Math.max(0, segTimeToMin(ev.heure_debut)));
        const bottom = segPct(Math.min(SEG_TOTAL_MIN, segTimeToMin(ev.heure_fin)));
        const block = segEl('div', 'seg-balisage');
        block.style.top = top + '%';
        block.style.height = Math.max(2.5, bottom - top) + '%';
        block.style.borderColor = color;
        const r = parseInt(color.slice(1, 3), 16) || 0, g = parseInt(color.slice(3, 5), 16) || 0, b = parseInt(color.slice(5, 7), 16) || 0;
        block.style.background = `repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(${r}, ${g}, ${b}, 0.15) 8px, rgba(${r}, ${g}, ${b}, 0.15) 16px)`;
        body.appendChild(block);
        return;
    }

    const segStartMin = isStartDay ? Math.max(0, segTimeToMin(ev.heure_debut)) : 0;
    const segEndMin = isEndDay ? Math.min(SEG_TOTAL_MIN, segTimeToMin(ev.heure_fin)) : SEG_TOTAL_MIN;
    const top = segPct(segStartMin);
    const bottom = segPct(Math.max(segStartMin + 1, segEndMin));

    const editable = segCanEditColumn(column) && !segIsLocked(ev);
    const block = segEl('div', 'seg-block' + (editable ? ' editable' : ' readonly'));
    block.style.top = top + '%';
    block.style.height = Math.max(2.2, bottom - top) + '%';
    block.style.background = color;
    block.innerHTML = `<span class="seg-block-title">${ev.uneditable ? '🔒 ' : ''}${segEscapeHtml(ev.titre)}</span><span class="seg-block-time">${ev.heure_debut} - ${ev.heure_fin}</span>`;
    block.addEventListener('mousedown', (e) => e.stopPropagation());
    block.addEventListener('click', (e) => {
        e.stopPropagation();
        segOpenModal(ev, column);
    });
    body.appendChild(block);
}

// ---------------- Click / drag to create ----------------

function segAttachSelection(body, column) {
    if (!segCanEditColumn(column)) return;

    let selecting = false;
    let startMin = 0;
    let selEl = null;

    function minFromEvent(e) {
        const rect = body.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        return Math.round((ratio * SEG_TOTAL_MIN) / SEG_SNAP_MIN) * SEG_SNAP_MIN;
    }

    function updateSelection(a, b) {
        if (selEl) selEl.remove();
        const top = Math.min(a, b), bottom = Math.max(a, b);
        selEl = segEl('div', 'seg-selection');
        selEl.style.top = segPct(top) + '%';
        selEl.style.height = Math.max(0, segPct(bottom) - segPct(top)) + '%';
        body.appendChild(selEl);
    }

    body.addEventListener('mousedown', (e) => {
        if (e.target !== body) return;
        selecting = true;
        segIsInteracting = true;
        startMin = minFromEvent(e);
        updateSelection(startMin, startMin + 30);
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!selecting) return;
        updateSelection(startMin, minFromEvent(e));
    });

    document.addEventListener('mouseup', (e) => {
        if (!selecting) return;
        selecting = false;
        segIsInteracting = false;
        let curMin = minFromEvent(e);
        let top = Math.min(startMin, curMin), bottom = Math.max(startMin, curMin);
        if (bottom - top < SEG_SNAP_MIN) bottom = Math.min(SEG_TOTAL_MIN, top + 30);
        if (selEl) { selEl.remove(); selEl = null; }
        segOpenModal(null, column, body.dataset.date, segMinToTime(top), segMinToTime(bottom));
    });
}

// ---------------- Modal ----------------

const segOverlay = document.getElementById('seg-modal-overlay');
const segForm = document.getElementById('seg-form');
let segCurrentColumn = null;

function segOpenModal(ev, column, presetDate, presetStart, presetEnd) {
    segCurrentColumn = column;
    document.getElementById('seg-error').textContent = '';
    const readonly = !segCanEditColumn(column) || (ev && segIsLocked(ev));
    const deleteBtn = document.getElementById('seg-delete');
    const saveBtn = document.getElementById('seg-save');

    document.getElementById('seg-owner-label').textContent = column.type === 'shared'
        ? 'Evenement partage (visible et modifiable par tous)'
        : `Evenement personnel de ${column.label}`;

    if (ev) {
        document.getElementById('seg-modal-title').textContent = ev.is_balisage ? 'Balisage (Hachures)' : 'Evenement';
        document.getElementById('seg-id').value = ev.id;
        document.getElementById('seg-date').value = ev.date;
        document.getElementById('seg-start').value = ev.heure_debut;
        document.getElementById('seg-end').value = ev.heure_fin;
        document.getElementById('seg-titre').value = ev.titre;
        document.getElementById('seg-desc').value = ev.description || '';
        document.getElementById('seg-color').value = ev.couleur || SEG_DEFAULT_COLOR;
        document.getElementById('seg-category').value = ev.category_id || '';
        document.getElementById('seg-meta').textContent = ev.auteur ? `Cree par ${ev.auteur} le ${ev.created_at}` : '';
        deleteBtn.classList.toggle('hidden', readonly);
    } else {
        document.getElementById('seg-modal-title').textContent = 'Nouvel evenement';
        document.getElementById('seg-id').value = '';
        document.getElementById('seg-date').value = presetDate;
        document.getElementById('seg-start').value = presetStart || '09:00';
        document.getElementById('seg-end').value = presetEnd || '09:30';
        document.getElementById('seg-titre').value = '';
        document.getElementById('seg-desc').value = '';
        document.getElementById('seg-color').value = SEG_DEFAULT_COLOR;
        document.getElementById('seg-category').value = '';
        document.getElementById('seg-meta').textContent = '';
        deleteBtn.classList.add('hidden');
    }

    const adminBlock = document.getElementById('seg-admin-options');
    if (window.USER_ROLE === 'admin') {
        adminBlock.classList.remove('hidden');
        document.getElementById('seg-uneditable').checked = ev ? !!ev.uneditable : false;
        document.getElementById('seg-is-balisage').checked = ev ? !!ev.is_balisage : false;
    } else {
        adminBlock.classList.add('hidden');
    }

    [...segForm.elements].forEach(f => f.disabled = readonly);
    saveBtn.classList.toggle('hidden', readonly);

    segOverlay.classList.remove('hidden');
}

function segCloseModal() {
    segOverlay.classList.add('hidden');
    segCurrentColumn = null;
}

document.getElementById('seg-modal-close').addEventListener('click', segCloseModal);
document.getElementById('seg-cancel').addEventListener('click', segCloseModal);
segOverlay.addEventListener('mousedown', (e) => { if (e.target === segOverlay) segCloseModal(); });

document.getElementById('seg-category').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    const color = opt && opt.dataset.color;
    if (color) document.getElementById('seg-color').value = color;
});

segForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!segCurrentColumn) return;
    const id = document.getElementById('seg-id').value;
    const categoryVal = document.getElementById('seg-category').value;
    const payload = {
        date: document.getElementById('seg-date').value,
        heure_debut: document.getElementById('seg-start').value,
        heure_fin: document.getElementById('seg-end').value,
        titre: document.getElementById('seg-titre').value.trim() || 'Sans titre',
        description: document.getElementById('seg-desc').value,
        couleur: document.getElementById('seg-color').value,
        category_id: categoryVal ? parseInt(categoryVal, 10) : null,
        owner_id: segCurrentColumn.type === 'shared' ? null : segCurrentColumn.id,
    };
    if (window.USER_ROLE === 'admin') {
        payload.uneditable = document.getElementById('seg-uneditable').checked ? 1 : 0;
        payload.is_balisage = document.getElementById('seg-is-balisage').checked ? 1 : 0;
    }

    const url = id ? `/api/rdv/${id}` : '/api/rdv';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
        document.getElementById('seg-error').textContent = data.error || 'Erreur';
        return;
    }
    segCloseModal();
    segLoadWeek();
});

document.getElementById('seg-delete').addEventListener('click', async () => {
    const id = document.getElementById('seg-id').value;
    if (!id || !confirm('Supprimer cet evenement ?')) return;
    await fetch(`/api/rdv/${id}`, { method: 'DELETE' });
    segCloseModal();
    segLoadWeek();
});

// ---------------- Week navigation ----------------

document.getElementById('seg-prev-week').addEventListener('click', () => { segMonday = segAddDays(segMonday, -7); segLoadWeek(); });
document.getElementById('seg-next-week').addEventListener('click', () => { segMonday = segAddDays(segMonday, 7); segLoadWeek(); });
document.getElementById('seg-today-btn').addEventListener('click', () => { segMonday = segMondayOf(new Date()); segLoadWeek(); });

// ---------------- Realtime refresh ----------------

setInterval(() => {
    if (!segIsInteracting && segOverlay.classList.contains('hidden')) {
        segLoadWeek();
    }
}, SEG_REFRESH_MS);

// ---------------- Init ----------------

(async function segInit() {
    await segLoadUsers();
    await segLoadCategories();
    await segLoadWeek();
})();
