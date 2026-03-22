/**
 * Centralize Socket.io fan-out for incident updates (patient, share, hospital, dispatch).
 */
function broadcastIncident(io, doc, opts = {}) {
  if (!io || !doc) return;
  const id = doc._id;
  io.to(`incident_${id}`).emit('incident_updated', doc);
  if (doc.shareToken) {
    io.to(`share_${doc.shareToken}`).emit('incident_updated', doc);
  }
  const hid = doc.assignedHospital && (doc.assignedHospital._id || doc.assignedHospital);
  if (hid) {
    io.to(`hospital_${hid}`).emit('incident_updated', doc);
  }
  io.to('dispatchers').emit('dispatch_incident_update', doc);
  if (opts.alsoNewIncident) {
    io.emit('new_incident', doc);
  }
}

module.exports = { broadcastIncident };
