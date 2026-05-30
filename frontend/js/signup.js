// Clean, self-contained signup script

const API_BASE = 'http://localhost:5002/api';
let signupInFlight = false;

async function loadVendorOptions() {
  const select = document.getElementById('vendorDatasetId');
  if (!select) return;

  select.innerHTML = '<option value="">Loading categories...</option>';
  try {
    const res = await fetch(`${API_BASE}/vendor/vendors`);
    const json = await res.json();
    const vendors = json.data?.vendors || [];

    const categorySet = new Set();
    vendors.forEach((v) => {
      const category = String(v.category || '').trim();
      if (category) categorySet.add(category);
    });

    const categories = Array.from(categorySet).sort((a, b) => a.localeCompare(b));

    select.innerHTML = '<option value="">Select category...</option>' +
      categories
        .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
        .join('');
  } catch (e) {
    select.innerHTML = '<option value="">Failed to load categories</option>';
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function calculatePasswordStrength(password) {
  let strength = 0;
  if (password.length >= 6) strength++;
  if (password.length >= 8) strength++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
  if (/\d/.test(password)) strength++;
  return strength;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function showFieldError(elementId, message) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = message;
  element.style.display = 'block';
}

function clearErrors() {
  document.querySelectorAll('.error-text').forEach((el) => {
    el.textContent = '';
    el.style.display = 'none';
  });
}

function clearAlerts() {
  const errorAlert = document.getElementById('errorAlert');
  const successAlert = document.getElementById('successAlert');
  if (errorAlert) errorAlert.style.display = 'none';
  if (successAlert) successAlert.style.display = 'none';
}

function showError(message) {
  const alert = document.getElementById('errorAlert');
  if (!alert) return;
  alert.textContent = message || 'Something went wrong';
  alert.style.display = 'block';
}

function showSuccess(message) {
  const alert = document.getElementById('successAlert');
  if (!alert) return;
  alert.textContent = message || 'Success';
  alert.style.display = 'block';
}

function showLoading(show) {
  const btn = document.getElementById('submitBtn');
  if (!btn) return;
  btn.disabled = !!show;
  const textEl = btn.querySelector('.btn-text');
  const loaderEl = btn.querySelector('.btn-loader');
  if (textEl) textEl.textContent = show ? 'Please wait...' : 'Create Account';
  if (loaderEl) loaderEl.style.display = show ? 'inline-block' : 'none';
}

function saveSessionUser(user) {
  if (!user) return;
  sessionStorage.setItem('authUser', JSON.stringify({
    userId: user.id || user._id || '',
    userRole: user.role || '',
    userName: user.name || '',
  }));
}

function redirectByRole(user) {
  if (!user) {
    window.location.href = './login.html';
    return;
  }

  window.location.href = user.role === 'vendor' ? './vendor-dashboard.html' : './ai-dashboard.html';
}

function validateSignupForm(data) {
  clearErrors();
  let isValid = true;

  if (!data.name || data.name.trim().length < 2) {
    showFieldError('nameError', 'Full name is required (min 2 chars)');
    isValid = false;
  }
  if (!data.email || !isValidEmail(data.email)) {
    showFieldError('emailError', 'A valid email is required');
    isValid = false;
  }
  if (!data.password || data.password.length < 6) {
    showFieldError('passwordError', 'Password must be at least 6 characters');
    isValid = false;
  }
  if (!data.terms) {
    showFieldError('termsError', 'You must agree to the terms');
    isValid = false;
  }

  return isValid;
}

async function handleSignup(ev) {
  ev.preventDefault();
  if (signupInFlight) return;
  clearAlerts();

  const formData = {
    name: document.getElementById('name')?.value.trim() || '',
    email: document.getElementById('email')?.value.trim().toLowerCase() || '',
    password: document.getElementById('password')?.value || '',
    role: 'user',
    terms: document.getElementById('terms')?.checked || false,
  };

  if (!validateSignupForm(formData)) return;

  signupInFlight = true;
  showLoading(true);
  let timedOut = false;
  let timeoutId = null;

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);

    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal,
      body: JSON.stringify({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: formData.role,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Signup failed (${res.status})`);
    }

    const data = await res.json().catch(() => ({}));
    showSuccess('✅ Account created successfully! Redirecting...');
    saveSessionUser(data.data?.user || {});
    setTimeout(() => redirectByRole(data.data?.user), 900);
  } catch (error) {
    const msg = error?.name === 'AbortError'
      ? (timedOut ? 'Request timeout - server may be slow' : 'Signup request was interrupted')
      : (error.message || 'Failed to create account.');
    console.error('Signup error:', error);
    showError(msg);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    signupInFlight = false;
    showLoading(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const passwordField = document.getElementById('password');
  const passwordToggle = document.querySelector('.password-toggle');

  if (passwordField) {
    passwordField.addEventListener('input', function() {
      const strength = calculatePasswordStrength(this.value);
      const bar = document.getElementById('strengthBar');
      const text = document.getElementById('strengthText');

      if (bar) bar.style.width = (strength * 25) + '%';

      if (text) {
        if (strength === 0) {
          if (bar) bar.style.background = '#d1d5db';
          text.textContent = 'Password strength';
        } else if (strength === 1) {
          if (bar) bar.style.background = '#ef4444';
          text.textContent = 'Weak';
        } else if (strength === 2) {
          if (bar) bar.style.background = '#f59e0b';
          text.textContent = 'Fair';
        } else if (strength === 3) {
          if (bar) bar.style.background = '#3b82f6';
          text.textContent = 'Good';
        } else {
          if (bar) bar.style.background = '#10b981';
          text.textContent = 'Strong';
        }
      }
    });
  }

  if (passwordToggle && passwordField) {
    passwordToggle.addEventListener('click', () => {
      const isPassword = passwordField.type === 'password';
      passwordField.type = isPassword ? 'text' : 'password';
      passwordToggle.textContent = isPassword ? '🙈' : '👁️';
    });
  }

  document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
  // Optionally load vendor options if the select exists
  loadVendorOptions().catch(() => {});
});