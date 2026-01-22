console.log("Bot starting...");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionsBitField,
} = require("discord.js");
const path = require("path");
const fs = require("fs");

// ---- fetch support (Node 18+ has global fetch; fallback just in case) ----
const fetchFn =
  global.fetch || ((...args) => import("undici").then((m) => m.fetch(...args)));

// ====== CONFIG ======
const PREFIX = "!";
const VERIFIED_ROLE = "Verified";
const OLD_ROLE_TO_REMOVE = "Unverified";
const VERIFY_CHANNEL_ID = "1462386529765691473";
const LOG_CHANNEL_ID = "1456955298597175391";
const WELCOME_CHANNEL_ID = "1456962809425559613";
// ====================

// ====== INVITE TRACKING STORAGE ======
const INVITES_FILE = path.join(__dirname, "invites.json");

function loadInvitesData() {
  if (!fs.existsSync(INVITES_FILE)) return { counts: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(INITES_FILE, "utf8"));
    if (!parsed.counts) parsed.counts = {};
    return parsed;
  } catch {
    return { counts: {} };
  }
}

// FIX: typo guard (in case file was previously saved wrong)
function loadInvitesDataSafe() {
  if (!fs.existsSync(INVITES_FILE)) return { counts: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(INVITES_FILE, "utf8"));
    if (!parsed.counts) parsed.counts = {};
    return parsed;
  } catch {
    return { counts: {} };
  }
}

function saveInvitesData(obj) {
  fs.writeFileSync(INVITES_FILE, JSON.stringify(obj, null, 2), "utf8");
}

let invitesData = loadInvitesDataSafe();
// ===================================

// userId -> code
const pending = new Map();

function makeCode() {
  return "verify-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function fetchHabboMotto(name) {
  const base = "https://www.habbo.com";
  const url = `${base}/api/public/users?name=${encodeURIComponent(name)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (VerifierBot; +https://discord.com) VerifierBot/1.0",
        Referer: "https://www.habbo.com/",
      },
    });

    // log after res exists
    console.log("[Habbo API]", res.status, url);

    // If Habbo blocks you, this is often HTML not JSON
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log("Habbo API blocked:", res.status, text.slice(0, 300));

      if (res.status === 403) {
        throw new Error(
          "Habbo is blocking this bot's IP (403). This usually happens on bot hosts/VPS. Try hosting the bot on a different network/IP."
        );
      }
      if (res.status === 404) throw new Error("Habbo user not found on habbo.com.");
      if (res.status === 429) throw new Error("Too many requests. Try again in a moment.");

      throw new Error(`Habbo API error (${res.status}).`);
    }

    const data = await res.json();
    return (data?.motto || "").trim();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Habbo API timed out. Try again.");
    throw err;
  } finally {
    clearTimeout(t);
  }
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
    .setColor(0x57f287)
    .addFields(
      { name: "User", value: `<@${userId}>`, inline: true },
      { name: "Habbo Name", value: habboName, inline: true }
    )
    .setTimestamp();
}

function joinEmbed(member) {
  return new EmbedBuilder()
    .setTitle("✅ Member Joined")
    .setColor(0x57f287)
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
    .setColor(0xed4245)
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
    GatewayIntentBits.GuildMembers,
  ],
});

// ====== INVITE CACHE (guildId -> Map(code -> uses)) ======
const invitesCache = new Map();

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
    invitesCache.set(guild.id, map);
  } catch (e) {
    console.warn("⚠️ Could not fetch invites for guild:", guild.id, e?.message || e);
  }
}

client.on("inviteCreate", async (invite) => {
  if (!invite.guild) return;
  await cacheGuildInvites(invite.guild);
});

client.on("inviteDelete", async (invite) => {
  if (!invite.guild) return;
  await cacheGuildInvites(invite.guild);
});

// ====== JOIN / LEAVE + INVITE DETECTION + WELCOME ======
client.on("guildMemberAdd", async (member) => {
  sendLogEmbed(member.guild, joinEmbed(member));

  let inviterId = null;
  let inviteCodeUsed = null;

  try {
    const before = invitesCache.get(member.guild.id) || new Map();

    const invites = await member.guild.invites.fetch();
    const after = new Map();
    invites.forEach((inv) => after.set(inv.code, inv.uses ?? 0));

    let usedInvite = null;
    for (const inv of invites.values()) {
      const prevUses = before.get(inv.code) ?? 0;
      const nowUses = inv.uses ?? 0;
      if (nowUses > prevUses) {
        usedInvite = inv;
        break;
      }
    }

    invitesCache.set(member.guild.id, after);

    if (usedInvite?.inviter?.id) {
      inviterId = usedInvite.inviter.id;
      inviteCodeUsed = usedInvite.code;

      invitesData.counts[inviterId] = (invitesData.counts[inviterId] || 0) + 1;
      saveInvitesData(invitesData);
    }
  } catch (e) {
    console.warn("⚠️ Invite detection failed:", e?.message || e);
  }

  try {
    const welcomeChannel = await member.guild.channels
      .fetch(WELCOME_CHANNEL_ID)
      .catch(() => null);
    if (!welcomeChannel || !welcomeChannel.isTextBased()) return;

    const invitedLine = inviterId
      ? `👤 **Invited by:** <@${inviterId}>${inviteCodeUsed ? ` (code: \`${inviteCodeUsed}\`)` : ""}`
      : `👤 **Invited by:** _(unknown)_`;

    const embed = new EmbedBuilder()
      .setTitle("👋 Welcome!")
      .setDescription(
        `Welcome to the server, <@${member.id}>!\n\n` +
          `${invitedLine}\n\n` +
          `Please head to <#${VERIFY_CHANNEL_ID}> to verify and get started.`
      )
      .setColor(0x2ecc71)
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();

    await welcomeChannel.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      allowedMentions: { users: inviterId ? [member.id, inviterId] : [member.id] },
    });
  } catch (err) {
    console.error("welcome send error:", err?.message || err);
  }
});

