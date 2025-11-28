const axios = require("axios");

const BASE_URL = "http://localhost:3002/api/chat";

async function testEditOrder() {
    console.log("🚀 STARTING EDIT ORDER TEST 🚀");

    try {
        // 1. Create Chat
        const createRes = await axios.post(`${BASE_URL}/create`);
        const chatToken = createRes.data.chatToken;
        console.log(`Chat created: ${chatToken}`);

        // 2. Insert Message 1 (User)
        console.log("Inserting Message 1...");
        const msg1Res = await axios.post(`${BASE_URL}/insert/${chatToken}/historico`, {
            text: "Message 1 (Original)",
            role: "user"
        });
        const msg1Id = msg1Res.data.messageid;

        // Sleep to ensure different timestamps if resolution is low (though Date.now() is ms)
        await new Promise(r => setTimeout(r, 100));

        // 3. Insert Message 2 (Model)
        console.log("Inserting Message 2...");
        await axios.post(`${BASE_URL}/insert/${chatToken}/historico`, {
            text: "Message 2",
            role: "model"
        });

        // 4. Verify initial order
        let historyRes = await axios.get(`${BASE_URL}/${chatToken}/history`);
        let history = historyRes.data;
        console.log("Initial History Order:");
        history.forEach((msg, i) => console.log(`[${i}] ${msg.text} (${msg.role})`));

        if (history[0].messageid !== msg1Id) {
            throw new Error("Initial order is wrong!");
        }

        // 5. Edit Message 1
        console.log("Editing Message 1...");
        await axios.put(`${BASE_URL}/edit/${chatToken}/${msg1Id}`, {
            newContent: "Message 1 (Edited)"
        });

        // 6. Verify order after edit
        historyRes = await axios.get(`${BASE_URL}/${chatToken}/history`);
        history = historyRes.data;
        console.log("History Order After Edit:");
        history.forEach((msg, i) => console.log(`[${i}] ${msg.text} (${msg.role})`));

        if (history[0].messageid !== msg1Id) {
            console.error("❌ FAILURE: Message 1 moved from position 0!");
            console.error(`Expected ID at 0: ${msg1Id}, Found: ${history[0].messageid}`);
            process.exit(1);
        } else {
            console.log("✅ SUCCESS: Message 1 remained at position 0.");
        }

    } catch (error) {
        console.error("❌ Error:", error.message);
        if (error.response) console.error(error.response.data);
        process.exit(1);
    }
}

testEditOrder();
