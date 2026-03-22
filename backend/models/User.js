const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: String,
  /** Digits only — used for login lookup (unique) */
  phoneNormalized: { type: String, unique: true, sparse: true },
  passwordHash: { type: String },
  email: String,
  avatarUrl: String,
  role: { type: String, enum: ['patient', 'dispatcher', 'hospital_staff'], default: 'patient' },
  savedLocations: [{
    label: String,
    address: String,
    coordinates: [Number]
  }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
