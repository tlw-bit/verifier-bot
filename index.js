console.log("Bot starting...");

const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, PermissionsBitField } = require("discord.js");
const path = require("path");
const fs = require("fs");

// ====== CONFIG ======
const PREFIX = "!";
const VERIFIED_ROLE = "Verified";
const OLD_ROLE_TO_REMOVE = "Unverified";
const VERIFY_CHANNEL_ID = "1462386529765691473";
const LOG_CHANNEL_ID = "1456955298597175391";
// ====================

const pending = new Map(); // userId -> code

function makeCode() {
  return "verify-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function fetchHabboMotto(name) {
  const res = await fetch(`https://www.habbo.com/api/public/users?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error("Habbo user not found");
  const data = await res.json();
  return (data.motto || "").trim();
}

function sendLogEmbed(guild, embed) {
  if (!LOG_CHANNEL_ID) return;
  const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!channel) return;
  channel.send({ embeds: [embed] }).catch(() => {});
}

function verifiedEmbed(userId, habboName) {
  return new EmbedBuilder()
    .setTitle("✅ User Verified")
    .setColor(0x57F287)
    .addFields(
      { name: "User", value: `<@${userId}>`, inline: true },
      { name: "Habbo Name", value: habboName, inline: true }
    )
    .setTimestamp();
}

function joinEmbed(member) {
  return new EmbedBuilder()
    .setTitle("✅ Member Joined")
    .setColor(0x57F287)
    .setDescription(`<@${member.user.id}> joined the server.`)
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "ID", value: member.user.id, inline: true }
    )
    .setTimestamp();
}

function leaveEmbed(member) {
  return new EmbedBuilder()
    .setTitle("🚪 Member Left")
    .setColor(0xED4245)
    .setDescription(`<@${member.user.id}> left the server.`)
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "ID", value: member.user.id, inline: true }
    )
    .setTimestamp();
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ====== JOIN / LEAVE LOGS ======
client.on("guildMemberAdd", (member) => {
  sendLogEmbed(member.guild, joinEmbed(member));
});

client.on("guildMemberRemove", (member) => {
  sendLogEmbed(member.guild, leaveEmbed(member));
});

// ====== READY ======
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ====== COMMANDS ======
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.guild) return;
    if (!msg.content.startsWith(PREFIX)) return;

    const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (args.shift() || "").toLowerCase();

    console.log("CMD:", cmd, "FROM:", msg.author.tag, "IN:", msg.channel?.id);

    // ---- PING ----
    if (cmd === "ping") {
      return msg.reply("pong ✅");
    }

    // ---- GETCODE (DMs user a code) ----
    if (cmd === "getcode") {
      // Optional: force it to be used in verify channel
      if (VERIFY_CHANNEL_ID && msg.channel.id !== VERIFY_CHANNEL_ID) {
        return msg.reply("❌ Please use `!getcode` in the verification channel.");
      }

      const code = makeCode();
      pending.set(msg.author.id, code);

      try {
        await msg.author.send(
          `🔐 Your verification code is: **${code}**\n\n` +
          `1) Put this in your Habbo motto\n` +
          `2) Wait 10–30 seconds\n` +
          `3) Come back and type: \`!verify YourHabboName\``
        );
        return msg.reply("✅ I’ve DM’d you your code. Check your messages!");
      } catch {
        return msg.reply(
          `❌ I couldn’t DM you (your DMs might be closed).\n` +
          `Your code is: **${code}**\n` +
          `Put it in your Habbo motto, then run: \`!verify YourHabboName\``
        );
      }
    }

    // ---- VERIFY INSTRUCTIONS (posts embed + image, then pins) ----
    if (cmd === "verifymsg") {
      if (!msg.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return msg.reply("❌ You need **Manage Server** to post the verification message.");
      }

      const channel = msg.guild.channels.cache.get(VERIFY_CHANNEL_ID);
      if (!channel || !channel.isTextBased()) {
        return msg.reply("❌ I can't find the verification channel. Check VERIFY_CHANNEL_ID.");
      }

      const imagePath = path.join(__dirname, "assets", "verify-guide.png");
      if (!fs.existsSync(imagePath)) {
        return msg.reply("❌ Image not found. Put it in `assets/verify-guide.png`.");
      }

      const attachment = new AttachmentBuilder(imagePath, { name: "verify-guide.png" });

      const embed = new EmbedBuilder()
        .setTitle("🔐 Server Verification")
        .setDescription(
          [
            "Follow these steps to get verified:",
            "",
            "💬 **Type:** `!getcode`",
            "📩 **Check your DMs** for your code",
            "📝 **Change your Habbo motto** to the code",
            "✅ **Then type:** `!verify (your habbo name)`",
            "",
            "🎉 **Done!**",
          ].join("\n")
        )
        .setImage("attachment://verify-guide.png")
        .setColor(0x5865F2);

      const sent = await channel.send({ embeds: [embed], files: [attachment] });

      try {
        await sent.pin();
      } catch {
        await msg.reply("✅ Posted the verification message, but I couldn't pin it. (Give me **Manage Messages** in #verify.)");
        return;
      }

      return msg.reply("✅ Posted + pinned the verification instructions in #verify.");
    }

    // ---- VERIFY (accept both verify + verifiy) ----
    if (cmd === "verify" || cmd === "verifiy") {
      const name = args.join(" ").trim();
      if (!name) return msg.reply(`Usage: ${PREFIX}verify YourHabboName`);

      const code = pending.get(msg.author.id);
      if (!code) return msg.reply(`Use \`${PREFIX}getcode\` first.`);

      await msg.reply("Checking your Habbo motto...");

      try {
        const motto = await fetchHabboMotto(name);

        const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
        if (!norm(motto).includes(norm(code))) {
          return msg.reply(
            `Motto doesn't match yet.\n` +
            `Expected to include: **${code}**\n` +
            `Found motto: **${motto || "(empty)"}**\n\n` +
            `Tip: wait 10–30 seconds after changing your motto, then try again.`
          );
        }

        const member = await msg.guild.members.fetch(msg.author.id);

        const verifiedRole = msg.guild.roles.cache.find((r) => r.name === VERIFIED_ROLE);
        if (!verifiedRole) return msg.reply("Verified role not found.");

        await member.roles.add(verifiedRole);

        const oldRole = msg.guild.roles.cache.find((r) => r.name === OLD_ROLE_TO_REMOVE);
        if (oldRole) await member.roles.remove(oldRole).catch(() => {});

        if (member.manageable) {
          await member.setNickname(name.slice(0, 32)).catch(() => {});
        }

        pending.delete(msg.author.id);

        sendLogEmbed(msg.guild, verifiedEmbed(msg.author.id, name));
        return msg.reply("✅ You are verified!");
      } catch (err) {
        return msg.reply(`Verification failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

// ====== LOGIN ======
client.login(process.env.DISCORD_TOKEN).catch(console.error);
