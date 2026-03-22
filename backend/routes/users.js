const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const Incident = require('../models/Incident');
const { requireAuth } = require('../middleware/auth');

// GET demo user (Amrisha - for patient portal)
router.get('/demo', async (req, res) => {
  try {
    let user = await User.findOne({ name: 'Amrisha' });
    if (!user) {
      user = new User({
        name: 'Amrisha',
        phone: '+91 98765 43210',
        phoneNormalized: '919876543210',
        passwordHash: await bcrypt.hash('pran123', 10),
        email: 'amrisha@example.com',
        role: 'patient',
        savedLocations: [
          { label: 'Home', address: 'Manipal University Jaipur, Dehmi Kalan, RJ', coordinates: [75.5655, 26.8433] }
        ]
      });
      await user.save();
    }
    const o = user.toObject();
    delete o.passwordHash;
    res.json(o);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /users/me/history — past rides & billing (authenticated)
router.get('/me/history', requireAuth, async (req, res) => {
  try {
    const list = await Incident.find({ 'patient.userId': req.userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('assignedAmbulance', 'unitId type licensePlate')
      .populate('assignedHospital', 'name city address phone')
      .lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    delete user.passwordHash;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
