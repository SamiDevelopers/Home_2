// ============================================================
// نظام إعداد خدام — Khodam Management System
// Firebase Edition — Modular SDK v10
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  getIdTokenResult
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, collection, query, where,
  addDoc, updateDoc, serverTimestamp, runTransaction, limit, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

// ============================================================
// 1. Firebase Initialization
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyA5U9ro7Ux_jL2GOhTUJFnmUVlPg_HgQbU",
  authDomain: "khodam-2027.firebaseapp.com",
  projectId: "khodam-2027",
  storageBucket: "khodam-2027.firebasestorage.app",
  messagingSenderId: "55315918584",
  appId: "1:55315918584:web:21dcee174e840ee7f7550d",
  measurementId: "G-VS9VKWQXZ9"
};

const app = initializeApp(firebaseConfig);
getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// ============================================================
// 2. Session State
// ============================================================
let currentUser = null;
let currentRole = null;
let pendingImportRows = [];

const ROLE_LABELS = {
  admin: 'مسؤول النظام',
  priest: 'الكاهن المسؤول',
  servant: 'خادم',
  student: 'دارس',
  control: 'مسؤول الكنترول'
};
const STUDENT_STATUS_LABELS = {
  new: 'مستجد', active: 'مقيد', continuing: 'مستمر',
  deferred: 'مؤجل', interrupted: 'منقطع', auditor: 'مستمع',
  returned: 'عائد للدراسة', suspended: 'موقوف', withdrawn: 'منسحب',
  graduated: 'متخرج'
};

const APP_STATUS_AR = {
  new: 'جديد',
  under_review: 'قيد المراجعة',
  interview_scheduled: 'موعد مقابلة',
  interviewed: 'تمت المقابلة',
  awaiting_priest: 'بانتظار قرار الكاهن',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  deferred: 'مؤجل',
  needs_completion: 'يحتاج استكمال',
  closed: 'مغلق'
};

const NOTEBOOK_STATUS_AR = {
  pending: 'بانتظار المراجعة',
  reviewed: 'تمت المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض'
};

// ============================================================
// 3. DOM References
// ============================================================
const $ = (id) => document.getElementById(id);
const loginScreen = $('login-screen');
const appScreen = $('app-screen');
const pageContainer = $('page-container');
const toastContainer = $('toast-container');
const modalOverlay = $('modal-overlay');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ============================================================
// 4. Utility — Toast & Modal
// ============================================================
function showToast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

let modalResolve = null;
function showConfirm(title, message) {
  return new Promise((resolve) => {
    $('modal-title').textContent = title;
    $('modal-message').textContent = message;
    $('modal-reason').value = '';
    modalOverlay.classList.remove('hidden');
    modalResolve = resolve;
  });
}

$('modal-cancel').onclick = () => {
  modalOverlay.classList.add('hidden');
  if (modalResolve) modalResolve(null);
};
$('modal-confirm').onclick = () => {
  const reason = $('modal-reason').value.trim();
  modalOverlay.classList.add('hidden');
  if (modalResolve) modalResolve(reason || '__no_reason__');
};

