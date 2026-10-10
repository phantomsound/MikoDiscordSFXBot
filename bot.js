const { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const { Player, QueueRepeatMode } = require('discord-player');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function getConfig() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8')); } catch (e) { return { sounds: [] }; } }

async function cleanChannel(channel, client) {
    try {
        const msgs = await channel.messages.fetch({ limit: 50 });
        for (const [id, m] of msgs) { 
            if (m.author.id === client.user.id) await m.delete().catch(()=>{}); 
        }
    } catch(e) {}
}

async function updatePanel(queue) {
    if (!queue || !queue.metadata || !queue.metadata.panelMessage) return;
    try {
        const current = queue.currentTrack;
        const embed = new EmbedBuilder().setColor('#f9e2af').setTitle('🎛️ Miko SFX Control Panel');
        if (current) {
            embed.addFields({ name: '▶️ Active SFX', value: `**${current.title}** - \`${current.duration}\`` });
            const mode = queue.repeatMode === QueueRepeatMode.TRACK ? 'Track 🔂' : queue.repeatMode === QueueRepeatMode.QUEUE ? 'Queue 🔁' : 'Off ❌';
            embed.setFooter({ text: `Queue: ${queue.tracks.size} sounds | Repeat: ${mode} | Vol: ${queue.node.volume}%` });
        } else {
            embed.setDescription('*SFX Engine standing by. Select a sound effect to broadcast.*');
            embed.setFooter({ text: `Engine Idle • Ready for Audio` });
        }
        await queue.metadata.panelMessage.edit({ embeds: [embed] });
    } catch(e) { }
}

function startBot() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const player = new Player(client);
    client.player = player;
    
    player.events.on('error', (q, e) => logger.error(`Player Error: ${e.message}`));
    player.events.on('playerError', (q, e) => logger.error(`Audio Dispatch Error: ${e.message}`));

    player.events.on('playerStart', (queue, track) => { updatePanel(queue); });
    player.events.on('audioTrackAdd', (queue) => updatePanel(queue));
    player.events.on('emptyQueue', (queue) => { updatePanel(queue); });
    player.events.on('disconnect', (queue) => { updatePanel(queue); });
    player.events.on('volumeChange', (queue) => updatePanel(queue));

    client.once('clientReady', async () => {
        try {
            const { AttachmentExtractor } = require('@discord-player/extractor');
            await player.extractors.register(AttachmentExtractor, {});
            logger.info(`Attachment Extractor registered for local sound playback`);
        } catch(e) {}

        logger.info(`🤖 Miko SFX Bot logged in as ${client.user.tag}`);
    });

    async function deployControlPanel(guild, channel, targetTextChannel, interaction = null) {
        const config = getConfig();
        const queue = player.nodes.create(guild, { metadata: { channel: targetTextChannel, panelMessage: null }, leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false, bufferingTimeout: 0 });
        if (!queue.connection) await queue.connect(channel);
        if (config.defaultVolume !== undefined) queue.node.setVolume(config.defaultVolume);
        
        await cleanChannel(targetTextChannel, client);
        
        const embed = new EmbedBuilder().setColor('#f9e2af').setTitle('🎛️ Miko SFX Control Panel').setDescription('*SFX Engine standing by. Select a sound to broadcast.*');
        
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_sfx_pause').setLabel('⏯️ Pause / Play').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn_sfx_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_sfx_loop_track').setLabel('🔂 Loop 1').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_sfx_loop_off').setLabel('❌ Loop Off').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('btn_sfx_stop').setLabel('⏹️ Stop SFX').setStyle(ButtonStyle.Danger)
        );

        const activeSounds = (config.sounds || []).filter(s => s.file);
        const row2 = new ActionRowBuilder();

        if (activeSounds.length > 0) {
            const menu = new StringSelectMenuBuilder().setCustomId('menu_sfx_play').setPlaceholder('Select an SFX to play...');
            activeSounds.forEach(s => { menu.addOptions({ label: (s.name || `Slot ${s.id}`).substring(0, 95), value: s.id.toString() }); });
            row2.addComponents(menu);
        } else {
            const menu = new StringSelectMenuBuilder().setCustomId('menu_sfx_empty').setPlaceholder('No SFX uploaded yet...').setDisabled(true);
            menu.addOptions({ label: 'Empty', value: '0' });
            row2.addComponents(menu);
        }

        let msg = await targetTextChannel.send({ embeds: [embed], components: [row1, row2] });
        queue.metadata.panelMessage = msg;
        updatePanel(queue);
        if (interaction) await interaction.followUp({ content: '✅ SFX Control Panel activated.', flags: [ 64 ] });
    }

    client.on('interactionCreate', async interaction => {
        try {
            if (interaction.isButton()) {
                if (interaction.customId === 'btn_sfx_summon') {
                    const channel = interaction.member?.voice?.channel;
                    if (!channel) return interaction.reply({ content: '❌ You must be in a Voice Channel!', flags: [ 64 ] });
                    await interaction.deferReply({ flags: [ 64 ] });
                    await deployControlPanel(interaction.guild, channel, interaction.channel, null);
                    return interaction.followUp({ content: `✅ SFX Bot joined **${channel.name}**!`, flags: [ 64 ] });
                }

                const queue = player.nodes.get(interaction.guildId);
                if (!queue) return interaction.reply({ content: 'Nothing playing.', flags: [ 64 ] });

                if (interaction.customId === 'btn_sfx_pause') { queue.node.setPaused(!queue.node.isPaused()); await interaction.reply({ content: '⏯️ Toggled playback.', flags: [ 64 ] }); updatePanel(queue); }
                if (interaction.customId === 'btn_sfx_skip') { queue.node.skip(); await interaction.reply({ content: '⏭️ Skipped sound.', flags: [ 64 ] }); }
                if (interaction.customId === 'btn_sfx_stop') { queue.node.setPaused(false); queue.tracks.clear(); queue.node.skip(); await interaction.reply({ content: '⏹️ Cleared SFX queue.', flags: [ 64 ] }); updatePanel(queue); }
                if (interaction.customId === 'btn_sfx_loop_track') { queue.setRepeatMode(QueueRepeatMode.TRACK); await interaction.reply({ content: '🔂 Looping single sound.', flags: [ 64 ] }); updatePanel(queue); }
                if (interaction.customId === 'btn_sfx_loop_off') { queue.setRepeatMode(QueueRepeatMode.OFF); await interaction.reply({ content: '❌ Loop disabled.', flags: [ 64 ] }); updatePanel(queue); }
            }

            if (interaction.isStringSelectMenu() && interaction.customId === 'menu_sfx_play') {
                await interaction.deferReply({ flags: [ 64 ] });
                const slotId = parseInt(interaction.values[0]);
                const config = getConfig();
                const sound = (config.sounds || []).find(s => s.id === slotId);
                if (!sound || !sound.file) return interaction.followUp({ content: '❌ Audio missing.', flags: [ 64 ] });
                
                const absPath = path.resolve(__dirname, sound.file);
                const channel = interaction.member.voice.channel;
                
                try {
                    const queue = player.nodes.get(interaction.guild.id);
                    // Explicitly use 'file' searchEngine to force local path extraction
                    await player.play(channel, absPath, { 
                        searchEngine: 'file',
                        nodeOptions: { metadata: { channel: interaction.channel, panelMessage: queue?.metadata?.panelMessage }, leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false, bufferingTimeout: 0 },
                        requestedBy: interaction.user 
                    });
                    await interaction.followUp({ content: `✅ Playing: **${sound.name}**`, flags: [ 64 ] });
                } catch(e) {
                    await interaction.followUp({ content: `❌ Error: ${e.message}`, flags: [ 64 ] });
                }
            }
        } catch (err) {}
    });

    if (process.env.DISCORD_TOKEN && !process.env.DISCORD_TOKEN.includes('YOUR_SFX')) {
        client.login(process.env.DISCORD_TOKEN).catch(e => logger.error(`Login failed: ${e.message}`));
    }
    return client;
}
module.exports = { startBot };

