# PRAN — Complete Buildout Documentation
## Hackathon-Ready Feature Roadmap

> Last updated: 2026-03-22
> Stack: Node.js / Express / MongoDB Atlas / Socket.io / Leaflet + ORS / Gemini AI

---

## 1. CURRENT STATE AUDIT

### What exists and works
| Feature | File | Status |
|---|---|---|
| Smart ambulance dispatch (ORS Matrix) | `routes/incidents.js` | Working — real ORS API |
| Hospital scoring (ETA + specialty + beds) | `routes/incidents.js` | Working |
| Symptom checker (Gemini AI + rule fallback) | `routes/symptoms.js` | Working |
| Socket.io rooms (incident, share, dispatch, hospital) | `socket/handlers.js` | Working |
| ORS real road route polyline on map | `js/track.js` | Working |
| Ambulance simulation along ORS waypoints | `js/track.js` | Simulated frontend-only |
| Hospital suggestion cards | `js/track.js` | Working |
| Dynamic reroute on hospital select | `js/track.js` | Working |
| MongoDB seeded (22 ambulances, 8 hospitals) | `seed.js` | Seeded |
| Share token / family view URL | `models/Incident.js` | Token generated, share.html stub only |
| Billing calculation | `routes/incidents.js` | Calculated, summary.html stub only |

### What is FAKE or INCOMPLETE
| Feature | Problem | Priority |
|---|---|---|
| Ambulance GPS movement | Frontend simulation only — NOT written to DB | P0 |
| ETA value | Haversine formula estimate — not a real API call | P0 |
| Status transitions (dispatched→on_scene→transporting) | Never triggered automatically | P0 |
| Patient details form on track page | Form exists in HTML, never submitted | P1 |
| Incoming call overlay | Opens WhatsApp link, not a real call integration | P1 |
| share.html page | Empty stub | P1 |
| summary.html page | Empty stub | P1 |
| Hospital bed counts | Static seed data, never decremented after dispatch | P2 |
| User auth / login | Demo user hardcoded as "Amrisha" | P2 |
| Dispatch portal | Not built | P3 |
| Hospital portal | Not built | P3 |

---

## 2. P0 — REAL ETA FROM ACTUAL MAP APIs (replace all fake formulas)

### The problem with the current approach

The current `estimateEtaFromWaypoints()` function uses:
```
eta = distance / 0.4167 * trafficMultiplier()
```
This is a **made-up formula**. It has no knowledge of actual road speed limits, real-time congestion, traffic signals, one-way streets, or road type. It will frequently be wrong by 40–60%.

### Solution: Use ORS Directions API duration (already available, just not used for ETA)

The ORS Directions API already returns the actual driving duration in seconds in its response. This is calculated from real road network data (OSM) including speed limits per road class. We are currently only using it to get the coordinate array for drawing the polyline — we are throwing away the duration.

**Fix in `fetchOrsRoute()` (backend + frontend):**

```js
// Returns both the route coordinates AND the actual road duration
async function fetchOrsRouteWithEta(from, to) {
  // from/to: [lng, lat] for backend, [lat, lng] for frontend
  const url = `https://api.openrouteservice.org/v2/directions/driving-car`
            + `?api_key=${ORS_API_KEY}`
            + `&start=${from[0]},${from[1]}&end=${to[0]},${to[1]}`;

  const res  = await fetch(url);
  const data = await res.json();
  const feature = data.features[0];

  return {
    // Actual road-network duration in seconds (from ORS, not estimated)
    durationSec:  feature.properties.summary.duration,
    // Actual road distance in meters (from ORS)
    distanceM:    feature.properties.summary.distance,
    // Full coordinate array for drawing polyline
    coordinates:  feature.geometry.coordinates.map(c => [c[1], c[0]])
  };
}
```

**What this gives you:**
- `durationSec` = real driving time on actual roads at posted speed limits
- No traffic multiplier formula needed — ORS already accounts for road types
- For live traffic, use the ORS with traffic profile (see section 2.1 below)
- Distance is also exact road distance, not crow-flies

**Apply it everywhere ETA is currently estimated:**

| Location | Current (fake) | Replace with |
|---|---|---|
| `selectBestAmbulance()` | `orsMatrix()` already used — keep this | Already real |
| `getHospitalSuggestions()` | `orsMatrix()` already used — keep this | Already real |
| ETA recalculation in simulator | `estimateEtaFromWaypoints()` formula | `fetchOrsRouteWithEta(ambCurrentPos, pickup).durationSec` |
| Phase 2 hospital ETA | haversine estimate | `fetchOrsRouteWithEta(pickup, hospital).durationSec` |

**How it works in the simulation loop:**

```js
// Every time ambulance moves to next waypoint, recalculate from actual current position
const etaResult = await fetchOrsRouteWithEta(
  [currentLng, currentLat],   // ambulance current GPS
  [pickupLng, pickupLat]      // destination
);

