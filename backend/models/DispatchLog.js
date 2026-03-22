const mongoose = require('mongoose');

/**
 * Operational audit for dispatch center — auto-assignments, manual overrides, notes.
 */
const dispatchLogSchema = new mongoose.Schema({
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true, index: true },
  eventType: {
    type: String,
    required: true,
    enum: [
      'intake_created',
      'auto_assigned',
      'manual_accept',
      'manual_reject',
      'dispatcher_note',
      'reassign_requested',
      'status_sync'
    ]
  },
  actor: { type: String, enum: ['system', 'dispatcher'], default: 'system' },
  message: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

dispatchLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('DispatchLog', dispatchLogSchema);
