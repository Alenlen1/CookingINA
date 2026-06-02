

import os
import json
from datetime import datetime
from flask import (Blueprint, render_template, request, jsonify,
                   session, redirect, url_for)
from google import genai
from google.genai import types
from dotenv import load_dotenv
load_dotenv(override=True)
# ── Blueprint setup ──────────────────────────────────────────────────────────
chatbot_bp = Blueprint('chatbot', __name__)

# ── Gemini configuration ─────────────────────────────────────────────────────
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

# OLD
def get_gemini_model():
    if not GEMINI_API_KEY:
        return None
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(
        model_name='gemini-flash-lite-latest',
        system_instruction=SYSTEM_PROMPT
    )
# NEW
def get_gemini_client():
    if not GEMINI_API_KEY:
        return None
    return genai.Client(api_key=GEMINI_API_KEY)

# ── System prompt (cooking-focused) ──────────────────────────────────────────
SYSTEM_PROMPT = """You are INA, a warm and knowledgeable AI cooking assistant for Cooking INA — a Filipino recipe platform.

Your personality:
- Friendly, encouraging, and conversational like a helpful Mama/Ina (a nurturing mother figure)- Passionate about Filipino cuisine but knowledgeable about all cuisines
- Use occasional Filipino words naturally (like "Kumain ka na?" or "Sarap!")
- Be practical, budget-conscious, and empathetic to home cooks

Your expertise:
- Filipino dishes: adobo, sinigang, kare-kare, lechon, pinakbet, nilaga, and more
- Ingredient substitutions for hard-to-find items
- Budget-friendly meal planning (Philippine peso context)
- Quick meals for busy weekdays
- Allergen-aware cooking advice
- Nutrition basics and healthy Filipino eating
- Cooking techniques for beginners to advanced
- Kitchen tips, storage advice, and food safety

Response style:
- Use markdown formatting: **bold** for key terms, bullet lists for steps/ingredients
- Keep responses concise but complete (aim for 150-300 words unless a recipe is requested)
- For recipes, use clear numbered steps
- Add emoji sparingly for warmth 🍳
- If asked about a specific recipe on the platform, encourage them to search for it
- Always end cooking advice with an encouraging note

Constraints:
- Stay focused on food, cooking, nutrition, and related lifestyle topics
- For unrelated topics, gently redirect: "I'm best at helping with cooking and food questions!"
- Never provide medical diagnoses, only general nutrition info
"""

# ── Database helper import (uses app's query/execute functions) ───────────────
# We import lazily to avoid circular imports
def _get_db_helpers():
    from app import query, execute, current_user
    return query, execute, current_user


# ════════════════════════════════════════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════════════════════════════════════════

@chatbot_bp.route('/chat')
def chat_page():
    """Full-page chatbot interface."""
    query, execute, current_user = _get_db_helpers()
    user = current_user()
    if not user:
        return redirect(url_for('login'))

    # Load user's recent conversations
    conversations = query(
        '''SELECT id, title, updated_at
           FROM chat_conversations
           WHERE user_id = %s
           ORDER BY updated_at DESC
           LIMIT 30''',
        (user['id'],)
    ) or []

    # Auto-select most recent conversation
    active_conv_id = request.args.get('conv', None)
    if not active_conv_id and conversations:
        active_conv_id = conversations[0]['id']

    messages = []
    if active_conv_id:
        messages = query(
            '''SELECT role, content, created_at
               FROM chat_messages
               WHERE conversation_id = %s
               ORDER BY created_at ASC''',
            (active_conv_id,)
        ) or []

    return render_template(
        'chat.html',
        conversations=conversations,
        active_conv_id=int(active_conv_id) if active_conv_id else None,
        messages=messages,
        gemini_configured=bool(GEMINI_API_KEY)
    )


@chatbot_bp.route('/chat/new', methods=['POST'])
def new_conversation():
    """Create a new conversation and return its ID."""
    _, execute, current_user = _get_db_helpers()
    user = current_user()
    if not user:
        return jsonify({'error': 'Login required'}), 401

    row = execute(
        '''INSERT INTO chat_conversations (user_id, title, updated_at)
           VALUES (%s, %s, NOW()) RETURNING id''',
        (user['id'], 'New Conversation')
    )
    return jsonify({'conversation_id': row['id']})


