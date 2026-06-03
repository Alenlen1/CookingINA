# Cooking INA 

A full-stack Filipino recipe-sharing web application built with Python and Flask. CookingINA lets users discover, share, and manage recipes, interact with an AI-powered cooking chatbot, rate and review recipes, play a cooking mini-game, and more — all in one platform.

---

## Features

**Recipes**
- Browse, search, and filter recipes (by name, ingredient, spicy, quick, and budget-friendly)
- Add, edit, and delete your own recipes
- Upload recipe images via Cloudinary
- Favorite recipes and manage your personal collection
- Rate recipes (1–5 stars) and view average ratings

**Community**
- Post, edit, and delete reviews on recipes (with optional image uploads)
- Reply to reviews and react with likes/dislikes
- View other users' profiles and their public recipes

**User Accounts**
- Register with email and OTP verification (sent via SendGrid)
- Login with email or username
- Forgot password flow with OTP code sent to your email
- Change password from your profile settings
- Edit your profile (bio + profile picture upload via Cloudinary)

**AI Chatbot — "INA"**
- Built-in cooking assistant powered by Google Gemini AI (`google-genai`)
- Available as a full chat page (`/chat`) and as an embedded widget on all pages
- Persistent chat history per session

**Admin Dashboard**
- Manage all users (promote to admin, demote, delete)
- Manage and edit ingredients across all recipes
- Approve, reject, and unpublish recipes
- Overview stats: total, pending, approved, rejected recipe counts
- View recently added and pending recipes

**Cooking Game**
- A fun cooking-themed mini game built into the app (`/game`)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, Flask 3.1 |
| Database | PostgreSQL (psycopg2-binary) |
| Frontend | HTML, CSS, JavaScript (Jinja2 templates) |
| AI Chatbot | Google Gemini AI (`google-genai` 2.6.0) |
| Image Uploads | Cloudinary |
| Authentication | Session-based with OTP email verification |
| Email (OTP) | SendGrid |
| Deployment | Gunicorn |
| Environment | python-dotenv |

---

## Project Structure

```
CookingINA/
├── app.py                      # Main Flask application and all core routes
├── chatbot.py                  # Chatbot blueprint (Google Gemini AI)
├── requirements.txt            # Python dependencies
├── .env                        # Environment variables (not committed)
├── .gitignore
├── database/
│   ├── schema.sql              # Main database schema
│   ├── migrate_v2.sql
│   ├── migrate_chatbot.sql
│   └── migrate_reactions.sql
├── routes/
│   ├── __init__.py
│   └── auth.py                 # OTP registration, forgot password, change password
├── templates/                  # Jinja2 HTML templates
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── forgot_password.html
│   ├── profile.html
│   ├── edit_profile.html
│   ├── add_recipe.html
│   ├── edit_recipe.html
│   ├── my_recipes.html
│   ├── chat.html
│   ├── chatbot_widget.html
│   ├── nav_voice_widget.html
│   ├── game.html
│   ├── admin_dashboard.html
│   ├── admin_users.html
│   ├── admin_ingredients.html
│   └── admin_edit_ingredients.html
└── static/
    ├── favicon.ico
    ├── images/
    │   └── ina-avatar.png
    ├── css/
    │   ├── style.css
    │   ├── style_additions.css
    │   ├── auth_modals.css
    │   ├── chatbot.css
    │   ├── edit_profile.css
    │   └── game.css
    └── js/
        ├── script.js
        ├── auth.js
        ├── chatbot.js
        ├── game.js
        └── terms.js
```

---

## Getting Started

### Prerequisites

- Python 3.12 or higher
- PostgreSQL database
- A Cloudinary account (for image uploads)
- A Google Cloud project with Gemini AI enabled
- A SendGrid account (for OTP and password reset emails)

### Installation

1. **Clone the repository**

git clone https://github.com/Alenlen1/CookingINA.git
cd CookingINA

2. **Create and activate a virtual environment**

python -m venv venv
source venv/bin/activate        # On Windows: venv\Scripts\activate


3. **Install dependencies**

pip install -r requirements.txt

4. **Set up environment variables**

Create a `.env` file in the root directory:

SECRET_KEY=your_secret_key

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/cookingina

# Cloudinary (image uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Google Gemini AI (chatbot)
GEMINI_API_KEY=your_gemini_api_key

# SendGrid (OTP and password reset emails)
MAIL_USERNAME=yourgmail@gmail.com
SENDGRID_API_KEY=your_sendgrid_api_key
```

5. **Set up the database**

Run the SQL scripts in this order against your PostgreSQL database:

psql -U your_user -d cookingina -f database/schema.sql
psql -U your_user -d cookingina -f database/migrate_v2.sql
psql -U your_user -d cookingina -f database/migrate_chatbot.sql
psql -U your_user -d cookingina -f database/migrate_reactions.sql


6. **Run the application**

python app.py

The app will be available at `http://localhost:5000`.

---

## How Registration Works

CookingINA uses email OTP verification for registration:

1. User fills in the registration form
2. A 6-digit OTP code is sent to their email via SendGrid
3. User enters the OTP to verify and activate their account
4. The same OTP flow is used for forgot password 

---

## Recipe Moderation

Recipes go through an approval workflow:

- **Regular users** submit recipes, which start in `pending` status and are hidden from the public until reviewed.
- **Admins** can approve (publish), reject, or unpublish recipes from the admin dashboard.
- **Admins** can also add notes when rejecting a recipe.
- Recipe owners can resubmit a recipe for review after editing it.

---

## Admin Panel

Access the admin dashboard at `/admin` (requires admin role).

Key capabilities:
- **Recipe management** — approve, reject, unpublish, edit ingredients
- **User management** — promote users to admin, demote admins, delete users
- **Stats overview** — see pending, approved, and rejected recipe counts at a glance

---

## Deployment

This app is deployment-ready with Gunicorn. When deploying to platforms like Render or Railway:

1. Set all `.env` variables in the platform's environment settings
2. Use a strong random `SECRET_KEY`
3. Make sure your PostgreSQL database URL is set correctly
4. Run the database migration scripts against your production database

---

## Dependencies

Key packages (see `requirements.txt` for pinned versions):

| Package | Purpose |
|---|---|
| Flask 3.1 | Web framework |
| psycopg2-binary | PostgreSQL driver |
| google-genai | Gemini AI chatbot |
| cloudinary | Image upload/storage |
| sendgrid | Transactional email (OTP) |
| python-dotenv | Environment variable loading |
| gunicorn | Production WSGI server |
| Werkzeug | Password hashing, security utilities |

---

## Contributing

Contributions and suggestions are welcome. Please open an issue or submit a pull request.
