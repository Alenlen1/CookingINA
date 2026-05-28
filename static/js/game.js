"use strict";

const screen = document.getElementById("gameScreen");

/* ── DATA ── */
const RECIPES = [
  { name: "Adobo", emoji: "🍲", ingredients: ["🥩", "🧄", "🧅", "🍶", "🌿"] },
  {
    name: "Sinigang",
    emoji: "🍜",
    ingredients: ["🥩", "🍅", "🥬", "🧅", "🌶️"],
  },
  {
    name: "Kare-Kare",
    emoji: "🥘",
    ingredients: ["🥜", "🍆", "🥩", "🥬", "🧅"],
  },
  { name: "Lechon", emoji: "🐷", ingredients: ["🥩", "🧄", "🌿", "🍋", "🧂"] },
  { name: "Tinola", emoji: "🍗", ingredients: ["🍗", "🧄", "🧅", "🌿", "🥬"] },
  {
    name: "Caldereta",
    emoji: "🫕",
    ingredients: ["🥩", "🥕", "🥔", "🍅", "🌶️"],
  },
];

const QUIZ_QUESTIONS = [
  {
    q: "Which ingredient makes Sinigang sour?",
    opts: ["Tamarind", "Vinegar", "Calamansi", "Lemon"],
    ans: 0,
  },
  {
    q: "Adobo is cooked with soy sauce and?",
    opts: ["Lemon", "Vinegar", "Ketchup", "Fish sauce"],
    ans: 1,
  },
  {
    q: "What nut is Kare-Kare famous for?",
    opts: ["Cashew", "Almond", "Peanut", "Coconut"],
    ans: 2,
  },
  {
    q: "Tinola is a Filipino?",
    opts: ["Dessert", "Soup", "Salad", "Noodle dish"],
    ans: 1,
  },
  {
    q: "Lechon is a whole roasted?",
    opts: ["Chicken", "Beef", "Goat", "Pork"],
    ans: 3,
  },
  {
    q: "What is Bagoong?",
    opts: ["A rice", "A shrimp paste", "A vegetable", "A fruit"],
    ans: 1,
  },
  {
    q: "Which dish uses pork and liver sauce?",
    opts: ["Adobo", "Tinola", "Kare-Kare", "Sinigang"],
    ans: 2,
  },
  {
    q: "What is the base of Arroz Caldo?",
    opts: ["Noodles", "Rice porridge", "Bread", "Corn"],
    ans: 1,
  },
  {
    q: "Pancit is a Filipino?",
    opts: ["Noodle dish", "Rice cake", "Soup", "Salad"],
    ans: 0,
  },
  {
    q: "Which spice gives Caldereta its kick?",
    opts: ["Ginger", "Chili", "Turmeric", "Cumin"],
    ans: 1,
  },
];

const ALL_STAGES = [
  {
    id: "chop",
    emoji: "🔪",
    name: "Chop!",
    tip: "Tap each ingredient to chop it!",
    secs: 10,
  },
  {
    id: "stir",
    emoji: "🥄",
    name: "Stir!",
    tip: "Move in circles around the pot!",
    secs: 23,
  },
  {
    id: "fry",
    emoji: "🍳",
    name: "Fry timing!",
    tip: "Tap STOP when the bar is in the green zone!",
    secs: 15,
  },
  {
    id: "season",
    emoji: "🧂",
    name: "Season!",
    tip: "Shake each spice 3× to season!",
    secs: 12,
  },
  {
    id: "catch",
    emoji: "🧺",
    name: "Catch food!",
    tip: "Move your mouse/finger to catch falling food!",
    secs: 14,
  },
  {
    id: "quiz",
    emoji: "🧠",
    name: "Food trivia!",
    tip: "Answer the Filipino food question!",
    secs: 12,
  },
  {
    id: "plate",
    emoji: "🍽",
    name: "Plate it up!",
    tip: "Tap the correct ingredients for this recipe!",
    secs: 20,
  },
  {
    id: "memory",
    emoji: "🃏",
    name: "Food memory!",
    tip: "Match the pairs before time runs out!",
    secs: 23,
  },
];

/* ── STATE ── */
let score = 0,
  lives = 3,
  stageIdx = 0,
  recipe = null,
  gameActive = false;
let timerInterval = null,
  fryInterval = null,
  catchInterval = null;
let timeLeft = 0,
  combo = 1,
  highScore = 0;
