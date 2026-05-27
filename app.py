from dotenv import load_dotenv
load_dotenv()
from flask import Flask
import os
import psycopg2
import psycopg2.extras
from flask import (Flask, render_template, request, redirect, url_for,
                   session, flash, jsonify, g)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from functools import wraps
from datetime import datetime
import cloudinary
import cloudinary.uploader
from chatbot import chatbot_bp
from routes.auth import auth_bp     
# ── App setup ──────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev")
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['SENDGRID_API_KEY'] = os.environ.get('SENDGRID_API_KEY')
# Configure Cloudinary
cloudinary.config(
    cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key    = os.environ.get('CLOUDINARY_API_KEY'),
    api_secret = os.environ.get('CLOUDINARY_API_SECRET'),
    secure     = True
)

def upload_to_cloudinary(file, folder='cookingina'):
    """Upload a file to Cloudinary and return the URL."""
    try:
        result = cloudinary.uploader.upload(
            file,
            folder=folder,
            allowed_formats=['jpg', 'jpeg', 'png', 'webp']
        )
        return result['secure_url']
    except Exception as e:
        print(f'Cloudinary upload error: {e}')
        return None



app.register_blueprint(auth_bp)
app.register_blueprint(chatbot_bp)

UPLOAD_FOLDER = os.path.join('static', 'uploads')
ALLOWED_EXT   = {'jpg', 'jpeg', 'png', 'webp'}
DB_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql://postgres:admin123@localhost:5432/cookingina'
)
if DB_URL and DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ── Database helpers ────────────────────────────────────────────────────────

