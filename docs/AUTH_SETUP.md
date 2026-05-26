# ================================================================
# Cooking INA — Complete Auth System Setup Guide
# Features: Email Verification + Forgot Password + Change Password
# ================================================================


## FILES DELIVERED
## ================
##
##   routes/auth.py          → place in your project root/routes/
##   templates/register.html → REPLACE existing register.html
##   templates/login.html    → REPLACE existing login.html
##   templates/forgot_password.html → NEW template
##   templates/edit_profile.html    → REPLACE existing edit_profile.html
##   static/css/auth_modals.css     → NEW file
##   static/js/auth.js              → NEW file


## STEP 1 — Install dependencies
## ================================
pip install Flask-Mail python-dotenv

## Add to requirements.txt:
Flask-Mail==0.10.0
python-dotenv==1.0.1


## STEP 2 — Gmail App Password setup
## ====================================
## 1. Go to your Google Account → Security
## 2. Enable 2-Step Verification (required)
## 3. Search "App passwords" → create one for "Mail"
## 4. Copy the 16-character password (no spaces)
## 5. Use it as MAIL_PASSWORD below


## STEP 3 — Create .env file
## ============================
## Create a file named ".env" in the same folder as app.py:

SECRET_KEY=change-this-to-a-long-random-string-in-production
DATABASE_URL=postgresql://postgres:admin123@localhost:5432/cookingina
MAIL_USERNAME=yourgmail@gmail.com
MAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx
GEMINI_API_KEY=your-gemini-key-here


## STEP 4 — Patch app.py (5 precise additions)
## ==============================================

## ── A) Very top of app.py (line 1), before anything else: ──────
from dotenv import load_dotenv
load_dotenv()

## ── B) After existing imports (after "from datetime import datetime"): ──
from flask_mail import Mail
from routes.auth import auth_bp

## ── C) After app.secret_key = ... line: ────────────────────────
# Flask-Mail configuration
app.config['MAIL_SERVER']   = 'smtp.gmail.com'
app.config['MAIL_PORT']     = 587
app.config['MAIL_USE_TLS']  = True
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = (
    'Cooking INA', os.environ.get('MAIL_USERNAME'))
# Larger session for storing pending registrations securely
app.config['SESSION_COOKIE_SECURE']   = False  # True in production (HTTPS)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 600  # 10 min

mail = Mail(app)
app.register_blueprint(auth_bp)

## ── D) REMOVE (or comment out) the old register route: ─────────
## DELETE this entire function from app.py:
#
# @app.route('/register', methods=['GET', 'POST'])
# def register():
#     ...


## STEP 5 — Create routes/__init__.py (empty file)
## =================================================
## Create this file so Python treats routes/ as a package:
##   routes/__init__.py   (empty)


## STEP 6 — Add "Forgot Password?" link to existing login.html
## ============================================================
## (Already included in the delivered login.html replacement)
## The link points to: url_for('auth.forgot_password')


## STEP 7 — Verify file structure
## ================================
##
## cooking-ina/
## ├── app.py                          (patched — 5 additions)
## ├── chatbot.py                      (unchanged)
## ├── .env                            (NEW — add to .gitignore!)
## ├── routes/
## │   ├── __init__.py                 (NEW — empty file)
## │   └── auth.py                     (NEW — blueprint)
## ├── templates/
## │   ├── register.html               (REPLACED)
## │   ├── login.html                  (REPLACED)
## │   ├── forgot_password.html        (NEW)
## │   └── edit_profile.html          (REPLACED)
## ├── static/
## │   ├── css/
## │   │   └── auth_modals.css         (NEW)
## │   └── js/
## │       └── auth.js                 (NEW)


## STEP 8 — Test the system
## ==========================
## 1. python app.py
## 2. Visit /register → fill form → "Create Account"
##    → OTP modal should open → check Gmail
## 3. Visit /login → click "Forgot password?"
##    → enter email → enter code → set new password
## 4. Visit /profile/edit → scroll to "Change Password" section


## ROUTES ADDED
## ==============
##   GET  /register                    → register page
##   POST /register/initiate           → send OTP
##   POST /register/verify             → verify OTP + create account
##   POST /register/resend             → resend OTP
##   GET  /forgot-password             → forgot password page
##   POST /forgot-password/send        → send reset code
##   POST /forgot-password/verify      → verify reset code
##   POST /forgot-password/reset       → set new password
##   POST /forgot-password/resend      → resend reset code
##   POST /settings/change-password    → change password (logged in)


## TROUBLESHOOTING
## ================
## "SMTPAuthenticationError" → wrong Gmail App Password
## "less secure app" error   → you need an App Password, not your Gmail password
## Modal not appearing       → make sure auth_modals.css and auth.js are linked
## "No module named routes"  → create routes/__init__.py (empty file)
## Session data lost         → increase SESSION_COOKIE_LIFETIME or use server sessions


## PRODUCTION NOTES (Render / Railway)
## =====================================
## 1. Set all .env variables in the platform's environment settings
## 2. Change SESSION_COOKIE_SECURE = True (requires HTTPS)
## 3. Use a strong random SECRET_KEY (python -c "import secrets; print(secrets.token_hex(32))")
## 4. Consider Flask-Session with Redis/DB for multi-worker session storage
