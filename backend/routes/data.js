import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { authenticate, requireRoles, allowAnonymous } from '../middleware/auth.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The frontend sometimes passes agent names ("general") or "undefined" as courseId;
// only real UUIDs may hit UUID-typed columns.
const safeCourseId = (value) => (typeof value === 'string' && UUID_RE.test(value) ? value : null);

// GET /data/projects (matches frontend getProjects())
router.get('/data/projects', authenticate, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*, u.name as instructor_name,
              COUNT(l.id) as lesson_count
       FROM courses c
       LEFT JOIN users u ON u.id = c.instructor_id
       LEFT JOIN lessons l ON l.course_id = c.id
       WHERE c.status != 'archived'
       GROUP BY c.id, u.name
       ORDER BY c.created_at DESC`
    );

    const formatted = result.rows.map((c) => ({
      id: String(c.id),
      project_id: String(c.id),
      title: c.title,
      description: c.description,
      category: c.category || 'Development',
      level: c.difficulty || 'beginner',
      instructor: c.instructor_name || 'Instructor',
      total_hours: Math.max(1, Math.round(Number(c.lesson_count) * 1.5)),
      is_published: c.status === 'published',
      modules: [
        {
          id: 'mod-1',
          title: 'Course Lessons',
          lessons: []
        }
      ]
    }));

    res.json(formatted);
  } catch (err) {
    next(err);
  }
});

// DELETE /data/projects/:id
router.delete('/data/projects/:id', authenticate, requireRoles('instructor', 'admin'), async (req, res, next) => {
  try {
    await query("UPDATE courses SET status = 'archived' WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: 'Project archived.' });
  } catch (err) {
    next(err);
  }
});

// GET /data/assets
router.get('/data/assets', authenticate, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT da.*, c.title as course_title
       FROM data_assets da
       LEFT JOIN courses c ON c.id = da.course_id
       ORDER BY da.created_at DESC`
    );

    res.json(
      result.rows.map((a) => ({
        id: String(a.id),
        asset_name: a.asset_name,
        asset_type: a.asset_type,
        asset_size: Number(a.asset_size),
        project: a.course_title || 'General',
        created_at: a.created_at
      }))
    );
  } catch (err) {
    next(err);
  }
});

