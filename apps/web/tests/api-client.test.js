import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('web client talks to the backend /v1 prefix', () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/api-DvVeKkjb.js'), 'utf8');
  assert.match(source, /\/v1/);
  assert.match(source, /\/courses\/\$\{courseId\}\/enroll/);
  assert.match(source, /\/courses\/\$\{courseOrAgent\}\/ai\/chat/);
});

test('AI quiz answers are checked server-side, not read from the question payload', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
  const api = fs.readFileSync(path.join(root, 'api-DvVeKkjb.js'), 'utf8');
  assert.match(api, /\/ai\/quizzes\/\$\{quizId\}\/questions\/\$\{questionId\}\/check/);
  const quiz = fs.readFileSync(path.join(root, 'StudentQuiz-D7rIh7I4.js'), 'utf8');
  assert.match(quiz, /checkAiQuizAnswer as CQ/);
});