let stirPrev = null,
  stirTotal = 0,
  stirRequired = 360 * 2.2;
let fryPos = 0,
  fryDir = 1,
  fryMin = 32,
  fryMax = 60;
let seasonCount = 0,
  chopDone = 0,
  chopTotal = 0;
let catchScore = 0,
  catchBasketX = 0,
  catchItems = [],
  catchCtx = null;
let quizAnswered = false;
let plateSelected = [],
  plateCorrect = [],
  plateWrong = [];
let memCards = [],
  memFlipped = [],
  memMatched = 0,
  memLock = false;
let STAGES = [];

/* ── UTILS ── */
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}
function rand(a, b) {
  return Math.floor(Math.random() * (b - a)) + a;
}
function stopAll() {
  gameActive = false;
  clearInterval(timerInterval);
  clearInterval(fryInterval);
  clearInterval(catchInterval);
}
function flash(msg, col) {
  const fb = document.getElementById("feedback");
  if (!fb) return;
  fb.textContent = msg;
  fb.style.color = col;
  fb.classList.add("show");
  setTimeout(() => fb.classList.remove("show"), 750);
}
function updateCombo() {
  const cb = document.getElementById("comboEl");
  if (!cb) return;
  if (combo >= 2) {
    cb.textContent = "🔥 x" + combo + " COMBO!";
    cb.classList.add("show");
  } else {
    cb.classList.remove("show");
  }
}
function loseLife() {
  stopAll();
  combo = 1;
  lives--;
  flash("⏰ Too slow! -❤️", "#ef4444");
  setTimeout(() => {
    if (lives <= 0) {
      showResult();
    } else {
      stageIdx++;
      showStage();
    }
  }, 1100);
}
function stageComplete(base) {
  stopAll();
  const timeBonus = Math.floor(timeLeft * 3);
  const comboBonus = combo >= 2 ? Math.floor(base * 0.3 * (combo - 1)) : 0;
  const total = base + timeBonus + comboBonus;
  score += total;
  combo++;
  updateCombo();
  let msg = `+${total} pts!`;
  if (timeBonus > 0) msg += ` (⚡+${timeBonus})`;
  if (comboBonus > 0) msg += ` (🔥+${comboBonus})`;
  flash(msg, "#22c55e");
  setTimeout(() => {
    stageIdx++;
    showStage();
  }, 1100);
}
function startTimer(secs) {
  timeLeft = secs;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft -= 0.1;
    const pct = Math.max(0, (timeLeft / secs) * 100);
    const bar = document.getElementById("timerBar");
    if (bar) {
      bar.style.width = pct + "%";
      bar.style.background = pct > 40 ? "#e67e22" : "#ef4444";
    }
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      loseLife();
    }
  }, 100);
}
function hudHTML() {
  const hearts = "❤️".repeat(lives) + "🖤".repeat(Math.max(0, 3 - lives));
  const dots = STAGES.map(
    (s, i) =>
      `<div class="dot ${i < stageIdx ? "done" : i === stageIdx ? "active" : ""}"></div>`,
  ).join("");
  return `
      <div class="hud">
        <span class="hud-lives">${hearts}</span>
        <span class="hud-combo" id="comboEl"></span>
        <span class="hud-score">⭐ ${score}</span>
      </div>
      <div style="font-size:0.75rem;color:var(--text3);margin-bottom:6px;">${recipe.emoji} ${recipe.name} — Stage ${stageIdx + 1}/${STAGES.length}</div>
      <div class="stage-dots">${dots}</div>
      <div class="timer-wrap"><div class="timer-fill" id="timerBar" style="width:100%"></div></div>
    `;
}

/* ══════════ SCREENS ══════════ */

function showStart() {
  const best = localStorage.getItem("ina_hiscore") || 0;
  screen.innerHTML = `
      <div class="game-title">👩‍🍳 Cooking Mama INA</div>
      <div class="game-subtitle">The ultimate Filipino cooking challenge!</div>
      <div style="font-size:4rem;margin:12px 0;animation:pulse 1.2s infinite alternate" >🍳</div>
      <style>@keyframes pulse{from{transform:scale(1)}to{transform:scale(1.12)}}</style>
      <div class="stage-preview">
        ${ALL_STAGES.map((s) => `<span class="stage-chip">${s.emoji} ${s.name}</span>`).join("")}
      </div>
      <p style="font-size:0.85rem;color:var(--text3);margin-bottom:6px">🏆 High Score: <strong>${best}</strong></p>
      <p style="font-size:0.82rem;color:var(--text3);margin-bottom:20px">Speed = bonus pts &nbsp;|&nbsp; Combos = score multiplier</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="action-btn" onclick="startGame(4)">▶ Quick (4 stages)</button>
        <button class="action-btn green" onclick="startGame(8)">🔥 Full Run (8 stages)</button>
      </div>
    `;
}

