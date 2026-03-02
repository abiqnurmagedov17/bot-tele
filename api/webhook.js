import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let currentModel = process.env.DEFAULT_MODEL || "copilot";
let adminUser = null;

export default async function handler(req, res) {
  cors()(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(200).json({ status: "ok" });
    }

    const message = req.body.message;
    if (!message) return res.status(200).end();

    const chatId = message.chat.id;
    const text = message.text;

    // ✅ START COMMAND
    if (text === "/start") {
      const info = `
🤖 *AI Telegram Bot*

Bot ini menggunakan API Magma AI.

📌 Commands:
/login <password>  - Login admin
/model <nama>      - Ganti model (admin only)

🧠 Model tersedia:
- copilot
- gpt5
- muslim

Ketik apa saja untuk mulai chat.
      `;

      await sendMessage(chatId, info, true);
      return res.status(200).end();
    }

    // Command login admin
    if (text.startsWith("/login")) {
      const pass = text.split(" ")[1];
      if (pass === ADMIN_PASSWORD) {
        adminUser = message.from.id;
        await sendMessage(chatId, "✅ Login admin berhasil.");
      } else {
        await sendMessage(chatId, "❌ Password salah.");
      }
      return res.status(200).end();
    }

    // Command ganti model
    if (text.startsWith("/model")) {
      if (message.from.id !== adminUser) {
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

    // 🔥 Typing status sebelum AI jawab
    await sendTyping(chatId);

    // Chat biasa
    try {
      const apiUrl = `https://magma-api.biz.id/ai/${currentModel}?prompt=${encodeURIComponent(text)}`;
      const response = await axios.get(apiUrl);

      if (response.data.status) {
        await sendMessage(chatId, response.data.result.response);
      } else {
        await sendMessage(chatId, "❌ API error.");
      }
    } catch (err) {
      await sendMessage(chatId, "⚠️ Terjadi kesalahan.");
    }

    res.status(200).end();
  });
}

async function sendMessage(chatId, text, markdown = false) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text: text,
    parse_mode: markdown ? "Markdown" : undefined
  });
}

async function sendTyping(chatId) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
    chat_id: chatId,
    action: "typing"
  });
}