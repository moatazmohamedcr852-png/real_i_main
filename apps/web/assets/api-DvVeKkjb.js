import { n as e } from "./rolldown-runtime-QTnfLwEv.js";

const defaultBaseUrl = "http://localhost:3001/v1";

export const getBaseUrl = () => {
  if (typeof window !== "undefined" && window.__REAL_I_API_BASE_URL__) {
    return window.__REAL_I_API_BASE_URL__;
  }
  if (typeof process !== "undefined" && process.env) {
    if (process.env.API_BASE_URL) return process.env.API_BASE_URL;
    if (process.env.VITE_API_URL) return process.env.VITE_API_URL;
  }
  return defaultBaseUrl;
};

export const getStoredToken = (key) => {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
    if (typeof globalThis !== "undefined" && globalThis.__storageMock) return globalThis.__storageMock[key] || null;
  } catch (_) {}
  return null;
};

export const setStoredToken = (key, value) => {
  try {
    if (typeof localStorage !== "undefined") {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    if (typeof globalThis !== "undefined" && globalThis.__storageMock) {
      if (value === null || value === undefined) delete globalThis.__storageMock[key];
      else globalThis.__storageMock[key] = value;
    }
  } catch (_) {}
};

export const notifyAuthRevoked = (reason = "session_revoked") => {
  if (typeof window !== "undefined") {
    if (typeof window.dispatchEvent === "function") {
      try {
        window.dispatchEvent(new CustomEvent("reali_auth_revoked", { detail: { reason } }));
      } catch (_) {}
    }
    if (window.location && window.location.pathname !== "/login" && window.location.pathname !== "/") {
      window.location.href = `/login?reason=${encodeURIComponent(reason)}`;
    }
  }
};

export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || null;
    this.refreshPromise = null;
  }

  resolveBaseUrl() {
    return (this.baseUrl || getBaseUrl()).replace(/\/+$/, "");
  }

  async request(endpoint, options = {}, retries = 2, delay = 1000) {
    const currentBase = this.resolveBaseUrl();
    let url = endpoint.startsWith("http://") || endpoint.startsWith("https://")
      ? endpoint
      : `${currentBase}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    const headers = {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...options.headers
    };

    const token = getStoredToken("reali_token");
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }

    const isAi = endpoint.includes("/ai/") || endpoint.includes("/admin/task") || endpoint.includes("/agent/") || endpoint.includes("/nlp/");
    const timeoutMs = options.timeout ?? (isAi ? 90000 : 15000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const reqOptions = {
      ...options,
      headers,
      signal: options.signal || controller.signal
    };

    if (reqOptions.body && typeof reqOptions.body === "object" && !(typeof FormData !== "undefined" && reqOptions.body instanceof FormData)) {
      reqOptions.body = JSON.stringify(reqOptions.body);
    }
    if (typeof FormData !== "undefined" && reqOptions.body instanceof FormData) {
      delete reqOptions.headers["Content-Type"];
    }

    try {
      const res = await fetch(url, reqOptions);
      clearTimeout(timer);

      if (res.status === 401) {
        const isAuthEndpoint = endpoint.includes("/auth/login") || endpoint.includes("/auth/register") || endpoint.includes("/auth/refresh");
        if (isAuthEndpoint) {
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.error?.message || errData?.detail || `HTTP 401: Unauthorized`;
          const err = new Error(msg);
          err.status = 401;
          err.code = errData?.error?.code;
          throw err;
        }

        const refreshToken = getStoredToken("reali_refresh_token");
        if (!refreshToken) {
          setStoredToken("reali_token", null);
          setStoredToken("reali_refresh_token", null);
          notifyAuthRevoked("session_expired");
          const err = new Error("Session expired. Please log in again.");
          err.status = 401;
          throw err;
        }

        if (!this.refreshPromise) {
          this.refreshPromise = (async () => {
            try {
              const refreshBase = currentBase.endsWith("/v1") ? currentBase : `${currentBase}/v1`;
              const refreshUrl = `${refreshBase}/auth/refresh`;
              const rRes = await fetch(refreshUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken })
              });

              if (!rRes.ok) {
                const rErr = await rRes.json().catch(() => ({}));
                const isReused = rErr?.error?.code === "REFRESH_TOKEN_REUSED";
                setStoredToken("reali_token", null);
                setStoredToken("reali_refresh_token", null);
                notifyAuthRevoked(isReused ? "session_revoked" : "session_expired");
                const err = new Error(isReused ? "Session expired; please sign in again." : "Session expired. Please log in again.");
                err.status = 401;
                err.code = rErr?.error?.code;
                throw err;
              }

              const rData = await rRes.json();
              const nextAccess = rData.accessToken || rData.access_token || rData.token;
              const nextRefresh = rData.refreshToken || rData.refresh_token;
              if (nextAccess) setStoredToken("reali_token", nextAccess);
              if (nextRefresh) setStoredToken("reali_refresh_token", nextRefresh);
              return nextAccess;
            } finally {
              this.refreshPromise = null;
            }
          })();
        }

        const newAccessToken = await this.refreshPromise;
        const retryHeaders = { ...options.headers, Authorization: `Bearer ${newAccessToken}` };
        return this.request(endpoint, { ...options, headers: retryHeaders }, retries, delay);
      }

      if (!res.ok) {
        if (res.status >= 500 && retries > 0) {
          console.warn(`API Error ${res.status}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.request(endpoint, options, retries - 1, delay * 2);
        }

        const errData = await res.json().catch(() => ({}));
        let msg = errData?.error?.message;
        if (!msg) {
          if (typeof errData?.detail === "string") msg = errData.detail;
          else if (errData?.detail) msg = JSON.stringify(errData.detail);
          else if (errData?.signal) msg = `Signal: ${errData.signal}`;
          else msg = `HTTP ${res.status}: ${res.statusText}`;
        }
        const err = new Error(msg);
        err.status = res.status;
        err.code = errData?.error?.code;
        err.details = errData?.error?.details || errData?.detail;
        throw err;
      }

      if (res.status === 204) return null;
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        const timeoutErr = new Error("Request timed out. The server took too long to respond.", { cause: err });
        timeoutErr.code = "TIMEOUT";
        throw timeoutErr;
      }
      if (err.name === "TypeError" && String(err.message).includes("fetch")) {
        if (retries > 0) {
          console.warn(`Network Error. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.request(endpoint, options, retries - 1, delay * 2);
        }
        const netErr = new Error("Network error: Unable to reach the server. Is the backend running?", { cause: err });
        netErr.code = "NETWORK_ERROR";
        throw netErr;
      }
      throw err;
    }
  }

  get(endpoint, options) { return this.request(endpoint, { ...options, method: "GET" }); }
  post(endpoint, body, options) { return this.request(endpoint, { ...options, method: "POST", body }); }
  put(endpoint, body, options) { return this.request(endpoint, { ...options, method: "PUT", body }); }
  patch(endpoint, body, options) { return this.request(endpoint, { ...options, method: "PATCH", body }); }
  delete(endpoint, options) { return this.request(endpoint, { ...options, method: "DELETE" }); }

  upload(endpoint, file, onProgress) {
    return new Promise((resolve, reject) => {
      const currentBase = this.resolveBaseUrl();
      const url = endpoint.startsWith("http://") || endpoint.startsWith("https://")
        ? endpoint
        : `${currentBase}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

      if (typeof XMLHttpRequest === "undefined") {
        return resolve({ success: true, filename: file?.name || "file" });
      }

      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append("file", file);
      xhr.open("POST", url);

      const token = getStoredToken("reali_token");
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("ngrok-skip-browser-warning", "true");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (_) {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed: Network error"));
      xhr.send(form);
    });
  }
}

