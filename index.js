// ===================== CHUNK 1/4 =====================
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
const { createCanvas, loadImage } = require("canvas");

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

// ====== XP / LEVELING CONFIG ======
const XP_FILE = path.join(__dirname, "xp.json");

// If you want XP only in specific channels, put IDs here. Leave [] to allow everywhere.
const XP_ALLOWED_CHANNEL_IDS = []; // e.g. ["123", "456"]

// If you want to block channels from earning XP, put IDs here.
const XP_BLOCKED_CHANNEL_IDS = ["1462386529765691473"]; // e.g. ["999"]

const XP_MIN = 10;
const XP_MAX = 20;
const XP_COOLDOWN_SECONDS = 60;
const PRESTIGE_AT_LEVEL = 50;     // prestige when reaching this level
const PRESTIGE_RESET_LEVEL = 1;   // new level after prestige
const PRESTIGE_RESET_XP = 0;      // xp after prestige

// Where to announce level-ups (optional). Leave "" to announce in the same channel.
const LEVEL_UP_CHANNEL_ID = "1456967580299559066";

// Optional level roles: level -> roleId
const LEVEL_ROLES = {
  2: "1462479094859038773",  // Pool’s Closed
  5: "1462479797304295535",  // Chair Rotator (PRO)
  8: "1462480092910587925",  // Fake HC Member
  12:"1462480383328129075",  // HC Member (Trust Me)
  16:"1462480917322010715",  // Coin Beggar
  20:"1462480684496060728",  // Club NX Bouncer
  25:"1462481138546381127",  // Dancefloor Menace
  30:"1462481539391684760",  // Definitely Legit
  40:"1462478268199600129",  // Touch Grass Challenge Failed
  50:"1462478548961857844",  // Hotel Legend (Unemployed)
};

// ====== RANK CARD: ROLE ACCENT COLOURS ======
// roleId -> hex colour
const ROLE_ACCENTS = {
  "1462479094859038773": "#facc15", // lvl 2
  "1462479797304295535": "#d97706", // lvl 5
  "1462480092910587925": "#3b82f6", // lvl 8
  "1462480383328129075": "#22c55e", // lvl 12
  "1462480917322010715": "#f59e0b", // lvl 16
  "1462480684496060728": "#a855f7", // lvl 20
  "1462481138546381127": "#ec4899", // lvl 25
  "1462481539391684760": "#10b981", // lvl 30
  "1462478268199600129": "#16a34a", // lvl 40
  "1462478548961857844": "#38bdf8", // lvl 50
};

// fallback accent if no mapped roles are found
const DEFAULT_ACCENT = "#5865f2";

// ====== INVITE TRACKING STORAGE ======
const INVITES_FILE = path.join(__dirname, "invites.json");

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

// userId -> Habbo verification code
const pending = new Map();