function startGame(count) {
  score = 0;
  lives = 3;
  stageIdx = 0;
  combo = 1;
  recipe = RECIPES[rand(0, RECIPES.length)];
  STAGES = shuffle(ALL_STAGES).slice(0, count);
  showStage();
}

function showStage() {
  if (stageIdx >= STAGES.length) {
    showResult();
    return;
  }
  const st = STAGES[stageIdx];
  gameActive = true;
  screen.innerHTML = `
      ${hudHTML()}
      <div id="stageArea">
        <div class="feedback" id="feedback"></div>
      </div>
    `;
  updateCombo();
  if (st.id === "chop") initChop();
  else if (st.id === "stir") initStir();
  else if (st.id === "fry") initFry();
  else if (st.id === "season") initSeason();
  else if (st.id === "catch") initCatch();
  else if (st.id === "quiz") initQuiz();
  else if (st.id === "plate") initPlate();
  else if (st.id === "memory") initMemory();
  startTimer(st.secs);
}

/* ══ CHOP ══ */
function initChop() {
  chopDone = 0;
  chopTotal = recipe.ingredients.length;
  const area = document.getElementById("stageArea");
  const items = recipe.ingredients
    .map(
      (e, i) =>
        `<span class="chop-item" id="chop-${i}" onclick="chopItem(${i})">${e}</span>`,
    )
    .join("");
  area.innerHTML += `
      <div class="stage-label">🔪 Chop for ${recipe.name}!</div>
      <div class="stage-instruction">Tap each ingredient fast!</div>
      <div class="prog-wrap"><div class="prog-fill" id="chopProg" style="width:0%"></div></div>
      <div class="chop-grid">${items}</div>
    `;
}
window.chopItem = function (i) {
  if (!gameActive) return;
  const el = document.getElementById("chop-" + i);
  if (!el || el.classList.contains("done")) return;
  el.classList.add("done");
  chopDone++;
  const p = document.getElementById("chopProg");
  if (p) p.style.width = (chopDone / chopTotal) * 100 + "%";
  flash("✂️ Chop!", "#8b4513");
  if (chopDone >= chopTotal) stageComplete(100);
};

/* ══ STIR ══ */
function initStir() {
  stirTotal = 0;
  stirPrev = null;
  const area = document.getElementById("stageArea");
  area.innerHTML += `
      <div class="stage-label">🥄 Stir the pot!</div>
      <div class="stage-instruction">Draw circles — faster = more points!</div>
      <div class="prog-wrap"><div class="prog-fill" id="stirProg" style="width:0%"></div></div>
      <canvas id="stirCanvas" width="180" height="180"></canvas>
    `;
  const cv = document.getElementById("stirCanvas");
  drawPot(cv, 0);
  function onMove(cx, cy) {
    if (!gameActive) return;
    const r = cv.getBoundingClientRect();
    const x = cx - r.left - 90,
      y = cy - r.top - 90;
    const angle = Math.atan2(y, x);
    if (stirPrev !== null) {
      let d = angle - stirPrev;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      stirTotal += Math.abs(d);
      const pct = Math.min(100, (stirTotal / stirRequired) * 100);
      const p = document.getElementById("stirProg");
      if (p) p.style.width = pct + "%";
      drawPot(cv, pct);
      if (stirTotal >= stirRequired) stageComplete(120);
    }
    stirPrev = angle;
  }
  cv.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
  cv.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false },
  );
  cv.addEventListener("mouseleave", () => {
    stirPrev = null;
  });
}
function drawPot(cv, pct) {
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, 180, 180);
  ctx.font = "80px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🍲", 90, 95);
  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(90, 90, 68, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * 2 * Math.PI);
    ctx.strokeStyle = "rgba(34,197,94,0.7)";
    ctx.lineWidth = 9;
    ctx.stroke();
  }
}

