import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema({
  jti: { type: String, required: true, immutable: true },
  tokenHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null }
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  passwordHash: { type: String, required: true, select: false },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  role: { type: String, enum: ['student', 'instructor', 'admin'], required: true, default: 'student' },
  refreshTokens: { type: [refreshTokenSchema], default: [] },
  lastLoginAt: Date,
  deletedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: 'version' });

userSchema.index({ email: 1 }, { unique: true, name: 'user_unique_email' });
userSchema.index({ role: 1, deletedAt: 1 }, { name: 'user_role_active' });
userSchema.index({ 'refreshTokens.expiresAt': 1 }, { name: 'user_refresh_expiry' });

export const User = mongoose.model('User', userSchema, 'Users');