function makeCode() {
  return "verify-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}
// ===================== CHUNK 2/4 =====================
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

    console.log("[Habbo API]", res.status, url);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log("Habbo API blocked:", res.status, text.slice(0, 300));

      if (res.status === 403) {
        throw new Error(
          "Habbo is blocking this bot's IP (403). Try hosting the bot on a different network/IP."
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
      ? `👤 **Invited by:** <@${inviterId}>${
          inviteCodeUsed ? ` (code: \`${inviteCodeUsed}\`)` : ""
        }`
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
// ===================== CHUNK 3/4 =====================
// ====== XP / LEVELING STORAGE ======
function loadXpDataSafe() {
  if (!fs.existsSync(XP_FILE)) return { users: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(XP_FILE, "utf8"));
    if (!parsed.users) parsed.users = {};
    return parsed;
  } catch {
    return { users: {} };
  }
}

function saveXpData(obj) {
  fs.writeFileSync(XP_FILE, JSON.stringify(obj, null, 2), "utf8");
}

let xpData = loadXpDataSafe();

function ensureXpUser(userId) {
  if (!xpData.users[userId]) {
    xpData.users[userId] = {
      xp: 0,
      level: 1,
      prestige: 0,      // ✅ NEW
      lastXpAt: 0,
    };
  } else {
    // ✅ Backwards compatible: add prestige to old saves
    if (typeof xpData.users[userId].prestige !== "number") xpData.users[userId].prestige = 0;
  }
  return xpData.users[userId];
}


// XP curve
function xpNeeded(level) {
  return 100 + (level - 1) * 50;
}

function shouldAwardXp(channelId) {
  const cid = String(channelId);
  if (XP_BLOCKED_CHANNEL_IDS.map(String).includes(cid)) return false;
  if (XP_ALLOWED_CHANNEL_IDS.length > 0 && !XP_ALLOWED_CHANNEL_IDS.map(String).includes(cid)) return false;
  return true;
}

function randInt(min, max) {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return Math.floor(Math.random() * (b - a + 1)) + a;
}
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "levels") return;

    const u = interaction.options.getUser("user") || interaction.user;
    const userObj = ensureXpUser(u.id);
    const needed = xpNeeded(userObj.level);

    await interaction.reply(
      `📈 <@${u.id}> is **Level ${userObj.level}**\n` +
      `XP: **${userObj.xp}/${needed}**` +
      (userObj.prestige ? `\n⭐ Prestige: **${userObj.prestige}**` : "")
    );
  } catch (e) {
    console.error("interactionCreate error:", e);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: "Something went wrong 😬", ephemeral: true }).catch(() => {});
    }
  }
});

// Global rank: order by level desc, then xp desc
function getGlobalRank(userId) {
  const entries = Object.entries(xpData.users || {})
    .map(([uid, u]) => ({ uid, level: Number(u.level) || 1, xp: Number(u.xp) || 0 }))
    .sort((a, b) => (b.level - a.level) || (b.xp - a.xp));

  const total = entries.length || 1;
  const idx = entries.findIndex((x) => x.uid === userId);
  return { rank: idx >= 0 ? idx + 1 : total, total };
}

function getInviteCount(userId) {
  return Number(invitesData?.counts?.[userId] || 0);
}

function pickAccentForMember(member) {
  if (!member) return DEFAULT_ACCENT;

  // If they have any of the level roles, use that accent colour
  for (const [roleId, hex] of Object.entries(ROLE_ACCENTS)) {
    if (member.roles.cache.has(roleId)) return hex;
  }

  // Fallback: highest coloured role in Discord
  const coloured = member.roles.cache
    .filter((r) => r.color && r.color !== 0)
    .sort((a, b) => b.position - a.position)
    .first();

  return coloured?.hexColor || DEFAULT_ACCENT;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, startSize, fontFamily = "Sans") {
  let size = startSize;
  do {
    ctx.font = `bold ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  } while (size > 10);
  return size;
}

function drawPill(ctx, x, y, w, h, fill, stroke) {
  ctx.save();
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();

  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.stroke();
  }
  ctx.restore();
}

async function generateRankCard(member, userObj) {
  const user = member.user;

  const width = 934;
  const height = 282;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const accent = pickAccentForMember(member);
  const needed = xpNeeded(userObj.level);
  const progress = Math.max(0, Math.min(userObj.xp / needed, 1));

  const { rank, total } = getGlobalRank(user.id);
  const invites = getInviteCount(user.id);

  // Background
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, width, height);

  // Card panel
  ctx.fillStyle = "#0f172a";
  roundRect(ctx, 18, 18, width - 36, height - 36, 18);
  ctx.fill();

  // Accent strip
  ctx.fillStyle = accent;
  ctx.fillRect(18, 18, width - 36, 8);

  // Avatar
  const avatarURL = user.displayAvatarURL({ extension: "png", size: 256 });
  const avatar = await loadImage(avatarURL);

  ctx.save();
  ctx.beginPath();
  ctx.arc(122, 141, 68, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, 54, 73, 136, 136);
  ctx.restore();

  // Name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 34px Sans";
  ctx.fillText(user.username, 220, 108);

 // Tag line + Prestige badge
const prestige = Number(userObj.prestige || 0);

const rowX = 220;
const rowY = 140;

// Prestige pill (hide it if prestige is 0)
let afterPillX = rowX;

if (prestige > 0) {
  const pillH = 26;
  const pillY = rowY - 18;
  const prestigeText = `⭐ PRESTIGE ${prestige}`;

  ctx.font = "bold 14px Sans";
  const textPadX = 14;
  const pillW = Math.max(
    120,
    Math.ceil(ctx.measureText(prestigeText).width) + textPadX * 2
  );

  drawPill(ctx, rowX, pillY, pillW, pillH, "#111827", accent);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px Sans";
  ctx.fillText(prestigeText, rowX + textPadX, pillY + 18);

  afterPillX = rowX + pillW + 16;
}