/* ══ FRY ══ */
function initFry() {
  fryPos = 0;
  fryDir = 1;
  fryMin = 32;
  fryMax = 60;
  const area = document.getElementById("stageArea");
  area.innerHTML += `
      <div class="stage-label">🍳 Fry it perfectly!</div>
      <div class="stage-instruction">Tap STOP when the orange bar is in the green zone!</div>
      <div style="font-size:56px;margin:4px 0">🥩</div>
      <div class="fry-track">
        <div class="fry-green" id="sweetZone"></div>
        <div class="fry-cursor" id="fryInd"></div>
      </div>
      <button class="action-btn" style="margin-top:14px" onclick="stopFry()">🛑 STOP!</button>
    `;
  const sw = document.getElementById("sweetZone");
  if (sw) {
    sw.style.left = fryMin + "%";
    sw.style.width = fryMax - fryMin + "%";
  }
  fryInterval = setInterval(() => {
    fryPos += fryDir * 2.2;
    if (fryPos >= 100) {
      fryPos = 100;
      fryDir = -1;
    }
    if (fryPos <= 0) {
      fryPos = 0;
      fryDir = 1;
    }
    const ind = document.getElementById("fryInd");
    if (ind) ind.style.left = `calc(${fryPos}% - 18px)`;
  }, 28);
}
window.stopFry = function () {
  if (!gameActive) return;
  clearInterval(fryInterval);
  if (fryPos >= fryMin && fryPos <= fryMax) {
    stageComplete(160);
  } else {
    const dist = Math.min(Math.abs(fryPos - fryMin), Math.abs(fryPos - fryMax));
    if (dist < 14) stageComplete(70);
    else loseLife();
  }
};

/* ══ SEASON ══ */
function initSeason() {
  seasonCount = 0;
  const area = document.getElementById("stageArea");
  area.innerHTML += `
      <div class="stage-label">🧂 Season the dish!</div>
      <div class="stage-instruction">Tap each spice 3× to season!</div>
      <div class="prog-wrap"><div class="prog-fill" id="seasonProg" style="width:0%"></div></div>
      <div style="font-size:60px" id="bowl">🍲</div>
      <div style="display:flex;gap:14px;justify-content:center">
        <div class="shaker" id="sh0" onclick="shake(0)" data-c="0">🧂</div>
        <div class="shaker" id="sh1" onclick="shake(1)" data-c="0">🌶️</div>
        <div class="shaker" id="sh2" onclick="shake(2)" data-c="0">🧄</div>
        <div class="shaker" id="sh3" onclick="shake(3)" data-c="0">🫚</div>
      </div>
      <div id="seasonSt" style="font-size:0.8rem;color:var(--text3)">0 / 12 shakes</div>
    `;
}
window.shake = function (i) {
  if (!gameActive) return;
  const el = document.getElementById("sh" + i);
  if (!el) return;
  let c = parseInt(el.dataset.c) + 1;
  el.dataset.c = c;
  if (c >= 3) el.classList.add("used");
  seasonCount++;
  const p = document.getElementById("seasonProg");
  if (p) p.style.width = (seasonCount / 12) * 100 + "%";
  const st = document.getElementById("seasonSt");
  if (st) st.textContent = `${seasonCount} / 12 shakes`;
  flash("✨", "#8b4513");
  const bowl = document.getElementById("bowl");
  if (bowl) {
    bowl.style.transform = "scale(1.18)";
    setTimeout(() => (bowl.style.transform = ""), 140);
  }
  if (seasonCount >= 12) stageComplete(130);
};

