const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Incident = require('../models/Incident');
const Ambulance = require('../models/Ambulance');
const Hospital = require('../models/Hospital');
const { v4: uuidv4 } = require('uuid');
const { calculateBilling } = require('../utils/billing');
const { simulateDispatch, startTransport } = require('../services/ambulanceSimulator');
const { callGroq } = require('../utils/groqClient');
const { broadcastIncident } = require('../utils/emitIncident');
const { logDispatch, logHospital } = require('../utils/opsLog');

const INCIDENT_NOT_FOUND_HINT =
  'This incident ID is not in the database (often after seed/reset or a different MongoDB). Start a new request from the home page.';

function fallbackHospitalReport(inc) {
  const d = (inc.patientDetailsForHospital || '').toLowerCase();
  let score = 5;
  if (/cardiac|heart attack|not breathing|unconscious|stroke|severe bleed|anaphylaxis|seizure/i.test(d)) score = 9;
  else if (/chest pain|short breath|breathing difficulty|severe pain|high fever|confusion/i.test(d)) score = 7;
  else if (d.length > 120) score = 6;
  const report = '## Pre-hospital handoff (template)\n\n'
    + `**Patient:** ${inc.patient?.name || 'Unknown'}  \n`
    + `**Age:** ${inc.patient?.age != null ? inc.patient.age : 'Not stated'}  \n`
    + `**Allergies:** ${inc.patient?.allergies || 'None stated'}  \n`
    + `**Medications:** ${inc.patient?.medications || 'None stated'}  \n`
    + `**Dispatch case type:** ${inc.caseType || '—'}  \n`
    + `**Declared severity (dispatch):** ${inc.severity || '—'}  \n\n`
    + '### Clinical narrative for receiving team\n\n'
    + (inc.patientDetailsForHospital || '_No detailed narrative entered yet._\n')
    + `\n\n---\n**Heuristic urgency score:** ${score}/10 (set GROQ_API_KEY in backend/.env for full AI analysis).`;
  return {
    severityScore: score,
    report,
    summaryOneLine: `Handoff drafted — heuristic urgency ${score}/10.`
  };
}

const ORS_API_KEY = process.env.ORS_API_KEY || '';

// ─────────────────────────────────────────────────────────
//  ORS helpers
// ─────────────────────────────────────────────────────────

// Fetch route durations (seconds) and distances (meters) from ORS matrix API.
// sources: array of [lng, lat], destination: [lng, lat]
// Returns array of { durationSec, distanceM } parallel to sources.
async function orsMatrix(sources, destination) {
  if (!ORS_API_KEY) {
    throw new Error('ORS_API_KEY is not configured');
  }
  const locations = [...sources, destination];
  const srcIndices = sources.map((_, i) => i);
  const dstIndex  = sources.length;

  const body = {
    locations,
    sources:      srcIndices,
    destinations: [dstIndex],
    metrics:      ['duration', 'distance']
  };

  const res = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
    method: 'POST',
    headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('ORS matrix failed: ' + txt);
  }

  const data = await res.json();
  return sources.map((_, i) => ({
    durationSec: data.durations[i][0],
    distanceM:   data.distances[i][0]
  }));
}

