// ============================================================
// 日报 & 待办 - v2
// 数据存储在 Firebase Realtime Database，多设备实时同步。
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCibITp90Zw_Q6Cg6e6lXyZkVHHnt8RErE",
  authDomain: "todolist-4a97d.firebaseapp.com",
  databaseURL: "https://todolist-4a97d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "todolist-4a97d",
  storageBucket: "todolist-4a97d.firebasestorage.app",
  messagingSenderId: "964848935831",
  appId: "1:964848935831:web:41bf8fc23a1adf26c75ad2",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const reportsRef = ref(db, "reports");
const todosRef = ref(db, "todos");

let reportsCache = {};
let todosCache = {};

const TEMPLATE = `今日主要任务：


完成情况：


明日计划：
`;

let editingReportId = null;
let currentFilter = "all";
let activeDetailId = null;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function reportsArray() {
  return Object.entries(reportsCache).map(([id, r]) => ({ id, ...r }));
}
function todosArray() {
  return Object.entries(todosCache).map(([id, t]) => ({ id, ...t }));
}

// ============================================================
// 登录
// ============================================================
const loginOverlay = document.getElementById("login-overlay");
const loginForm = document.getElementById("login-form");
const loginEmailInput = document.getElementById("login-email");
const loginPasswordInput = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const appRoot = document.getElementById("app-root");

const AUTH_ERROR_MESSAGES = {
  "auth/invalid-email": "邮箱格式不对",
  "auth/invalid-credential": "邮箱或密码不对",
  "auth/wrong-password": "邮箱或密码不对",
  "auth/user-not-found": "邮箱或密码不对",
  "auth/too-many-requests": "尝试次数太多，请稍后再试",
};

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(
      auth,
      loginEmailInput.value.trim(),
      loginPasswordInput.value
    );
    loginPasswordInput.value = "";
  } catch (err) {
    loginError.textContent = AUTH_ERROR_MESSAGES[err.code] || "登录失败，请重试";
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

let unsubscribeReports = null;
let unsubscribeTodos = null;

function startListening() {
  unsubscribeReports = onValue(reportsRef, (snapshot) => {
    reportsCache = snapshot.val() || {};
    renderReports();
  });
  unsubscribeTodos = onValue(todosRef, (snapshot) => {
    todosCache = snapshot.val() || {};
    renderTodos();
  });
}

function stopListening() {
  if (unsubscribeReports) unsubscribeReports();
  if (unsubscribeTodos) unsubscribeTodos();
  unsubscribeReports = null;
  unsubscribeTodos = null;
  reportsCache = {};
  todosCache = {};
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginOverlay.classList.remove("active");
    appRoot.classList.add("authed");
    startListening();
  } else {
    stopListening();
    closeDetail();
    appRoot.classList.remove("authed");
    loginOverlay.classList.add("active");
  }
});

// ---------- tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab + "-panel").classList.add("active");
  });
});

// ============================================================
// 日报
// ============================================================
const reportDateInput = document.getElementById("report-date");
const reportContentInput = document.getElementById("report-content");
const reportEditHint = document.getElementById("report-edit-hint");
const reportSearchInput = document.getElementById("report-search");

const detailOverlay = document.getElementById("report-detail-overlay");
const detailDate = document.getElementById("detail-date");
const detailContent = document.getElementById("detail-content");
const detailEditBtn = document.getElementById("detail-edit-btn");
const detailDeleteBtn = document.getElementById("detail-delete-btn");
const detailCloseBtn = document.getElementById("detail-close-btn");

reportDateInput.value = todayStr();

document.getElementById("insert-template-btn").addEventListener("click", () => {
  if (!reportContentInput.value.trim()) {
    reportContentInput.value = TEMPLATE;
  } else if (confirm("当前已有内容，插入模板会覆盖，确定吗？")) {
    reportContentInput.value = TEMPLATE;
  }
  reportContentInput.focus();
});

document.getElementById("save-report-btn").addEventListener("click", saveReport);