const etaMin = Math.ceil(etaResult.durationSec / 60);

// Write to DB
await Incident.findByIdAndUpdate(incidentId, { estimatedArrival: etaMin });

// Push to all clients
io.to(`incident_${incidentId}`).emit('eta_updated', { eta: etaMin });
```

This means every 4 seconds (each simulation step) the ETA on the patient's screen is recalculated from a real ORS API call, not a formula.

---

### 2.1 ORS with Live Traffic (Free, Better Accuracy)

ORS free tier does not include real-time traffic data. However, it uses **road speed limits and road class** from OpenStreetMap which gives realistic durations on Indian roads.

For actual live traffic during the hackathon demo, two free options:

**Option A — Here Maps Routing API (free tier: 250,000 requests/month)**
```
GET https://router.hereapi.com/v8/routes
  ?transportMode=car
  &origin={lat},{lng}
  &destination={lat},{lng}
  &return=summary,polyline
  &apikey={HERE_API_KEY}
```
Response includes `travelTime` in seconds based on real-time traffic.
Free signup at developer.here.com — no credit card required.
Add `HERE_API_KEY` to `.env`.

**Option B — Google Maps Distance Matrix API (free tier: $200 credit/month)**
```
GET https://maps.googleapis.com/maps/api/distancematrix/json
  ?origins={lat},{lng}
  &destinations={lat},{lng}
  &departure_time=now
  &traffic_model=best_guess
  &key={GOOGLE_MAPS_KEY}
```
Returns `duration_in_traffic.value` in seconds — actual live traffic ETA.
This is what Google Maps uses. Free for ~40,000 calls/month under the credit.

**Recommendation for hackathon:** Use ORS for route drawing (polyline) and Here Maps for ETA. Here Maps free tier has no credit card, is fast to set up, and covers Indian roads well.

```js
// Backend: hybrid approach
async function getRealEta(fromLng, fromLat, toLng, toLat) {
  try {
    // Here Maps for live-traffic duration
    const url = `https://router.hereapi.com/v8/routes`
              + `?transportMode=car&origin=${fromLat},${fromLng}`
              + `&destination=${toLat},${toLng}&return=summary`
              + `&apikey=${process.env.HERE_API_KEY}`;
    const res  = await fetch(url);
    const data = await res.json();
    return Math.ceil(data.routes[0].sections[0].summary.duration / 60); // minutes
  } catch {
    // Fallback to ORS duration (already real road data, just not live traffic)
    const ors = await fetchOrsRouteWithEta([fromLng, fromLat], [toLng, toLat]);
    return Math.ceil(ors.durationSec / 60);
  }
}
```

**Add to `.env`:**
```
HERE_API_KEY=your_here_maps_api_key
```

---

## 3. P0 — BACKEND AMBULANCE SIMULATOR (make GPS writes real)

### The problem

The ambulance moves only in the patient's browser tab. No DB writes. No other client sees it.

### Solution: `backend/services/ambulanceSimulator.js`

```js
// Called once per incident after POST /incidents
// Fetches real ORS route → moves ambulance along it → writes to DB → broadcasts via socket

