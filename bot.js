const { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { Player } = require('discord-player');
const fs = require('fs');
const path = require('path');

function getConfig() { try { return JSON.parse(fs.readFileSync('./config.json', 'utf-8')); } catch (e) { return {}; } }

function startBot() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages] });
    const player = new Player(client);
    client.player = player;
    client.panelMessages = [];

    client.once('clientReady', async () => {
        const { AttachmentExtractor } = require('@discord-player/extractor');
        await player.extractors.register(AttachmentExtractor, {});
        console.log(`🤖 Miko SFX connected as ${client.user.tag}`);

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { 
            body: [ { name: 'soundboard', description: 'Summons the Miko SFX Soundboard Panel' } ] 
        });
        client.guilds.cache.forEach(g => rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, g.id), { body: [{ name: 'soundboard', description: 'Summons the Miko SFX Soundboard' }] }).catch(()=>{}));
    });

    client.refreshPanel = async () => {
        for (const msg of client.panelMessages) {
            try { await msg.edit(buildPanel()); } catch(e) {}
        }
    };

    function buildPanel() {
        const config = getConfig();
        const embed = new EmbedBuilder().setColor('#f9e2af').setTitle('🎙️ Miko SFX Soundboard');
        const rows = [];
        let currentRow = new ActionRowBuilder();
        
        config.sounds.forEach((s, i) => {
            const btn = new ButtonBuilder()
                .setCustomId(`sfx_${s.id}`)
                .setLabel(s.name)
                .setStyle(s.file ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(!s.file);
            
            currentRow.addComponents(btn);
            if ((i + 1) % 4 === 0 || i === config.sounds.length - 1) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder();
            }
        });
        return { embeds: [embed], components: rows };
    }

    client.on('interactionCreate', async interaction => {
        if (interaction.isChatInputCommand() && interaction.commandName === 'soundboard') {
            const channel = interaction.member.voice.channel;
            if (!channel) return interaction.reply({ content: '❌ Join a voice channel first.', flags: [ 64 ] });
            
            await interaction.deferReply({ flags: [ 64 ] });
            const queue = player.nodes.create(interaction.guild, { leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false });
            if (!queue.connection) await queue.connect(channel);
            
            const msg = await interaction.channel.send(buildPanel());
            client.panelMessages.push(msg);
            await interaction.followUp({ content: '✅ Soundboard deployed.', flags: [ 64 ] });
        }

        if (interaction.isButton() && interaction.customId.startsWith('sfx_')) {
            const slotId = parseInt(interaction.customId.split('_')[1]);
            const config = getConfig();
            const sound = config.sounds.find(s => s.id === slotId);
            if (!sound || !sound.file) return interaction.reply({ content: '❌ Empty tile.', flags: [ 64 ] });

            const channel = interaction.member.voice.channel;
            if (!channel) return interaction.reply({ content: '❌ You must be in a Voice Channel to play SFX.', flags: [ 64 ] });

            try {
                const absolutePath = path.resolve(__dirname, sound.file);
                await player.play(channel, absolutePath, { nodeOptions: { leaveOnEmpty: false, leaveOnEnd: false, leaveOnStop: false } });
                await interaction.reply({ content: `🔊 Playing: ${sound.name}`, flags: [ 64 ] });
            } catch (err) {
                await interaction.reply({ content: `❌ Error: ${err.message}`, flags: [ 64 ] });
            }
        }
    });

    client.login(process.env.DISCORD_TOKEN);
    return client;
}
module.exports = { startBot };
