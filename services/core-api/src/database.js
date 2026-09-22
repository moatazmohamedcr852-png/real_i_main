import mongoose from 'mongoose';

export async function connectDatabase(uri, logger) {
  mongoose.set('strictQuery', true);
  mongoose.set('sanitizeFilter', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 30, minPoolSize: 2 });
  logger.info({ database: mongoose.connection.name }, 'MongoDB connected');
}