async function simulateDispatch(io, incidentId) {
  const incident = await Incident.findById(incidentId).populate('assignedAmbulance');
  const [pLng, pLat] = incident.pickupLocation.coordinates;
  const [aLng, aLat] = incident.assignedAmbulance.location.coordinates;

  // Get real road route + duration
  const { coordinates, durationSec } = await fetchOrsRouteWithEta([aLng, aLat], [pLng, pLat]);

  // Step interval: spread total duration across all waypoints
  // e.g. 360 seconds over 90 waypoints = 4s per waypoint
  const stepMs = Math.max(2000, Math.floor((durationSec * 1000) / coordinates.length));

  let idx = 0;

  const interval = setInterval(async () => {
    if (idx >= coordinates.length) {
      clearInterval(interval);
      await arriveAtPickup(io, incident);
      return;
    }

    const [lat, lng] = coordinates[idx++];

    // Real DB write every step
    await Ambulance.findByIdAndUpdate(incident.assignedAmbulance._id, {
      location: { type: 'Point', coordinates: [lng, lat] },
      lastLocationUpdate: new Date()
    });

    // Broadcast to patient, family, dispatchers
    io.to(`incident_${incidentId}`).emit('ambulance_moved', { lat, lng });
    io.to(`share_${incident.shareToken}`).emit('ambulance_moved', { lat, lng });
    io.to('dispatchers').emit('ambulance_moved', {
      ambulanceId: incident.assignedAmbulance._id, lat, lng
    });

    // Recalculate real ETA from current position via Here Maps / ORS
    const etaMin = await getRealEta(lng, lat, pLng, pLat);
    await Incident.findByIdAndUpdate(incidentId, { estimatedArrival: etaMin });
    io.to(`incident_${incidentId}`).emit('eta_updated', { eta: etaMin });

  }, stepMs);
}

async function arriveAtPickup(io, incident) {
  await Ambulance.findByIdAndUpdate(incident.assignedAmbulance._id, { status: 'on_scene' });
  await Incident.findByIdAndUpdate(incident._id, {
    status: 'on_scene',
    arrivedAt: new Date(),
    $push: { timeline: { status: 'on_scene', description: 'Paramedics on scene', timestamp: new Date() } }
  });
  const updated = await Incident.findById(incident._id)
    .populate('assignedAmbulance').populate('assignedHospital');
  io.to(`incident_${incident._id}`).emit('incident_updated', updated);
}

// Called from PATCH /incidents/:id/hospital when patient selects hospital
async function startTransport(io, incidentId) {
  const incident = await Incident.findById(incidentId).populate('assignedAmbulance assignedHospital');
  const [pLng, pLat] = incident.pickupLocation.coordinates;
  const [hLng, hLat] = incident.assignedHospital.location.coordinates;
  const [aLng, aLat] = incident.assignedAmbulance.location.coordinates;

  await Incident.findByIdAndUpdate(incidentId, {
    status: 'transporting',
    $push: { timeline: { status: 'transporting', description: 'En route to hospital', timestamp: new Date() } }
  });

  const { coordinates, durationSec } = await fetchOrsRouteWithEta([aLng, aLat], [hLng, hLat]);
  const stepMs = Math.max(2000, Math.floor((durationSec * 1000) / coordinates.length));
  let idx = 0;

  const interval = setInterval(async () => {
    if (idx >= coordinates.length) {
      clearInterval(interval);
      await completeIncident(io, incident);
      return;
    }
    const [lat, lng] = coordinates[idx++];
    await Ambulance.findByIdAndUpdate(incident.assignedAmbulance._id, {
      location: { type: 'Point', coordinates: [lng, lat] }
    });
    io.to(`incident_${incidentId}`).emit('ambulance_moved', { lat, lng });
    io.to(`share_${incident.shareToken}`).emit('ambulance_moved', { lat, lng });

    const etaMin = await getRealEta(lng, lat, hLng, hLat);
    io.to(`incident_${incidentId}`).emit('eta_updated', { eta: etaMin });
  }, stepMs);
}

async function completeIncident(io, incident) {
  const [hLng, hLat] = incident.assignedHospital.location.coordinates;
  const [pLng, pLat] = incident.pickupLocation.coordinates;
  const totalKm = haversine(pLat, pLng, hLat, hLng);

  await Incident.findByIdAndUpdate(incident._id, {
    status: 'completed',
    completedAt: new Date(),
    $push: { timeline: { status: 'completed', description: 'Patient delivered', timestamp: new Date() } }
  });
  // Decrement hospital bed count
  await Hospital.findByIdAndUpdate(incident.assignedHospital._id, {
    $inc: { availableBeds: -1, availableIcuBeds: -1 }
  });
  await Ambulance.findByIdAndUpdate(incident.assignedAmbulance._id, { status: 'available' });

  const updated = await Incident.findById(incident._id)
    .populate('assignedAmbulance').populate('assignedHospital');
  io.to(`incident_${incident._id}`).emit('incident_updated', updated);
}
```

**Wire it up in `routes/incidents.js`:**

```js
const { simulateDispatch } = require('../services/ambulanceSimulator');

