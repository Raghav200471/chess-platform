// server/src/models/User.js
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, index: true },
  email:    { type: String, required: true, unique: true, index: true, lowercase: true },
  passwordHash: { type: String, required: true },
  friends: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  games:   [{ type: Schema.Types.ObjectId, ref: 'Game' }],
  rating:  { type: Number, default: 1200 },
}, { timestamps: true });

export default model('User', UserSchema);