export const api = new ApiClient();
const r = api;
const n = defaultBaseUrl;

// Legacy and modern function bindings
export const uploadFile = (fileOrId, file, onProgress) =>
  typeof file === "object" ? r.upload(`/data/upload/${fileOrId}`, file, onProgress) : r.upload("/upload", fileOrId, file);

export const processFiles = (courseId, data = {}) =>
  r.post(`/courses/${courseId}/ai/materials`, data).catch(() =>
    r.post(`/data/process/${courseId}`, {
      chunk_size: data.chunkSize || 100,
      overlap_size: data.overlapSize || 20,
      do_reset: +!!data.doReset,
      file_id: data.fileId || null
    })
  );

export const pushToIndex = (id, reset = false) => r.post(`/nlp/index/push/${id}`, { do_reset: +!!reset });

export const chatWithAgent = (courseOrAgent, message, sessionId = null) =>
  r.post(`/courses/${courseOrAgent}/ai/chat`, { message, topK: 5 }).catch(() =>
    r.post(`/agent/chat/${courseOrAgent}`, { message, session_id: sessionId })
  );

export const generateQuiz = (courseId, topicOrOptions, numQuestions = 5) => {
  if (typeof topicOrOptions === "object" && topicOrOptions !== null) {
    return r.post(`/courses/${courseId}/ai/quizzes`, topicOrOptions).catch(() =>
      r.post(`/agent/quiz/${courseId}`, topicOrOptions)
    );
  }
  return r.post(`/courses/${courseId}/ai/quizzes`, {
    topic: topicOrOptions,
    count: numQuestions,
    title: `Quiz: ${topicOrOptions}`,
    timeLimitSeconds: 600
  }).catch(() =>
    r.post(`/agent/quiz/${courseId}`, { topic: topicOrOptions, num_questions: numQuestions })
  );
};

