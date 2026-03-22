/**
 * Tracks bed acceptance from the pran2 hospital dashboard integration.
 * Excluded from GET /api/portal/incidents when listing a hospital queue.
 */
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true },
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  bedType: { type: String, default: '' },
  bedId: { type: String, default: '' }
}, { timestamps: true });

schema.index({ incidentId: 1, hospitalId: 1 }, { unique: true });

module.exports = mongoose.model('PortalHospitalAcceptance', schema);