/* ══ CATCH ══ */
function initCatch() {
  catchScore = 0;
  const area = document.getElementById("stageArea");
  area.innerHTML += `
      <div class="stage-label">🧺 Catch the falling food!</div>
      <div class="stage-instruction">Move mouse/finger to catch ingredients!</div>
      <div id="catchScore" style="font-size:0.85rem;color:var(--text2)">Caught: 0</div>
      <canvas id="catchCanvas" width="300" height="200"></canvas>
    `;
  const cv = document.getElementById("catchCanvas");
  catchCtx = cv.getContext("2d");
  catchBasketX = 150;
  catchItems = [];
  const foods = ["🍅", "🥩", "🧅", "🧄", "🥬", "🍋", "🌶️", "🥕"];
  catchInterval = setInterval(() => {
    if (!gameActive) {
      clearInterval(catchInterval);
      return;
    }
    if (Math.random() < 0.11) {
      catchItems.push({
        x: rand(20, 280),
        y: -20,
        speed: rand(1, 4),
        emoji: foods[rand(0, foods.length)],
      });
    }
    catchCtx.clearRect(0, 0, 300, 200);
    // basket
    catchCtx.font = "32px serif";
    catchCtx.textAlign = "center";
    catchCtx.fillText("🧺", catchBasketX, 188);
    // items
    catchItems.forEach((item, idx2) => {
      item.y += item.speed;
      catchCtx.font = "26px serif";
      catchCtx.fillText(item.emoji, item.x, item.y);
      if (item.y > 165 && Math.abs(item.x - catchBasketX) < 40) {
        catchScore++;
        const s = document.getElementById("catchScore");
        if (s) s.textContent = "Caught: " + catchScore;
        flash("🎉 +1", "#22c55e");
        catchItems.splice(idx2, 1);
        if (catchScore >= 8) stageComplete(140);
      } else if (item.y > 210) {
        catchItems.splice(idx2, 1);
      }
    });
  }, 50);
  function moveCatch(cx, cy) {
    if (!gameActive) return;
    const r = cv.getBoundingClientRect();
    catchBasketX = Math.max(30, Math.min(270, cx - r.left));
  }
  cv.addEventListener("mousemove", (e) => moveCatch(e.clientX, e.clientY));
  cv.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      moveCatch(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false },
  );
}

/* ══ QUIZ ══ */
function initQuiz() {
  quizAnswered = false;
  const q = QUIZ_QUESTIONS[rand(0, QUIZ_QUESTIONS.length)];
  const area = document.getElementById("stageArea");
  const shuffledOpts = q.opts.map((o, i) => ({ text: o, orig: i }));
  const correctText = q.opts[q.ans];
  area.innerHTML += `
      <div class="stage-label">🧠 Filipino Food Trivia!</div>
      <div style="font-size:1rem;font-weight:600;color:var(--text1);max-width:320px;text-align:center;line-height:1.4">${q.q}</div>
      <div class="quiz-opts">
        ${shuffledOpts.map((o) => `<button class="quiz-opt" onclick="answerQuiz(this,'${o.text}','${correctText}')">${o.text}</button>`).join("")}
      </div>
    `;
}
window.answerQuiz = function (el, chosen, correct) {
  if (!gameActive || quizAnswered) return;
  quizAnswered = true;
  clearInterval(timerInterval);
  document.querySelectorAll(".quiz-opt").forEach((b) => (b.disabled = true));
  if (chosen === correct) {
    el.classList.add("correct");
    stageComplete(150);
  } else {
    el.classList.add("wrong");
    document.querySelectorAll(".quiz-opt").forEach((b) => {
      if (b.textContent === correct) b.classList.add("correct");
    });
    flash("❌ Wrong!", "#ef4444");
    setTimeout(() => {
      if (lives <= 1) {
        lives--;
        showResult();
      } else {
        lives--;
        stageIdx++;
        showStage();
      }
    }, 1200);
  }
};

/* ══ PLATE ══ */
function initPlate() {
  plateSelected = [];
  const area = document.getElementById("stageArea");
  const correct = recipe.ingredients.slice();
  // add 3 wrong items
  const allIngredients = [
    "🫑",
    "🥦",
    "🍆",
    "🥑",
    "🍄",
    "🫒",
    "🥚",
    "🧀",
    "🍋",
    "🥐",
    "🌽",
    "🥒",
  ];
  const wrongs = shuffle(allIngredients).slice(0, 3);
  const allItems = shuffle([...correct, ...wrongs]);
  plateCorrect = correct;
  area.innerHTML += `
      <div class="stage-label">🍽 Plate the ${recipe.name}!</div>
      <div class="stage-instruction">Select only the correct ingredients!</div>
      <div class="plate-drop" id="plateDrop">Drop here</div>
      <div class="plate-items">
        ${allItems.map((e) => `<div class="plate-item" onclick="selectPlateItem(this,'${e}')">${e}</div>`).join("")}
      </div>
      <button class="action-btn" style="margin-top:8px;padding:10px 24px;font-size:0.88rem" onclick="checkPlate()">✅ Serve it!</button>
    `;
}
window.selectPlateItem = function (el, emoji) {
  if (!gameActive) return;
  el.classList.toggle("selected");
  const drop = document.getElementById("plateDrop");
  if (el.classList.contains("selected")) {
    plateSelected.push(emoji);
  } else {
    plateSelected = plateSelected.filter((e) => e !== emoji);
  }
  if (drop) {
    drop.textContent = plateSelected.join(" ") || "Drop here";
  }
};
window.checkPlate = function () {
  if (!gameActive) return;
  const correct = plateCorrect.slice().sort().join("");
  const chosen = [...plateSelected].sort().join("");
  if (chosen === correct) {
    stageComplete(140);
  } else {
    flash("❌ Wrong ingredients!", "#ef4444");
    const missing = plateCorrect.filter((e) => !plateSelected.includes(e));
    const extra = plateSelected.filter((e) => !plateCorrect.includes(e));
    if (missing.length > 0 || extra.length > 0) loseLife();
    else stageComplete(60);
  }
};

