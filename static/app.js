const DAY_START = 7;    // 07:00
const DAY_END = 23;     // 21:00
const TOTAL_MIN = (DAY_END - DAY_START) * 60;
const DEFAULT_COLOR = '#2e5c8a';
const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MOIS = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
const SNAP_MIN = 15;
const REFRESH_MS = 1000; // TODO passer en websockets
const NOTES_SAVE_DEBOUNCE_MS = 800;

let currentMonday = mondayOf(new Date());
let categories = [];
let isDragging = false;
let isPanelEditing = false; // true while the rdv form (create/edit) is shown in the side panel
let activeSelectionEl = null; // Stocke l'élément HTML de la sélection en cours

function mondayOf(d) {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
}

// Supprime proprement la sélection visuelle du calendrier
function clearActiveSelection() {
    if (activeSelectionEl) {
        activeSelectionEl.remove();
        activeSelectionEl = null;
    }
}

function fmtDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isSameDay(a, b) { return fmtDate(a) === fmtDate(b); }

function timeToMin(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m - DAY_START * 60;
}
function minToTime(min) {
    min = Math.max(0, Math.min(TOTAL_MIN, min));
    const total = DAY_START * 60 + min;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function pct(min) { return (min / TOTAL_MIN) * 100; }

function weekLabel(monday) {
    const sunday = addDays(monday, 6);
    return `${monday.getDate()} ${MOIS[monday.getMonth()]} - ${sunday.getDate()} ${MOIS[sunday.getMonth()]} ${sunday.getFullYear()}`;
}

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}
function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

// ---------------- Private notes (right panel, default view) ----------------

let notesSaveTimer = null;

async function loadNotes() {
    const textarea = document.getElementById('notes-textarea');
    if (!textarea) return;
    try {
        const res = await fetch('/api/notes');
        const data = await res.json();
        textarea.value = data.content || '';
    } catch (err) {
        // silencieux
    }
}

function scheduleNotesSave() {
    const status = document.getElementById('notes-status');
    if (status) status.textContent = 'Modification en cours...';
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(saveNotesNow, NOTES_SAVE_DEBOUNCE_MS);
}

async function saveNotesNow() {
    const textarea = document.getElementById('notes-textarea');
    const status = document.getElementById('notes-status');
    if (!textarea) return;
    try {
        await fetch('/api/notes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: textarea.value }),
        });
        if (status) {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            status.textContent = `Enregistre a ${hh}:${mm}`;
        }
    } catch (err) {
        if (status) status.textContent = "Erreur lors de l'enregistrement";
    }
}

if (document.getElementById('notes-textarea')) {
    document.getElementById('notes-textarea').addEventListener('input', scheduleNotesSave);
    document.getElementById('notes-textarea').addEventListener('blur', () => {
        clearTimeout(notesSaveTimer);
        saveNotesNow();
    });
}

// ---------------- Categories ----------------

async function loadCategories() {
    const res = await fetch('/api/categories');
    categories = await res.json();
    const select = document.getElementById('rdv-category');
    if (select) {
        const current = select.value;
        select.innerHTML = '<option value="">Aucune</option>' +
            categories.map(c => `<option value="${c.id}" data-color="${c.couleur}">${escapeHtml(c.nom)}</option>`).join('');
        select.value = current;
    }
}

// ---------------- Calendar ----------------

async function loadWeek() {
    clearActiveSelection();
    document.getElementById('week-label').textContent = weekLabel(currentMonday);
    const start = fmtDate(currentMonday);
    const end = fmtDate(addDays(currentMonday, 6));
    const res = await fetch(`/api/rdv?start=${start}&end=${end}`);
    const events = await res.json();
    renderGrid(events);
}

