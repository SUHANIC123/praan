/**
 * Fan-out incident updates to hospital + dispatch Socket.io rooms when the core
 * incidents routes emit only to incident/share rooms. Uses MongoDB change streams
 * (update/replace only — avoids duplicating create flows that already call broadcastIncident).
 * Requires a replica set or MongoDB Atlas; on standalone dev the watch() constructor may fail — safe to ignore.
 */
const Incident = require('../../models/Incident');

module.exports = function registerIncidentHospitalRelay(io) {
  if (!io) return;
  try {
    const cs = Incident.watch(
      [{ $match: { operationType: { $in: ['update', 'replace'] } } }],
      { fullDocument: 'updateLookup' }
    );
    cs.on('change', async (change) => {
      try {
        const id = change.documentKey && change.documentKey._id;
        if (!id) return;
        const populated = await Incident.findById(id)
          .populate('assignedAmbulance')
          .populate('assignedHospital')
          .lean();
        if (!populated) return;
        const hid = populated.assignedHospital && (populated.assignedHospital._id || populated.assignedHospital);
        if (hid) io.to(`hospital_${hid}`).emit('incident_updated', populated);
        io.to('dispatchers').emit('dispatch_incident_update', populated);
      } catch (e) {
        console.warn('[portal] incident relay:', e.message);
      }
    });
    cs.on('error', (err) => console.warn('[portal] Incident.watch stream error:', err.message));
  } catch (e) {
    console.warn('[portal] Incident.watch not started:', e.message);
  }
}
