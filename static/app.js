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
let activeSelectionEls = []; // Elements HTML de la selection en cours (peut couvrir plusieurs jours)
let lastLoadedEvents = []; // Derniers evenements charges pour la semaine (nav clavier, collage)
let selectedEvent = null; // RDV actuellement selectionne (clic, ou navigation clavier)
let clipboardRdv = null; // RDV copie (Ctrl+C)
let pasteTargetDate = null; // Date du dernier endroit clique (cible de collage)
let pasteTargetMin = null; // Minute (depuis DAY_START) du dernier endroit clique

function mondayOf(d) {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
}

// Supprime proprement la sélection visuelle du calendrier
function clearActiveSelection() {
    activeSelectionEls.forEach(el => el.remove());
    activeSelectionEls = [];
}

// Selectionne visuellement un rdv (clic ou navigation clavier)
function selectEvent(ev, block) {
    selectedEvent = ev;
    document.querySelectorAll('.tt-block.selected').forEach(b => b.classList.remove('selected'));
    if (block) block.classList.add('selected');
}

function highlightSelectedById(id) {
    document.querySelectorAll('.tt-block.selected').forEach(b => b.classList.remove('selected'));
    const block = document.querySelector(`.tt-block[data-id="${id}"]`);
    if (block) {
        block.classList.add('selected');
        block.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    lastLoadedEvents = events;
    renderGrid(events);
    if (selectedEvent) highlightSelectedById(selectedEvent.id);
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

        // Un evenement occupe chaque jour compris entre sa date de debut et sa
        // date de fin (evenement multi-jours = un seul objet, affiche sur plusieurs colonnes).
        const dayEvents = events.filter(e => e.date <= dateStr && (e.date_fin || e.date) >= dateStr);
        if (dayEvents.length === 0) {
            body.appendChild(el('div', 'tt-empty-day', 'Libre'));
        }
        dayEvents.forEach(ev => {
            const color = ev.couleur || DEFAULT_COLOR;
            const isMultiDay = !!(ev.date_fin && ev.date_fin !== ev.date);
            const isStartDay = ev.date === dateStr;
            const isEndDay = (ev.date_fin || ev.date) === dateStr;

            // Rendu sous forme de balisage (Hachures)
            if (ev.is_balisage) {
                const top = pct(Math.max(0, timeToMin(ev.heure_debut)));
                const bottom = pct(Math.min(TOTAL_MIN, timeToMin(ev.heure_fin)));
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
            // Un evenement multi-jours est un objet unique : on ne permet pas de le
            // glisser/redimensionner depuis une case journaliere (il faut passer par le
            // panneau lateral). Seul le clic pour ouvrir le panneau reste disponible.
            const canDragThisBlock = canUserEditThisBlock && !isMultiDay;

            // Plage continue : l'evenement occupe TOUT le jour visible (07h-23h) sur
            // les jours intermediaires, seulement le debut sur son jour de depart et
            // seulement la fin sur son jour d'arrivee (ex: 07/07 14h00 -> 08/07 15h00).
            const segStartMin = isStartDay ? Math.max(0, timeToMin(ev.heure_debut)) : 0;
            const segEndMin = isEndDay ? Math.min(TOTAL_MIN, timeToMin(ev.heure_fin)) : TOTAL_MIN;
            const top = pct(segStartMin);
            const bottom = pct(Math.max(segStartMin + 1, segEndMin));

            const block = el('div', 'tt-block' + (canDragThisBlock ? ' editable' : '') +
                (isMultiDay && !isStartDay ? ' tt-block-cont-before' : '') +
                (isMultiDay && !isEndDay ? ' tt-block-cont-after' : ''));
            block.dataset.id = ev.id;
            block.style.top = top + '%';
            block.style.height = Math.max(2.5, bottom - top) + '%';
            block.style.background = color;

            const durationMin = segEndMin - segStartMin;
            let descHtml = '';
            if (ev.description && ev.description.trim() && durationMin >= 30) {
                let clamp = 1;
                if (durationMin >= 120) clamp = 6;
                else if (durationMin >= 60) clamp = 3;
                descHtml = `<span class="tt-block-desc" style="-webkit-line-clamp:${clamp};">${escapeHtml(ev.description)}</span>`;
            }

            let timeLabel;
            if (!isMultiDay) {
                timeLabel = `${ev.heure_debut} - ${ev.heure_fin}`;
            } else if (isStartDay && isEndDay) {
                timeLabel = `${ev.heure_debut} - ${ev.heure_fin}`;
            } else if (isStartDay) {
                timeLabel = `${ev.heure_debut} → (suite)`;
            } else if (isEndDay) {
                timeLabel = `(suite) → ${ev.heure_fin}`;
            } else {
                timeLabel = `(suite)`;
            }

            const contentHtml = `
                ${ev.categorie_nom ? `<span class="tt-block-category">${escapeHtml(ev.categorie_nom)}</span>` : ''}
                <span class="tt-block-subject">${escapeHtml(ev.titre)} ${ev.uneditable ? '🔒' : ''} ${isMultiDay ? '↔️' : ''}</span>
                ${descHtml}
                <span class="tt-block-time">${timeLabel}</span>`;

            if (canDragThisBlock) {
                block.innerHTML = `<div class="tt-resize-handle tt-resize-top"></div>${contentHtml}<div class="tt-resize-handle tt-resize-bottom"></div>`;
                attachBlockDrag(block, ev);
            } else {
                block.innerHTML = contentHtml;
                block.addEventListener('mousedown', (e) => e.stopPropagation());
                block.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectEvent(ev, block);
                    pasteTargetDate = ev.date;
                    pasteTargetMin = timeToMin(ev.heure_debut);
                    openRdvPanel(ev);
                });
            }
            body.appendChild(block);
        });

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

// ---------------- Drag-to-select creation (multi-jours) ----------------

function enableMultiDaySelect() {
    if (!window.CAN_EDIT) return;
    const daysWrap = document.getElementById('tt-days');
    if (!daysWrap) return;

    function allBodies() { return [...daysWrap.querySelectorAll('.tt-day-body')]; }
    function bodyAtPoint(x, y) {
        const elAt = document.elementFromPoint(x, y);
        return elAt ? elAt.closest('.tt-day-body') : null;
    }
    function minFromEvent(e, body) {
        const rect = body.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        return Math.round((ratio * TOTAL_MIN) / SNAP_MIN) * SNAP_MIN;
    }

    function orderedRange(startBody, startMin, curBody, curMin) {
        const bodies = allBodies();
        let aIdx = bodies.indexOf(startBody), aMin = startMin;
        let bIdx = bodies.indexOf(curBody), bMin = curMin;
        if (aIdx > bIdx || (aIdx === bIdx && aMin > bMin)) {
            [aIdx, bIdx] = [bIdx, aIdx];
            [aMin, bMin] = [bMin, aMin];
        }
        return { bodies, aIdx, aMin, bIdx, bMin };
    }

    function renderSelection(startBody, startMin, curBody, curMin, e) {
        clearActiveSelection();
        if ( startMin === curMin && e.buttons === 0 ) { curMin += 30 }
        const { bodies, aIdx, aMin, bIdx, bMin } = orderedRange(startBody, startMin, curBody, curMin);        
        for (let i = aIdx; i <= bIdx; i++) {
            let top, bottom;
            if (aIdx === bIdx) { top = aMin; bottom = bMin; }
            else if (i === aIdx) { top = aMin; bottom = TOTAL_MIN; }
            else if (i === bIdx) { top = 0; bottom = bMin; }
            else { top = 0; bottom = TOTAL_MIN; }
            const sel = el('div', 'tt-selection');
            sel.style.top = pct(top) + '%';
            sel.style.height = Math.max(0, pct(bottom) - pct(top)) + '%';
            bodies[i].appendChild(sel);
            activeSelectionEls.push(sel);
        }
    }

    let selecting = false;
    let startBody = null, startMin = 0;

    daysWrap.addEventListener('mousedown', (e) => {
        const body = e.target.closest('.tt-day-body');
        if (!body) return;
        if (e.target !== body && !e.target.classList.contains('tt-empty-day')) return;
        clearActiveSelection();
        selecting = true;
        isDragging = true;
        startBody = body;
        startMin = minFromEvent(e, body);
        renderSelection(startBody, startMin, startBody, startMin, e);
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!selecting) return;
        const body = bodyAtPoint(e.clientX, e.clientY) || startBody;
        const curMin = minFromEvent(e, body);
        renderSelection(startBody, startMin, body, curMin, e);
    });

    document.addEventListener('mouseup', (e) => {
        if (!selecting) return;
        selecting = false;
        isDragging = false;
        const body = bodyAtPoint(e.clientX, e.clientY) || startBody;
        const curMin = minFromEvent(e, body);
        const { bodies, aIdx, aMin, bIdx, bMin } = orderedRange(startBody, startMin, body, curMin);
        let top = aMin, bottom = bMin;
        if (aIdx === bIdx && bottom - top < SNAP_MIN) {
            bottom = Math.min(TOTAL_MIN, top + 30);
        }
        const dateStart = bodies[aIdx].dataset.date;
        const dateEnd = bodies[bIdx].dataset.date;
        // Memorise la position cliquee comme cible de collage (uniquement pour
        // un clic simple sur un seul jour, pas pour une plage multi-jours).
        if (aIdx === bIdx) {
            pasteTargetDate = dateStart;
            pasteTargetMin = top;
        }
        renderSelection(startBody, startMin, body, curMin, e);
        openRdvPanel(null, dateStart, minToTime(top), minToTime(bottom), dateEnd !== dateStart ? dateEnd : null);
    });

    // Clic sur du vide = deselectionne le rdv actif (pour Ctrl+C / fleches)
    daysWrap.addEventListener('click', (e) => {
        if (e.target.classList.contains('tt-day-body') || e.target.classList.contains('tt-empty-day')) {
            selectEvent(null, null);
        }
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
            selectEvent(ev, block);
            pasteTargetDate = ev.date;
            pasteTargetMin = timeToMin(ev.heure_debut);
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

function openRdvPanel(ev, presetDate, presetStart, presetEnd, presetDateFin) {
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
    
    const multidayBlock = document.getElementById('rdv-multiday-block');
    const multidayCheck = document.getElementById('rdv-multiday-check');
    const multidayOptions = document.getElementById('rdv-multiday-options');
    const dateFinInput = document.getElementById('rdv-date-fin');

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

        // Evenement multi-jours : reste editable (rallonger/raccourcir la plage
        // de dates) depuis le panneau, meme si non modifiable par drag sur la grille.
        const evIsMultiDay = !!(ev.date_fin && ev.date_fin !== ev.date);
        multidayBlock.classList.toggle('hidden', readonly);
        multidayCheck.checked = evIsMultiDay;
        multidayCheck.disabled = false;
        multidayOptions.classList.toggle('hidden', !evIsMultiDay);
        dateFinInput.value = ev.date_fin || ev.date;

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
        multidayBlock.classList.toggle('hidden', readonly);
        if (presetDateFin) {
            multidayCheck.checked = true;
            multidayCheck.disabled = false;
            multidayOptions.classList.remove('hidden');
            dateFinInput.value = presetDateFin;
        } else {
            multidayCheck.checked = false;
            multidayCheck.disabled = false;
            multidayOptions.classList.add('hidden');
            dateFinInput.value = presetDate || fmtDate(new Date());
        }
        recurCheck.disabled = false;
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
    const mdCheck = document.getElementById('rdv-multiday-check');
    if (e.target.checked) {
        mdCheck.checked = false;
        document.getElementById('rdv-multiday-options').classList.add('hidden');
        mdCheck.disabled = true;
    } else {
        mdCheck.disabled = false;
    }
});

document.getElementById('rdv-multiday-check').addEventListener('change', (e) => {
    document.getElementById('rdv-multiday-options').classList.toggle('hidden', !e.target.checked);
    const recCheck = document.getElementById('rdv-recur-check');
    if (e.target.checked) {
        recCheck.checked = false;
        document.getElementById('rdv-recur-options').classList.add('hidden');
        recCheck.disabled = true;
    } else {
        recCheck.disabled = false;
    }
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
    const multidayChecked = document.getElementById('rdv-multiday-check').checked;
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

    // Evenement sur plusieurs jours : un seul evenement continu (date -> date_fin),
    // pas segmente jour par jour. La case decochee efface une date_fin existante.
    if (multidayChecked) {
        const df = document.getElementById('rdv-date-fin').value;
        payload.date_fin = df || null;
    } else {
        payload.date_fin = null;
    }

    if (!id) {
        // La recurrence (occurrences distinctes) n'a de sens qu'a la creation,
        // et est incompatible avec un evenement multi-jours continu.
        if (!multidayChecked && document.getElementById('rdv-recur-check').checked) {
            payload.recurrence = document.getElementById('rdv-recur-freq').value;
            payload.recurrence_count = parseInt(document.getElementById('rdv-recur-count').value, 10) || 1;
        }
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

// Molette de la souris sur l'emploi du temps -> semaine precedente/suivante
const ttScrollZone = document.querySelector('.timetable');
let wheelWeekLock = false;
if (ttScrollZone) {
    ttScrollZone.addEventListener('wheel', (e) => {
        if (isPanelEditing) return;
        e.preventDefault();
        if (wheelWeekLock) return;
        wheelWeekLock = true;
        currentMonday = addDays(currentMonday, e.deltaY > 0 ? 7 : -7);
        loadWeek();
        setTimeout(() => { wheelWeekLock = false; }, 100);
    }, { passive: false });
}

// ---------------- Copier / coller un rdv (Ctrl+C / Ctrl+V) ----------------

function rdvConflicts(date, heureDebut, heureFin, excludeId) {
    return lastLoadedEvents.some(ev => {
        if (ev.is_balisage) return false;
        if (excludeId && ev.id === excludeId) return false;
        const evDate = ev.date, evDateFin = ev.date_fin || ev.date;
        if (!(date >= evDate && date <= evDateFin)) return false;
        return heureDebut < ev.heure_fin && heureFin > ev.heure_debut;
    });
}

async function createPastedRdv(date, heureDebut, heureFin, src) {
    const payload = {
        date, heure_debut: heureDebut, heure_fin: heureFin,
        titre: src.titre, description: src.description || '',
        couleur: src.couleur, category_id: src.category_id || null,
    };
    const res = await fetch('/api/rdv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Erreur lors du collage"); return; }
    if (isPanelEditing) closeRdvPanel();
    loadWeek();
}

function pasteRdv() {
    if (!clipboardRdv) return;
    const src = clipboardRdv;
    if (src.date_fin && src.date_fin !== src.date) {
        alert("Le collage n'est pas disponible pour un evenement sur plusieurs jours.");
        return;
    }
    const durationMin = timeToMin(src.heure_fin) - timeToMin(src.heure_debut);
    if (durationMin <= 0) return;

    // 1) Si l'utilisateur a clique quelque part depuis la copie -> coller a cet endroit
    if (pasteTargetDate !== null && pasteTargetMin !== null) {
        const date = pasteTargetDate;
        const startMin = Math.max(0, Math.min(TOTAL_MIN - durationMin, pasteTargetMin));
        const endMin = startMin + durationMin;
        const start = minToTime(startMin), end = minToTime(endMin);

        pasteTargetDate = null;
        pasteTargetMin = null;

        if (!rdvConflicts(date, start, end)) {
            createPastedRdv(date, start, end, src);
            return;
        }
        // ca ne rentre pas exactement a l'endroit clique -> essaie juste apres,
        // puis juste avant cette position
        const afterStartMin = endMin;
        const afterEndMin = afterStartMin + durationMin;
        if (afterEndMin <= TOTAL_MIN && !rdvConflicts(date, minToTime(afterStartMin), minToTime(afterEndMin))) {
            createPastedRdv(date, minToTime(afterStartMin), minToTime(afterEndMin), src);
            return;
        }
        const beforeStartMin = startMin - durationMin;
        if (beforeStartMin >= 0 && !rdvConflicts(date, minToTime(beforeStartMin), minToTime(startMin))) {
            createPastedRdv(date, minToTime(beforeStartMin), minToTime(startMin), src);
            return;
        }
        alert("Impossible de coller ce rendez-vous a cet endroit (aucune place libre).");
        return;
    }

    // 2) Sinon (pas de clic depuis la copie) -> juste apres la source, sinon juste avant
    const afterStartMin = timeToMin(src.heure_fin);
    const afterEndMin = afterStartMin + durationMin;
    if (afterEndMin <= TOTAL_MIN) {
        const afterStart = minToTime(afterStartMin), afterEnd = minToTime(afterEndMin);
        if (!rdvConflicts(src.date, afterStart, afterEnd)) {
            createPastedRdv(src.date, afterStart, afterEnd, src);
            return;
        }
    }
    const beforeStartMin = timeToMin(src.heure_debut) - durationMin;
    if (beforeStartMin >= 0) {
        const beforeStart = minToTime(beforeStartMin), beforeEnd = src.heure_debut;
        if (!rdvConflicts(src.date, beforeStart, beforeEnd)) {
            createPastedRdv(src.date, beforeStart, beforeEnd, src);
            return;
        }
    }
    alert("Impossible de coller ce rendez-vous sur cette semaine (aucune place libre avant/apres).");
}

// ---------------- Navigation clavier entre rdv (fleches) ----------------

function navigateRdv(direction) {
    const events = lastLoadedEvents.filter(e => !e.is_balisage)
        .slice()
        .sort((a, b) => (a.date + a.heure_debut).localeCompare(b.date + b.heure_debut));
    if (events.length === 0) return;
    let idx = selectedEvent ? events.findIndex(e => e.id === selectedEvent.id) : -1;
    idx = idx === -1 ? (direction > 0 ? 0 : events.length - 1) : (idx + direction + events.length) % events.length;
    const next = events[idx];
    const block = document.querySelector(`.tt-block[data-id="${next.id}"]`);
    selectEvent(next, block);
    if (block) block.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // Si le panneau est deja ouvert (ou pour afficher directement le rdv cible),
    // on l'ouvre/actualise avec le nouvel evenement selectionne.
    openRdvPanel(next);
}

async function deleteSelectedRdv() {
    if (!selectedEvent || !window.CAN_EDIT) return;
    if (selectedEvent.uneditable && window.USER_ROLE === 'editor') return;
    if (!confirm('Supprimer ce rendez-vous ?')) return;
    const id = selectedEvent.id;
    selectedEvent = null;
    closeRdvPanel();
    await fetch(`/api/rdv/${id}`, { method: 'DELETE' });
    loadWeek();
}

// ---------------- Raccourcis clavier globaux ----------------
// NB: on ne bloque JAMAIS un raccourci juste parce que "isPanelEditing" est vrai
// (le panneau s'ouvre automatiquement des qu'on selectionne un rdv au clic,
// donc s'appuyer sur isPanelEditing desactiverait les raccourcis juste apres
// la selection). On bloque uniquement si le focus est reellement dans un champ
// de saisie (input/textarea/select), pour ne pas gener la frappe.

document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (typing) return;
        if (selectedEvent) {
            clipboardRdv = { ...selectedEvent };
            e.preventDefault();
        }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (typing) return;
        if (clipboardRdv && window.CAN_EDIT) {
            e.preventDefault();
            pasteRdv();
        }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (typing) return;
        navigateRdv(e.key === 'ArrowRight' ? 1 : -1);
        e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing) return;
        if (selectedEvent) {
            deleteSelectedRdv();
            e.preventDefault();
        }
    } else if (e.key === 'Escape') {
        if (typing) return;
        if (isPanelEditing) closeRdvPanel();
        selectEvent(null, null);
    }
});

enableMultiDaySelect();

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