function renderGrid(events) {
    const hoursBody = document.getElementById('tt-hours-body');
    const daysWrap = document.getElementById('tt-days');
    hoursBody.innerHTML = '';
    daysWrap.innerHTML = '';

    for (let h = DAY_START; h <= DAY_END; h++) {
        const lbl = el('div', 'tt-hour-label', `${h}h`);
        lbl.style.top = pct((h - DAY_START) * 60) + '%';
        hoursBody.appendChild(lbl);
    }

    const today = new Date();

    for (let i = 0; i < 7; i++) {
        const d = addDays(currentMonday, i);
        const dateStr = fmtDate(d);
        const isToday = isSameDay(d, today);

        const col = el('div', 'tt-day-col');
        const header = el('div', 'tt-day-header' + (isToday ? ' today' : ''));
        header.innerHTML = `${JOURS[i]}<small>${d.getDate()}/${d.getMonth() + 1}</small>`;
        col.appendChild(header);

        const body = el('div', 'tt-day-body' + (isToday ? ' today-col' : ''));
        body.dataset.date = dateStr;

        for (let h = DAY_START; h <= DAY_END; h++) {
            const line = el('div', 'tt-gridline');
            line.style.top = pct((h - DAY_START) * 60) + '%';
            body.appendChild(line);
        }

        const dayEvents = events.filter(e => e.date === dateStr);
        if (dayEvents.length === 0) {
            body.appendChild(el('div', 'tt-empty-day', 'Libre'));
        }
        dayEvents.forEach(ev => {
            const top = pct(Math.max(0, timeToMin(ev.heure_debut)));
            const bottom = pct(Math.min(TOTAL_MIN, timeToMin(ev.heure_fin)));
            const color = ev.couleur || DEFAULT_COLOR;

            // Rendu sous forme de balisage (Hachures)
            if (ev.is_balisage) {
                const block = el('div', 'tt-balisage');
                block.style.top = top + '%';
                block.style.height = Math.max(2.5, bottom - top) + '%';
                block.style.borderColor = color;
                block.style.color = color;
                
                // Calcul de la couleur RGB pour le background semi-transparent
                const r = parseInt(color.slice(1, 3), 16) || 0;
                const g = parseInt(color.slice(3, 5), 16) || 0;
                const b = parseInt(color.slice(5, 7), 16) || 0;
                block.style.background = `repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(${r}, ${g}, ${b}, 0.15) 10px, rgba(${r}, ${g}, ${b}, 0.15) 20px)`;
                
                // Petit bouton d'édition réservé à l'Admin avec pointer-events restaurés
                if (window.USER_ROLE === 'admin') {
                    const editBtn = el('button');
                    editBtn.innerHTML = '✏️';
                    editBtn.style.position = 'absolute';
                    editBtn.style.top = '2px';
                    editBtn.style.right = '2px';
                    editBtn.style.zIndex = '12';
                    editBtn.style.background = 'white';
                    editBtn.style.border = '1px solid var(--border)';
                    editBtn.style.borderRadius = '3px';
                    editBtn.style.cursor = 'pointer';
                    editBtn.style.fontSize = '10px';
                    editBtn.style.padding = '1px 3px';
                    editBtn.style.pointerEvents = 'auto'; // Re-permet le clic
                    editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openRdvPanel(ev);
                    });
                    block.appendChild(editBtn);
                }
                body.appendChild(block);
                return;
            }

            // Gestion de l'interdiction d'édition pour les Editeurs
            const isUneditableForEditor = ev.uneditable && window.USER_ROLE === 'editor';
            const canUserEditThisBlock = window.CAN_EDIT && !isUneditableForEditor;

            const block = el('div', 'tt-block' + (canUserEditThisBlock ? ' editable' : ''));
            block.style.top = top + '%';
            block.style.height = Math.max(2.5, bottom - top) + '%';
            block.style.background = color;

            const contentHtml = `
                ${ev.categorie_nom ? `<span class="tt-block-category">${escapeHtml(ev.categorie_nom)}</span>` : ''}
                <span class="tt-block-subject">${escapeHtml(ev.titre)} ${ev.uneditable ? '🔒' : ''}</span>
                <span class="tt-block-time">${ev.heure_debut} - ${ev.heure_fin}</span>`;

            if (canUserEditThisBlock) {
                block.innerHTML = `<div class="tt-resize-handle tt-resize-top"></div>${contentHtml}<div class="tt-resize-handle tt-resize-bottom"></div>`;
                attachBlockDrag(block, ev);
            } else {
                block.innerHTML = contentHtml;
                block.addEventListener('mousedown', (e) => e.stopPropagation());
                block.addEventListener('click', (e) => { e.stopPropagation(); openRdvPanel(ev); });
            }
            body.appendChild(block);
        });

        if (window.CAN_EDIT) {
            enableDragSelect(body);
        }

        col.appendChild(body);
        daysWrap.appendChild(col);
    }

    // MISE A JOUR DE LA LEGENDE DES BALISAGES
    const balisages = events.filter(e => e.is_balisage);
    const legendContainer = document.getElementById('balisage-legend');
    const legendList = document.getElementById('legend-list');
    if (legendContainer && legendList) {
        if (balisages.length > 0) {
            legendContainer.classList.remove('hidden');
            legendList.innerHTML = '';
            const seen = new Set();
            balisages.forEach(b => {
                const key = `${b.titre}_${b.couleur}`;
                if (seen.has(key)) return;
                seen.add(key);

                const item = el('div');
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.gap = '6px';

                const colorBox = el('span');
                colorBox.style.display = 'inline-block';
                colorBox.style.width = '16px';
                colorBox.style.height = '16px';
                colorBox.style.borderRadius = '3px';
                colorBox.style.background = `repeating-linear-gradient(45deg, transparent, transparent 3px, ${b.couleur} 3px, ${b.couleur} 6px)`;
                colorBox.style.border = '1px solid var(--border)';

                const titleSpan = el('span', '', b.titre);
                titleSpan.style.fontWeight = '600';

                item.appendChild(colorBox);
                item.appendChild(titleSpan);

                // Option rapide de modification dans la légende si Admin
                if (window.USER_ROLE === 'admin') {
                    const editBtn = el('button', 'btn-link-small', ' (Modifier)');
                    editBtn.style.marginTop = '0';
                    editBtn.style.fontSize = '0.75rem';
                    editBtn.style.paddingLeft = '5px';
                    editBtn.addEventListener('click', () => {
                        openRdvPanel(b);
                    });
                    item.appendChild(editBtn);
                }

                legendList.appendChild(item);
            });
        } else {
            legendContainer.classList.add('hidden');
        }
    }
}

