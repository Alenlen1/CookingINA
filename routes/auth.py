"""
routes/auth.py
==============
Complete authentication blueprint for Cooking INA.
Covers:
  • Email-verified registration (Feature 1)
  • Forgot password with email OTP  (Feature 2)
  • Change password in settings     (Feature 3)

Integration (add to app.py):
    from routes.auth import auth_bp
    app.register_blueprint(auth_bp)

Then remove / comment out the old @app.route('/register') in app.py.
"""

import random
import string
from datetime import datetime, timedelta

from flask import (Blueprint, render_template, request, jsonify,
                   session, flash, redirect, url_for, current_app)
from werkzeug.security import generate_password_hash, check_password_hash
from flask import Blueprint
auth_bp = Blueprint('auth', __name__)


# ── Internal helpers ─────────────────────────────────────────────────────────

def _db():
    from app import query, execute
    return query, execute


def _mail():
    return current_app.extensions.get('mail')


def _code() -> str:
    """Cryptographically-safe 6-digit numeric OTP."""
    return ''.join(random.SystemRandom().choices(string.digits, k=6))


def _session_key(prefix: str, identifier: str) -> str:
    return f'{prefix}_{identifier}'


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE 1 — EMAIL-VERIFIED REGISTRATION
# ═══════════════════════════════════════════════════════════════════════════

@auth_bp.route('/register', methods=['GET'])
def register():
    return render_template('register.html')


