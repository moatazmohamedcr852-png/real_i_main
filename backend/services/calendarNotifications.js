import { query } from '../db/pool.js';

async function insertEventNotifications(event, phase) {
  const audience = event.scope === 'course'
    ? `SELECT e.student_id AS recipient_id
       FROM enrollments e
       JOIN users u ON u.id = e.student_id AND u.deleted_at IS NULL
       WHERE e.course_id = $1 AND e.status = 'enrolled'`
    : `SELECT id AS recipient_id FROM users WHERE deleted_at IS NULL AND $1::uuid IS NULL`;

  const message = phase === 'reminder'
    ? `Reminder: ${event.title} starts in about 2 hours.`
    : `${event.scope === 'course' ? 'Course session' : 'New event'}: ${event.title} is scheduled for ${new Date(event.starts_at).toLocaleString()}.`;
  const deduplicationKey = `calendar:${event.id}:${phase}`;

  await query(
    `INSERT INTO notifications (recipient_id, type, payload, deduplication_key)
     SELECT recipients.recipient_id, 'calendar_reminder',
            jsonb_build_object(
              'title', $2,
              'message', $3,
              'eventId', $4,
              'eventType', $5,
              'phase', $6,
              'startsAt', $7
            ),
            $8 || ':' || recipients.recipient_id::text
     FROM (${audience}) AS recipients
     ON CONFLICT (recipient_id, deduplication_key)
       WHERE deduplication_key IS NOT NULL
       DO NOTHING`,
    [event.scope === 'course' ? event.course_id : null, event.title, message, event.id, event.event_type || 'custom', phase, event.starts_at, deduplicationKey]
  );
}

export async function notifyEventCreated(event) {
  await insertEventNotifications(event, 'announcement');
}

export async function sendUpcomingEventReminders() {
  const events = await query(
    `SELECT id, title, event_type, scope, course_id, starts_at
     FROM calendar_events
     WHERE status = 'active'
       AND starts_at > now()
       AND starts_at <= now() + interval '2 hours'
     ORDER BY starts_at ASC`
  );

  for (const event of events.rows) {
    await insertEventNotifications(event, 'reminder');
  }
}

export function startCalendarReminderScheduler() {
  const run = () => sendUpcomingEventReminders().catch((err) => {
    console.error('Calendar reminder job failed:', err.message);
  });

  run();
  return setInterval(run, 60 * 1000).unref?.();
}