// ---------------- Drag-to-select creation ----------------

function enableDragSelect(body) {
    let dragging = false;
    let startMin = 0;

    function minFromEvent(e) {
        const rect = body.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        const rawMin = ratio * TOTAL_MIN;
        return Math.round(rawMin / SNAP_MIN) * SNAP_MIN;
    }

    body.addEventListener('mousedown', (e) => {
        if (e.target !== body && !e.target.classList.contains('tt-empty-day')) return;
        
        clearActiveSelection();

        dragging = true;
        isDragging = true;
        startMin = minFromEvent(e);
        
        activeSelectionEl = el('div', 'tt-selection');
        activeSelectionEl.style.top = pct(startMin) + '%';
        activeSelectionEl.style.height = '0%';
        body.appendChild(activeSelectionEl);
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging || !activeSelectionEl) return;
        const curMin = minFromEvent(e);
        const top = Math.min(startMin, curMin);
        const bottom = Math.max(startMin, curMin);
        activeSelectionEl.style.top = pct(top) + '%';
        activeSelectionEl.style.height = pct(bottom - top) + '%';
    });

    document.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        isDragging = false;
        const endMin = minFromEvent(e);
        let top = Math.min(startMin, endMin);
        let bottom = Math.max(startMin, endMin);

        if (bottom - top < SNAP_MIN) {
            bottom = Math.min(TOTAL_MIN, top + 30);
            if (activeSelectionEl) {
                activeSelectionEl.style.top = pct(top) + '%';
                activeSelectionEl.style.height = pct(bottom - top) + '%';
            }
        }
        openRdvPanel(null, body.dataset.date, minToTime(top), minToTime(bottom));
    });
}