@chatbot_bp.route('/chat/<int:conv_id>/messages')
def get_messages(conv_id):
    """Fetch all messages for a conversation (AJAX)."""
    query, _, current_user = _get_db_helpers()
    user = current_user()
    if not user:
        return jsonify({'error': 'Login required'}), 401

    # Verify ownership
    conv = query(
        'SELECT id FROM chat_conversations WHERE id = %s AND user_id = %s',
        (conv_id, user['id']), one=True
    )
    if not conv:
        return jsonify({'error': 'Not found'}), 404

    messages = query(
        '''SELECT role, content, created_at
           FROM chat_messages
           WHERE conversation_id = %s
           ORDER BY created_at ASC''',
        (conv_id,)
    ) or []

    return jsonify({'messages': [dict(m) for m in messages]})


@chatbot_bp.route('/chat/<int:conv_id>/send', methods=['POST'])
def send_message(conv_id):
    """
    Receive a user message, call Gemini, save both to DB, return AI reply.
    Expects JSON: { "message": "..." }
    """
    query, execute, current_user = _get_db_helpers()
    user = current_user()
    if not user:
        return jsonify({'error': 'Login required'}), 401

    # Validate ownership
    conv = query(
        'SELECT id, title FROM chat_conversations WHERE id = %s AND user_id = %s',
        (conv_id, user['id']), one=True
    )
    if not conv:
        return jsonify({'error': 'Conversation not found'}), 404

    data = request.get_json()
    user_message = (data or {}).get('message', '').strip()
    if not user_message:
        return jsonify({'error': 'Empty message'}), 400
    if len(user_message) > 2000:
        return jsonify({'error': 'Message too long (max 2000 chars)'}), 400

    # ── Save user message ────────────────────────────────────────────────────
    execute(
        'INSERT INTO chat_messages (conversation_id, role, content) VALUES (%s, %s, %s)',
        (conv_id, 'user', user_message)
    )

    # ── Auto-title conversation from first user message ──────────────────────
    if conv['title'] == 'New Conversation':
        title = _generate_title(user_message)
        execute(
            'UPDATE chat_conversations SET title = %s WHERE id = %s',
            (title, conv_id)
        )

    # ── Build conversation history for context ───────────────────────────────
    history = query(
        '''SELECT role, content FROM chat_messages
           WHERE conversation_id = %s
           ORDER BY created_at ASC
           LIMIT 30''',    # last 40 messages for context window
        (conv_id,)
    ) or []
    execute(
        'INSERT INTO chat_messages (conversation_id, role, content) VALUES (%s, %s, %s)',
        (conv_id, 'user', user_message)
    )
    # ── Call Gemini ──────────────────────────────────────────────────────────
    
    recipe_context = _fetch_recipe_context(user_message)
    ai_reply = _call_gemini(history, user_message, recipe_context=recipe_context)

    # ── Save AI reply ────────────────────────────────────────────────────────
    execute(
        'INSERT INTO chat_messages (conversation_id, role, content) VALUES (%s, %s, %s)',
        (conv_id, 'assistant', ai_reply)
    )

    # ── Update conversation timestamp ────────────────────────────────────────
    execute(
        'UPDATE chat_conversations SET updated_at = NOW() WHERE id = %s',
        (conv_id,)
    )

    return jsonify({
        'reply': ai_reply,
        'conversation_id': conv_id
    })


@chatbot_bp.route('/chat/<int:conv_id>/delete', methods=['POST'])
def delete_conversation(conv_id):
    """Delete a conversation and all its messages."""
    query, execute, current_user = _get_db_helpers()
    user = current_user()
    if not user:
        return jsonify({'error': 'Login required'}), 401

    conv = query(
        'SELECT id FROM chat_conversations WHERE id = %s AND user_id = %s',
        (conv_id, user['id']), one=True
    )
    if not conv:
        return jsonify({'error': 'Not found'}), 404

    execute('DELETE FROM chat_conversations WHERE id = %s', (conv_id,))
    return jsonify({'status': 'deleted'})


