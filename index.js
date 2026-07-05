const axios = require('axios');
const { Redis } = require('@upstash/redis');
require('dotenv').config();

// 初始化免費的線上 Database，用來跨越 GitHub Actions 關機限制保存記憶
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const showIncomingDateWithQuota = true;

async function checkLcsdOpenData() {
    console.log(`[${new Date().toLocaleTimeString()}] 開始檢查風帆名額...`);
    const apiUrl = 'https://data.smartplay.lcsd.gov.hk/rest/cms/api/v1/publ/contents/open-data/activity-prog/file';

    try {
        const response = await axios.get(apiUrl, {
            timeout: 5000, // 縮短到 5 秒，方便排查
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-HK,zh;q=0.9,en;q=0.8',
                'Origin': 'https://www.smartplay.lcsd.gov.hk',
                'Referer': 'https://www.smartplay.lcsd.gov.hk/'
            }
        });

        console.log("✅ Axios 請求成功！收到回應。");

        console.log('✅ API 請求完成，開始解析資料');
        const allActivities = response.data;
        console.log(`📦 API 回傳原始資料筆數: ${Array.isArray(allActivities) ? allActivities.length : '非陣列'}`);

        if (!Array.isArray(allActivities)) {
            console.warn('⚠️ API 回傳資料格式不正確，非陣列，結束本次檢查');
            return;
        }

        const currentDate = new Date();
        const currentDateOnly = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());

        // 1. 篩選風帆及日期邏輯
        const matchedActivities = allActivities.filter(act => {
            if (act.TC_ACT_TYPE_NAME !== '風帆') return false;

            const ballotEndDateText = act.BALLOT_END_DATE || '';
            const ballotEndDateMatch = ballotEndDateText.match(/(\d{4})-(\d{2})-(\d{2})/);
            const ballotEndDate = ballotEndDateMatch
                ? new Date(Number(ballotEndDateMatch[1]), Number(ballotEndDateMatch[2]) - 1, Number(ballotEndDateMatch[3]))
                : null;

            const isIncomingDate = ballotEndDate ? ballotEndDate < currentDateOnly : false;
            const remainingQuota = act.quotaRemaining !== undefined ? act.quotaRemaining : act.PLACES_LEFT;
            const hasRemainingPlaces = Number(remainingQuota) > 0;

            return !showIncomingDateWithQuota || (isIncomingDate && hasRemainingPlaces);
        });

        console.log(`🔎 篩選後的風帆活動筆數: ${matchedActivities.length}`);

        let newAlerts = [];
        let currentMatchedCodes = [];

        // 2. 核心比對邏輯：逐個活動查詢 Database
        for (const act of matchedActivities) {
            const code = act.ACTIVITY_NO;
            currentMatchedCodes.push(code);

            // 從雲端 Database 讀取上一次的狀態（如果之前通知過，會回傳 "true"）
            const hasNotifiedBefore = await redis.get(`lcsd:notified:${code}`);
            console.log(`   • 活動 ${code} (${act.TC_PGM_NAME}) 是否已通知過: ${hasNotifiedBefore ? '是' : '否'}`);

            if (!hasNotifiedBefore) {
                const remainingQuota = act.quotaRemaining !== undefined ? act.quotaRemaining : act.PLACES_LEFT;
                newAlerts.push(`⛵ *${act.TC_PGM_NAME}*\n🆔 Code: ${code}\n📍 地點: ${act.TC_VENUE}\n📊 剩餘名額: ${remainingQuota} 個\n📅 抽籤截止: ${act.BALLOT_END_DATE || '無'}\n---`);
                console.log(`   ✅ 新的通知活動: ${code}，剩餘名額 ${remainingQuota}`);

                // 【那一刻通知】將此活動在 Database 標記為 "true"，代表這一波已經通知過，下次不要再發
                // 設定過期時間為 7 天 (604800 秒)，防止 Database 塞爆
                await redis.set(`lcsd:notified:${code}`, "true", { ex: 604800 });
            }
        }

        if (matchedActivities.length === 0) {
            console.log('ℹ️ 本次沒有符合條件的風帆活動');
        }

        // 3. 發送整合後的 WhatsApp
        if (newAlerts.length > 0) {
            let messageHeader = `🌟 【康文署風帆班】發現新餘額！\n\n`;
            let messageBody = ``;
            for (const alertText of newAlerts) {
                if ((messageHeader + messageBody + alertText).length > 800) break;
                messageBody += alertText + '\n';
            }
            let finalMessage = messageHeader + messageBody + `\n🔗 快速報名: https://www.smartplay.lcsd.gov.hk/`;
            console.log(`📨 準備發送 WhatsApp，共 ${newAlerts.length} 則提醒，內容長度 ${finalMessage.length}`);
            await sendWhatsApp(finalMessage);
        } else {
            console.log('ℹ️ 本次無需發送 WhatsApp，沒有新提醒');
        }

        // 4. 清理 Database 狀態：如果之前有位的活動現在從 API 消失了（即名額被搶光，變回 0 位）
        // 我們就要從 Database 刪除它，這樣下一次它如果再次放位，Bot 才能再次觸發「那一刻通知」
        // 我們拿到所有在 Redis 記錄為有位的 keys 進行比對
        const allKeys = await redis.keys('lcsd:notified:*');
        console.log(`🧹 Redis 現有通知紀錄數: ${allKeys.length}`);
        let removedCount = 0;
        for (const key of allKeys) {
            const codeFromKey = key.replace('lcsd:notified:', '');
            // 如果 Database 裡說它有位，但今天 API 說它沒位了
            if (!currentMatchedCodes.includes(codeFromKey)) {
                await redis.del(key);
                removedCount += 1;
                console.log(`   ✂️ 已移除過期紀錄: ${codeFromKey}`);
            }
        }
        console.log(`✅ 清理完成，移除 ${removedCount} 筆過期 Redis 紀錄`);

    } catch (error) {
        console.error("❌ Axios 請求失敗！原因如下：");
        if (error.code === 'ECONNABORTED') {
            console.error("👉 錯誤原因：連線超時（Timeout）！康文署伺服器完全沒有回應，極有可能是 GitHub IP 被 LCSD 封鎖了。");
        } else if (error.response) {
            console.error(`👉 伺服器回應錯誤碼: ${error.response.status}`);
        } else {
            console.error(`👉 其他網絡錯誤: ${error.message}`);
        }
    }
}

async function sendWhatsApp(text) {
    const phone = process.env.PHONE_NUMBER;
    const apiKey = process.env.CALLMEBOT_API_KEY;
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;

    console.log(`📤 發送 WhatsApp 中，phone=${phone ? phone : '未設定'}`);

    try {
        const res = await axios.get(url);
        console.log(`📬 CallMeBot 回應狀態: ${res.status}`);
        if (res.status === 200) console.log('🚀 狀態變更！WhatsApp 提示已發送！');
        else console.warn('⚠️ WhatsApp 傳送完成但狀態非 200:', res.status);
    } catch (error) {
        console.error('❌ CallMeBot 傳送失敗:', error.message);
        if (error.response) {
            console.error('   HTTP 狀態:', error.response.status, '回傳內容:', error.response.data);
        }
    }
}

// 如果你用 GitHub Actions 定時執行，請把最底的 cron 刪除，讓它純粹執行一次：
checkLcsdOpenData();