// Haversine fallback distance (km)
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─────────────────────────────────────────────────────────
//  SMART AMBULANCE SELECTION
// ─────────────────────────────────────────────────────────
async function selectBestAmbulance(pickupLat, pickupLng, ambulanceType) {
  // 1. Find up to 10 available ambulances by geo proximity
  const filter = {
    isActive: true, status: 'available',
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [pickupLng, pickupLat] },
        $maxDistance: 50000
      }
    }
  };
  if (ambulanceType && ambulanceType !== 'any') filter.type = ambulanceType;
  const candidates = await Ambulance.find(filter).limit(8);

  if (candidates.length === 0) return null;

  // 2. Get ORS ETAs for all candidates in a single matrix call
  const sources = candidates
    .filter(a => a.location?.coordinates)
    .map(a => [a.location.coordinates[0], a.location.coordinates[1]]); // [lng, lat]

  if (sources.length === 0) return candidates[0]; // fallback

  let etaData;
  try {
    etaData = await orsMatrix(sources, [pickupLng, pickupLat]);
  } catch (e) {
    console.warn('ORS matrix failed, falling back to haversine:', e.message);
    // Haversine fallback: assume 30 km/h average speed
    etaData = candidates.map(a => {
      const [lng, lat] = a.location.coordinates;
      const distKm = haversine(lat, lng, pickupLat, pickupLng);
      return { durationSec: (distKm / 30) * 3600, distanceM: distKm * 1000 };
    });
  }

  // 3. Score each candidate — lowest ORS road-network ETA wins (no synthetic traffic multiplier)
  const scored = candidates.map((amb, i) => {
    const raw = etaData[i] || { durationSec: 99999, distanceM: 99999 };
    const etaMin = Math.ceil(raw.durationSec / 60);
    return { ambulance: amb, etaMin, distanceM: raw.distanceM };
  }).sort((a, b) => a.etaMin - b.etaMin);

  return scored[0]; // { ambulance, etaMin, distanceM }
}

// ─────────────────────────────────────────────────────────
//  HOSPITAL SUGGESTIONS (scored: ORS ETA + specialty + beds)
// ─────────────────────────────────────────────────────────
const SPECIALTY_MAP = {
  Cardiac:     ['Cardiac'],
  Neuro:       ['Neuro'],
  Trauma:      ['Trauma'],
  Respiratory: ['Respiratory', 'ICU'],
  Obstetric:   ['Obstetric', 'NICU'],
  Neonatal:    ['NICU', 'Pediatric'],
  Pediatric:   ['Pediatric'],
  Burn:        ['Burn Unit'],
  Toxicology:  ['ICU'],
  General:     ['General Surgery', 'ICU']
};

async function getHospitalSuggestions(pickupLat, pickupLng, specialty, limit = 3) {
  // Get up to 8 nearest hospitals
  const hospitals = await Hospital.find({
    isActive: true,
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [pickupLng, pickupLat] },
        $maxDistance: 30000
      }
    }
  }).limit(8);

  if (hospitals.length === 0) return [];

  const hospSources = hospitals
    .filter(h => h.location?.coordinates)
    .map(h => [h.location.coordinates[0], h.location.coordinates[1]]);

  let etaData;
  try {
    etaData = await orsMatrix(hospSources, [pickupLng, pickupLat]);
  } catch (e) {
    console.warn('ORS hospital matrix failed, using haversine:', e.message);
    etaData = hospitals.map(h => {
      const [lng, lat] = h.location.coordinates;
      const distKm = haversine(lat, lng, pickupLat, pickupLng);
      return { durationSec: (distKm / 35) * 3600, distanceM: distKm * 1000 };
    });
  }

  const wantedCaps = specialty ? (SPECIALTY_MAP[specialty] || []) : [];

  const scored = hospitals.map((h, i) => {
    const raw = etaData[i] || { durationSec: 9999, distanceM: 9999 };
    const etaMin = Math.ceil(raw.durationSec / 60);
    const distKm = parseFloat((raw.distanceM / 1000).toFixed(1));

    // Specialty match score (0–3)
    const specialtyScore = wantedCaps.filter(c => h.capabilities?.includes(c)).length;

    // Bed score: 0–2 based on available ICU beds
    const bedScore = h.availableIcuBeds >= 10 ? 2 : h.availableIcuBeds >= 4 ? 1 : 0;

    // Composite: lower ETA is better, more specialty/beds are better
    const score = etaMin - specialtyScore * 3 - bedScore * 2;

    return { hospital: h, etaMin, distKm, specialtyScore, bedScore, score };
  });

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(r => ({
      _id:           r.hospital._id,
      name:          r.hospital.name,
      address:       r.hospital.address,
      city:          r.hospital.city,
      phone:         r.hospital.phone,
      type:          r.hospital.type,
      capabilities:  r.hospital.capabilities,
      availableBeds: r.hospital.availableBeds,
      icuBeds:       r.hospital.icuBeds,
      availableIcuBeds: r.hospital.availableIcuBeds,
      location:      r.hospital.location,
      etaMin:        r.etaMin,
      distKm:        r.distKm,
      specialtyMatch: r.specialtyScore > 0,
      recommended:   r === scored[0]
    }));
}

