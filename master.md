# PRAN — Master Technical Implementation Prompt
## Full-Stack Emergency Ambulance Dispatch System (Patient Portal)

---

## CONTEXT & OVERVIEW

You are building **Pran** — a premium, real-time emergency ambulance dispatch web application. The patient-facing portal has 4 screens already designed as static HTML files in `/pran/`. Your job is to make every element **fully dynamic, real-time, and functionally complete** by wiring up a Node.js/Express backend, MongoDB database, Socket.io for live updates, and Leaflet.js with OpenRouteService for live map routing.

The system has 3 portals total (patient, dispatch operator, hospital) but you are currently building only the **patient portal**. However, all backend data models and API routes must be architected to serve all 3 portals — dispatch and hospital portals will be connected later using the same backend.

Do NOT regenerate the UI. Only add JavaScript logic, API connections, Socket.io listeners, and dynamic DOM manipulation to the existing HTML files.

---

## TECH STACK — DEFINE EVERYTHING EXPLICITLY

### Frontend (existing HTML files — add JS only)
- **Leaflet.js v1.9.4** — all map rendering, markers, polylines, route drawing
- **OpenRouteService API** (free tier) — route calculation between two lat/lng coordinates, returns GeoJSON polyline. API key stored in `.env`
- **Socket.io client v4.x** — real-time ambulance position updates, ETA changes, status changes
- **Vanilla JS (ES6+)** — no React, no framework. Use `fetch()` for all API calls, async/await throughout
- **CSS animations already in HTML** — do not touch CSS, only add JS behavior

### Backend
- **Node.js v20+ with Express.js** — REST API server
- **Socket.io server v4.x** — real-time bidirectional communication
- **MongoDB Atlas (free tier)** — cloud database, 3 collections: `emergencies`, `ambulances`, `hospitals`
- **Mongoose v8** — schema definition and ODM
- **dotenv** — environment variable management
- **cors** — allow frontend HTML files to call the API
- **express-validator** — input validation on all POST routes
- **node-cron** — scheduled job to simulate ambulance GPS position updates every 3 seconds during active incidents

