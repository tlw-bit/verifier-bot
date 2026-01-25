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
  const clientId = process.env.CLIENT_ID; // bot application id
  const guildId = process.env.GUILD_ID;   // your server id

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  });

  console.log("✅ Deployed /levels to this guild.");
})();
