import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  color: { type: String, enum: ['white', 'black'], required: true },
}, { _id: false });

const gameSchema = new mongoose.Schema({
  gameId: { type: String, required: true, unique: true },
  players: [playerSchema],
  winner: { type: String, enum: ['white', 'black', 'draw'], required: true },
  reason: { type: String, required: true }, // e.g., 'Checkmate', 'Stalemate', 'Disconnect'
  finishedAt: { type: Date, default: Date.now },
});

export default mongoose.model('Game', gameSchema);