### Maps & Routing
- **Leaflet.js** — renders the map in the browser using OpenStreetMap tiles (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
- **OpenRouteService Directions API** — `POST https://api.openrouteservice.org/v2/directions/driving-car/geojson` with body `{ coordinates: [[lng1,lat1],[lng2,lat2]] }`. Returns GeoJSON FeatureCollection. Draw the `geometry.coordinates` as a Leaflet polyline
- **Browser Geolocation API** — `navigator.geolocation.getCurrentPosition()` to get patient lat/lng on page load
- **Haversine formula** — calculate straight-line distance between patient and each ambulance/hospital to rank closest options before calling ORS

### Deployment (local for hackathon)
- Backend runs on `http://localhost:3001`
- Frontend HTML files served as static files via Express or opened directly via `file://`
- MongoDB: use local MongoDB or MongoDB Atlas free cluster
- All secrets in `.env`: `MONGODB_URI`, `ORS_API_KEY`, `PORT=3001`, `SOCKET_PORT=3001`

---

## PART 1 — PROJECT STRUCTURE

Create this exact folder structure:

```
/pran/
├── index.html              (Screen 1 — Emergency Home)
├── track.html              (Screen 2 — Confirmation & Tracking, split layout)
├── share.html              (Screen 3 — Family Share View)
├── summary.html            (Screen 4 — Post Incident Summary)
├── js/
│   ├── home.js             (all JS for index.html)
│   ├── track.js            (all JS for track.html)
│   ├── share.js            (all JS for share.html)
│   ├── summary.js          (all JS for summary.html)
│   └── common.js           (shared utils: haversine, formatTime, getEmergencyId from URL)
├── server/
│   ├── server.js           (Express + Socket.io entry point)
│   ├── .env
│   ├── package.json
│   ├── models/
│   │   ├── Emergency.js    (Mongoose schema)
│   │   ├── Ambulance.js    (Mongoose schema)
│   │   └── Hospital.js     (Mongoose schema)
│   ├── routes/
│   │   ├── emergencyRoutes.js
│   │   ├── ambulanceRoutes.js
│   │   └── hospitalRoutes.js
│   ├── services/
│   │   ├── dispatchEngine.js   (finds best ambulance + hospital for a request)
│   │   ├── routingService.js   (calls OpenRouteService API)
│   │   └── simulationService.js (moves ambulance along route for demo)
│   └── seed/
│       ├── seedHospitals.js
│       └── seedAmbulances.js
```

---

## PART 2 — DATABASE SCHEMAS (Mongoose)

### 2A. Hospital Schema (`/server/models/Hospital.js`)

```js
const HospitalSchema = new Schema({
  name: { type: String, required: true },
  address: { type: String, required: true },
  phone: { type: String, required: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [lng, lat]
  },
  specialties: [{ type: String }], // e.g. ['Cardiac', 'Trauma', 'Neuro', 'Burns', 'Pediatric', 'Orthopedic']
  rating: { type: Number, min: 1, max: 5 },
  reviewCount: { type: Number, default: 0 },
  beds: {
    general: { type: Number, default: 0 },
    icu: { type: Number, default: 0 },
    emergency: { type: Number, default: 0 },
    neonatal: { type: Number, default: 0 }
  },
  costRange: { type: String, enum: ['$', '$$', '$$$'], default: '$$' },
  costEstimate: { min: Number, max: Number }, // in INR e.g. { min: 8000, max: 15000 }
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
HospitalSchema.index({ location: '2dsphere' }); // required for geospatial queries
```

**Geospatial index is mandatory** — add `HospitalSchema.index({ location: '2dsphere' })` before exporting. This enables MongoDB's `$near` and `$geoNear` operators to find closest hospitals by real coordinates.

### 2B. Ambulance Schema (`/server/models/Ambulance.js`)

```js
const AmbulanceSchema = new Schema({
  vehicleNumber: { type: String, required: true, unique: true }, // e.g. 'RJ-14-AMB-001'
  type: { type: String, enum: ['BLS', 'ALS', 'ICU', 'Neonatal'], required: true },
  driver: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    photo: { type: String } // URL to avatar image
  },
  paramedic: {
    name: { type: String },
    phone: { type: String }
  },
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [lng, lat] — updated live
  },
  status: {
    type: String,
    enum: ['available', 'dispatched', 'on_scene', 'transporting', 'at_hospital', 'returning'],
    default: 'available'
  },
  currentEmergencyId: { type: Schema.Types.ObjectId, ref: 'Emergency', default: null },
  isActive: { type: Boolean, default: true },
  lastUpdated: { type: Date, default: Date.now }
});
AmbulanceSchema.index({ currentLocation: '2dsphere' });
```

**Status lifecycle**: `available → dispatched → on_scene → transporting → at_hospital → returning → available`. Each transition emits a Socket.io event.

### 2C. Emergency Schema (`/server/models/Emergency.js`)

```js
const EmergencySchema = new Schema({
  // Patient info
  patient: {
    name: { type: String },
    age: { type: Number },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    phone: { type: String },
    conditions: [{ type: String }], // ['Diabetes', 'Hypertension', etc.]
    vitals: {
      bloodPressure: { type: String }, // '120/80'
      heartRate: { type: Number },
      spo2: { type: Number }
    },
    conditionDescription: { type: String }
  },
  // Request details
  requestType: { type: String, enum: ['SOS', 'CONFIGURED'], required: true },
  ambulanceType: { type: String, enum: ['BLS', 'ALS', 'ICU', 'Neonatal'] },
  severity: { type: String, enum: ['High', 'Medium', 'Low'], default: 'High' },
  caseType: { type: String }, // 'Cardiac Arrest', 'Stroke', etc.
  // Locations
  patientLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [lng, lat]
  },
  patientAddress: { type: String },
  // Assignment
  assignedAmbulanceId: { type: Schema.Types.ObjectId, ref: 'Ambulance' },
  assignedHospitalId: { type: Schema.Types.ObjectId, ref: 'Hospital' },
  // Route
  routeToPatient: { type: Object }, // GeoJSON from ORS
  routeToHospital: { type: Object }, // GeoJSON from ORS
  distanceToPatient: { type: Number }, // in km
  distanceToHospital: { type: Number }, // in km
  // Status lifecycle
  status: {
    type: String,
    enum: ['pending', 'dispatched', 'on_scene', 'transporting', 'completed', 'cancelled'],
    default: 'pending'
  },
  statusTimeline: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    note: String
  }],
  // AI analysis
  severityScore: { type: Number, min: 0, max: 10 },
  firstAidTips: [{ type: String }],
  // Cost
  cost: {
    baseFare: Number,
    distanceCharge: Number,
    emergencySurcharge: Number,
    paramedicFee: Number,
    subtotal: Number,
    gst: Number,
    total: Number
  },
  // Sharing
  shareToken: { type: String, unique: true, sparse: true }, // random UUID for share URL
  // Timing
  requestedAt: { type: Date, default: Date.now },
  dispatchedAt: { type: Date },
  arrivedAt: { type: Date },
  completedAt: { type: Date },
  // Rating
  crewRating: { type: Number, min: 1, max: 5 },
  crewComment: { type: String }
});
EmergencySchema.index({ patientLocation: '2dsphere' });
EmergencySchema.index({ shareToken: 1 });
```

---

## PART 3 — SEED DATA GENERATION PROMPT

**Do not generate seed data inline — write a separate prompt to an LLM to generate it:**

Use this prompt with an LLM to generate realistic seed data for `/server/seed/seedHospitals.js` and `/server/seed/seedAmbulances.js`:

```
Generate realistic MongoDB seed data for a hospital and ambulance database near Jaipur, Rajasthan, India. 
Use real neighborhood names and approximate real coordinates (lat/lng) within a 15km radius of Manipal 
University Jaipur (lat: 26.8630, lng: 75.8155).

For hospitals: Generate 12 hospitals with varied specialties (Cardiac, Trauma, Neuro, Burns, Pediatric, 
Orthopedic, Multi-specialty). Each must have: name, full address, phone number, GPS coordinates [lng, lat] 
(note: MongoDB GeoJSON uses [longitude, latitude] order), specialties array, rating (3.5-5.0), beds 
object with general/icu/emergency/neonatal counts, costRange ($/$$/$$$ corresponding to government/
private/premium), costEstimate in INR (min/max), and isActive: true.

For ambulances: Generate 15 ambulances — 5 BLS, 4 ALS, 4 ICU, 2 Neonatal. Each must have: 
vehicleNumber (format RJ-14-AMB-XXX), type, driver name and phone, paramedic name, currentLocation 
coordinates scattered within 10km of the university, status: 'available', and lastUpdated: new Date().

Output as two JavaScript files using mongoose seed script format with async/await.
The seed script should: connect to MongoDB using process.env.MONGODB_URI, drop existing collection, 
insertMany with the data array, log success count, then disconnect.
Include the 2dsphere index creation inside the seed script for both collections.
```

Run seeds with: `node server/seed/seedHospitals.js && node server/seed/seedAmbulances.js`

---

## PART 4 — BACKEND API ROUTES

### 4A. Emergency Routes (`/server/routes/emergencyRoutes.js`)

**POST `/api/emergency/create`**
- Body: `{ patientLocation: {lat, lng}, patientAddress, requestType, ambulanceType, severity, caseType }`
- Logic:
  1. Use MongoDB `$near` geospatial query to find closest `available` ambulance matching requested type
  2. Use `$near` to find top 3 hospitals ranked by distance + specialty match for caseType
  3. Call OpenRouteService: get route from ambulance → patient location (save as `routeToPatient`)
  4. Calculate ETA: `(routeToPatient.features[0].properties.summary.duration / 60).toFixed(1)` minutes
  5. Create Emergency document with `status: 'pending'`, save `shareToken = uuid.v4()`
  6. Update ambulance `status: 'dispatched'`, `currentEmergencyId = emergency._id`
  7. Emit Socket.io event `emergency:created` with full emergency object
  8. Return: `{ emergencyId, ambulance, hospitals (top 3 ranked), routeToPatient, etaMinutes, shareToken }`

**POST `/api/emergency/:id/select-hospital`**
- Body: `{ hospitalId }`
- Logic:
  1. Find the emergency, find the hospital
  2. Call OpenRouteService: route from patient location → hospital (save as `routeToHospital`)
  3. Update emergency: `assignedHospitalId = hospitalId`, `routeToHospital = ...`
  4. Emit Socket.io event `emergency:hospital_selected` with new route GeoJSON
  5. On the map (track.html), redraw the route polyline from ambulance current position → patient → hospital

**POST `/api/emergency/:id/patient-details`**
- Body: full patient object (name, age, gender, conditions, vitals, conditionDescription)
- Logic:
  1. Update emergency `patient` subdocument
  2. Run AI severity scoring logic (see Part 6)
  3. Generate first aid tips array based on caseType
  4. Return: `{ severityScore, firstAidTips }`

**GET `/api/emergency/:id`**
- Returns full emergency object populated with ambulance and hospital refs

**GET `/api/emergency/share/:token`**
- Used by share.html — finds emergency by shareToken (no auth required)
- Returns: `{ patient name, status, statusTimeline, assignedAmbulance (limited fields), assignedHospital, routeToHospital, etaMinutes }`

**POST `/api/emergency/:id/complete`**
- Called by dispatch portal when ambulance arrives at hospital
- Updates status to `completed`, sets `completedAt`, calculates cost breakdown
- Cost formula: `baseFare(500) + distanceCharge(distanceKm * 25) + emergencySurcharge(by type: BLS=0, ALS=200, ICU=500, Neonatal=700) + paramedicFee(by type: BLS=150, ALS=300, ICU=600, Neonatal=800)`. GST = 5% of subtotal.
- Emit `emergency:completed` event

**POST `/api/emergency/:id/rate`**
- Body: `{ rating: 1-5, comment: string }`
- Updates `crewRating` and `crewComment`

### 4B. Hospital Routes (`/server/routes/hospitalRoutes.js`)

**GET `/api/hospitals/nearby`**
- Query params: `lat, lng, radius (default 15000 meters), specialty (optional), caseType (optional)`
- Uses MongoDB `$geoNear` aggregation:
  ```js
  Hospital.aggregate([
    { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distance', maxDistance: radius, spherical: true }},
    { $match: { isActive: true, ...(specialty ? { specialties: specialty } : {}) }},
    { $sort: { distance: 1 }},
    { $limit: 5 }
  ])
  ```
- Returns each hospital with computed `distance` and `etaMinutes` (estimated based on distance / 500m per minute)
- Also return `bedAvailability: beds.emergency > 0 ? 'Available' : beds.icu > 0 ? 'Limited' : 'Full'`

**GET `/api/hospitals/:id`**
- Full hospital details

**PATCH `/api/hospitals/:id/beds`**
- Used by hospital portal — updates bed counts in real time
- Emits `hospital:beds_updated` Socket.io event

### 4C. Ambulance Routes (`/server/routes/ambulanceRoutes.js`)

**GET `/api/ambulances/nearby`**
- Query: `lat, lng, type (optional), status=available`
- Returns nearest available ambulances with distance

**GET `/api/ambulances/:id/location`**
- Returns current `currentLocation.coordinates` of an ambulance
- Used by frontend to poll ambulance position (backup to Socket.io)

**PATCH `/api/ambulances/:id/status`**
- Updates ambulance status, triggers Socket.io `ambulance:status_changed`

---

## PART 5 — SOCKET.IO REAL-TIME EVENTS

Set up Socket.io on the same Express server (no separate port). Use `io.to(emergencyId).emit()` for room-based broadcasting so only relevant clients receive updates.

### Server-side event structure:

```js
// Client joins room when they open track.html or share.html
socket.on('join_emergency', (emergencyId) => {
  socket.join(emergencyId);
});

// Emit these events server → client:
io.to(emergencyId).emit('ambulance:location_update', {
  coordinates: [lng, lat], // ambulance current position
  etaMinutes: number,
  distanceRemaining: number // in km
});

io.to(emergencyId).emit('emergency:status_changed', {
  status: 'on_scene' | 'transporting' | 'completed',
  timestamp: Date,
  note: string
});

io.to(emergencyId).emit('emergency:hospital_selected', {
  hospital: { name, address, phone },
  routeToHospital: GeoJSON, // full ORS response geometry
  etaToHospital: number
});

io.to(emergencyId).emit('emergency:completed', {
  cost: { baseFare, distanceCharge, emergencySurcharge, paramedicFee, subtotal, gst, total },
  responseTime: string, // '6 min 42 sec'
  totalTime: string
});
```

### Ambulance Position Simulation (for demo — `/server/services/simulationService.js`):

```
When an emergency is dispatched, start a simulation loop using setInterval every 3000ms:
1. Get the routeToPatient GeoJSON coordinates array (array of [lng, lat] points along the route)
2. Maintain a pointer index starting at 0
3. Every 3 seconds, increment the pointer by 1-2 steps (simulating movement)
4. Update ambulance.currentLocation in MongoDB to the new coordinate
5. Emit 'ambulance:location_update' to the emergency's Socket.io room with new coords + recalculated ETA
6. When pointer reaches end of routeToPatient, change status to 'on_scene', emit status change
7. After 30 seconds on_scene delay, start moving along routeToHospital in same way
8. When pointer reaches end of routeToHospital, emit 'emergency:completed'
9. Clear the interval and mark ambulance as 'available'
```

---

## PART 6 — FRONTEND JAVASCRIPT, SCREEN BY SCREEN

### Screen 1 — `js/home.js` (Emergency Home)

**On page load:**
1. Initialize Leaflet map centered on Manipal University Jaipur `[26.8630, 75.8155]`, zoom 13
2. Call `navigator.geolocation.getCurrentPosition()` — on success, store lat/lng in `window.patientLocation`, update the address pill text by reverse geocoding (call Nominatim: `https://nominatim.openstreetmap.org/reverse?lat=&lon=&format=json` — free, no key needed), update "AB1 Manipal University..." text
3. Place a large red patient marker on the map at detected location
4. Fetch `/api/ambulances/nearby?lat=&lng=&status=available` — for each returned ambulance, place a colored Leaflet marker: BLS=blue circle, ALS=orange circle, ICU=pulsing red circle (add a CSS class `marker-icu-pulse` for animation), Neonatal=purple circle
5. Add popups to each marker: show `vehicleNumber`, `type`, `driver.name`, `status`

**"Find Best Ambulance & Hospital" button click:**
1. Read dropdown values: ambulanceType, severity, caseType
2. Validate: if ambulanceType not selected, shake the dropdown (CSS shake class)
3. POST `/api/emergency/create` with `{ patientLocation, patientAddress, requestType: 'CONFIGURED', ambulanceType, severity, caseType }`
4. Show loading state on button (spinner, text "Finding nearest unit…")
5. On response: store `emergencyId` and `shareToken` in `localStorage` and `sessionStorage`
6. Redirect to `track.html?id=${emergencyId}`

**SOS button click:**
1. POST `/api/emergency/create` with `{ patientLocation, requestType: 'SOS', ambulanceType: 'ICU', severity: 'High' }`
2. Show fullscreen red overlay with pulse animation while request is processing
3. On response: store emergencyId, redirect to `track.html?id=${emergencyId}`

**"Check my symptoms" button:**
1. Redirect to `symptoms.html` (create this as a bonus page — a clean white page with 7 large body-system cards: Head/Brain, Chest/Heart, Abdomen, Limbs/Bones, Breathing, Skin/Burns, Other)
2. On selecting a body system, show 3-4 follow-up questions as pill buttons
3. On completion, determine recommended ambulanceType and caseType, pre-fill them in the home screen dropdowns and redirect back to `index.html` with query params `?type=ALS&case=Cardiac+Arrest`

**On page load also:** Read URL params `?type=&case=` and pre-select the dropdowns automatically (from symptom checker redirect).

---

### Screen 2 — `js/track.js` (Confirmation + Tracking)

**On page load:**
1. Read `emergencyId` from URL param `?id=`
2. GET `/api/emergency/${emergencyId}` — populate all static fields: driver name, vehicle, ambulance type badge, hospital name (if already selected)
3. Initialize Socket.io: `const socket = io('http://localhost:3001'); socket.emit('join_emergency', emergencyId);`
4. Initialize Leaflet map (right panel, full height): draw patient marker, draw ambulance marker at its current position, draw the `routeToPatient` polyline in bold red `#E8393A`, weight 5
5. Start ETA countdown: from server-returned `etaMinutes`, count down every 60 seconds, update the large ETA number with a CSS fade animation

**Hospital cards (left panel):**
1. Hospitals are returned from the `/api/emergency/create` response as top 3 ranked — render them dynamically as cards matching the UI design
2. Mark the first one as "Recommended" with green border + badge
3. **"Select →" button click:**
   - POST `/api/emergency/${emergencyId}/select-hospital` with `{ hospitalId }`
   - Show loading spinner on the button
   - On response: receive new `routeToHospital` GeoJSON
   - Remove existing route polyline from map
   - Draw new polyline: ambulance current position → patient location → hospital location (three-point route)
   - Animate the redraw: clear old layer, add new layer with a brief flash effect (set opacity 0, then animate to 1 over 500ms)
   - Update "Transporting to" card at top of right panel with hospital name and address
   - Disable the other two hospital "Select" buttons

**Patient details form (left panel):**
1. On form submit ("Analyse & Get First Aid Tips"):
   - Collect all form values, validate required fields (name, age, gender)
   - POST `/api/emergency/${emergencyId}/patient-details`
   - Show skeleton shimmer on the response area while loading
2. On response: render the AI analysis card:
   - Draw a circular SVG gauge for severity score (0-10): use an SVG `<circle>` with `stroke-dasharray` and `stroke-dashoffset`. Color: 0-3 = `#10B981` (green), 4-6 = `#F59E0B` (amber), 7-10 = `#E8393A` (red). Animate the gauge filling from 0 to the score value over 1.2 seconds using `requestAnimationFrame`
   - Render first aid tips as numbered cards with colored icons
   - Scroll the page down smoothly to reveal the response card

**Socket.io listeners in track.js:**
```js
socket.on('ambulance:location_update', ({ coordinates, etaMinutes, distanceRemaining }) => {
  // Smoothly animate ambulance marker to new position using Leaflet's setLatLng
  ambulanceMarker.setLatLng([coordinates[1], coordinates[0]]);
  // Pan map to keep ambulance in view
  map.panTo([coordinates[1], coordinates[0]], { animate: true, duration: 1.5 });
  // Update ETA number
  document.getElementById('eta-display').textContent = Math.ceil(etaMinutes) + ' min';
  // Update distance remaining chip
  document.getElementById('distance-remaining').textContent = distanceRemaining.toFixed(1) + ' km remaining';
});

socket.on('emergency:status_changed', ({ status, timestamp, note }) => {
  // Update the status timeline steps — mark current step as active (amber pulse), previous as complete (green tick)
  updateStatusTimeline(status, timestamp, note);
  // Show a toast notification at top of page with the status change
  showToast(status === 'on_scene' ? 'Paramedics have arrived' : 'Transporting to hospital');
});

socket.on('emergency:completed', (data) => {
  // Store cost data in sessionStorage
  sessionStorage.setItem('costData', JSON.stringify(data.cost));
  sessionStorage.setItem('timingData', JSON.stringify({ responseTime: data.responseTime, totalTime: data.totalTime }));
  // Redirect to summary.html after 3 second delay with confetti or green checkmark animation
  setTimeout(() => window.location.href = 'summary.html?id=' + emergencyId, 3000);
});
```

**Paramedic calling strip:** Simulate this by triggering a CSS class after 45 seconds automatically — show the amber "Emily Dayton is calling" strip with ring animation. "Answer" button click shows a toast "Call connected" and hides the strip.

**Share link button:** Copies `${window.location.origin}/share.html?token=${shareToken}` to clipboard using `navigator.clipboard.writeText()`, shows "Link copied!" toast.

---

### Screen 3 — `js/share.js` (Family Share View)

**On page load:**
1. Read `token` from URL param `?token=`
2. GET `/api/emergency/share/${token}` — populate page with patient name in the green banner, hospital name/address/phone in the "Going to" card, ambulance current position, route GeoJSON
3. Initialize read-only Leaflet map (no click, no zoom controls): draw origin pin, hospital pin, route polyline, ambulance moving marker
4. Connect to Socket.io: join the emergencyId's room (returned from the share API), listen for `ambulance:location_update` and `emergency:status_changed`
5. Status timeline: render all completed steps as green ticks, current step as pulsing amber dot, upcoming as gray. Update in real-time via socket events

**ETA countdown:** Same countdown logic as track.js. Update every 60 seconds.

**"Share this link" button:** Copies current URL to clipboard.

**"Call ambulance driver" button:** Opens `tel:${driver.phone}` — native phone dialer.

---

### Screen 4 — `js/summary.js` (Post Incident Summary)

**On page load:**
1. GET `/api/emergency/${emergencyId}` — fetch complete emergency including cost, timing, ambulance, hospital
2. Animate the green checkmark SVG: use an SVG `<circle>` with `stroke-dashoffset` animation (draw-on effect over 0.8 seconds)
3. Populate all fields: response time, total time, driver name, vehicle, ambulance type, hospital name, hospital specialty
4. Render cost breakdown table dynamically from the cost object — all values in ₹ (Indian Rupees format using `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`)
5. Total in bold red

**Action buttons:**
- **"Download Incident Report"**: Generate a simple HTML-to-PDF using `window.print()` with a `@media print` stylesheet that hides the action buttons and navbar. Style the print view cleanly.
- **"Start Insurance Claim"**: Show a modal with fields: Insurance Provider (dropdown), Policy Number (text), upload a document (file input). Submit sends data to `/api/emergency/${id}/insurance-claim` (stub endpoint that just saves data).
- **"Rate the Crew"**: Show a modal with 5 clickable star SVG icons (filled/unfilled state toggle), optional comment textarea, and submit button. POST to `/api/emergency/${id}/rate`. Show warm thank-you message after submission.
- **"Call Hospital"**: `window.open('tel:' + hospitalPhone)`.

---

## PART 7 — DISPATCH ENGINE (`/server/services/dispatchEngine.js`)

This is the core AI logic. Implement as a standalone function `findBestMatch(patientLat, patientLng, requestedType, caseType)`:

```
Algorithm:
1. FIND NEAREST AMBULANCE:
   - Query MongoDB for ambulances where status='available' and type=requestedType (or any type if SOS)
   - Use $geoNear with patient coordinates
   - Pick the closest available one
   - If none available of requested type, fall back to next best type in order: ICU > ALS > BLS

2. FIND TOP 3 HOSPITALS:
   - Map caseType to specialty: 
     'Cardiac Arrest' → 'Cardiac'
     'Stroke / Neuro' → 'Neuro'  
     'Burns' → 'Burns'
     'Pediatric' → 'Pediatric'
     'Bone Fracture' → 'Orthopedic'
     All others → 'Trauma' or 'Multi-specialty'
   - Query hospitals: $geoNear sorted by distance, filtered by matching specialty first
   - Score each hospital: score = (5 - distanceKm * 0.3) + (rating * 0.5) + (beds.emergency > 0 ? 2 : 0)
   - Sort by score descending, return top 3
   - First result = recommended hospital

3. GENERATE SEVERITY SCORE (for patient details submission):
   - Base score from severity param: High=7, Medium=4, Low=2
   - Add points: age > 60 = +1, age < 5 = +1
   - Conditions: Diabetes = +0.5, Hypertension = +0.5, Heart Disease = +1
   - Case type: Cardiac Arrest = +2, Stroke = +1.5, Burns = +1
   - SpO2 < 94 = +2, SpO2 94-96 = +1
   - Heart Rate > 120 or < 50 = +1
   - Clamp result to 0-10 range
   - Return as `severityScore`

4. GENERATE FIRST AID TIPS (array of strings based on caseType):
   - Cardiac Arrest: ["Keep patient lying flat on a firm surface", "Do not give food or water", "Begin CPR if patient is unresponsive — 30 chest compressions, 2 rescue breaths", "Do not move patient unless in immediate danger", "Loosen tight clothing around chest and neck"]
   - Stroke: ["Keep patient calm and still", "Do not give anything by mouth", "Note exact time symptoms started", "Keep head slightly elevated", "Do not give aspirin unless prescribed"]
   - Bone Fracture: ["Immobilize the injured limb — do not attempt to realign", "Apply gentle pressure with cloth if bleeding", "Do not remove any embedded objects", "Keep patient warm and calm"]
   - Breathing: ["Sit patient upright or in position of comfort", "Loosen tight clothing", "If inhaler available, assist patient in using it", "Do not lay flat if difficulty breathing"]
   - Burns: ["Cool burn with running water for 10 minutes — not ice", "Do not apply butter, toothpaste, or oils", "Cover loosely with clean cloth", "Do not burst any blisters"]
   - Default: ["Keep patient calm and comfortable", "Do not give food or water", "Monitor breathing", "Stay with patient until paramedics arrive"]
```

---

## PART 8 — ROUTING SERVICE (`/server/services/routingService.js`)

```js
async function getRoute(fromLng, fromLat, toLng, toLat) {
  const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.ORS_API_KEY
    },
    body: JSON.stringify({
      coordinates: [[fromLng, fromLat], [toLng, toLat]]
    })
  });
  const data = await response.json();
  return {
    geojson: data,
    durationSeconds: data.features[0].properties.summary.duration,
    distanceMeters: data.features[0].properties.summary.distance,
    coordinates: data.features[0].geometry.coordinates // array of [lng, lat] points
  };
}
```

**Error handling:** If ORS API fails (rate limit or network error), fall back to a straight-line polyline between the two points and estimate ETA as `(haversineDistance / 0.5)` minutes (assuming 30km/h average speed in city).

---

## PART 9 — COMMON UTILITIES (`/js/common.js`)

```js
// Haversine formula — returns distance in km
function haversineDistance(lat1, lng1, lat2, lng2) { ... }

// Format duration in seconds to 'X min Y sec'
function formatDuration(seconds) { ... }

// Get URL query param
function getParam(name) { return new URLSearchParams(window.location.search).get(name); }

// Show toast notification
function showToast(message, type = 'info') {
  // Create a pill div, append to body, auto-remove after 3 seconds
  // type: 'info' = dark, 'success' = green, 'warning' = amber, 'error' = red
}

// Copy to clipboard with fallback
async function copyToClipboard(text) { ... }

// Format INR currency
function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
}

// Smooth number animation (for ETA countdown, severity score)
function animateNumber(element, from, to, durationMs) { ... }
```

---

## PART 10 — ADDITIONAL DYNAMIC FEATURES TO ADD

Beyond what's already in the UI design, implement these enhancements:

1. **Offline detection banner:** `window.addEventListener('offline', ...)` — show a red top banner "You appear to be offline. Emergency request may not go through." with a retry button.

2. **Location permission error handling:** If `navigator.geolocation` is denied, show a red banner "Location access denied. Please enable location or type your address." and show a text input for manual address entry. Use Nominatim forward geocoding to convert address to lat/lng: `https://nominatim.openstreetmap.org/search?q=&format=json&limit=1`.

3. **Auto-refresh ambulance markers:** On the home screen, refresh ambulance markers every 15 seconds by re-fetching `/api/ambulances/nearby`. Animate markers smoothly to their new positions.

4. **ETA recalculation:** Every time `ambulance:location_update` fires, recalculate ETA as `(distanceRemaining / 0.5)` minutes (30km/h city speed) and smoothly animate the number change.

5. **Heartbeat ping:** Send a keep-alive ping from the frontend every 30 seconds to prevent Socket.io disconnection: `socket.emit('ping')`. Server responds with `socket.on('ping', () => socket.emit('pong'))`.

6. **Multiple hospital rerouting animation:** When user selects a different hospital after already selecting one, show a brief "Recalculating route..." spinner overlay on the map for 1.5 seconds while the new ORS route is fetched, then smoothly redraw.

7. **Status timeline auto-scroll:** When a new step in the status timeline becomes active, smoothly scroll the timeline container to keep it visible.

8. **Progressive Web App basics:** Add a `<link rel="manifest">` and basic `manifest.json` so the site can be added to home screen. Add a Service Worker that caches the map tiles for offline use.

9. **Ambulance type badge colors in track view:** Dynamically set the badge color: BLS=`#3B82F6` (blue), ALS=`#F97316` (orange), ICU=`#E8393A` (red), Neonatal=`#8B5CF6` (purple).

10. **Estimated cost preview on hospital card:** Show estimated cost range from hospital data as ₹8,000–₹15,000 on each hospital selection card. Update when user selects different hospitals.

---

## PART 11 — IMPLEMENTATION ORDER

Work in this exact sequence to avoid dependency issues:

```
Phase 1 — Backend foundation (do this first, test with Postman before touching frontend)
  Step 1: Set up server.js with Express + Socket.io + MongoDB connection + CORS
  Step 2: Create all 3 Mongoose models (Emergency, Ambulance, Hospital)
  Step 3: Run seed scripts to populate the database
  Step 4: Implement hospitalRoutes.js — test GET /api/hospitals/nearby
  Step 5: Implement ambulanceRoutes.js — test GET /api/ambulances/nearby
  Step 6: Implement dispatchEngine.js and routingService.js
  Step 7: Implement emergencyRoutes.js — test POST /api/emergency/create end-to-end
  Step 8: Implement simulationService.js — test that ambulance moves via Socket.io

Phase 2 — Home screen (index.html + home.js)
  Step 9: Geolocation + Leaflet map + ambulance markers
  Step 10: "Find Best Ambulance" button → API call → redirect to track.html
  Step 11: SOS button flow
  Step 12: Symptom checker page (symptoms.html)

Phase 3 — Track screen (track.html + track.js)
  Step 13: Load emergency data + map with route polyline
  Step 14: Hospital selection cards + rerouting
  Step 15: Patient details form + AI analysis card
  Step 16: Socket.io listeners — ambulance movement animation
  Step 17: Status timeline updates

Phase 4 — Share + Summary screens
  Step 18: share.html — read-only tracking via shareToken
  Step 19: summary.html — cost display + PDF download + rating modal

Phase 5 — Polish
  Step 20: Error handling + offline detection + loading states
  Step 21: Toast notifications system
  Step 22: PWA manifest
```

---

## PART 12 — SERVER.JS SKELETON

```js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import emergencyRoutes from './routes/emergencyRoutes.js';
import ambulanceRoutes from './routes/ambulanceRoutes.js';
import hospitalRoutes from './routes/hospitalRoutes.js';

dotenv.config();
const app = express();
const httpServer = createServer(app);
export const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('../')); // serve the HTML files from /pran root

app.use('/api/emergency', emergencyRoutes);
app.use('/api/ambulances', ambulanceRoutes);
app.use('/api/hospitals', hospitalRoutes);

io.on('connection', (socket) => {
  socket.on('join_emergency', (emergencyId) => socket.join(emergencyId));
  socket.on('ping', () => socket.emit('pong'));
});

mongoose.connect(process.env.MONGODB_URI).then(() => {
  httpServer.listen(process.env.PORT || 3001, () => {
    console.log(`Pran server running on port ${process.env.PORT || 3001}`);
  });
});
```

---

## NOTES FOR THE LLM IMPLEMENTING THIS

- **Never regenerate the HTML/CSS.** Only add `<script src="js/home.js"></script>` tags at the bottom of each HTML file and write the JS files.
- **Use IDs already present in the HTML** for all `document.getElementById()` calls. If an ID is missing from the HTML, add only a minimal `id=""` attribute to the element — do not change structure or styles.
- **All Leaflet maps must use OpenStreetMap tiles** — `L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' })`.
- **ORS API coordinates are [longitude, latitude]** — not lat/lng. MongoDB GeoJSON is also [lng, lat]. Leaflet is [lat, lng]. Be explicit about this conversion everywhere.
- **Socket.io must use room-based messaging** — never `io.emit()` globally. Always `io.to(emergencyId).emit()`.
- **The dispatch and hospital portals are not being built now** but their API routes must be fully functional so they can be wired up later. Do not skip any route even if unused by the patient frontend currently.
- **Keep the simulation realistic** — ambulance should take 3-10 minutes to arrive depending on distance. Don't make it instant.

---

*End of Pran Master Implementation Prompt*
*Project: Hackerz Street 4.0 — Healthcare Track — Emergency Response & Ambulance Optimization System*
*Team: [Your Team Name] — Manipal University Jaipur*