router.post('/', async (req, res) => {
  // ... existing dispatch logic ...
  await incident.save();
  res.status(201).json(response);

  // Start simulation AFTER responding (non-blocking)
  simulateDispatch(req.io, incident._id).catch(console.error);
});

router.patch('/:id/hospital', async (req, res) => {
  // ... existing hospital selection logic ...
  res.json(updated);

  // Start transport phase
  startTransport(req.io, req.params.id).catch(console.error);
});
```

**Recovery on server restart:**

```js
// In server.js, after mongoose.connect():
const active = await Incident.find({ status: { $in: ['dispatched', 'transporting'] } });
active.forEach(inc => simulateDispatch(io, inc._id).catch(console.error));
```

---

### 3.1 Frontend: Remove All Simulation Code

Once the backend simulator is live, delete from `js/track.js`:
- `startSimulation()` function
- `ambRoutePoints`, `ambRouteIdx`, `simInterval` variables
- The `setInterval` block that moves the marker

The frontend becomes a pure event display layer:
- `ambulance_moved` → `ambulanceMarker.setLatLng([lat, lng])`
- `eta_updated` → update ETA display
- `incident_updated` → `renderIncident(incident)`

---

## 4. P1 — COMPLETE THE EXISTING SCREENS

### 4.1 Patient Details Form → Backend

**New endpoint:** `PATCH /api/incidents/:id/patient`

```js
router.patch('/:id/patient', async (req, res) => {
  const { name, age, bloodType, allergies, conditions, medications } = req.body;
  const incident = await Incident.findByIdAndUpdate(req.params.id, {
    'patient.name': name, 'patient.age': age,
    'patient.bloodType': bloodType, 'patient.allergies': allergies,
    'patient.conditions': conditions, 'patient.medications': medications,
  }, { new: true }).populate('assignedAmbulance assignedHospital');

  req.io.to(`incident_${req.params.id}`).emit('patient_updated', incident.patient);
  res.json(incident);
});
```

**Add to `Incident.js` patient subdoc:**
```js
patient: {
  name: String, phone: String, userId: ObjectId,
  age: Number,
  bloodType: { type: String, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'] },
  allergies: [String],
  conditions: [String],
  medications: [String]
}
```

**Frontend:** wire the "Analyse Symptoms & Get First Aid Tips" button in `track.js` to first `PATCH /incidents/:id/patient` then call `POST /symptoms/patient-risk`.

---

### 4.2 AI Patient Risk Score from Form Data

After the patient form is submitted, run Gemini analysis.

**New endpoint:** `POST /api/symptoms/patient-risk`

```js
router.post('/patient-risk', async (req, res) => {
  const { age, conditions, medications, allergies, caseType, severity, ambulanceType } = req.body;

  const prompt = `You are an emergency triage AI. Analyse this patient.
Age: ${age || 'unknown'}
Emergency case: ${caseType}
Severity: ${severity}
Ambulance type: ${ambulanceType}
Pre-existing conditions: ${conditions?.join(', ') || 'none'}
Current medications: ${medications?.join(', ') || 'none'}
Allergies: ${allergies?.join(', ') || 'none'}

Return ONLY JSON:
{
  "riskScore": 85,
  "riskLevel": "High",
  "riskFactors": ["age > 65", "hypertension", "beta-blocker interaction risk"],
  "immediateAlerts": ["Do NOT administer adrenaline — known allergy", "Anticoagulant on board — avoid aspirin"],
  "paramedicBriefing": "2-3 sentence briefing the paramedic should hear before arrival.",
  "recommendedUpgrade": null
}

riskScore: 0-100. riskLevel: Low/Medium/High/Critical.
recommendedUpgrade: null or "ICU" or "ALS" if current ambulance type is insufficient.`;

  const result = await callGemini(prompt);
  const parsed  = JSON.parse(result.replace(/```json|```/g, '').trim());
  res.json(parsed);
});
```

**Frontend UI in sidebar (track.js):**

```
+----------------------------------+
| PATIENT RISK SCORE               |
| ████████████████████░░ 85/100    |
| CRITICAL                         |
|                                  |
| Risk Factors:                    |
| • Age > 65  • Hypertension       |
| • Beta-blocker interaction       |
|                                  |
| ALERTS FOR PARAMEDIC:            |
| ⚠ Do NOT give adrenaline        |
| ⚠ Anticoagulant on board        |
|                                  |
| Paramedic Brief:                 |
| "Elderly male, cardiac history,  |
|  onset 20min, diaphoretic..."    |
+----------------------------------+
```

Also emit risk score via socket so the dispatch portal sees it in real time.

---

### 4.3 share.html — Family Tracking View

```js
// js/share.js
const token = new URLSearchParams(location.search).get('token');
socket.emit('join_share', token);
socket.on('incident_updated', renderReadOnlyView);
socket.on('ambulance_moved', ({ lat, lng }) => ambulanceMarker.setLatLng([lat, lng]));
socket.on('eta_updated', ({ eta }) => updateEta(eta));
```

**What it shows (read-only):**
- Full-screen map with ambulance position + route
- "Help is on the way to [Address]" hero text
- Live ETA from socket
- Status timeline
- Hospital name once selected
- Paramedic unit ID

No forms, no buttons, no patient data. Shareable URL: `pran.app/share.html?token=uuid`

---

### 4.4 summary.html — Billing + Trip Summary

Reads from `GET /api/incidents/:id` — all data already exists.

**Sections:**
1. Trip Stats — total distance (real ORS distance), response time, total duration, ambulance type
2. Billing breakdown — base fare, distance fare, emergency surcharge, paramedic fee, 5% GST, total
3. Timeline — each status step with timestamp
4. Hospital delivered to — name, address, contact
5. Crew — paramedic + EMT names, unit ID
6. Print/PDF button — `window.print()` with `@media print` CSS

---

## 5. P1 — WHATSAPP CALL INTEGRATION

### The approach

No Twilio, no paid APIs. Use WhatsApp deep links to open a call or chat directly. This works on mobile and desktop WhatsApp Web.

**Opening a WhatsApp call:**
```js
// wa.me deep link with phone number
// Opens WhatsApp and initiates a call to that number
function callViaWhatsApp(phoneNumber) {
  // phoneNumber must be in international format without + or spaces
  // e.g. "+91 98765 43210" → "919876543210"
  const clean = phoneNumber.replace(/[^0-9]/g, '');
  window.open(`https://wa.me/${clean}`, '_blank');
}
```

When the patient taps "Call Crew" in the track page:
```js
document.getElementById('callAmbBtn').addEventListener('click', () => {
  // Get paramedic phone from incident data
  const phone = incidentData?.assignedAmbulance?.crew?.[0]?.phone;
  if (phone) {
    callViaWhatsApp(phone);
  } else {
    // Fallback: open tel: link for native phone dialer
    window.location.href = `tel:108`;
  }
});
```

**For the incoming call overlay (paramedic calling patient):**
The "Emily Dayton is calling" overlay currently just shows/hides a div. When accepted:
```js
function acceptCall() {
  dismissCall();
  // Open WhatsApp with the paramedic's number
  const phone = incidentData?.assignedAmbulance?.crew?.find(c => c.role === 'Paramedic')?.phone;
  if (phone) callViaWhatsApp(phone);
}
```

**For the dispatch portal calling a patient:**
```js
// Dispatcher clicks "Call Patient" button
function callPatient(incident) {
  const phone = incident.patient.phone.replace(/[^0-9]/g, '');
  window.open(`https://wa.me/${phone}?text=Your%20paramedic%20is%20en%20route`, '_blank');
}
```

**Add phone numbers to seed data:**
```js
// In seed.js ambulanceDefs, add phone to each crew member:
crew: [
  { name: 'Dr. Kavita Joshi', role: 'Paramedic', phone: '+919876500001' },
  { name: 'Vijay Singh',       role: 'Driver',    phone: '+919876500002' }
]
```

**Add to Ambulance crew schema:**
```js
crew: [{
  name:  String,
  role:  String,
  phone: String   // add this field
}]
```

**Send a WhatsApp notification when ambulance is dispatched:**
```js
// After incident is created, open WhatsApp to send patient a message
// This runs on the frontend, not backend — no API key needed
function notifyPatientViaWhatsApp(patientPhone, unitId, etaMin, paramedicName) {
  const msg = `Your Pran ambulance ${unitId} has been dispatched. ETA: ${etaMin} min. Paramedic: ${paramedicName}. Track live: ${window.location.origin}/share.html?token=${shareToken}`;
  const clean = patientPhone.replace(/[^0-9]/g, '');
  window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, '_blank');
}
```

This opens WhatsApp Web with the message pre-filled — the user just hits Send. No API key, no backend, works immediately.

---

## 6. P1 — CALL TRANSCRIPT / NOTES AI ANALYSIS

After the paramedic call ends, paramedic types their assessment. AI extracts structured medical data.

**Endpoint:** `POST /api/symptoms/call-analysis`

```js
const prompt = `Emergency call notes from paramedic:
"${notes}"

Patient context: age ${age}, ambulance type: ${ambulanceType}, case: ${caseType}

Return ONLY JSON:
{
  "extractedSymptoms": ["crushing chest pain", "radiating to left arm"],
  "onset": "20 minutes ago",
  "urgencyChange": "escalate",
  "recommendedAmbulanceType": "ICU",
  "newRiskScore": 92,
  "clinicalFlags": ["STEMI suspected", "Onset < 30 minutes — within thrombolysis window"],
  "drugContraindications": ["aspirin — on warfarin"],
  "suggestedProtocol": "Activate cath lab at destination. 12-lead ECG en route.",
  "summary": "Acute MI presentation with < 30min onset. Cath lab activation recommended."
}`;
```

**Auto-actions:**
- If `urgencyChange === 'escalate'` → emit `escalation_alert` to dispatchers room
- If `recommendedAmbulanceType` differs from current → emit `upgrade_recommended` to patient + dispatch
- Save `clinicalFlags` to incident → visible in dispatch portal as red alert badge

---

## 7. P2 — DISPATCH PORTAL

**File: `frontend/dispatch.html`**

This is a second screen showing what a real dispatcher sees. Essential for demo impact.

### Layout
- **Left column:** live incident list — each row shows patient name, case type, status badge, ETA, ambulance unit
- **Center:** full-screen map — all ambulances as colored dots moving in real time, all active routes drawn
- **Right panel:** selected incident detail — patient info, AI risk score, clinical flags, hospital

### Real-time feeds (socket)
```js
socket.emit('join_dispatch');
socket.on('new_incident',      incident  => addIncidentCard(incident));
socket.on('incident_updated',  incident  => updateIncidentCard(incident));
socket.on('ambulance_moved',  ({ ambulanceId, lat, lng }) => moveMarker(ambulanceId, lat, lng));
socket.on('escalation_alert',  incident  => showEscalationBanner(incident));
```

### Top stats bar
```
[ Active: 3 ]  [ Available units: 14 ]  [ Avg ETA: 6.2 min ]  [ ICU: 2 of 5 ]
```

### Manual override
- Reassign ambulance → `PATCH /incidents/:id/reassign`
- Force status update → `PATCH /incidents/:id/status`
- Add paramedic note → `POST /incidents/:id/notes`
- Cancel incident → `PATCH /incidents/:id/cancel`

---

## 8. P2 — HOSPITAL PORTAL

**File: `frontend/hospital.html`**

Login by selecting a hospital from a dropdown (demo mode, no auth).

### Features
- **Incoming alert banner** — appears when ambulance selects this hospital as destination
  - Shows: case type, ETA, patient risk score, AI clinical flags, ambulance type + crew
  - Buttons: "Accept Patient" / "Redirect to Another Hospital"
- **Live ambulance on map** — just the distance remaining
- **Bed management panel** — current occupancy, decrement/increment manually
- **Patient handover form** — pre-filled from AI-extracted data, editable before acceptance

### Backend
```js
// In startTransport() in ambulanceSimulator.js, after hospital is selected:
io.to(`hospital_${hospitalId}`).emit('incoming_patient', {
  incidentId, eta: etaMin, caseType, severity,
  riskScore, clinicalFlags, ambulanceType,
  crew: incident.assignedAmbulance.crew,
  patient: { age, bloodType, allergies, conditions }
});
```

### Hospital reject → auto reroute
```js
// PATCH /api/incidents/:id/hospital-response { accepted: false }
// Backend: recalculate hospital suggestions excluding rejected hospital
// Pick suggestion[1], update assignedHospital, restart transport simulation to new hospital
// Emit incident_updated to patient
```

---

## 9. P2 — LIVE BED COUNT UPDATE

```js
// In completeIncident() in ambulanceSimulator.js (already shown in section 3):
await Hospital.findByIdAndUpdate(incident.assignedHospital._id, {
  $inc: { availableBeds: -1, availableIcuBeds: -1 }
});
// Emit to hospital portal and all dispatchers
io.to(`hospital_${incident.assignedHospital._id}`).emit('beds_updated');
io.to('dispatchers').emit('beds_updated', { hospitalId: incident.assignedHospital._id });
```

This means hospital scoring in `getHospitalSuggestions()` is now live — a hospital that fills up mid-incident drops in the ranking for the next patient.

---

## 10. P3 — AI ROUTE DANGER SCORING

After ORS returns the route, score it for hazards using Gemini.

**Endpoint:** `POST /api/incidents/:id/route-analysis`

```js
const prompt = `Ambulance route:
Distance: ${distKm} km, ETA: ${etaMin} min, Time: ${hour}:${minute}
City: Jaipur, India. Emergency type: ${caseType}.

Return ONLY JSON:
{
  "dangerScore": 35,
  "trafficStatus": "moderate",
  "risks": ["school zone active 8–10am", "railway crossing at 2.1 km"],
  "recommendation": "Use NH-48 bypass — 1.2 min longer but avoids school zone",
  "alternativeEtaMin": 8
}`;
```

Show in track sidebar as a "Route Status" pill: green (clear) / yellow (moderate) / red (heavy).

---

## 11. P3 — USER AUTH (Demo-Safe OTP)

```js
// POST /api/auth/request-otp — generates 6-digit code, logs to console for demo
// POST /api/auth/verify-otp  — returns JWT stored in localStorage
// For demo: pre-seed Amrisha's account, auto-fill OTP as 123456
```

Replace all `patientName: 'Amrisha'` hardcodes with `Session.getUser().name`.

---

## 12. P3 — WEB PUSH NOTIFICATIONS (PWA)

Alert the patient on status changes even if browser tab is closed.

```js
// service worker sw.js
self.addEventListener('push', e => {
  const d = e.data.json();
  self.registration.showNotification('Pran Emergency', {
    body: d.message, icon: '/icon.png', vibrate: [200, 100, 200]
  });
});
```

Send from backend on key status changes using `web-push` npm package (free, no API key — uses VAPID keys you generate yourself):
```
npx web-push generate-vapid-keys
```

---

## 13. HACKATHON DEMO SEQUENCE (5 minutes)

1. **Home page** — live ambulance dots on map, colored by type
2. **Symptom checker** — Chest/Heart → 3 symptoms → Gemini returns ICU + 5 first aid tips
3. **Apply** — auto-fills ambulance type ICU, severity Critical, case Cardiac
4. **Dispatch** — Find Ambulance → ORS Matrix runs across 8 candidates, picks closest ICU with real road ETA
5. **Track page** — split layout, ambulance moves in real-time along actual ORS road (not a straight line)
6. **ETA** — recalculates every 4 seconds from Here Maps real traffic data
7. **Patient form** — fill age 68, condition "hypertension", medication "warfarin" → Analyse → AI risk score 91/Critical, alert: "Do NOT give aspirin — on warfarin"
8. **Risk score** — simultaneously appears on the open Dispatch portal tab
9. **Ambulance arrives** — status auto-transitions to On Scene, "incoming call from paramedic" overlay appears
10. **WhatsApp call** — press Accept → WhatsApp opens with paramedic's number pre-dialled
11. **Post-call notes** — type "patient diaphoretic, crushing pain L arm, onset 25 min" → Analyse → AI flags STEMI, suggests cath lab activation, escalation alert fires on dispatch portal
12. **Hospital select** — click Fortis Escorts (Recommended, 5min, Cardiac ICU) → map reroutes to actual road
13. **Hospital portal** (third tab) — incoming patient alert fires, shows risk score + STEMI flag, cath lab alert
14. **Complete** — ambulance arrives at hospital, Fortis bed count decrements, summary screen with billing receipt

---

## 14. ENVIRONMENT VARIABLES (complete set)

```
PORT=3001
MONGODB_URI=mongodb+srv://amrishacodes:...@pran0.vj0nifn.mongodb.net/
CLIENT_URL=http://127.0.0.1:5500
ORS_API_KEY=5b3ce3597851110001cf62485eb83b6eeaab45eea4bc48b4b7e86b54
GEMINI_API_KEY=your_key_from_aistudio_google_com