@chatbot_bp.route('/chat/<int:conv_id>/clear', methods=['POST'])
def clear_messages(conv_id):
    """Clear all messages in a conversation (keep conversation)."""
    query, execute, current_user = _get_db_helpers()
    user = current_user()
    if not user:
        return jsonify({'error': 'Login required'}), 401

    conv = query(
        'SELECT id FROM chat_conversations WHERE id = %s AND user_id = %s',
        (conv_id, user['id']), one=True
    )
    if not conv:
        return jsonify({'error': 'Not found'}), 404

    execute('DELETE FROM chat_messages WHERE conversation_id = %s', (conv_id,))
    execute(
        "UPDATE chat_conversations SET title = 'New Conversation', updated_at = NOW() WHERE id = %s",
        (conv_id,)
    )
    return jsonify({'status': 'cleared'})


# ── Floating widget endpoint (quick access from any page) ─────────────────────
@chatbot_bp.route('/chat/widget/send', methods=['POST'])
def widget_send():
    """
    Lightweight endpoint for the floating widget.
    Auto-creates or reuses a 'widget' conversation stored in session.
    Expects JSON: { "message": "...", "history": [...] }
    """
    query, execute, current_user = _get_db_helpers()
    user = current_user()
    if not user:
        return jsonify({'error': 'Login required'}), 401

    data = request.get_json() or {}
    user_message = data.get('message', '').strip()
    # Widget sends its own history array for context (not persisted per-call)
    widget_history = data.get('history', [])

    if not user_message:
        return jsonify({'error': 'Empty message'}), 400

    # Get or create widget conversation for this user
    conv = query(
        '''SELECT id FROM chat_conversations
           WHERE user_id = %s AND title LIKE '%%Widget%%'
           ORDER BY updated_at DESC LIMIT 1''',
        (user['id'],), one=True
    )
    if not conv:
        row = execute(
            '''INSERT INTO chat_conversations (user_id, title, updated_at)
               VALUES (%s, 'Widget Conversation', NOW()) RETURNING id''',
            (user['id'],)
        )
        conv_id = row['id']
    else:
        conv_id = conv['id']

    # Save user message
    execute(
        'INSERT INTO chat_messages (conversation_id, role, content) VALUES (%s, %s, %s)',
        (conv_id, 'user', user_message)
    )

    # Build history from widget_history + new message
    history = [{'role': m['role'], 'content': m['content']} for m in widget_history]

    recipe_context = _fetch_recipe_context(user_message)
    ai_reply = _call_gemini(history, user_message, recipe_context=recipe_context)
    # Save AI reply
    execute(
        'INSERT INTO chat_messages (conversation_id, role, content) VALUES (%s, %s, %s)',
        (conv_id, 'assistant', ai_reply)
    )
    execute(
        'UPDATE chat_conversations SET updated_at = NOW() WHERE id = %s',
        (conv_id,)
    )

    return jsonify({'reply': ai_reply, 'conversation_id': conv_id})


# ════════════════════════════════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════════════════════════════════

def _generate_title(message: str) -> str:
    """Generate a short conversation title from the first user message."""
    words = message.split()
    title = ' '.join(words[:7])
    if len(words) > 7:
        title += '...'
    return title[:200]

