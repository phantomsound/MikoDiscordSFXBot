const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const logger = require('./logger');
const { startBot } = require('./bot');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: path.join(__dirname, 'uploads') });

function getConfig() { 
    try { 
        const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8');
        return JSON.parse(raw);
    } catch (e) { 
        return {
            dashboardName: "Miko SFX Dashboard",
            panelChannelId: "",
            logRetentionDays: 7,
            sounds: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Slot ${i + 1}`, file: null }))
        }; 
    } 
}

function saveConfig(cfg) { 
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfg, null, 2)); 
}

const discordClient = startBot();

app.get('/api/server-info', (req, res) => {
    const guilds = discordClient.guilds.cache.map(g => ({ id: g.id, name: g.name }));
    res.json({ 
        hostName: process.env.COMPUTERNAME || 'MIKOHOME',
        guilds: guilds,
        systemTime: new Date().toLocaleTimeString()
    });
});

app.get('/api/config', (req, res) => {
    const config = getConfig();
    const cid = process.env.CLIENT_ID || config.clientId || '';
    res.json({ config, clientId: cid });
});

app.get('/api/voice-channels', (req, res) => {
    const guildId = req.query.guildId;
    const targetGuilds = guildId ? discordClient.guilds.cache.filter(g => g.id === guildId) : discordClient.guilds.cache;
    const channels = [];
    targetGuilds.forEach(g => {
        g.channels.cache.filter(c => c.isVoiceBased()).forEach(c => channels.push({ id: c.id, name: `${g.name} - 🔊 ${c.name}` }));
    });
    res.json(channels);
});

app.post('/api/upload', upload.single('audio'), (req, res) => {
    const slotId = parseInt(req.body.slotId);
    const newName = req.body.name;
    const config = getConfig();
    if (!config.sounds) config.sounds = [];

    let slot = config.sounds.find(s => s.id === slotId);
    if (!slot) {
        slot = { id: slotId, name: `Slot ${slotId}`, file: null };
        config.sounds.push(slot);
    }

    if (newName) slot.name = newName;

    if (req.file) {
        if (slot.file && fs.existsSync(path.resolve(__dirname, slot.file))) {
            try { fs.unlinkSync(path.resolve(__dirname, slot.file)); } catch(e) {}
        }
        const ext = path.extname(req.file.originalname) || '.mp3';
        const filename = `sfx_${slotId}_${Date.now()}${ext}`;
        const targetPath = path.join(__dirname, 'uploads', filename);
        fs.renameSync(req.file.path, targetPath);
        slot.file = `uploads/${filename}`;
        logger.info(`Uploaded sound for slot ${slotId}: ${slot.name} (${slot.file})`);
    }
    
    saveConfig(config);
    if (discordClient.refreshPanel) discordClient.refreshPanel();
    res.json({ success: true });
});

function getTargetQueue(guildId) {
    if (guildId && discordClient.player.nodes.has(guildId)) return discordClient.player.nodes.get(guildId);
    return discordClient.player.nodes.cache.first();
}

app.get('/api/queue', (req, res) => {
    const queue = getTargetQueue(req.query.guildId);
    if (!queue) return res.json({ current: null, tracks: [], volume: 100 });
    const tracks = queue.tracks.toArray().map((t, i) => ({ title: t.title, duration: t.duration, index: i + 1 }));
    res.json({ current: queue.currentTrack ? queue.currentTrack.title : null, tracks, volume: queue.node.volume });
});

app.post('/api/play', async (req, res) => {
    const slotId = parseInt(req.body.slotId);
    const guildId = req.body.guildId;
    const config = getConfig();
    const sound = (config.sounds || []).find(s => s.id === slotId);
    
    if (!sound || !sound.file) return res.json({ success: false, message: 'No audio file assigned to this tile.' });

    let vc = null;
    const targetGuilds = guildId ? discordClient.guilds.cache.filter(g => g.id === guildId) : discordClient.guilds.cache;
    targetGuilds.forEach(g => {
        const member = g.members.cache.get(discordClient.user.id);
        if (member && member.voice.channel) vc = member.voice.channel;
    });

    if (!vc) return res.json({ success: false, message: 'Miko SFX is not connected to a voice channel in this server.' });

    try {
        const absolutePath = path.resolve(__dirname, sound.file);
        await discordClient.player.play(vc, absolutePath, {
            nodeOptions: { leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false, bufferingTimeout: 0 }
        });
        logger.info(`Triggered playback of SFX #${slotId} (${sound.name})`);
        res.json({ success: true });
    } catch (err) {
        logger.error(`Playback failed: ${err.message}`);
        res.json({ success: false, message: err.message });
    }
});

app.post('/api/control', (req, res) => {
    const queue = getTargetQueue(req.body.guildId);
    if (!queue) return res.json({ success: false, message: 'No active audio queue.' });
    const act = req.body.action;
    if (act === 'pause') queue.node.setPaused(!queue.node.isPaused());
    else if (act === 'stop') { queue.tracks.clear(); queue.node.stop(); }
    res.json({ success: true });
});

app.post('/api/volume', (req, res) => {
    const queue = getTargetQueue(req.body.guildId);
    if (queue && req.body.volume !== undefined) queue.node.setVolume(parseInt(req.body.volume));
    res.json({ success: true });
});

app.post('/api/voice', async (req, res) => {
    const { action, channelId } = req.body;
    if (action === 'disconnect') {
        const queue = getTargetQueue(req.body.guildId);
        if (queue) queue.delete();
        return res.json({ success: true });
    }
    if (action === 'join' && channelId) {
        let vc = null;
        discordClient.guilds.cache.forEach(g => { if (g.channels.cache.has(channelId)) vc = g.channels.cache.get(channelId); });
        if (!vc) return res.json({ success: false, message: 'Channel not found.' });
        
        const queue = discordClient.player.nodes.create(vc.guild, { leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false });
        await queue.connect(vc);
        logger.info(`SFX Bot joined voice channel: ${vc.name}`);
        return res.json({ success: true });
    }
    res.json({ success: false });
});

app.get('/api/logs', (req, res) => {
    const logPath = path.join(__dirname, 'logs', 'bot.log');
    if (fs.existsSync(logPath)) {
        const logs = fs.readFileSync(logPath, 'utf-8').split('\n').slice(-60).join('\n');
        res.json({ logs });
    } else { res.json({ logs: 'Log file not initialized yet.' }); }
});

app.get('/api/logs/export', (req, res) => {
    const logPath = path.join(__dirname, 'logs', 'bot.log');
    if (fs.existsSync(logPath)) res.download(logPath); else res.status(404).send('No log file found.');
});

app.post('/api/system/restart', (req, res) => {
    res.json({ success: true, message: 'Restart triggered.' });
    setTimeout(() => { exec('powershell -Command "nssm restart MikoDiscordSFXBot"'); }, 1000);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => logger.info(`🎙️ Miko SFX Web UI listening on port ${PORT}`));
