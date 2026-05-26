# ================================================================
# COOKING INA — AI Chatbot Integration Guide
# ================================================================
# Google Gemini AI chatbot with PostgreSQL chat history
# Non-destructive: only adds files, touches 2 lines in app.py
# ================================================================


## FILE PLACEMENT GUIDE
## =====================
## Drop each file into the correct location in your project:
##
##   chatbot.py              → (project root, same folder as app.py)
##   chat.html               → templates/chat.html
##   chatbot_widget.html     → templates/chatbot_widget.html
##   static/css/chatbot.css  → static/css/chatbot.css
##   static/js/chatbot.js    → static/js/chatbot.js
##   migrate_chatbot.sql     → database/migrate_chatbot.sql


## STEP 1: Install Dependency
## ==========================
pip install google-generativeai


## STEP 2: Get Gemini API Key
## ==========================
## 1. Go to https://aistudio.google.com/apikey
## 2. Click "Create API Key"
## 3. Copy the key


## STEP 3: Set Environment Variable
## ==================================
## Option A — .env file (recommended):
##   Create a .env file in your project root:
##
##     GEMINI_API_KEY=AIzaSy...your_key_here...
##     DATABASE_URL=postgresql://postgres:admin123@localhost:5432/cookingina
##     SECRET_KEY=your-secret-key
##
##   Then install python-dotenv and load it in app.py:
##     pip install python-dotenv
##
##   Add to the TOP of app.py (before everything else):
##     from dotenv import load_dotenv
##     load_dotenv()
##
## Option B — Export in terminal (temporary):
##   export GEMINI_API_KEY="AIzaSy...your_key_here..."
##
## Option C — Set in your hosting platform's environment settings


## STEP 4: Run Database Migration
## ================================
psql -U postgres -d cookingina -f database/migrate_chatbot.sql
##
## This creates two tables:
##   chat_conversations  — one row per chat session per user
##   chat_messages       — all messages (user + AI replies)


## STEP 5: Patch app.py (2 lines only)
## =====================================
## Add these two additions to your existing app.py:

# A) Near the top, after: from datetime import datetime
from chatbot import chatbot_bp

# B) After: app.secret_key = os.environ.get(...)
app.register_blueprint(chatbot_bp)


## STEP 6: Add Widget to Each Template
## =====================================
## Add the following TWO lines to every template that should show
## the floating chat button (index, my_recipes, profile, etc.)
##
## 1. In <head>, add the chatbot CSS:
##    <link rel="stylesheet" href="{{ url_for('static', filename='css/chatbot.css') }}" />
##
## 2. Just before </body>, add:
##    {% include 'chatbot_widget.html' %}
##    <script src="{{ url_for('static', filename='js/chatbot.js') }}"></script>
##
## ─── Example (index.html) ───────────────────────────────────────
## <head>
##   ...existing links...
##   <link rel="stylesheet" href="{{ url_for('static', filename='css/chatbot.css') }}" />
## </head>
## <body>
##   ...existing content...
##   {% include 'chatbot_widget.html' %}
##   <script src="{{ url_for('static', filename='js/script.js') }}"></script>
##   <script src="{{ url_for('static', filename='js/chatbot.js') }}"></script>
## </body>
## ────────────────────────────────────────────────────────────────


## STEP 7: Add Nav Link (optional but recommended)
## =================================================
## In index.html, inside the {% if user %} nav block, add:
##
##   <a href="{{ url_for('chatbot.chat_page') }}" class="nav-link">🍳 AI Chat</a>


## STEP 8: Verify It Works
## ========================
## 1. Start Flask: python app.py
## 2. Log in with any user account
## 3. Visit http://localhost:5000/chat — full chat page
## 4. The 🍳 floating button appears on every page (logged-in users only)
## 5. Try asking: "What Filipino dishes can I cook tonight?"


## ROUTES ADDED BY CHATBOT
## ========================
##   GET  /chat                        — Full chat page
##   POST /chat/new                    — Create new conversation
##   GET  /chat/<id>/messages          — Fetch messages (AJAX)
##   POST /chat/<id>/send              — Send message + get AI reply
##   POST /chat/<id>/delete            — Delete conversation
##   POST /chat/<id>/clear             — Clear messages in conversation
##   POST /chat/widget/send            — Floating widget endpoint


## TROUBLESHOOTING
## ================
## Q: "AI assistant is not configured" message
## A: GEMINI_API_KEY environment variable is not set. See Step 3.
##
## Q: "Invalid API key" error in chat
## A: Double-check the key from https://aistudio.google.com/apikey
##
## Q: Conversations not saving
## A: Run the migration SQL (Step 4). Check DB connection.
##
## Q: Widget not appearing
## A: Make sure chatbot.css is linked and chatbot_widget.html is
##    included. Widget only shows for logged-in users.
##
## Q: ImportError: No module named 'google.generativeai'
## A: Run: pip install google-generativeai


## PROJECT STRUCTURE AFTER INTEGRATION
## ======================================
## cooking-ina/
## ├── app.py                    (patched: +2 lines)
## ├── chatbot.py                (NEW — blueprint + Gemini logic)
## ├── templates/
## │   ├── chat.html             (NEW — full-page chat UI)
## │   ├── chatbot_widget.html   (NEW — floating widget partial)
## │   ├── index.html            (patched: +2 lines per template)
## │   └── ...existing templates...
## ├── static/
## │   ├── css/
## │   │   ├── chatbot.css       (NEW — chatbot styles)
## │   │   └── ...existing CSS...
## │   └── js/
## │       ├── chatbot.js        (NEW — chatbot JavaScript)
## │       └── script.js         (unchanged)
## └── database/
##     ├── migrate_chatbot.sql   (NEW — run once)
##     └── ...existing SQL files...
