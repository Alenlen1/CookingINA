"use strict";
let darkMode = localStorage.getItem("cookingina_dark") === "1";
let speechSynth = window.speechSynthesis;
let currentUtterance = null;
let recognition = null;

// Nutrition cache — prevents repeated Gemini API calls for the same recipe
const _nutritionCache = new Map();

// Apply saved dark mode immediately (prevents flash)
if (darkMode) document.body.classList.add("dark");
updateThemeBtn();

/* ============================================================
   DARK MODE TOGGLE
   ============================================================ */

function updateThemeBtn() {
  const btn = document.getElementById("themeBtn");
  if (btn) btn.textContent = darkMode ? "☀️" : "🌙";
}

function toggleTheme() {
  darkMode = !darkMode;
  document.body.classList.toggle("dark", darkMode);
  localStorage.setItem("cookingina_dark", darkMode ? "1" : "0");
  updateThemeBtn();
}

/* ============================================================
   FILTER NAVIGATION
   ============================================================ */

function setFilter(filter, btn) {
  const hiddenFilter = document.getElementById("hiddenFilter");
  const hiddenFilterMobile = document.getElementById("hiddenFilterMobile");
  const searchForm = document.getElementById("searchForm");
  const searchFormMobile = document.getElementById("searchFormMobile");
  const searchInput = document.getElementById("searchInput");
  const searchInputMobile = document.getElementById("searchInputMobile");

  if (hiddenFilter) hiddenFilter.value = filter;
  if (hiddenFilterMobile) hiddenFilterMobile.value = filter;
  if (filter !== "all" && searchInput) searchInput.value = "";
  if (filter !== "all" && searchInputMobile) searchInputMobile.value = "";

  // Submit whichever form is visible (mobile or desktop)
  const isMobile = window.innerWidth <= 768;
  const activeForm = isMobile ? searchFormMobile : searchForm;
  if (activeForm) {
    activeForm.submit();
  } else if (searchForm) {
    searchForm.submit();
  } else {
    window.location.href = `/?filter=${filter}`;
  }
}

/* ============================================================
   RECIPE MODAL (AJAX)
   ============================================================ */