function saveReport() {
  const date = reportDateInput.value || todayStr();
  const content = reportContentInput.value.trim();
  if (!content) {
    alert("先写点内容再保存吧");
    return;
  }

  if (editingReportId) {
    update(ref(db, `reports/${editingReportId}`), {
      date,
      content,
      updatedAt: Date.now(),
    });
    editingReportId = null;
    reportEditHint.textContent = "";
  } else {
    const newRef = push(reportsRef);
    set(newRef, {
      date,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  reportContentInput.value = "";
  reportDateInput.value = todayStr();
}

function editReport(id) {
  const r = reportsArray().find((x) => x.id === id);
  if (!r) return;
  editingReportId = id;
  reportDateInput.value = r.date;
  reportContentInput.value = r.content;
  reportEditHint.textContent = "正在编辑这条日报，保存后会更新原记录";
  closeDetail();
  reportContentInput.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteReport(id) {
  if (!confirm("确定删除这条日报吗？")) return;
  remove(ref(db, `reports/${id}`));
  if (editingReportId === id) {
    editingReportId = null;
    reportContentInput.value = "";
    reportEditHint.textContent = "";
  }
  closeDetail();
}

function openDetail(id) {
  const r = reportsArray().find((x) => x.id === id);
  if (!r) return;
  activeDetailId = id;
  detailDate.textContent = r.date;
  detailContent.textContent = r.content;
  detailOverlay.classList.add("active");
}

function closeDetail() {
  activeDetailId = null;
  detailOverlay.classList.remove("active");
}

detailCloseBtn.addEventListener("click", closeDetail);
detailOverlay.addEventListener("click", (e) => {
  if (e.target === detailOverlay) closeDetail();
});
detailEditBtn.addEventListener("click", () => {
  if (activeDetailId) editReport(activeDetailId);
});
detailDeleteBtn.addEventListener("click", () => {
  if (activeDetailId) deleteReport(activeDetailId);
});

function renderReports() {
  const listEl = document.getElementById("report-list");
  const keyword = reportSearchInput.value.trim().toLowerCase();
  let reports = reportsArray().sort((a, b) => (a.date < b.date ? 1 : -1));

  if (keyword) {
    reports = reports.filter(
      (r) => r.content.toLowerCase().includes(keyword) || r.date.includes(keyword)
    );
  }

  if (reports.length === 0) {
    listEl.innerHTML = `<div class="empty-state">还没有日报记录，写下第一条吧</div>`;
    return;
  }

  listEl.innerHTML = reports
    .map(
      (r) => `
    <div class="report-item" data-id="${r.id}">
      <span class="report-date">${escapeHtml(r.date)}</span>
      <span class="report-chevron" aria-hidden="true">›</span>
    </div>
  `
    )
    .join("");

  listEl.querySelectorAll(".report-item").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });

  // 详情弹窗内容如果还开着，同步刷新（例如实时数据变化）
  if (activeDetailId) {
    const stillExists = reports.find((r) => r.id === activeDetailId);
    if (stillExists) {
      openDetail(activeDetailId);
    } else {
      closeDetail();
    }
  }
}

reportSearchInput.addEventListener("input", renderReports);

// ============================================================
// 待办
// ============================================================
const todoInput = document.getElementById("todo-input");

document.getElementById("add-todo-btn").addEventListener("click", addTodo);
todoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTodo();
});

function addTodo() {
  const text = todoInput.value.trim();
  if (!text) return;
  set(push(todosRef), { text, done: false, createdAt: Date.now() });
  todoInput.value = "";
}

function toggleTodo(id) {
  const t = todosArray().find((x) => x.id === id);
  if (!t) return;
  update(ref(db, `todos/${id}`), { done: !t.done });
}

function deleteTodo(id) {
  remove(ref(db, `todos/${id}`));
}

document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderTodos();
  });
});

function renderTodos() {
  const listEl = document.getElementById("todo-list");
  const statsEl = document.getElementById("todo-stats");
  let todos = todosArray().sort((a, b) => b.createdAt - a.createdAt);

  const total = todos.length;
  const doneCount = todos.filter((t) => t.done).length;

  if (currentFilter === "active") todos = todos.filter((t) => !t.done);
  if (currentFilter === "done") todos = todos.filter((t) => t.done);

  if (todos.length === 0) {
    listEl.innerHTML = `<div class="empty-state">这里空空如也</div>`;
  } else {
    listEl.innerHTML = todos
      .map(
        (t) => `
      <div class="todo-item ${t.done ? "done" : ""}">
        <input type="checkbox" ${t.done ? "checked" : ""} data-id="${t.id}" class="todo-checkbox">
        <span class="todo-text">${escapeHtml(t.text)}</span>
        <button class="delete-btn todo-delete" data-id="${t.id}">删除</button>
      </div>
    `
      )
      .join("");

    listEl.querySelectorAll(".todo-checkbox").forEach((el) => {
      el.addEventListener("change", () => toggleTodo(el.dataset.id));
    });
    listEl.querySelectorAll(".todo-delete").forEach((el) => {
      el.addEventListener("click", () => deleteTodo(el.dataset.id));
    });
  }

  statsEl.textContent = `共 ${total} 条，已完成 ${doneCount} 条`;
}

// ---------- utils ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