# Add for real ETA
HERE_API_KEY=your_here_maps_key   # signup: developer.here.com (free, no card)

# Optional: Google Maps (alternative to Here)
# GOOGLE_MAPS_KEY=your_key        # $200/month free credit

# Add for web push notifications
VAPID_PUBLIC_KEY=                 # generate: npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=                # generated alongside above
VAPID_EMAIL=mailto:you@email.com
```

---

## 15. API RATE LIMITS REFERENCE

| API | Free Limit | Used For | Calls Per Dispatch |
|---|---|---|---|
| ORS Directions | 2,000/day, 40/min | Route polyline drawing | 1 (ambulance→pickup) + 1 (pickup→hospital) |
| ORS Matrix | 500/day, 40/min | Best ambulance selection, hospital scoring | 2 (at dispatch) |
| Here Maps Routing | 250,000/month | Live ETA recalculation per simulator step | ~20–60 per incident |
| Gemini (free tier) | Resets daily | Symptoms, risk score, call analysis, route danger | 3–4 per incident |

For a hackathon with ~30 test incidents: all within free limits.
If Here Maps hits quota → automatic fallback to ORS duration (still road-accurate, not live-traffic).

---

## 16. MONGODB INDEXES (run once or add to seed.js)

```js
await db.collection('ambulances').createIndex({ location: '2dsphere' });  // exists
await db.collection('hospitals').createIndex({ location: '2dsphere' });   // verify this exists
await db.collection('incidents').createIndex({ status: 1, createdAt: -1 });
await db.collection('incidents').createIndex({ shareToken: 1 }, { unique: true });
await db.collection('incidents').createIndex({ 'patient.userId': 1 });
```

---

## 17. FILE CREATION ORDER

```
Sprint 1 — Real backend
  backend/services/ambulanceSimulator.js  ← GPS loop, real DB writes, status transitions
  backend/routes/incidents.js             ← wire simulateDispatch() + startTransport()
  backend/routes/symptoms.js             ← add /patient-risk and /call-analysis
  frontend/js/track.js                   ← remove simulation, pure socket display

