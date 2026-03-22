const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  incidentId: { type: String, required: true, unique: true },
  shareToken: { type: String, unique: true }, // for family share link
  patient: {
    name: String,
    phone: String,
    age: Number,
    gender: String,
    allergies: String,
    medications: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  /** Run sheet / EMS report title from caller */
  reportName: { type: String, default: '' },
  /** Primary symptom or reason for call (structured intake) */
  chiefComplaint: { type: String, default: '' },
  /** Free-text from patient at request time (before hospital narrative) */
  intakeNotes: { type: String, default: '' },
  /** Detailed narrative for receiving hospital (symptoms, timeline, vitals if known) */
  patientDetailsForHospital: { type: String, default: '' },
  /** AI-generated clinical handoff for hospital forwarding */
  aiHospitalReport: { type: String, default: '' },
  /** Urgency 1–10 for hospital triage (AI or heuristic) */
  aiSeverityScore: { type: Number, min: 1, max: 10 },
  aiReportSummary: { type: String, default: '' },
  aiReportGeneratedAt: Date,
  pickupLocation: {
    address: String,
    coordinates: [Number] // [lng, lat]
  },
  ambulanceType: { type: String, enum: ['BLS', 'ALS', 'ICU', 'NEONATAL'] },
  severity: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Critical' },
  caseType: String, // e.g. "Cardiac Arrest"
  specialty: String, // e.g. "Cardiac"
  hospitalSuggestions: [{ hospitalId: mongoose.Schema.Types.ObjectId, etaMin: Number, distKm: Number, specialtyMatch: Boolean, recommended: Boolean }],
  assignedAmbulance: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance' },
  assignedHospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
  status: {
    type: String,
    enum: ['requested', 'dispatched', 'on_scene', 'transporting', 'completed', 'cancelled'],
    default: 'requested'
  },
  timeline: [{
    status: String,
    label: String,
    description: String,
    timestamp: { type: Date, default: Date.now }
  }],
  patientStatusNotes: [{
    note: String,
    by: String, // paramedic name
    timestamp: { type: Date, default: Date.now }
  }],
  estimatedArrival: { type: Number }, // minutes
  routePolyline: [{ lat: Number, lng: Number }],
  dispatchedAt: Date,
  arrivedAt: Date,
  completedAt: Date,
  billing: {
    baseFare: { type: Number, default: 0 },
    distanceFare: { type: Number, default: 0 },
    emergencySurcharge: { type: Number, default: 0 },
    paramedicFee: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0.05 },
    distanceKm: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' }
  },
  responseTimeSeconds: Number,
  totalDurationMinutes: Number
}, { timestamps: true });

module.exports = mongoose.model('Incident', incidentSchema);
