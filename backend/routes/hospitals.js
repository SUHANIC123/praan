const express = require('express');
const router = express.Router();
const Hospital = require('../models/Hospital');

// GET all hospitals
router.get('/', async (req, res) => {
  try {
    const hospitals = await Hospital.find({ isActive: true });
    res.json(hospitals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET nearby hospitals (for dispatch logic)
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, maxDistance = 20000 } = req.query; // maxDistance in meters
    const hospitals = await Hospital.find({
      isActive: true,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(maxDistance)
        }
      }
    });
    res.json(hospitals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single hospital
router.get('/:id', async (req, res) => {
  try {
    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) return res.status(404).json({ error: 'Hospital not found' });
    res.json(hospital);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update bed availability (for hospital portal)
router.patch('/:id/beds', async (req, res) => {
  try {
    const { availableBeds, availableIcuBeds } = req.body;
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { availableBeds, availableIcuBeds },
      { new: true }
    );
    req.io.emit('hospital_updated', hospital);
    res.json(hospital);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
