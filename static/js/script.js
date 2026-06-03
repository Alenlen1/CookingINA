/* ============================================================
   Cooking INA — Main JavaScript
   ============================================================ */

"use strict";

/* ============================================================
   GLOBAL STATE
   ============================================================ */

let darkMode = localStorage.getItem("cookingina_dark") === "1";
let speechSynth = window.speechSynthesis;
let currentUtterance = null;
let recognition = null;

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
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");

  if (hiddenFilter) hiddenFilter.value = filter;
  if (filter !== "all" && searchInput) searchInput.value = "";

  if (searchForm) {
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
          <span>👥 ${r.servings} servings</span>
          <span>🍴 ${r.ingredients.length} ingredients</span>
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
        </div>

        <div class="section-head">🧺 Ingredients</div>
        <ul class="ingredient-list">
          ${r.ingredients
            .map(
              (i) => `
            <li>
              <span>${escHtml(i.name)}</span>
              <span class="ing-price">₱${Number(i.price).toLocaleString()}</span>
            </li>`,
            )
            .join("")}
        </ul>

        <div class="total-cost">
          <span class="label">💰 Total Estimated Cost</span>
          <span class="amount">₱${totalCost.toLocaleString()}</span>
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
  } catch (err) {
    modal.innerHTML = `
      <div class="modal-body" style="text-align:center;padding:60px 28px">
        <div style="font-size:48px;margin-bottom:16px">⚠️</div>
        <p style="color:var(--text3);font-weight:300">Failed to load recipe. Try again.</p>
        <button class="close-btn" onclick="closeModal()" style="margin-top:16px;width:auto;padding:8px 20px;border-radius:50px">Close</button>
      </div>`;
  }
}

function closeModal() {
  stopTTS();
  const overlay = document.getElementById("modalOverlay");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
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
      if (searchInput) searchInput.value = transcript;
      cancelVoice();
      const form = document.getElementById("searchForm");
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