def get_db():
    if 'db' not in g:
        g.db = psycopg2.connect(DB_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def query(sql, params=(), one=False, commit=False):
    db  = get_db()
    cur = db.cursor()
    cur.execute(sql, params)
    if commit:
        db.commit()
        cur.close()
        return None
    rows = cur.fetchone() if one else cur.fetchall()
    cur.close()
    return rows

def execute(sql, params=()):
    db  = get_db()
    cur = db.cursor()
    cur.execute(sql, params)
    db.commit()
    try:
        row = cur.fetchone()
        cur.close()
        return row
    except Exception:
        cur.close()
        return None


# ── Auth helpers ────────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            flash('Please log in to continue.', 'info')
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            flash('Please log in to continue.', 'info')
            return redirect(url_for('login'))
        user = current_user()
        if not user or user['role'] != 'admin':
            flash('Admin access required.', 'error')
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated

def current_user():
    if 'user_id' in session:
        return query('SELECT * FROM users WHERE id = %s', (session['user_id'],), one=True)
    return None

def is_admin():
    user = current_user()
    return user and user['role'] == 'admin'

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXT


# ── Context processor ───────────────────────────────────────────────────────

@app.context_processor
def inject_user():
    u = current_user()
    return dict(user=u, user_is_admin=(u and u['role'] == 'admin'))


# ── Recipe helper ───────────────────────────────────────────────────────────

def get_recipe_full(recipe_id):
    recipe = query(
        'SELECT r.*, u.username, u.profile_image as uploader_img, u.role as uploader_role '
        'FROM recipes r LEFT JOIN users u ON r.user_id = u.id '
        'WHERE r.id = %s', (recipe_id,), one=True)
    if not recipe:
        return None
    recipe = dict(recipe)
    recipe['ingredients'] = query(
        'SELECT name, price FROM ingredients WHERE recipe_id = %s ORDER BY sort_order',
        (recipe_id,))
    recipe['steps'] = query(
        'SELECT instruction FROM recipe_steps WHERE recipe_id = %s ORDER BY step_num',
        (recipe_id,))
    recipe['allergens'] = [r['allergen'] for r in query(
        'SELECT allergen FROM recipe_allergens WHERE recipe_id = %s', (recipe_id,))]
    recipe['total_cost'] = sum(i['price'] for i in recipe['ingredients'])

    avg = query('SELECT ROUND(AVG(rating)::numeric,1) as avg, COUNT(*) as cnt '
                'FROM ratings WHERE recipe_id = %s', (recipe_id,), one=True)
    recipe['avg_rating']   = float(avg['avg']) if avg['avg'] else 0
    recipe['rating_count'] = avg['cnt']

    recipe['reviews'] = query(
        '''SELECT rv.*, u.username, u.profile_image,
                  COALESCE(SUM(CASE WHEN rr.reaction='like'    THEN 1 ELSE 0 END),0) AS like_count,
                  COALESCE(SUM(CASE WHEN rr.reaction='dislike' THEN 1 ELSE 0 END),0) AS dislike_count
           FROM reviews rv
           JOIN users u ON rv.user_id = u.id
           LEFT JOIN review_reactions rr ON rr.review_id = rv.id
           WHERE rv.recipe_id = %s
           GROUP BY rv.id, u.username, u.profile_image
           ORDER BY rv.created_at DESC''', (recipe_id,))
    # After:  return recipe
# Before: return recipe  — add this block:

    # Fetch replies for each review
    review_ids = [r['id'] for r in recipe['reviews']]
    if review_ids:
        placeholders = ','.join(['%s'] * len(review_ids))
        replies = query(
            f'''SELECT rp.*, u.username, u.profile_image,
                       pu.username AS parent_username
                FROM review_replies rp
                JOIN users u ON rp.user_id = u.id
                LEFT JOIN review_replies pr ON pr.id = rp.parent_reply_id
                LEFT JOIN users pu ON pu.id = pr.user_id
                WHERE rp.review_id IN ({placeholders})
                ORDER BY rp.created_at ASC''',
            tuple(review_ids))
        # Group replies by review_id
        replies_by_review = {}
        for rp in (replies or []):
            rid = rp['review_id']
            replies_by_review.setdefault(rid, []).append(dict(rp))
        # Attach to each review
        reviews_with_replies = []
        for r in recipe['reviews']:
            rd = dict(r)
            rd['replies'] = replies_by_review.get(r['id'], [])
            reviews_with_replies.append(rd)
        recipe['reviews'] = reviews_with_replies

    return recipe
    return recipe


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC ROUTES
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/')
def index():
    search = request.args.get('q', '').strip()
    filt   = request.args.get('filter', 'all')
    u      = current_user()

    base_sql = '''
        SELECT r.*,
               u.username,
               COALESCE(ROUND(AVG(rt.rating)::numeric,1),0) AS avg_rating,
               COUNT(DISTINCT rt.id) AS rating_count,
               COALESCE(SUM(i.price), 0) AS total_cost
        FROM recipes r
        LEFT JOIN users      u  ON r.user_id   = u.id
        LEFT JOIN ratings    rt ON rt.recipe_id = r.id
        LEFT JOIN ingredients i ON i.recipe_id  = r.id
    '''
    where_clauses = []
    params        = []

    # ── Visibility rule ────────────────────────────────────────────────────
    # Guests & regular users: approved + public only
    # Admins: see everything
    if not u or u['role'] != 'admin':
        where_clauses.append("r.status = 'approved' AND r.is_public = TRUE")

    if search:
        where_clauses.append('''(
            r.name ILIKE %s
            OR EXISTS (SELECT 1 FROM ingredients ing WHERE ing.recipe_id=r.id AND ing.name ILIKE %s)
            OR EXISTS (SELECT 1 FROM recipe_allergens al WHERE al.recipe_id=r.id AND al.allergen ILIKE %s)
        )''')
        like = f'%{search}%'
        params += [like, like, like]

    if filt == 'spicy':
        where_clauses.append('r.is_spicy = TRUE')
    elif filt == 'quick':
        where_clauses.append('r.is_quick = TRUE')
    elif filt == 'budget':
        where_clauses.append('r.is_budget = TRUE')
    elif filt == 'favorites' and u:
        where_clauses.append(
            'EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id=r.id AND f.user_id=%s)')
        params.append(u['id'])
    elif filt == 'favorites':
        where_clauses.append('FALSE')

    if where_clauses:
        base_sql += ' WHERE ' + ' AND '.join(where_clauses)
    base_sql += ' GROUP BY r.id, u.username ORDER BY r.created_at DESC'

    recipes = query(base_sql, tuple(params))

    fav_ids = set()
    if u:
        favs = query('SELECT recipe_id FROM favorites WHERE user_id=%s', (u['id'],))
        fav_ids = {f['recipe_id'] for f in favs}

    return render_template('index.html',
                           recipes=recipes,
                           fav_ids=fav_ids,
                           search=search,
                           active_filter=filt)


# ── Recipe Detail (AJAX) ────────────────────────────────────────────────────

@app.route('/recipe/<int:recipe_id>')
def recipe_detail(recipe_id):
    recipe = get_recipe_full(recipe_id)
    if not recipe:
        return jsonify({'error': 'Not found'}), 404

    u = current_user()

    # Access control: non-admin guests can only view approved+public recipes
    if not (u and u['role'] == 'admin'):
        # Owner can view their own recipes regardless of status
        if recipe['status'] != 'approved' or not recipe['is_public']:
            if not u or recipe['user_id'] != u['id']:
                return jsonify({'error': 'Not available'}), 403

    user_rating = None
    is_fav = False
    if u:
        row = query('SELECT rating FROM ratings WHERE user_id=%s AND recipe_id=%s',
                    (u['id'], recipe_id), one=True)
        user_rating = row['rating'] if row else None
        row2 = query('SELECT 1 FROM favorites WHERE user_id=%s AND recipe_id=%s',
                     (u['id'], recipe_id), one=True)
        is_fav = bool(row2)

    # Build reviews list with user's own reaction
    reviews_list = []
    for r in recipe['reviews']:
        rd = dict(r)
        if u:
            ur = query('SELECT reaction FROM review_reactions WHERE review_id=%s AND user_id=%s',
                       (r['id'], u['id']), one=True)
            rd['user_reaction'] = ur['reaction'] if ur else None
        else:
            rd['user_reaction'] = None
        reviews_list.append(rd)
    recipe['reviews']     = reviews_list
    recipe['ingredients'] = [dict(i) for i in recipe['ingredients']]
    recipe['steps']       = [dict(s) for s in recipe['steps']]
    recipe['is_fav']      = is_fav
    recipe['user_rating'] = user_rating
    recipe['logged_in']   = u is not None
    recipe['session_uid'] = u['id'] if u else None
    recipe['is_admin']    = u and u['role'] == 'admin'

    # Convert datetime for JSON
    for key in ('created_at', 'reviewed_at'):
        if recipe.get(key):
            recipe[key] = recipe[key].strftime('%b %d, %Y')
    for rev in recipe['reviews']:
        if rev.get('created_at'):
            rev['created_at'] = rev['created_at'].strftime('%b %d, %Y')
        for rp in rev.get('replies', []):
            if rp.get('created_at'):
                rp['created_at'] = rp['created_at'].strftime('%b %d, %Y')

    return jsonify(recipe)


# ── Toggle Favourite ────────────────────────────────────────────────────────

@app.route('/favorite/<int:recipe_id>', methods=['POST'])
@login_required
def toggle_favorite(recipe_id):
    uid = session['user_id']
    existing = query('SELECT id FROM favorites WHERE user_id=%s AND recipe_id=%s',
                     (uid, recipe_id), one=True)
    if existing:
        execute('DELETE FROM favorites WHERE user_id=%s AND recipe_id=%s', (uid, recipe_id))
        return jsonify({'status': 'removed'})
    execute('INSERT INTO favorites (user_id, recipe_id) VALUES (%s,%s)', (uid, recipe_id))
    return jsonify({'status': 'added'})


# ── Rate Recipe ─────────────────────────────────────────────────────────────

@app.route('/rate/<int:recipe_id>', methods=['POST'])
@login_required
def rate_recipe(recipe_id):
    rating = int(request.json.get('rating', 0))
    if not 1 <= rating <= 5:
        return jsonify({'error': 'Invalid rating'}), 400
    uid = session['user_id']
    execute('''
        INSERT INTO ratings (user_id, recipe_id, rating)
        VALUES (%s,%s,%s)
        ON CONFLICT (user_id, recipe_id) DO UPDATE SET rating = EXCLUDED.rating
    ''', (uid, recipe_id, rating))
    avg = query('SELECT ROUND(AVG(rating)::numeric,1) as avg, COUNT(*) as cnt '
                'FROM ratings WHERE recipe_id=%s', (recipe_id,), one=True)
    return jsonify({'avg': float(avg['avg']), 'cnt': avg['cnt']})

@app.route('/review/<int:review_id>/edit', methods=['POST'])
@login_required
def edit_review(review_id):
    # Handle both JSON and multipart
    if request.content_type and 'multipart/form-data' in request.content_type:
        comment = request.form.get('comment', '').strip()
    else:
        comment = (request.json or {}).get('comment', '').strip()

    if not comment:
        return jsonify({'error': 'Empty comment'}), 400

    uid = session['user_id']

    review = query(
        'SELECT id, image_path FROM reviews WHERE id=%s AND user_id=%s',
        (review_id, uid), one=True
    )
    if not review:
        return jsonify({'error': 'Not found'}), 404

    img_path = review['image_path']  # keep existing image by default

    # Handle new image upload
    if 'comment_image' in request.files:
        f = request.files['comment_image']
        if f and f.filename and allowed_file(f.filename):
            url = upload_to_cloudinary(f, folder='cookingina/comments')
            if url:
                img_path = url

    execute(
        'UPDATE reviews SET comment=%s, image_path=%s WHERE id=%s',
        (comment, img_path, review_id)
    )
    return jsonify({
        'status': 'updated',
        'comment': comment,
        'image_path': img_path
    })
# ── Post Review ─────────────────────────────────────────────────────────────

COMMENT_UPLOAD_FOLDER = os.path.join('static', 'uploads', 'comments')
os.makedirs(COMMENT_UPLOAD_FOLDER, exist_ok=True)

@app.route('/review/<int:recipe_id>', methods=['POST'])
@login_required
def post_review(recipe_id):
    # Accept both JSON (no image) and multipart form (with image)
    if request.content_type and 'multipart/form-data' in request.content_type:
        comment = request.form.get('comment', '').strip()
    else:
        comment = (request.json or {}).get('comment', '').strip()

    if not comment:
        return jsonify({'error': 'Empty comment'}), 400

    uid      = session['user_id']
    img_path = None

    # Handle optional image upload
    if 'comment_image' in request.files:
        f = request.files['comment_image']
        if f and f.filename and allowed_file(f.filename):
            url = upload_to_cloudinary(f, folder='cookingina/comments')
            if url:
                img_path = url

    row = execute('''
        INSERT INTO reviews (user_id, recipe_id, comment, image_path)
        VALUES (%s,%s,%s,%s) RETURNING id, created_at
    ''', (uid, recipe_id, comment, img_path))

    user = current_user()
    return jsonify({
        'id':            row['id'],
        'user_id':       uid, 
        'username':      user['username'],
        'profile_image': user['profile_image'],
        'comment':       comment,
        'image_path':    img_path,
        'like_count':    0,
        'dislike_count': 0,
        'user_reaction': None,
        'created_at':    row['created_at'].strftime('%b %d, %Y')
    })


# ── Delete Review ───────────────────────────────────────────────────────────

@app.route('/review/<int:review_id>/delete', methods=['POST'])
@login_required
def delete_review(review_id):
    uid = session['user_id']
    u   = current_user()
    rev = query('SELECT user_id FROM reviews WHERE id=%s', (review_id,), one=True)
    if not rev:
        return jsonify({'error': 'Not found'}), 404
    if rev['user_id'] != uid and u['role'] != 'admin':
        return jsonify({'error': 'Forbidden'}), 403
    execute('DELETE FROM reviews WHERE id=%s', (review_id,))
    return jsonify({'status': 'deleted'})


# ── React to Review ────────────────────────────────────────────────────────

@app.route('/review/<int:review_id>/react', methods=['POST'])
@login_required
def react_review(review_id):
    uid      = session['user_id']
    reaction = (request.json or {}).get('reaction', '')
    if reaction not in ('like', 'dislike'):
        return jsonify({'error': 'Invalid reaction'}), 400

    existing = query('SELECT reaction FROM review_reactions WHERE review_id=%s AND user_id=%s',
                     (review_id, uid), one=True)

    if existing:
        if existing['reaction'] == reaction:
            # Same vote — remove it (toggle off)
            execute('DELETE FROM review_reactions WHERE review_id=%s AND user_id=%s', (review_id, uid))
            user_reaction = None
        else:
            # Different vote — switch it
            execute('UPDATE review_reactions SET reaction=%s WHERE review_id=%s AND user_id=%s',
                    (reaction, review_id, uid))
            user_reaction = reaction
    else:
        # No existing vote — insert
        execute('INSERT INTO review_reactions (review_id, user_id, reaction) VALUES (%s,%s,%s)',
                (review_id, uid, reaction))
        user_reaction = reaction

    counts = query('''
        SELECT
            COALESCE(SUM(CASE WHEN reaction='like'    THEN 1 ELSE 0 END),0) AS like_count,
            COALESCE(SUM(CASE WHEN reaction='dislike' THEN 1 ELSE 0 END),0) AS dislike_count
        FROM review_reactions WHERE review_id=%s
    ''', (review_id,), one=True)

    return jsonify({
        'user_reaction': user_reaction,
        'like_count':    counts['like_count'],
        'dislike_count': counts['dislike_count']
    })


# ═══════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username'].strip()
        email    = request.form['email'].strip().lower()
        password = request.form['password']
        confirm  = request.form['confirm']

        if len(password) < 8:
            flash('Password must be at least 8 characters.', 'error')
            return redirect(url_for('register'))
        if password != confirm:
            flash('Passwords do not match.', 'error')
            return redirect(url_for('register'))
        if query('SELECT id FROM users WHERE username=%s OR email=%s',
                 (username, email), one=True):
            flash('Username or email already taken.', 'error')
            return redirect(url_for('register'))

        pw_hash = generate_password_hash(password)
        row = execute(
            'INSERT INTO users (username,email,password_hash,role) VALUES (%s,%s,%s,%s) RETURNING id',
            (username, email, pw_hash, 'user'))
        session['user_id']  = row['id']
        session['username'] = username
        flash('Welcome to ChefAI! 🍽️', 'success')
        return redirect(url_for('index'))

    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        identifier = request.form['identifier'].strip()
        password   = request.form['password']

        user = query('SELECT * FROM users WHERE email=%s OR username=%s',
                     (identifier, identifier), one=True)
        if user and check_password_hash(user['password_hash'], password):
            session['user_id']  = user['id']
            session['username'] = user['username']
            flash(f'Welcome back, {user["username"]}! 👋', 'success')
            if user['role'] == 'admin':
                return redirect(url_for('admin_dashboard'))
            return redirect(url_for('index'))

        flash('Invalid credentials. Try again.', 'error')

    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    flash('Logged out. Come cook again soon! 👋', 'info')
    return redirect(url_for('index'))


# ═══════════════════════════════════════════════════════════════════════════
# USER PROFILE
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/user/<username>')
def user_profile(username):
    profile_user = query('SELECT * FROM users WHERE username=%s', (username,), one=True)
    if not profile_user:
        flash('User not found.', 'error')
        return redirect(url_for('index'))

    u = current_user()
    is_own_profile = u and u['id'] == profile_user['id']
    admin_view     = u and u['role'] == 'admin'

    # What recipes to show on this profile
    if is_own_profile or admin_view:
        # Show all own recipes with status
        recipes = query('''
            SELECT r.*,
                   COALESCE(ROUND(AVG(rt.rating)::numeric,1),0) AS avg_rating,
                   COALESCE(SUM(i.price),0) AS total_cost
            FROM recipes r
            LEFT JOIN ratings     rt ON rt.recipe_id = r.id
            LEFT JOIN ingredients i  ON i.recipe_id  = r.id
            WHERE r.user_id = %s
            GROUP BY r.id ORDER BY r.created_at DESC
        ''', (profile_user['id'],))
    else:
        # Guests/other users: only approved+public
        recipes = query('''
            SELECT r.*,
                   COALESCE(ROUND(AVG(rt.rating)::numeric,1),0) AS avg_rating,
                   COALESCE(SUM(i.price),0) AS total_cost
            FROM recipes r
            LEFT JOIN ratings     rt ON rt.recipe_id = r.id
            LEFT JOIN ingredients i  ON i.recipe_id  = r.id
            WHERE r.user_id = %s AND r.status = 'approved' AND r.is_public = TRUE
            GROUP BY r.id ORDER BY r.created_at DESC
        ''', (profile_user['id'],))

    total_reviews = query(
        'SELECT COUNT(*) as cnt FROM reviews rv JOIN recipes r ON rv.recipe_id=r.id '
        'WHERE r.user_id=%s', (profile_user['id'],), one=True)

    overall_avg = query('''
        SELECT ROUND(AVG(rt.rating)::numeric,1) as avg
        FROM ratings rt JOIN recipes r ON rt.recipe_id=r.id
        WHERE r.user_id=%s
    ''', (profile_user['id'],), one=True)

    fav_ids = set()
    if u:
        favs = query('SELECT recipe_id FROM favorites WHERE user_id=%s', (u['id'],))
        fav_ids = {f['recipe_id'] for f in favs}

    return render_template('profile.html',
                           profile_user=profile_user,
                           recipes=recipes,
                           fav_ids=fav_ids,
                           total_reviews=total_reviews['cnt'],
                           overall_avg=float(overall_avg['avg']) if overall_avg['avg'] else 0,
                           is_own_profile=is_own_profile)


@app.route('/profile/edit', methods=['GET', 'POST'])
@login_required
def edit_profile():
    uid  = session['user_id']
    user = current_user()

    if request.method == 'POST':
        bio      = request.form.get('bio', '').strip()
        img_path = user['profile_image']

        if 'profile_image' in request.files:
            f = request.files['profile_image']
            if f and f.filename and allowed_file(f.filename):
                url = upload_to_cloudinary(f, folder='cookingina/profiles')
                if url:
                    img_path = url

        execute('UPDATE users SET bio=%s, profile_image=%s WHERE id=%s',
                (bio, img_path, uid))
        flash('Profile updated!', 'success')
        return redirect(url_for('user_profile', username=session['username']))

    return render_template('edit_profile.html', user=user)


# ═══════════════════════════════════════════════════════════════════════════
# MY RECIPES (user dashboard)
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/my-recipes')
@login_required
def my_recipes():
    uid = session['user_id']
    recipes = query('''
        SELECT r.*,
               COALESCE(ROUND(AVG(rt.rating)::numeric,1),0) AS avg_rating,
               COALESCE(SUM(i.price),0) AS total_cost
        FROM recipes r
        LEFT JOIN ratings     rt ON rt.recipe_id = r.id
        LEFT JOIN ingredients i  ON i.recipe_id  = r.id
        WHERE r.user_id = %s
        GROUP BY r.id ORDER BY r.created_at DESC
    ''', (uid,))

    fav_ids = {f['recipe_id'] for f in
               query('SELECT recipe_id FROM favorites WHERE user_id=%s', (uid,))}

    # Stats for this user's dashboard
    stats = {
        'total':    sum(1 for r in recipes),
        'approved': sum(1 for r in recipes if r['status'] == 'approved'),
        'pending':  sum(1 for r in recipes if r['status'] == 'pending'),
        'rejected': sum(1 for r in recipes if r['status'] == 'rejected'),
    }
    return render_template('my_recipes.html', recipes=recipes, fav_ids=fav_ids, stats=stats)


# ═══════════════════════════════════════════════════════════════════════════
# ADD / EDIT / DELETE RECIPE
# ═══════════════════════════════════════════════════════════════════════════

def _save_recipe_details(rid, request):
    """Helper: save/replace ingredients, steps, allergens from form data."""
    execute('DELETE FROM ingredients      WHERE recipe_id=%s', (rid,))
    execute('DELETE FROM recipe_steps     WHERE recipe_id=%s', (rid,))
    execute('DELETE FROM recipe_allergens WHERE recipe_id=%s', (rid,))

    ing_names  = request.form.getlist('ing_name[]')
    ing_prices = request.form.getlist('ing_price[]')
    for idx, (iname, iprice) in enumerate(zip(ing_names, ing_prices)):
        iname = iname.strip()
        if iname:
            execute('INSERT INTO ingredients (recipe_id, name, price, sort_order) '
                    'VALUES (%s,%s,%s,%s)', (rid, iname, int(iprice or 0), idx))

    for idx, step in enumerate(request.form.getlist('step[]'), 1):
        step = step.strip()
        if step:
            execute('INSERT INTO recipe_steps (recipe_id, step_num, instruction) '
                    'VALUES (%s,%s,%s)', (rid, idx, step))

    for a in request.form.get('allergens', '').split(','):
        a = a.strip()
        if a:
            execute('INSERT INTO recipe_allergens (recipe_id, allergen) VALUES (%s,%s)', (rid, a))


@app.route('/recipe/add', methods=['GET', 'POST'])
@login_required
def add_recipe():
    if request.method == 'POST':
        uid  = session['user_id']
        name = request.form['name'].strip()
        desc = request.form['description'].strip()
        emoji     = request.form.get('emoji', '🍽️').strip() or '🍽️'
        cook_time = request.form['cook_time'].strip()
        servings  = int(request.form.get('servings', 4))
        is_spicy  = 'is_spicy'  in request.form
        is_quick  = 'is_quick'  in request.form
        is_budget = 'is_budget' in request.form

        img_path = ''
        if 'image' in request.files:
            f = request.files['image']
            if f and f.filename and allowed_file(f.filename):
                url = upload_to_cloudinary(f, folder='cookingina/recipes')
                if url:
                    img_path = url

        # Admins can publish directly; regular users go to pending
        u = current_user()
        if u['role'] == 'admin':
            status, is_public = 'approved', True
        else:
            status, is_public = 'pending', False

        row = execute('''
            INSERT INTO recipes (user_id, name, description, emoji, image_path,
                                 cook_time, servings, is_spicy, is_quick, is_budget,
                                 status, is_public)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
        ''', (uid, name, desc, emoji, img_path, cook_time,
              servings, is_spicy, is_quick, is_budget, status, is_public))
        rid = row['id']

        _save_recipe_details(rid, request)

        if u['role'] == 'admin':
            flash('Recipe published! 🎉', 'success')
        else:
            flash('Recipe submitted! 🎉 It will appear publicly once approved by an admin.', 'success')
        return redirect(url_for('my_recipes'))

    return render_template('add_recipe.html')


@app.route('/recipe/<int:recipe_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_recipe(recipe_id):
    recipe = get_recipe_full(recipe_id)
    if not recipe:
        flash('Recipe not found.', 'error')
        return redirect(url_for('index'))
    u = current_user()
    if recipe['user_id'] != u['id'] and u['role'] != 'admin':
        flash('You can only edit your own recipes.', 'error')
        return redirect(url_for('index'))

    if request.method == 'POST':
        name      = request.form['name'].strip()
        desc      = request.form['description'].strip()
        emoji     = request.form.get('emoji', '🍽️').strip() or '🍽️'
        cook_time = request.form['cook_time'].strip()
        servings  = int(request.form.get('servings', 4))
        is_spicy  = 'is_spicy'  in request.form
        is_quick  = 'is_quick'  in request.form
        is_budget = 'is_budget' in request.form

        img_path = recipe['image_path']
        if 'image' in request.files:
            f = request.files['image']
            if f and f.filename and allowed_file(f.filename):
                url = upload_to_cloudinary(f, folder='cookingina/recipes')
                if url:
                 img_path = url

        # Re-editing a recipe resets it to pending (unless admin edits)
        new_status    = recipe['status']
        new_is_public = recipe['is_public']
        if u['role'] != 'admin' and recipe['status'] == 'approved':
            new_status    = 'pending'
            new_is_public = False
            flash('Recipe re-submitted for review after editing.', 'info')

        execute('''
            UPDATE recipes SET name=%s, description=%s, emoji=%s, image_path=%s,
            cook_time=%s, servings=%s, is_spicy=%s, is_quick=%s, is_budget=%s,
            status=%s, is_public=%s
            WHERE id=%s
        ''', (name, desc, emoji, img_path, cook_time,
              servings, is_spicy, is_quick, is_budget,
              new_status, new_is_public, recipe_id))

        _save_recipe_details(recipe_id, request)
        flash('Recipe updated! ✅', 'success')
        return redirect(url_for('my_recipes'))

    return render_template('edit_recipe.html', recipe=recipe)


@app.route('/recipe/<int:recipe_id>/delete', methods=['POST'])
@login_required
def delete_recipe(recipe_id):
    recipe = query('SELECT user_id FROM recipes WHERE id=%s', (recipe_id,), one=True)
    u = current_user()
    if not recipe or (recipe['user_id'] != u['id'] and u['role'] != 'admin'):
        flash('Forbidden.', 'error')
        return redirect(url_for('my_recipes'))
    execute('DELETE FROM recipes WHERE id=%s', (recipe_id,))
    flash('Recipe deleted.', 'info')
    return redirect(url_for('my_recipes'))


# ═══════════════════════════════════════════════════════════════════════════
# ADMIN PANEL
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/admin')
@admin_required
def admin_dashboard():
    # Overview stats
    stats = query('''
        SELECT
            COUNT(*) FILTER (WHERE status='pending')  AS pending,
            COUNT(*) FILTER (WHERE status='approved') AS approved,
            COUNT(*) FILTER (WHERE status='rejected') AS rejected,
            COUNT(*) AS total
        FROM recipes
    ''', one=True)

    user_count = query('SELECT COUNT(*) as cnt FROM users WHERE role=%s',
                       ('user',), one=True)

    # 1. FIXED: Added COALESCE to username to fallback if user record is missing
    pending_recipes = query('''
        SELECT r.*, COALESCE(u.username, 'Deleted User') AS username, u.email,
               COALESCE(SUM(i.price),0) AS total_cost
        FROM recipes r
        LEFT JOIN users       u ON r.user_id  = u.id
        LEFT JOIN ingredients i ON i.recipe_id = r.id
        WHERE r.status = 'pending'
        GROUP BY r.id, u.username, u.email
        ORDER BY r.created_at ASC
    ''')

    # 2. FIXED: Added COALESCE to username here too
    recent_recipes = query('''
        SELECT r.*, COALESCE(u.username, 'Deleted User') AS username,
               COALESCE(SUM(i.price),0) AS total_cost
        FROM recipes r
        LEFT JOIN users       u ON r.user_id  = u.id
        LEFT JOIN ingredients i ON i.recipe_id = r.id
        WHERE r.status != 'pending'
        GROUP BY r.id, u.username
        ORDER BY r.reviewed_at DESC NULLS LAST
        LIMIT 20
    ''')

    no_ingredients = query('''
        SELECT COUNT(*) AS cnt FROM recipes r
        WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE i.recipe_id = r.id)
    ''', one=True)

    # 3. FIXED: Added COALESCE to username to safeguard recipe manager data rows
    all_recipes = query('''
        SELECT r.id, r.name, r.emoji, r.status, r.is_public, 
               COALESCE(u.username, 'Deleted User') AS username,
               COUNT(i.id) AS ingredient_count,
               COALESCE(SUM(i.price), 0) AS total_cost
        FROM recipes r
        LEFT JOIN users       u ON r.user_id  = u.id
        LEFT JOIN ingredients i ON i.recipe_id = r.id
        GROUP BY r.id, u.username
        ORDER BY r.name ASC
    ''')

    recent_admin_recipes = query('''
        SELECT r.*
        FROM recipes r
        JOIN users u ON r.user_id = u.id
        WHERE u.role = 'admin'
        ORDER BY r.created_at DESC
        LIMIT 15
    ''')

    return render_template('admin_dashboard.html',
                           stats=stats,
                           user_count=user_count['cnt'],
                           pending_recipes=pending_recipes,
                           recent_recipes=recent_recipes,
                           no_ingredients_count=no_ingredients['cnt'],
                           all_recipes=all_recipes,
                           recent_admin_recipes=recent_admin_recipes)


@app.route('/admin/recipe/<int:recipe_id>/approve', methods=['POST'])
@admin_required
def admin_approve(recipe_id):
    uid = session['user_id']
    execute('''
        UPDATE recipes
        SET status='approved', is_public=TRUE,
            reviewed_at=NOW(), reviewed_by=%s, admin_note=''
        WHERE id=%s
    ''', (uid, recipe_id))
    flash('Recipe approved and published! ✅', 'success')
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/recipe/<int:recipe_id>/reject', methods=['POST'])
@admin_required
def admin_reject(recipe_id):
    uid  = session['user_id']
    note = request.form.get('note', '').strip()
    execute('''
        UPDATE recipes
        SET status='rejected', is_public=FALSE,
            reviewed_at=NOW(), reviewed_by=%s, admin_note=%s
        WHERE id=%s
    ''', (uid, note, recipe_id))
    flash('Recipe rejected.', 'info')
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/recipe/<int:recipe_id>/unpublish', methods=['POST'])
@admin_required
def admin_unpublish(recipe_id):
    uid = session['user_id']
    execute('''
        UPDATE recipes
        SET status='pending', is_public=FALSE,
            reviewed_at=NOW(), reviewed_by=%s
        WHERE id=%s
    ''', (uid, recipe_id))
    flash('Recipe unpublished and moved back to pending.', 'info')
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/users')
@admin_required
def admin_users():
    users = query('''
        SELECT u.*,
               COUNT(DISTINCT r.id)  AS recipe_count,
               COUNT(DISTINCT rv.id) AS review_count
        FROM users u
        LEFT JOIN recipes r  ON r.user_id  = u.id
        LEFT JOIN reviews rv ON rv.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
    ''')
    return render_template('admin_users.html', users=users)


@app.route('/admin/users/<int:uid>/promote', methods=['POST'])
@admin_required
def admin_promote(uid):
    execute("UPDATE users SET role='admin' WHERE id=%s", (uid,))
    flash('User promoted to admin.', 'success')
    return redirect(url_for('admin_users'))


@app.route('/admin/users/<int:uid>/demote', methods=['POST'])
@admin_required
def admin_demote(uid):
    if uid == session['user_id']:
        flash("You can't demote yourself.", 'error')
        return redirect(url_for('admin_users'))
    execute("UPDATE users SET role='user' WHERE id=%s", (uid,))
    flash('Admin demoted to user.', 'info')
    return redirect(url_for('admin_users'))


# ═══════════════════════════════════════════════════════════════════════════
# ADMIN — INGREDIENT MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════

@app.route('/admin/ingredients')
@admin_required
def admin_ingredients():
    """List all recipes with their ingredient counts for the admin panel."""
    recipes = query('''
        SELECT r.id, r.name, r.emoji, r.status, r.is_public,
                COALESCE(u.username, 'Deleted User') AS username,               
                COUNT(i.id) AS ingredient_count,
                COALESCE(SUM(i.price), 0) AS total_cost
        FROM recipes r
        LEFT JOIN users       u ON r.user_id  = u.id
        LEFT JOIN ingredients i ON i.recipe_id = r.id
        GROUP BY r.id, u.username
        ORDER BY r.name ASC
    ''')
    return render_template('admin_ingredients.html', recipes=recipes)


@app.route('/admin/ingredients/<int:recipe_id>', methods=['GET', 'POST'])
@admin_required
def admin_edit_ingredients(recipe_id):
    """Edit ingredients for a specific recipe."""
    recipe = query('SELECT r.*, u.username FROM recipes r '
                   'LEFT JOIN users u ON r.user_id=u.id WHERE r.id=%s',
                   (recipe_id,), one=True)
    if not recipe:
        flash('Recipe not found.', 'error')
        return redirect(url_for('admin_ingredients'))

    if request.method == 'POST':
        ing_names  = request.form.getlist('ing_name[]')
        ing_prices = request.form.getlist('ing_price[]')

        execute('DELETE FROM ingredients WHERE recipe_id=%s', (recipe_id,))
        saved = 0
        for idx, (iname, iprice) in enumerate(zip(ing_names, ing_prices)):
            iname = iname.strip()
            if iname:
                execute('INSERT INTO ingredients (recipe_id, name, price, sort_order) '
                        'VALUES (%s,%s,%s,%s)',
                        (recipe_id, iname, int(iprice or 0), idx))
                saved += 1

        flash(f'Saved {saved} ingredients for "{recipe["name"]}"! ✅', 'success')
        return redirect(url_for('admin_edit_ingredients', recipe_id=recipe_id))

    ingredients = query(
        'SELECT * FROM ingredients WHERE recipe_id=%s ORDER BY sort_order',
        (recipe_id,))

    return render_template('admin_edit_ingredients.html',
                           recipe=recipe,
                           ingredients=ingredients)


@app.route('/admin/ingredients/<int:recipe_id>/add', methods=['POST'])
@admin_required
def admin_add_ingredient(recipe_id):
    """AJAX — add a single ingredient to a recipe."""
    name  = request.json.get('name', '').strip()
    price = int(request.json.get('price', 0))
    if not name:
        return jsonify({'error': 'Name required'}), 400

    max_order = query('SELECT COALESCE(MAX(sort_order),0) AS mx FROM ingredients WHERE recipe_id=%s',
                      (recipe_id,), one=True)
    row = execute(
        'INSERT INTO ingredients (recipe_id, name, price, sort_order) '
        'VALUES (%s,%s,%s,%s) RETURNING id, name, price, sort_order',
        (recipe_id, name, price, max_order['mx'] + 1))
    return jsonify({'id': row['id'], 'name': row['name'],
                    'price': row['price'], 'sort_order': row['sort_order']})


@app.route('/admin/ingredients/item/<int:ing_id>/update', methods=['POST'])
@admin_required
def admin_update_ingredient(ing_id):
    """AJAX — update a single ingredient row."""
    name  = request.json.get('name', '').strip()
    price = int(request.json.get('price', 0))
    if not name:
        return jsonify({'error': 'Name required'}), 400
    execute('UPDATE ingredients SET name=%s, price=%s WHERE id=%s', (name, price, ing_id))
    return jsonify({'status': 'updated', 'name': name, 'price': price})


@app.route('/admin/ingredients/item/<int:ing_id>/delete', methods=['POST'])
@admin_required
def admin_delete_ingredient(ing_id):
    """AJAX — delete a single ingredient."""
    execute('DELETE FROM ingredients WHERE id=%s', (ing_id,))
    return jsonify({'status': 'deleted'})

@app.route('/admin/users/<int:uid>/delete', methods=['POST'])
def admin_delete_user(uid):
    if not is_admin():
        return redirect(url_for('index'))
    
    # Prevent deleting yourself
    if uid == session.get('user_id'):
        flash('You cannot delete your own account.', 'error')
        return redirect(url_for('admin_users'))
    
    # Prevent deleting other admins
    user = query('SELECT role FROM users WHERE id=%s', (uid,), one=True)
    if not user:
        flash('User not found.', 'error')
        return redirect(url_for('admin_users'))
    
    if user['role'] == 'admin':
        flash('Cannot delete an admin account.', 'error')
        return redirect(url_for('admin_users'))
    
    # Delete user (CASCADE handles recipes, reviews, favorites, ratings)
    execute('DELETE FROM users WHERE id=%s', (uid,))
    flash('User deleted successfully.', 'success')
    return redirect(url_for('admin_users'))
# ═══════════════════════════════════════════════════════════════════════════
# DATABASE SEED
# ═══════════════════════════════════════════════════════════════════════════

SAMPLE_RECIPES = [
    {
        'name': 'Adobo Chicken', 'emoji': '🍗', 'cook_time': '45 min',
        'servings': 4, 'is_spicy': False, 'is_quick': False, 'is_budget': True,
        'description': 'A tangy and savory Filipino staple braised in vinegar, soy sauce, and garlic.',
        'allergens': ['soy'],
        'ingredients': [
            ('Chicken', 220), ('Soy sauce', 15), ('Vinegar', 12),
            ('Garlic', 25), ('Bay leaves', 8), ('Black pepper', 10), ('Cooking oil', 20),
        ],
        'steps': [
            'Marinate chicken in soy sauce, vinegar, garlic, and pepper for 30 minutes.',
            'Heat oil in a pan over medium heat. Brown the chicken pieces on all sides.',
            'Pour the marinade over the chicken. Add bay leaves.',
            'Bring to a boil, then reduce heat to low. Simmer for 30 minutes until tender.',
            'Increase heat to reduce sauce until slightly thick. Serve over steamed rice.',
        ],
    },
    {
        'name': 'Beef Pares', 'emoji': '🍜', 'cook_time': '90 min',
        'servings': 4, 'is_spicy': False, 'is_quick': False, 'is_budget': False,
        'description': 'Melt-in-your-mouth braised beef with fragrant star anise and soy-based broth.',
        'allergens': ['soy', 'gluten'],
        'ingredients': [
            ('Beef brisket', 380), ('Soy sauce', 15), ('Sugar', 10),
            ('Star anise', 18), ('Ginger', 12), ('Garlic', 20), ('Onion', 15),
        ],
        'steps': [
            'Boil beef in water for 10 minutes. Discard water and rinse beef.',
            'In a pot, sauté garlic, ginger, and onion. Add beef and brown lightly.',
            'Add soy sauce, sugar, star anise, and enough water to cover the beef.',
            'Simmer on low heat for 60–75 minutes until beef is very tender.',
            'Serve over garlic fried rice with the broth on the side.',
        ],
    },
    {
        'name': 'Spicy Bicol Express', 'emoji': '🌶️', 'cook_time': '40 min',
        'servings': 4, 'is_spicy': True, 'is_quick': False, 'is_budget': True,
        'description': 'A fiery coconut milk stew with pork and chili peppers from Bicol region.',
        'allergens': ['shellfish'],
        'ingredients': [
            ('Pork belly', 250), ('Coconut milk', 90), ('Green chili peppers', 30),
            ('Red siling labuyo', 20), ('Shrimp paste (bagoong)', 35), ('Garlic', 15), ('Onion', 10),
        ],
        'steps': [
            'Blanch pork belly in boiling water to remove impurities. Drain and set aside.',
            'Sauté garlic and onion. Add pork and cook until lightly browned.',
            'Add shrimp paste and stir for 2 minutes.',
            'Pour in coconut milk and bring to a simmer.',
            'Add chili peppers and cook until sauce thickens, about 20 minutes. Season to taste.',
        ],
    },
    {
        'name': 'Tortang Talong', 'emoji': '🥚', 'cook_time': '20 min',
        'servings': 2, 'is_spicy': False, 'is_quick': True, 'is_budget': True,
        'description': 'Charred eggplant omelette — a beloved Filipino breakfast ready in minutes.',
        'allergens': ['eggs'],
        'ingredients': [
            ('Eggplant', 40), ('Eggs', 30), ('Onion', 15),
            ('Garlic', 10), ('Salt', 3), ('Black pepper', 2), ('Cooking oil', 15),
        ],
        'steps': [
            'Grill or broil eggplants until skin is charred and flesh is soft.',
            'Peel the charred skin. Flatten the eggplant with a fork while keeping the stem.',
            'Beat eggs with minced onion, garlic, salt, and pepper.',
            'Dip the flattened eggplant in the egg mixture.',
            'Pan-fry in hot oil until golden on both sides. Serve with banana ketchup.',
        ],
    },
    {
        'name': 'Sinigang na Baboy', 'emoji': '🍲', 'cook_time': '60 min',
        'servings': 6, 'is_spicy': False, 'is_quick': False, 'is_budget': False,
        'description': 'A sour tamarind soup with pork and fresh vegetables — the ultimate Filipino comfort food.',
        'allergens': [],
        'ingredients': [
            ('Pork ribs', 320), ('Tamarind mix', 22), ('Kangkong', 25),
            ('Eggplant', 40), ('String beans (sitaw)', 30), ('Tomatoes', 30), ('Onion', 15),
        ],
        'steps': [
            'Boil pork ribs in water for 10 minutes. Skim off impurities.',
            'Add tomatoes and onion. Continue boiling until pork is half-cooked.',
            'Dissolve tamarind mix in 2 cups water and add to the pot.',
            'Add harder vegetables (eggplant, sitaw) and cook for 5 minutes.',
            'Add kangkong, season with fish sauce. Simmer for 2 more minutes and serve hot.',
        ],
    },
    {
        'name': 'Chicken Tinola', 'emoji': '🍋', 'cook_time': '40 min',
        'servings': 4, 'is_spicy': False, 'is_quick': False, 'is_budget': True,
        'description': 'Light ginger-lemongrass chicken soup with malunggay leaves — nourishing and aromatic.',
        'allergens': [],
        'ingredients': [
            ('Chicken', 200), ('Ginger', 15), ('Malunggay leaves', 20),
            ('Green papaya', 30), ('Fish sauce (patis)', 12), ('Garlic', 10), ('Onion', 10), ('Cooking oil', 15),
        ],
        'steps': [
            'Sauté garlic, onion, and ginger in oil until fragrant.',
            'Add chicken and cook until lightly browned.',
            'Season with fish sauce and add water (about 6 cups).',
            'Bring to a boil, add green papaya, and simmer for 20 minutes.',
            'Add malunggay leaves and cook for 1 minute. Serve hot.',
        ],
    },
    {
        'name': 'Sinangag at Itlog', 'emoji': '🍳', 'cook_time': '10 min',
        'servings': 2, 'is_spicy': False, 'is_quick': True, 'is_budget': True,
        'description': 'Classic garlic fried rice with sunny-side up eggs — the ultimate Filipino breakfast.',
        'allergens': ['eggs'],
        'ingredients': [
            ('Cooked rice', 20), ('Eggs', 20), ('Garlic', 10),
            ('Cooking oil', 10), ('Salt', 2), ('Soy sauce', 8),
        ],
        'steps': [
            'Heat oil in a pan and fry minced garlic until golden and crispy.',
            'Add cold cooked rice and stir-fry over high heat for 3 minutes.',
            'Season with salt and a splash of soy sauce. Set aside.',
            'In the same pan, fry eggs sunny-side up.',
            'Plate the garlic rice with the egg on top. Serve hot.',
        ],
    },
]
@app.route('/review/<int:review_id>/reply', methods=['POST'])
def reply_review(review_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Login required'}), 401
    
    data = request.get_json()
    comment = data.get('comment', '').strip()
    parent_reply_id = data.get('parent_reply_id', None)
    
    if not comment:
        return jsonify({'error': 'Empty comment'}), 400
    
    with get_db() as db:
        cur = db.cursor()
        cur.execute('''
            INSERT INTO review_replies (review_id, user_id, parent_reply_id, comment)
            VALUES (%s, %s, %s, %s) RETURNING id
        ''', (review_id, session['user_id'], parent_reply_id, comment))
        reply_id = cur.fetchone()['id']
        
        cur.execute('SELECT username, profile_image FROM users WHERE id = %s',
                   (session['user_id'],))
        user = cur.fetchone()
        db.commit()
    
    return jsonify({
        'id': reply_id,
        'review_id': review_id,
        'parent_reply_id': parent_reply_id,
        'comment': comment,
        'username': user['username'],
        'profile_image': user['profile_image'],
        'created_at': 'Just now',
        'user_id': session['user_id']
    })


@app.route('/reply/<int:reply_id>/delete', methods=['POST'])
def delete_reply(reply_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Login required'}), 401
    
    with get_db() as db:
        cur = db.cursor()
        cur.execute('SELECT user_id FROM review_replies WHERE id = %s', (reply_id,))
        reply = cur.fetchone()
        if not reply:
            return jsonify({'error': 'Not found'}), 404
        
        cur.execute('SELECT role FROM users WHERE id = %s', (session['user_id'],))
        user = cur.fetchone()
        if reply['user_id'] != session['user_id'] and user['role'] != 'admin':
            return jsonify({'error': 'Forbidden'}), 403
        
        cur.execute('DELETE FROM review_replies WHERE id = %s', (reply_id,))
        db.commit()
    
    return jsonify({'status': 'deleted'})


def seed_db():
    count = query('SELECT COUNT(*) as cnt FROM recipes', one=True)
    if count and count['cnt'] > 0:
        return
    print('Seeding database...')

    pw_hash = generate_password_hash('demo1234')
    # Create admin account
    row = execute(
        "INSERT INTO users (username,email,password_hash,bio,role) VALUES (%s,%s,%s,%s,'admin') RETURNING id",
        ('chef_admin', 'admin@CookingINA.com', pw_hash, 'Cooking INA admin account 🍽️'))
    uid = row['id']

    for r in SAMPLE_RECIPES:
        row2 = execute('''
            INSERT INTO recipes (user_id, name, description, emoji, cook_time,
                                 servings, is_spicy, is_quick, is_budget, image_path,
                                 status, is_public)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'approved',TRUE) RETURNING id
        ''', (uid, r['name'], r['description'], r['emoji'], r['cook_time'],
              r['servings'], r['is_spicy'], r['is_quick'], r['is_budget'], r.get('image_path', '')))
        rid = row2['id']

        for idx, (iname, iprice) in enumerate(r['ingredients']):
            execute('INSERT INTO ingredients (recipe_id, name, price, sort_order) VALUES (%s,%s,%s,%s)',
                    (rid, iname, iprice, idx))
        for idx, step in enumerate(r['steps'], 1):
            execute('INSERT INTO recipe_steps (recipe_id, step_num, instruction) VALUES (%s,%s,%s)',
                    (rid, idx, step))
        for allergen in r['allergens']:
            execute('INSERT INTO recipe_allergens (recipe_id, allergen) VALUES (%s,%s)',
                    (rid, allergen))

    print(f'Seeded {len(SAMPLE_RECIPES)} recipes. Admin: chef_admin / demo1234')


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))