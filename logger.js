const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'bot.log');

function log(level, message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    process.stdout.write(line);
    try { fs.appendFileSync(logFile, line, 'utf8'); } catch(e) {}
}

module.exports = {
    info: (msg) => log('INFO', msg),
    warn: (msg) => log('WARN', msg),
    error: (msg) => log('ERROR', msg),
    debug: (msg) => log('DEBUG', msg)
};