// Rest of line
const restText = `Level ${userObj.level} • ${userObj.xp}/${needed} XP`;
const maxRestWidth = width - 36 - afterPillX - 20;
const restSize = fitText(ctx, restText, maxRestWidth, 18, "Sans");

  ctx.fillStyle = "#94a3b8";
  ctx.font = `${restSize}px Sans`;
  ctx.fillText(restText, rowX + pillW + 16, rowY);

  // Global rank + invites
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "18px Sans";
  ctx.fillText(`🏆 #${rank} / ${total}`, 220, 172);
  ctx.fillText(`🎟️ Invites: ${invites}`, 220, 198);

  // XP bar bg
  const barX = 220;
  const barY = 220;
  const barW = 680;
  const barH = 26;

  ctx.fillStyle = "#111827";
  roundRect(ctx, barX, barY, barW, barH, 12);
  ctx.fill();

  // XP bar fill
  ctx.fillStyle = accent;
  roundRect(ctx, barX, barY, Math.max(10, barW * progress), barH, 12);
  ctx.fill();

  // XP % text
  ctx.fillStyle = "#0b1220";
  ctx.font = "bold 14px Sans";
  const pct = Math.round(progress * 100);
  ctx.fillText(`${pct}%`, barX + barW - 42, barY + 18);

  return canvas.toBuffer();
}


// ---------- LEVEL ROLES + LEVEL-UP ANNOUNCEMENTS ----------
function getLevelRolePairsSorted(guild) {
  return Object.entries(LEVEL_ROLES)
    .map(([lvl, roleId]) => ({ lvl: Number(lvl), roleId: String(roleId) }))
    .filter((x) => Number.isFinite(x.lvl) && x.lvl > 0 && x.roleId && guild.roles.cache.get(x.roleId))
    .sort((a, b) => a.lvl - b.lvl);
}

// Removes old level roles, keeps ONLY the correct one
async function applyLevelRoles(member, level) {
  const pairs = getLevelRolePairsSorted(member.guild);
  if (!pairs.length) return;

  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

  const allLevelRoleIds = pairs.map((p) => p.roleId);

  const eligible = pairs.filter((p) => p.lvl <= level);
  if (!eligible.length) {
    await member.roles.remove(allLevelRoleIds).catch(() => {});
    return;
  }

  const targetRoleId = eligible[eligible.length - 1].roleId;

  const rolesToRemove = allLevelRoleIds.filter((id) => id !== targetRoleId);
  if (rolesToRemove.length) await member.roles.remove(rolesToRemove).catch(() => {});

  if (!member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId).catch(() => {});
  }
}

function cringeLevelUpLine(level, userMention) {
  const lines = {
    2:  `🚧 ${userMention} unlocked **Pool’s Closed**. Lifeguard is imaginary.`,
    5:  `🪑 ${userMention} is now **Chair Rotator (PRO)**. Spin responsibly.`,
    8:  `🧢 ${userMention} achieved **Fake HC Member**. Badge? Never heard of it.`,
    12: `🧃 ${userMention} unlocked **HC Member (Trust Me)**. Source: “trust me”.`,
    16: `🪙 🚨 WARNING: ${userMention} has reached **Coin Beggar** status.`,
    20: `🚪 ${userMention} promoted to **Club NX Bouncer**. Pay: exposure.`,
    25: `🕺 DANGER: ${userMention} is now a **Dancefloor Menace**.`,
    30: `🧾 ${userMention} is now **Definitely Legit**. Nothing to see here.`,
    40: `🌱 INTERVENTION: ${userMention} unlocked **Touch Grass Challenge Failed**.`,
    50: `🏨 FINAL FORM: ${userMention} became **Hotel Legend (Unemployed)**. The hotel owns you now.`,
  };
  return lines[level] || `✨ ${userMention} leveled up to **Level ${level}**!`;
}

async function announceLevelUp(guild, fallbackChannel, user, newLevel) {
  const userMention = `<@${user.id}>`;
  const line = cringeLevelUpLine(newLevel, userMention);

  let targetChannel = fallbackChannel;

  if (LEVEL_UP_CHANNEL_ID) {
    const ch =
      guild.channels.cache.get(LEVEL_UP_CHANNEL_ID) ||
      (await guild.channels.fetch(LEVEL_UP_CHANNEL_ID).catch(() => null));

    if (ch && ch.isTextBased()) targetChannel = ch;
  }

  if (targetChannel) {
    await targetChannel.send({ content: line }).catch(() => {});
  }
}