Sprint 2 — Complete screens
  frontend/track.html + track.js         ← patient form submit + risk score UI + WhatsApp call
  frontend/share.html + js/share.js      ← read-only family live view
  frontend/summary.html + js/summary.js ← billing + timeline + print

Sprint 3 — Multi-portal
  frontend/dispatch.html + js/dispatch.js ← dispatcher map + incident list + escalation alerts
  frontend/hospital.html + js/hospital.js ← incoming patient alert + bed management
  backend/socket/handlers.js             ← escalation_alert, upgrade_recommended events

Sprint 4 — Polish
  Add phone field to crew schema + re-seed
  Replace hardcoded "Amrisha" with session user everywhere
  frontend/sw.js                         ← web push service worker
  backend/routes/auth.js                 ← OTP auth
```

---

## 18. JUDGING CRITERIA COVERAGE

| Criterion | How Pran covers it |
|---|---|
| **Technical Complexity** | ORS Matrix multi-ambulance selection, Here Maps live-traffic ETA, Gemini multi-model chain, WebSocket rooms, MongoDB geospatial 2dsphere queries |
| **Real-time** | Socket.io broadcasts: GPS position, ETA recalculation, status transitions, risk score, escalation alerts — all live across 4 portals simultaneously |
| **AI Usage** | Symptom triage, patient risk scoring, call note analysis, route danger scoring — all via Gemini, all returning structured JSON with auto-actions |
| **Completeness** | Patient portal, family share, dispatch, hospital — 4 portals, 1 backend, 1 DB |
| **UX / Design** | Split track screen, ORS road route, WhatsApp call, risk score card, km pill overlay, incoming call overlay |
| **Social Impact** | Emergency golden hour: real ETA from live traffic, AI drug contraindication alerts, STEMI cath lab flag — clinically meaningful |
| **Demo Impact** | 3 browser tabs showing same real-time data: patient sees ambulance move, dispatch sees escalation alert, hospital sees incoming patient — all simultaneously |
