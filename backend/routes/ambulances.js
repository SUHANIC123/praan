const express = require('express');
const router = express.Router();
const Ambulance = require('../models/Ambulance');

// GET all ambulances
router.get('/', async (req, res) => {
  try {
    const { type, status } = req.query;
    const filter = { isActive: true };
    if (type) filter.type = type;
    if (status) filter.status = status;
    const ambulances = await Ambulance.find(filter).populate('hospital', 'name city');
    res.json(ambulances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET nearby available ambulances
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, type, maxDistance = 30000 } = req.query;
    const filter = {
      isActive: true,
      status: 'available',
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(maxDistance)
        }
      }
    };
    if (type) filter.type = type;
    const ambulances = await Ambulance.find(filter).populate('hospital', 'name city');
    res.json(ambulances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single ambulance
router.get('/:id', async (req, res) => {
  try {
    const ambulance = await Ambulance.findById(req.params.id).populate('hospital');
    if (!ambulance) return res.status(404).json({ error: 'Ambulance not found' });
    res.json(ambulance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update ambulance location (called by ambulance GPS)
router.patch('/:id/location', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const ambulance = await Ambulance.findByIdAndUpdate(
      req.params.id,
      {
        location: { type: 'Point', coordinates: [lng, lat] },
        lastLocationUpdate: new Date()
      },
      { new: true }
    );
    req.io.emit('ambulance_location', { ambulanceId: req.params.id, lat, lng });
    res.json(ambulance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update ambulance status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const ambulance = await Ambulance.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    req.io.emit('ambulance_status', { ambulanceId: req.params.id, status });
    res.json(ambulance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