async function openRecipe(recipeId) {
  stopTTS();

  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  if (!overlay || !modal) return;

  modal.innerHTML = `
    <div class="modal-body" style="text-align:center;padding:60px 28px">
      <div style="margin-bottom:16px">
        <img src="/static/images/ina-avatar.png" alt="INA"
             style="width:80px;height:80px;border-radius:50%;object-fit:cover;
                    animation:pulse 1.2s ease-in-out infinite;
                    box-shadow:0 0 0px #E07B39;">
      </div>
      <p style="color:#E07B39;font-weight:500">Loading recipe...</p>
    </div>`;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  try {
    const res = await fetch(`/recipe/${recipeId}`);
    if (!res.ok) throw new Error("Not found");
    const r = await res.json();

    const isFav = r.is_fav;
    const userRating = r.user_rating || 0;
    const stepsText = r.steps
      .map((s, idx) => `Step ${idx + 1}: ${s.instruction}`)
      .join(". ");
    window._stepsText = stepsText;
    window._currentRecipe = {
      id: r.id,
      ingredients: r.ingredients,
      servings: r.servings,
      name: r.name,
    };
    const totalCost = r.ingredients.reduce((sum, i) => sum + i.price, 0);

    const imgHtml = r.image_path
      ? `<img src="${r.image_path.startsWith("http") ? r.image_path : "/static/" + r.image_path}" alt="${escHtml(r.name)}" onerror="this.parentElement.innerHTML='${escHtml(r.emoji)}'">`
      : escHtml(r.emoji);

    const allergenBadge =
      r.allergens && r.allergens.length
        ? `<span class="badge badge-allergen">⚠️ Allergens: ${escHtml(r.allergens.join(", "))}</span>`
        : `<span class="badge" style="background:var(--green-bg);color:var(--green)">✅ No major allergens</span>`;

    const uploaderHtml = r.username
      ? `<div class="modal-uploader">Recipe by <a href="/user/${escHtml(r.username)}">${escHtml(r.username)}</a></div>`
      : "";

    const ratingHtml = r.logged_in
      ? `
      <div class="star-row" id="starRow" data-recipe="${r.id}">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) => `
          <span class="star ${n <= userRating ? "active" : ""}"
                data-val="${n}"
                onclick="submitRating(${r.id}, ${n})"
                onmouseover="highlightStars(${n})"
                onmouseout="resetStars(${r.id}, ${userRating})">★</span>
        `,
          )
          .join("")}
        <span class="star-label" id="starLabel">
          ${r.avg_rating > 0 ? `⭐ ${r.avg_rating} (${r.rating_count} ratings)` : "Rate this recipe"}
        </span>
      </div>`
      : `
      <div class="star-row">
        <span class="star-label">
          ${r.avg_rating > 0 ? `⭐ ${r.avg_rating} (${r.rating_count} ratings)` : "No ratings yet"}
        </span>
        <a href="/login" style="font-size:12px;color:var(--accent);margin-left:8px">Log in to rate</a>
      </div>`;

    const reviewFormHtml = r.logged_in
      ? `
      <div class="review-form">
        <textarea id="reviewInput" rows="2" placeholder="Add a comment..."></textarea>
        <div class="review-form-bottom">
          <label class="review-img-label" title="Attach an image">
            📎 Photo
            <input type="file" id="reviewImageInput" accept=".jpg,.jpeg,.png,.webp"
                   onchange="previewCommentImg(this)" style="display:none">
          </label>
          <img id="reviewImgPreview" class="review-img-preview" style="display:none">
          <button onclick="submitReview(${r.id})">Post</button>
        </div>
      </div>`
      : `
      <p style="font-size:13px;color:var(--text3);font-weight:300;margin-bottom:16px">
        <a href="/login" style="color:var(--accent)">Log in</a> to leave a review.
      </p>`;

    const reviewsHtml =
      r.reviews && r.reviews.length
        ? r.reviews.map((rv) => renderReview(rv, r.session_uid)).join("")
        : `<p style="font-size:13px;color:var(--text3);font-weight:300">No reviews yet. Be the first!</p>`;

    modal.innerHTML = `
      <div class="modal-img">${imgHtml}</div>
      <div class="modal-body">

        <div class="modal-header">
          <div class="modal-title">${escHtml(r.name)}</div>
          <button class="close-btn" onclick="closeModal()">✕</button>
        </div>

        ${uploaderHtml}

        <div class="card-badges" style="margin-bottom:14px">
          ${r.is_spicy ? '<span class="badge badge-spicy">🌶️ Spicy</span>' : ""}
          ${r.is_quick ? '<span class="badge badge-quick">⚡ Quick Meal</span>' : ""}
          ${r.is_budget ? '<span class="badge badge-budget">💰 Budget-Friendly</span>' : ""}
          ${allergenBadge}
        </div>

        <div class="modal-meta">
          <span>⏱ ${escHtml(r.cook_time)}</span>
          <span id="metaServings">👥 ${r.servings} servings</span>
          <span>🍴 ${r.ingredients.length} ingredients</span>
          <span class="calorie-badge" id="calorieBadge">🔥 Estimating…</span>
        </div>

        <p style="color:var(--text2);font-size:14px;margin-bottom:18px;line-height:1.7;font-weight:300;font-style:italic">
          ${escHtml(r.description)}
        </p>

        ${ratingHtml}

        <div class="tts-bar">
          <button class="tts-btn" id="ttsBtn">
            🔊 Read Instructions
          </button>
          <div class="tts-label">Hands-free cooking mode</div>
          <button class="fav-btn ${isFav ? "active" : ""}" id="modalFav"
                  onclick="handleFav(${r.id}, this)">
            ${isFav ? "❤️" : "🤍"}
          </button>
          <button class="print-btn" onclick="printRecipe()" title="Print Recipe">🖨️</button>
        </div>

        <!-- Serving Adjuster -->
        <div class="serving-adjuster">
          <span class="serving-label">👥 Servings</span>
          <div class="serving-controls">
            <button class="serving-btn" onclick="adjustServings(-1)">−</button>
            <span class="serving-count" id="servingCount">${r.servings}</span>
            <button class="serving-btn" onclick="adjustServings(1)">+</button>
          </div>
          <span id="servingBase" style="display:none">${r.servings}</span>
        </div>

        <div class="section-head">🧺 Ingredients</div>
        <ul class="ingredient-list" id="ingredientList">
          ${r.ingredients
            .map(
              (i) => `
            <li data-base-price="${i.price}">
              <span>${escHtml(i.name)}</span>
              <span class="ing-price">₱${Number(i.price).toLocaleString()}</span>
            </li>`,
            )
            .join("")}
        </ul>

        <div class="total-cost">
          <span class="label">💰 Total Estimated Cost</span>
          <span class="amount" id="totalCostAmount">₱${totalCost.toLocaleString()}</span>
        </div>

        <!-- ── Nutrition Estimator ── -->
        <div class="section-head">🥗 Nutrition Estimate</div>
        <div id="nutritionBox" class="nutrition-box">
          <div id="nutritionIdle" class="nutrition-idle" style="display:none">
            <button id="nutritionBtn" class="nutrition-btn" onclick="fetchNutrition()">
              Estimate Calories &amp; Macros
            </button>
            <span class="nutrition-hint">per serving · using Gemini AI</span>
          </div>
          <div id="nutritionLoading" class="nutrition-loading">⏳ Estimating nutrition…</div>
          <div id="nutritionResult" class="nutrition-result"></div>
          <div id="nutritionError"  class="nutrition-error"></div>
        </div>

        <div class="section-head">👨‍🍳 Cooking Instructions</div>
        <ol class="steps-list">
          ${r.steps
            .map(
              (s, idx) => `
            <li class="step">
              <div class="step-num">${idx + 1}</div>
              <div class="step-text">${escHtml(s.instruction)}</div>
            </li>`,
            )
            .join("")}
        </ol>

        <div class="reviews-section">
          <div class="section-head">💬 Reviews</div>
          ${reviewFormHtml}
          <div id="reviewList">${reviewsHtml}</div>
        </div>

      </div>`;
    // Auto-fetch nutrition when modal opens
    autoFetchNutrition();
  } catch (err) {
    modal.innerHTML = `
      <div class="modal-body" style="text-align:center;padding:60px 28px">
        <div style="font-size:48px;margin-bottom:16px">⚠️</div>
        <p style="color:var(--text3);font-weight:300">Failed to load recipe. Try again.</p>
        <button class="close-btn" onclick="closeModal()" style="margin-top:16px;width:auto;padding:8px 20px;border-radius:50px">Close</button>
      </div>`;
  }
}
async function autoFetchNutrition() {
  const recipe = window._currentRecipe;
  if (!recipe || !recipe.ingredients || !recipe.ingredients.length) return;

  const servings = Math.max(1, parseInt(recipe.servings) || 1);
  const cacheKey = recipe.name + "_" + servings;
  const badge = document.getElementById("calorieBadge");

  // ── Cache hit: use saved result, skip Gemini entirely ──
  if (_nutritionCache.has(cacheKey)) {
    const data = _nutritionCache.get(cacheKey);
    window._lastNutritionData = data; // save for serving adjuster
    const cal = Math.round(parseFloat(data.calories) / servings) || 0;
    if (badge) {
      badge.textContent = `🔥 ~${cal} Cal/serving`;
      badge.classList.add("calorie-badge--loaded");
    }
    if (typeof window.renderNutritionData === "function") {
      window.renderNutritionData(data, servings);
    }
    return; // stop here — no API call needed
  }

  // ── Cache miss: call Gemini and save the result ──
  try {
    const res = await fetch("/api/nutrition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe_id: recipe.id,
        ingredients: recipe.ingredients.map((i) => i.name),
        servings: servings,
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    _nutritionCache.set(cacheKey, data); // save so next open is instant
    window._lastNutritionData = data; // save for serving adjuster

    const cal = Math.round(parseFloat(data.calories) / servings) || 0;
    if (badge) {
      badge.textContent = `🔥 ~${cal} Cal/serving`;
      badge.classList.add("calorie-badge--loaded");
    }
    if (typeof window.renderNutritionData === "function") {
      window.renderNutritionData(data, servings);
    }
  } catch (err) {
    if (badge) {
      badge.textContent = "🔥 Est. unavailable";
      badge.style.opacity = "0.5";
    }
    const idle = document.getElementById("nutritionIdle");
    const loading = document.getElementById("nutritionLoading");
    if (idle) idle.style.display = "flex";
    if (loading) loading.style.display = "none";
  }
}

function closeModal() {
  stopTTS();
  const overlay = document.getElementById("modalOverlay");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
}

/* ── Serving Adjuster ── */
function adjustServings(delta) {
  const countEl = document.getElementById("servingCount");
  const baseEl = document.getElementById("servingBase");
  if (!countEl || !baseEl) return;

  const base = parseInt(baseEl.textContent) || 1;
  const current = parseInt(countEl.textContent) || base;
  const next = Math.max(1, current + delta);
  countEl.textContent = next;

  // Update meta servings at the top of the modal
  const metaServings = document.getElementById("metaServings");
  if (metaServings) metaServings.textContent = `👥 ${next} servings`;

  // Scale ingredient prices
  const items = document.querySelectorAll("#ingredientList li");
  let newTotal = 0;
  items.forEach((li) => {
    const basePrice = parseFloat(li.dataset.basePrice) || 0;
    const scaled = Math.round((basePrice / base) * next);
    newTotal += scaled;
    const priceEl = li.querySelector(".ing-price");
    if (priceEl) priceEl.textContent = "₱" + scaled.toLocaleString();
  });

  // Update total cost
  const totalEl = document.getElementById("totalCostAmount");
  if (totalEl) totalEl.textContent = "₱" + newTotal.toLocaleString();

  // Re-render nutrition for new serving count
  const recipe = window._currentRecipe;
  if (recipe && window._lastNutritionData) {
    const data = window._lastNutritionData;
    if (typeof window.renderNutritionData === "function") {
      window.renderNutritionData(data, next);
    }
    // Update calorie badge
    const badge = document.getElementById("calorieBadge");
    if (badge) {
      const cal = Math.round(parseFloat(data.calories) / next) || 0;
      badge.textContent = `🔥 ~${cal} Cal/serving`;
      badge.classList.add("calorie-badge--loaded");
    }
  }
}

/* ── Print Recipe ── */
function printRecipe() {
  const recipe = window._currentRecipe;
  if (!recipe) return;

  const name = document.querySelector(".modal-title")?.textContent || "Recipe";
  const meta = document.querySelector(".modal-meta")?.innerText || "";
  const description =
    document.querySelector(".modal-body > p")?.innerText || "";
  const servingCount =
    document.getElementById("servingCount")?.textContent || recipe.servings;

  // Recipe image
  const imgEl = document.querySelector(".modal-img img");
  const imgSrc = imgEl ? imgEl.src : "";
  const recipeImgHtml = imgSrc
    ? `<img src="${imgSrc}" alt="${name}"
           style="width:100%;max-height:320px;object-fit:cover;border-radius:10px;margin-bottom:20px;">`
    : "";

  // Ingredients
  const ingItems = document.querySelectorAll("#ingredientList li");
  let ingredientsHtml = "";
  ingItems.forEach((li) => {
    const ingName = li.querySelector("span:first-child")?.textContent || "";
    const ingPrice = li.querySelector(".ing-price")?.textContent || "";
    ingredientsHtml += `<li>${ingName} <span style="color:#888">${ingPrice}</span></li>`;
  });

  const totalCost =
    document.getElementById("totalCostAmount")?.textContent || "";

  // Steps
  const stepItems = document.querySelectorAll(".steps-list .step");
  let stepsHtml = "";
  stepItems.forEach((step, idx) => {
    const text = step.querySelector(".step-text")?.textContent || "";
    stepsHtml += `<li>${text}</li>`;
  });

  // Nutrition — read structured values instead of raw innerText
  const calValue =
    document.querySelector(".nutrition-cal-value")?.textContent || "";
  const protValue =
    document
      .querySelector(".macro-fill.protein")
      ?.closest(".macro-row")
      ?.querySelector(".macro-value")?.textContent || "";
  const carbValue =
    document
      .querySelector(".macro-fill.carbs")
      ?.closest(".macro-row")
      ?.querySelector(".macro-value")?.textContent || "";
  const fatValue =
    document
      .querySelector(".macro-fill.fat")
      ?.closest(".macro-row")
      ?.querySelector(".macro-value")?.textContent || "";
  const fibValue =
    document
      .querySelector(".macro-fill.fiber")
      ?.closest(".macro-row")
      ?.querySelector(".macro-value")?.textContent || "";
  const totalCalValue =
    document.querySelector(".nutrition-total-value")?.textContent || "";
  const nutritionNote =
    document.querySelector(".nutrition-note")?.textContent || "";

  const nutritionHtml = calValue
    ? `
    <div class="nutrition-box" style="background:#f9f9f9;border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:20px">
      <strong style="font-size:15px">🥗 Nutrition Estimate</strong>
      <span style="font-size:12px;color:#888;margin-left:8px">per serving · ${servingCount} servings</span>
      <div style="margin-top:12px;margin-bottom:8px">
        <span style="font-size:32px;font-weight:bold;color:#E07B39">${calValue}</span>
        <span style="font-size:13px;color:#888;margin-left:6px">Cal per serving</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px">
        <tr><td style="padding:4px 0;color:#555;width:70px">Protein</td><td style="padding:4px 8px;font-weight:600">${protValue}</td></tr>
        <tr><td style="padding:4px 0;color:#555">Carbs</td><td style="padding:4px 8px;font-weight:600">${carbValue}</td></tr>
        <tr><td style="padding:4px 0;color:#555">Fat</td><td style="padding:4px 8px;font-weight:600">${fatValue}</td></tr>
        <tr><td style="padding:4px 0;color:#555">Fiber</td><td style="padding:4px 8px;font-weight:600">${fibValue}</td></tr>
      </table>
      <div style="border-top:1px solid #ddd;padding-top:8px;font-size:12px;color:#888">
        Total recipe: <strong style="color:#222">${totalCalValue}</strong>
      </div>
      ${nutritionNote ? `<p style="font-size:11px;color:#aaa;margin-top:8px;margin-bottom:0">${nutritionNote}</p>` : ""}
    </div>`
    : "";

  const win = window.open("", "_blank");
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${name}</title>
      <style>
        body { font-family: Georgia, serif; max-width: 680px; margin: 40px auto; padding: 0 20px; color: #222; }
        h1   { font-size: 28px; margin-bottom: 4px; }
        .meta { font-size: 13px; color: #888; margin-bottom: 16px; }
        .desc { font-style: italic; color: #555; margin-bottom: 20px; font-size: 14px; }
        h2   { font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 24px; }
        ul, ol { padding-left: 20px; }
        li   { margin-bottom: 8px; font-size: 14px; line-height: 1.6; }
        .total { font-weight: bold; margin-top: 10px; font-size: 14px; }
        .footer { margin-top: 40px; font-size: 11px; color: #aaa; text-align: center; }
        .nutrition-box { page-break-inside: avoid; break-inside: avoid; }
        table { page-break-inside: avoid; break-inside: avoid; }
        ol li { page-break-inside: avoid; break-inside: avoid; }
      </style>
    </head>
    <body>
      ${recipeImgHtml}
      <h1>${name}</h1>
      <div class="meta">${meta}</div>
      <div class="desc">${description}</div>

      <h2>🧺 Ingredients (${servingCount} servings)</h2>
      <ul>${ingredientsHtml}</ul>
      <p class="total">💰 Total Estimated Cost: ${totalCost}</p>

      ${nutritionHtml}

      <h2>👨‍🍳 Cooking Instructions</h2>
      <ol>${stepsHtml}</ol>

      <div class="footer">Printed from CookingINA · cookingina-o5ch.onrender.com</div>
    </body>
    </html>
  `);
  win.document.close();
  win.print();
}

// Close modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

/* ================================================================
   Edit Profile
   ================================================================ */

function initEditProfile() {
  const fileInput = document.getElementById("file-input");
  const avatarPreview = document.getElementById("avatar-preview");
  const modalBg = document.getElementById("modal-bg");
  const modalImg = document.getElementById("modal-img");
  const toast = document.getElementById("toast");
  if (!fileInput) return; // not on edit profile page

  let pendingURL = null,
    confirmedURL = null;

  function showToast(msg, dur = 2600) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), dur);
  }

  function openModal(url) {
    pendingURL = url;
    modalImg.src = url;
    modalBg.classList.add("open");
  }

  function closeModal() {
    modalBg.classList.remove("open");
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/"))
      return showToast("Please pick an image file.");
    if (file.size > 5 * 1024 * 1024)
      return showToast("File too large (max 5 MB).");
    if (pendingURL) URL.revokeObjectURL(pendingURL);
    openModal(URL.createObjectURL(file));
  }

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  const dropZone = document.getElementById("drop-zone");
  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "var(--accent)";
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.style.borderColor = "";
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "";
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
  }

  const avatarWrap = document.getElementById("avatar-wrap");
  if (avatarWrap) {
    avatarWrap.addEventListener("click", () => fileInput.click());
    avatarWrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") fileInput.click();
    });
  }

  document.getElementById("modal-close")?.addEventListener("click", () => {
    closeModal();
    fileInput.value = "";
  });
  document.getElementById("modal-cancel")?.addEventListener("click", () => {
    closeModal();
    fileInput.value = "";
  });
  modalBg?.addEventListener("click", (e) => {
    if (e.target === modalBg) {
      closeModal();
      fileInput.value = "";
    }
  });
  document.getElementById("modal-save")?.addEventListener("click", () => {
    if (pendingURL) {
      confirmedURL = pendingURL;
      avatarPreview.src = confirmedURL;
    }
    closeModal();
    showToast("✓ Photo selected — hit Save Changes to confirm");
  });

  // Password toggles
  document.querySelectorAll(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inp = document.getElementById(btn.dataset.target);
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      btn.querySelector("i").className = show ? "ti ti-eye-off" : "ti ti-eye";
    });
  });

  // Password strength
  const pwNew = document.getElementById("cpNew");
  const bar = document.getElementById("strength-bar");
  if (pwNew && bar) {
    pwNew.addEventListener("input", () => {
      const v = pwNew.value;
      let score = 0;
      if (v.length >= 8) score++;
      if (v.length >= 12) score++;
      if (v.length >= 16) score++;
      if (v.length >= 20) score++;
      bar.style.width = [0, 25, 50, 75, 100][score] + "%";
      bar.style.background = ["", "#E24B4A", "#EF9F27", "#A3C44A", "#0F6E56"][
        score
      ];
    });
  }

  // Change password
}

// Run on page load
initEditProfile();
/* ============================================================
   RENDER REVIEW
   ============================================================ */

function renderReview(rv, sessionUid) {
  const avatarHtml = rv.profile_image
    ? `<img src="${rv.profile_image.startsWith("http") ? rv.profile_image : "/static/" + rv.profile_image}" alt="">`
    : "👤";
  const canDelete = sessionUid && rv.user_id === sessionUid;

  const imgHtml = rv.image_path
    ? `<div class="review-img-wrap">
       <img src="${rv.image_path.startsWith("http") ? rv.image_path : "/static/" + rv.image_path}"
            class="review-img" onclick="this.classList.toggle('expanded')" alt="comment image">
     </div>`
    : "";

  const likeCount = rv.like_count || 0;
  const dislikeCount = rv.dislike_count || 0;
  const userReaction = rv.user_reaction || null;

  const reactHtml = sessionUid
    ? `
    <div class="review-reactions">
      <button class="react-btn like-btn ${userReaction === "like" ? "active" : ""}"
              onclick="reactToReview(${rv.id}, 'like', this)">
        👍 <span class="react-count">${likeCount}</span>
      </button>
      <button class="react-btn dislike-btn ${userReaction === "dislike" ? "active" : ""}"
              onclick="reactToReview(${rv.id}, 'dislike', this)">
        👎 <span class="react-count">${dislikeCount}</span>
      </button>
      <button class="reply-btn" onclick="toggleReplyBox(${rv.id}, null)">
        💬 Reply
      </button>
    </div>`
    : `
    <div class="review-reactions guest-reactions">
      <span class="react-display">👍 ${likeCount}</span>
      <span class="react-display">👎 ${dislikeCount}</span>
    </div>`;

  const repliesHtml =
    rv.replies && rv.replies.length
      ? rv.replies.map((r) => renderReply(r, rv.id, sessionUid)).join("")
      : "";

  return `
    <div class="review-item" id="review-${rv.id}">
      <div class="review-avatar">${avatarHtml}</div>
      <div class="review-content">
        <div class="review-meta">
<a href="/user/${escHtml(rv.username)}" style="font-weight:600;color:var(--text);text-decoration:none;" 
   onmouseover="this.style.color='var(--accent)'" 
   onmouseout="this.style.color='var(--text)'">${escHtml(rv.username)}</a> · ${rv.created_at}          ${
     canDelete
       ? `<button class="review-delete" onclick="deleteReview(${rv.id})">✕ Delete</button>
            <button class="review-delete" onclick="toggleEditBox(${rv.id})" style="color:var(--accent)">✏️ Edit</button>
`
       : ""
   }
        </div>
<div class="reply-box" id="edit-box-${rv.id}" style="display:none">
  <textarea class="reply-input" id="edit-input-${rv.id}">${escHtml(rv.comment)}</textarea>
  <div class="reply-actions" style="justify-content:space-between;align-items:center">
    <label class="review-img-label" style="font-size:0.78rem;padding:5px 10px">
      📎 Change Photo
      <input type="file" id="edit-img-${rv.id}" accept=".jpg,.jpeg,.png,.webp" style="display:none"
             onchange="previewEditImg(${rv.id}, this)">
    </label>
    <img id="edit-img-preview-${rv.id}" style="display:none;width:40px;height:40px;object-fit:cover;border-radius:6px;border:1.5px solid var(--border)">
    <div style="display:flex;gap:8px">
      <button class="reply-submit-btn" onclick="submitEditReview(${rv.id})">Save</button>
      <button class="reply-cancel-btn" onclick="toggleEditBox(${rv.id})">Cancel</button>
    </div>
  </div>
</div>     
        <div class="review-text" id="review-text-${rv.id}">${escHtml(rv.comment)}</div>
        ${imgHtml}
        ${reactHtml}
        <div class="reply-box" id="reply-box-${rv.id}-null" style="display:none">
          <textarea class="reply-input" placeholder="Reply to ${escHtml(rv.username)}..."></textarea>
          <div class="reply-actions">
            <button class="reply-submit-btn" onclick="submitReply(${rv.id}, null, this)">Post Reply</button>
            <button class="reply-cancel-btn" onclick="toggleReplyBox(${rv.id}, null)">Cancel</button>
          </div>
        </div>
        <div class="replies-container" id="replies-${rv.id}">
          ${repliesHtml}
        </div>
      </div>
    </div>`;
}
function toggleEditBox(reviewId) {
  const box = document.getElementById(`edit-box-${reviewId}`);
  if (!box) return;
  box.style.display = box.style.display === "none" ? "block" : "none";
  if (box.style.display === "block") {
    document.getElementById(`edit-input-${reviewId}`).focus();
  }
}

async function submitEditReview(reviewId) {
  const input = document.getElementById(`edit-input-${reviewId}`);
  const imgInput = document.getElementById(`edit-img-${reviewId}`);
  const comment = input ? input.value.trim() : "";
  if (!comment) return;

  try {
    let res;
    if (imgInput && imgInput.files && imgInput.files[0]) {
      // Send as FormData with new image
      const fd = new FormData();
      fd.append("comment", comment);
      fd.append("comment_image", imgInput.files[0]);
      res = await fetch(`/review/${reviewId}/edit`, {
        method: "POST",
        body: fd,
      });
    } else {
      // Send as JSON without image change
      res = await fetch(`/review/${reviewId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
    }

    if (!res.ok) throw new Error();
    const data = await res.json();

    // Update displayed comment text
    const textEl = document.getElementById(`review-text-${reviewId}`);
    if (textEl) textEl.textContent = comment;

    // Update displayed image if new one was uploaded
    if (data.image_path) {
      const imgWrap = document.querySelector(
        `#review-${reviewId} .review-img-wrap`,
      );
      if (imgWrap) {
        imgWrap.innerHTML = `<img src="/static/${data.image_path}" class="review-img" 
                              onclick="this.classList.toggle('expanded')" alt="comment image">`;
      } else {
        // No existing image wrap — insert after review-text
        const textDiv = document.getElementById(`review-text-${reviewId}`);
        if (textDiv) {
          textDiv.insertAdjacentHTML(
            "afterend",
            `
            <div class="review-img-wrap">
              <img src="/static/${data.image_path}" class="review-img"
                   onclick="this.classList.toggle('expanded')" alt="comment image">
            </div>`,
          );
        }
      }
    }

    // Hide edit box
    const box = document.getElementById(`edit-box-${reviewId}`);
    if (box) box.style.display = "none";

    showToast("Comment updated! ✅");
  } catch {
    showToast("Could not update comment. Try again.");
  }
}

function previewEditImg(reviewId, input) {
  const preview = document.getElementById(`edit-img-preview-${reviewId}`);
  if (!preview) return;
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.style.display = "block";
    };
    reader.readAsDataURL(input.files[0]);
  }
}
/* ============================================================
   RENDER REPLY
   ============================================================ */

function renderReply(reply, reviewId, sessionUid) {
  const avatarHtml = reply.profile_image
    ? `<img src="${reply.profile_image.startsWith("http") ? reply.profile_image : "/static/" + reply.profile_image}" alt="">`
    : "👤";
  const canDelete = sessionUid && reply.user_id === sessionUid;

  const atMention = reply.parent_reply_id
    ? `<span class="at-mention">@${escHtml(reply.parent_username || "")}</span> `
    : "";

  return `
    <div class="reply-item" id="reply-${reply.id}">
      <div class="reply-avatar">${avatarHtml}</div>
      <div class="reply-content">
        <div class="review-meta">
          <a href="/user/${escHtml(reply.username)}" style="font-weight:600;color:var(--text);text-decoration:none;"
            onmouseover="this.style.color='var(--accent)'"
              onmouseout="this.style.color='var(--text)'">${escHtml(reply.username)}</a>          
              ${
                canDelete
                  ? `<button class="review-delete" onclick="deleteReply(${reply.id})">✕ Delete</button>
              <button class="review-delete" onclick="toggleEditReply(${reply.id})" style="color:var(--accent)">✏️ Edit</button>`
                  : ""
              }
        </div>
          <div class="reply-text" id="reply-text-${reply.id}">${escHtml(reply.comment)}</div>
            <div class="reply-box" id="reply-edit-box-${reply.id}" style="display:none">
              <textarea class="reply-input" id="reply-edit-input-${reply.id}">${escHtml(reply.comment)}</textarea>
                <div class="reply-actions">
                <button class="reply-submit-btn" onclick="submitEditReply(${reply.id})">Save</button>
                   <button class="reply-cancel-btn" onclick="toggleEditReply(${reply.id})">Cancel</button>
               </div>
            </div>        
            ${
              sessionUid
                ? `
        <div class="review-reactions">
          <button class="reply-btn" onclick="toggleReplyBox(${reviewId}, ${reply.id})">
            💬 Reply
          </button>
        </div>
        <div class="reply-box" id="reply-box-${reviewId}-${reply.id}" style="display:none">
          <textarea class="reply-input" placeholder="Reply to ${escHtml(reply.username)}..."></textarea>
          <div class="reply-actions">
            <button class="reply-submit-btn" onclick="submitReply(${reviewId}, ${reply.id}, this)">Post Reply</button>
            <button class="reply-cancel-btn" onclick="toggleReplyBox(${reviewId}, ${reply.id})">Cancel</button>
          </div>
        </div>`
                : ""
            }
      </div>
    </div>`;
}

/* ============================================================
   REPLY FUNCTIONS
   ============================================================ */

function toggleReplyBox(reviewId, parentReplyId) {
  const box = document.getElementById(`reply-box-${reviewId}-${parentReplyId}`);
  if (!box) return;
  box.style.display = box.style.display === "none" ? "block" : "none";
  if (box.style.display === "block") {
    box.querySelector("textarea").focus();
  }
}
function toggleEditReply(replyId) {
  const box = document.getElementById(`reply-edit-box-${replyId}`);
  if (!box) return;
  box.style.display = box.style.display === "none" ? "block" : "none";
  if (box.style.display === "block") {
    document.getElementById(`reply-edit-input-${replyId}`).focus();
  }
}

async function submitEditReply(replyId) {
  const input = document.getElementById(`reply-edit-input-${replyId}`);
  const comment = input ? input.value.trim() : "";
  if (!comment) return;

  try {
    const res = await fetch(`/reply/${replyId}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) throw new Error();

    // Update displayed text
    const textEl = document.getElementById(`reply-text-${replyId}`);
    if (textEl) textEl.textContent = comment;

    // Hide edit box
    const box = document.getElementById(`reply-edit-box-${replyId}`);
    if (box) box.style.display = "none";

    showToast("Reply updated! ✅");
  } catch {
    showToast("Could not update reply. Try again.");
  }
}

async function submitReply(reviewId, parentReplyId, btn) {
  const box = document.getElementById(`reply-box-${reviewId}-${parentReplyId}`);
  if (!box) return;
  const textarea = box.querySelector("textarea");
  const comment = textarea.value.trim();
  if (!comment) return;

  try {
    const res = await fetch(`/review/${reviewId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment, parent_reply_id: parentReplyId }),
    });
    if (!res.ok) throw new Error();
    const reply = await res.json();

    const container = document.getElementById(`replies-${reviewId}`);
    if (container) {
      container.insertAdjacentHTML(
        "beforeend",
        renderReply(reply, reviewId, SESSION_USER_ID),
      );
    }

    textarea.value = "";
    box.style.display = "none";
    showToast("Reply posted! 💬");
  } catch {
    showToast("Could not post reply. Try again.");
  }
}

