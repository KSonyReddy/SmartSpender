const API_URL = 'https://smartspender-1-m3j5.onrender.com/api/auth/vendor/signup';
const OTP_URL = 'https://smartspender-1-m3j5.onrender.com/api/auth/vendor/request-otp';

const state = {
  currentStep: 1,
  totalSteps: 4,
};

const stepTitles = {
  1: 'Business Identity',
  2: 'Location & Service Area',
  3: 'Service Details',
  4: 'Account Setup',
};

const form = document.getElementById('vendorSignupForm');
const progressFill = document.getElementById('progressFill');
const stepLabel = document.getElementById('stepLabel');
const stepTitleText = document.getElementById('stepTitleText');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const submitBtn = document.getElementById('submitBtn');
const formErrorBanner = document.getElementById('formErrorBanner');

function showStep(step) {
  state.currentStep = step;

  document.querySelectorAll('.step-panel').forEach((panel) => {
    panel.classList.toggle('active', Number(panel.dataset.step) === step);
  });

  const pct = (step / state.totalSteps) * 100;
  progressFill.style.width = `${pct}%`;
  stepLabel.textContent = `Step ${step} of ${state.totalSteps}`;
  stepTitleText.textContent = stepTitles[step] || '';

  prevBtn.style.visibility = step === 1 ? 'hidden' : 'visible';
  nextBtn.style.display = step === state.totalSteps ? 'none' : 'inline-flex';
  submitBtn.style.display = step === state.totalSteps ? 'inline-flex' : 'none';
}

function setFieldError(fieldId, message) {
  const input = document.getElementById(fieldId);
  const err = document.getElementById(`${fieldId}Error`);
  if (input) input.classList.add('invalid');
  if (err) err.textContent = message || '';
}

function clearFieldError(fieldId) {
  const input = document.getElementById(fieldId);
  const err = document.getElementById(`${fieldId}Error`);
  if (input) input.classList.remove('invalid');
  if (err) err.textContent = '';
}

function clearStepErrors() {
  const active = document.querySelector(`.step-panel[data-step="${state.currentStep}"]`);
  if (!active) return;

  active.querySelectorAll('.form-input, .form-select, textarea').forEach((el) => {
    el.classList.remove('invalid');
  });
  active.querySelectorAll('.field-error').forEach((el) => {
    el.textContent = '';
  });
}

function validateIndianPhone(value) {
  return /^\d{10}$/.test(String(value || '').trim());
}

function validateStep1() {
  let ok = true;
  const businessName = document.getElementById('businessName').value.trim();
  const ownerName = document.getElementById('ownerName').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const whatsapp = document.getElementById('whatsappNumber').value.trim();
  const businessType = document.getElementById('businessType').value;

  if (!businessName) {
    setFieldError('businessName', 'Business Name is required');
    ok = false;
  }

  if (!ownerName) {
    setFieldError('ownerName', 'Owner Full Name is required');
    ok = false;
  }

  if (!validateIndianPhone(phone)) {
    setFieldError('phone', 'Phone number must be 10 digits');
    ok = false;
  }

  if (whatsapp && !validateIndianPhone(whatsapp)) {
    setFieldError('whatsappNumber', 'WhatsApp number must be 10 digits');
    ok = false;
  }

  if (!businessType) {
    setFieldError('businessType', 'Business Type is required');
    ok = false;
  }

  return ok;
}

function validateStep2() {
  let ok = true;
  const city = document.getElementById('city').value;
  const area = document.getElementById('area').value.trim();

  if (!city) {
    setFieldError('city', 'City is required');
    ok = false;
  }

  if (!area) {
    setFieldError('area', 'Area/Locality is required');
    ok = false;
  }

  return ok;
}

function validateStep3() {
  let ok = true;
  const minGuests = Number(document.getElementById('minGuests').value || 0);
  const maxGuests = Number(document.getElementById('maxGuests').value || 0);
  const workingHoursStart = document.getElementById('workingHoursStart').value;
  const workingHoursEnd = document.getElementById('workingHoursEnd').value;
  const description = document.getElementById('description').value || '';

  if (minGuests < 0) {
    setFieldError('minGuests', 'Minimum guests cannot be negative');
    ok = false;
  }

  if (maxGuests < minGuests) {
    setFieldError('maxGuests', 'Maximum guests must be greater than or equal to minimum guests');
    ok = false;
  }

  if (!workingHoursStart) {
    setFieldError('workingHoursStart', 'Start time is required');
    ok = false;
  }

  if (!workingHoursEnd) {
    setFieldError('workingHoursEnd', 'End time is required');
    ok = false;
  }

  if (workingHoursStart && workingHoursEnd && workingHoursStart >= workingHoursEnd) {
    setFieldError('workingHoursEnd', 'End time must be after start time');
    ok = false;
  }

  if (description.length > 500) {
    setFieldError('description', 'Description must be 500 characters or less');
    ok = false;
  }

  return ok;
}

function validateStep4() {
  let ok = true;
  const otpPhone = document.getElementById('otpPhone').value.trim();
  const otpCode = document.getElementById('otpCode').value.trim();
  const termsAccepted = document.getElementById('termsAccepted').checked;

  if (!validateIndianPhone(otpPhone)) {
    setFieldError('otpPhone', 'Enter valid 10-digit mobile number');
    ok = false;
  }

  if (!/^\d{6}$/.test(otpCode)) {
    setFieldError('otpCode', 'Enter 6-digit OTP');
    ok = false;
  }

  const termsError = document.getElementById('termsAcceptedError');
  if (!termsAccepted) {
    termsError.textContent = 'You must accept Terms & Conditions';
    ok = false;
  } else {
    termsError.textContent = '';
  }

  return ok;
}