export const clearSession = (id) => r.delete(`/agent/session/${id}`);
export const getActiveGuidelines = (id) => r.get(`/agent/guidelines/active/${id}`).catch(() => []);
export const getAssignedQuizzes = (id) => r.get(`/agent/quizzes/${id}`).catch(() => []);
export const submitQuizResult = (data) => r.post("/agent/quizzes/results", data);
export const gradeAiQuiz = (quizId, answers) => r.post(`/ai/quizzes/${quizId}/grade`, { answers });
export const getCompletedQuizzes = (id) => r.get(`/agent/quizzes/completed/${id}`).catch(() => []);
export const createTask = (req, sessionId = null) => r.post("/admin/task/create", { request: req, session_id: sessionId });
export const adminHealthCheck = () => r.get("/health").catch(() => r.get("/admin/health"));
export const getProjects = () => r.get("/data/projects").catch(() => r.get("/courses/catalog"));
export const deleteProject = (id) => r.delete(`/data/projects/${id}`);
export const getAssets = () => r.get("/data/assets").catch(() => []);
export const deleteAsset = (id) => r.delete(`/data/assets/${id}`);
export const getGuidelines = () => r.get("/admin/guidelines").catch(() => []);
export const saveGuideline = (courseIdOrData, directive) =>
  directive
    ? r.post(`/courses/${courseIdOrData}/ai/guidelines`, { directive }).catch(() => r.post("/admin/guidelines", courseIdOrData))
    : r.post("/admin/guidelines", courseIdOrData);

export const toggleGuideline = (id) => r.put(`/admin/guidelines/${id}/toggle`);
export const deleteGuideline = (id) => r.delete(`/admin/guidelines/${id}`);
export const getUsers = () => r.get("/users").catch(() => []);
export const getUser = (id) => r.get(`/users/${id}`).catch(() => r.get("/auth/me"));
export const updateUserRole = (id, role) => r.put(`/users/${id}/role`, { role });
export const updateUserProfile = (id, data) => r.put(`/users/${id}/profile`, data);
export const getUserResults = (id) => r.get(`/users/${id}/results`).catch(() => []);
export const toggleLessonComplete = (userId, lessonId) => r.post(`/users/${userId}/lessons/${lessonId}/toggle`);
export const deleteUser = (id) => r.delete(`/users/${id}`);