async function deleteReply(replyId) {
  if (!confirm("Delete this reply?")) return;
  try {
    const res = await fetch(`/reply/${replyId}/delete`, { method: "POST" });
    if (!res.ok) throw new Error();
    const el = document.getElementById(`reply-${replyId}`);
    if (el) el.remove();
    showToast("Reply deleted.");
  } catch {
    showToast("Could not delete reply.");
  }
}

/* ============================================================
   FAVORITES (AJAX)
   ============================================================ */

async function handleFav(recipeId, btn) {
  if (typeof LOGGED_IN !== "undefined" && !LOGGED_IN) {
    showToast("Please log in to save favorites");
    window.location.href = "/login";
    return;
  }

  try {
    const res = await fetch(`/favorite/${recipeId}`, { method: "POST" });
    if (res.status === 401 || res.redirected) {
      showToast("Please log in to save favorites");
      return;
    }
    const data = await res.json();

    if (data.status === "added") {
      btn.textContent = "❤️";
      btn.classList.add("active");
      showToast("Added to favorites ❤️");
    } else {
      btn.textContent = "🤍";
      btn.classList.remove("active");
      showToast("Removed from favorites");
    }

    const cardBtn = document.querySelector(
      `.fav-btn[data-recipe="${recipeId}"]`,
    );
    if (cardBtn && cardBtn !== btn) {
      cardBtn.textContent = btn.textContent;
      cardBtn.classList.toggle("active", data.status === "added");
    }
  } catch (err) {
    showToast("Something went wrong. Try again.");
  }
}

