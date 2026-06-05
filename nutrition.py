import os
import json
from flask import Blueprint, request, jsonify
from google import genai

nutrition_bp = Blueprint('nutrition', __name__)

@nutrition_bp.route('/api/nutrition', methods=['POST'])
def get_nutrition():
    try:
        body = request.get_json()
        ingredients = body.get('ingredients', [])
        servings = int(body.get('servings', 1)) or 1

        if not ingredients:
            return jsonify({'error': 'No ingredients provided'}), 400

        client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))

        ingredient_lines = '\n'.join(f'- {ing}' for ing in ingredients)

        prompt = f"""You are a Filipino nutrition expert. Estimate the nutrition for a recipe that serves {servings} people.

Ingredients:
{ingredient_lines}

Since no quantities are given, assume realistic Filipino home-cooking portion sizes for a recipe that serves {servings} people. For example:
- Chicken/pork/beef: around 500-700g total for 4 servings
- Vegetables (kangkong, pechay, sitaw): around 100-200g total
- Condiments (soy sauce, vinegar, fish sauce): around 2-3 tablespoons
- Oil: around 2 tablespoons
- Garlic/onion/ginger: small amounts (1-2 cloves / 1 medium / 1 thumb)
- Rice: around 1 cup uncooked per 2 servings
- Coconut milk: around 1 can (400ml) for 4 servings

Return ONLY a JSON object with these exact keys. All values are for the TOTAL recipe (not per serving — the frontend will divide by servings):
{{
  "calories": <number>,
  "protein": <number in grams>,
  "carbs": <number in grams>,
  "fat": <number in grams>,
  "fiber": <number in grams>,
  "note": "<one short sentence about the estimate, e.g. which ingredients were guessed>"
}}

Rules:
- All values must be plain numbers, never strings
- Values are TOTAL for the whole recipe (frontend divides by {servings})
- For uniquely Filipino ingredients (calamansi, bagoong, patis, etc.) use your best estimate
- Return ONLY the raw JSON — no markdown, no backticks, no explanation"""

        response = client.models.generate_content(
            model='gemini-flash-lite-latest',
            contents=prompt
        )
        response_text = response.text.strip()

        print(f"[NUTRITION] Gemini raw: {response_text[:200]}")

        # Strip markdown fences if Gemini adds them
        if '```' in response_text:
            response_text = response_text.split('```')[1]
            if response_text.startswith('json'):
                response_text = response_text[4:]
            response_text = response_text.strip()

        nutrition_data = json.loads(response_text)

        # Ensure all numeric fields are actually numbers
        for field in ['calories', 'protein', 'carbs', 'fat', 'fiber']:
            val = nutrition_data.get(field, 0)
            try:
                nutrition_data[field] = float(val)
            except (ValueError, TypeError):
                nutrition_data[field] = 0.0

        print(f"[NUTRITION] Parsed: {nutrition_data}")
        return jsonify(nutrition_data)

    except json.JSONDecodeError as e:
        print(f"[NUTRITION] JSON parse error: {e}")
        return jsonify({'error': 'Failed to parse nutrition data'}), 500
    except Exception as e:
        print(f"[NUTRITION] Error: {e}")
        return jsonify({'error': str(e)}), 500