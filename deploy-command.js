const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("levels")
    .setDescription("Show your level/xp (or someone else)")
    .addUserOption(opt =>
      opt.setName("user").setDescription("User to check").setRequired(false)
    )
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const clientId = process.env.CLIENT_ID; // your bot application ID
    const guildId = process.env.GUILD_ID;   // your server ID

    if (!clientId || !guildId) {
      throw new Error("Missing CLIENT_ID or GUILD_ID env vars.");
    }

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log("✅ Registered /levels for this guild.");
  } catch (err) {
    console.error("❌ Deploy failed:", err);
  }
})();
