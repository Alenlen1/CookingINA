/* ================================================================
   Cooking INA — auth.js
   Place at: static/js/auth.js

   Handles:
     • Feature 1 — Email-verified registration
     • Feature 2 — Forgot / reset password
     • Feature 3 — Change password (settings)

   All API calls use fetch/AJAX — no full page reloads.
   ================================================================ */

"use strict";

/* ================================================================
   SHARED UTILITIES
   ================================================================ */

/** Show/hide a banner element with a message */
function showBanner(id, msg, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `auth-banner auth-banner-${type}`;
  el.textContent = msg;
  el.style.display = "block";
}
function clearBanner(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

/** Briefly show a toast message */
function showToast(msg, type = "success", duration = 3500) {
  let toast = document.getElementById("authToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "authToast";
    toast.className = "auth-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `auth-toast toast-${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), duration);
}

/** Set a button into loading state (disable + show spinner) */
function setLoading(btnId, textId, spinnerId, loading) {
  const btn = document.getElementById(btnId);
  const text = document.getElementById(textId);
  const spin = document.getElementById(spinnerId);
  if (btn) btn.disabled = loading;
  if (spin) spin.style.display = loading ? "inline" : "none";
  if (text) text.style.opacity = loading ? ".6" : "1";
}

/** Collect all 6 OTP digit inputs into a string */
function getOtpValue(prefix = "") {
  const container = document.getElementById(
    prefix ? `${prefix}OtpInputs` : "otpInputs",
  );
  if (!container) return "";
  return [...container.querySelectorAll(".otp-digit")]
    .map((i) => i.value)
    .join("");
}

/** Clear all OTP digit inputs */
function clearOtpInputs(prefix = "") {
  const container = document.getElementById(
    prefix ? `${prefix}OtpInputs` : "otpInputs",
  );
  if (!container) return;
  container.querySelectorAll(".otp-digit").forEach((d) => {
    d.value = "";
    d.classList.remove("filled", "shake");
  });
  const first = container.querySelector(".otp-digit");
  if (first) first.focus();
}

/** Shake all OTP digits to signal error */
function shakeOtp(prefix = "") {
  const container = document.getElementById(
    prefix ? `${prefix}OtpInputs` : "otpInputs",
  );
  if (!container) return;
  container.querySelectorAll(".otp-digit").forEach((d) => {
    d.classList.remove("shake");
    void d.offsetWidth; // reflow to restart animation
    d.classList.add("shake");
  });
}

/**
 * Handle input in an OTP digit box — auto-advance, fill-styling.
 * @param {HTMLInputElement} el  - the input element
 * @param {number}           idx - 0-based index of this digit
 * @param {string}           prefix - '' for registration, 'fp' for forgot-password
 */
function otpInput(el, idx, prefix = "") {
  // Allow only digits
  el.value = el.value.replace(/\D/g, "");
  if (el.value) {
    el.classList.add("filled");
    // Auto-advance to next digit
    const container = el.closest(".otp-inputs");
    const siblings = [...container.querySelectorAll(".otp-digit")];
    if (idx < siblings.length - 1) siblings[idx + 1].focus();
    // Auto-submit when all filled
    if (siblings.every((d) => d.value)) {
      if (prefix === "fp") fpVerifyCode();
      else verifyRegCode();
    }
  } else {
    el.classList.remove("filled");
  }
}

/**
 * Handle backspace in OTP digit box — go back to previous digit.
 */
function otpBack(event, el, idx, prefix = "") {
  if (event.key === "Backspace" && !el.value) {
    const container = el.closest(".otp-inputs");
    const siblings = [...container.querySelectorAll(".otp-digit")];
    if (idx > 0) {
      siblings[idx - 1].value = "";
      siblings[idx - 1].classList.remove("filled");
      siblings[idx - 1].focus();
    }
  }
}

/** Toggle password visibility */
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.textContent = show ? "🙈" : "👁";
}

/** Password strength checker */
function checkPwStrength(value) {
  const wrap = document.getElementById("pwStrength");
  const fill = document.getElementById("pwFill");
  const label = document.getElementById("pwLabel");
  if (!wrap || !fill || !label) return;

  if (!value) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "flex";

  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;

  const levels = ["", "weak", "fair", "good", "strong", "strong"];
  const names = ["", "Weak", "Fair", "Good", "Strong", "Strong"];
  const cls = levels[Math.min(score, 4)];
  fill.className = `pw-fill ${cls}`;
  label.textContent = names[Math.min(score, 4)];
}

/** Start and manage a countdown timer on the resend button */
function startCountdown(btnId, countdownId, seconds) {
  const btn = document.getElementById(btnId);
  const countEl = document.getElementById(countdownId);
  if (!btn || !countEl) return;

  btn.disabled = true;
  countEl.style.display = "inline";

  let remaining = seconds;
  const tick = () => {
    countEl.textContent = `(${remaining}s)`;
    if (remaining <= 0) {
      btn.disabled = false;
      countEl.style.display = "none";
      return;
    }
    remaining--;
    setTimeout(tick, 1000);
  };
  tick();
}

/** Generic fetch wrapper returning parsed JSON */
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

/* ================================================================
   FEATURE 1 — EMAIL-VERIFIED REGISTRATION
   ================================================================ */

let _regEmail = "";

/** Step 1: validate form, call /register/initiate, open OTP modal */
async function initiateRegister() {
  clearBanner("regError");

  const username = document.getElementById("regUsername")?.value.trim() || "";
  const email = document.getElementById("regEmail")?.value.trim() || "";
  const password = document.getElementById("regPassword")?.value || "";
  const confirm = document.getElementById("regConfirm")?.value || "";

  // Client-side pre-validation
  if (!username || !email || !password || !confirm) {
    showBanner("regError", "Please fill in all fields.");
    return;
  }
  if (password !== confirm) {
    showBanner("regError", "Passwords do not match.");
    return;
  }
  if (password.length < 8) {
    showBanner("regError", "Password must be at least 8 characters.");
    return;
  }

  setLoading("regBtn", "regBtnText", "regBtnSpinner", true);

  try {
    const { ok, data } = await apiPost("/register/initiate", {
      username,
      email,
      password,
      confirm,
    });

    if (data.ok) {
      _regEmail = data.email;
      openOtpModal(email);
      startCountdown("otpResendBtn", "otpCountdown", 30);
      const subText = document.getElementById("otpSubText");
      if (subText) {
        subText.innerHTML = `We sent a 6-digit code to <strong>${email}</strong>
      <br><small style="color:#9A7E68;font-size:0.78rem;">
      Can't find it? Check your spam/junk folder.</small>`;
      }
    } else {
      showBanner("regError", data.error || "Something went wrong.");
      if (data.cooldown) startCountdown("regBtn", "", data.cooldown);
    }
  } catch (e) {
    showBanner("regError", "Network error. Please try again.");
  } finally {
    setLoading("regBtn", "regBtnText", "regBtnSpinner", false);
  }
}

/** Open the OTP verification modal */
function openOtpModal(email) {
  const overlay = document.getElementById("otpOverlay");
  const display = document.getElementById("otpEmailDisplay");
  if (display) display.textContent = email;
  if (overlay) overlay.classList.add("open");
  clearOtpInputs();
  clearBanner("otpError");
  clearBanner("otpSuccess");
  // Focus first digit
  setTimeout(() => {
    const first = document.querySelector("#otpInputs .otp-digit");
    if (first) first.focus();
  }, 300);
}

function closeOtpModal() {
  const overlay = document.getElementById("otpOverlay");
  if (overlay) overlay.classList.remove("open");
}

/** Step 2: verify the OTP code */
async function verifyRegCode() {
  clearBanner("otpError");
  clearBanner("otpSuccess");
  const code = getOtpValue();
  if (code.length < 6) {
    showBanner("otpError", "Please enter all 6 digits.");
    return;
  }

  setLoading("otpVerifyBtn", "otpVerifyText", "otpVerifySpinner", true);

  try {
    const { ok, data } = await apiPost("/register/verify", {
      email: _regEmail,
      code,
    });

    if (data.ok) {
      showBanner(
        "otpSuccess",
        data.message || "🎉 Account created!",
        "success",
      );
      clearBanner("otpError");
      setTimeout(() => {
        window.location.href = data.redirect || "/login";
      }, 1600);
    } else {
      shakeOtp();
      showBanner("otpError", data.error || "Incorrect code.");
      if (data.restart || data.maxed) {
        setTimeout(() => {
          closeOtpModal();
          showBanner("regError", data.error);
        }, 1500);
      }
      if (data.expired) {
        clearOtpInputs();
        document.getElementById("otpResendBtn").disabled = false;
        document.getElementById("otpCountdown").style.display = "none";
      }
    }
  } catch (e) {
    showBanner("otpError", "Network error. Please try again.");
  } finally {
    setLoading("otpVerifyBtn", "otpVerifyText", "otpVerifySpinner", false);
  }
}

/** Resend registration OTP */
async function resendRegCode() {
  clearBanner("otpError");
  clearBanner("otpSuccess");
  clearOtpInputs();

  try {
    const { ok, data } = await apiPost("/register/resend", {
      email: _regEmail,
    });
    if (data.ok) {
      showBanner("otpSuccess", data.message, "success");
      startCountdown("otpResendBtn", "otpCountdown", 30);
    } else {
      showBanner("otpError", data.error);
      if (data.cooldown)
        startCountdown("otpResendBtn", "otpCountdown", data.cooldown);
      if (data.restart) {
        closeOtpModal();
        showBanner("regError", data.error);
      }
    }
  } catch (e) {
    showBanner("otpError", "Network error. Please try again.");
  }
}

/* ================================================================
   FEATURE 2 — FORGOT PASSWORD
   ================================================================ */

let _fpEmail = "";

/** Show a specific step panel */
function fpGoStep(step) {
  [1, 2, 3].forEach((n) => {
    const el = document.getElementById(`fpStep${n}`);
    if (el) el.style.display = n === step ? "block" : "none";
  });
}

/** Step 1: send reset code */
async function fpSendCode() {
  clearBanner("fp1Error");
  const email = document.getElementById("fpEmail")?.value.trim() || "";
  if (!email) {
    showBanner("fp1Error", "Please enter your email address.");
    return;
  }

  setLoading("fpSendBtn", "fpSendText", "fpSendSpinner", true);

  try {
    const { ok, data } = await apiPost("/forgot-password/send", { email });

    if (data.ok) {
      _fpEmail = data.email || email;
      const display = document.getElementById("fpEmailDisplay");
      if (display) display.textContent = _fpEmail;
      fpGoStep(2);

      // ← ADD THIS
      const subText = document
        .getElementById("fpStep2")
        ?.querySelector(".otp-sub");
      if (subText) {
        subText.innerHTML = `Code sent to <strong>${_fpEmail}</strong>
      <br><small style="color:#9A7E68;font-size:0.78rem;">
      Can't find it? Check your spam/junk folder.</small>`;
      }

      clearOtpInputs("fp");
      clearBanner("fp2Error");
      clearBanner("fp2Success");
      startCountdown("fpResendBtn", "fpCountdown", 30);
      setTimeout(() => {
        const first = document.querySelector("#fpOtpInputs .otp-digit");
        if (first) first.focus();
      }, 300);
    } else {
      showBanner("fp1Error", data.error || "Could not send reset code.");
      if (data.cooldown) startCountdown("fpSendBtn", "", data.cooldown);
    }
  } catch (e) {
    showBanner("fp1Error", "Network error. Please try again.");
  } finally {
    setLoading("fpSendBtn", "fpSendText", "fpSendSpinner", false);
  }
}

/** Step 2: verify reset code */
async function fpVerifyCode() {
  clearBanner("fp2Error");
  clearBanner("fp2Success");
  const code = getOtpValue("fp");
  if (code.length < 6) {
    showBanner("fp2Error", "Please enter all 6 digits.");
    return;
  }

  setLoading("fpVerifyBtn", "fpVerifyText", "fpVerifySpinner", true);

  try {
    const { ok, data } = await apiPost("/forgot-password/verify", {
      email: _fpEmail,
      code,
    });

    if (data.ok) {
      showBanner("fp2Success", data.message || "Code verified!", "success");
      setTimeout(() => fpGoStep(3), 900);
    } else {
      shakeOtp("fp");
      showBanner("fp2Error", data.error || "Incorrect code.");
      if (data.restart) {
        setTimeout(() => fpGoStep(1), 1500);
      }
      if (data.expired) {
        clearOtpInputs("fp");
        document.getElementById("fpResendBtn").disabled = false;
        document.getElementById("fpCountdown").style.display = "none";
      }
    }
  } catch (e) {
    showBanner("fp2Error", "Network error. Please try again.");
  } finally {
    setLoading("fpVerifyBtn", "fpVerifyText", "fpVerifySpinner", false);
  }
}

/** Step 3: set new password */
async function fpResetPassword() {
  clearBanner("fp3Error");
  clearBanner("fp3Success");
  const password = document.getElementById("fpNewPw")?.value || "";
  const confirm = document.getElementById("fpConfirmPw")?.value || "";

  if (!password || !confirm) {
    showBanner("fp3Error", "Please fill in both fields.");
    return;
  }
  if (password.length < 8) {
    showBanner("fp3Error", "Password must be at least 8 characters.");
    return;
  }
  if (password !== confirm) {
    showBanner("fp3Error", "Passwords do not match.");
    return;
  }

  setLoading("fpResetBtn", "fpResetText", "fpResetSpinner", true);

  try {
    const { ok, data } = await apiPost("/forgot-password/reset", {
      email: _fpEmail,
      password,
      confirm,
    });

    if (data.ok) {
      showBanner(
        "fp3Success",
        data.message || "✅ Password updated!",
        "success",
      );
      setTimeout(() => {
        window.location.href = data.redirect || "/login";
      }, 1800);
    } else {
      showBanner("fp3Error", data.error || "Could not reset password.");
      if (data.restart) {
        setTimeout(() => fpGoStep(1), 1500);
      }
    }
  } catch (e) {
    showBanner("fp3Error", "Network error. Please try again.");
  } finally {
    setLoading("fpResetBtn", "fpResetText", "fpResetSpinner", false);
  }
}

/** Resend forgot-password code */
async function fpResendCode() {
  clearBanner("fp2Error");
  clearBanner("fp2Success");
  clearOtpInputs("fp");

  try {
    const { ok, data } = await apiPost("/forgot-password/resend", {
      email: _fpEmail,
    });
    if (data.ok) {
      showBanner("fp2Success", data.message, "success");
      startCountdown("fpResendBtn", "fpCountdown", 30);
    } else {
      showBanner("fp2Error", data.error);
      if (data.cooldown)
        startCountdown("fpResendBtn", "fpCountdown", data.cooldown);
      if (data.restart) {
        fpGoStep(1);
        showBanner("fp1Error", data.error);
      }
    }
  } catch (e) {
    showBanner("fp2Error", "Network error. Please try again.");
  }
}

/* ================================================================
   FEATURE 3 — CHANGE PASSWORD (settings / edit_profile)
   ================================================================ */

async function changePassword() {
  clearBanner("cpError");
  clearBanner("cpSuccess");

  const current_password = document.getElementById("cpCurrent")?.value || "";
  const new_password = document.getElementById("cpNew")?.value || "";
  const confirm_password = document.getElementById("cpConfirm")?.value || "";

  if (!current_password || !new_password || !confirm_password) {
    showBanner("cpError", "Please fill in all password fields.");
    return;
  }
  if (new_password.length < 8) {
    showBanner("cpError", "New password must be at least 8 characters.");
    return;
  }
  if (new_password !== confirm_password) {
    showBanner("cpError", "New passwords do not match.");
    return;
  }

  setLoading("cpBtn", "cpBtnText", "cpBtnSpinner", true);

  try {
    const { ok, data } = await apiPost("/settings/change-password", {
      current_password,
      new_password,
      confirm_password,
    });

    if (data.ok) {
      showBanner(
        "cpSuccess",
        data.message || "✅ Password changed!",
        "success",
      );
      // Clear inputs
      ["cpCurrent", "cpNew", "cpConfirm"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      const pw = document.getElementById("pwStrength");
      if (pw) pw.style.display = "none";
    } else {
      showBanner("cpError", data.error || "Could not change password.");
    }
  } catch (e) {
    showBanner("cpError", "Network error. Please try again.");
  } finally {
    setLoading("cpBtn", "cpBtnText", "cpBtnSpinner", false);
  }
}
