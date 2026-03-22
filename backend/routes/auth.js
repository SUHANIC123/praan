const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const { signUserToken, requireAuth } = require('../middleware/auth');

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function userPublic(u) {
  return {
    _id: u._id,
    name: u.name,
    phone: u.phone,
    email: u.email,
    role: u.role,
    savedLocations: u.savedLocations || []
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const phoneNorm = normalizePhone(phone);
    if (phoneNorm.length < 10) return res.status(400).json({ error: 'Enter a valid phone number' });

    const dup = await User.findOne({ phoneNormalized: phoneNorm });
    if (dup) return res.status(409).json({ error: 'An account with this phone already exists' });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      name: String(name).trim(),
      phone: phone ? String(phone).trim() : undefined,
      phoneNormalized: phoneNorm,
      email: email ? String(email).trim().toLowerCase() : undefined,
      passwordHash,
      role: 'patient'
    });

    const token = signUserToken(user._id);
    res.status(201).json({ token, user: userPublic(user) });
  } catch (err) {
    console.error('register:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const phoneNorm = normalizePhone(phone);
    if (phoneNorm.length < 10 || !password) {
      return res.status(400).json({ error: 'Phone and password required' });
    }

    const user = await User.findOne({ phoneNormalized: phoneNorm });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid phone or password' });

    const token = signUserToken(user._id);
    res.json({ token, user: userPublic(user) });
  } catch (err) {
    console.error('login:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    delete user.passwordHash;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
