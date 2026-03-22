/**
 * Backend ambulance movement: ORS driving route → DB location updates → Socket.io.
 * One active timer per incident (dispatch or transport).
 */

const Incident = require('../models/Incident');
const Ambulance = require('../models/Ambulance');
const Hospital = require('../models/Hospital');
const { calculateBilling } = require('../utils/billing');

const ORS_API_KEY = process.env.ORS_API_KEY || '';

/** incidentId (string) → NodeJS timer handle */
const activeTimers = new Map();

function clearSimulation(incidentId) {
  const key = String(incidentId);
  const handle = activeTimers.get(key);
  if (handle) {
    clearTimeout(handle);
    activeTimers.delete(key);
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchOrsDirections(fromLngLat, toLngLat) {
  if (!ORS_API_KEY) throw new Error('ORS_API_KEY is not configured');
  const [aLng, aLat] = fromLngLat;
  const [bLng, bLat] = toLngLat;
  const url = 'https://api.openrouteservice.org/v2/directions/driving-car'
    + `?api_key=${encodeURIComponent(ORS_API_KEY)}`
    + `&start=${aLng},${aLat}&end=${bLng},${bLat}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('ORS directions failed: ' + txt);
  }
  const data = await res.json();
  const feature = data.features[0];
  const summary = feature.properties.summary;
  const coordinates = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  return {
    coordinates,
    durationSec: summary.duration,
    distanceM:   summary.distance
  };
}

async function etaMinutes(fromLngLat, toLngLat) {
  try {
    const r = await fetchOrsDirections(fromLngLat, toLngLat);
    return Math.max(1, Math.ceil(r.durationSec / 60));
  } catch {
    const [lng1, lat1] = fromLngLat;
    const [lng2, lat2] = toLngLat;
    const km = haversineKm(lat1, lng1, lat2, lng2);
    const hours = km / 35;
    return Math.max(1, Math.ceil(hours * 60));
  }
}

async function arriveAtPickup(io, incidentDoc) {
  const id = incidentDoc._id;
  const ambRef = incidentDoc.assignedAmbulance;
  const ambId = ambRef._id || ambRef;
  const [pLng, pLat] = incidentDoc.pickupLocation.coordinates;

  await Ambulance.findByIdAndUpdate(ambId, {
    location: { type: 'Point', coordinates: [pLng, pLat] },
    lastLocationUpdate: new Date(),
    status: 'on_scene'
  });

  const inc = await Incident.findById(id);
  if (!inc) return;
  if (inc.status !== 'dispatched') return;

  inc.status = 'on_scene';
  inc.arrivedAt = new Date();
  if (inc.dispatchedAt) {
    inc.responseTimeSeconds = Math.floor((Date.now() - new Date(inc.dispatchedAt).getTime()) / 1000);
  }
  inc.timeline.push({
    status: 'on_scene',
    label: 'On Scene',
    description: 'Paramedics with patient',
    timestamp: new Date()
  });
  await inc.save();

  const populated = await Incident.findById(id)
    .populate('assignedAmbulance')
    .populate('assignedHospital');

  io.to(`incident_${id}`).emit('incident_updated', populated);
  io.to(`share_${populated.shareToken}`).emit('incident_updated', populated);

  if (populated.assignedHospital) {
    startTransport(io, id).catch(err => console.error('startTransport after pickup:', err));
  }
}

async function completeIncident(io, incidentId) {
  const incident = await Incident.findById(incidentId)
    .populate('assignedAmbulance')
    .populate('assignedHospital');
  if (!incident || !incident.assignedHospital?.location?.coordinates) return;

  const [pLng, pLat] = incident.pickupLocation.coordinates;
  const [hLng, hLat] = incident.assignedHospital.location.coordinates;

  let distKm = 4.2;
  try {
    const leg = await fetchOrsDirections([pLng, pLat], [hLng, hLat]);
    if (leg.distanceM != null) distKm = parseFloat((leg.distanceM / 1000).toFixed(1));
  } catch {
    distKm = parseFloat(haversineKm(pLat, pLng, hLat, hLng).toFixed(1));
  }

  incident.status = 'completed';
  incident.completedAt = new Date();
  if (incident.dispatchedAt) {
    incident.totalDurationMinutes = Math.floor(
      (Date.now() - new Date(incident.dispatchedAt).getTime()) / 60000
    );
  }
  incident.timeline.push({
    status: 'completed',
    label: 'Arrived at Hospital',
    description: 'Patient delivered to hospital',
    timestamp: new Date()
  });
  incident.billing = calculateBilling(incident.ambulanceType, distKm);
  await incident.save();

  const icuAdmission = incident.ambulanceType === 'ICU' || incident.ambulanceType === 'NEONATAL';
  const hospUpdate = { $inc: { availableBeds: -1 } };
  if (icuAdmission) hospUpdate.$inc.availableIcuBeds = -1;
  await Hospital.findByIdAndUpdate(incident.assignedHospital._id, hospUpdate);

  await Ambulance.findByIdAndUpdate(incident.assignedAmbulance._id, { status: 'available' });

  const populated = await Incident.findById(incidentId)
    .populate('assignedAmbulance')
    .populate('assignedHospital');

  io.to(`incident_${incidentId}`).emit('incident_updated', populated);
  io.to(`share_${populated.shareToken}`).emit('incident_updated', populated);
}

async function runTransportSimulation(io, incidentId) {
  const key = String(incidentId);

  const bootstrap = await Incident.findById(incidentId)
    .populate('assignedAmbulance')
    .populate('assignedHospital');
  if (!bootstrap || bootstrap.status !== 'transporting') return;
  if (!bootstrap.assignedAmbulance?.location?.coordinates
      || !bootstrap.assignedHospital?.location?.coordinates) return;

  const ambId = bootstrap.assignedAmbulance._id;
  const [hLng, hLat] = bootstrap.assignedHospital.location.coordinates;
  const shareToken = bootstrap.shareToken;

  let coords;
  let durationSec;
  try {
    const [aLng, aLat] = bootstrap.assignedAmbulance.location.coordinates;
    const route = await fetchOrsDirections([aLng, aLat], [hLng, hLat]);
    coords = route.coordinates;
    durationSec = route.durationSec;
  } catch (e) {
    console.error('Transport ORS route:', e.message);
    return;
  }

  if (!coords?.length || coords.length < 2) {
    clearSimulation(incidentId);
    await completeIncident(io, incidentId);
    return;
  }

  const n = Math.max(1, coords.length - 1);
  const stepMs = Math.max(2000, Math.floor((durationSec * 1000) / n));
  let idx = 1;

  async function tick() {
    const fresh = await Incident.findById(incidentId).select('status shareToken');
    if (!fresh || fresh.status !== 'transporting') {
      clearSimulation(incidentId);
      return;
    }

    if (idx >= coords.length) {
      clearSimulation(incidentId);
      await completeIncident(io, incidentId);
      return;
    }

    const { lat, lng } = coords[idx++];

    try {
      await Ambulance.findByIdAndUpdate(ambId, {
        location: { type: 'Point', coordinates: [lng, lat] },
        lastLocationUpdate: new Date()
      });

      io.to(`incident_${incidentId}`).emit('ambulance_moved', { lat, lng, ambulanceId: ambId });
      io.to(`share_${fresh.shareToken}`).emit('ambulance_moved', { lat, lng, ambulanceId: ambId });
      io.to('dispatchers').emit('ambulance_moved', { ambulanceId: ambId, lat, lng });

      const etaMin = await etaMinutes([lng, lat], [hLng, hLat]);
      await Incident.findByIdAndUpdate(incidentId, { estimatedArrival: etaMin });
      io.to(`incident_${incidentId}`).emit('eta_updated', { eta: etaMin });
      io.to(`share_${fresh.shareToken}`).emit('eta_updated', { eta: etaMin });
    } catch (err) {
      console.error('Transport tick:', err);
      clearSimulation(incidentId);
      return;
    }

    const h = setTimeout(tick, stepMs);
    activeTimers.set(key, h);
  }

  const h0 = setTimeout(tick, stepMs);
  activeTimers.set(key, h0);
}

/**
 * Begin hospital transport leg (from on_scene) or resume transport after restart.
 */
async function startTransport(io, incidentId) {
  const incident = await Incident.findById(incidentId)
    .populate('assignedAmbulance')
    .populate('assignedHospital');
  if (!incident?.assignedHospital?.location?.coordinates) return;
  if (incident.status === 'completed' || incident.status === 'cancelled') return;

  clearSimulation(incidentId);

  if (incident.status === 'on_scene') {
    const tl = {
      status: 'transporting',
      label: 'Transporting to Hospital',
      description: 'En route to hospital',
      timestamp: new Date()
    };
    const up = await Incident.updateOne(
      { _id: incidentId, status: 'on_scene' },
      { $set: { status: 'transporting' }, $push: { timeline: tl } }
    );
    if (up.modifiedCount > 0) {
      await Ambulance.findByIdAndUpdate(incident.assignedAmbulance._id, { status: 'transporting' });
      const populated = await Incident.findById(incidentId)
        .populate('assignedAmbulance')
        .populate('assignedHospital');
      io.to(`incident_${incidentId}`).emit('incident_updated', populated);
      io.to(`share_${populated.shareToken}`).emit('incident_updated', populated);
    }
  } else if (incident.status !== 'transporting') {
    return;
  }

  await runTransportSimulation(io, incidentId);
}

async function simulateDispatch(io, incidentId) {
  clearSimulation(incidentId);
  const key = String(incidentId);

  const incident = await Incident.findById(incidentId).populate('assignedAmbulance');
  if (!incident || incident.status !== 'dispatched') return;
  if (!incident.assignedAmbulance?.location?.coordinates
      || !incident.pickupLocation?.coordinates) return;

  const ambId = incident.assignedAmbulance._id;
  const [pLng, pLat] = incident.pickupLocation.coordinates;
  const [aLng, aLat] = incident.assignedAmbulance.location.coordinates;

  let coords;
  let durationSec;
  try {
    const route = await fetchOrsDirections([aLng, aLat], [pLng, pLat]);
    coords = route.coordinates;
    durationSec = route.durationSec;
  } catch (e) {
    console.error('Dispatch ORS route:', e.message);
    return;
  }

  if (!coords?.length || coords.length < 2) {
    await arriveAtPickup(io, incident);
    return;
  }

  const n = Math.max(1, coords.length - 1);
  const stepMs = Math.max(2000, Math.floor((durationSec * 1000) / n));
  let idx = 1;

  async function tick() {
    const fresh = await Incident.findById(incidentId).select('status shareToken');
    if (!fresh || fresh.status !== 'dispatched') {
      clearSimulation(incidentId);
      return;
    }

    if (idx >= coords.length) {
      clearSimulation(incidentId);
      const full = await Incident.findById(incidentId).populate('assignedAmbulance');
      await arriveAtPickup(io, full);
      return;
    }

    const { lat, lng } = coords[idx++];

    try {
      await Ambulance.findByIdAndUpdate(ambId, {
        location: { type: 'Point', coordinates: [lng, lat] },
        lastLocationUpdate: new Date()
      });

      io.to(`incident_${incidentId}`).emit('ambulance_moved', { lat, lng, ambulanceId: ambId });
      io.to(`share_${fresh.shareToken}`).emit('ambulance_moved', { lat, lng, ambulanceId: ambId });
      io.to('dispatchers').emit('ambulance_moved', { ambulanceId: ambId, lat, lng });

      const etaMin = await etaMinutes([lng, lat], [pLng, pLat]);
      await Incident.findByIdAndUpdate(incidentId, { estimatedArrival: etaMin });
      io.to(`incident_${incidentId}`).emit('eta_updated', { eta: etaMin });
      io.to(`share_${fresh.shareToken}`).emit('eta_updated', { eta: etaMin });
    } catch (err) {
      console.error('Dispatch tick:', err);
      clearSimulation(incidentId);
      return;
    }

    const h = setTimeout(tick, stepMs);
    activeTimers.set(key, h);
  }

  const h0 = setTimeout(tick, stepMs);
  activeTimers.set(key, h0);
}

async function resumeActiveSimulations(io) {
  const dispatching = await Incident.find({ status: 'dispatched' }).select('_id').lean();
  for (const row of dispatching) {
    simulateDispatch(io, row._id).catch(err => console.error('Resume dispatch:', err.message));
  }
  const transporting = await Incident.find({ status: 'transporting' }).select('_id').lean();
  for (const row of transporting) {
    startTransport(io, row._id).catch(err => console.error('Resume transport:', err.message));
  }
}

module.exports = {
  simulateDispatch,
  startTransport,
  resumeActiveSimulations
};