/* ============================================================
   STAR RATING (AJAX)
   ============================================================ */

function highlightStars(n) {
  document.querySelectorAll("#starRow .star").forEach((s) => {
    s.classList.toggle("active", Number(s.dataset.val) <= n);
  });
}

function resetStars(recipeId, currentRating) {
  document.querySelectorAll("#starRow .star").forEach((s) => {
    s.classList.toggle("active", Number(s.dataset.val) <= currentRating);
  });
}

async function submitRating(recipeId, rating) {
  try {
    const res = await fetch(`/rate/${recipeId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();

    const label = document.getElementById("starLabel");
    if (label) label.textContent = `⭐ ${data.avg} (${data.cnt} ratings)`;
    showToast(`Rated ${rating} star${rating > 1 ? "s" : ""}!`);
  } catch {
    showToast("Could not submit rating. Try again.");
  }
}

/* ============================================================
   REVIEWS / COMMENTS (AJAX)
   ============================================================ */

function previewCommentImg(input) {
  const preview = document.getElementById("reviewImgPreview");
  if (!preview) return;
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.style.display = "block";
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.src = "";
    preview.style.display = "none";
  }
}

async function submitReview(recipeId) {
  const input = document.getElementById("reviewInput");
  const imgInput = document.getElementById("reviewImageInput");
  const comment = input ? input.value.trim() : "";
  if (!comment) return;

  try {
    let res;
    if (imgInput && imgInput.files && imgInput.files[0]) {
      const fd = new FormData();
      fd.append("comment", comment);
      fd.append("comment_image", imgInput.files[0]);
      res = await fetch(`/review/${recipeId}`, { method: "POST", body: fd });
    } else {
      res = await fetch(`/review/${recipeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
    }

    if (!res.ok) throw new Error();
    const rv = await res.json();

    const list = document.getElementById("reviewList");
    if (list) {
      const noReview = list.querySelector("p");
      if (noReview) noReview.remove();
      list.insertAdjacentHTML("afterbegin", renderReview(rv, SESSION_USER_ID));
    }

    input.value = "";
    if (imgInput) {
      imgInput.value = "";
      const preview = document.getElementById("reviewImgPreview");
      if (preview) {
        preview.src = "";
        preview.style.display = "none";
      }
    }
    showToast("Review posted! 🎉");
  } catch {
    showToast("Could not post review. Try again.");
  }
}

async function deleteReview(reviewId) {
  if (!confirm("Delete this review?")) return;
  try {
    const res = await fetch(`/review/${reviewId}/delete`, { method: "POST" });
    if (!res.ok) throw new Error();
    const el = document.getElementById(`review-${reviewId}`);
    if (el) el.remove();
    showToast("Review deleted.");
  } catch {
    showToast("Could not delete review.");
  }
}

async function reactToReview(reviewId, reaction, btn) {
  try {
    const res = await fetch(`/review/${reviewId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();

    const reviewEl = document.getElementById(`review-${reviewId}`);
    if (!reviewEl) return;

    const likeBtn = reviewEl.querySelector(".like-btn");
    const dislikeBtn = reviewEl.querySelector(".dislike-btn");

    if (likeBtn) {
      likeBtn.querySelector(".react-count").textContent = data.like_count;
      likeBtn.classList.toggle("active", data.user_reaction === "like");
    }
    if (dislikeBtn) {
      dislikeBtn.querySelector(".react-count").textContent = data.dislike_count;
      dislikeBtn.classList.toggle("active", data.user_reaction === "dislike");
    }
  } catch {
    showToast("Could not react. Try again.");
  }
}

/* ============================================================
   TEXT-TO-SPEECH (Hands-Free Cooking Mode)
   ============================================================ */

function toggleTTS(text) {
  const btn = document.getElementById("ttsBtn");
  if (!btn) return;

  if (currentUtterance && speechSynth.speaking) {
    stopTTS();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.9;

  utterance.onstart = () => {
    btn.textContent = "⏹ Stop Reading";
    btn.classList.add("speaking");
  };
  utterance.onend = () => {
    btn.textContent = "🔊 Read Instructions";
    btn.classList.remove("speaking");
    currentUtterance = null;
  };
  utterance.onerror = () => {
    btn.textContent = "🔊 Read Instructions";
    btn.classList.remove("speaking");
    currentUtterance = null;
  };

  currentUtterance = utterance;
  speechSynth.speak(utterance);
}

function stopTTS() {
  if (speechSynth && speechSynth.speaking) speechSynth.cancel();
  currentUtterance = null;
}

/* ============================================================
   VOICE SEARCH (Web Speech API) — search bar mic
   ============================================================ */

function toggleVoice() {
  const hasSR =
    "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
  if (!hasSR) {
    showToast("Voice search not supported in this browser");
    return;
  }

  const voiceModal = document.getElementById("voiceModal");
  const micBtn = document.getElementById("micBtn");
  if (voiceModal) voiceModal.style.display = "flex";

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map((r) => r[0].transcript)
      .join("");
    const voiceText = document.getElementById("voiceText");
    if (voiceText) voiceText.textContent = `"${transcript}"`;

    if (e.results[0].isFinal) {
      const searchInput = document.getElementById("searchInput");
      const searchInputMobile = document.getElementById("searchInputMobile");
      if (searchInput) searchInput.value = transcript;
      if (searchInputMobile) searchInputMobile.value = transcript;
      cancelVoice();
      const isMobile = window.innerWidth <= 768;
      const form = isMobile
        ? document.getElementById("searchFormMobile") ||
          document.getElementById("searchForm")
        : document.getElementById("searchForm") ||
          document.getElementById("searchFormMobile");
      if (form) form.submit();
    }
  };

  recognition.onerror = () => {
    cancelVoice();
    showToast("Voice recognition error. Try again.");
  };
  recognition.onend = () => {
    cancelVoice();
  };
  recognition.start();
  if (micBtn) micBtn.classList.add("listening");
}

function cancelVoice() {
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {}
    recognition = null;
  }
  const voiceModal = document.getElementById("voiceModal");
  const micBtn = document.getElementById("micBtn");
  const voiceText = document.getElementById("voiceText");
  if (voiceModal) voiceModal.style.display = "none";
  if (micBtn) micBtn.classList.remove("listening");
  if (voiceText) voiceText.textContent = "Say an ingredient or recipe name";
}

/* ============================================================
   VOICE NAVIGATION (Web Speech API) — floating mic
   ============================================================ */

const VOICE_NAV_ROUTES = [
  {
    keywords: ["home", "go home", "main", "main page", "homepage"],
    path: "/",
    label: "homepage",
  },
  {
    keywords: [
      "login",
      "log in",
      "sign in",
      "signin",
      "go to login",
      "open login",
    ],
    path: "/login",
    label: "login",
  },
  {
    keywords: [
      "register",
      "sign up",
      "signup",
      "create account",
      "go to register",
      "open register",
    ],
    path: "/register",
    label: "register",
  },
  {
    keywords: ["logout", "log out", "sign out", "signout"],
    path: "/logout",
    label: "logging out",
  },
  {
    keywords: [
      "my recipes",
      "my recipe",
      "my cookbook",
      "open my recipes",
      "go to my recipes",
      "recipes",
      "recipe",
    ],
    path: "/my-recipes",
    label: "my recipes",
  },
  {
    keywords: [
      "add recipe",
      "new recipe",
      "create recipe",
      "add a recipe",
      "upload recipe",
    ],
    path: "/recipe/add",
    label: "add recipe",
  },
  {
    keywords: [
      "game",
      "mini game",
      "play game",
      "play",
      "open game",
      "go to game",
      "gaming",
    ],
    path: "/game",
    label: "mini game",
  },
  {
    keywords: ["admin", "dashboard", "admin dashboard", "go to admin"],
    path: "/admin",
    label: "admin dashboard",
  },
  {
    keywords: [
      "update profile",
      "change profile",
      "edit profile",
      "open profile settings",
      "go to profile settings",
    ],
    path: "/profile/edit",
    label: "edit profile",
  },
  {
    keywords: ["profile", "my profile", "open profile", "go to profile"],
    path: "/profile",
    label: "profile",
  },
  {
    keywords: [
      "chat",
      "chatbot",
      "chat bot",
      "open chat",
      "go to chat",
      "ask chatbot",
    ],
    path: "/chat",
    label: "chatbot",
  },
  {
    keywords: [
      "users",
      "user",
      "admin users",
      "admin user",
      "manage users",
      "go to users",
    ],
    path: "/admin/users",
    label: "admin users",
  },
  {
    keywords: ["ingredients", "admin ingredients", "manage ingredients"],
    path: "/admin/ingredients",
    label: "ingredients",
  },
  {
    keywords: ["dark mode", "dark", "night mode", "turn dark"],
    action: "dark",
    label: "dark mode",
  },
  {
    keywords: ["light mode", "light", "day mode", "turn light"],
    action: "light",
    label: "light mode",
  },
];

function matchNavRoute(transcript) {
  const t = transcript.toLowerCase().trim();

  // Sort all routes by keyword length (longest first) to avoid short keywords
  // matching before longer more specific ones
  const allMatches = [];
  for (const route of VOICE_NAV_ROUTES) {
    for (const kw of route.keywords) {
      if (t === kw || t.includes(kw)) {
        allMatches.push({ route, kw });
      }
    }
  }

  if (allMatches.length === 0) return null;

  // Return the route with the longest matching keyword
  allMatches.sort((a, b) => b.kw.length - a.kw.length);
  return allMatches[0].route;
}

let navRecognition = null;
function highlightNavLink(path) {
  // Find any <a> tag whose href ends with the path
  const links = document.querySelectorAll("a");
  for (const link of links) {
    if (link.getAttribute("href") === path || link.href.endsWith(path)) {
      link.classList.add("nav-voice-highlight");
      setTimeout(() => link.classList.remove("nav-voice-highlight"), 800);
      break;
    }
  }
}
function toggleNavVoice() {
  const hasSR =
    "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
  if (!hasSR) {
    showToast("Voice navigation not supported in this browser");
    return;
  }

  const modal = document.getElementById("navVoiceModal");
  const fab = document.getElementById("navVoiceFab");
  if (modal) modal.style.display = "flex";

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  navRecognition = new SR();
  navRecognition.lang = "en-US";
  navRecognition.continuous = false;
  navRecognition.interimResults = false; // ← changed to false
  navRecognition.maxAlternatives = 5;

  navRecognition.onresult = (e) => {
    const result = e.results[0];
    let transcript = result[0].transcript;
    let navRoute = null;

    for (let i = 0; i < result.length; i++) {
      const match = matchNavRoute(result[i].transcript);
      if (match) {
        transcript = result[i].transcript;
        navRoute = match;
        break;
      }
    }

    if (!navRoute) navRoute = matchNavRoute(transcript);

    const navVoiceText = document.getElementById("navVoiceText");

    if (navRoute) {
      const label = navRoute.label || navRoute.path || navRoute.action;
      const msg = `Selecting ${label}`;
      if (navVoiceText) navVoiceText.textContent = msg;
      if (navRoute.path) highlightNavLink(navRoute.path);

      const utterance = new SpeechSynthesisUtterance(msg);
      utterance.lang = "en-US";
      utterance.rate = 1;
      utterance.onstart = () => {
        const modal = document.getElementById("navVoiceModal");
        if (modal) modal.style.display = "none";
      };
      utterance.onend = () => {
        cancelNavVoice();
        if (navRoute.action === "dark") {
          darkMode = true;
          document.body.classList.add("dark");
          localStorage.setItem("cookingina_dark", "1");
          updateThemeBtn();
        } else if (navRoute.action === "light") {
          darkMode = false;
          document.body.classList.remove("dark");
          localStorage.setItem("cookingina_dark", "0");
          updateThemeBtn();
        } else {
          window.location.href = navRoute.path;
        }
      };
      window.speechSynthesis.speak(utterance);
    } else {
      if (navVoiceText)
        navVoiceText.textContent = `"${transcript}" — page not found`;
      setTimeout(() => cancelNavVoice(), 1500);
    }
  };

  navRecognition.onerror = (e) => {
    cancelNavVoice();
    showToast("Voice error. Try again.");
  };
  navRecognition.onend = () => {
    if (!window.speechSynthesis.speaking) cancelNavVoice();
  };
  navRecognition.start();
  if (fab) fab.classList.add("nav-listening");
}

function cancelNavVoice() {
  if (navRecognition) {
    try {
      navRecognition.stop();
    } catch (e) {}
    navRecognition = null;
  }
  const modal = document.getElementById("navVoiceModal");
  const fab = document.getElementById("navVoiceFab");
  const navVoiceText = document.getElementById("navVoiceText");
  if (modal) modal.style.display = "none";
  if (fab) fab.classList.remove("nav-listening");
  if (navVoiceText) navVoiceText.textContent = "Say a page name to navigate";
}

/* ============================================================
   TOAST NOTIFICATION
   ============================================================ */

function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

/* ============================================================
   ADD / EDIT RECIPE FORM HELPERS
   ============================================================ */

function addIngredient() {
  const list = document.getElementById("ingredientList");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "ingredient-row";
  row.innerHTML = `
    <input type="text" name="ing_name[]" placeholder="Ingredient name" class="ing-name">
    <span class="ing-peso">₱</span>
    <input type="number" name="ing_price[]" placeholder="Price" class="ing-price" min="0">
    <button type="button" class="remove-row-btn" onclick="removeRow(this)">✕</button>`;
  list.appendChild(row);
}

function addStep() {
  const list = document.getElementById("stepList");
  if (!list) return;
  const li = document.createElement("li");
  li.className = "step-input-row";
  li.innerHTML = `
    <textarea name="step[]" rows="2" placeholder="Step instruction..."></textarea>
    <button type="button" class="remove-row-btn" onclick="removeRow(this.parentElement)">✕</button>`;
  list.appendChild(li);
}

function removeRow(el) {
  const row =
    el.closest(".ingredient-row") || el.closest(".step-input-row") || el;
  row.remove();
}

function previewImg(input, previewId) {
  const preview = document.getElementById(previewId);
  if (!preview || !input.files || !input.files[0]) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.style.display = "block";
    preview.style.maxHeight = "200px";
    preview.style.objectFit = "cover";
    preview.style.borderRadius = "var(--radius-sm)";
    const placeholder = document.getElementById("imgPlaceholder");
    if (placeholder) placeholder.style.display = "none";
  };
  reader.readAsDataURL(input.files[0]);
}

/* ============================================================
   ADMIN — Reject Modal & Tab Switching
   ============================================================ */

function openReject(recipeId, recipeName) {
  const bg = document.getElementById("rejectModalBg");
  const form = document.getElementById("rejectForm");
  const nameEl = document.getElementById("rejectRecipeName");
  if (bg) bg.style.display = "flex";
  if (nameEl) nameEl.textContent = recipeName;
  if (form) form.action = `/admin/recipe/${recipeId}/reject`;
}

function closeReject() {
  const bg = document.getElementById("rejectModalBg");
  if (bg) bg.style.display = "none";
}

function switchTab(tab, btn) {
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  const panel = document.getElementById(`tab-${tab}`);
  if (panel) panel.classList.add("active");
  if (btn) btn.classList.add("active");
}

/* ============================================================
   ADMIN — Ingredient Editor
   ============================================================ */

function markDirty(input) {
  const row = input.closest(".ing-row");
  if (!row) return;
  const saveBtn = row.querySelector(".ing-save-btn");
  if (saveBtn) saveBtn.classList.add("visible");
}

function updateTotal() {
  const prices = document.querySelectorAll(".ing-input-price");
  let total = 0;
  prices.forEach((p) => (total += Number(p.value) || 0));
  const el = document.getElementById("totalCost");
  if (el) el.textContent = `₱${total.toLocaleString()}`;
}

async function saveIngredient(btn) {
  const row = btn.closest(".ing-row");
  const id = row.dataset.id;
  const name = row.querySelector(".ing-input-name").value.trim();
  const price = Number(row.querySelector(".ing-input-price").value) || 0;

  try {
    const res = await fetch(`/admin/ingredients/item/${id}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, price }),
    });
    if (!res.ok) throw new Error();
    btn.classList.remove("visible");
    showToast("Saved!");
  } catch {
    showToast("Could not save. Try again.");
  }
}