@auth_bp.route('/register/initiate', methods=['POST'])
def register_initiate():
    """
    Step 1: validate form, send OTP, store pending data in session.
    Returns JSON → frontend opens verification modal.
    """
    query, execute = _db()
    data = request.get_json() or {}

    username = data.get('username', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')
    confirm  = data.get('confirm', '')

    # ── Field validation ──────────────────────────────────────────────────
    if not all([username, email, password, confirm]):
        return jsonify({'ok': False, 'error': 'All fields are required.'}), 400

    if len(username) < 3 or len(username) > 50:
        return jsonify({'ok': False, 'error': 'Username must be 3–50 characters.'}), 400

    if not _valid_email(email):
        return jsonify({'ok': False, 'error': 'Enter a valid email address.'}), 400

    if len(password) < 8:
        return jsonify({'ok': False, 'error': 'Password must be at least 8 characters.'}), 400

    if password != confirm:
        return jsonify({'ok': False, 'error': 'Passwords do not match.'}), 400

    # ── Duplicate check ───────────────────────────────────────────────────
    existing = query(
        'SELECT username, email FROM users WHERE LOWER(username)=%s OR LOWER(email)=%s',
        (username.lower(), email), one=True
    )
    if existing:
        if existing['username'].lower() == username.lower():
            return jsonify({'ok': False, 'error': 'Username is already taken.'}), 409
        return jsonify({'ok': False, 'error': 'Email is already registered. Try logging in.'}), 409

    # ── Resend cooldown (30s) ─────────────────────────────────────────────
    skey    = _session_key('reg', email)
    pending = session.get(skey)
    if pending:
        sent_at   = datetime.fromisoformat(pending['sent_at'])
        wait_until = sent_at + timedelta(seconds=30)
        if datetime.utcnow() < wait_until:
            secs = int((wait_until - datetime.utcnow()).total_seconds())
            return jsonify({'ok': False, 'error': f'Please wait {secs}s before retrying.',
                            'cooldown': secs}), 429

    # ── Store pending registration in session ─────────────────────────────
    code = _code()
    session[skey] = {
        'username': username,
        'email':    email,
        'pw_hash':  generate_password_hash(password),
        'code':     code,
        'expires':  (datetime.utcnow() + timedelta(minutes=5)).isoformat(),
        'sent_at':  datetime.utcnow().isoformat(),
        'attempts': 0,
    }
    session.modified = True

    # ── Send email ────────────────────────────────────────────────────────
    ok, err = _send_otp_email(email, username, code, 'verify')
    if not ok:
        return jsonify({'ok': False,
                        'error': f'Could not send email: {err}. Check Gmail App Password setup.'}), 500

    return jsonify({'ok': True, 'email': email,
                    'message': f'Verification code sent to {email}'})


@auth_bp.route('/register/verify', methods=['POST'])
def register_verify():
    """Step 2: check OTP, create account."""
    query, execute = _db()
    data  = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    code  = data.get('code', '').strip()

    if not email or not code:
        return jsonify({'ok': False, 'error': 'Missing email or code.'}), 400

    skey    = _session_key('reg', email)
    pending = session.get(skey)

    if not pending:
        return jsonify({'ok': False, 'error': 'Session expired. Please register again.',
                        'restart': True}), 400

    # Expiry
    if datetime.utcnow() > datetime.fromisoformat(pending['expires']):
        session.pop(skey, None)
        return jsonify({'ok': False, 'error': 'Code expired. Click "Resend Code".',
                        'expired': True}), 400

    # Attempt limit (5)
    pending['attempts'] += 1
    session[skey] = pending
    session.modified = True

    if pending['attempts'] > 5:
        session.pop(skey, None)
        return jsonify({'ok': False, 'error': 'Too many attempts. Please register again.',
                        'restart': True}), 429

    # Wrong code
    if code != pending['code']:
        left = max(0, 5 - pending['attempts'])
        return jsonify({'ok': False,
                        'error': f'Incorrect code — {left} attempt{"s" if left != 1 else ""} left.'}), 400

    # Race-condition guard
    if query('SELECT id FROM users WHERE LOWER(username)=%s OR LOWER(email)=%s',
             (pending['username'].lower(), email), one=True):
        session.pop(skey, None)
        return jsonify({'ok': False, 'error': 'Account already exists. Please log in.'}), 409

    # Create account
    execute(
        'INSERT INTO users (username, email, password_hash, role) VALUES (%s,%s,%s,%s)',
        (pending['username'], email, pending['pw_hash'], 'user')
    )
    session.pop(skey, None)

    return jsonify({'ok': True,
                    'message': f'Welcome to Cooking INA, {pending["username"]}! 🎉',
                    'redirect': url_for('login')})


@auth_bp.route('/register/resend', methods=['POST'])
def register_resend():
    """Resend registration OTP (30s cooldown)."""
    data  = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    if not email:
        return jsonify({'ok': False, 'error': 'Missing email.'}), 400

    skey    = _session_key('reg', email)
    pending = session.get(skey)
    if not pending:
        return jsonify({'ok': False, 'error': 'Session expired. Please register again.',
                        'restart': True}), 400

    sent_at    = datetime.fromisoformat(pending['sent_at'])
    wait_until = sent_at + timedelta(seconds=30)
    if datetime.utcnow() < wait_until:
        secs = int((wait_until - datetime.utcnow()).total_seconds())
        return jsonify({'ok': False, 'error': f'Wait {secs}s before resending.',
                        'cooldown': secs}), 429

    new_code = _code()
    pending.update({
        'code':     new_code,
        'expires':  (datetime.utcnow() + timedelta(minutes=5)).isoformat(),
        'sent_at':  datetime.utcnow().isoformat(),
        'attempts': 0,
    })
    session[skey]    = pending
    session.modified = True

    ok, err = _send_otp_email(email, pending['username'], new_code, 'verify')
    if not ok:
        return jsonify({'ok': False, 'error': f'Could not resend: {err}'}), 500

    return jsonify({'ok': True, 'message': 'New code sent! Check your inbox.'})


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE 2 — FORGOT PASSWORD
# ═══════════════════════════════════════════════════════════════════════════

@auth_bp.route('/forgot-password', methods=['GET'])
def forgot_password():
    return render_template('forgot_password.html')


@auth_bp.route('/forgot-password/send', methods=['POST'])
def forgot_send():
    """Step 1: look up email, send OTP."""
    query, _ = _db()
    data  = request.get_json() or {}
    email = data.get('email', '').strip().lower()

    if not email:
        return jsonify({'ok': False, 'error': 'Enter your email address.'}), 400

    user = query('SELECT id, username FROM users WHERE LOWER(email)=%s', (email,), one=True)
    # Always return success to prevent email enumeration
    if not user:
        return jsonify({'ok': True, 'email': email,
                        'message': 'If that email exists, a code has been sent.'})

    # Cooldown
    skey    = _session_key('reset', email)
    pending = session.get(skey)
    if pending:
        sent_at    = datetime.fromisoformat(pending['sent_at'])
        wait_until = sent_at + timedelta(seconds=30)
        if datetime.utcnow() < wait_until:
            secs = int((wait_until - datetime.utcnow()).total_seconds())
            return jsonify({'ok': False, 'error': f'Please wait {secs}s before retrying.',
                            'cooldown': secs}), 429

    code = _code()
    session[skey] = {
        'user_id':  user['id'],
        'username': user['username'],
        'email':    email,
        'code':     code,
        'expires':  (datetime.utcnow() + timedelta(minutes=5)).isoformat(),
        'sent_at':  datetime.utcnow().isoformat(),
        'attempts': 0,
        'verified': False,
    }
    session.modified = True

    ok, err = _send_otp_email(email, user['username'], code, 'reset')
    if not ok:
        return jsonify({'ok': False, 'error': f'Could not send email: {err}'}), 500

    return jsonify({'ok': True, 'email': email,
                    'message': 'Reset code sent! Check your inbox.'})


@auth_bp.route('/forgot-password/verify', methods=['POST'])
def forgot_verify():
    """Step 2: verify OTP, mark session as allowed to reset."""
    data  = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    code  = data.get('code', '').strip()

    skey    = _session_key('reset', email)
    pending = session.get(skey)

    if not pending:
        return jsonify({'ok': False, 'error': 'Session expired. Please start again.',
                        'restart': True}), 400

    if datetime.utcnow() > datetime.fromisoformat(pending['expires']):
        session.pop(skey, None)
        return jsonify({'ok': False, 'error': 'Code expired. Request a new one.',
                        'expired': True}), 400

    pending['attempts'] += 1
    session[skey]    = pending
    session.modified = True

    if pending['attempts'] > 5:
        session.pop(skey, None)
        return jsonify({'ok': False, 'error': 'Too many attempts. Please start again.',
                        'restart': True}), 429

    if code != pending['code']:
        left = max(0, 5 - pending['attempts'])
        return jsonify({'ok': False,
                        'error': f'Incorrect code — {left} attempt{"s" if left != 1 else ""} left.'}), 400

    # Mark as OTP-verified so /forgot-password/reset can accept the new password
    pending['verified'] = True
    session[skey]       = pending
    session.modified    = True

    return jsonify({'ok': True, 'message': 'Code verified! Set your new password.'})


@auth_bp.route('/forgot-password/reset', methods=['POST'])
def forgot_reset():
    """Step 3: set new password (only if OTP already verified)."""
    _, execute = _db()
    data     = request.get_json() or {}
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')
    confirm  = data.get('confirm', '')

    skey    = _session_key('reset', email)
    pending = session.get(skey)

    if not pending or not pending.get('verified'):
        return jsonify({'ok': False, 'error': 'Unauthorized. Please verify your code first.',
                        'restart': True}), 403

    if len(password) < 8:
        return jsonify({'ok': False, 'error': 'Password must be at least 8 characters.'}), 400

    if password != confirm:
        return jsonify({'ok': False, 'error': 'Passwords do not match.'}), 400

    # Check not reusing same password
    from app import query as q
    user = q('SELECT password_hash FROM users WHERE id=%s', (pending['user_id'],), one=True)
    if user and check_password_hash(user['password_hash'], password):
        return jsonify({'ok': False,
                        'error': 'New password cannot be the same as your current password.'}), 400

    execute('UPDATE users SET password_hash=%s WHERE id=%s',
            (generate_password_hash(password), pending['user_id']))
    session.pop(skey, None)

    return jsonify({'ok': True, 'message': 'Password updated! You can now log in.',
                    'redirect': url_for('login')})


@auth_bp.route('/forgot-password/resend', methods=['POST'])
def forgot_resend():
    """Resend reset OTP (30s cooldown)."""
    data  = request.get_json() or {}
    email = data.get('email', '').strip().lower()

    skey    = _session_key('reset', email)
    pending = session.get(skey)
    if not pending:
        return jsonify({'ok': False, 'error': 'Session expired. Please start again.',
                        'restart': True}), 400

    sent_at    = datetime.fromisoformat(pending['sent_at'])
    wait_until = sent_at + timedelta(seconds=30)
    if datetime.utcnow() < wait_until:
        secs = int((wait_until - datetime.utcnow()).total_seconds())
        return jsonify({'ok': False, 'error': f'Wait {secs}s before resending.',
                        'cooldown': secs}), 429

    new_code = _code()
    pending.update({
        'code':     new_code,
        'expires':  (datetime.utcnow() + timedelta(minutes=5)).isoformat(),
        'sent_at':  datetime.utcnow().isoformat(),
        'attempts': 0,
        'verified': False,
    })
    session[skey]    = pending
    session.modified = True

    ok, err = _send_otp_email(email, pending['username'], new_code, 'reset')
    if not ok:
        return jsonify({'ok': False, 'error': f'Could not resend: {err}'}), 500

    return jsonify({'ok': True, 'message': 'New code sent!'})


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE 3 — CHANGE PASSWORD (settings page)
# ═══════════════════════════════════════════════════════════════════════════

@auth_bp.route('/settings/change-password', methods=['POST'])
def change_password():
    """AJAX endpoint called from the edit_profile page."""
    from app import query as q, execute as ex
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'You must be logged in.'}), 401

    data        = request.get_json() or {}
    current_pw  = data.get('current_password', '')
    new_pw      = data.get('new_password', '')
    confirm_pw  = data.get('confirm_password', '')

    if not all([current_pw, new_pw, confirm_pw]):
        return jsonify({'ok': False, 'error': 'All password fields are required.'}), 400

    if len(new_pw) < 8:
        return jsonify({'ok': False, 'error': 'New password must be at least 8 characters.'}), 400

    if new_pw != confirm_pw:
        return jsonify({'ok': False, 'error': 'New passwords do not match.'}), 400

    user = q('SELECT password_hash FROM users WHERE id=%s', (session['user_id'],), one=True)
    if not user or not check_password_hash(user['password_hash'], current_pw):
        return jsonify({'ok': False, 'error': 'Current password is incorrect.'}), 400

    if check_password_hash(user['password_hash'], new_pw):
        return jsonify({'ok': False,
                        'error': 'New password cannot be the same as your current password.'}), 400

    ex('UPDATE users SET password_hash=%s WHERE id=%s',
       (generate_password_hash(new_pw), session['user_id']))

    return jsonify({'ok': True, 'message': '✅ Password changed successfully!'})


