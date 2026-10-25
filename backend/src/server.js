import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes('*') || origins.includes(origin)), credentials: true }));
app.use(express.json({ limit: '16kb' }));

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, match: /^[a-z0-9_]{3,20}$/ },
  displayName: { type: String, required: true, maxlength: 40 },
  email: { type: String, unique: true, sparse: true, lowercase: true },
  passwordHash: String,
  googleId: { type: String, unique: true, sparse: true },
  avatar: String,
  createdAt: { type: Date, default: Date.now }
}));
const Message = mongoose.model('Message', new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 4000, trim: true },
  createdAt: { type: Date, default: Date.now }
}));
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const tokenFor = user => jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const publicUser = u => ({ id: u.id, username: u.username, handle: '@' + u.username, displayName: u.displayName, avatar: u.avatar || '' });
const conversationId = (a,b) => [String(a),String(b)].sort().join(':');
async function auth(req,res,next) {
  try {
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i,'');
    if (!raw) return res.status(401).json({ error: 'Sign in to continue.' });
    const payload = jwt.verify(raw, process.env.JWT_SECRET);
    req.user = await User.findById(payload.sub);
    if (!req.user) return res.status(401).json({ error: 'Account not found.' });
    next();
  } catch { res.status(401).json({ error: 'Your session expired. Please sign in again.' }); }
}
app.get('/api/health', (_req,res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.post('/api/auth/register', async (req,res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || '').trim();
    const username = String(req.body.username || '').trim().replace(/^@/,'').toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({error:'Username must be 3–20 characters: letters, numbers or underscores.'});
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Enter a valid email address.'});
    if (password.length < 8) return res.status(400).json({error:'Password must be at least 8 characters.'});
    if (!displayName || displayName.length > 40) return res.status(400).json({error:'Display name is required (up to 40 characters).'});
    if (await User.exists({$or:[{username},{email}]})) return res.status(409).json({error:'That username or email is already in use.'});
    const user = await User.create({username,email,displayName,passwordHash:await bcrypt.hash(password,12)});
    res.status(201).json({token:tokenFor(user),user:publicUser(user)});
  } catch(e) { if(e.code===11000) return res.status(409).json({error:'That username or email is already in use.'}); console.error(e); res.status(500).json({error:'Could not create account.'}); }
});
app.post('/api/auth/login', async (req,res) => {
  try {
    const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
    const user=await User.findOne({email});
    if(!user?.passwordHash || !(await bcrypt.compare(password,user.passwordHash))) return res.status(401).json({error:'Email or password is incorrect.'});
    res.json({token:tokenFor(user),user:publicUser(user)});
  } catch { res.status(500).json({error:'Could not sign in.'}); }
});
app.post('/api/auth/google', async (req,res) => {
  try {
    if(!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({error:'Google sign-in is not configured yet. Use email sign-in.'});
    const ticket=await googleClient.verifyIdToken({idToken:req.body.credential,audience:process.env.GOOGLE_CLIENT_ID});
    const p=ticket.getPayload();
    if(!p?.email_verified || !p.email) return res.status(401).json({error:'Google email could not be verified.'});
    let user=await User.findOne({$or:[{googleId:p.sub},{email:p.email.toLowerCase()}]});
    if(!user) {
      const baseRaw=p.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,14); const base=(baseRaw.length>=3?baseRaw:(baseRaw+'user').slice(0,14));
      let username=base, i=1;
      while(await User.exists({username})) username=base.slice(0,14)+i++;
      user=await User.create({username,email:p.email.toLowerCase(),displayName:(p.name||base).slice(0,40),googleId:p.sub,avatar:p.picture||''});
    } else if(!user.googleId) { user.googleId=p.sub; if(!user.avatar) user.avatar=p.picture||''; await user.save(); }
    res.json({token:tokenFor(user),user:publicUser(user)});
  } catch(e) { console.error('Google auth failed:',e.message); res.status(401).json({error:'Google sign-in failed. Please try again.'}); }
});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:publicUser(req.user)}));
app.get('/api/users/search',auth,async(req,res)=>{
  const q=String(req.query.q||'').trim().replace(/^@/,'').toLowerCase();
  if(q.length<2) return res.json({users:[]});
  const users=await User.find({username:{$regex:'^'+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')},_id:{$ne:req.user._id}}).select('username displayName avatar').limit(12);
  res.json({users:users.map(publicUser)});
});
app.get('/api/conversations',auth,async(req,res)=>{
  const rows=await Message.find({$or:[{sender:req.user._id},{recipient:req.user._id}]}).sort({createdAt:-1}).limit(500).populate('sender','username displayName avatar').populate('recipient','username displayName avatar');
  const seen=new Set(), conversations=[];
  for(const m of rows){
    const other=String(m.sender._id)===String(req.user._id)?m.recipient:m.sender;
    const id=conversationId(req.user.id,other.id);
    if(seen.has(id)) continue; seen.add(id);
    conversations.push({id,user:publicUser(other),lastMessage:{text:m.text,createdAt:m.createdAt,senderId:String(m.sender._id)}});
  }
  res.json({conversations});
});
app.get('/api/messages/:userId',auth,async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({error:'Invalid user.'});
  const other=await User.findById(req.params.userId);
  if(!other || String(other._id)===String(req.user._id)) return res.status(404).json({error:'User not found.'});
  const id=conversationId(req.user.id,other.id);
  const messages=await Message.find({conversationId:id}).sort({createdAt:1}).limit(500).populate('sender','username displayName');
  res.json({user:publicUser(other),messages:messages.map(m=>({id:m.id,text:m.text,createdAt:m.createdAt,senderId:String(m.sender._id),senderUsername:m.sender.username}))});
});

const io = new Server(server,{cors:{origin:(origin,cb)=>cb(null,!origin||origins.includes('*')||origins.includes(origin)),credentials:true}});
io.use(async(socket,next)=>{
  try {
    const token=socket.handshake.auth?.token;
    const payload=jwt.verify(token,process.env.JWT_SECRET);
    const user=await User.findById(payload.sub);
    if(!user) return next(new Error('Unauthorized'));
    socket.user=user; next();
  } catch { next(new Error('Unauthorized')); }
});
io.on('connection',socket=>{
  socket.join('user:'+socket.user.id);
  socket.on('message:send',async(data,ack)=>{
    try {
      const recipientId=String(data?.recipientId||'');
      const text=String(data?.text||'').trim();
      if(!mongoose.isValidObjectId(recipientId)||recipientId===socket.user.id) throw new Error('Choose a valid person to message.');
      if(!text||text.length>4000) throw new Error('Message must be between 1 and 4000 characters.');
      const recipient=await User.findById(recipientId);
      if(!recipient) throw new Error('That user does not exist.');
      const id=conversationId(socket.user.id,recipient.id);
      const message=await Message.create({conversationId:id,sender:socket.user._id,recipient:recipient._id,text});
      const item={id:message.id,conversationId:id,senderId:socket.user.id,recipientId:recipient.id,text,createdAt:message.createdAt,senderUsername:socket.user.username};
      io.to('user:'+socket.user.id).to('user:'+recipient.id).emit('message:new',item);
      if(typeof ack==='function') ack({ok:true,message:item});
    } catch(e) { if(typeof ack==='function') ack({ok:false,error:e.message||'Message could not be sent.'}); }
  });
});
const port=Number(process.env.PORT||4000);
if(!process.env.JWT_SECRET) { console.error('JWT_SECRET is required'); process.exit(1); }
if(!process.env.MONGODB_URI) { console.error('MONGODB_URI is required'); process.exit(1); }
mongoose.connect(process.env.MONGODB_URI).then(()=>server.listen(port,()=>console.log('ChatWave API listening on '+port))).catch(e=>{console.error('MongoDB connection failed:',e.message);process.exit(1);});
