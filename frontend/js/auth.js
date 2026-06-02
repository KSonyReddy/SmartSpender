const API_BASE_URL = 'https://smartspender-1-m3j5.onrender.com';
const FETCH_TIMEOUT_MS = 30000;

function redirectToLogin() {
  window.location.href = './login.html';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').replace(/^91(\d{10})$/, '$1').trim();
}

function spokenDigitsToNumber(text) {
  const tokens = String(text || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
  const map = {
    zero: '0', oh: '0', o: '0',
    one: '1', won: '1',
    two: '2', to: '2', too: '2',
    three: '3',
    four: '4', for: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8', ate: '8',
    nine: '9',
  };
  const converted = tokens.map((token) => map[token] || token).join('');
  const digits = converted.replace(/\D/g, '');
  return digits.slice(-10);
}

function isValidIdentifier(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (v.includes('@')) return isValidEmail(v.toLowerCase());
  return /^\d{10}$/.test(normalizePhone(v));
}

function isSpeechSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function getVoicePrompt(fieldKey, lang) {
  const prompts = {
    name: {
      'te-IN': 'mi peru chepandi',
      'hi-IN': 'kripya apna naam batayein',
      'ta-IN': 'ungal peyarai sollunga',
      'kn-IN': 'nimma hesarannu heli',
      'ur-IN': 'apna naam batayen',
      'en-IN': 'Please tell your full name',
    },
    phone: {
      'te-IN': 'mi phone number chepandi',
      'hi-IN': 'kripya apna phone number batayein',
      'ta-IN': 'ungal phone number sollunga',
      'kn-IN': 'nimma phone number heli',
      'ur-IN': 'apna phone number batayen',
      'en-IN': 'Please tell your phone number',
    },
    otp: {
      'te-IN': 'otp number chepandi',
      'hi-IN': 'kripya otp batayein',
      'ta-IN': 'otp sollunga',
      'kn-IN': 'otp heli',
      'ur-IN': 'otp batayen',
      'en-IN': 'Please tell your OTP',
    },
  };
  const bucket = prompts[fieldKey] || prompts.name;
  return bucket[lang] || bucket['en-IN'];
}

function speakPrompt(text, lang) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(String(text));
    utter.lang = lang || 'en-IN';
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch {}
}

function setupVoiceInputButton(button, input, options = {}) {
  if (!button || !input || !isSpeechSupported()) {
    if (button) button.style.display = 'none';
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    button.classList.add('listening');
    button.textContent = '🎙️...';
  };

  recognition.onend = () => {
    button.classList.remove('listening');
    button.textContent = '🎤';
  };

  recognition.onresult = (event) => {
    const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
    if (!transcript) return;
    const phoneDigits = spokenDigitsToNumber(transcript) || normalizePhone(transcript);
    if (input.type === 'tel' || /phone/i.test(input.id)) {
      input.value = /^\d{10}$/.test(phoneDigits) ? phoneDigits : transcript.replace(/\D/g, '').slice(0, 10);
      return;
    }
    input.value = transcript;
  };

  recognition.onerror = () => {};

  button.addEventListener('click', () => {
    try {
      const lang = typeof options.getLang === 'function' ? (options.getLang() || 'en-IN') : 'en-IN';
      recognition.lang = lang;
      if (options.promptKey) {
        speakPrompt(getVoicePrompt(options.promptKey, lang), lang);
      }
      recognition.start();
    } catch {}
  });
}

function saveSessionUser(user) {
  if (!user) return;
  const payload = {
    userId: user.id || user._id || '',
    userRole: user.role || '',
    userName: user.name || '',
  };
  sessionStorage.setItem('authUser', JSON.stringify(payload));
}

