const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  phone: { type: String, required: true },
  type: { type: String, enum: ['Level 1 Trauma Center', 'Level 2 Trauma Center', 'General Hospital', 'Specialty Hospital'], required: true },
  capabilities: [{ type: String }], // ICU, NICU, Cardiac, Neuro, etc.
  totalBeds: { type: Number, default: 0 },
  availableBeds: { type: Number, default: 0 },
  icuBeds: { type: Number, default: 0 },
  availableIcuBeds: { type: Number, default: 0 },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: [Number] // [lng, lat]
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

hospitalSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Hospital', hospitalSchema);
