// deploy-commands.js
require("dotenv").config();
const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("level")
    .setDescription("Show level/xp for you or someone else")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to check")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show the rank card for you or someone else")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to check")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("xpleaderboard")
    .setDescription("Show the XP leaderboard"),

  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Show invite count for you or someone else")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to check")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("invleaderboard")
    .setDescription("Show the invite leaderboard"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("pong ✅"),

  new SlashCommandBuilder()
    .setName("getcode")
    .setDescription("DM me a verification code"),

  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify your Habbo account via motto code")
    .addStringOption(o =>
      o.setName("habbo")
        .setDescription("Your Habbo name")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("verifymsg")
    .setDescription("Post + pin verification instructions (admin)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const clientId = process.env.CLIENT_ID; // Application ID
    const guildId = process.env.GUILD_ID;   // Server ID

    if (!clientId || !guildId) {
      throw new Error("Missing CLIENT_ID or GUILD_ID environment variables.");
    }

    console.log("🚀 Deploying slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log("✅ Slash commands deployed successfully.");
  } catch (err) {
    console.error("❌ Failed to deploy commands:", err);
  }
})();
