const { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { Player } = require('discord-player');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function getConfig() { 
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8')); } catch (e) { return { sounds: [] }; } 
}

function startBot() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages] });
    const player = new Player(client);
    client.player = player;
    client.panelMessages = [];

    player.events.on('error', (q, e) => logger.error(`Player Error: ${e.message}`));
    player.events.on('playerError', (q, e) => logger.error(`Audio Dispatch Error: ${e.message}`));

    client.once('clientReady', async () => {
        try {
            const { AttachmentExtractor } = require('@discord-player/extractor');
            await player.extractors.register(AttachmentExtractor, {});
            logger.info(`Attachment Extractor registered for local sound playback`);
        } catch(e) { logger.warn(`Extractor registration note: ${e.message}`); }

        logger.info(`🤖 Miko SFX Bot logged in as ${client.user.tag}`);

        if (process.env.CLIENT_ID && process.env.DISCORD_TOKEN) {
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            const cmds = [{ name: 'soundboard', description: 'Deploy the interactive Miko SFX soundboard panel' }];
            try {
                await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: cmds });
                client.guilds.cache.forEach(g => rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, g.id), { body: cmds }).catch(()=>{}));
            } catch(err) { logger.error(`Command registration warning: ${err.message}`); }
        }
    });

    function buildPanel() {
        const config = getConfig();
        const embed = new EmbedBuilder()
            .setColor('#f9e2af')
            .setTitle('🎙️ Miko SFX Interactive Soundboard')
            .setDescription('Click any active button below to fire instant audio into your voice channel.');
        
        const rows = [];
        let currentRow = new ActionRowBuilder();
        const sounds = config.sounds || [];
        
        sounds.forEach((s, i) => {
            const btn = new ButtonBuilder()
                .setCustomId(`sfx_${s.id}`)
                .setLabel((s.name || `Slot ${s.id}`).substring(0, 80))
                .setStyle(s.file ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(!s.file);
            
            currentRow.addComponents(btn);
            if ((i + 1) % 4 === 0 || i === sounds.length - 1) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder();
            }
        });
        return { embeds: [embed], components: rows };
    }

    client.refreshPanel = async () => {
        for (const msg of client.panelMessages) {
            try { await msg.edit(buildPanel()); } catch(e) {}
        }
    };

    client.on('interactionCreate', async interaction => {
        if (interaction.isChatInputCommand() && interaction.commandName === 'soundboard') {
            const channel = interaction.member?.voice?.channel;
            if (!channel) return interaction.reply({ content: '❌ Join a Voice Channel first to summon SFX.', flags: [ 64 ] });
            
            await interaction.deferReply({ flags: [ 64 ] });
            const queue = player.nodes.create(interaction.guild, { leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false });
            if (!queue.connection) await queue.connect(channel);
            
            const panelData = buildPanel();
            const msg = await interaction.channel.send(panelData);
            client.panelMessages.push(msg);
            return interaction.followUp({ content: '✅ SFX Soundboard deployed.', flags: [ 64 ] });
        }

        if (interaction.isButton() && interaction.customId.startsWith('sfx_')) {
            const slotId = parseInt(interaction.customId.split('_')[1]);
            const config = getConfig();
            const sound = (config.sounds || []).find(s => s.id === slotId);
            if (!sound || !sound.file) return interaction.reply({ content: '❌ Tile is empty.', flags: [ 64 ] });

            const channel = interaction.member?.voice?.channel;
            if (!channel) return interaction.reply({ content: '❌ You must be in a Voice Channel to play sound effects.', flags: [ 64 ] });

            try {
                const absPath = path.resolve(__dirname, sound.file);
                await player.play(channel, absPath, { nodeOptions: { leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false, bufferingTimeout: 0 } });
                return interaction.reply({ content: `🔊 Playing: **${sound.name}**`, flags: [ 64 ] });
            } catch(err) {
                return interaction.reply({ content: `❌ Playback error: ${err.message}`, flags: [ 64 ] });
            }
        }
    });

    if (process.env.DISCORD_TOKEN && !process.env.DISCORD_TOKEN.includes('YOUR_SFX')) {
        client.login(process.env.DISCORD_TOKEN).catch(e => logger.error(`Login failed: ${e.message}`));
    } else {
        logger.warn('Awaiting valid DISCORD_TOKEN in C:\\Apps\\MikoDiscordSFXBot\\.env');
    }

    return client;
}
module.exports = { startBot };
