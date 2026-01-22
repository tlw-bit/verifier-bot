console.log("Bot starting...");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionsBitField
} = require("discord.js");
const path = require("path");
const fs = require("fs");

// ---- fetch support (Node 18+ has global fetch; fallback just in case) ----
const fetchFn = global.fetch || ((...args) => import("undici").then(m => m.fetch(...args)));

// ====== CONFIG ======
const PREFIX = "!";
const VERIFIED_ROLE = "Verified";
const OLD_ROLE_TO_REMOVE = "Unverified";
const VERIFY_CHANNEL_ID = "1462386529765691473";
const LOG_CHANNEL_ID = "1456955298597175391";
const WELCOME_CHANNEL_ID = "1456962809425559613";

// ====================

// userId -> code
const pending = new Map();

function makeCode() {
  return "verify-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function fetchHabboMotto(name) {
  const res = await fetchFn(
    `https://www.habbo.com/api/public/users?name=${encodeURIComponent(name)}`
  );
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
client.on("guildMemberAdd", async (member) => {
  try {
    const welcomeChannelId = "1456962809425559613";
    const verifyChannelId = "1462386529765691473";

    const welcomeChannel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
    if (!welcomeChannel || !welcomeChannel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle("👋 Welcome!")
      .setDescription(
        `Welcome to the server, <@${member.id}>!\n\n` +
        `Please head to <#${verifyChannelId}> to verify and get started.`
      )
      .setColor(0x2ecc71)
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();

    await welcomeChannel.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      allowedMentions: { users: [member.id] },
    }).catch(() => {});
  } catch (err) {
    console.error("guildMemberAdd error:", err?.stack || err);
  }
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

    console.log("CMD:", cmd, "FROM:", msg.author.tag, "IN:", msg.channel?.name);

    // ---- PING (test) ----
    if (cmd === "ping") {
      return msg.reply("pong ✅");
    }

    // ---- GETCODE (DMs the user their code) ----
    if (cmd === "getcode") {
      const code = makeCode();
      pending.set(msg.author.id, code);

      try {
        await msg.author.send(
          `✅ Your verification code is: **${code}**\n\n` +
          `Now set your Habbo motto to include that code, then come back and type:\n` +
          `\`${PREFIX}verify YourHabboName\``
        );
        return msg.reply("📩 I’ve sent your code in DMs! Check your messages.");
      } catch {
        return msg.reply(
          "❌ I couldn’t DM you. Please turn on **Allow direct messages** for this server, then try again."
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
            `➡️ **Head to:** <#${VERIFY_CHANNEL_ID}>`,
            "✅ **Say:** `!verify (your habbo name)`",
            "",
            "🎉 **Done!**",
          ].join("\n")
        )
        .setImage("attachment://verify-guide.png")
        .setColor(0x5865F2);

      const sent = await channel.send({ embeds: [embed], files: [attachment] });

      try {
        await sent.pin();
        return msg.reply("✅ Posted + pinned the verification instructions in #verify.");
      } catch {
        return msg.reply("✅ Posted the verification message, but I couldn't pin it (need **Manage Messages**).");
      }
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
            `Tip: wait 10-30 seconds after changing your motto, then try again.`
          );
        }

        const member = await msg.guild.members.fetch(msg.author.id);

        const verifiedRole = msg.guild.roles.cache.find(r => r.name === VERIFIED_ROLE);
        if (!verifiedRole) return msg.reply("Verified role not found.");

        await member.roles.add(verifiedRole);

        const oldRole = msg.guild.roles.cache.find(r => r.name === OLD_ROLE_TO_REMOVE);
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

// ====== LOGIN (exactly once) ======
const token = (process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error("❌ No DISCORD_TOKEN set in environment variables.");
  process.exit(1);
}
client.login(token).catch(console.error);