async function deleteIngredient(btn, id) {
  if (!confirm("Delete this ingredient?")) return;
  try {
    const res = await fetch(`/admin/ingredient/${id}/delete`, {
      method: "POST",
    });
    if (!res.ok) throw new Error();
    const row = btn.closest(".ing-row");
    if (row) row.remove();
    updateTotal();
    showToast("Deleted!");
  } catch {
    showToast("Could not delete.");
  }
}

async function addIngredientAdmin() {
  const nameEl = document.getElementById("newIngName");
  const priceEl = document.getElementById("newIngPrice");
  const name = nameEl ? nameEl.value.trim() : "";
  const price = Number(priceEl ? priceEl.value : 0) || 0;
  if (!name) return;

  const recipeId = window.location.pathname.split("/").pop();

  try {
    const res = await fetch(`/admin/ingredient/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe_id: recipeId, name, price }),
    });
    if (!res.ok) throw new Error();
    const ing = await res.json();

    const container = document.getElementById("ingredientRows");
    const emptyMsg = document.getElementById("emptyMsg");
    if (emptyMsg) emptyMsg.remove();

    const count = container.querySelectorAll(".ing-row").length + 1;
    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="ing-row" data-id="${ing.id}">
        <span class="drag-handle">⠿</span>
        <span class="num">${count}</span>
        <input class="ing-input-name" type="text" value="${escHtml(ing.name)}"
               oninput="markDirty(this)" placeholder="Ingredient name">
        <div class="ing-peso-wrap">
          <span class="ing-peso-sym">₱</span>
          <input class="ing-input-price" type="number" value="${ing.price}" min="0"
                 oninput="markDirty(this); updateTotal();" placeholder="0">
        </div>
        <button class="ing-save-btn" onclick="saveIngredient(this)">💾 Save</button>
        <button class="ing-del-btn" onclick="deleteIngredient(this, ${ing.id})">🗑</button>
      </div>`,
    );

    if (nameEl) nameEl.value = "";
    if (priceEl) priceEl.value = "0";
    updateTotal();
    showToast("Ingredient added!");
  } catch {
    showToast("Could not add ingredient.");
  }
}

