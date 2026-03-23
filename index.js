// ╔══════════════════════════════════════════════════════════════╗
// ║        SHADOW AI - WhatsApp Bot (Fixed - No .env)           ║
// ║   API: Gemini 2.0 Flash - يدعم الصور والنصوص 100%          ║
// ║   ضع مفتاح API مباشرة هنا 👇                                ║
// ╚══════════════════════════════════════════════════════════════╝

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import fetch from 'node-fetch';

// ═══════════════════════════════════════════════════════════════
//  🔧 ضع مفتاح API هنا مباشرة ⬇️
// ═══════════════════════════════════════════════════════════════
const GEMINI_API_KEY = "AIzaSyDLUbfWBi53uAIQJycSUo8JnDcde5g53Nw"; // ⚠️ استبدل هذا بمفتاحك الحقيقي

// ═══════════════════════════════════════════════════════════════
//  إعدادات البوت
// ═══════════════════════════════════════════════════════════════
const BOT_NUMBER = "212710047868";     // رقم البوت بدون +
const MEMORY_LIMIT = 100;              // عدد الرسائل المحفوظة لكل مستخدم

// ═══════════════════════════════════════════════════════════════
//  المسارات
// ═══════════════════════════════════════════════════════════════
const ROOT        = process.cwd();
const TMP         = path.join(ROOT, 'tmp');
const MEMORY_FILE = path.join(ROOT, 'memory.json');
const SESSIONS    = path.join(ROOT, 'sessions');

// إنشاء المجلدات إذا لم توجد
if (!fs.existsSync(TMP))      fs.mkdirSync(TMP,      { recursive: true });
if (!fs.existsSync(SESSIONS)) fs.mkdirSync(SESSIONS, { recursive: true });

// ═══════════════════════════════════════════════════════════════
//  دالة استدعاء Gemini (المُصلحة - تدعم الصور)
// ═══════════════════════════════════════════════════════════════
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

async function callGemini(history, imageBase64 = null, imageMime = 'image/jpeg') {
  const contents = [];

  // System Prompt - تعليمات واضحة
  contents.push({
    role: "user",
    parts: [{ text: `You are Shadow AI, an advanced assistant.
IMPORTANT RULES:
- You CAN see and analyze images. You are NOT a text-only model.
- When an image is provided, DESCRIBE and ANALYZE it in detail.
- NEVER say "I cannot see images" or "I'm a text model".
- Reply in the SAME LANGUAGE as the user.
- Use conversation history for context.
- Be helpful, concise, and accurate.` }]
  });
  
  contents.push({
    role: "model",
    parts: [{ text: "Understood. I am Shadow AI, I can analyze images and will always help in the user's language." }]
  });

  // إضافة سجل المحادثة السابقة
  for (let i = 0; i < history.length - 1; i++) {
    const msg = history[i];
    contents.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.text }]
    });
  }

  // الرسالة الأخيرة مع الصورة
  const lastMsg = history[history.length - 1];
  const parts = [];

  // إضافة النص
  if (lastMsg.text && lastMsg.text.trim()) {
    parts.push({ text: lastMsg.text });
  } else if (!imageBase64) {
    parts.push({ text: "What do you see in this image?" });
  }

  // ✅ إضافة الصورة بالتنسيق الصحيح
  if (imageBase64) {
    parts.push({
      inlineData: {
        mimeType: imageMime,
        data: imageBase64
      }
    });
    console.log('📸 ✅ تم إضافة الصورة للطلب');
  }

  contents.push({
    role: "user",
    parts: parts
  });

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          topP: 0.95
        }
      })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('❌ Gemini Error:', data.error?.message);
      throw new Error(data.error?.message || 'API request failed');
    }

    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
      return "⚠️ لم أستطع معالجة الطلب. حاول مرة أخرى.";
    }

    return responseText;

  } catch (error) {
    console.error('❌ Gemini API Error:', error.message);
    return `⚠️ خطأ: ${error.message}`;
  }
}

// ═══════════════════════════════════════════════════════════════
//  إدارة الذاكرة
// ═══════════════════════════════════════════════════════════════
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      console.log(`📂 تم تحميل الذاكرة: ${Object.keys(parsed).length} مستخدم`);
      return parsed;
    }
  } catch (e) { 
    console.error('❌ خطأ في تحميل الذاكرة:', e.message); 
  }
  return {};
}

function saveMemory(mem) {
  try { 
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2), 'utf8'); 
  } catch (e) { 
    console.error('❌ خطأ في حفظ الذاكرة:', e.message); 
  }
}

let memory = loadMemory();

function getHistory(userId) {
  if (!memory[userId]) memory[userId] = [];
  return memory[userId];
}