function validateCurrentStep() {
  clearStepErrors();
  if (state.currentStep === 1) return validateStep1();
  if (state.currentStep === 2) return validateStep2();
  if (state.currentStep === 3) return validateStep3();
  if (state.currentStep === 4) return validateStep4();
  return true;
}

function collectCheckboxValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
}

function getRadioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function buildPayload() {
  return {
    businessName: document.getElementById('businessName').value.trim(),
    ownerName: document.getElementById('ownerName').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    whatsappNumber: document.getElementById('whatsappNumber').value.trim(),
    gstNumber: document.getElementById('gstNumber').value.trim(),
    businessType: document.getElementById('businessType').value,
    city: document.getElementById('city').value,
    area: document.getElementById('area').value.trim(),
    fullAddress: document.getElementById('fullAddress').value.trim(),
    citiesCovered: collectCheckboxValues('citiesCovered'),
    supportedEventTypes: collectCheckboxValues('supportedEventTypes'),
    minGuests: Number(document.getElementById('minGuests').value || 0),
    maxGuests: Number(document.getElementById('maxGuests').value || 0),
    basePrice: Number(document.getElementById('basePrice').value || 0),
    pricingUnit: document.getElementById('pricingUnit').value,
    servesVeg: document.getElementById('servesVeg').checked,
    servesNonVeg: document.getElementById('servesNonVeg').checked,
    religionServed: getRadioValue('religionServed') || 'All',
    amenities: collectCheckboxValues('amenities'),
    workingDays: collectCheckboxValues('workingDays'),
    workingHoursStart: document.getElementById('workingHoursStart').value,
    workingHoursEnd: document.getElementById('workingHoursEnd').value,
    advanceBookingDays: Number(document.getElementById('advanceBookingDays').value || 7),
    description: document.getElementById('description').value.trim(),
    otpPhone: document.getElementById('otpPhone').value.trim(),
    otpCode: document.getElementById('otpCode').value.trim(),
  };
}

function showBannerError(message) {
  formErrorBanner.style.display = 'block';
  formErrorBanner.textContent = message;
}

function clearBannerError() {
  formErrorBanner.style.display = 'none';
  formErrorBanner.textContent = '';
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').replace(/^91(\d{10})$/, '$1').trim();
}

prevBtn.addEventListener('click', () => {
  clearBannerError();
  if (state.currentStep > 1) showStep(state.currentStep - 1);
});

nextBtn.addEventListener('click', () => {
  clearBannerError();
  if (!validateCurrentStep()) return;
  if (state.currentStep < state.totalSteps) showStep(state.currentStep + 1);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBannerError();

  if (!validateCurrentStep()) return;

  const payload = buildPayload();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Registration failed');
    }

    window.location.href = '/pages/vendor-dashboard.html';
  } catch (err) {
    showBannerError(err.message || 'Unable to submit registration. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Registration';
  }
});

document.getElementById('sameAsPhone').addEventListener('change', (e) => {
  const phone = document.getElementById('phone').value.trim();
  const whatsapp = document.getElementById('whatsappNumber');
  if (e.target.checked) {
    whatsapp.value = phone;
  }
});

document.getElementById('phone').addEventListener('input', () => {
  const same = document.getElementById('sameAsPhone').checked;
  if (same) {
    document.getElementById('whatsappNumber').value = document.getElementById('phone').value.trim();
  }
  const otpPhone = document.getElementById('otpPhone');
  if (otpPhone && !otpPhone.value.trim()) {
    otpPhone.value = document.getElementById('phone').value.trim();
  }
});

document.getElementById('sendOtpBtn').addEventListener('click', async () => {
  clearFieldError('otpPhone');
  clearFieldError('otpCode');

  const phoneRaw = document.getElementById('otpPhone').value.trim() || document.getElementById('phone').value.trim();
  const phone = normalizePhone(phoneRaw);
  if (!/^\d{10}$/.test(phone)) {
    setFieldError('otpPhone', 'Enter valid 10-digit mobile number');
    return;
  }

  const btn = document.getElementById('sendOtpBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const res = await fetch(OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to send OTP');

    showBannerError(data.message || 'OTP sent successfully');
    formErrorBanner.style.background = '#ecfdf5';
    formErrorBanner.style.borderColor = '#bbf7d0';
    formErrorBanner.style.color = '#166534';
  } catch (err) {
    showBannerError(err.message || 'Failed to send OTP');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send OTP';
  }
});

[
  'businessName',
  'ownerName',
  'phone',
  'whatsappNumber',
  'businessType',
  'city',
  'area',
  'minGuests',
  'maxGuests',
  'workingHoursStart',
  'workingHoursEnd',
  'description',
  'otpPhone',
  'otpCode',
].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => clearFieldError(id));
  el.addEventListener('change', () => clearFieldError(id));
});

document.getElementById('termsAccepted').addEventListener('change', () => {
  document.getElementById('termsAcceptedError').textContent = '';
});

showStep(1);