// ---------------- Drag to resize / move an existing RDV ----------------

function attachBlockDrag(block, ev) {
    let mode = null; 
    let startX, startY, startTopMin, startBottomMin, moved, currentDateStr;

    function onDown(e) {
        e.stopPropagation();
        if (e.target.classList.contains('tt-resize-top')) mode = 'resize-top';
        else if (e.target.classList.contains('tt-resize-bottom')) mode = 'resize-bottom';
        else mode = 'move';

        startX = e.clientX;
        startY = e.clientY;
        startTopMin = timeToMin(ev.heure_debut);
        startBottomMin = timeToMin(ev.heure_fin);
        moved = false;
        currentDateStr = ev.date;
        block._pendingStart = startTopMin;
        block._pendingEnd = startBottomMin;
        block._pendingDate = currentDateStr;

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    }

    function dayBodyAtPoint(x, y) {
        const prevPE = block.style.pointerEvents;
        block.style.pointerEvents = 'none';
        const elAt = document.elementFromPoint(x, y);
        block.style.pointerEvents = prevPE;
        const found = elAt ? elAt.closest('.tt-day-body') : null;
        return found || block.closest('.tt-day-body');
    }

    function onMove(e) {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            moved = true;
            isDragging = true;
            block.classList.add('dragging');
        }
        if (!moved) return;

        const targetBody = dayBodyAtPoint(e.clientX, e.clientY);
        const bodyRect = targetBody.getBoundingClientRect();
        const minPerPx = TOTAL_MIN / bodyRect.height;
        const deltaMin = Math.round((dy * minPerPx) / SNAP_MIN) * SNAP_MIN;

        if (mode === 'resize-top') {
            const newTop = Math.min(startBottomMin - SNAP_MIN, Math.max(0, startTopMin + deltaMin));
            block.style.top = pct(newTop) + '%';
            block.style.height = Math.max(2.5, pct(startBottomMin) - pct(newTop)) + '%';
            block._pendingStart = newTop;
            block._pendingEnd = startBottomMin;
        } else if (mode === 'resize-bottom') {
            const newBottom = Math.max(startTopMin + SNAP_MIN, Math.min(TOTAL_MIN, startBottomMin + deltaMin));
            block.style.height = Math.max(2.5, pct(newBottom) - pct(startTopMin)) + '%';
            block._pendingStart = startTopMin;
            block._pendingEnd = newBottom;
        } else {
            const duration = startBottomMin - startTopMin;
            const newTop = Math.max(0, Math.min(TOTAL_MIN - duration, startTopMin + deltaMin));
            block.style.top = pct(newTop) + '%';
            block._pendingStart = newTop;
            block._pendingEnd = newTop + duration;
            block._pendingDate = targetBody.dataset.date;
            if (targetBody !== block.parentElement) {
                targetBody.appendChild(block);
            }
        }
    }

    async function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        block.classList.remove('dragging');

        if (!moved) {
            mode = null;
            isDragging = false;
            openRdvPanel(ev);
            return;
        }

        const newStart = minToTime(block._pendingStart);
        const newEnd = minToTime(block._pendingEnd);
        const newDate = block._pendingDate || currentDateStr;
        try {
            const res = await fetch(`/api/rdv/${ev.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: newDate, heure_debut: newStart, heure_fin: newEnd }),
            });
            if (!res.ok) {
                const data = await res.json();
                alert(data.error || 'Erreur lors du deplacement');
            }
        } catch (err) {
            alert('Erreur reseau lors du deplacement');
        }
        mode = null;
        isDragging = false;
        loadWeek();
    }

    block.addEventListener('mousedown', onDown);
}

// ---------------- Side panel: notes <-> rdv form ----------------

const panelNotes = document.getElementById('panel-notes');
const panelRdv = document.getElementById('panel-rdv');
const form = document.getElementById('rdv-form');

function showNotesPanel() {
    isPanelEditing = false;
    if (panelRdv) panelRdv.classList.add('hidden');
    if (panelNotes) panelNotes.classList.remove('hidden');
}

function showRdvPanel() {
    isPanelEditing = true;
    if (panelNotes) panelNotes.classList.add('hidden');
    if (panelRdv) panelRdv.classList.remove('hidden');
}

function openRdvPanel(ev, presetDate, presetStart, presetEnd) {
    document.getElementById('modal-error').textContent = '';
    document.getElementById('new-category-box').classList.add('hidden');
    const deleteBtn = document.getElementById('rdv-delete');
    const saveBtn = document.getElementById('rdv-save');

    // Vérifie si l'éditeur tente d'ouvrir un élément bloqué
    const isUneditableForEditor = ev && ev.uneditable && window.USER_ROLE === 'editor';
    const readonly = !window.CAN_EDIT || isUneditableForEditor;

    const recurBlock = document.getElementById('rdv-recur-block');
    const recurCheck = document.getElementById('rdv-recur-check');
    const recurOptions = document.getElementById('rdv-recur-options');

    if (ev) {
        clearActiveSelection(); 
        document.getElementById('panel-rdv-title').textContent = ev.is_balisage ? 'Balisage (Hachures)' : 'Rendez-vous';
        document.getElementById('rdv-id').value = ev.id;
        document.getElementById('rdv-date').value = ev.date;
        document.getElementById('rdv-start').value = ev.heure_debut;
        document.getElementById('rdv-end').value = ev.heure_fin;
        document.getElementById('rdv-titre').value = ev.titre;
        document.getElementById('rdv-desc').value = ev.description || '';
        document.getElementById('rdv-color').value = ev.couleur || DEFAULT_COLOR;
        document.getElementById('rdv-category').value = ev.category_id || '';
        document.getElementById('rdv-meta').textContent = ev.auteur ? `Cree par ${ev.auteur} le ${ev.created_at}` : '';
        deleteBtn.classList.toggle('hidden', readonly);
        recurBlock.classList.add('hidden');
        recurCheck.checked = false;
        recurOptions.classList.add('hidden');
    } else {
        document.getElementById('panel-rdv-title').textContent = 'Nouveau rendez-vous';
        document.getElementById('rdv-id').value = '';
        document.getElementById('rdv-date').value = presetDate || fmtDate(new Date());
        document.getElementById('rdv-start').value = presetStart || '09:00';
        document.getElementById('rdv-end').value = presetEnd || '09:30';
        document.getElementById('rdv-titre').value = '';
        document.getElementById('rdv-desc').value = '';
        document.getElementById('rdv-color').value = DEFAULT_COLOR;
        document.getElementById('rdv-category').value = '';
        document.getElementById('rdv-meta').textContent = '';
        deleteBtn.classList.add('hidden');
        recurBlock.classList.toggle('hidden', readonly);
        recurCheck.checked = false;
        recurOptions.classList.add('hidden');
    }

    // Affiche et gère les checkboxes admin de verrouillage et hachures
    const adminBlock = document.getElementById('admin-options-block');
    if (adminBlock) {
        if (window.USER_ROLE === 'admin') {
            adminBlock.classList.remove('hidden');
            document.getElementById('rdv-uneditable').checked = ev ? !!ev.uneditable : false;
            document.getElementById('rdv-is-balisage').checked = ev ? !!ev.is_balisage : false;
        } else {
            adminBlock.classList.add('hidden');
        }
    }

    [...form.elements].forEach(f => f.disabled = readonly);
    saveBtn.classList.toggle('hidden', readonly);
    document.getElementById('new-category-toggle').classList.toggle('hidden', readonly);

    showRdvPanel();
}

function closeRdvPanel() {
    showNotesPanel();
    clearActiveSelection(); 
}

document.getElementById('panel-rdv-close').addEventListener('click', closeRdvPanel);
document.getElementById('rdv-cancel').addEventListener('click', closeRdvPanel);

document.getElementById('rdv-recur-check').addEventListener('change', (e) => {
    document.getElementById('rdv-recur-options').classList.toggle('hidden', !e.target.checked);
});

document.getElementById('rdv-category').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    const color = opt && opt.dataset.color;
    if (color) document.getElementById('rdv-color').value = color;
});

const newCatBox = document.getElementById('new-category-box');
document.getElementById('new-category-toggle').addEventListener('click', () => {
    newCatBox.classList.toggle('hidden');
});
document.getElementById('new-category-cancel').addEventListener('click', () => {
    newCatBox.classList.add('hidden');
});
document.getElementById('new-category-save').addEventListener('click', async () => {
    const nom = document.getElementById('new-category-name').value.trim();
    const couleur = document.getElementById('new-category-color').value;
    if (!nom) return;
    const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom, couleur }),
    });
    const data = await res.json();
    if (!res.ok) {
        document.getElementById('modal-error').textContent = data.error || 'Erreur';
        return;
    }
    await loadCategories();
    document.getElementById('rdv-category').value = data.id;
    document.getElementById('rdv-color').value = couleur;
    document.getElementById('new-category-name').value = '';
    newCatBox.classList.add('hidden');
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('rdv-id').value;
    const categoryVal = document.getElementById('rdv-category').value;
    const payload = {
        date: document.getElementById('rdv-date').value,
        heure_debut: document.getElementById('rdv-start').value,
        heure_fin: document.getElementById('rdv-end').value,
        titre: document.getElementById('rdv-titre').value.trim() || 'Sans titre', 
        description: document.getElementById('rdv-desc').value,
        couleur: document.getElementById('rdv-color').value,
        category_id: categoryVal ? parseInt(categoryVal, 10) : null,
    };

    if (window.USER_ROLE === 'admin') {
        payload.uneditable = document.getElementById('rdv-uneditable').checked ? 1 : 0;
        payload.is_balisage = document.getElementById('rdv-is-balisage').checked ? 1 : 0;
    }

    if (!id && document.getElementById('rdv-recur-check').checked) {
        payload.recurrence = document.getElementById('rdv-recur-freq').value;
        payload.recurrence_count = parseInt(document.getElementById('rdv-recur-count').value, 10) || 1;
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
        document.getElementById('modal-error').textContent = data.error || 'Erreur';
        return;
    }
    closeRdvPanel();
    loadWeek();
});

document.getElementById('rdv-delete').addEventListener('click', async () => {
    const id = document.getElementById('rdv-id').value;
    if (!id || !confirm('Supprimer ce rendez-vous ?')) return;
    await fetch(`/api/rdv/${id}`, { method: 'DELETE' });
    closeRdvPanel();
    loadWeek();
});

if (document.getElementById('add-rdv-btn')) {
    document.getElementById('add-rdv-btn').addEventListener('click', () => openRdvPanel(null));
}

// ---------------- Week navigation ----------------

document.getElementById('prev-week').addEventListener('click', () => { currentMonday = addDays(currentMonday, -7); loadWeek(); });
document.getElementById('next-week').addEventListener('click', () => { currentMonday = addDays(currentMonday, 7); loadWeek(); });
document.getElementById('today-btn').addEventListener('click', () => { currentMonday = mondayOf(new Date()); loadWeek(); });

// ---------------- Realtime refresh ----------------

setInterval(() => {
    if (!isPanelEditing && !isDragging) {
        loadWeek();
        loadCategories();
    }
}, REFRESH_MS);

// Retrait de la restriction "required" sur le titre
const titreInput = document.getElementById('rdv-titre');
if (titreInput) {
    titreInput.removeAttribute('required');
}

loadCategories();
loadWeek();
loadNotes();