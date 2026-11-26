const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require("qrcode-terminal");
const pino = require("pino");

// جلب مفتاح Gemini من إعدادات Deplexo
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function connectToWhatsApp() {
    // حفظ الجلسة في مجلد /data (مهم جداً لكي لا يفقد البوت الاتصال كل مرة)
    const { state, saveCreds } = await useMultiFileAuthState('/data/auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // سنطبع الرمز يدوياً ليظهر في السجلات
        logger: pino({ level: "silent" })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("\n=== امسح رمز QR التالي من واتساب ===\n");
            qrcode.generate(qr, { small: true }); // يطبع رمز QR في السجلات
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('تم إغلاق الاتصال. جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ تم الاتصال بواتساب بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text) {
            console.log(`رسالة من ${from}: ${text}`);
            try {
                // إرسال الرسالة إلى Gemini
                const result = await model.generateContent(text);
                const response = await result.response;
                const reply = response.text();

                // إرسال الرد إلى واتساب
                await sock.sendMessage(from, { text: reply });
            } catch (error) {
                console.error("خطأ في Gemini:", error);
                await sock.sendMessage(from, { text: "عذراً، حدث خطأ أثناء معالجة طلبك." });
            }
        }
    });
}

connectToWhatsApp();