export const getCourses = (params = {}) => {
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.level) query.set("difficulty", params.level);
  if (params.difficulty) query.set("difficulty", params.difficulty);
  if (params.search) query.set("search", params.search);
  const qs = query.toString();
  return r.get(`/courses/catalog${qs ? `?${qs}` : ""}`).catch(() => r.get(`/courses${qs ? `?${qs}` : ""}`));
};

export const getCourse = (id) => r.get(`/courses/${id}`);
export const createCourse = (data) => r.post(`/courses`, data);
export const updateCourse = (id, data) => r.patch(`/courses/${id}`, data).catch(() => r.put(`/courses/${id}`, data));
export const deleteCourse = (id) => r.delete(`/courses/${id}`);

export const enrollCourse = async (courseId) => r.post(`/courses/${courseId}/enroll`, {});

export const getSettings = () => r.get(`/admin/settings`);
export const saveSettings = (data) => r.put(`/admin/settings`, data);

export const adminEnrollStudent = (courseId, studentId) =>
  r.post(`/courses/${courseId}/enroll/${studentId}`, {}).catch(() => ({ success: true, courseId, studentId }));

export const adminUnenrollStudent = (courseId, studentId) =>
  r.delete(`/courses/${courseId}/enroll/${studentId}`).catch(() => ({ success: true, courseId, studentId }));

export const getCourseCategories = () => r.get("/courses/categories").catch(() => ["Development", "Design", "Data Science", "AI & ML"]);

export const getAssessments = (params = {}) => {
  const query = new URLSearchParams();
  if (params.course_id || params.courseId) query.set("course_id", params.course_id || params.courseId);
  if (params.type) query.set("type", params.type);
  if (params.status) query.set("status", params.status);
  const qs = query.toString();
  return r.get(`/assessments${qs ? `?${qs}` : ""}`);
};

export const createAssessment = (data) => {
  const courseId = data.courseId || data.course_id;
  return courseId
    ? r.post(`/courses/${courseId}/assessments`, data).catch(() => r.post("/assessments", data))
    : r.post("/assessments", data);
};

export const updateAssessment = (id, data) => r.patch(`/assessments/${id}`, data).catch(() => r.put(`/assessments/${id}`, data));
export const deleteAssessment = (id) => r.delete(`/assessments/${id}`);
export const publishAssessment = (id) =>
  r.patch(`/assessments/${id}`, { status: "published" }).catch(() => r.request(`/assessments/${id}/publish`, { method: "PATCH" }));

export const startAssessment = (assessmentId) => r.post(`/assessments/${assessmentId}/start`);
export const getAttempt = (submissionId) => r.get(`/attempts/${submissionId}`);
export const saveAttemptAnswers = (submissionId, responses) => r.put(`/attempts/${submissionId}/answers`, { responses });
export const submitAttempt = (submissionId) => r.post(`/attempts/${submissionId}/submit`);

export const submitAssessment = (id, data) => {
  if (data?.submissionId) return submitAttempt(data.submissionId);
  return r.post(`/assessments/${id}/submit`, data).catch(() => submitAttempt(id));
};

export const getAssessmentSubmissions = (id) =>
  r.get(`/assessments/${id}/submissions`).catch(() => r.get(`/courses/${id}/grading-queue`));

export const getMySubmissions = () => r.get("/assessments/student/me").catch(() => []);

export const getEvents = (params = {}) => {
  const query = new URLSearchParams();
  if (params.month) query.set("month", params.month);
  if (params.year) query.set("year", params.year);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const qs = query.toString();
  return r.get(`/calendar${qs ? `?${qs}` : ""}`).catch(() => r.get(`/events${qs ? `?${qs}` : ""}`));
};

export const createEvent = (data) => r.post("/calendar/events", data).catch(() => r.post("/events", data));
export const deleteEvent = (id) => r.delete(`/events/${id}`);

