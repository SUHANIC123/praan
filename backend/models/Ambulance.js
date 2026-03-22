const mongoose = require('mongoose');

const ambulanceSchema = new mongoose.Schema({
  unitId: { type: String, required: true, unique: true }, // e.g. "ALS Unit 402"
  type: { type: String, enum: ['BLS', 'ALS', 'ICU', 'NEONATAL'], required: true },
  licensePlate: { type: String, required: true },
  crew: [{
    name: String,
    role: String // Paramedic, EMT, Driver, Nurse
  }],
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
  status: {
    type: String,
    enum: ['available', 'dispatched', 'on_scene', 'transporting', 'at_hospital', 'returning', 'offline'],
    default: 'available'
  },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: [Number] // [lng, lat]
  },
  lastLocationUpdate: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

ambulanceSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Ambulance', ambulanceSchema);