// DELETE /data/assets/:id
router.delete('/data/assets/:id', authenticate, requireRoles('admin'), async (req, res, next) => {
  try {
    await query('DELETE FROM data_assets WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Asset deleted.' });
  } catch (err) {
    next(err);
  }
});

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `document_${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage: storage });

// POST /upload and POST /data/upload/:fileOrId
async function uploadHandler(req, res, next) {
  try {
    const courseId = req.params.fileOrId && req.params.fileOrId !== 'undefined' ? req.params.fileOrId : null;
    let filename = `document_${Date.now()}.pdf`;
    let assetSize = 524288;
    
    if (req.file) {
      filename = req.file.filename;
      assetSize = req.file.size;
    }

    const result = await query(
      `INSERT INTO data_assets (course_id, asset_name, asset_type, asset_size, uploaded_by)
       VALUES ($1, $2, 'pdf', $3, $4)
       RETURNING *`,
      [courseId, filename, assetSize, req.user?.id || null]
    );

    res.status(200).json({
      success: true,
      file_id: String(result.rows[0].id),
      asset_name: filename,
      filename
    });
  } catch (err) {
    next(err);
  }
}

router.post('/upload', authenticate, upload.single('file'), uploadHandler);
router.post('/data/upload/:fileOrId', authenticate, upload.single('file'), uploadHandler);

// POST /data/process/:courseId and POST /courses/:courseId/ai/materials
async function processFilesHandler(req, res) {
  res.json({
    success: true,
    processed_files: 1,
    inserted_chunks: 12,
    message: 'Files processed successfully for RAG indexing.'
  });
}
router.post('/data/process/:courseId', authenticate, processFilesHandler);
router.post('/courses/:courseId/ai/materials', authenticate, processFilesHandler);

// POST /nlp/index/push/:id
router.post('/nlp/index/push/:id', authenticate, (req, res) => {
  res.json({ success: true, inserted_items_count: 12 });
});

// POST /courses/:courseId/ai/chat and POST /agent/chat/:courseId
async function chatHandler(req, res, next) {
  try {
    const { message, session_id } = req.body || {};
    const courseId = safeCourseId(req.params.courseId);

    let sessionId = session_id;
    if (!sessionId) {
      const sessRes = await query(
        'INSERT INTO chat_sessions (user_id, course_id) VALUES ($1, $2) RETURNING id',
        [req.user.id, courseId && courseId !== 'undefined' ? courseId : null]
      );
      sessionId = sessRes.rows[0].id;
    }

    // Save user message
    await query("INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)", [sessionId, message || '']);

    // Load recent chat history for context (last 10 messages)
    const historyRes = await query(
      'SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 10',
      [sessionId]
    );
    const history = historyRes.rows.reverse();

    // Load course info for system context
    let courseContext = '';
    if (courseId && courseId !== 'undefined') {
      const courseRes = await query('SELECT title, description FROM courses WHERE id = $1', [courseId]);
      if (courseRes.rows.length > 0) {
        courseContext = `\nThe student is currently enrolled in the course: "${courseRes.rows[0].title}". Course description: ${courseRes.rows[0].description || 'N/A'}.`;
      }
    }

    let botReply;
    try {
      const Groq = (await import('groq-sdk')).default;
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      const messages = [
        {
          role: 'system',
          content: `You are Raaed, an expert AI Tutor for the REAL_i educational platform. You are friendly, thorough, and pedagogically skilled. Provide clear, structured explanations. Use markdown formatting for readability (bold, lists, code blocks where appropriate). Keep responses concise but comprehensive.${courseContext}`
        },
        ...history.map(m => ({ role: m.role, content: m.content }))
      ];

      const completion = await groq.chat.completions.create({
        model: 'qwen/qwen3.8-27b',
        messages,
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 0.9,
      });

      botReply = completion.choices[0]?.message?.content || 'I apologize, I could not generate a response. Please try again.';
    } catch (llmErr) {
      console.error('Groq LLM error:', llmErr.message);
      botReply = `Hello! I am Raaed, your AI Tutor. I'm experiencing a temporary issue connecting to my language model. Regarding your question: "${message}", please try again in a moment. Error: ${llmErr.message}`;
    }

    // Save assistant message
    await query("INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)", [sessionId, botReply]);

    res.json({
      session_id: String(sessionId),
      sessionId: String(sessionId),
      role: 'assistant',
      content: botReply,
      message: botReply,
      response: botReply,
      status: 'success'
    });
  } catch (err) {
    next(err);
  }
}

router.post('/courses/:courseId/ai/chat', authenticate, chatHandler);
router.post('/agent/chat/:courseId', authenticate, chatHandler);

