# 🚑 Praan — AI-Powered Emergency Response Platform

> Connecting patients, ambulances, and hospitals in real time.
> The missing layer in India's emergency response infrastructure.

---

## 🎥 Project UI
<img width="1600" height="851" alt="image" src="https://github.com/user-attachments/assets/50670766-a775-45a3-9d19-f77dd7a92e84" />
<img width="1600" height="843" alt="image" src="https://github.com/user-attachments/assets/81261ad7-a212-4e64-a848-7f21b0ff9327" />
<img width="1600" height="803" alt="image" src="https://github.com/user-attachments/assets/44ad5002-2c0d-4f73-89a3-aaf683de4775" />
<img width="1600" height="797" alt="image" src="https://github.com/user-attachments/assets/8cbc6ab6-fdf0-4add-83d6-360b50669bc1" />






---

## 📋 Table of Contents
- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Features](#features)
- [Setup Instructions](#setup-instructions)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [How It Works](#how-it-works)
- [Business Model](#business-model)
- [Roadmap](#roadmap)
- [Troubleshooting](#troubleshooting)

---

## 🚨 The Problem

When someone has a cardiac arrest in Jaipur today:
- They call 108 and wait on hold
- A dispatcher manually calls ambulance drivers one by one
- Nobody knows which hospital has an ICU bed available
- The patient waits. Sometimes fatally long.

**88% of Indian emergencies have no organized response.**
The private ambulance market is worth ₹3,200 crore and completely fragmented.

---

## 💡 The Solution

Praan is an AI-powered emergency dispatch platform that:
- Assigns the nearest right-type ambulance in **under 5 seconds**
- Scores all nearby hospitals by availability, specialty, and distance
- Alerts the hospital **before the ambulance even leaves the scene**
- Works across both **government and private** sectors in one unified network

---

## 🏗️ Architecture

![Praan System Architecture](<img width="1462" height="740" alt="archipraan" src="https://github.com/user-attachments/assets/32cf63ef-5604-4acb-92a6-1cde1af4869d" />
)

---

## 👥 Who Uses Praan

| User | What They Get |
|------|--------------|
| 🧑 Patient | One SOS tap → ambulance assigned → live tracker → shareable family link |
| 🚑 Driver | Job ping → accept/reject → route loaded → status updates |
| 🏥 Hospital | Pre-alert → bed preparation → digital handover → record updated |
| 🖥️ Admin | Live command dashboard → AI dispatch → fleet tracking → escalation alerts |

---

## 💻 Tech Stack

| Layer | Technology |
|-------|-----------|
| Admin Dashboard | React.js |
| Patient & Driver App | React Native |
| Backend | Node.js + Express |
| Real-time Updates | Firebase Realtime Database |
| Primary Database | PostgreSQL |
| Maps & Routing | OpenRouteService API |
| Notifications | MSG91 (SMS + WhatsApp) |
| Hosting | AWS Mumbai Region |
| DevOps | Docker + GitHub Actions |

---

## 📁 Project Structure
```
praan/
├── admin-dashboard/          # React.js dispatch command center
│   ├── src/
│   │   ├── components/       # Map, incident cards, fleet panel
│   │   ├── pages/            # Dispatch center, fleet database
│   │   └── services/         # API calls, WebSocket handlers
│   └── package.json
│
├── patient-app/              # React Native patient SOS app
│   ├── src/
│   │   ├── screens/          # SOS, tracking, history
│   │   └── components/       # Map tracker, ETA countdown
│   └── package.json
│
├── driver-app/               # React Native driver app
│   ├── src/
│   │   ├── screens/          # Job ping, navigation, status
│   │   └── components/       # Accept/reject, route display
│   └── package.json
│
├── hospital-portal/          # React.js hospital dashboard
│   ├── src/
│   │   ├── screens/          # Pre-alerts, bed management
│   │   └── components/       # Bed toggle, patient cards
│   └── package.json
│
├── backend/                  # Node.js + Express API server
│   ├── src/
│   │   ├── controllers/      # Incident, dispatch, fleet logic
│   │   ├── models/           # PostgreSQL schema models
│   │   ├── routes/           # All API route definitions
│   │   ├── services/         # AI scoring, GPS, notifications
│   │   ├── websocket/        # Real-time location handlers
│   │   └── app.js
│   ├── server.js
│   └── .env
│
└── assets/                   # Architecture diagrams, screenshots
```

---

## ✨ Features

- **AI Dispatch Scoring** — Scores every ambulance and hospital in real time based on distance, type, availability, and specialist on duty
- **Live GPS Tracking** — Ambulance positions update every 8 seconds via WebSocket
- **Pre-Alert System** — Hospital notified the moment dispatch is confirmed with full patient details
- **Multi-Sector Support** — Routes across both government (free) and private (paid) hospitals with cost transparency
- **Escalation Alerts** — Automatic flag if driver doesn't respond within 30 seconds
- **Family Tracking Link** — Shareable live link, no app download needed
- **Fleet Management** — Full ambulance database with equipment audit, shift tracking, and performance metrics
- **Offline Fallback** — Driver app caches last known route when connectivity drops
- **SMS Fallback** — All critical alerts sent via SMS — no smartphone required for drivers

---

## 🚀 Setup Instructions


### Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (v20 or higher) — [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- A **MongoDB Atlas** account — [Sign up here](https://www.mongodb.com/cloud/atlas)
- A **Live Server** extension for VS Code — [Install here](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer)

---

### Step 1 — Clone the Repository
```bash
git clone https://github.com/yourusername/pran.git
cd pran
```

---

### Step 2 — Backend Setup

Navigate to the backend folder and install dependencies:
```bash
cd backend
npm install
```

---

### Step 3 — Configure Environment Variables

The `.env` file already exists in the `backend/` folder. Open it and fill in your own values:
```env
PORT=3001
MONGODB_URI=your_mongodb_atlas_connection_string
CLIENT_URL=http://127.0.0.1:5500
ORS_API_KEY=your_openrouteservice_api_key
GROQ_API_KEY=your_groq_api_key
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

**Getting each key:**

| Key | Where to get it |
|-----|----------------|
| `MONGODB_URI` | MongoDB Atlas → Connect → Drivers → copy connection string |
| `ORS_API_KEY` | [openrouteservice.org](https://openrouteservice.org/) → Sign up → Dashboard → API Key |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) → Create new key |
| `GOOGLE_MAPS_API_KEY` | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials |

---

### Step 4 — Seed the Database

Populate the database with hospitals and ambulances near Jaipur:
```bash
node seed.js
```

You should see:
```
MongoDB connected
Seeded hospitals successfully
Seeded ambulances successfully
```

---

### Step 5 — Start the Backend Server
```bash
npm start
```

For development with auto-restart on file changes:
```bash
npm run dev
```

You should see:
```
MongoDB connected
Pran server running on port 3001
```

---

### Step 6 — Run the Frontend

The frontend is plain HTML/CSS/JS — no build step needed.

1. Open the `frontend/` folder in **VS Code**
2. Right-click `index.html` → **"Open with Live Server"**
3. Frontend runs at: `http://127.0.0.1:5500`

> **Important:** Make sure `CLIENT_URL=http://127.0.0.1:5500` in your `.env` matches exactly — this is required for CORS to work correctly.

---

### Step 7 — Access the Portals

Once both backend and frontend are running, open these in your browser:

| Portal | URL |
|--------|-----|
| 🧑 Patient App | `http://127.0.0.1:5500/index.html` |
| 🖥️ Dispatch Dashboard | `http://127.0.0.1:5500/integrations/pran2/dispatch.html` |
| 🏥 Hospital Dashboard | `http://127.0.0.1:5500/integrations/pran2/hospital-dashboard.html` |
| 🚑 Fleet Manager | `http://127.0.0.1:5500/integrations/pran2/fleet.html` |
| 🔐 Login | `http://127.0.0.1:5500/login.html` |
```

---

## 🧠 How the AI Dispatch Works

When an incident comes in the system scores every available option in real time:
```
Ambulance Score =
  (1 / ETA in minutes)          × 40%
+ (correct type for emergency)  × 35%
+ (driver acceptance rate)      × 25%

Hospital Score =
  (1 / ETA in minutes)          × 40%
+ (correct bed type available)  × 30%
+ (specialist on duty)          × 20%
+ (current ER load)             × 10%
```

The highest scoring combination is recommended instantly.
A human confirms. The whole process takes under 10 seconds.

---

## 🗺️ User Flows

### Patient
```
SOS Tap → GPS Captured → Severity Selected
→ AI Matches Ambulance + Hospital → Confirmed
→ Live Tracker → Ambulance Arrives → Handover → Resolved
```

### Driver
```
Job Ping Received → Accept / Reject
→ Route Loaded → En Route → On Scene
→ Patient Stable? → Transporting → Hospital → Available
```

### Hospital
```
Pre-Alert Received → Patient Details Auto-Populated
→ Bed Assigned → Specialist Notified → Team Ready
→ Patient Arrives → Digital Handover → Record Updated → Resolved
```

---

## 💰 Business Model

| Revenue Stream | How It Works |
|---------------|-------------|
| Hospital referral fee | Hospital pays per patient routed — like Zomato charging restaurants per order |
| Ambulance commission | 15% cut per job after 6 months — like Uber taking from every ride |
| Insurance routing fee | Paid per cashless claim connected between patient and insurer |
| Corporate retainer | Fixed monthly fee for campus emergency cover — guaranteed income |
| Government licensing | Annual license fee to state health departments for city-wide rollout |

---

## 📊 Market Opportunity

- **₹3,200 Cr** — Indian private ambulance market, completely unorganized
- **750M+** — Smartphone users in India ready for app-based emergency response
- **88%** — Emergencies in India with no organized response today
- **4,200** — Cases handled by Blinkit in year one, proving demand exists

---

## 🛣️ Roadmap

| Phase | Timeline | What Gets Built |
|-------|----------|----------------|
| Foundation | Months 1–3 | Core platform, driver app, hospital portal |
| Onboarding | Months 2–4 | 10 ambulance partners, 3 hospital partners |
| Pilot | Months 3–5 | Corporate campus and event pilots |
| AI Layer | Months 5–7 | Predictive demand, pre-positioning |
| Scale | Months 6–12 | City 2 and 3, insurance integrations |

---

---

## 📚 References

- GVK EMRI 108 Annual Report — response time and incident data
- NITI Aayog Health Index 2023 — emergency care infrastructure gaps
- Clinical Establishments Act 2010 — private hospital emergency obligations
- Supreme Court Emergency Care Ruling 2018
- NHA Ayushman Bharat Empanelment Portal
- Blinkit Ambulance Launch — Economic Times 2024
- OpenRouteService API Documentation
- Firebase Realtime Database Documentation

---

## 🏆 Built At

Built for **HackerzStreet** — **21/03/26**
Team: **32 bits**

---

*Praan — Because every second counts.*

---

**If you found this useful, please give it a ⭐ on GitHub!**
