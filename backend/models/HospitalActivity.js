const mongoose = require('mongoose');

/**
 * Hospital-side operational log — bed actions, notes, handoff events.
 */
const hospitalActivitySchema = new mongoose.Schema({
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true, index: true },
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
  eventType: {
    type: String,
    required: true,
    enum: [
      'case_visible',
      'hospital_assigned',
      'bed_accepted',
      'bed_declined',
      'staff_note',
      'redirect_patient',
      'patient_update'
    ]
  },
  message: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

hospitalActivitySchema.index({ hospitalId: 1, createdAt: -1 });

module.exports = mongoose.model('HospitalActivity', hospitalActivitySchema);