/* ============================================================
   UTILITY
   ============================================================ */

function escHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ============================================================
   DOM READY
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // Flash messages auto-hide after 4 seconds
  document.querySelectorAll(".flash").forEach((el) => {
    setTimeout(() => {
      el.style.transition = "opacity 0.5s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 500);
    }, 4000);
  });

  // TTS button — event delegation
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "ttsBtn") {
      toggleTTS(window._stepsText);
    }
  });
});

/* ================================================================
   MOBILE SEARCH — auto-submit on Enter key
   ================================================================ */
(function () {
  const mobileInput = document.getElementById("searchInputMobile");
  const mobileForm = document.getElementById("searchFormMobile");
  if (mobileInput && mobileForm) {
    mobileInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        mobileForm.submit();
      }
    });
    // Also sync with desktop hidden filter
    mobileInput.addEventListener("input", function () {
      const desktopInput = document.getElementById("searchInput");
      if (desktopInput) desktopInput.value = mobileInput.value;
    });
  }
})();

/* ================================================================
   LIVE SEARCH AUTOCOMPLETE
   ================================================================ */
(function () {
  function setupAutocomplete(inputId, dropdownId, formId) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    const form = document.getElementById(formId);
    if (!input || !dropdown) return;

    let debounceTimer = null;
    let currentHighlight = -1;
    let lastResults = [];

    function highlight(text, query) {
      if (!query) return text;
      const idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return text;
      return (
        text.slice(0, idx) +
        "<em>" +
        text.slice(idx, idx + query.length) +
        "</em>" +
        text.slice(idx + query.length)
      );
    }

    function getBadges(item) {
      const badges = [];
      if (item.is_quick) badges.push("⚡ Quick");
      if (item.is_budget) badges.push("💰 Budget");
      if (item.is_spicy) badges.push("🌶️ Spicy");
      return badges;
    }

    function renderDropdown(results, query) {
      lastResults = results;
      currentHighlight = -1;
      dropdown.innerHTML = "";

      if (results.length === 0) {
        dropdown.innerHTML =
          '<div class="dropdown-no-results">No recipes found for "' +
          query +
          '"</div>';
        dropdown.classList.add("open");
        return;
      }

      results.forEach(function (item, idx) {
        const badges = getBadges(item);
        const badgeHTML = badges
          .map((b) => '<span class="dropdown-item-badge">' + b + "</span>")
          .join("");
        const costStr = item.cost > 0 ? "₱" + item.cost.toFixed(0) : "";

        const el = document.createElement("div");
        el.className = "search-dropdown-item";
        el.dataset.idx = idx;
        // Show matched ingredient hint if the recipe name itself doesn't contain the query
        const nameMatches = item.name
          .toLowerCase()
          .includes(query.toLowerCase());
        const ingredientHint =
          !nameMatches && item.matched_ingredient
            ? '<span class="dropdown-ingredient-hint">has <em>' +
              highlight(item.matched_ingredient, query) +
              "</em></span>"
            : "";
        el.innerHTML = `
          <div class="dropdown-item-icon">🍽️</div>
          <div class="dropdown-item-info">
            <div class="dropdown-item-name">${highlight(item.name, query)}</div>
            <div class="dropdown-item-meta">
              ${ingredientHint}
              ${costStr ? "<span>" + costStr + "</span>" : ""}
              ${badgeHTML}
            </div>
          </div>
        `;
        // mousedown for desktop, touchstart for mobile (fires before blur)
        el.addEventListener("mousedown", function (e) {
          e.preventDefault();
          selectItem(item);
        });
        el.addEventListener(
          "touchstart",
          function (e) {
            e.preventDefault();
            selectItem(item);
          },
          { passive: false },
        );
        dropdown.appendChild(el);
      });

      dropdown.classList.add("open");
    }

    function selectItem(item) {
      input.value = item.name;
      dropdown.classList.remove("open");
      dropdown.innerHTML = "";
      if (form) form.submit();
    }

    function closeDropdown() {
      dropdown.classList.remove("open");
      currentHighlight = -1;
    }

    function fetchSuggestions(q) {
      if (q.length < 1) {
        closeDropdown();
        return;
      }
      fetch("/api/search-suggestions?q=" + encodeURIComponent(q))
        .then((r) => r.json())
        .then((data) => renderDropdown(data, q))
        .catch(() => closeDropdown());
    }

    input.addEventListener("input", function () {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (!q) {
        closeDropdown();
        return;
      }
      debounceTimer = setTimeout(() => fetchSuggestions(q), 180);
    });

    input.addEventListener("keydown", function (e) {
      const items = dropdown.querySelectorAll(".search-dropdown-item");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (currentHighlight < items.length - 1) currentHighlight++;
        items.forEach((el, i) =>
          el.classList.toggle("highlighted", i === currentHighlight),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (currentHighlight > 0) currentHighlight--;
        items.forEach((el, i) =>
          el.classList.toggle("highlighted", i === currentHighlight),
        );
      } else if (e.key === "Enter") {
        if (currentHighlight >= 0 && lastResults[currentHighlight]) {
          e.preventDefault();
          selectItem(lastResults[currentHighlight]);
        } else {
          closeDropdown();
          if (form) form.submit();
        }
      } else if (e.key === "Escape") {
        closeDropdown();
      }
    });

    input.addEventListener("focus", function () {
      if (input.value.trim().length >= 1 && lastResults.length > 0) {
        dropdown.classList.add("open");
      }
    });

    document.addEventListener("click", function (e) {
      if (!dropdown.contains(e.target) && e.target !== input) {
        closeDropdown();
      }
    });
  }

  // Setup for both desktop and mobile
  setupAutocomplete("searchInput", "searchDropdown", "searchForm");
  setupAutocomplete(
    "searchInputMobile",
    "searchDropdownMobile",
    "searchFormMobile",
  );
})();