async function processLevelUps({ guild, channel, userObj, userDiscord, member }) {
  while (userObj.xp >= xpNeeded(userObj.level)) {
    userObj.xp -= xpNeeded(userObj.level);
    userObj.level += 1;

    // ✅ PRESTIGE check
    if (userObj.level >= PRESTIGE_AT_LEVEL) {
      userObj.prestige = Number(userObj.prestige || 0) + 1;

      // reset
      userObj.level = PRESTIGE_RESET_LEVEL;
      userObj.xp = PRESTIGE_RESET_XP;

      // OPTIONAL: announce "hit level 50" first (delete if you want only 1 message)
      await announceLevelUp(guild, channel, userDiscord, PRESTIGE_AT_LEVEL).catch(() => {});

      // Send prestige message to level-up channel (if set), otherwise current channel
      const userMention = `<@${userDiscord.id}>`;
      const prestigeMsg =
        `🏨✨ ${userMention} hit **Level ${PRESTIGE_AT_LEVEL}** and unlocked ` +
        `**PRESTIGE ${userObj.prestige}**! Back to Level ${PRESTIGE_RESET_LEVEL} we go.`;

      let targetChannel = channel;

      if (LEVEL_UP_CHANNEL_ID) {
        const ch =
          guild.channels.cache.get(LEVEL_UP_CHANNEL_ID) ||
          (await guild.channels.fetch(LEVEL_UP_CHANNEL_ID).catch(() => null));
        if (ch && ch.isTextBased()) targetChannel = ch;
      }

      if (targetChannel) {
        await targetChannel.send({ content: prestigeMsg }).catch(() => {});
      }

      // remove ALL level roles (since they're back to level 1)
      if (member) {
        const pairs = getLevelRolePairsSorted(member.guild);
        const allLevelRoleIds = pairs.map((p) => p.roleId);
        if (allLevelRoleIds.length) {
          await member.roles.remove(allLevelRoleIds).catch(() => {});
        }
      }

      // Important: stop looping this prestige cycle (xp is reset anyway)
      break;
    }

    // normal level-up
    await announceLevelUp(guild, channel, userDiscord, userObj.level).catch(() => {});
    if (member) await applyLevelRoles(member, userObj.level).catch(() => {});
  }
}

// ===================== CHUNK 4/4 =====================
// ====== COMMANDS + XP ======
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.guild) return;

    const isCommand = msg.content.startsWith(PREFIX);

    // ====== XP AWARDING (runs on non-command messages) ======
    if (!isCommand && shouldAwardXp(msg.channel.id)) {
      const userObj = ensureXpUser(msg.author.id);
      const now = Date.now();

      if (now - (userObj.lastXpAt || 0) >= XP_COOLDOWN_SECONDS * 1000) {
        const gained = randInt(XP_MIN, XP_MAX);
        userObj.lastXpAt = now;
        userObj.xp += gained;

        const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);

        await processLevelUps({
          guild: msg.guild,
          channel: msg.channel,
          userObj,
          userDiscord: msg.author,
          member,
        });

        saveXpData(xpData);
      }
    }

    if (!isCommand) return;

    const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (args.shift() || "").toLowerCase();

    console.log("CMD:", cmd, "FROM:", msg.author.tag, "IN:", msg.channel?.name);

    // ---- XP commands ----
    if (cmd === "level" || cmd === "xp") {
      const u = msg.mentions.users.first() || msg.author;
      const userObj = ensureXpUser(u.id);
      const needed = xpNeeded(userObj.level);

      return msg.reply(
        `📈 <@${u.id}> is **Level ${userObj.level}**\n` +
          `XP: **${userObj.xp}/${needed}**`
      );
    }

    if (cmd === "xpleaderboard" || cmd === "lblevel") {
      const entries = Object.entries(xpData.users || {})
        .map(([uid, u]) => ({ uid, level: Number(u.level) || 1, xp: Number(u.xp) || 0 }))
        .sort((a, b) => (b.level - a.level) || (b.xp - a.xp))
        .slice(0, 20);

      if (!entries.length) return msg.reply("No XP data yet.");

      const lines = entries.map(
        (x, i) => `**${i + 1}.** <@${x.uid}> — **Lvl ${x.level}** (${x.xp}xp)`
      );

      const embed = new EmbedBuilder()
        .setTitle("🏆 XP Leaderboard")
        .setDescription(lines.join("\n"))
        .setColor(0x5865f2)
        .setTimestamp();

      return msg.reply({ embeds: [embed] });
    }

    // ---- Rank card (MEE6-style) ----
    if (cmd === "rank" || cmd === "card") {
      const u = msg.mentions.users.first() || msg.author;
      const member = await msg.guild.members.fetch(u.id).catch(() => null);
      if (!member) return msg.reply("Couldn't fetch that member.");

      const userObj = ensureXpUser(u.id);

      const buf = await generateRankCard(member, userObj).catch((e) => {
        console.error("rank card error:", e);
        return null;
      });
      if (!buf) return msg.reply("Failed to generate rank card.");

      const att = new AttachmentBuilder(buf, { name: "rank.png" });
      return msg.reply({ files: [att] });
    }

    // ---- Other commands ----
    if (cmd === "ping") return msg.reply("pong ✅");

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
        return msg.reply(
          "✅ Posted the verification message, but I couldn't pin it (need **Manage Messages**)."
        );
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