/* ══ MEMORY ══ */
function initMemory() {
  memMatched = 0;
  memFlipped = [];
  memLock = false;
  const pairs = ["🥩", "🧄", "🍅", "🥬", "🧅", "🌿", "🍋", "🌶️"];
  const cards = shuffle([...pairs, ...pairs]);
  memCards = cards.map((e, i) => ({
    emoji: e,
    id: i,
    flipped: false,
    matched: false,
  }));
  const area = document.getElementById("stageArea");
  area.innerHTML += `
      <div class="stage-label">🃏 Match the food pairs!</div>
      <div class="stage-instruction">Find all 8 matching pairs!</div>
      <div class="memory-grid" id="memGrid">
        ${memCards.map((c, i) => `<div class="mem-card" id="mc${i}" onclick="flipCard(${i})">❓</div>`).join("")}
      </div>
    `;
}
window.flipCard = function (i) {
  if (!gameActive || memLock) return;
  const c = memCards[i];
  if (c.flipped || c.matched) return;
  c.flipped = true;
  const el = document.getElementById("mc" + i);
  if (el) {
    el.textContent = c.emoji;
    el.classList.add("flip");
  }
  memFlipped.push(i);
  if (memFlipped.length === 2) {
    memLock = true;
    const [a, b] = memFlipped;
    if (memCards[a].emoji === memCards[b].emoji) {
      memCards[a].matched = true;
      memCards[b].matched = true;
      const ea = document.getElementById("mc" + a);
      const eb = document.getElementById("mc" + b);
      if (ea) ea.classList.add("matched");
      if (eb) eb.classList.add("matched");
      memMatched++;
      flash("✅ Match!", "#22c55e");
      memFlipped = [];
      memLock = false;
      if (memMatched >= 8) stageComplete(170);
    } else {
      setTimeout(() => {
        [a, b].forEach((idx2) => {
          memCards[idx2].flipped = false;
          const e = document.getElementById("mc" + idx2);
          if (e) {
            e.textContent = "❓";
            e.classList.remove("flip");
          }
        });
        memFlipped = [];
        memLock = false;
      }, 900);
    }
  }
};

/* ══ RESULT ══ */
function showResult() {
  stopAll();
  const prev = parseInt(localStorage.getItem("ina_hiscore") || "0");
  const isNew = score > prev;
  if (isNew) localStorage.setItem("ina_hiscore", score);

  let grade, emoji, msg;
  if (score >= 700) {
    grade = "S";
    emoji = "🏆";
    msg = "Perfect! Mama is crying happy tears!";
  } else if (score >= 550) {
    grade = "A";
    emoji = "⭐";
    msg = "Excellent! Mama would be proud!";
  } else if (score >= 380) {
    grade = "B";
    emoji = "😊";
    msg = "Good job! Keep practicing!";
  } else if (score >= 200) {
    grade = "C";
    emoji = "😅";
    msg = "Not bad, but Mama cried a little.";
  } else {
    grade = "D";
    emoji = "😢";
    msg = "Mama will redo this for you...";
  }

  screen.innerHTML = `
      <div class="result-grade">${emoji}</div>
      <div class="result-title">Grade ${grade} — ${recipe.name}</div>
      <div class="result-score">${score} pts</div>
      ${isNew ? `<div class="highscore-badge">🎉 NEW HIGH SCORE!</div>` : `<p style="font-size:0.8rem;color:var(--text3)">Best: ${Math.max(score, prev)} pts</p>`}
      <div class="result-msg">${msg}</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="action-btn" onclick="startGame(${STAGES.length})">🔄 Play Again</button>
        <button class="action-btn green" onclick="startGame(8)">🔥 Full Run</button>
        <a href="{{ url_for('index') }}" class="action-btn gray" style="text-decoration:none">🍽 Recipes</a>
      </div>
    `;
}

showStart();
