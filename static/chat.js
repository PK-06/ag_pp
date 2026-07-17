const CHAT_REFRESH_MS = 3000;
let currentTarget = ''; // '' = salon commun, sinon id utilisateur (string)
let isSending = false;

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function fmtTime(sqlDate) {
    if (!sqlDate) return '';
    const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return sqlDate;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

async function loadContacts() {
    const res = await fetch('/api/users');
    const users = await res.json();
    const list = document.getElementById('chat-contact-list');
    list.innerHTML = '';
    users.forEach(u => {
        const item = document.createElement('div');
        item.className = 'chat-contact';
        item.dataset.id = u.id;
        item.innerHTML = `<span class="chat-contact-icon">${escapeHtml(u.username[0].toUpperCase())}</span><span class="chat-contact-name">${escapeHtml(u.username)}</span>`;
        item.addEventListener('click', () => selectTarget(String(u.id), u.username));
        list.appendChild(item);
    });
}

function selectTarget(id, label) {
    currentTarget = id;
    document.querySelectorAll('.chat-contact').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });
    document.getElementById('chat-title').textContent = label;
    loadMessages();
}

async function loadMessages() {
    const res = await fetch(`/api/messages?with=${encodeURIComponent(currentTarget)}`);
    const messages = await res.json();
    renderMessages(messages);
}

function renderMessages(messages) {
    const wrap = document.getElementById('chat-messages');
    const wasAtBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 60;

    if (messages.length === 0) {
        wrap.innerHTML = '<p class="small muted" style="text-align:center; margin-top:2rem;">Aucun message pour le moment.</p>';
        return;
    }

    wrap.innerHTML = messages.map(m => {
        const mine = m.sender_id === window.CURRENT_USER_ID;
        return `<div class="chat-bubble-row ${mine ? 'mine' : ''}">
            <div class="chat-bubble ${mine ? 'mine' : ''}">
                ${!mine ? `<div class="chat-bubble-author">${escapeHtml(m.sender_username || '?')}</div>` : ''}
                <div class="chat-bubble-content">${escapeHtml(m.content)}</div>
                <div class="chat-bubble-time">${fmtTime(m.created_at)}</div>
            </div>
        </div>`;
    }).join('');

    if (wasAtBottom) wrap.scrollTop = wrap.scrollHeight;
}

document.getElementById('chat-contact-salon').addEventListener('click', () => selectTarget('', 'Salon commun'));

document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSending) return;
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    isSending = true;
    try {
        const res = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, recipient_id: currentTarget || null }),
        });
        if (res.ok) {
            input.value = '';
            loadMessages();
        }
    } finally {
        isSending = false;
    }
});

setInterval(loadMessages, CHAT_REFRESH_MS);

loadContacts();
loadMessages();