# ═══════════════════════════════════════════════════════════════════════════
# SHARED EMAIL HELPER
# ═══════════════════════════════════════════════════════════════════════════

def _valid_email(email: str) -> bool:
    import re
    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email))


def _send_otp_email(email: str, username: str, code: str, mode: str):
    from flask_mail import Message
    mail = _mail()
    if not mail:
        return False, 'Mail not configured.'

    if mode == 'verify':
        subject     = 'Your Cooking INA Verification Code'
        headline    = 'Email Verification'
        body_txt    = (f'Hi {username}! Thanks for joining Cooking INA. '
                       f'Your verification code is: {code}. Expires in 5 minutes.')
        intro       = (f'Thanks for joining Cooking INA, <strong>{username}</strong>! '
                       f'Enter the code below to activate your account.')
        footer_note = 'If you did not create an account, you can safely ignore this email.'
    else:
        subject     = 'Cooking INA Password Reset Code'
        headline    = 'Password Reset'
        body_txt    = (f'Hi {username}! Your Cooking INA password reset code is: {code}. '
                       f'Expires in 5 minutes. If you did not request this, ignore this email.')
        intro       = (f'Hi <strong>{username}</strong>! Enter the code below to reset '
                       f'your Cooking INA password.')
        footer_note = 'If you did not request a password reset, you can safely ignore this email.'

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#fdfaf5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf5;padding:40px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0"
       style="background:#fff;border-radius:20px;overflow:hidden;max-width:100%;">
  <tr>
    <td style="background:linear-gradient(135deg,#c8501a,#e8803a);padding:32px 40px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:1.5rem;font-weight:700;">Cooking INA</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:.88rem;">{headline}</p>
    </td>
  </tr>
  <tr>
    <td style="padding:36px 40px 28px;">
      <p style="margin:0 0 20px;font-size:.95rem;color:#5c4a2a;line-height:1.6;">{intro}</p>
      <div style="background:#fdfaf5;border:2px dashed #c8501a;border-radius:14px;
                  padding:28px;text-align:center;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:.75rem;color:#9c8060;
                   text-transform:uppercase;letter-spacing:.1em;">Your code</p>
        <div style="font-size:3rem;font-weight:900;letter-spacing:12px;
                    color:#c8501a;font-family:monospace;">{code}</div>
        <p style="margin:10px 0 0;font-size:.78rem;color:#9c8060;">Expires in <strong>5 minutes</strong></p>
      </div>
      <p style="margin:0;font-size:.83rem;color:#9c8060;line-height:1.6;">{footer_note}</p>
    </td>
  </tr>
  <tr>
    <td style="background:#f4efe6;padding:18px 40px;text-align:center;border-top:1px solid #ede5d8;">
      <p style="margin:0;font-size:.75rem;color:#9c8060;">Cooking INA - Filipino Recipe Platform</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body></html>"""

    # Strip all non-ASCII characters to prevent encoding errors
    html     = html.encode('ascii', 'ignore').decode('ascii')
    body_txt = body_txt.encode('ascii', 'ignore').decode('ascii')
    subject  = subject.encode('ascii', 'ignore').decode('ascii')

    try:
        msg = Message(
            subject=subject,
            recipients=[email],
            html=html,
            body=body_txt
        )
        mail.send(msg)
        return True, None
    except Exception as e:
        current_app.logger.error(f'Mail error: {e}')
        return False, str(e)
