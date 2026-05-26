# Cooking INA — Dev Chat Summary

## Project
Filipino recipe web app built with **Flask + PostgreSQL + Jinja2**.  
Started from an existing codebase and progressively extended it with an admin approval system, ingredient management, and admin dashboard features.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python / Flask |
| Database | PostgreSQL + psycopg2 |
| Auth | Session-based (Flask sessions) + Werkzeug password hashing |
| Frontend | Vanilla JS + Jinja2 templates |
| Fonts | Fraunces + Outfit via Google Fonts |
| No frontend framework | Pure HTML / CSS / JS |

---

## Project Structure

```
Cooking INA/
├── app.py                          ← All Flask routes & logic
├── requirements.txt                ← flask, psycopg2-binary, werkzeug
│
├── database/
│   ├── schema.sql                  ← Full fresh schema (fresh installs only)
│   └── migrate_v2.sql              ← Safe migration for existing databases
│
├── static/
│   ├── css/
│   │   ├── style.css               ← Main stylesheet (dark mode, cards, forms)
│   │   └── style_additions.css     ← v2 additions (append to style.css)
│   ├── js/
│   │   └── script.js               ← Modal, AJAX, TTS, voice search, dark mode
│   └── uploads/                    ← User-uploaded images (auto-created)
│
└── templates/
    ├── index.html                  ← Homepage (recipe grid, search, filters)
    ├── login.html                  ← Login page
    ├── register.html               ← Registration page
    ├── profile.html                ← Public user profile
    ├── edit_profile.html           ← Edit bio + avatar
    ├── my_recipes.html             ← User dashboard (status badges, stats)
    ├── add_recipe.html             ← Add new recipe form
    ├── edit_recipe.html            ← Edit existing recipe form
    ├── admin_dashboard.html        ← Admin panel (tabs: pending, history, ingredients, add recipe)
    ├── admin_users.html            ← User management (promote/demote)
    ├── admin_ingredients.html      ← Recipe list with ingredient counts
    └── admin_edit_ingredients.html ← Per-recipe ingredient editor
```

---

## Setup Instructions

### Fresh Install

```bash
# 1. Install dependencies
pip install flask psycopg2-binary werkzeug

# 2. Create the database
createdb Cooking INA
psql Cooking INA < database/schema.sql

# 3. Set environment variables (optional)
export SECRET_KEY="your-secret-key"
export DATABASE_URL="postgresql://localhost/Cooking INA"

# 4. Run
python app.py
```

App will auto-seed 7 sample recipes and create the `chef_admin` account on first run.

---

### Upgrade Existing Database (v2 Migration)

Do **not** run `schema.sql` — it drops all tables. Use the migration instead:

```bash
# Option 1 — Command line
psql -U postgres -d Cooking INA -f database/migrate_v2.sql

# Option 2 — pgAdmin
# Open pgAdmin → Query Tool → paste migrate_v2.sql contents → Run (F5)
```

The migration safely adds new columns using `IF NOT EXISTS` checks.  
Safe to run more than once.

---

### Files to Replace / Add (v2 Upgrade)

| File | Action |
|---|---|
| `app.py` | **Replace** |
| `database/migrate_v2.sql` | **Run once** |
| `templates/admin_dashboard.html` | **Replace** |
| `templates/my_recipes.html` | **Replace** |
| `templates/admin_users.html` | **Add new** |
| `templates/admin_ingredients.html` | **Add new** |
| `templates/admin_edit_ingredients.html` | **Add new** |
| `static/css/style_additions.css` | **Append to `style.css`** |
| Everything else | **Leave alone** |

**Small manual edits** also needed in 3 existing templates (see `TEMPLATE_PATCHES.txt`):
- `index.html` — add admin nav link
- `profile.html` — add status badges on recipe cards
- `add_recipe.html` — add pending approval notice

---

## Feature Overview

### Authentication
- Register, login, logout
- Secure bcrypt password hashing via Werkzeug
- Session-based auth with `@login_required` and `@admin_required` decorators
- Role system: `user` or `admin`

### Recipe CRUD
- Create, read, edit, delete recipes
- Image upload (jpg, jpeg, png, webp)
- Editing an approved recipe resets it to `pending` for re-review

### Public Homepage
- Recipe grid with search by name, ingredient, or allergen
- Filters: All / Spicy / Quick / Budget / Favorites
- Favorites toggle (AJAX, no page reload)
- Star ratings 1–5 (AJAX)
- Reviews / comments (AJAX post + delete)
- Voice search (Web Speech API)
- Text-to-speech hands-free cooking mode
- Dark mode with localStorage persistence

### User Dashboard (`/my-recipes`)
- Shows all own recipes with status badges: ✅ Published / ⏳ Pending / ❌ Rejected
- Stats bar: total, approved, pending, rejected counts
- Rejection notes from admin shown in red callout
- Edit / Delete actions per recipe

