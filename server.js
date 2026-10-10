require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { startBot } = require('./bot');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

function getConfig() { try { return JSON.parse(fs.readFileSync('./config.json', 'utf-8')); } catch (e) { return {}; } }
function saveConfig(cfg) { fs.writeFileSync('./config.json', JSON.stringify(cfg, null, 2)); }

const discordClient = startBot();

app.get('/api/config', (req, res) => {
    res.json({ config: getConfig(), clientId: process.env.CLIENT_ID });
});

app.post('/api/upload', upload.single('audio'), (req, res) => {
    const slotId = parseInt(req.body.slotId);
    const newName = req.body.name;
    const config = getConfig();
    
    const slotIndex = config.sounds.findIndex(s => s.id === slotId);
    if (slotIndex === -1) return res.json({ success: false });

    if (newName) config.sounds[slotIndex].name = newName;

    if (req.file) {
        const oldFile = config.sounds[slotIndex].file;
        if (oldFile && fs.existsSync(oldFile)) fs.unlinkSync(oldFile); // Cleanup old audio
        
        const ext = path.extname(req.file.originalname) || '.mp3';
        const newPath = `uploads/sfx_${slotId}${ext}`;
        fs.renameSync(req.file.path, newPath);
        config.sounds[slotIndex].file = newPath;
    }
    
    saveConfig(config);
    discordClient.refreshPanel();
    res.json({ success: true });
});

app.post('/api/play', async (req, res) => {
    const slotId = parseInt(req.body.slotId);
    const config = getConfig();
    const sound = config.sounds.find(s => s.id === slotId);
    
    if (!sound || !sound.file) return res.json({ success: false, message: 'No audio uploaded to this tile.' });

    let vc = null;
    discordClient.guilds.cache.forEach(g => {
        const member = g.members.cache.get(discordClient.user.id);
        if (member && member.voice.channel) vc = member.voice.channel;
    });

    if (!vc) return res.json({ success: false, message: 'SFX Bot is not in a voice channel.' });

    try {
        const absolutePath = path.resolve(__dirname, sound.file);
        await discordClient.player.play(vc, absolutePath, { nodeOptions: { leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false } });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

app.listen(process.env.PORT || 3001, () => console.log('🎙️ Miko SFX running on port 3001'));