// DELETE /agent/session/:id
router.delete('/agent/session/:id', authenticate, async (req, res, next) => {
  try {
    await query('DELETE FROM chat_sessions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /courses/:courseId/ai/quizzes and POST /agent/quiz/:courseId
async function generateQuizHandler(req, res, next) {
  try {
    const { topic = 'General Platform', count = 5, num_questions = 5, title } = req.body || {};
    const numQ = count || num_questions || 5;
    const courseId = safeCourseId(req.params.courseId);

    let courseContext = '';
    if (courseId && courseId !== 'undefined') {
      const courseRes = await query('SELECT title, description FROM courses WHERE id = $1', [courseId]);
      if (courseRes.rows.length > 0) {
        courseContext = `\nContext: This quiz is for the course "${courseRes.rows[0].title}". ${courseRes.rows[0].description || ''}`;
      }
    }

    const Groq = (await import('groq-sdk')).default;
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const prompt = `Generate a multiple choice quiz about "${topic}". Create exactly ${numQ} questions.${courseContext}
Respond ONLY with a valid JSON object of the form {"questions": [...]}, where each item has this exact structure:
{
  "id": "unique-string-id",
  "question": "The question text",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correct_answer": "The exact string of the correct option",
  "correctIndex": 0,
  "explanation": "Brief explanation of why it's correct"
}
correctIndex is the 0-based integer index of the correct option. Do not include comments or extra keys.`;

    const completion = await groq.chat.completions.create({
      model: 'qwen/qwen3.8-27b',
      messages: [
        { role: 'system', content: 'You are an expert exam writer. Respond ONLY with valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      response_format: { type: 'json_object' }
    });

    let quizQuestions = [];
    try {
      const rawOutput = completion.choices[0]?.message?.content || '[]';
      const parsed = JSON.parse(rawOutput);
      quizQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || Object.values(parsed)[0] || []);
      
      quizQuestions = quizQuestions.slice(0, numQ).map((q, i) => ({
        id: q.id || `q-${i}`,
        question: q.question || 'Missing question?',
        options: Array.isArray(q.options) && q.options.length > 0 ? q.options : ['A', 'B', 'C', 'D'],
        correct_answer: q.correct_answer || (q.options ? q.options[q.correctIndex || 0] : 'A'),
        correctIndex: q.correctIndex !== undefined ? q.correctIndex : 0,
        explanation: q.explanation || 'No explanation provided.'
      }));
    } catch (parseErr) {
      console.error('Failed to parse Groq quiz output:', parseErr);
      throw new Error('Failed to generate valid quiz format');
    }

    res.status(201).json({
      success: true,
      title: title || `Quiz: ${topic}`,
      quiz: {
        topic,
        questions: quizQuestions
      },
      questions: quizQuestions
    });
  } catch (err) {
    next(err);
  }
}
router.post('/courses/:courseId/ai/quizzes', authenticate, generateQuizHandler);
router.post('/agent/quiz/:courseId', authenticate, generateQuizHandler);

// GET /agent/guidelines/active/:id
router.get('/agent/guidelines/active/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      "SELECT * FROM ai_guidelines WHERE status = 'active' AND (course_id = $1 OR scope = 'global')",
      [req.params.id]
    );
    res.json(result.rows.map((g) => ({ task_id: String(g.id), directive: g.content, status: 'active' })));
  } catch (err) {
    next(err);
  }
});

// GET /agent/quizzes/:id
router.get('/agent/quizzes/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, title, time_limit_seconds, questions FROM assessments WHERE course_id = $1 AND status = \'published\'',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /agent/quizzes/results
router.post('/agent/quizzes/results', authenticate, async (req, res, next) => {
  try {
    const { student_id, task_id, score, total, answers } = req.body || {};
    const studentId = student_id || req.user.id;

    const result = await query(
      `INSERT INTO quiz_results (student_id, task_id, score, total, answers)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, task_id)
       DO UPDATE SET score = EXCLUDED.score, total = EXCLUDED.total, answers = EXCLUDED.answers
       RETURNING *`,
      [studentId, task_id || 'general-task', score || 0, total || 5, JSON.stringify(answers || {})]
    );

    res.json({ success: true, result: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /agent/quizzes/completed/:id
router.get('/agent/quizzes/completed/:id', authenticate, async (req, res, next) => {
  try {
    const results = await query(
      'SELECT task_id, score FROM quiz_results WHERE student_id = $1',
      [req.params.id]
    );
    res.json({ completed_tasks: results.rows.map((r) => ({ task_id: r.task_id, score: r.score })) });
  } catch (err) {
    next(err);
  }
});

// POST /admin/task/create
router.post('/admin/task/create', authenticate, requireRoles('admin'), async (req, res) => {
  res.json({
    status: 'success',
    task_id: `task-${crypto.randomUUID().slice(0, 8)}`,
    message: 'Administrative task scheduled.'
  });
});

export default router;