### Admin Approval Workflow
Upload → `status=pending` (hidden from public) → Admin reviews → Approve or Reject → public.

| Status | Visible to guests | Visible to owner | Visible to admin |
|---|---|---|---|
| `pending` | ❌ | ✅ | ✅ |
| `approved` | ✅ | ✅ | ✅ |
| `rejected` | ❌ | ✅ (with note) | ✅ |

Admins bypass the approval queue — their recipes publish immediately.

### Admin Dashboard (`/admin`)
Four tabs:

**⏳ Pending Review**
- Table of all pending recipes with Approve / Reject / Edit actions
- Reject opens a modal with an optional note field for the creator

**📜 Review History**
- All approved and rejected recipes
- Re-approve or Unpublish actions

**🧂 Add Ingredients**
- Dropdown to pick any recipe
- Loads existing ingredients via AJAX
- Same row-style form as the user recipe form (name + ₱ price + ✕ remove)
- `+ Add Ingredient` button, Save submits all rows at once

**➕ Add Recipe**
- `+ Add Recipe` button also in the admin header banner
- Opens a full modal with the complete recipe form:
  name, emoji, description, cook time, servings, photo, tags, allergens, ingredients, steps
- Published immediately (no approval step)
- Tab shows a table of recently admin-added recipes

### Admin User Management (`/admin/users`)
- Full user list with recipe count, review count, join date
- Promote any user to admin
- Demote any admin to user (cannot demote yourself)

### Profile Pages
- Public profile with avatar, bio, stats (recipes, avg rating, reviews, join date)
- Own profile shows all recipes with status badges
- Other users' profiles show only approved public recipes

---

## Database Schema

| Table | Key Columns |
|---|---|
| `users` | `id`, `username`, `email`, `password_hash`, `bio`, `profile_image`, `role`, `created_at` |
| `recipes` | `id`, `user_id`, `name`, `description`, `emoji`, `image_path`, `cook_time`, `servings`, `is_spicy`, `is_quick`, `is_budget`, `status`, `is_public`, `admin_note`, `reviewed_at`, `reviewed_by`, `created_at` |
| `ingredients` | `id`, `recipe_id`, `name`, `price`, `sort_order` |
| `recipe_steps` | `id`, `recipe_id`, `step_num`, `instruction` |
| `recipe_allergens` | `id`, `recipe_id`, `allergen` |
| `favorites` | `user_id`, `recipe_id` |
| `ratings` | `user_id`, `recipe_id`, `rating` (1–5) |
| `reviews` | `id`, `user_id`, `recipe_id`, `comment`, `created_at` |

---

## All Routes

| Method | Route | Description |
|---|---|---|
| GET | `/` | Homepage with recipe grid |
| GET | `/recipe/<id>` | Recipe detail (AJAX JSON) |
| POST | `/favorite/<id>` | Toggle favorite |
| POST | `/rate/<id>` | Rate recipe |
| POST | `/review/<id>` | Post review |
| POST | `/review/<id>/delete` | Delete review |
| GET/POST | `/register` | Register |
| GET/POST | `/login` | Login |
| GET | `/logout` | Logout |
| GET | `/user/<username>` | User profile |
| GET/POST | `/profile/edit` | Edit own profile |
| GET | `/my-recipes` | User dashboard |
| GET/POST | `/recipe/add` | Add recipe |
| GET/POST | `/recipe/<id>/edit` | Edit recipe |
| POST | `/recipe/<id>/delete` | Delete recipe |
| GET | `/admin` | Admin dashboard |
| POST | `/admin/recipe/<id>/approve` | Approve recipe |
| POST | `/admin/recipe/<id>/reject` | Reject with note |
| POST | `/admin/recipe/<id>/unpublish` | Unpublish recipe |
| GET | `/admin/users` | User list |
| POST | `/admin/users/<id>/promote` | Promote to admin |
| POST | `/admin/users/<id>/demote` | Demote to user |
| GET | `/admin/ingredients` | Ingredient manager list |
| GET/POST | `/admin/ingredients/<id>` | Edit recipe ingredients |
| POST | `/admin/ingredients/<id>/add` | AJAX add ingredient |
| POST | `/admin/ingredients/item/<id>/update` | AJAX update ingredient |
| POST | `/admin/ingredients/item/<id>/delete` | AJAX delete ingredient |

---

## Bugs Fixed

- **`TemplateSyntaxError: expected token 'end of statement block', got '='`**  
  Cause: `data-empty="1"` attribute inside a `{% if %}` block inside an `<option>` tag — Jinja2 cannot parse HTML attributes that way.  
  Fix: Removed the attribute entirely, kept only text content inside `<option>`.

---

## Admin Credentials (seed data)

| Field | Value |
|---|---|
| Username | `chef_admin` |
| Password | `demo1234` |
| Role | `admin` |
