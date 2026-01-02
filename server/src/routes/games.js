import express from 'express';
import jwt from 'jsonwebtoken';
import Game from '../models/Game.js';
import User from '../models/User.js';

const router = express.Router();

// Middleware to protect routes
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(payload.id).select('-passwordHash');
    if (!req.user) return res.status(401).json({ message: 'User not found.' });
    
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

// GET /api/games/history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const games = await Game.find({ 'players.userId': req.user._id })
      .sort({ finishedAt: -1 })
      .limit(50);
    res.json(games);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching game history.' });
  }
});

export default router;