// ═══════════════════════════════════════════════════════════════
//  معالجة الرسائل
// ═══════════════════════════════════════════════════════════════
async function processMessage(userId, text, imageBuffer = null, imageMime = 'image/jpeg') {
  const history = getHistory(userId);
  const cleanText = text?.trim() || (imageBuffer ? "ماذا ترى في هذه الصورة؟" : "");

  // إضافة رسالة المستخدم
  history.push({ role: 'user', text: cleanText });

  // تحويل الصورة لـ Base64
  let imageBase64 = null;
  if (imageBuffer && imageBuffer.length > 0) {
    imageBase64 = imageBuffer.toString('base64');
    console.log(`📸 حجم الصورة: ${Math.round(imageBuffer.length / 1024)}KB`);
  }

  // استدعاء Gemini
  const reply = await callGemini(history, imageBase64, imageMime);
  
  // إضافة رد البوت
  history.push({ role: 'model', text: reply });

  // الحفاظ على آخر 100 رسالة
  while (history.length > MEMORY_LIMIT) history.shift();

  // حفظ الذاكرة
  saveMemory(memory);

  return reply;
}

// ═══════════════════════════════════════════════════════════════
//  تشغيل البوت
// ═══════════════════════════════════════════════════════════════
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function startBot() {
  console.log('\n🚀 بدء تشغيل Shadow AI Bot...\n');

  const { state, saveCreds } = await useMultiFileAuthState(SESSIONS);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    pairingCode: true,
    logger: pino({ level: 'silent' }),
    browser: ['ShadowAI', 'Chrome', '1.0'],
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
  });

  // طلب كود الاقتران
  if (!sock.authState.creds.registered) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      let code = await sock.requestPairingCode(BOT_NUMBER);
      code = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log(`\n🔑 كود الربط: ${code}`);
      console.log('📱 افتح واتساب ← الإعدادات ← الأجهزة المرتبطة ← ربط بكود\n');
    } catch (err) {
      console.error('❌ فشل إنشاء كود الربط:', err.message);
      process.exit(1);
    }
  }

  // حفظ بيانات الجلسة
  sock.ev.on('creds.update', saveCreds);

  // مراقبة حالة الاتصال
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('🔄 إعادة الاتصال...');
        startBot();
      } else {
        console.log('👋 تم تسجيل الخروج');
        process.exit(0);
      }
    } else if (connection === 'open') {
      rl.close();
      console.log('\n✅ Shadow AI متصل وجاهز!');
      console.log(`💾 الذاكرة: ${MEMORY_FILE}`);
      console.log(`📸 يدعم تحليل الصور 100%\n`);
    }
  });

  // معالجة الرسائل
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (msg.key.fromMe || !msg.message) continue;

        const jid = msg.key.remoteJid;
        if (!jid.endsWith('@g.us')) continue;

        const msgContent = msg.message;
        const sender = msg.key.participant || msg.key.remoteJid;
        
        // استخراج النص
        let textMsg = msgContent.conversation ||
                      msgContent.extendedTextMessage?.text ||
                      msgContent.imageMessage?.caption || '';
        
        const isImage = !!msgContent.imageMessage;

        if (!textMsg && !isImage) continue;

        console.log(`\n📨 من: ${sender.split('@')[0]}`);
        console.log(`💬 نص: ${textMsg || '📷 صورة'}`);

        await sock.sendPresenceUpdate('composing', jid);

        // تحميل الصورة إذا وجدت
        let imageBuffer = null;
        let imageMime = 'image/jpeg';
        
        if (isImage) {
          try {
            imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
              reuploadRequest: sock.updateMediaMessage
            });
            
            imageMime = msgContent.imageMessage?.mimetype || 'image/jpeg';
            console.log(`📥 تم تحميل الصورة (${imageMime})`);
          } catch (err) {
            console.error('❌ فشل تحميل الصورة:', err.message);
            await sock.sendMessage(jid, { text: '❌ فشل تحميل الصورة' }, { quoted: msg });
            continue;
          }
        }

        // معالجة الرسالة
        const inputText = textMsg || '';
        const reply = await processMessage(sender, inputText, imageBuffer, imageMime);

        // إرسال الرد
        await sock.sendMessage(jid, { text: reply }, { quoted: msg });
        await sock.sendPresenceUpdate('paused', jid);
        
        console.log(`🤖 رد: ${reply.slice(0, 100)}${reply.length > 100 ? '...' : ''}`);

      } catch (err) {
        console.error('❌ خطأ:', err.message);
        try {
          await sock.sendMessage(msg.key.remoteJid, 
            { text: '⚠️ حدث خطأ. حاول مرة أخرى.' }, 
            { quoted: msg }
          );
        } catch {}
      }
    }
  });
}

// تشغيل البوت
startBot().catch(console.error);