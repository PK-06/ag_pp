import calendar as cal_module
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, g, render_template, request, redirect, url_for, session, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

DB_PATH = 'planning.db'

app = Flask(__name__)
app.secret_key = 'change-moi-en-production'

ROLES = ('admin', 'editor', 'viewer')

# ---------------------------------------------------------------- DB ----

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop('db', None)
    if db is not None:
        db.close()


DEFAULT_COLOR = '#2563eb'


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT UNIQUE NOT NULL,
        couleur TEXT NOT NULL DEFAULT '#2563eb',
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS rdv (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        heure_debut TEXT NOT NULL,
        heure_fin TEXT NOT NULL,
        titre TEXT NOT NULL,
        description TEXT,
        couleur TEXT NOT NULL DEFAULT '#2563eb',
        category_id INTEGER,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        is_balisage INTEGER DEFAULT 0,
        uneditable INTEGER DEFAULT 0,
        FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
    );
    ''')
    db.commit()

    # migration douce si une base existante n'a pas encore ces colonnes
    existing_cols = {row[1] for row in db.execute('PRAGMA table_info(rdv)')}
    if 'couleur' not in existing_cols:
        db.execute(f"ALTER TABLE rdv ADD COLUMN couleur TEXT NOT NULL DEFAULT '{DEFAULT_COLOR}'")
    if 'category_id' not in existing_cols:
        db.execute('ALTER TABLE rdv ADD COLUMN category_id INTEGER')
    if 'is_balisage' not in existing_cols:
        db.execute('ALTER TABLE rdv ADD COLUMN is_balisage INTEGER DEFAULT 0')
    if 'uneditable' not in existing_cols:
        db.execute('ALTER TABLE rdv ADD COLUMN uneditable INTEGER DEFAULT 0')
    db.commit()

    existing_user_cols = {row[1] for row in db.execute('PRAGMA table_info(users)')}
    if 'notes' not in existing_user_cols:
        db.execute('ALTER TABLE users ADD COLUMN notes TEXT')
    db.commit()

    cur = db.execute('SELECT COUNT(*) c FROM users')
    if cur.fetchone()[0] == 0:
        db.execute(
            'INSERT INTO users (username, password_hash, role) VALUES (?,?,?)',
            ('admin', generate_password_hash('admin123'), 'admin')
        )
        db.commit()
        print('=== Compte admin cree : admin / admin123 (a changer immediatement) ===')
    db.close()


# ------------------------------------------------------------- AUTH ----

def current_user():
    if 'user_id' not in session:
        return None
    db = get_db()
    return db.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()


@app.context_processor
def inject_user():
    return {'current_user': current_user()}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user():
            return redirect(url_for('login', next=request.path))
        return view(*args, **kwargs)
    return wrapped


def role_required(*roles):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = current_user()
            if not user:
                return redirect(url_for('login', next=request.path))
            if user['role'] not in roles:
                return jsonify({'error': 'acces refuse'}), 403
            return view(*args, **kwargs)
        return wrapped
    return decorator


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if user and check_password_hash(user['password_hash'], password):
            session.clear()
            session['user_id'] = user['id']
            return redirect(request.args.get('next') or url_for('calendar_view'))
        return render_template('login.html', error='Identifiants incorrects')
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# -------------------------------------------------------- CATEGORIES ----

def _duration_minutes(heure_debut, heure_fin):
    h1, m1 = map(int, heure_debut.split(':'))
    h2, m2 = map(int, heure_fin.split(':'))
    return max(0, (h2 * 60 + m2) - (h1 * 60 + m1))


@app.route('/api/categories')
@login_required
def api_categories_list():
    db = get_db()
    cats = db.execute('SELECT * FROM categories ORDER BY nom').fetchall()
    rdvs = db.execute('SELECT category_id, heure_debut, heure_fin FROM rdv').fetchall()

    stats = {}
    for r in rdvs:
        cid = r['category_id']
        if cid is None:
            continue
        s = stats.setdefault(cid, {'nb': 0, 'total_min': 0})
        s['nb'] += 1
        s['total_min'] += _duration_minutes(r['heure_debut'], r['heure_fin'])

    result = []
    for c in cats:
        s = stats.get(c['id'], {'nb': 0, 'total_min': 0})
        avg = round(s['total_min'] / s['nb']) if s['nb'] else 0
        d = dict(c)
        d['nb_creneaux'] = s['nb']
        d['total_min'] = s['total_min']
        d['avg_min'] = avg
        result.append(d)
    return jsonify(result)


@app.route('/categories')
@login_required
def categories_view():
    return render_template('categories.html')


@app.route('/api/categories', methods=['POST'])
@role_required('admin', 'editor')
def api_categories_create():
    data = request.get_json(force=True)
    nom = (data.get('nom') or '').strip()
    couleur = (data.get('couleur') or DEFAULT_COLOR).strip()
    if not nom:
        return jsonify({'error': 'nom requis'}), 400
    db = get_db()
    try:
        cur = db.execute(
            'INSERT INTO categories (nom, couleur, created_by) VALUES (?,?,?)',
            (nom, couleur, session['user_id'])
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({'error': 'cette categorie existe deja'}), 400
    return jsonify({'id': cur.lastrowid, 'nom': nom, 'couleur': couleur}), 201


@app.route('/api/categories/<int:cat_id>', methods=['PUT'])
@role_required('admin', 'editor')
def api_categories_update(cat_id):
    data = request.get_json(force=True)
    db = get_db()
    row = db.execute('SELECT * FROM categories WHERE id = ?', (cat_id,)).fetchone()
    if not row:
        return jsonify({'error': 'introuvable'}), 404
    nom = (data.get('nom') if data.get('nom') is not None else row['nom']).strip()
    couleur = (data.get('couleur') if data.get('couleur') is not None else row['couleur']).strip()
    if not nom:
        return jsonify({'error': 'nom requis'}), 400
    try:
        db.execute('UPDATE categories SET nom = ?, couleur = ? WHERE id = ?', (nom, couleur, cat_id))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({'error': 'cette categorie existe deja'}), 400
    return jsonify({'id': cat_id, 'nom': nom, 'couleur': couleur})


@app.route('/api/categories/<int:cat_id>', methods=['DELETE'])
@role_required('admin')
def api_categories_delete(cat_id):
    db = get_db()
    db.execute('DELETE FROM categories WHERE id = ?', (cat_id,))
    db.commit()
    return jsonify({'ok': True})


# --------------------------------------------------------- CALENDAR ----

@app.route('/')
@login_required
def calendar_view():
    return render_template('calendar.html')


def week_bounds(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    monday = d - timedelta(days=d.weekday())
    days = [(monday + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(7)]
    return days


def add_months(d, months):
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, cal_module.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


RECURRENCE_FREQS = ('daily', 'weekly', 'monthly', 'yearly')


@app.route('/api/rdv')
@login_required
def api_rdv_list():
    start = request.args.get('start')
    end = request.args.get('end')
    if not start or not end:
        return jsonify({'error': 'start et end requis (YYYY-MM-DD)'}), 400
    db = get_db()
    rows = db.execute(
        '''SELECT rdv.*, users.username AS auteur, categories.nom AS categorie_nom
           FROM rdv
           LEFT JOIN users ON users.id = rdv.created_by
           LEFT JOIN categories ON categories.id = rdv.category_id
           WHERE date BETWEEN ? AND ?
           ORDER BY date, heure_debut''',
        (start, end)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/rdv/<int:rdv_id>')
@login_required
def api_rdv_get(rdv_id):
    db = get_db()
    row = db.execute(
        '''SELECT rdv.*, users.username AS auteur, categories.nom AS categorie_nom
           FROM rdv
           LEFT JOIN users ON users.id = rdv.created_by
           LEFT JOIN categories ON categories.id = rdv.category_id
           WHERE rdv.id = ?''', (rdv_id,)
    ).fetchone()
    if not row:
        return jsonify({'error': 'introuvable'}), 404
    return jsonify(dict(row))


@app.route('/api/rdv', methods=['POST'])
@role_required('admin', 'editor')
def api_rdv_create():
    data = request.get_json(force=True)
    required = ('date', 'heure_debut', 'heure_fin', 'titre')
    if not all(data.get(f) for f in required):
        return jsonify({'error': 'champs manquants (date, heure_debut, heure_fin, titre)'}), 400
    if data['heure_fin'] <= data['heure_debut']:
        return jsonify({'error': "l'heure de fin doit etre apres l'heure de debut"}), 400

    recurrence = data.get('recurrence') or 'none'
    try:
        count = int(data.get('recurrence_count') or 1)
    except (TypeError, ValueError):
        count = 1
    count = max(1, min(count, 104))

    try:
        base_date = datetime.strptime(data['date'], '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'date invalide'}), 400

    dates = [base_date]
    if recurrence in RECURRENCE_FREQS and count > 1:
        for i in range(1, count):
            if recurrence == 'daily':
                dates.append(base_date + timedelta(days=i))
            elif recurrence == 'weekly':
                dates.append(base_date + timedelta(weeks=i))
            elif recurrence == 'monthly':
                dates.append(add_months(base_date, i))
            elif recurrence == 'yearly':
                dates.append(add_months(base_date, 12 * i))

    user = current_user()
    is_admin = user and user['role'] == 'admin'

    uneditable = int(data.get('uneditable', 0)) if is_admin else 0
    is_balisage = int(data.get('is_balisage', 0)) if is_admin else 0

    db = get_db()
    ids = []
    for d in dates:
        cur = db.execute(
            '''INSERT INTO rdv (date, heure_debut, heure_fin, titre, description, couleur, category_id, created_by, uneditable, is_balisage)
               VALUES (?,?,?,?,?,?,?,?,?,?)''',
            (d.strftime('%Y-%m-%d'), data['heure_debut'], data['heure_fin'], data['titre'],
             data.get('description', ''), data.get('couleur') or DEFAULT_COLOR,
             data.get('category_id') or None, session['user_id'], uneditable, is_balisage)
        )
        ids.append(cur.lastrowid)
    db.commit()
    return jsonify({'id': ids[0], 'ids': ids, 'count': len(ids)}), 201


@app.route('/api/rdv/<int:rdv_id>', methods=['PUT'])
@role_required('admin', 'editor')
def api_rdv_update(rdv_id):
    data = request.get_json(force=True)
    db = get_db()
    row = db.execute('SELECT * FROM rdv WHERE id = ?', (rdv_id,)).fetchone()
    if not row:
        return jsonify({'error': 'introuvable'}), 404

    user = current_user()
    is_admin = user and user['role'] == 'admin'

    if row['uneditable'] and user['role'] == 'editor':
        return jsonify({'error': 'Cet evenement est verrouille par un administrateur'}), 403

    fields = {k: data[k] for k in ('date', 'heure_debut', 'heure_fin', 'titre', 'description', 'couleur', 'category_id') if k in data}

    if is_admin:
        if 'uneditable' in data:
            fields['uneditable'] = int(data['uneditable'])
        if 'is_balisage' in data:
            fields['is_balisage'] = int(data['is_balisage'])

    if not fields:
        return jsonify({'error': 'rien a mettre a jour'}), 400

    set_clause = ', '.join(f'{k} = ?' for k in fields)
    db.execute(f'UPDATE rdv SET {set_clause} WHERE id = ?', (*fields.values(), rdv_id))
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/rdv/<int:rdv_id>', methods=['DELETE'])
@role_required('admin', 'editor')
def api_rdv_delete(rdv_id):
    db = get_db()
    row = db.execute('SELECT * FROM rdv WHERE id = ?', (rdv_id,)).fetchone()
    if not row:
        return jsonify({'error': 'introuvable'}), 404

    user = current_user()
    if row['uneditable'] and user['role'] == 'editor':
        return jsonify({'error': 'Cet evenement est verrouille par un administrateur'}), 403

    db.execute('DELETE FROM rdv WHERE id = ?', (rdv_id,))
    db.commit()
    return jsonify({'ok': True})


# ------------------------------------------------------------ NOTES ----

@app.route('/api/notes')
@login_required
def api_notes_get():
    user = current_user()
    return jsonify({'content': user['notes'] or ''})


@app.route('/api/notes', methods=['PUT'])
@login_required
def api_notes_update():
    data = request.get_json(force=True)
    content = data.get('content', '')
    db = get_db()
    db.execute('UPDATE users SET notes = ? WHERE id = ?', (content, session['user_id']))
    db.commit()
    return jsonify({'ok': True})


# ------------------------------------------------------------ CHAT ----

@app.route('/chat')
@login_required
def chat_view():
    return render_template('chat.html')


@app.route('/api/users')
@login_required
def api_users_list():
    db = get_db()
    me = session['user_id']
    rows = db.execute(
        'SELECT id, username, role FROM users WHERE id != ? ORDER BY username',
        (me,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/messages')
@login_required
def api_messages_list():
    with_param = request.args.get('with', '').strip()
    db = get_db()
    me = session['user_id']

    if with_param == '':
        rows = db.execute(
            '''SELECT messages.*, users.username AS sender_username
               FROM messages
               LEFT JOIN users ON users.id = messages.sender_id
               WHERE messages.recipient_id IS NULL
               ORDER BY messages.created_at'''
        ).fetchall()
    else:
        try:
            other_id = int(with_param)
        except ValueError:
            return jsonify({'error': 'parametre with invalide'}), 400
        rows = db.execute(
            '''SELECT messages.*, users.username AS sender_username
               FROM messages
               LEFT JOIN users ON users.id = messages.sender_id
               WHERE (sender_id = ? AND recipient_id = ?)
                  OR (sender_id = ? AND recipient_id = ?)
               ORDER BY messages.created_at''',
            (me, other_id, other_id, me)
        ).fetchall()

    return jsonify([dict(r) for r in rows])


@app.route('/api/messages', methods=['POST'])
@login_required
def api_messages_create():
    data = request.get_json(force=True)
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'message vide'}), 400
    if len(content) > 2000:
        return jsonify({'error': 'message trop long'}), 400

    recipient_raw = data.get('recipient_id')
    recipient_id = None
    db = get_db()
    if recipient_raw not in (None, ''):
        try:
            recipient_id = int(recipient_raw)
        except (TypeError, ValueError):
            return jsonify({'error': 'destinataire invalide'}), 400
        if recipient_id == session['user_id']:
            return jsonify({'error': "impossible de s'envoyer un message a soi-meme"}), 400
        exists = db.execute('SELECT 1 FROM users WHERE id = ?', (recipient_id,)).fetchone()
        if not exists:
            return jsonify({'error': 'destinataire introuvable'}), 404

    cur = db.execute(
        'INSERT INTO messages (sender_id, recipient_id, content) VALUES (?,?,?)',
        (session['user_id'], recipient_id, content)
    )
    db.commit()
    return jsonify({'id': cur.lastrowid}), 201


# ------------------------------------------------------- ADMIN USERS ----

@app.route('/admin/users')
@role_required('admin')
def admin_users():
    db = get_db()
    users = db.execute('SELECT id, username, role, created_at FROM users ORDER BY id').fetchall()
    return render_template('users.html', users=users)


@app.route('/admin/users', methods=['POST'])
@role_required('admin')
def admin_users_create():
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    role = request.form.get('role', '')
    db = get_db()
    if not username or not password or role not in ('editor', 'viewer'):
        users = db.execute('SELECT id, username, role, created_at FROM users ORDER BY id').fetchall()
        return render_template('users.html', users=users, error='Champs invalides (role: editor ou viewer uniquement)')
    try:
        db.execute(
            'INSERT INTO users (username, password_hash, role) VALUES (?,?,?)',
            (username, generate_password_hash(password), role)
        )
        db.commit()
    except sqlite3.IntegrityError:
        users = db.execute('SELECT id, username, role, created_at FROM users ORDER BY id').fetchall()
        return render_template('users.html', users=users, error="Ce nom d'utilisateur existe deja")
    return redirect(url_for('admin_users'))


@app.route('/admin/users/<int:user_id>/delete', methods=['POST'])
@role_required('admin')
def admin_users_delete(user_id):
    if user_id == session['user_id']:
        return redirect(url_for('admin_users'))
    db = get_db()
    row = db.execute('SELECT role FROM users WHERE id = ?', (user_id,)).fetchone()
    if row and row['role'] == 'admin':
        return redirect(url_for('admin_users'))
    db.execute('DELETE FROM users WHERE id = ?', (user_id,))
    db.commit()
    return redirect(url_for('admin_users'))


if __name__ == '__main__':
    init_db()
    app.run(debug=True, host='0.0.0.0', port=10000)