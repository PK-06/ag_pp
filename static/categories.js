function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function formatMinutes(min) {
    if (!min) return '0 min';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} h`;
    return `${h} h ${m} min`;
}

async function loadCategoriesPage() {
    const res = await fetch('/api/categories');
    const categories = await res.json();
    renderCategoriesPage(categories);
}

function renderCategoriesPage(categories) {
    const wrap = document.getElementById('cat-page-list');
    if (!wrap) return;

    if (categories.length === 0) {
        wrap.innerHTML = '<p class="small muted">Aucune categorie pour le moment.</p>';
        return;
    }

    const canEdit = window.CAN_EDIT_CATEGORIES;
    const canDelete = window.CAN_DELETE_CATEGORIES;

    wrap.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th></th>
                    <th>Nom</th>
                    <th>Nb creneaux</th>
                    <th>Temps total</th>
                    <th>Temps moyen</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
            ${categories.map(c => `
                <tr class="cat-page-row" data-id="${c.id}">
                    <td><input type="color" class="cat-color" value="${c.couleur}" ${canEdit ? '' : 'disabled'}></td>
                    <td><input type="text" class="cat-name" value="${escapeHtml(c.nom)}" maxlength="60" ${canEdit ? '' : 'disabled'}></td>
                    <td>${c.nb_creneaux}</td>
                    <td>${formatMinutes(c.total_min)}</td>
                    <td>${formatMinutes(c.avg_min)}</td>
                    <td class="text-right">
                        ${canEdit ? '<button type="button" class="btn-link-small cat-save">Enregistrer</button>' : ''}
                        ${canDelete ? '<button type="button" class="btn-danger-small cat-delete">Supprimer</button>' : ''}
                    </td>
                </tr>
            `).join('')}
            </tbody>
        </table>
    `;

    wrap.querySelectorAll('.cat-page-row').forEach(row => {
        const id = row.dataset.id;
        const saveBtn = row.querySelector('.cat-save');
        const delBtn = row.querySelector('.cat-delete');

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const nom = row.querySelector('.cat-name').value.trim();
                const couleur = row.querySelector('.cat-color').value;
                const errBox = document.getElementById('cat-page-error');
                if (!nom) { errBox.textContent = 'Nom requis'; return; }
                try {
                    const res = await fetch(`/api/categories/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nom, couleur }),
                    });
                    const data = await res.json();
                    if (!res.ok) { errBox.textContent = data.error || 'Erreur'; return; }
                    errBox.textContent = '';
                    loadCategoriesPage();
                } catch (err) {
                    errBox.textContent = 'Erreur reseau';
                }
            });
        }

        if (delBtn) {
            delBtn.addEventListener('click', async () => {
                if (!confirm('Supprimer cette categorie ? Les rendez-vous associes perdront leur categorie.')) return;
                await fetch(`/api/categories/${id}`, { method: 'DELETE' });
                loadCategoriesPage();
            });
        }
    });
}

if (document.getElementById('cat-new-save')) {
    document.getElementById('cat-new-save').addEventListener('click', async () => {
        const nom = document.getElementById('cat-new-name').value.trim();
        const couleur = document.getElementById('cat-new-color').value;
        const errBox = document.getElementById('cat-page-error');
        if (!nom) { errBox.textContent = 'Nom requis'; return; }
        try {
            const res = await fetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nom, couleur }),
            });
            const data = await res.json();
            if (!res.ok) { errBox.textContent = data.error || 'Erreur'; return; }
            errBox.textContent = '';
            document.getElementById('cat-new-name').value = '';
            loadCategoriesPage();
        } catch (err) {
            errBox.textContent = 'Erreur reseau';
        }
    });
}

loadCategoriesPage();