function redirectByRole(user) {
  if (!user) {
    redirectToLogin();
    return;
  }
  if (user.role === 'vendor') {
    window.location.href = './vendor-dashboard.html';
  } else {
    window.location.href = './ai-dashboard.html';
  }
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
      signal: controller.signal,
    });

    const json = await res.json().catch(() => ({}));

    if (res.status === 401) {
      // On auth routes (/auth/login, /auth/signup), 401 means wrong credentials
      // On all other routes, 401 means session expired
      const isAuthRoute = path.startsWith('/auth/login') || path.startsWith('/auth/signup') || path.startsWith('/auth/vendor');
      if (isAuthRoute) {
        throw new Error(json.message || 'Invalid email or password.');
      }
      throw new Error('Session expired. Please login again.');
    }

    if (!res.ok) {
      throw new Error(json.message || 'Request failed');
    }

    return json;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Network timeout after 30 seconds');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function setButtonLoading(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.classList.toggle('auth-btn-loading', loading);
}

function extractDevOtp(message) {
  const match = String(message || '').match(/\b(\d{6})\b/);
  return match ? match[1] : '';
}

function setupPasswordToggles() {
  document.querySelectorAll('[data-toggle-target], [data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.toggleTarget || btn.dataset.toggle;
      const input = document.getElementById(targetId);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  });

  // Legacy support for auth.html buttons without data-toggle-target
  document.querySelectorAll('.password-toggle, .toggle-pass').forEach((btn) => {
    if (btn.dataset.toggleTarget || btn.dataset.toggle) return;
    btn.addEventListener('click', () => {
      const input = btn.closest('.password-wrap, .input-wrapper, .password-wrapper')?.querySelector('input') || btn.parentElement?.querySelector('input');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  });
}

function initDualTabLoginPage() {
  const tabsRoot = document.getElementById('loginTabs');
  const userTab = document.getElementById('userTabPanel');
  const vendorTab = document.getElementById('vendorTabPanel');
  const tabButtons = document.querySelectorAll('.login-tab-btn');

  const userForm = document.getElementById('userLoginForm');
  const vendorForm = document.getElementById('vendorLoginForm');

  const userPhone = document.getElementById('userPhone');
  const userOtp = document.getElementById('userOtp');
  const userError = document.getElementById('userLoginError');
  const userBtn = document.getElementById('userLoginBtn');
  const sendUserOtpBtn = document.getElementById('sendUserOtpBtn');

  const vendorName = document.getElementById('vendorName');
  const vendorPhone = document.getElementById('vendorPhone');
  const vendorOtp = document.getElementById('vendorOtp');
  const vendorError = document.getElementById('vendorLoginError');
  const vendorBtn = document.getElementById('vendorLoginBtn');
  const sendVendorOtpBtn = document.getElementById('sendVendorOtpBtn');

  const userModeBtns = document.querySelectorAll('[data-user-mode="classic"]');
  const userClassicPanel = document.getElementById('userClassicPanel');
  const userIdentifier = document.getElementById('userIdentifier');
  const userPassword = document.getElementById('userPassword');

  const vendorModeBtns = document.querySelectorAll('[data-vendor-mode="classic"]');
  const vendorClassicPanel = document.getElementById('vendorClassicPanel');
  const vendorIdentifier = document.getElementById('vendorIdentifier');
  const vendorPassword = document.getElementById('vendorPassword');

  let userMode = 'classic';
  let vendorMode = 'classic';
  // Initialize tab state first
  switchTab('user');

  function switchTab(tab) {
    if (!tabsRoot) return; // guard against missing elements
    const isUser = tab === 'user';
    tabsRoot?.setAttribute('data-active', isUser ? 'user' : 'vendor');
    userTab?.classList.toggle('active', isUser);
    vendorTab?.classList.toggle('active', !isUser);
    tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
    userError.textContent = '';
    vendorError.textContent = '';
  }

  function switchUserMode(mode) {
    userMode = 'classic';
    userModeBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.userMode === userMode));
    userClassicPanel?.classList.toggle('active', userMode === 'classic');

    if (userIdentifier) userIdentifier.required = userMode === 'classic';
    if (userPassword) userPassword.required = userMode === 'classic';

    if (userBtn?.querySelector('.btn-text')) {
      userBtn.querySelector('.btn-text').textContent = 'Login with Email/Password';
    }
    userError.textContent = '';
  }

  function switchVendorMode(mode) {
    vendorMode = 'classic';
    vendorModeBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.vendorMode === vendorMode));
    vendorClassicPanel?.classList.toggle('active', vendorMode === 'classic');

    if (vendorIdentifier) vendorIdentifier.required = vendorMode === 'classic';
    if (vendorPassword) vendorPassword.required = vendorMode === 'classic';

    if (vendorBtn?.querySelector('.btn-text')) {
      vendorBtn.querySelector('.btn-text').textContent = 'Login with Email/Password';
    }
    vendorError.textContent = '';
  }

  switchUserMode('classic');
  switchVendorMode('classic');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  userModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchUserMode(btn.dataset.userMode));
  });

  vendorModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchVendorMode(btn.dataset.vendorMode));
  });

  async function submitUserLogin(e) {
    e.preventDefault();
    userError.textContent = '';

    if (userMode === 'classic') {
      const identifierRaw = String(userIdentifier?.value || '').trim();
      const identifier = identifierRaw.includes('@') ? identifierRaw.toLowerCase() : normalizePhone(identifierRaw);
      const password = String(userPassword?.value || '');

      if (!isValidIdentifier(identifier) || !password) {
        userError.textContent = 'Please enter valid email/phone and password.';
        return;
      }

      setButtonLoading(userBtn, true);
      try {
        const data = await apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier, password }),
        });

        const user = data.data?.user;
        if (!user || user.role !== 'user') {
          userError.textContent = 'This account is not a user account. Please use Vendor Login tab.';
          return;
        }

        saveSessionUser(user);
        window.location.href = './ai-dashboard.html';
      } catch (err) {
        userError.textContent = err.message || 'Login failed.';
      } finally {
        setButtonLoading(userBtn, false);
      }
      return;
    }
  }

  sendUserOtpBtn?.addEventListener('click', async () => {
    const phone = normalizePhone(userPhone?.value || '');
    if (!/^\d{10}$/.test(phone)) {
      userError.textContent = 'Please enter a valid 10-digit phone number first.';
      return;
    }

    setButtonLoading(sendUserOtpBtn, true);
    const otpTimeout = setTimeout(() => {
      setButtonLoading(sendUserOtpBtn, false);
      userError.textContent = 'OTP request timed out — server may be slow. Try again.';
    }, 8000);
    userError.textContent = '';
    try {
      const data = await apiFetch('/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      const maybeOtp = extractDevOtp(data.message || '');
      if (maybeOtp && userOtp) userOtp.value = maybeOtp;
      userError.textContent = data.message || 'OTP sent successfully.';
    } catch (err) {
      userError.textContent = err.message || 'Unable to send OTP.';
    } finally {
      clearTimeout(otpTimeout);
      setButtonLoading(sendUserOtpBtn, false);
    }
  });

  async function submitVendorLogin(e) {
    e.preventDefault();
    vendorError.textContent = '';

    if (vendorMode === 'classic') {
      const identifierRaw = String(vendorIdentifier?.value || '').trim();
      const identifier = identifierRaw.includes('@') ? identifierRaw.toLowerCase() : normalizePhone(identifierRaw);
      const password = String(vendorPassword?.value || '');

      if (!isValidIdentifier(identifier) || !password) {
        vendorError.textContent = 'Please enter valid email/phone and password.';
        return;
      }

      setButtonLoading(vendorBtn, true);
      try {
        const data = await apiFetch('/auth/vendor/login', {
          method: 'POST',
          body: JSON.stringify({ identifier, password }),
        });

        const user = data.data?.user;
        if (!user || user.role !== 'vendor') {
          vendorError.textContent = 'Vendor login is only for vendor accounts.';
          return;
        }

        saveSessionUser(user);
        window.location.href = './vendor-dashboard.html';
      } catch (err) {
        vendorError.textContent = err.message || 'Vendor login failed.';
      } finally {
        setButtonLoading(vendorBtn, false);
      }
      return;
    }
  }

  sendVendorOtpBtn?.addEventListener('click', async () => {
    const phone = normalizePhone(vendorPhone?.value || '');
    if (!/^\d{10}$/.test(phone)) {
      vendorError.textContent = 'Please enter a valid 10-digit phone number first.';
      return;
    }

    setButtonLoading(sendVendorOtpBtn, true);
    vendorError.textContent = '';
    try {
      const data = await apiFetch('/auth/vendor/request-otp', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      const maybeOtp = extractDevOtp(data.message || '');
      if (maybeOtp && vendorOtp) vendorOtp.value = maybeOtp;
      vendorError.textContent = data.message || 'OTP sent successfully.';
    } catch (err) {
      vendorError.textContent = err.message || 'Unable to send OTP.';
    } finally {
      setButtonLoading(sendVendorOtpBtn, false);
    }
  });

  userForm?.addEventListener('submit', submitUserLogin);
  vendorForm?.addEventListener('submit', submitVendorLogin);
}

function initLegacyAuthPage() {
  const signupForm = document.getElementById('signupForm');
  const loginForm = document.getElementById('loginForm');
  if (!signupForm || !loginForm) return;

  let currentRole = 'user';

  const roleButtons = document.querySelectorAll('[data-role]');
  roleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      roleButtons.forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      currentRole = btn.dataset.role || 'user';
    });
  });

  const formButtons = document.querySelectorAll('[data-form]');
  formButtons.forEach((btn) => {
    if (btn.dataset.role) return;
    btn.addEventListener('click', () => {
      const target = btn.dataset.form;
      signupForm.classList.toggle('active', target === 'signup');
      loginForm.classList.toggle('active', target === 'login');
      formButtons.forEach((x) => {
        if (!x.dataset.role) x.classList.toggle('active', x === btn);
      });
    });
  });

  async function submitSignup(e) {
    e.preventDefault();
    const messageEl = signupForm.querySelector('.form-message');
    const btn = signupForm.querySelector('.auth-button');

    const name = signupForm.querySelector('#signupName')?.value?.trim();
    const email = signupForm.querySelector('#signupEmail')?.value?.trim()?.toLowerCase();
    const password = signupForm.querySelector('#signupPassword')?.value;

    if (!name || !isValidEmail(email) || !password) {
      messageEl.style.display = 'block';
      messageEl.textContent = 'Please provide valid name, email, and password.';
      return;
    }

    setButtonLoading(btn, true);
    try {
      const data = await apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role: currentRole }),
      });
      saveSessionUser(data.data?.user);
      window.location.href = './login.html';
    } catch (err) {
      messageEl.style.display = 'block';
      messageEl.textContent = err.message;
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function submitLogin(e) {
    e.preventDefault();
    const messageEl = loginForm.querySelector('.form-message');
    const btn = loginForm.querySelector('.auth-button');

    const identifierRaw = loginForm.querySelector('#loginEmail')?.value?.trim();
    const identifier = String(identifierRaw || '').includes('@')
      ? String(identifierRaw || '').toLowerCase()
      : normalizePhone(identifierRaw);
    const password = loginForm.querySelector('#loginPassword')?.value;

    if (!isValidIdentifier(identifier) || !password) {
      messageEl.style.display = 'block';
      messageEl.textContent = 'Please provide valid email/phone and password.';
      return;
    }

    const endpoint = currentRole === 'vendor' ? '/auth/vendor/login' : '/auth/login';

    setButtonLoading(btn, true);
    try {
      const data = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      saveSessionUser(data.data?.user);
      redirectByRole(data.data?.user);
    } catch (err) {
      messageEl.style.display = 'block';
      messageEl.textContent = err.message;
    } finally {
      setButtonLoading(btn, false);
    }
  }

  signupForm.addEventListener('submit', submitSignup);
  loginForm.addEventListener('submit', submitLogin);
}

document.addEventListener('DOMContentLoaded', () => {
  setupPasswordToggles();

  if (document.getElementById('userLoginForm') && document.getElementById('vendorLoginForm')) {
    initDualTabLoginPage();
    return;
  }

  initLegacyAuthPage();
});