/* ================================================================
   LIVE SEARCH — AJAX recipe grid update
   ================================================================ */
(function () {
  const DEBOUNCE_MS = 280;
  let ajaxTimer = null;
  let currentQuery = "";
  let currentFilter =
    new URLSearchParams(window.location.search).get("filter") || "all";
  let isLiveMode = false;

  const grid = document.querySelector(".recipe-grid");
  const sectionTitle = document.getElementById("sectionTitle");
  const rotdSection = document.querySelector(".rotd-section");

  if (!grid) return; // not on index page

  /* ── Loading spinner overlay ── */
  const spinner = document.createElement("div");
  spinner.id = "liveSearchSpinner";
  spinner.innerHTML = `<div class="lss-inner"><div class="lss-dots"><span></span><span></span><span></span></div><p>Finding recipes…</p></div>`;
  document.querySelector(".main")?.prepend(spinner);

  /* ── Build a recipe card HTML from JSON ── */
  function buildCard(r, query) {
    const imgHTML = r.image_path
      ? `<img src="${r.image_path}" alt="${r.name}" onerror="this.parentElement.innerHTML='${r.emoji}'" />`
      : r.emoji;

    const badges = [
      r.is_spicy ? '<span class="badge badge-spicy">🌶️ Spicy</span>' : "",
      r.is_quick ? '<span class="badge badge-quick">⚡ Quick</span>' : "",
      r.is_budget ? '<span class="badge badge-budget">💰 Budget</span>' : "",
    ].join("");

    const stars = r.avg_rating > 0 ? `<span>⭐ ${r.avg_rating}</span>` : "";
    const favBtn = `<button class="fav-btn ${r.is_fav ? "active" : ""}"
      onclick="event.stopPropagation(); handleFav(${r.id}, this)">${r.is_fav ? "❤️" : "🤍"}</button>`;

    const uploader = r.username
      ? `<div class="card-uploader">by <a href="/user/${r.username}" onclick="event.stopPropagation()">${r.username}</a></div>`
      : "";

    // Highlight matched query in name
    let displayName = r.name;
    if (query) {
      const idx = r.name.toLowerCase().indexOf(query.toLowerCase());
      if (idx !== -1) {
        displayName =
          r.name.slice(0, idx) +
          `<mark class="search-highlight">${r.name.slice(idx, idx + query.length)}</mark>` +
          r.name.slice(idx + query.length);
      }
    }

    return `
      <div class="recipe-card" onclick="openRecipe(${r.id})">
        <div class="card-img">${imgHTML}</div>
        <div class="card-body">
          <div class="card-badges">${badges}</div>
          <div class="card-title">${displayName}</div>
          <div class="card-meta">
            ${r.cook_time ? `<span>⏱ ${r.cook_time}</span>` : ""}
            ${r.servings ? `<span>👥 ${r.servings} servings</span>` : ""}
            ${stars}
            ${favBtn}
          </div>
          <div class="card-cost">₱${Math.round(r.total_cost).toLocaleString()} <span>est. total</span></div>
          ${uploader}
        </div>
      </div>`;
  }

  /* ── Render results into the grid ── */
  function renderResults(data) {
    spinner.classList.remove("active");

    if (data.recipes.length === 0) {
      grid.innerHTML = `
        <div class="no-results">
          <div class="icon">🔍</div>
          <p>No recipes found for "<strong>${data.query || data.filter}</strong>"</p>
          <small>Try a different ingredient or recipe name</small>
        </div>`;
    } else {
      grid.innerHTML = data.recipes
        .map((r) => buildCard(r, data.query))
        .join("");
    }

    // Update section title
    if (sectionTitle) {
      const count = data.count;
      if (data.query) {
        sectionTitle.innerHTML = `🔍 ${count} result${count !== 1 ? "s" : ""} for "<em>${data.query}</em>"`;
      } else {
        const labels = {
          all: "✨ Popular Recipes",
          spicy: "🌶️ Spicy Recipes",
          quick: "⚡ Quick Meals",
          budget: "💰 Budget-Friendly",
          favorites: "❤️ Your Favorites",
        };
        sectionTitle.textContent = labels[data.filter] || "✨ Popular Recipes";
      }
    }

    // Hide recipe of the day when searching
    if (rotdSection) {
      rotdSection.style.display =
        data.query || data.filter !== "all" ? "none" : "";
    }
  }

  /* ── Fetch recipes via AJAX ── */
  function fetchRecipes(q, filter) {
    spinner.classList.add("active");
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filter && filter !== "all") params.set("filter", filter);

    fetch(`/api/search?${params}`)
      .then((r) => r.json())
      .then((data) => renderResults(data))
      .catch(() => spinner.classList.remove("active"));

    // Update browser URL without reload
    const url = new URL(window.location);
    q ? url.searchParams.set("q", q) : url.searchParams.delete("q");
    filter !== "all"
      ? url.searchParams.set("filter", filter)
      : url.searchParams.delete("filter");
    window.history.replaceState({}, "", url);
  }

  /* ── Hook into both search inputs ── */
  function hookInput(inputId, formId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener("input", function () {
      const q = input.value.trim();
      currentQuery = q;

      // Sync both inputs
      ["searchInput", "searchInputMobile"].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el !== input) el.value = q;
      });

      clearTimeout(ajaxTimer);
      if (q.length === 0) {
        // Reset to default view
        isLiveMode = false;
        fetchRecipes("", currentFilter);
        return;
      }
      isLiveMode = true;
      ajaxTimer = setTimeout(() => fetchRecipes(q, currentFilter), DEBOUNCE_MS);
    });

    // Prevent form submit — we handle it via AJAX
    const form = document.getElementById(formId);
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        clearTimeout(ajaxTimer);
        fetchRecipes(currentQuery, currentFilter);
      });
    }
  }

  hookInput("searchInput", "searchForm");
  hookInput("searchInputMobile", "searchFormMobile");

  /* ── Override setFilter to use AJAX ── */
  window._originalSetFilter = window.setFilter;
  window.setFilter = function (filter, btn) {
    currentFilter = filter;

    // Update active state on ALL filter buttons (desktop + mobile pills)
    document
      .querySelectorAll(".filter-btn, .mobile-pill")
      .forEach((el) => el.classList.remove("active"));
    if (btn) btn.classList.add("active");

    // Also sync the hidden filter inputs
    ["hiddenFilter", "hiddenFilterMobile"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = filter;
    });

    fetchRecipes(currentQuery, filter);
  };
})();
