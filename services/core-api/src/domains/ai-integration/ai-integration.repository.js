import { Course } from '../courses/course.model.js';
import { Enrollment } from '../enrollments/enrollment.model.js';

export const aiIntegrationRepository = {
  course: (courseId) => Course.findById(courseId).select('instructorId status').lean(),
  activeEnrollment: (studentId, courseId) => Enrollment.exists({ studentId, courseId, status: 'enrolled' })
};
