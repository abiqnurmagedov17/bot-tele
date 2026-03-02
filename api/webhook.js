import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

let currentModel = process.env.DEFAULT_MODEL || "copilot";
let adminUser = null;

/* ================= REDIS HELPER ================= */

async function redis(command, args = []) {
  const response = await axios.post(
    REDIS_URL,
    { command: [command, ...args] },
    {
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  return response.data.result;
}

async function saveMessage(userId, role, content) {
  const key = `chat:${userId}`;

  await redis("LPUSH", [
    key,
    JSON.stringify({ role, content })
  ]);

  await redis("LTRIM", [key, 0, 9]); // max 10 pesan
}

async function getHistory(userId) {
  const key = `chat:${userId}`;
  const messages = await redis("LRANGE", [key, 0, 9]);

  if (!messages) return [];

  return messages.map(m => JSON.parse(m)).reverse();
}

/* ================= TELEGRAM HELPER ================= */

async function sendMessage(chatId, text, markdown = false) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: markdown ? "Markdown" : undefined
  });
}

async function sendTyping(chatId) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
    chat_id: chatId,
    action: "typing"
  });
}

/* ================= MAIN HANDLER ================= */

export default async function handler(req, res) {
  cors()(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(200).json({ status: "ok" });
    }

    const message = req.body.message;
    if (!message || !message.text) {
      return res.status(200).end();
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;

    /* ===== /start ===== */
    if (text === "/start") {
      const info = `
🤖 *AI Telegram Bot*

Bot ini pakai Magma API + Redis Session.

📌 Commands:
/login <password>  - Login admin
/model <nama>      - Ganti model (admin)
/reset             - Reset session

🧠 Model tersedia:
- copilot
- gpt5
- muslim

Ketik apa saja buat mulai ngobrol.
      `;

      await sendMessage(chatId, info, true);
      return res.status(200).end();
    }

    /* ===== /login ===== */
    if (text.startsWith("/login")) {
      const pass = text.split(" ")[1];

      if (pass === ADMIN_PASSWORD) {
        adminUser = userId;
        await sendMessage(chatId, "✅ Login admin berhasil.");
      } else {
        await sendMessage(chatId, "❌ Password salah.");
      }

      return res.status(200).end();
    }

    /* ===== /model ===== */
    if (text.startsWith("/model")) {
      if (userId !== adminUser) {
        await sendMessage(chatId, "❌ Hanya admin yang bisa ganti model.");
        return res.status(200).end();
      }

      const newModel = text.split(" ")[1];

      if (!["copilot", "gpt5", "muslim"].includes(newModel)) {
        await sendMessage(chatId, "❌ Model tidak tersedia.");
        return res.status(200).end();
      }

      currentModel = newModel;
      await sendMessage(chatId, `✅ Model diganti ke ${newModel}`);
      return res.status(200).end();
    }

    /* ===== /reset ===== */
    if (text === "/reset") {
      await redis("DEL", [`chat:${userId}`]);
      await sendMessage(chatId, "🗑 Session direset.");
      return res.status(200).end();
    }

    /* ===== CHAT BIASA ===== */

    await sendTyping(chatId);

    try {
      // ambil history
      const history = await getHistory(userId);

      // gabung context
      let contextPrompt = history
        .map(m => `${m.role}: ${m.content}`)
        .join("\n");

      contextPrompt += `\nuser: ${text}`;

      // simpan pesan user
      await saveMessage(userId, "user", text);

      const apiUrl = `https://magma-api.biz.id/ai/${currentModel}?prompt=${encodeURIComponent(contextPrompt)}`;

      const response = await axios.get(apiUrl);

      if (response.data.status) {
        const aiReply = response.data.result.response;

        await saveMessage(userId, "assistant", aiReply);

        await sendMessage(chatId, aiReply);
      } else {
        await sendMessage(chatId, "❌ API error.");
      }

    } catch (err) {
      await sendMessage(chatId, "⚠️ Terjadi kesalahan.");
    }

    res.status(200).end();
  });
}