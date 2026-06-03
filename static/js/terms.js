
function openTermsModal(tab) {
  switchTermsTab(tab || "terms");
  document.getElementById("termsOverlay").classList.add("open");
}

function closeTermsModal() {
  document.getElementById("termsOverlay").classList.remove("open");
}

function closeTermsOnBackdrop(e) {
  if (e.target === document.getElementById("termsOverlay")) closeTermsModal();
}

function switchTermsTab(tab) {
  const isTerms = tab === "terms";
  document.getElementById("termsContent").style.display = isTerms ? "" : "none";
  document.getElementById("privacyContent").style.display = isTerms
    ? "none"
    : "";
  document.getElementById("tabTerms").classList.toggle("active", isTerms);
  document.getElementById("tabPrivacy").classList.toggle("active", !isTerms);
}

function acceptTerms() {
  document.getElementById("termsCheckbox").checked = true;
  closeTermsModal();
}

function copyAdminEmail(btn) {
  navigator.clipboard.writeText("cookingina.noreply@gmail.com").then(() => {
    const icon = btn.querySelector(".copy-icon");
    icon.textContent = "✓";
    btn.classList.add("copied");
    setTimeout(() => {
      icon.textContent = "⧉";
      btn.classList.remove("copied");
    }, 2000);
  });
}

/* ── Guard initiateRegister to require T&C ─────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  const regBtn = document.getElementById("regBtn");
  if (regBtn) {
    regBtn.removeAttribute("onclick");
    regBtn.addEventListener("click", function () {
      if (!document.getElementById("termsCheckbox").checked) {
        const banner = document.getElementById("regError");
        banner.textContent =
          "Please read and accept the Terms & Conditions to continue.";
        banner.style.display = "";
        return;
      }
      if (typeof initiateRegister === "function") initiateRegister();
    });
  }
});