// ============================================================
// 5. Utility — Code Generators
// ============================================================
async function generateUniqueCode(collectionName, field) {
  const year = new Date().getFullYear();
  const prefix = collectionName === 'studentApplications' ? 'APP' : 'STD';
  for (let i = 0; i < 8; i++) {
    const candidate = `${prefix}-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
    const q = query(collection(db, collectionName), where(field, '==', candidate), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return candidate;
  }
  throw new Error('تعذر توليد كود فريد، حاول مرة أخرى');
}

// ============================================================
// 6. Authentication
// ============================================================
async function login() {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const errEl = $('login-error');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'أدخل البريد وكلمة المرور'; return; }
  $('login-btn').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const authErrors = {
      'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      'auth/user-not-found': 'لا يوجد حساب بهذا البريد الإلكتروني.',
      'auth/wrong-password': 'كلمة المرور غير صحيحة.',
      'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة.',
      'auth/user-disabled': 'تم تعطيل هذا الحساب.',
      'auth/too-many-requests': 'محاولات تسجيل دخول كثيرة. حاول لاحقًا.',
      'auth/network-request-failed': 'تعذر الاتصال بـ Firebase. تحقق من الشبكة أو مانع الإعلانات.'
    };
    errEl.textContent = authErrors[e.code] || ('تعذر تسجيل الدخول: ' + (e.message || e.code));
  } finally {
    $('login-btn').disabled = false;
  }
}
$('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  login();
});

$('logout-btn').onclick = () => signOut(auth);

// ============================================================
// 7. Auth State & Custom Claims
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    try {
      const tokenResult = await getIdTokenResult(user, true);
      currentRole = tokenResult.claims.role || null;
    } catch (e) {
      currentRole = null;
    }
    if (!currentRole) {
      await signOut(auth);
      $('login-error').textContent = 'تم تسجيل دخول الحساب، لكن لم يتم تعيين دور له في Firebase. راجع مسؤول النظام.';
      return;
    }
    loginScreen.classList.remove('active');
    appScreen.classList.add('active');
    $('user-role-badge').textContent = ROLE_LABELS[currentRole] || 'بدون صلاحية';
    applyRoleVisibility();
    navigateTo('dashboard');
  } else {
    currentUser = null;
    currentRole = null;
    appScreen.classList.remove('active');
    loginScreen.classList.add('active');
    pageContainer.innerHTML = '';
  }
});

function applyRoleVisibility() {
  const adminOnly = ['users', 'audit', 'settings', 'archive', 'import'];
  adminOnly.forEach(page => {
    const link = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (link) {
      link.style.display = (currentRole === 'admin' || currentRole === 'priest') ? '' : 'none';
    }
  });
  const portalLink = document.querySelector('.nav-link[data-page="studentPortal"]');
  if (portalLink) portalLink.style.display = currentRole === 'student' ? '' : 'none';
}

// ============================================================
// 8. Router & Navigation
// ============================================================
const navLinks = document.querySelectorAll('.nav-link');

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(link.dataset.page);
  });
});

function navigateTo(pageId) {
  navLinks.forEach(l => l.classList.remove('active'));
  const active = document.querySelector(`.nav-link[data-page="${pageId}"]`);
  if (active) active.classList.add('active');
  $('sidebar').classList.remove('open');
  const renderer = pages[pageId];
  if (renderer) renderer();
  refreshIcons();
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { width: 18, height: 18, 'stroke-width': 2 } });
}

const pages = {};

// ============================================================
// 9. Sidebar Toggle
// ============================================================
$('sidebar-toggle').onclick = () => {
  $('sidebar').classList.toggle('open');
};

// ============================================================
// 10. Dashboard
// ============================================================
pages.dashboard = async () => {
  pageContainer.innerHTML = '<h2>لوحة التحكم</h2><p>جاري التحميل...</p>';
  try {
    const [studentsSnap, batchesSnap, appsSnap] = await Promise.all([
      getDocs(collection(db, 'students')),
      getDocs(collection(db, 'batches')),
      getDocs(collection(db, 'studentApplications'))
    ]);
    const pendingApps = appsSnap.docs.filter(d => ['new', 'under_review', 'interview_scheduled'].includes(d.data().status)).length;
    pageContainer.innerHTML = `
      <h2>لوحة التحكم</h2>
      <p style="color:var(--gray-mid);margin-bottom:1.5rem;">مرحبًا، ${ROLE_LABELS[currentRole] || 'مستخدم'}</p>
      <div class="stats-grid">
        <div class="stat-card"><h4>إجمالي الدارسين</h4><div class="stat-value">${studentsSnap.size}</div></div>
        <div class="stat-card"><h4>عدد الدفعات</h4><div class="stat-value">${batchesSnap.size}</div></div>
        <div class="stat-card"><h4>طلبات قيد المعالجة</h4><div class="stat-value">${pendingApps}</div></div>
        <div class="stat-card"><h4>إجمالي الطلبات</h4><div class="stat-value">${appsSnap.size}</div></div>
      </div>
    `;
  } catch (e) {
    pageContainer.innerHTML = `<p class="error-text">تعذر تحميل البيانات: ${escapeHtml(e.message)}</p>`;
  }
};

// ============================================================
// 11. Admissions Management
// ============================================================
pages.admissions = async () => {
  pageContainer.innerHTML = `
    <h2>إدارة القبول</h2>
    <div class="form-grid" id="adm-form">
      <label>الاسم الرباعي<input id="adm-name" required></label>
      <label>الهاتف<input id="adm-phone" required></label>
      <label>البريد الإلكتروني<input id="adm-email" type="email"></label>
      <label>تاريخ الميلاد<input id="adm-birth" type="date"></label>
      <label>النوع<select id="adm-gender"><option value="male">ذكر</option><option value="female">أنثى</option></select></label>
      <label>الرقم القومي<input id="adm-national-id" maxlength="14"></label>
      <label>الكنيسة<input id="adm-church"></label>
      <label>الإيبارشية<input id="adm-diocese"></label>
      <label>المؤهل الدراسي<input id="adm-qual"></label>
      <label>المهنة أو مجال العمل<input id="adm-job"></label>
      <label>اسم الأب الروحي<select id="adm-confessor"><option value="">غير محدد</option></select></label>
      <label>العنوان<textarea id="adm-address" rows="3"></textarea></label>
      <label>رقم ولي الأمر أو الطوارئ<input id="adm-emergency-phone"></label>
      <label>ملاحظات القبول<textarea id="adm-notes" rows="3"></textarea></label>
    </div>
    <button class="btn-primary" id="adm-submit">تقديم الطلب</button>
    <p id="adm-msg"></p>
    <h3 style="margin:1.5rem 0 0.8rem;">الطلبات المسجلة</h3>
    <div id="adm-list"><p class="empty-state">جاري التحميل...</p></div>
  `;

  $('adm-submit').onclick = async () => {
    const msg = $('adm-msg');
    msg.textContent = '';
    msg.className = '';
    try {
      const phone = $('adm-phone').value.trim();
      const dupQ = query(collection(db, 'studentApplications'), where('phone', '==', phone), limit(1));
      const dup = await getDocs(dupQ);
      if (!dup.empty) throw new Error('يوجد طلب سابق بنفس رقم الهاتف');

      const code = await generateUniqueCode('studentApplications', 'applicationCode');
      const tracking = 'TRK-' + Math.random().toString(36).slice(2, 10).toUpperCase();
      const ref = await addDoc(collection(db, 'studentApplications'), {
        applicationCode: code,
        trackingCode: tracking,
        name: $('adm-name').value.trim(),
        phone,
        email: $('adm-email').value.trim() || null,
        birthDate: $('adm-birth').value || null,
        gender: $('adm-gender').value,
        nationalId: $('adm-national-id').value.trim() || null,
        church: $('adm-church').value.trim() || null,
        diocese: $('adm-diocese').value.trim() || null,
        qualification: $('adm-qual').value.trim() || null,
        job: $('adm-job').value.trim() || null,
        confessor: $('adm-confessor').value || null,
        address: $('adm-address').value.trim() || null,
        emergencyPhone: $('adm-emergency-phone').value.trim() || null,
        notes: $('adm-notes').value.trim() || null,
        status: 'new',
        studentId: null,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        history: [{ status: 'new', at: new Date().toISOString(), by: currentUser.uid }]
      });
      msg.className = 'success-text';
      msg.textContent = `تم التقديم بنجاح. كود الطلب: ${code} — كود المتابعة: ${tracking}`;
      loadAdmissionsList();
    } catch (e) {
      msg.className = 'error-text';
      msg.textContent = e.message;
    }
  };
  loadAdmissionsList();
};

async function loadAdmissionsList() {
  const box = $('adm-list');
  if (!box) return;
  try {
    const snap = await getDocs(collection(db, 'studentApplications'));
    if (snap.empty) { box.innerHTML = '<p class="empty-state">لا توجد طلبات بعد.</p>'; return; }
    const nextMap = {
      new: 'under_review',
      under_review: 'interview_scheduled',
      interview_scheduled: 'interviewed',
      interviewed: 'awaiting_priest',
      awaiting_priest: 'accepted',
      needs_completion: 'under_review'
    };
    let rows = '';
    snap.forEach(d => {
      const a = d.data();
      const next = nextMap[a.status];
      const nextLabel = next ? APP_STATUS_AR[next] : '—';
      rows += `<tr>
        <td>${escapeHtml(a.applicationCode || d.id)}</td>
        <td>${escapeHtml(a.name || '—')}</td>
        <td>${escapeHtml(a.phone || '—')}</td>
        <td><span class="badge badge-${escapeHtml(a.status)}">${escapeHtml(APP_STATUS_AR[a.status] || a.status)}</span></td>
        <td>${next ? `<button class="btn-secondary btn-sm" data-id="${d.id}" data-next="${next}">→ ${nextLabel}</button>` : '—'}</td>
      </tr>`;
    });
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>كود الطلب</th><th>الاسم</th><th>الهاتف</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;

    box.querySelectorAll('button[data-id]').forEach(btn => {
      btn.onclick = async () => {
        const appId = btn.dataset.id;
        const next = btn.dataset.next;
        try {
          if (next === 'accepted') {
            const reason = await showConfirm('قبول نهائي', 'سيتم إنشاء ملف دارس دائم. هل أنت متأكد؟');
            if (!reason) return;
            await httpsCallable(functions, 'finalizeAcceptance')({ appId, reason });
            showToast('تم القبول وإنشاء ملف الدارس', 'success');
          } else {
            await httpsCallable(functions, 'transitionApplication')({ appId, nextStatus: next, reason: '' });
            showToast(`تم التحديث إلى: ${APP_STATUS_AR[next]}`, 'success');
          }
          loadAdmissionsList();
        } catch (e) {
          showToast(e.message || 'فشلت العملية', 'error');
        }
      };
    });
  } catch (e) {
    box.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// 12. Students List
// ============================================================
pages.students = async () => {
  pageContainer.innerHTML = '<h2>الدارسين</h2><p class="empty-state">جاري التحميل...</p>';
  try {
    const snap = await getDocs(collection(db, 'students'));
    if (snap.empty) {
      pageContainer.innerHTML = '<h2>الدارسين</h2><p class="empty-state">لا يوجد دارسون مسجلون بعد. ابدأ من وحدة القبول.</p>';
      return;
    }
    let rows = '';
    snap.forEach(d => {
      const s = d.data();
      rows += `<tr>
        <td>${escapeHtml(s.code || d.id)}</td>
        <td>${escapeHtml(s.name || '—')}</td>
        <td>${escapeHtml(s.phone || '—')}</td>
        <td>${escapeHtml(s.church || '—')}</td>
        <td><select class="student-status-select" data-id="${d.id}">
          ${['new','active','continuing','deferred','interrupted','auditor','returned','suspended','withdrawn','graduated'].map(status =>
            `<option value="${status}" ${s.status === status ? 'selected' : ''}>${escapeHtml(ROLE_LABELS[status] || STUDENT_STATUS_LABELS[status] || status)}</option>`
          ).join('')}
        </select></td>
      </tr>`;
    });
    pageContainer.innerHTML = `
      <h2>الدارسين (${snap.size})</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>الكود</th><th>الاسم</th><th>الهاتف</th><th>الكنيسة</th><th>الحالة</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    `;
  } catch (e) {
    pageContainer.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
};

// ============================================================
// 13. Batches List
// ============================================================
pages.batches = async () => {
  pageContainer.innerHTML = `
    <div class="flex-between"><h2>الدفعات</h2><button class="btn-primary" id="batch-toggle">إضافة دفعة</button></div>
    <div class="card hidden" id="batch-form-card">
      <div class="form-grid">
        <label>كود الدفعة<input id="batch-code" required></label>
        <label>اسم الدفعة<input id="batch-name" required></label>
        <label>السنة الدراسية<input id="batch-year" placeholder="2026/2027"></label>
        <label>الترم<select id="batch-term"><option>الترم الأول</option><option>الترم الثاني</option></select></label>
        <label>الكتاب<select id="batch-book"><option>الكتاب الأول</option><option>الكتاب الثاني</option><option>الكتاب الثالث</option><option>الكتاب الرابع</option></select></label>
        <label>تاريخ البداية<input id="batch-start" type="date"></label>
        <label>تاريخ النهاية<input id="batch-end" type="date"></label>
        <label>الحالة<select id="batch-status"><option value="planned">مخططة</option><option value="active">نشطة</option><option value="closed">مغلقة</option></select></label>
      </div>
      <button class="btn-primary" id="batch-save">حفظ الدفعة</button><p id="batch-msg"></p>
    </div>
    <div id="batch-list"><p class="empty-state">جاري التحميل...</p></div>
  `;
  $('batch-toggle').onclick = () => $('batch-form-card').classList.toggle('hidden');
  $('batch-save').onclick = async () => {
    const payload = {
      code: $('batch-code').value.trim(), name: $('batch-name').value.trim(),
      academicYear: $('batch-year').value.trim(), term: $('batch-term').value,
      book: $('batch-book').value, startDate: $('batch-start').value,
      endDate: $('batch-end').value, status: $('batch-status').value,
      createdAt: serverTimestamp(), createdBy: currentUser.uid, studentCount: 0
    };
    if (!payload.code || !payload.name) {
      $('batch-msg').textContent = 'الكود والاسم مطلوبان';
      $('batch-msg').className = 'error-text';
      return;
    }
    try {
      await addDoc(collection(db, 'batches'), payload);
      $('batch-msg').textContent = 'تم حفظ الدفعة بنجاح';
      $('batch-msg').className = 'success-text';
      $('batch-form-card').classList.add('hidden');
      loadBatches();
    } catch (e) {
      $('batch-msg').textContent = e.message;
      $('batch-msg').className = 'error-text';
    }
  };
  loadBatches();
};

async function loadBatches() {
  const box = $('batch-list');
  try {
    const snap = await getDocs(collection(db, 'batches'));
    if (snap.empty) {
      box.innerHTML = '<p class="empty-state">لا توجد دفعات بعد.</p>';
      return;
    }
    let rows = '';
    snap.forEach(d => {
      const b = d.data();
      rows += `<tr>
        <td>${escapeHtml(b.code || d.id)}</td>
        <td>${escapeHtml(b.name || '—')}</td>
        <td>${escapeHtml(b.book || '—')}</td>
        <td>${escapeHtml(b.term || '—')}</td>
        <td>${escapeHtml(b.status || '—')}</td>
      </tr>`;
    });
    box.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>الكود</th><th>الاسم</th><th>الكتاب</th><th>الترم</th><th>الحالة</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    `;
  } catch (e) {
    box.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// 14. Schedule and Lectures
// ============================================================
pages.schedule = async () => {
  pageContainer.innerHTML = `
    <h2>الجدول والمحاضرات</h2>
    <div class="card">
      <div class="form-grid">
        <label>الدفعة<select id="schedule-batch"><option value="">اختر الدفعة</option></select></label>
        <label>التاريخ<input id="schedule-date" type="date"></label>
        <label>المحاضرة الأولى<input id="schedule-first" type="time"></label>
        <label>المحاضرة الثانية<input id="schedule-second" type="time"></label>
        <label>المادة / الموضوع<input id="schedule-title"></label>
        <label>نوع المحاضرة<select id="schedule-type"><option value="regular">محاضرة أسبوعية</option><option value="extra">محاضرة استثنائية</option><option value="replacement">تعويض</option></select></label>
        <label>ملاحظة التعديل<input id="schedule-note" placeholder="مثال: تأجيل بسبب مناسبة الكنيسة"></label>
      </div>
      <button class="btn-primary" id="schedule-save">حفظ المحاضرة</button>
      <p id="schedule-msg"></p>
    </div>
    <div id="schedule-list"><p class="empty-state">اختر دفعة لعرض الجدول.</p></div>
  `;
  const batchSelect = $('schedule-batch');
  const batchSnap = await getDocs(collection(db, 'batches'));
  batchSnap.forEach(d => {
    const option = document.createElement('option');
    option.value = d.id;
    option.textContent = d.data().name || d.data().code || d.id;
    batchSelect.appendChild(option);
  });
  $('schedule-save').onclick = saveLecture;
  batchSelect.onchange = () => loadSchedule(batchSelect.value);
  if (batchSelect.options.length > 1) {
    batchSelect.selectedIndex = 1;
    loadSchedule(batchSelect.value);
  }
};

async function saveLecture() {
  const batchId = $('schedule-batch').value;
  const date = $('schedule-date').value;
  const firstTime = $('schedule-first').value;
  const title = $('schedule-title').value.trim();
  if (!batchId || !date || !firstTime || !title) {
    $('schedule-msg').textContent = 'الدفعة والتاريخ ووقت المحاضرة والموضوع مطلوبة';
    $('schedule-msg').className = 'error-text';
    return;
  }
  try {
    await addDoc(collection(db, 'lectures'), {
      batchId, date, firstTime, secondTime: $('schedule-second').value,
      title, type: $('schedule-type').value, note: $('schedule-note').value.trim(),
      status: 'scheduled', createdAt: serverTimestamp(), createdBy: currentUser.uid
    });
    await addDoc(collection(db, 'lectureChanges'), {
      batchId, date, action: 'create', title,
      reason: $('schedule-note').value.trim(), userId: currentUser.uid,
      createdAt: serverTimestamp()
    });
    $('schedule-msg').textContent = 'تم حفظ المحاضرة وتسجيل التعديل';
    $('schedule-msg').className = 'success-text';
    loadSchedule(batchId);
  } catch (e) {
    $('schedule-msg').textContent = e.message;
    $('schedule-msg').className = 'error-text';
  }
}

async function loadSchedule(batchId) {
  const box = $('schedule-list');
  if (!box) return;
  box.innerHTML = '<p class="empty-state">جاري تحميل الجدول...</p>';
  if (!batchId) return;
  try {
    const snap = await getDocs(query(collection(db, 'lectures'), where('batchId', '==', batchId)));
    if (snap.empty) { box.innerHTML = '<p class="empty-state">لا توجد محاضرات مجدولة لهذه الدفعة.</p>'; return; }
    const rows = snap.docs.sort((a,b) => String(a.data().date).localeCompare(String(b.data().date))).map(d => {
      const x = d.data();
      const typeLabel = { regular: 'أسبوعية', extra: 'استثنائية', replacement: 'تعويض' }[x.type] || x.type;
      return `<tr><td>${escapeHtml(x.date)}</td><td>${escapeHtml(x.firstTime || '—')}</td><td>${escapeHtml(x.secondTime || '—')}</td><td>${escapeHtml(x.title || '—')}</td><td><span class="badge badge-info">${escapeHtml(typeLabel)}</span></td><td><button class="btn-secondary btn-sm lecture-cancel" data-id="${d.id}">إلغاء</button></td></tr>`;
    }).join('');
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الأولى</th><th>الثانية</th><th>الموضوع</th><th>النوع</th><th>الإجراء</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    box.querySelectorAll('.lecture-cancel').forEach(btn => {
      btn.onclick = () => cancelLecture(btn.dataset.id);
    });
  } catch (e) {
    box.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

async function cancelLecture(lectureId) {
  const confirmed = await showConfirm('إلغاء المحاضرة', 'سيتم إلغاء المحاضرة وتسجيل السبب في السجل الأكاديمي.');
  if (!confirmed) return;
  try {
    await updateDoc(doc(db, 'lectures', lectureId), { status: 'cancelled', updatedAt: serverTimestamp(), updatedBy: currentUser.uid });
    await addDoc(collection(db, 'lectureChanges'), {
      lectureId, action: 'cancel', reason: confirmed,
      userId: currentUser.uid, createdAt: serverTimestamp()
    });
    showToast('تم إلغاء المحاضرة وتسجيل التغيير', 'success');
    loadSchedule($('schedule-batch').value);
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// 15. Attendance Management
// ============================================================
pages.attendance = async () => {
  pageContainer.innerHTML = `
    <h2>تسجيل الحضور</h2>
    <div class="form-grid">
      <label>الدفعة<select id="att-batch"><option value="">— اختر —</option></select></label>
      <label>المحاضرة<select id="att-lecture"><option value="">— اختر دفعة أولاً —</option></select></label>
    </div>
    <div id="att-box" style="margin-top:1rem;"><p class="empty-state">اختر دفعة ومحاضرة لعرض الدارسين.</p></div>
  `;

  const batchSel = $('att-batch');
  const lecSel = $('att-lecture');
  try {
    const bSnap = await getDocs(collection(db, 'batches'));
    bSnap.forEach(b => {
      const option = document.createElement('option');
      option.value = b.id;
      option.textContent = b.data().name || b.id;
      batchSel.appendChild(option);
    });
  } catch (e) { /* تجاهل */ }

  batchSel.onchange = async () => {
    lecSel.innerHTML = '<option value="">— اختر —</option>';
    $('att-box').innerHTML = '<p class="empty-state">اختر محاضرة.</p>';
    if (!batchSel.value) return;
    try {
      const q = query(collection(db, 'lectures'), where('batchId', '==', batchSel.value));
      const lSnap = await getDocs(q);
      if (lSnap.empty) {
        lecSel.innerHTML = '<option value="">لا توجد محاضرات</option>';
        return;
      }
      lSnap.forEach(l => {
        const d = l.data();
        const option = document.createElement('option');
        option.value = l.id;
        option.textContent = `${d.date || ''} — محاضرة ${d.slot || ''}`;
        lecSel.appendChild(option);
      });
    } catch (e) { /* تجاهل */ }
  };

  lecSel.onchange = () => {
    if (lecSel.value) loadAttendanceTable(lecSel.value);
  };
};

async function loadAttendanceTable(lectureId) {
  const box = $('att-box');
  box.innerHTML = '<p class="empty-state">جاري التحميل...</p>';
  try {
    const lecSnap = await getDoc(doc(db, 'lectures', lectureId));
    if (!lecSnap.exists()) { box.innerHTML = '<p class="error-text">المحاضرة غير موجودة.</p>'; return; }
    const lecture = lecSnap.data();

    const enrollQ = query(collection(db, 'enrollments'),
      where('batchId', '==', lecture.batchId), where('active', '==', true));
    const enrollSnap = await getDocs(enrollQ);
    if (enrollSnap.empty) {
      box.innerHTML = '<p class="empty-state">لا يوجد دارسون مسجلون في هذه الدفعة.</p>';
      return;
    }

    let rows = '';
    for (const e of enrollSnap.docs) {
      const en = e.data();
      let studentName = en.studentId, studentCode = '';
      try {
        const sSnap = await getDoc(doc(db, 'students', en.studentId));
        if (sSnap.exists()) { studentName = sSnap.data().name; studentCode = sSnap.data().code; }
      } catch (_) { /* تجاهل */ }

      const attId = `${lectureId}_${en.studentId}`;
      let att = {};
      try {
        const aSnap = await getDoc(doc(db, 'attendance', attId));
        if (aSnap.exists()) att = aSnap.data();
      } catch (_) { /* تجاهل */ }

      rows += `<tr>
        <td>${studentCode}</td>
        <td>${studentName}</td>
        <td>
          <button class="att-btn ${att.present ? 'active-present' : ''}" data-lec="${lectureId}" data-std="${en.studentId}" data-field="present">حاضر</button>
          <button class="att-btn ${att.absent ? 'active-absent' : ''}" data-lec="${lectureId}" data-std="${en.studentId}" data-field="absent">غائب</button>
          <button class="att-btn ${att.excused ? 'active-excused' : ''}" data-lec="${lectureId}" data-std="${en.studentId}" data-field="excused">عذر</button>
          <button class="att-btn ${att.late ? 'active-late' : ''}" data-lec="${lectureId}" data-std="${en.studentId}" data-field="late">تأخير</button>
        </td>
      </tr>`;
    }

    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>الكود</th><th>الاسم</th><th>حضور المحاضرة ${lecture.slot || ''}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;

    box.querySelectorAll('.att-btn').forEach(btn => {
      btn.onclick = () => setAttendance(btn.dataset.lec, btn.dataset.std, btn.dataset.field);
    });
  } catch (e) {
    box.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

async function setAttendance(lectureId, studentId, field) {
  const ref = doc(db, 'attendance', `${lectureId}_${studentId}`);
  const payload = {
    lectureId, studentId,
    present: false, absent: false, excused: false, late: false,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  };
  payload[field] = true;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) tx.update(ref, payload);
      else tx.set(ref, { ...payload, createdAt: serverTimestamp() });
    });
    // التحقق من حدود الغياب عبر Cloud Function (تسجيل التنبيهات)
    httpsCallable(functions, 'checkAbsenceThresholds')({ studentId }).catch(() => {});
    loadAttendanceTable(lectureId);
    showToast('تم تحديث الحضور', 'success');
  } catch (e) {
    showToast('فشل التحديث: ' + e.message, 'error');
  }
}

// ============================================================
// 15. Spiritual Notebook
// ============================================================
pages.notebook = async () => {
  pageContainer.innerHTML = `
    <h2>النوتة الروحية</h2>
    <div class="form-grid">
      <label>كود الدارس<input id="nb-student" placeholder="STD-..."></label>
      <label>التاريخ<input id="nb-date" type="date"></label>
      <label>قراءة الكتاب المقدس (0-10)<input id="nb-bible" type="number" min="0" max="10" value="0"></label>
      <label>الصلاة الشخصية (0-10)<input id="nb-prayer" type="number" min="0" max="10" value="0"></label>
      <label>حضور القداسات (0-10)<input id="nb-mass" type="number" min="0" max="10" value="0"></label>
    </div>
    <button class="btn-primary" id="nb-submit">تسجيل النوتة</button>
    <p id="nb-msg"></p>
    <h3 style="margin:1.5rem 0 0.8rem;">المدخلات المعلقة</h3>
    <div id="nb-pending"><p class="empty-state">جاري التحميل...</p></div>
  `;

  $('nb-submit').onclick = async () => {
    const msg = $('nb-msg');
    msg.textContent = '';
    msg.className = '';
    try {
      const code = $('nb-student').value.trim();
      const q = query(collection(db, 'students'), where('code', '==', code), limit(1));
      const s = await getDocs(q);
      if (s.empty) throw new Error('كود الدارس غير موجود');
      await httpsCallable(functions, 'submitNotebookEntry')({
        studentId: s.docs[0].id,
        items: {
          bibleReading: +$('nb-bible').value || 0,
          prayer: +$('nb-prayer').value || 0,
          mass: +$('nb-mass').value || 0
        },
        noteDate: $('nb-date').value || new Date().toISOString().slice(0, 10)
      });
      msg.className = 'success-text';
      msg.textContent = 'تم التسجيل بانتظار المراجعة';
      loadPendingNotebook();
    } catch (e) {
      msg.className = 'error-text';
      msg.textContent = e.message;
    }
  };
  loadPendingNotebook();
};

async function loadPendingNotebook() {
  const box = $('nb-pending');
  if (!box) return;
  try {
    const q = query(collection(db, 'spiritualNotebook'), where('status', '==', 'pending'));
    const snap = await getDocs(q);
    if (snap.empty) { box.innerHTML = '<p class="empty-state">لا توجد مدخلات معلقة.</p>'; return; }
    let rows = '';
    snap.forEach(d => {
      const n = d.data();
      rows += `<tr>
        <td>${escapeHtml(n.noteDate || '—')}</td>
        <td>${escapeHtml(n.studentId || '—')}</td>
        <td>
          <button class="btn-secondary btn-sm" data-id="${d.id}" data-act="reviewed">اعتماد مراجعة</button>
          <button class="btn-danger btn-sm" data-id="${d.id}" data-act="rejected">رفض</button>
        </td>
      </tr>`;
    });
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>التاريخ</th><th>الدارس</th><th>إجراء</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;

    box.querySelectorAll('button[data-id]').forEach(btn => {
      btn.onclick = async () => {
        try {
          await httpsCallable(functions, 'reviewNotebookEntry')({
            entryId: btn.dataset.id,
            decision: btn.dataset.act,
            notes: ''
          });
          showToast('تم تحديث حالة المدخل', 'success');
          loadPendingNotebook();
        } catch (e) { showToast(e.message, 'error'); }
      };
    });
  } catch (e) {
    box.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// 16. Exam Eligibility (55% Rule — Strict)
// ============================================================
pages.eligibility = async () => {
  pageContainer.innerHTML = `
    <h2>التحقق من أهلية دخول الامتحان (قاعدة 55%)</h2>
    <p style="color:var(--gray-mid);margin-bottom:1rem;">
      الشرط: النسبة الموزونة من التقييمات <strong>المعتمدة فقط</strong> يجب أن تكون <strong>أكبر من 55%</strong>.
      55% بالضبط = غير مؤهل.
    </p>
    <div class="form-grid">
      <label>كود الدارس<input id="el-student" placeholder="STD-..."></label>
    </div>
    <button class="btn-primary" id="el-check">تحقق</button>
    <div id="el-result" style="margin-top:1rem;"></div>
  `;

  $('el-check').onclick = async () => {
    const box = $('el-result');
    box.innerHTML = '<p class="empty-state">جاري الحساب...</p>';
    try {
      const code = $('el-student').value.trim();
      const q = query(collection(db, 'students'), where('code', '==', code), limit(1));
      const s = await getDocs(q);
      if (s.empty) throw new Error('كود الدارس غير موجود');
      const studentId = s.docs[0].id;
      const result = await httpsCallable(functions, 'computeEligibility')({ studentId });
      const data = result.data;
      box.innerHTML = `
        <div class="stat-card" style="border-right-color:${data.eligible ? 'var(--green)' : 'var(--red)'};">
          <h4>النسبة الموزونة (من المعتمدة فقط)</h4>
          <div class="stat-value" style="color:${data.eligible ? 'var(--green)' : 'var(--red)'};">${data.percentage}%</div>
          <p style="margin-top:0.5rem;font-weight:600;color:${data.eligible ? 'var(--green)' : 'var(--red)'};">
            ${data.eligible ? '✅ مؤهل لدخول الامتحان (> 55%)' : '❌ غير مؤهل (≤ 55%)'}
          </p>
          <p style="font-size:0.82rem;color:var(--gray-mid);margin-top:0.3rem;">
            عدد التقييمات المعتمدة: ${data.approvedCount} — إجمالي التقييمات: ${data.totalAssessments}
          </p>
        </div>`;
    } catch (e) {
      box.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
    }
  };
};

// ============================================================
// 17. Annual Assessments (View & Approve)
// ============================================================
pages.assessments = async () => {
  pageContainer.innerHTML = `
    <h2>أعمال السنة</h2>
    <p style="color:var(--gray-mid);margin-bottom:1rem;">
      التقييمات المعتمدة فقط تُحتسب في أهلية الامتحان وقاعدة 55%.
    </p>
    <div class="form-grid">
      <label>كود الدارس<input id="as-student" placeholder="STD-..."></label>
    </div>
    <button class="btn-primary" id="as-load">عرض التقييمات</button>
    <div id="as-result" style="margin-top:1rem;"></div>
  `;

  $('as-load').onclick = async () => {
    const box = $('as-result');
    box.innerHTML = '<p class="empty-state">جاري التحميل...</p>';
    try {
      const code = $('as-student').value.trim();
      const q = query(collection(db, 'students'), where('code', '==', code), limit(1));
      const s = await getDocs(q);
      if (s.empty) throw new Error('كود الدارس غير موجود');
      const studentId = s.docs[0].id;
      const aq = query(collection(db, 'annualAssessments'), where('studentId', '==', studentId));
      const aSnap = await getDocs(aq);
      if (aSnap.empty) {
        box.innerHTML = '<p class="empty-state">لا توجد تقييمات لهذا الدارس.</p>';
        return;
      }
      let rows = '';
      aSnap.forEach(d => {
        const a = d.data();
        const canApprove = a.status === 'reviewed' && (currentRole === 'admin' || currentRole === 'priest');
        rows += `<tr>
          <td>${escapeHtml(a.componentKey || '—')}</td>
          <td>${escapeHtml(a.score ?? '—')} / ${escapeHtml(a.maxScore ?? '—')}</td>
          <td><span class="badge badge-${escapeHtml(a.status)}">${escapeHtml(a.status === 'approved' ? 'معتمد' : a.status === 'reviewed' ? 'تمت المراجعة' : 'معلق')}</span></td>
          <td>${canApprove ? `<button class="btn-secondary btn-sm" data-id="${d.id}">اعتماد</button>` : '—'}</td>
        </tr>`;
      });
      box.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>المكون</th><th>الدرجة</th><th>الحالة</th><th>إجراء</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;

      box.querySelectorAll('button[data-id]').forEach(btn => {
        btn.onclick = async () => {
          try {
            await httpsCallable(functions, 'approveAssessment')({ assessmentId: btn.dataset.id });
            showToast('تم اعتماد التقييم', 'success');
            $('as-load').click();
          } catch (e) { showToast(e.message, 'error'); }
        };
      });
    } catch (e) {
      box.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
    }
  };
};

// ============================================================
// 18. الامتحانات والنتائج
// ============================================================
pages.exams = async () => {
  pageContainer.innerHTML = `
    <h2>الامتحانات والنتائج</h2>
    <div class="form-grid">
      <label>اسم الامتحان<input id="exam-name"></label>
      <label>الدفعة<select id="exam-batch"><option value="">اختر الدفعة</option></select></label>
      <label>المادة<input id="exam-subject" placeholder="اسم المادة"></label>
      <label>النوع<select id="exam-type"><option value="written">تحريري</option><option value="oral">شفهي</option><option value="online">إلكتروني</option></select></label>
      <label>الدرجة العظمى<input id="exam-max" type="number" min="1" value="100"></label>
      <label>درجة النجاح<input id="exam-pass" type="number" min="0" value="50"></label>
      <label>التاريخ<input id="exam-date" type="date"></label>
    </div>
    <button class="btn-primary" id="exam-create">إنشاء امتحان</button>
    <p id="exam-msg"></p>
    <div id="exam-list" style="margin-top:1rem;"><p class="empty-state">جاري التحميل...</p></div>
  `;
  const batchSelect = $('exam-batch');
  const batches = await getDocs(collection(db, 'batches'));
  batches.forEach(batch => {
    const option = document.createElement('option');
    option.value = batch.id;
    option.textContent = batch.data().name || batch.data().code || batch.id;
    batchSelect.appendChild(option);
  });
  $('exam-create').onclick = async () => {
    try {
      const maxScore = Number($('exam-max').value);
      const passScore = Number($('exam-pass').value);
      if (!$('exam-name').value.trim() || !$('exam-batch').value || passScore > maxScore) throw new Error('راجع بيانات الامتحان');
      await addDoc(collection(db, 'exams'), {
            name: $('exam-name').value.trim(), batchId: $('exam-batch').value,
            subject: $('exam-subject').value.trim() || null,
        type: $('exam-type').value, maxScore, passScore,
        date: $('exam-date').value || null, status: 'draft',
        createdAt: serverTimestamp(), createdBy: currentUser.uid
      });
      $('exam-msg').textContent = 'تم إنشاء الامتحان';
      $('exam-msg').className = 'success-text';
      loadExams();
    } catch (e) {
      $('exam-msg').textContent = e.message;
      $('exam-msg').className = 'error-text';
    }
  };
  loadExams();
};

async function loadExams() {
  const box = $('exam-list');
  if (!box) return;
  const snap = await getDocs(collection(db, 'exams'));
  if (snap.empty) { box.innerHTML = '<p class="empty-state">لا توجد امتحانات مسجلة.</p>'; return; }
  let rows = '';
  snap.forEach(docSnap => {
    const exam = docSnap.data();
    rows += `<tr><td>${escapeHtml(exam.name || '—')}</td><td>${escapeHtml(exam.date || '—')}</td><td>${escapeHtml(exam.type || '—')}</td><td>${escapeHtml(exam.maxScore ?? '—')}</td><td><span class="badge">${escapeHtml(exam.status || 'draft')}</span></td></tr>`;
  });
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>الامتحان</th><th>التاريخ</th><th>النوع</th><th>الدرجة العظمى</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ============================================================
// 19. الخدام والتكليفات
// ============================================================
pages.servants = async () => {
  pageContainer.innerHTML = `
    <h2>الخدام والتكليفات</h2>
    <div class="form-grid">
      <label>اسم الخادم<input id="servant-name"></label>
      <label>الهاتف<input id="servant-phone"></label>
      <label>البريد الإلكتروني<input id="servant-email" type="email"></label>
      <label>الكنيسة<input id="servant-church"></label>
      <label>الرقم القومي<input id="servant-national-id" maxlength="14"></label>
      <label>التخصص أو الدور
        <select id="servant-role">
          <option value="servant">خادم خدمة إعداد خدام</option>
          <option value="lecturer">محاضر</option>
          <option value="followup">مراجع نوتة</option>
          <option value="attendance">مسؤول حضور</option>
          <option value="control">مسؤول كنترول</option>
        </select>
      </label>
      <label>تاريخ الانضمام<input id="servant-start-date" type="date"></label>
      <label>الحالة<select id="servant-status"><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="suspended">موقف</option></select></label>
      <label>ملاحظات<textarea id="servant-notes" rows="3"></textarea></label>
    </div>
    <button class="btn-primary" id="servant-save">حفظ الخادم</button>
    <p id="servant-msg"></p>
    <div id="servant-list" style="margin-top:1rem;"><p class="empty-state">جاري التحميل...</p></div>
  `;
  $('servant-save').onclick = async () => {
    try {
      const name = $('servant-name').value.trim();
      if (!name) throw new Error('اسم الخادم مطلوب');
      await addDoc(collection(db, 'servants'), {
        name, phone: $('servant-phone').value.trim(), email: $('servant-email').value.trim(),
        church: $('servant-church').value.trim(), active: true,
        nationalId: $('servant-national-id').value.trim() || null,
        serviceRole: $('servant-role').value,
        startDate: $('servant-start-date').value || null,
        status: $('servant-status').value,
        notes: $('servant-notes').value.trim() || null,
        createdAt: serverTimestamp(), createdBy: currentUser.uid
      });
      $('servant-msg').textContent = 'تم حفظ الخادم';
      $('servant-msg').className = 'success-text';
      loadServants();
    } catch (e) {
      $('servant-msg').textContent = e.message;
      $('servant-msg').className = 'error-text';
    }
  };
  loadServants();
};

async function loadServants() {
  const box = $('servant-list');
  if (!box) return;
  const snap = await getDocs(collection(db, 'servants'));
  if (snap.empty) { box.innerHTML = '<p class="empty-state">لا يوجد خدام مسجلون.</p>'; return; }
  let rows = '';
  snap.forEach(docSnap => {
    const servant = docSnap.data();
    rows += `<tr><td>${escapeHtml(servant.name || '—')}</td><td>${escapeHtml(servant.phone || '—')}</td><td>${escapeHtml(servant.email || '—')}</td><td>${escapeHtml(servant.church || '—')}</td></tr>`;
  });
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>البريد</th><th>الكنيسة</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ============================================================
// 20. الإشعارات والتقارير
// ============================================================
pages.notifications = async () => {
  pageContainer.innerHTML = '<h2>الإشعارات</h2><p class="empty-state">جاري التحميل...</p>';
  const snap = await getDocs(collection(db, 'notifications'));
  if (snap.empty) { pageContainer.innerHTML = '<h2>الإشعارات</h2><p class="empty-state">لا توجد إشعارات جديدة.</p>'; return; }
  let rows = '';
  snap.forEach(docSnap => {
    const item = docSnap.data();
    rows += `<tr><td>${escapeHtml(item.message || '—')}</td><td>${escapeHtml(item.priority || 'normal')}</td><td><span class="badge">${item.read ? 'مقروءة' : 'جديدة'}</span></td></tr>`;
  });
  pageContainer.innerHTML = `<h2>الإشعارات</h2><div class="table-wrap"><table><thead><tr><th>الرسالة</th><th>الأولوية</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>`;
};

pages.reports = async () => {
  pageContainer.innerHTML = `
    <h2>التقارير والتصدير</h2>
    <div class="stats-grid">
      <button class="card btn" id="report-students">تقرير الدارسين</button>
      <button class="card btn" id="report-batches">تقرير الدفعات</button>
      <button class="card btn" id="report-audit">تقرير التدقيق</button>
    </div>
    <div id="report-output"></div>
  `;
  $('report-students').onclick = () => exportCollection('students', 'دارسين');
  $('report-batches').onclick = () => exportCollection('batches', 'دفعات');
  $('report-audit').onclick = () => exportCollection('auditLogs', 'تدقيق');
};

async function exportCollection(collectionName, title) {
  const snap = await getDocs(collection(db, collectionName));
  const rows = [];
  snap.forEach(docSnap => rows.push({ id: docSnap.id, ...docSnap.data(), createdAt: '' }));
  const csv = rows.length ? [Object.keys(rows[0]).join(','), ...rows.map(row => Object.values(row).map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))].join('\n') : '';
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${collectionName}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  $('report-output').innerHTML = `<p class="success-text">تم تجهيز تقرير ${escapeHtml(title)} (${rows.length} سجلًا).</p>`;
}

// ============================================================
// بوابة الدارس والسجل الأكاديمي
// ============================================================
pages.studentPortal = async () => {
  pageContainer.innerHTML = '<h2>بوابة الدارس</h2><p class="empty-state">جاري تحميل ملفك الأكاديمي...</p>';
  try {
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const studentId = userSnap.exists() ? userSnap.data().studentId : null;
    if (!studentId) {
      pageContainer.innerHTML = '<h2>بوابة الدارس</h2><p class="error-text">لم يتم ربط حسابك بملف دارس. تواصل مع مسؤول النظام.</p>';
      return;
    }
    const studentSnap = await getDoc(doc(db, 'students', studentId));
    if (!studentSnap.exists()) {
      pageContainer.innerHTML = '<h2>بوابة الدارس</h2><p class="error-text">ملف الدارس غير موجود.</p>';
      return;
    }
    const student = studentSnap.data();
    const enrollmentSnap = await getDocs(query(collection(db, 'enrollments'), where('studentId', '==', studentId), where('active', '==', true), limit(1)));
    let batchName = 'غير مرتبط';
    let batchId = '';
    if (!enrollmentSnap.empty) {
      batchId = enrollmentSnap.docs[0].data().batchId;
      const batchSnap = await getDoc(doc(db, 'batches', batchId));
      if (batchSnap.exists()) batchName = batchSnap.data().name || batchSnap.data().code || batchId;
    }
    pageContainer.innerHTML = `
      <h2>بوابة الدارس</h2>
      <div class="dashboard-header"><div><strong>${escapeHtml(student.name || '—')}</strong><div class="text-muted">${escapeHtml(student.code || 'بدون كود')}</div></div><span class="badge badge-info">${escapeHtml(student.status || 'مقيد')}</span></div>
      <div class="stats-grid">
        <div class="stat-card"><h4>الدفعة</h4><div class="stat-value" style="font-size:1rem">${escapeHtml(batchName)}</div></div>
        <div class="stat-card"><h4>الحالة الأكاديمية</h4><div class="stat-value" style="font-size:1rem">${escapeHtml(student.status || 'مقيد')}</div></div>
      </div>
      <div class="card"><h3 class="card-title">بياناتي الأكاديمية</h3>
        <p>الدفعة الحالية: ${escapeHtml(batchName)}</p>
        <p>الهاتف: ${escapeHtml(student.phone || '—')}</p>
        <p>الكنيسة: ${escapeHtml(student.church || '—')}</p>
      </div>
    `;
    pageContainer.querySelectorAll('.student-status-select').forEach(select => {
      select.onchange = async () => {
        const reason = await showConfirm('تغيير حالة الدارس', 'سيتم حفظ الحالة والتاريخ والسبب في السجل الأكاديمي.');
        if (!reason) { navigateTo('students'); return; }
        try {
          await updateDoc(doc(db, 'students', select.dataset.id), {
            status: select.value, statusReason: reason, statusUpdatedAt: serverTimestamp(), statusUpdatedBy: currentUser.uid
          });
          await addDoc(collection(db, 'academicDecisions'), {
            studentId: select.dataset.id, type: 'status_change', status: select.value,
            reason, decisionBy: currentUser.uid, createdAt: serverTimestamp()
          });
          showToast('تم تحديث حالة الدارس', 'success');
        } catch (e) { showToast(e.message, 'error'); navigateTo('students'); }
      };
    });
  } catch (e) {
    pageContainer.innerHTML = `<h2>بوابة الدارس</h2><p class="error-text">${escapeHtml(e.message)}</p>`;
  }
};

// ============================================================
// التخرج والأرشفة
// ============================================================
pages.archive = async () => {
  pageContainer.innerHTML = `
    <h2>التخرج والأرشفة</h2>
    <div class="card">
      <div class="form-grid">
        <label>الدارس<select id="graduate-student"><option value="">اختر الدارس</option></select></label>
        <label>تاريخ التخرج<input id="graduate-date" type="date"></label>
        <label>رقم القرار<input id="graduate-decision"></label>
      </div>
      <button class="btn-primary" id="graduate-save">اعتماد التخرج والأرشفة</button>
      <p id="graduate-msg"></p>
    </div>
    <div id="graduation-list"></div>
  `;
  const studentSelect = $('graduate-student');
  const snap = await getDocs(collection(db, 'students'));
  snap.forEach(d => {
    const option = document.createElement('option');
    option.value = d.id;
    option.textContent = `${d.data().code || ''} - ${d.data().name || d.id}`;
    studentSelect.appendChild(option);
  });
  $('graduate-save').onclick = async () => {
    const studentId = studentSelect.value;
    if (!studentId || !$('graduate-date').value) {
      $('graduate-msg').textContent = 'اختر الدارس وتاريخ التخرج';
      $('graduate-msg').className = 'error-text';
      return;
    }
    const reason = await showConfirm('اعتماد التخرج', 'سيتم تحديث حالة الدارس وإنشاء سجل أرشيف رسمي.');
    if (!reason) return;
    try {
      await updateDoc(doc(db, 'students', studentId), {
        status: 'graduated', graduationDate: $('graduate-date').value,
        updatedAt: serverTimestamp(), updatedBy: currentUser.uid
      });
      await addDoc(collection(db, 'graduationRecords'), {
        studentId, graduationDate: $('graduate-date').value,
        decisionNumber: $('graduate-decision').value.trim(), reason,
        approvedBy: currentUser.uid, createdAt: serverTimestamp()
      });
      await addDoc(collection(db, 'academicDecisions'), {
        studentId, type: 'graduation', decisionDate: $('graduate-date').value,
        reason, approvedBy: currentUser.uid, createdAt: serverTimestamp()
      });
      $('graduate-msg').textContent = 'تم اعتماد التخرج وإنشاء السجل الأرشيفي';
      $('graduate-msg').className = 'success-text';
      loadGraduations();
    } catch (e) {
      $('graduate-msg').textContent = e.message;
      $('graduate-msg').className = 'error-text';
    }
  };
  loadGraduations();
};

async function loadGraduations() {
  const snap = await getDocs(collection(db, 'graduationRecords'));
  const box = $('graduation-list');
  if (!box) return;
  if (snap.empty) { box.innerHTML = '<p class="empty-state">لا توجد سجلات تخرج مؤرشفة بعد.</p>'; return; }
  const rows = [];
  for (const d of snap.docs) {
    const x = d.data();
    let student = x.studentId;
    const studentSnap = await getDoc(doc(db, 'students', x.studentId));
    if (studentSnap.exists()) student = studentSnap.data().name || student;
    rows.push(`<tr><td>${escapeHtml(student)}</td><td>${escapeHtml(x.graduationDate || '—')}</td><td>${escapeHtml(x.decisionNumber || '—')}</td></tr>`);
  }
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>الدارس</th><th>التاريخ</th><th>رقم القرار</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// ============================================================
// الاستيراد الآمن للبيانات التاريخية
// ============================================================
pages.import = async () => {
  pageContainer.innerHTML = `
    <h2>استيراد البيانات التاريخية</h2>
    <div class="card">
      <div class="form-grid">
        <label>نوع البيانات<select id="import-type"><option value="students">الدارسون</option><option value="batches">الدفعات</option><option value="attendance">الحضور</option><option value="spiritualNotebook">النوتة الروحية</option><option value="exams">الامتحانات</option><option value="examResults">النتائج</option><option value="servants">الخدام</option></select></label>
        <label>ملف CSV<input id="import-file" type="file" accept=".csv,text/csv"></label>
      </div>
      <p class="text-muted">يتم منع الاستبدال التلقائي؛ تظهر المعاينة والأخطاء قبل الاعتماد.</p>
      <button class="btn-primary" id="import-preview" disabled>معاينة الملف</button>
      <button class="btn-secondary" id="import-run" disabled>اعتماد وتنفيذ الاستيراد</button>
      <p id="import-msg"></p>
      <div id="import-preview-box"></div>
    </div>
  `;
  $('import-file').onchange = () => { $('import-preview').disabled = !$('import-file').files.length; };
  $('import-preview').onclick = previewImport;
  $('import-run').onclick = executeImport;
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value.trim());
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

async function previewImport() {
  try {
    const file = $('import-file').files[0];
    if (!file) throw new Error('اختر ملف CSV أولاً');
    const rows = parseCsv(await file.text());
    if (rows.length < 2) throw new Error('الملف لا يحتوي على بيانات');
    const headers = rows[0].map(v => v.trim());
    if (new Set(headers).size !== headers.length) throw new Error('تحتوي رؤوس الأعمدة على أسماء مكررة');
    const errors = [];
    pendingImportRows = rows.slice(1).map((values, index) => {
      const record = Object.fromEntries(headers.map((header, col) => [header, values[col] ?? '']));
      if (!values.some(v => v.trim())) errors.push(`السطر ${index + 2}: صف فارغ`);
      return record;
    });
    const preview = pendingImportRows.slice(0, 8).map((row, index) =>
      `<tr><td>${index + 1}</td>${headers.map(header => `<td>${escapeHtml(row[header] || '—')}</td>`).join('')}</tr>`
    ).join('');
    $('import-preview-box').innerHTML = `
      <div class="table-wrap mt-2"><table><thead><tr><th>#</th>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${preview}</tbody></table></div>
      ${errors.length ? `<p class="error-text">${errors.map(escapeHtml).join('<br>')}</p>` : ''}
    `;
    $('import-msg').className = errors.length ? 'error-text' : 'success-text';
    $('import-msg').textContent = errors.length
      ? `تمت المعاينة مع ${errors.length} خطأ.`
      : `تمت المعاينة: ${pendingImportRows.length} سجل جاهز للاستيراد.`;
    $('import-run').disabled = errors.length > 0 || pendingImportRows.length === 0;
  } catch (e) {
    pendingImportRows = [];
    $('import-run').disabled = true;
    $('import-msg').className = 'error-text';
    $('import-msg').textContent = e.message;
  }
}

async function executeImport() {
  if (!pendingImportRows.length) return;
  const collectionName = $('import-type').value;
  const reason = await showConfirm('تنفيذ الاستيراد', `سيتم إضافة ${pendingImportRows.length} سجلًا إلى ${collectionName} دون حذف أو استبدال السجلات الحالية.`);
  if (!reason) return;
  try {
    const existingSnap = await getDocs(collection(db, collectionName));
    const existing = new Set(existingSnap.docs.map(d => JSON.stringify(d.data())));
    let imported = 0;
    let duplicates = 0;
    for (const row of pendingImportRows) {
      const normalized = JSON.stringify(Object.keys(row).sort().reduce((out, key) => {
        out[key] = row[key];
        return out;
      }, {}));
      if (existing.has(normalized)) {
        duplicates++;
        continue;
      }
      await addDoc(collection(db, collectionName), {
        ...row,
        imported: true,
        importReason: reason,
        createdAt: serverTimestamp(),
        importedBy: currentUser.uid
      });
      existing.add(normalized);
      imported++;
    }
    await addDoc(collection(db, 'importJobs'), {
      collectionName, requestedBy: currentUser.uid, reason,
      sourceRows: pendingImportRows.length, imported, duplicates,
      status: 'completed', createdAt: serverTimestamp()
    });
    $('import-msg').className = 'success-text';
    $('import-msg').textContent = `تم الاستيراد: ${imported} سجلًا جديدًا، وتجاهل ${duplicates} سجلًا مكررًا.`;
    $('import-run').disabled = true;
  } catch (e) {
    $('import-msg').className = 'error-text';
    $('import-msg').textContent = e.message;
  }
}

// ============================================================
// 21. Users Management (Admin/Priest only)
// ============================================================
pages.users = async () => {
  if (currentRole !== 'admin' && currentRole !== 'priest') {
    pageContainer.innerHTML = '<p class="error-text">ليس لديك صلاحية الوصول إلى هذه الصفحة.</p>';
    return;
  }
  pageContainer.innerHTML = `
    <h2>إدارة المستخدمين والصلاحيات</h2>
    <p style="color:var(--gray-mid);margin-bottom:1rem;">
      تغيير الأدوار يتم عبر Cloud Function ويُنعكس فورًا في Custom Claims.
    </p>
    <div class="form-grid">
      <label>البريد الإلكتروني للمستخدم<input id="usr-email" type="email" placeholder="user@example.com"></label>
      <label>الدور الجديد
        <select id="usr-role">
          <option value="student">دارس</option>
          <option value="servant">خادم</option>
          <option value="control">مسؤول كنترول</option>
          <option value="admin">مسؤول نظام</option>
          <option value="priest">كاهن مسؤول</option>
        </select>
      </label>
    </div>
    <button class="btn-primary" id="usr-submit">تعيين الدور</button>
    <p id="usr-msg"></p>
    <h3 style="margin:1.5rem 0 0.8rem;">المستخدمون الحاليون</h3>
    <div id="usr-list"><p class="empty-state">جاري التحميل...</p></div>
  `;

  $('usr-submit').onclick = async () => {
    const msg = $('usr-msg');
    msg.textContent = '';
    msg.className = '';
    try {
      const email = $('usr-email').value.trim();
      const role = $('usr-role').value;
      if (!email) throw new Error('أدخل البريد الإلكتروني');
      const reason = await showConfirm('تغيير دور مستخدم', `سيتم تعيين الدور "${role}" للمستخدم ${email}`);
      if (!reason) return;
      await httpsCallable(functions, 'setUserRole')({ email, role, reason });
      msg.className = 'success-text';
      msg.textContent = 'تم تعيين الدور بنجاح. قد يحتاج المستخدم لتسجيل الدخول مجددًا.';
      loadUsersList();
    } catch (e) {
      msg.className = 'error-text';
      msg.textContent = e.message;
    }
  };
  if (currentRole !== 'admin') {
    $('usr-role').querySelectorAll('option[value="admin"], option[value="priest"]').forEach(option => option.remove());
  }
  loadUsersList();
};

async function loadUsersList() {
  const box = $('usr-list');
  if (!box) return;
  try {
    const snap = await getDocs(collection(db, 'users'));
    if (snap.empty) { box.innerHTML = '<p class="empty-state">لا يوجد مستخدمون مسجلون في مجموعة users.</p>'; return; }
    let rows = '';
    snap.forEach(d => {
      const u = d.data();
      rows += `<tr><td>${escapeHtml(u.email || d.id)}</td><td>${escapeHtml(ROLE_LABELS[u.role] || u.role || '—')}</td></tr>`;
    });
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>البريد</th><th>الدور</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  } catch (e) {
    box.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// 19. Audit Logs (Priest/Admin only)
// ============================================================
pages.audit = async () => {
  if (currentRole !== 'admin' && currentRole !== 'priest') {
    pageContainer.innerHTML = '<p class="error-text">ليس لديك صلاحية الوصول إلى سجل التدقيق.</p>';
    return;
  }
  pageContainer.innerHTML = '<h2>سجل التدقيق</h2><p class="empty-state">جاري التحميل...</p>';
  try {
    const q = query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    if (snap.empty) { pageContainer.innerHTML = '<h2>سجل التدقيق</h2><p class="empty-state">لا توجد سجلات بعد.</p>'; return; }
    let rows = '';
    snap.forEach(d => {
      const a = d.data();
      rows += `<tr>
        <td>${escapeHtml(a.action || '—')}</td>
        <td>${escapeHtml(a.entity || '—')}</td>
        <td>${escapeHtml(a.userId || '—')}</td>
        <td>${escapeHtml(a.reason || '—')}</td>
      </tr>`;
    });
    pageContainer.innerHTML = `
      <h2>سجل التدقيق (آخر 100)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>العملية</th><th>الكيان</th><th>المستخدم</th><th>السبب</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    `;
  } catch (e) {
    pageContainer.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
};

// ============================================================
// 20. Settings
// ============================================================
pages.settings = async () => {
  if (currentRole !== 'admin' && currentRole !== 'priest') {
    pageContainer.innerHTML = '<p class="error-text">ليس لديك صلاحية الوصول إلى الإعدادات.</p>';
    return;
  }
  pageContainer.innerHTML = `
    <h2>الإعدادات</h2>
    <div class="form-grid">
      <label>الحد الأقصى للغياب المتقطع<input type="number" id="set-disc" value="7"></label>
      <label>الحد الأقصى للغياب المتتالي<input type="number" id="set-cons" value="4"></label>
      <label>حد أهلية الامتحان (%)<input type="number" id="set-elig" value="55"></label>
    </div>
    <button class="btn-primary" id="set-save">حفظ الإعدادات</button>
    <p id="set-msg"></p>
  `;
  $('set-save').onclick = async () => {
    const msg = $('set-msg');
    try {
      await httpsCallable(functions, 'updateSystemSettings')({
        absenceDiscontinuous: +$('set-disc').value,
        absenceConsecutive: +$('set-cons').value,
        eligibilityThreshold: +$('set-elig').value
      });
      msg.className = 'success-text';
      msg.textContent = 'تم حفظ الإعدادات';
    } catch (e) {
      msg.className = 'error-text';
      msg.textContent = e.message;
    }
  };
};

// ============================================================
// 21. Online/Offline Status
// ============================================================
function updateConnectionStatus() {
  const el = $('connection-status');
  if (navigator.onLine) {
    el.textContent = 'متصل';
    el.className = 'conn-online';
  } else {
    el.textContent = 'غير متصل';
    el.className = 'conn-offline';
  }
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();

console.log('✅ نظام إعداد خدام جاهز.');