client.on("guildMemberRemove", (member) => {
  sendLogEmbed(member.guild, leaveEmbed(member));
});

// ====== READY ======
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }
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

    if (cmd === "ping") {
      return msg.reply("pong ✅");
    }

    if (cmd === "invites") {
      const user = msg.mentions.users.first() || msg.author;
      const count = invitesData.counts[user.id] || 0;
      return msg.reply(`📨 <@${user.id}> has **${count}** invite(s).`);
    }

    if (cmd === "invleaderboard" || cmd === "inviteleaderboard") {
      const entries = Object.entries(invitesData.counts || {})
        .map(([uid, count]) => ({ uid, count: Number(count) || 0 }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 25);

      if (!entries.length) return msg.reply("No invites tracked yet.");

      const lines = entries.map((x, i) => `**${i + 1}.** <@${x.uid}> — **${x.count}**`);

      const embed = new EmbedBuilder()
        .setTitle("🏆 Invite Leaderboard")
        .setDescription(lines.join("\n"))
        .setColor(0x5865f2)
        .setTimestamp();

      return msg.reply({ embeds: [embed] });
    }

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
        .setColor(0x5865f2);

      const sent = await channel.send({ embeds: [embed], files: [attachment] });

      try {
        await sent.pin();
        return msg.reply("✅ Posted + pinned the verification instructions in #verify.");
      } catch {
        return msg.reply("✅ Posted the verification message, but I couldn't pin it (need **Manage Messages**).");
      }
    }

    if (cmd === "verify" || cmd === "verifiy") {
      const name = args.join(" ").trim();
      if (!name) return msg.reply(`Usage: ${PREFIX}verify YourHabboName`);

      const code = pending.get(msg.author.id);
      if (!code) return msg.reply(`Use \`${PREFIX}getcode\` first.`);

      await msg.reply("Checking your Habbo motto...");

      try {
        const motto = await fetchHabboMotto(name);

        if (!motto) {
          return msg.reply(
            `I found the account, but the motto came back empty.\n` +
              `Make sure the motto is set and try again in 10–30 seconds.`
          );
        }

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

// ====== LOGIN (exactly once) ======
const token = (process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error("❌ No DISCORD_TOKEN set in environment variables.");
  process.exit(1);
}
client.login(token).catch(console.error);
