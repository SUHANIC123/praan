/**
 * Pran2 dashboard integration — read-only portal APIs for dispatch / hospital UIs.
 * Mounted at /api/portal (see registerPortals.js). Does not modify core route files.
 */
const express = require('express');
const router = express.Router();
const Incident = require('../../models/Incident');
const Ambulance = require('../../models/Ambulance');
const Hospital = require('../../models/Hospital');
const PortalHospitalAcceptance = require('./models/PortalHospitalAcceptance');
const DispatchLog = require('../../models/DispatchLog');
const HospitalActivity = require('../../models/HospitalActivity');
const { broadcastIncident } = require('../../utils/emitIncident');
const { logHospital, logDispatch } = require('../../utils/opsLog');

const ACTIVE_STATUSES = ['requested', 'dispatched', 'on_scene', 'transporting'];

// GET /api/portal/stats — counts for dispatch header
router.get('/stats', async (req, res) => {
  try {
    const [pendingDispatch, incidentsTracking, incidentsActive, ambGroups] = await Promise.all([
      Incident.countDocuments({ status: 'requested' }),
      Incident.countDocuments({ status: { $in: ['dispatched', 'on_scene', 'transporting'] } }),
      Incident.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
      Ambulance.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$status', n: { $sum: 1 } } }
      ])
    ]);
    const byStatus = {};
    ambGroups.forEach(g => { byStatus[g._id] = g.n; });
    res.json({
      pendingDispatch,
      incidentsTracking,
      incidentsActive,
      ambulancesAvailable: byStatus.available || 0,
      ambulancesDispatched: byStatus.dispatched || 0,
      ambulancesOnScene: byStatus.on_scene || 0,
      ambulancesTransporting: byStatus.transporting || 0,
      ambulancesEnRouteTotal:
        (byStatus.dispatched || 0) + (byStatus.on_scene || 0) + (byStatus.transporting || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/incidents?active=1&dispatchQueue=pending|tracking&hospitalId=&status=&limit=
router.get('/incidents', async (req, res) => {
  try {
    const { hospitalId, status, limit = '100', active, dispatchQueue } = req.query;
    const filter = {};
    if (hospitalId) {
      filter.assignedHospital = hospitalId;
      const accepted = await PortalHospitalAcceptance.find({ hospitalId }).distinct('incidentId');
      if (accepted.length) filter._id = { $nin: accepted };
      filter.status = { $in: ['dispatched', 'on_scene', 'transporting'] };
    } else if (dispatchQueue === 'pending') {
      filter.status = 'requested';
    } else if (dispatchQueue === 'tracking') {
      filter.status = { $in: ['dispatched', 'on_scene', 'transporting'] };
    } else if (active === '1' || active === 'true') {
      filter.status = { $in: ACTIVE_STATUSES };
    } else if (status) {
      filter.status = status;
    }
    const list = await Incident.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 500))
      .populate('assignedAmbulance')
      .populate('assignedHospital')
      .lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/dispatch/logs?incidentId=&limit=
router.get('/dispatch/logs', async (req, res) => {
  try {
    const { incidentId, limit = '80' } = req.query;
    const filter = {};
    if (incidentId) filter.incidentId = incidentId;
    const list = await DispatchLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 80, 300))
      .populate('incidentId', 'incidentId caseType status severity reportName')
      .lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/portal/dispatch/note — dispatcher annotation (stored in DispatchLog)
router.post('/dispatch/note', async (req, res) => {
  try {
    const { incidentId, message } = req.body;
    if (!incidentId || !message) return res.status(400).json({ error: 'incidentId and message required' });
    await logDispatch({
      incidentId,
      eventType: 'dispatcher_note',
      message: String(message).slice(0, 2000),
      actor: 'dispatcher'
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/portal/hospital/log-event — staff notes / redirects (HospitalActivity)
router.post('/hospital/log-event', async (req, res) => {
  try {
    const { incidentId, hospitalId, eventType, message = '', payload = {} } = req.body;
    if (!incidentId || !hospitalId || !eventType) {
      return res.status(400).json({ error: 'incidentId, hospitalId, and eventType are required' });
    }
    await logHospital({ incidentId, hospitalId, eventType, message: String(message).slice(0, 2000), payload });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/hospital/activity?hospitalId=&incidentId=&limit=
router.get('/hospital/activity', async (req, res) => {
  try {
    const { hospitalId, incidentId, limit = '80' } = req.query;
    if (!hospitalId) return res.status(400).json({ error: 'hospitalId is required' });
    const filter = { hospitalId };
    if (incidentId) filter.incidentId = incidentId;
    const list = await HospitalActivity.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 80, 300))
      .populate('incidentId', 'incidentId caseType status reportName chiefComplaint patient')
      .lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/portal/incidents/:id/accept-bed — record acceptance + decrement beds (integration UI only)
router.patch('/incidents/:id/accept-bed', async (req, res) => {
  try {
    const { bedType = '', bedId = '' } = req.body;
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    const hid = incident.assignedHospital;
    if (!hid) return res.status(400).json({ error: 'Incident has no assigned hospital' });

    await PortalHospitalAcceptance.create({
      incidentId: incident._id,
      hospitalId: hid,
      bedType: String(bedType),
      bedId: String(bedId)
    });

    const hospital = await Hospital.findById(hid);
    if (hospital) {
      const updates = {};
      if (String(bedType).toLowerCase() === 'icu') {
        updates.availableIcuBeds = Math.max(0, (hospital.availableIcuBeds || 0) - 1);
      } else {
        updates.availableBeds = Math.max(0, (hospital.availableBeds || 0) - 1);
      }
      const updated = await Hospital.findByIdAndUpdate(hid, updates, { new: true });
      req.io.emit('hospital_updated', updated);
    }

    const populated = await Incident.findById(incident._id)
      .populate('assignedAmbulance')
      .populate('assignedHospital')
      .lean();
    broadcastIncident(req.io, populated);

    await logHospital({
      incidentId: incident._id,
      hospitalId: hid,
      eventType: 'bed_accepted',
      message: `Bed ${bedId || '—'} (${bedType || 'general'})`,
      payload: { bedType, bedId }
    });

    const updatedH = await Hospital.findById(hid);
    res.json({ ok: true, hospital: updatedH });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Already accepted for this hospital' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