def _fetch_recipe_context(message: str) -> str:
    """Fetch recipe data from DB if the user is asking about a specific recipe."""
    query, _, _ = _get_db_helpers()

    message_lower = message.lower()

    stop_words = {
        'what', 'how', 'can', 'make', 'cook', 'want', 'like',
        'give', 'need', 'tell', 'show', 'suggest', 'recommend',
        'idea', 'ideas', 'food', 'meal', 'dish', 'something',
        'anything', 'tonight', 'today', 'quick', 'easy', 'best',
        'good', 'great', 'some', 'more', 'with', 'that', 'this'
    }

    recipe = None

    # 1. Try full message first
    result = query(
        '''SELECT id, name, description, cook_time, servings, is_spicy, is_budget, is_quick
           FROM recipes WHERE LOWER(name) LIKE %s LIMIT 1''',
        (f'%{message_lower}%',)
    )
    if result:
        recipe = result[0]

    # 2. Try two-word phrases (bigrams) — catches "spicy sisig", "chicken adobo" etc.
    if not recipe:
        words = message_lower.split()
        bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words) - 1)]
        for bigram in bigrams:
            result = query(
                '''SELECT id, name, description, cook_time, servings, is_spicy, is_budget, is_quick
                   FROM recipes WHERE LOWER(name) LIKE %s LIMIT 1''',
                (f'%{bigram}%',)
            )
            if result:
                recipe = result[0]
                break

    # 3. Try individual words (min 5 chars, not a stop word)
    if not recipe:
        words = [w for w in message_lower.split() if len(w) >= 5 and w not in stop_words]
        for word in words:
            result = query(
                '''SELECT id, name, description, cook_time, servings, is_spicy, is_budget, is_quick
                   FROM recipes WHERE LOWER(name) LIKE %s LIMIT 1''',
                (f'%{word}%',)
            )
            if result:
                recipe = result[0]
                break

    if not recipe:
        return ''

    recipe_id = recipe['id']

    # ── everything below this line stays exactly the same ──

    # Fetch ingredients
    ingredients = query(
        '''SELECT name, price
           FROM ingredients
           WHERE recipe_id = %s
           ORDER BY sort_order ASC''',
        (recipe_id,)
    ) or []

    # Fetch steps
    steps = query(
        '''SELECT step_num, instruction
           FROM recipe_steps
           WHERE recipe_id = %s
           ORDER BY step_num ASC''',
        (recipe_id,)
    ) or []

    # Fetch allergens
    allergens = query(
        '''SELECT allergen
           FROM recipe_allergens
           WHERE recipe_id = %s''',
        (recipe_id,)
    ) or []

    # Format ingredients
    ingredients_text = '\n'.join(
        f"- {i['name']}" + (f" (₱{i['price']})" if i['price'] else '')
        for i in ingredients
    ) or 'Not listed'

    # Format steps
    steps_text = '\n'.join(
        f"{s['step_num']}. {s['instruction']}"
        for s in steps
    ) or 'Not listed'

    # Format allergens
    allergens_text = ', '.join(a['allergen'] for a in allergens) or 'None listed'

    # Build flags
    flags = []
    if recipe['is_spicy']:  flags.append('🌶 Spicy')
    if recipe['is_quick']:  flags.append('⚡ Quick')
    if recipe['is_budget']: flags.append('💰 Budget-friendly')

    return f"""
This recipe is available on the Cooking INA website:

**{recipe['name']}**
{recipe['description']}

Cook time: {recipe['cook_time']} | Servings: {recipe['servings']}
{' | '.join(flags) if flags else ''}

**Ingredients:**
{ingredients_text}

**Steps:**
{steps_text}

**Allergens:** {allergens_text}

Use this information to answer the user's question directly and accurately.
"""


# NEW
def _call_gemini(history: list, new_message: str, max_retries: int = 3, recipe_context: str = '') -> str:
    import time

    client = get_gemini_client()
    if not client:
        return ("⚠️ AI assistant is not configured yet. "
                "Please set the GEMINI_API_KEY environment variable to enable INA's AI features.")
    full_message = new_message
    if recipe_context:
        full_message = f"{recipe_context}\n\nUser's question: {new_message}"
    # Build message history for context
    contents = []
    for msg in history:
        role = 'user' if msg['role'] == 'user' else 'model'
        contents.append(types.Content(role=role, parts=[types.Part(text=msg['content'])]))
    contents.append(types.Content(role='user', parts=[types.Part(text=full_message)]))

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model='gemini-flash-lite-latest',
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    max_output_tokens=1000,
                )
            )
            return response.text

        except Exception as e:
            error_str = str(e).lower()
            print(f"Gemini error (attempt {attempt + 1}): {e}")

            # Rate limit → retry with backoff
            if any(k in error_str for k in ['quota', 'rate', '429', 'resource exhausted']):
                if attempt < max_retries - 1:
                    wait = 2 ** attempt   # 1s → 2s → 4s
                    print(f"Rate limited. Retrying in {wait}s...")
                    time.sleep(wait)
                    continue
                return "⏳ INA is a little busy right now. Please try again in a moment!"

            # Other errors — no retry needed
            if 'api_key' in error_str or 'invalid' in error_str:
                return "⚠️ Invalid Gemini API key. Please check your GEMINI_API_KEY."
            if 'safety' in error_str:
                return "I can't help with that request. Try asking about a recipe instead! 🍳"
            return f"Oops! Something went wrong. Please try again. (Error: {str(e)[:100]})"