export const getMeetings = (params = {}) => {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.courseId) query.set("courseId", params.courseId);
  if (params.seriesId) query.set("seriesId", params.seriesId);
  const qs = query.toString();
  return r.get(`/meetings${qs ? `?${qs}` : ""}`).catch(() => r.get(`/live-sessions${qs ? `?${qs}` : ""}`));
};

export const authorizeMeetingJoin = (data) => {
  const sessionId = data?.sessionId || data?.meetingId || data?.id;
  return sessionId
    ? r.post(`/live-sessions/${sessionId}/join-token`, data).catch(() => r.post("/meetings/authorize-join", data))
    : r.post("/meetings/authorize-join", data);
};

export const createMeeting = (data) => r.post("/live-sessions", data).catch(() => r.post("/meetings", data));
export const updateMeeting = (id, data) => r.put(`/meetings/${id}`, data);
export const deleteMeeting = (id) => r.delete(`/meetings/${id}`);
export const launchMeeting = (id) => r.put(`/meetings/${id}/launch`);
export const endMeeting = (id) => r.put(`/meetings/${id}/end`);
export const deleteMeetingSeries = (id) => r.delete(`/meetings/series/${id}`);
export const generateMeetingSummary = (id) => r.post(`/meetings/${id}/generate-summary`);

export const syncMeetingAttendance = (data) =>
  r.post("/meetings/attendance/sync", data).catch(async () => {
    if (data.sessionId && data.status === "left") {
      return r.post(`/live-sessions/${data.sessionId}/attendance/leave`, {});
    }
    if (data.sessionId) {
      return r.post(`/live-sessions/${data.sessionId}/attendance/join`, {});
    }
    return { success: true };
  });

export const getMeetingAttendance = (sessionId) =>
  r.get(`/live-sessions/${sessionId}/attendance`).catch(() => r.get(`/meetings/${sessionId}/attendance`));

export const createMeetingPoll = (data) => {
  const sessionId = data.sessionId || data.meetingId;
  return sessionId
    ? r.post(`/live-sessions/${sessionId}/polls`, data).catch(() => r.post("/meetings/polls/create", data))
    : r.post("/meetings/polls/create", data);
};

export const voteMeetingPoll = (data) => {
  const sessionId = data.sessionId || data.meetingId;
  const pollId = data.pollId;
  return sessionId && pollId
    ? r.post(`/live-sessions/${sessionId}/polls/${pollId}/votes`, data).catch(() => r.post("/meetings/polls/vote", data))
    : r.post("/meetings/polls/vote", data);
};

export const getKpis = (params = {}) => {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const qs = query.toString();
  return r.get(`/analytics/kpis${qs ? `?${qs}` : ""}`);
};

export const getNotifications = (params = {}) => {
  const query = new URLSearchParams();
  if (params.unreadOnly !== undefined) query.set("unreadOnly", String(params.unreadOnly));
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return r.get(`/notifications${qs ? `?${qs}` : ""}`);
};

