const Incident = require('../models/Incident');
const Ambulance = require('../models/Ambulance');

module.exports = function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Patient joins their incident room
    socket.on('join_incident', async (incidentId) => {
      socket.join(`incident_${incidentId}`);
      console.log(`Socket ${socket.id} joined incident_${incidentId}`);
      // Send current state immediately
      try {
        const incident = await Incident.findById(incidentId)
          .populate('assignedAmbulance')
          .populate('assignedHospital');
        if (incident) socket.emit('incident_updated', incident);
      } catch (e) {}
    });

    // Family/share view joins share token room
    socket.on('join_share', async (shareToken) => {
      socket.join(`share_${shareToken}`);
      console.log(`Socket ${socket.id} joined share_${shareToken}`);
      try {
        const incident = await Incident.findOne({ shareToken })
          .populate('assignedAmbulance')
          .populate('assignedHospital');
        if (incident) socket.emit('incident_updated', incident);
      } catch (e) {}
    });

    // Dispatcher joins dispatchers room
    socket.on('join_dispatch', () => {
      socket.join('dispatchers');
      console.log(`Dispatcher ${socket.id} joined`);
    });

    // Hospital staff joins hospital room
    socket.on('join_hospital', (hospitalId) => {
      socket.join(`hospital_${hospitalId}`);
    });

    // Ambulance GPS location update (from ambulance app / simulation)
    socket.on('ambulance_location_update', async ({ ambulanceId, lat, lng, incidentId }) => {
      try {
        await Ambulance.findByIdAndUpdate(ambulanceId, {
          location: { type: 'Point', coordinates: [lng, lat] },
          lastLocationUpdate: new Date()
        });
        // Broadcast to incident room
        if (incidentId) {
          io.to(`incident_${incidentId}`).emit('ambulance_moved', { ambulanceId, lat, lng });
          // Also get share token and emit to share room
          const incident = await Incident.findById(incidentId).select('shareToken');
          if (incident) io.to(`share_${incident.shareToken}`).emit('ambulance_moved', { ambulanceId, lat, lng });
        }
        io.to('dispatchers').emit('ambulance_moved', { ambulanceId, lat, lng });
      } catch (e) {
        console.error('location update error:', e);
      }
    });

    // ETA update
    socket.on('eta_update', ({ incidentId, shareToken, eta }) => {
      io.to(`incident_${incidentId}`).emit('eta_updated', { eta });
      if (shareToken) io.to(`share_${shareToken}`).emit('eta_updated', { eta });
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};
