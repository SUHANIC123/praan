const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Public client config (browser Maps key is referrer-restricted in Google Cloud)
app.get('/api/config/client', (req, res) => {
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  res.json({ googleMapsApiKey: key });
});

// Attach io to every request so routes can emit events
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/hospitals', require('./routes/hospitals'));
app.use('/api/ambulances', require('./routes/ambulances'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/users', require('./routes/users'));
app.use('/api/symptoms', require('./routes/symptoms'));

// Pran2 dashboard integration (hospital / dispatch portals) — new routes only
require('./integrations/pran2/registerPortals')(app);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// Socket.io handlers
require('./socket/handlers')(io);

// MongoDB connection
const { resumeActiveSimulations } = require('./services/ambulanceSimulator');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await resumeActiveSimulations(io);
    require('./integrations/pran2/registerIncidentHospitalRelay')(io);
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => console.log(`Pran server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