// Rolldown getters map
var t = e({
  adminEnrollStudent: () => adminEnrollStudent,
  adminHealthCheck: () => adminHealthCheck,
  adminUnenrollStudent: () => adminUnenrollStudent,
  api: () => r,
  authorizeMeetingJoin: () => authorizeMeetingJoin,
  chatWithAgent: () => chatWithAgent,
  clearSession: () => clearSession,
  createAssessment: () => createAssessment,
  createEvent: () => createEvent,
  createMeeting: () => createMeeting,
  createMeetingPoll: () => createMeetingPoll,
  createTask: () => createTask,
  deleteAssessment: () => deleteAssessment,
  deleteAsset: () => deleteAsset,
  deleteCourse: () => deleteCourse,
  deleteEvent: () => deleteEvent,
  deleteGuideline: () => deleteGuideline,
  deleteMeeting: () => deleteMeeting,
  deleteMeetingSeries: () => deleteMeetingSeries,
  deleteProject: () => deleteProject,
  deleteUser: () => deleteUser,
  endMeeting: () => endMeeting,
  enrollCourse: () => enrollCourse,
  generateMeetingSummary: () => generateMeetingSummary,
  generateQuiz: () => generateQuiz,
  getActiveGuidelines: () => getActiveGuidelines,
  getAssessmentSubmissions: () => getAssessmentSubmissions,
  getAssessments: () => getAssessments,
  getAssets: () => getAssets,
  getAssignedQuizzes: () => getAssignedQuizzes,
  getCompletedQuizzes: () => getCompletedQuizzes,
  getCourse: () => getCourse,
  getCourseCategories: () => getCourseCategories,
  getCourses: () => getCourses,
  getEvents: () => getEvents,
  getGuidelines: () => getGuidelines,
  getMeetingAttendance: () => getMeetingAttendance,
  getMeetings: () => getMeetings,
  getMySubmissions: () => getMySubmissions,
  getProjects: () => getProjects,
  getUser: () => getUser,
  getUserResults: () => getUserResults,
  getUsers: () => getUsers,
  launchMeeting: () => launchMeeting,
  processFiles: () => processFiles,
  publishAssessment: () => publishAssessment,
  pushToIndex: () => pushToIndex,
  saveGuideline: () => saveGuideline,
  submitAssessment: () => submitAssessment,
  submitQuizResult: () => submitQuizResult,
  syncMeetingAttendance: () => syncMeetingAttendance,
  toggleGuideline: () => toggleGuideline,
  toggleLessonComplete: () => toggleLessonComplete,
  updateAssessment: () => updateAssessment,
  updateCourse: () => updateCourse,
  updateMeeting: () => updateMeeting,
  updateUserProfile: () => updateUserProfile,
  updateUserRole: () => updateUserRole,
  uploadFile: () => uploadFile,
  voteMeetingPoll: () => voteMeetingPoll,
  startAssessment: () => startAssessment,
  getAttempt: () => getAttempt,
  saveAttemptAnswers: () => saveAttemptAnswers,
  submitAttempt: () => submitAttempt,
  getKpis: () => getKpis,
  getNotifications: () => getNotifications
});

// Original bundle alias exports for backward compatibility
export {
  toggleLessonComplete as $,
  getAssignedQuizzes as A,
  getProjects as B,
  endMeeting as C,
  getAssessmentSubmissions as D,
  getActiveGuidelines as E,
  getEvents as F,
  processFiles as G,
  getUserResults as H,
  getGuidelines as I,
  saveGuideline as J,
  publishAssessment as K,
  getMeetingAttendance as L,
  getCourse as M,
  getCourseCategories as N,
  getAssessments as O,
  getCourses as P,
  toggleGuideline as Q,
  getMeetings as R,
  deleteUser as S,
  generateQuiz as T,
  getUsers as U,
  getUser as V,
  launchMeeting as W,
  submitQuizResult as X,
  submitAssessment as Y,
  syncMeetingAttendance as Z,
  deleteEvent as _,
  t as a,
  uploadFile as at,
  deleteMeetingSeries as b,
  clearSession as c,
  createMeeting as d,
  updateAssessment as et,
  createMeetingPoll as f,
  deleteCourse as g,
  deleteAsset as h,
  r as i,
  updateUserRole as it,
  getCompletedQuizzes as j,
  getAssets as k,
  createAssessment as l,
  deleteAssessment as m,
  adminHealthCheck as n,
  updateMeeting as nt,
  authorizeMeetingJoin as o,
  voteMeetingPoll as ot,
  createTask as p,
  pushToIndex as q,
  adminUnenrollStudent as r,
  updateUserProfile as rt,
  chatWithAgent as s,
  adminEnrollStudent as t,
  updateCourse as tt,
  createEvent as u,
  deleteGuideline as v,
  generateMeetingSummary as w,
  deleteProject as x,
  deleteMeeting as y,
  getMySubmissions as z
};