// ─────────────────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────────────────

// POST /incidents — create incident + auto-assign nearest ambulance (no manual dispatch step)
router.post('/', async (req, res) => {
  try {
    const { patientName, patientPhone, pickupAddress, pickupLat, pickupLng,
            ambulanceType, severity, caseType, userId,
            reportName, chiefComplaint, intakeNotes, patientAge, patientGender,
            patientDetailsForHospital } = req.body;

    const lat = parseFloat(pickupLat);
    const lng = parseFloat(pickupLng);

    const specialty = caseType?.includes('|') ? caseType.split('|')[1] : null;
    const caseLabel = caseType?.includes('|') ? caseType.split('|')[0] : caseType;

    const requestedAmbType = ambulanceType && ambulanceType !== 'any' ? ambulanceType : 'ALS';

    const best = await selectBestAmbulance(lat, lng, requestedAmbType);
    if (!best) {
      return res.status(503).json({ error: 'No ambulances available in your area right now. Please call 108.' });
    }
    const { ambulance: nearestAmbulance, etaMin, distanceM } = best;

    const hospitalSuggestions = await getHospitalSuggestions(lat, lng, specialty, 3);
    const defaultHospital = hospitalSuggestions[0];

    const incidentId  = 'INC-' + Date.now();
    const shareToken  = uuidv4();

    const details = [intakeNotes, patientDetailsForHospital].filter(Boolean).join('\n\n');

    const rawAge = patientAge != null && patientAge !== '' ? parseInt(patientAge, 10) : NaN;
    const ageSafe = Number.isFinite(rawAge) ? Math.min(120, Math.max(0, rawAge)) : undefined;

    const incident = new Incident({
      incidentId,
      shareToken,
      reportName: String(reportName || '').trim(),
      chiefComplaint: String(chiefComplaint || '').trim(),
      intakeNotes: String(intakeNotes || '').trim(),
      patient: {
        name: patientName,
        phone: patientPhone,
        userId,
        ...(ageSafe !== undefined ? { age: ageSafe } : {}),
        ...(patientGender ? { gender: String(patientGender).trim() } : {})
      },
      patientDetailsForHospital: details || '',
      pickupLocation: { address: pickupAddress, coordinates: [lng, lat] },
      ambulanceType: nearestAmbulance.type,
      severity: severity || 'Critical',
      caseType: caseLabel,
      specialty,
      assignedAmbulance: nearestAmbulance._id,
      assignedHospital:  defaultHospital?._id || null,
      status:            'dispatched',
      dispatchedAt:      new Date(),
      estimatedArrival:  etaMin,
      hospitalSuggestions: hospitalSuggestions.map(h => ({
        hospitalId: h._id,
        etaMin:     h.etaMin,
        distKm:     h.distKm,
        specialtyMatch: h.specialtyMatch,
        recommended: h.recommended
      })),
      timeline: [{
        status: 'dispatched',
        label: 'Dispatched',
        description: `${nearestAmbulance.unitId} dispatched — ETA ${etaMin} min`,
        timestamp: new Date()
      }]
    });

    await incident.save();
    await Ambulance.findByIdAndUpdate(nearestAmbulance._id, { status: 'dispatched' });

    const populated = await Incident.findById(incident._id)
      .populate('assignedAmbulance')
      .populate('assignedHospital');

    await logDispatch({
      incidentId: incident._id,
      eventType: 'intake_created',
      message: `Intake: ${caseLabel || 'Emergency'} · ${severity || 'Critical'}`,
      actor: 'system',
      meta: { reportName: incident.reportName, chiefComplaint: incident.chiefComplaint, etaMin }
    });
    await logDispatch({
      incidentId: incident._id,
      eventType: 'auto_assigned',
      message: `${nearestAmbulance.unitId} assigned automatically`,
      actor: 'system',
      meta: { unitId: nearestAmbulance.unitId, ambulanceId: nearestAmbulance._id, etaMin, distanceM }
    });
    if (incident.assignedHospital) {
      await logHospital({
        incidentId: incident._id,
        hospitalId: incident.assignedHospital,
        eventType: 'case_visible',
        message: 'Incoming case routed to hospital (default destination)',
        payload: { etaMin, caseType: caseLabel }
      });
    }

    const response = populated.toObject();
    response.hospitalSuggestionsDetail = hospitalSuggestions;

    broadcastIncident(req.io, populated, { alsoNewIncident: true });

    res.status(201).json(response);

    simulateDispatch(req.io, incident._id).catch(err => console.error('simulateDispatch:', err.message));
  } catch (err) {
    console.error('Create incident error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /incidents/:id/suggested-hospitals — live hospital suggestions for track page
router.get('/:id/suggested-hospitals', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const [lng, lat] = incident.pickupLocation.coordinates;
    const suggestions = await getHospitalSuggestions(lat, lng, incident.specialty, 3);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /incidents/:id/hospital — patient selects a hospital
router.patch('/:id/hospital', async (req, res) => {
  try {
    const { hospitalId } = req.body;
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) return res.status(404).json({ error: 'Hospital not found' });

    const incident = await Incident.findByIdAndUpdate(
      req.params.id,
      { assignedHospital: hospitalId },
      { new: true }
    ).populate('assignedAmbulance').populate('assignedHospital');

    res.json(incident);
    broadcastIncident(req.io, incident);

    await logHospital({
      incidentId: incident._id,
      hospitalId,
      eventType: 'hospital_assigned',
      message: `Destination: ${hospital.name}`,
      payload: { hospitalName: hospital.name }
    });

    if (incident.status === 'on_scene' || incident.status === 'transporting') {
      startTransport(req.io, incident._id).catch(err => console.error('startTransport:', err.message));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /incidents/:id/dispatch-accept — assign ambulance; patient track page becomes “live”
router.patch('/:id/dispatch-accept', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found', hint: INCIDENT_NOT_FOUND_HINT });
    if (incident.status !== 'requested') {
      return res.status(400).json({ error: 'Incident is not awaiting dispatch' });
    }

    const [lng, lat] = incident.pickupLocation.coordinates;
    const best = await selectBestAmbulance(lat, lng, incident.ambulanceType);
    if (!best) {
      return res.status(503).json({ error: 'No ambulances available right now.' });
    }
    const { ambulance: nearestAmbulance, etaMin } = best;

    const hospitalSuggestions = await getHospitalSuggestions(lat, lng, incident.specialty, 3);
    const defaultHospital = hospitalSuggestions[0];
    const keepHospital = incident.assignedHospital || defaultHospital?._id || null;

    incident.assignedAmbulance = nearestAmbulance._id;
    incident.assignedHospital = keepHospital;
    incident.status = 'dispatched';
    incident.dispatchedAt = new Date();
    incident.estimatedArrival = etaMin;
    incident.hospitalSuggestions = hospitalSuggestions.map(h => ({
      hospitalId: h._id,
      etaMin:     h.etaMin,
      distKm:     h.distKm,
      specialtyMatch: h.specialtyMatch,
      recommended: h.recommended
    }));
    incident.timeline.push({
      status: 'dispatched',
      label: 'Dispatched',
      description: `${nearestAmbulance.unitId} dispatched — ETA ${etaMin} min`,
      timestamp: new Date()
    });

    await incident.save();
    await Ambulance.findByIdAndUpdate(nearestAmbulance._id, { status: 'dispatched' });

    const populated = await Incident.findById(incident._id)
      .populate('assignedAmbulance')
      .populate('assignedHospital');

    broadcastIncident(req.io, populated);
    await logDispatch({
      incidentId: incident._id,
      eventType: 'manual_accept',
      message: `Dispatcher confirmed ${nearestAmbulance.unitId}`,
      actor: 'dispatcher',
      meta: { unitId: nearestAmbulance.unitId, etaMin }
    });
    res.json(populated);

    simulateDispatch(req.io, incident._id).catch(err => console.error('simulateDispatch:', err.message));
  } catch (err) {
    console.error('dispatch-accept:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /incidents/:id/dispatch-reject — cancel pending request (before ambulance assigned)
router.patch('/:id/dispatch-reject', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found', hint: INCIDENT_NOT_FOUND_HINT });
    if (incident.status !== 'requested') {
      return res.status(400).json({ error: 'Incident is not awaiting dispatch' });
    }

    const { note } = req.body;
    incident.status = 'cancelled';
    incident.timeline.push({
      status: 'cancelled',
      label: 'Cancelled',
      description: note ? String(note) : 'Declined by dispatch',
      timestamp: new Date()
    });
    if (note) {
      incident.patientStatusNotes.push({ note: String(note), by: 'Dispatch', timestamp: new Date() });
    }
    await incident.save();

    const populated = await Incident.findById(incident._id)
      .populate('assignedAmbulance')
      .populate('assignedHospital');

    broadcastIncident(req.io, populated);
    await logDispatch({
      incidentId: incident._id,
      eventType: 'manual_reject',
      message: note ? String(note) : 'Request declined by dispatch',
      actor: 'dispatcher',
      meta: {}
    });
    res.json(populated);
  } catch (err) {
    console.error('dispatch-reject:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /incidents/:id/patient-record — demographics + hospital narrative
router.patch('/:id/patient-record', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid incident id', hint: INCIDENT_NOT_FOUND_HINT });
    }
    const { name, age, allergies, medications, patientDetailsForHospital } = req.body;
    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found', hint: INCIDENT_NOT_FOUND_HINT });
    }
    if (!incident.patient) incident.patient = {};
    if (name != null) incident.patient.name = String(name).trim();
    if (age !== undefined && age !== '') incident.patient.age = Math.min(120, Math.max(0, parseInt(age, 10) || 0));
    if (allergies != null) incident.patient.allergies = String(allergies).trim();
    if (medications != null) incident.patient.medications = String(medications).trim();
    if (patientDetailsForHospital != null) {
      incident.patientDetailsForHospital = String(patientDetailsForHospital).trim();
    }
    await incident.save();
    const populated = await Incident.findById(incident._id)
      .populate('assignedAmbulance')
      .populate('assignedHospital');
    req.io.to(`incident_${incident._id}`).emit('incident_updated', populated);
    req.io.to(`share_${incident.shareToken}`).emit('incident_updated', populated);
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /incidents/:id/hospital-ai-report (and /ai-report) — Groq handoff + severity /10
async function hospitalAiReportPost(req, res) {
  const id = String(req.params.id || '').trim();
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({
      error: 'Invalid incident id',
      hint: 'Use the track link from your current ambulance request, or start a new request from home.'
    });
  }
  try {
    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found', hint: INCIDENT_NOT_FOUND_HINT });
    }

    if (!(process.env.GROQ_API_KEY || '').trim()) {
      const fb = fallbackHospitalReport(incident);
      incident.aiHospitalReport = fb.report;
      incident.aiSeverityScore = fb.severityScore;
      incident.aiReportSummary = fb.summaryOneLine;
      incident.aiReportGeneratedAt = new Date();
      await incident.save();
      const populated = await Incident.findById(incident._id)
        .populate('assignedAmbulance')
        .populate('assignedHospital');
      req.io.to(`incident_${incident._id}`).emit('incident_updated', populated);
      req.io.to(`share_${incident.shareToken}`).emit('incident_updated', populated);
      return res.json({
        incident: populated,
        usedFallback: true,
        message: 'GROQ_API_KEY not set — heuristic report generated.'
      });
    }

    const prompt = `You are an emergency medicine assistant preparing a written handoff for the RECEIVING HOSPITAL in India (EMS → ED). Use the data below.

Patient name: ${incident.patient?.name || 'Unknown'}
Age: ${incident.patient?.age != null ? incident.patient.age : 'Not stated'}
Allergies: ${incident.patient?.allergies || 'Not stated'}
Home medications: ${incident.patient?.medications || 'Not stated'}
Dispatch case type: ${incident.caseType || 'Not stated'}
Dispatch severity label: ${incident.severity || 'Not stated'}
Ambulance type dispatched: ${incident.ambulanceType || 'Not stated'}

Patient / family narrative for hospital (verbatim context — summarise and structure professionally):
"""
${incident.patientDetailsForHospital || '(No narrative provided — infer only from dispatch fields and state clearly that details are limited.)'}
"""

Return ONLY valid JSON (no markdown fences) with exactly:
{
  "severityScore": <integer 1-10, 10 = most urgent for ED triage>,
  "summaryOneLine": "<= 120 chars for dashboard>",
  "report": "<multi-paragraph markdown: Chief complaint, HPI-style summary, red flags, allergies/meds, suggested ED considerations. Do NOT invent vitals or exam findings not implied by the text. If information is missing, say 'Unknown' or 'Not provided'.>"
}

Rules: severityScore must reflect acuity for hospital preparedness, not replace clinician judgment. Plain clinical language.`;

    const text = await callGroq(prompt, { maxOutputTokens: 2048 });
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in AI response');

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error('Invalid JSON from AI');
    }

    let score = parseInt(parsed.severityScore, 10);
    if (Number.isNaN(score) || score < 1) score = 5;
    if (score > 10) score = 10;

    incident.aiHospitalReport = String(parsed.report || '').trim() || fallbackHospitalReport(incident).report;
    incident.aiSeverityScore = score;
    incident.aiReportSummary = String(parsed.summaryOneLine || '').trim() || `AI urgency ${score}/10`;
    incident.aiReportGeneratedAt = new Date();
    await incident.save();

    const populated = await Incident.findById(incident._id)
      .populate('assignedAmbulance')
      .populate('assignedHospital');
    req.io.to(`incident_${incident._id}`).emit('incident_updated', populated);
    req.io.to(`share_${incident.shareToken}`).emit('incident_updated', populated);
    res.json({ incident: populated, usedFallback: false });
  } catch (err) {
    console.error('hospital-ai-report:', err.message);
    try {
      const incident = await Incident.findById(id);
      if (incident) {
        const fb = fallbackHospitalReport(incident);
        incident.aiHospitalReport = fb.report;
        incident.aiSeverityScore = fb.severityScore;
        incident.aiReportSummary = fb.summaryOneLine + ' (AI error — template used.)';
        incident.aiReportGeneratedAt = new Date();
        await incident.save();
        const populated = await Incident.findById(incident._id)
          .populate('assignedAmbulance')
          .populate('assignedHospital');
        req.io.to(`incident_${incident._id}`).emit('incident_updated', populated);
        req.io.to(`share_${incident.shareToken}`).emit('incident_updated', populated);
        return res.json({
          incident: populated,
          usedFallback: true,
          message: err.message
        });
      }
    } catch (_) { /* ignore */ }
    res.status(500).json({ error: err.message });
  }
}

router.post('/:id/hospital-ai-report', hospitalAiReportPost);
router.post('/:id/ai-report', hospitalAiReportPost);

// GET /incidents/share/:token — must be registered before GET /:id or "share" is parsed as an ObjectId
router.get('/share/:token', async (req, res) => {
  try {
    const incident = await Incident.findOne({ shareToken: req.params.token })
      .populate('assignedAmbulance')
      .populate('assignedHospital');
    if (!incident) return res.status(404).json({ error: 'Invalid share link' });
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /incidents/:id
router.get('/:id', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id)
      .populate('assignedAmbulance')
      .populate('assignedHospital');
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found', hint: INCIDENT_NOT_FOUND_HINT });
    }
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /incidents/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, note, paramedicName } = req.body;
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const statusLabels = {
      on_scene:     { label: 'On Scene',   description: 'Paramedics with patient' },
      transporting: { label: 'Transporting to Hospital', description: 'En route to hospital' },
      completed:    { label: 'Arrived at Hospital', description: 'Patient delivered to hospital' }
    };

    incident.status = status;
    if (statusLabels[status]) {
      incident.timeline.push({ status, ...statusLabels[status], timestamp: new Date() });
    }
    if (note) {
      incident.patientStatusNotes.push({ note, by: paramedicName || 'Paramedic', timestamp: new Date() });
    }
    if (status === 'on_scene') {
      incident.arrivedAt = new Date();
      incident.responseTimeSeconds = Math.floor((new Date() - incident.dispatchedAt) / 1000);
      await Ambulance.findByIdAndUpdate(incident.assignedAmbulance, { status: 'on_scene' });
    }
    if (status === 'transporting') {
      await Ambulance.findByIdAndUpdate(incident.assignedAmbulance, { status: 'transporting' });
    }
    if (status === 'completed') {
      incident.completedAt = new Date();
      incident.totalDurationMinutes = Math.floor((new Date() - incident.dispatchedAt) / 60000);
      const [pLng, pLat] = incident.pickupLocation.coordinates;
      const hosp = await Hospital.findById(incident.assignedHospital);
      let distKm = 4.2;
      if (hosp?.location?.coordinates) {
        const [hLng, hLat] = hosp.location.coordinates;
        distKm = parseFloat(haversine(pLat, pLng, hLat, hLng).toFixed(1));
      }
      incident.billing = calculateBilling(incident.ambulanceType, distKm);
      await Ambulance.findByIdAndUpdate(incident.assignedAmbulance, { status: 'available' });
    }

    await incident.save();
    const populated = await Incident.findById(incident._id)
      .populate('assignedAmbulance').populate('assignedHospital');

    req.io.to(`incident_${incident._id}`).emit('incident_updated', populated);
    req.io.to(`share_${incident.shareToken}`).emit('incident_updated', populated);
    res.json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /incidents/:id/eta
router.patch('/:id/eta', async (req, res) => {
  try {
    const { eta } = req.body;
    const incident = await Incident.findByIdAndUpdate(req.params.id, { estimatedArrival: eta }, { new: true })
      .populate('assignedAmbulance').populate('assignedHospital');
    req.io.to(`incident_${incident._id}`).emit('incident_updated', incident);
    req.io.to(`share_${incident.shareToken}`).emit('incident_updated', incident);
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /incidents/:id/note
router.post('/:id/note', async (req, res) => {
  try {
    const { note, paramedicName } = req.body;
    const incident = await Incident.findByIdAndUpdate(
      req.params.id,
      { $push: { patientStatusNotes: { note, by: paramedicName || 'Paramedic', timestamp: new Date() } } },
      { new: true }
    ).populate('assignedAmbulance').populate('assignedHospital');
    req.io.to(`incident_${incident._id}`).emit('incident_updated', incident);
    req.io.to(`share_${incident.shareToken}`).emit('incident_updated', incident);
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
