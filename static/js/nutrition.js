async function fetchNutrition() {
  const recipe = window._currentRecipe;
  if (!recipe || !recipe.ingredients || !recipe.ingredients.length) return;

  const servings = Math.max(1, parseInt(recipe.servings) || 1);

  const idle = document.getElementById("nutritionIdle");
  const loading = document.getElementById("nutritionLoading");
  const result = document.getElementById("nutritionResult");
  const errBox = document.getElementById("nutritionError");

  idle.style.display = "none";
  loading.style.display = "block";
  result.style.display = "none";
  errBox.style.display = "none";

  try {
    const res = await fetch("/api/nutrition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ingredients: recipe.ingredients.map((i) => i.name),
        servings: servings,
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Safe number parser
    const n = (v) => {
      const x = parseFloat(v);
      return isNaN(x) ? 0 : x;
    };
    const safe = (v) => Math.round(n(v)) || 0;

    // Gemini returns TOTALS — we divide for per-serving
    const totalCal = safe(data.calories);
    const totalProt = safe(data.protein);
    const totalCarb = safe(data.carbs);
    const totalFat = safe(data.fat);
    const totalFiber = safe(data.fiber);
    const note = data.note || "";

    const perCal = Math.round(totalCal / servings);
    const perProt = Math.round(totalProt / servings);
    const perCarb = Math.round(totalCarb / servings);
    const perFat = Math.round(totalFat / servings);
    const perFiber = Math.round(totalFiber / servings);

    // Macro % for bar widths (based on per-serving)
    const calFromMacros = perProt * 4 + perCarb * 4 + perFat * 9 || 1;
    const pPct = Math.round(((perProt * 4) / calFromMacros) * 100);
    const cPct = Math.round(((perCarb * 4) / calFromMacros) * 100);
    const fPct = Math.round(((perFat * 9) / calFromMacros) * 100);
    const fibPct = Math.min(100, perFiber * 5);

    const macroRow = (label, perValue, totalValue, cssClass, pct) =>
      `<div class="macro-row">
         <span class="macro-label">${label}</span>
         <div class="macro-track">
           <div class="macro-fill ${cssClass}" style="width:${pct}%"></div>
         </div>
         <span class="macro-value">${perValue}g</span>
       </div>`;

    const pill = (emoji, label, value) =>
      `<span class="nutrition-pill">${emoji} ${label} <strong>${value}g</strong></span>`;

    result.innerHTML = `
      <div class="nutrition-card">

        <!-- Per serving headline -->
        <div class="nutrition-headline">
          <span class="nutrition-cal-value">${perCal}</span>
          <span class="nutrition-cal-unit">Cal per serving</span>
          <span class="nutrition-servings">${servings} serving${servings !== 1 ? "s" : ""}</span>
        </div>

        <!-- Macro bars (per serving) -->
        <div class="nutrition-macros">
          ${macroRow("Protein", perProt, totalProt, "protein", pPct)}
          ${macroRow("Carbs", perCarb, totalCarb, "carbs", cPct)}
          ${macroRow("Fat", perFat, totalFat, "fat", fPct)}
          ${macroRow("Fiber", perFiber, totalFiber, "fiber", fibPct)}
        </div>

        <!-- Total recipe calories -->
        <div class="nutrition-total">
          <span class="nutrition-total-label">Total recipe</span>
          <span class="nutrition-total-value">${totalCal} Cal</span>
        </div>

        <!-- Pills (per serving) -->
        <div class="nutrition-pills">
          ${pill("🥩", "Protein", perProt)}
          ${pill("🍞", "Carbs", perCarb)}
          ${pill("🫒", "Fat", perFat)}
          ${pill("🌿", "Fiber", perFiber)}
        </div>

        ${note ? `<p class="nutrition-note">📝 ${note}</p>` : ""}
        <p class="nutrition-note" style="margin-top:4px">
          ⚠️ Estimates assume typical Filipino portion sizes. Actual nutrition may vary.
          Powered by Gemini AI.
        </p>
      </div>`;

    loading.style.display = "none";
    result.style.display = "block";
  } catch (err) {
    loading.style.display = "none";
    errBox.textContent =
      "❌ " + (err.message || "Could not load nutrition data.");
    errBox.style.display = "block";
    idle.style.display = "flex";
    const btn = document.getElementById("nutritionBtn");
    if (btn) btn.textContent = "Retry";
  }
}

// Expose renderNutrition so autoFetchNutrition in script.js can call it
window.renderNutritionData = function (data, servings) {
  const result = document.getElementById("nutritionResult");
  const loading = document.getElementById("nutritionLoading");
  const idle = document.getElementById("nutritionIdle");
  if (!result) return;

  const n = (v) => {
    const x = parseFloat(v);
    return isNaN(x) ? 0 : x;
  };
  const safe = (v) => Math.round(n(v)) || 0;

  const totalCal = safe(data.calories);
  const totalProt = safe(data.protein);
  const totalCarb = safe(data.carbs);
  const totalFat = safe(data.fat);
  const totalFiber = safe(data.fiber);
  const note = data.note || "";

  const perCal = Math.round(totalCal / servings);
  const perProt = Math.round(totalProt / servings);
  const perCarb = Math.round(totalCarb / servings);
  const perFat = Math.round(totalFat / servings);
  const perFiber = Math.round(totalFiber / servings);

  const calFromMacros = perProt * 4 + perCarb * 4 + perFat * 9 || 1;
  const pPct = Math.round(((perProt * 4) / calFromMacros) * 100);
  const cPct = Math.round(((perCarb * 4) / calFromMacros) * 100);
  const fPct = Math.round(((perFat * 9) / calFromMacros) * 100);
  const fibPct = Math.min(100, perFiber * 5);

  const macroRow = (label, perValue, cssClass, pct) =>
    `<div class="macro-row">
       <span class="macro-label">${label}</span>
       <div class="macro-track">
         <div class="macro-fill ${cssClass}" style="width:${pct}%"></div>
       </div>
       <span class="macro-value">${perValue}g</span>
     </div>`;

  const pill = (emoji, label, value) =>
    `<span class="nutrition-pill">${emoji} ${label} <strong>${value}g</strong></span>`;

  result.innerHTML = `
    <div class="nutrition-card">
      <div class="nutrition-headline">
        <span class="nutrition-cal-value">${perCal}</span>
        <span class="nutrition-cal-unit">Cal per serving</span>
        <span class="nutrition-servings">${servings} serving${servings !== 1 ? "s" : ""}</span>
      </div>
      <div class="nutrition-macros">
        ${macroRow("Protein", perProt, "protein", pPct)}
        ${macroRow("Carbs", perCarb, "carbs", cPct)}
        ${macroRow("Fat", perFat, "fat", fPct)}
        ${macroRow("Fiber", perFiber, "fiber", fibPct)}
      </div>
      <div class="nutrition-total">
        <span class="nutrition-total-label">Total recipe</span>
        <span class="nutrition-total-value">${totalCal} Cal</span>
      </div>
      <div class="nutrition-pills">
        ${pill("🥩", "Protein", perProt)}
        ${pill("🍞", "Carbs", perCarb)}
        ${pill("🫒", "Fat", perFat)}
        ${pill("🌿", "Fiber", perFiber)}
      </div>
      ${note ? `<p class="nutrition-note">📝 ${note}</p>` : ""}
      <p class="nutrition-note" style="margin-top:4px">
        ⚠️ Estimates assume typical Filipino portion sizes. Actual nutrition may vary.
        Powered by Gemini AI.
      </p>
    </div>`;

  if (loading) loading.style.display = "none";
  if (idle) idle.style.display = "none";
  result.style.display = "block";
};
