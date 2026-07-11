const node_kakao = require('node-kakao');
const fs = require('fs');
const keepAlive = require('./server.js');
const { TalkClient, AuthApiClient, xvc, KnownAuthStatusCode, util, AttachmentApi } = require("node-kakao");

const DEVICE_TYPE = "tablet";
let DEVICE_UUID = "";
const DEVICE_NAME = "Hello";
const EMAIL = '';
const PASSWORD = '';
let client = new node_kakao.TalkClient();

function read(path) {
    try {
      var data = fs.readFileSync(path, 'utf8');
    } catch(e) {
      var data = null;
    }
    return data;
}
function save(path, data) {
    fs.writeFileSync(path, data, 'utf8');
    return data;
}

function pad_num(kor, max_len) {
    if (typeof kor != 'string') kor = kor.toString();
    max_len = max_len || 2;
    if(kor.length >= max_len)
        return kor;
    return (new Array(max_len - kor.length + 1).join("0")) + kor;
}

Date.prototype.toYYYYMMDD = function() {
    return this.getFullYear() + "-" + pad_num(this.getMonth() + 1) + "-" + pad_num(this.getDate());
}

Date.prototype.toYYMMDD = function() {
    return this.getFullYear().toString().slice(-2) + "." + pad_num(this.getMonth() + 1) + "." + pad_num(this.getDate());
}

function getKoreanTime() {
    const curr = new Date();
    const utc = curr.getTime() + (curr.getTimezoneOffset() * 60 * 1000);
    const korea = new Date(utc + (3600000 * 9));
    return korea;
}

Number.prototype.toComma = function() {
    return this.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

Date.prototype.toDateString = function(showYear = true, showTime = true) {
    let y = this.getFullYear();
    let m = this.getMonth() + 1;
    let d = this.getDate();
    let yo = "일월화수목금토"[this.getDay()];
    let h = this.getHours();
    let ampm = h >= 12 ? "오후" : "오전";
    if (h > 12) h -= 12;
    if (h == 0) h = 12;
    let minutes = this.getMinutes();
    let sec = this.getSeconds();
    return `${showYear ? `${y}년 ` : ""}${m}월 ${d}일(${yo})${showTime ? ` ${ampm} ${pad_num(h.toString(), 2)}:${pad_num(minutes.toString(), 2)}:${pad_num(sec.toString(), 2)}` : ""}`;
}

client.on('error', (err) => {
    console.log(`클라이언트 에러 발생\n오류: ${err.stack}`);
});

client.on('disconnected', (reason) => {
    console.log(`연결이 끊어졌습니다.\n사유: ${reason}`);
});

client.on('user_join', async (joinLog, channel, user, feed) => {
    let user_data = read(`data/${user.userId}.json`);
    if (user_data) user_data = JSON.parse(user_data);
    if (user_data) {
        channel.sendChat(`${user.nickname}님, ${user_data.count}번째 들어오셨군요!\n\n[ 이전 입/퇴장 로그 ]${Array(500).join('\u200b')}\n${user_data.log.map(log => `· [${log.type}] ${log.name} ㅡ ` + new Date(log.date).toDateString() + `\n`).join("\n")}`);
    } else {
        channel.sendChat(`${user.nickname}님, 첫 번째 입장을 환영합니다!`);
    }
    if (!user_data || !user_data.log) user_data = { log: [], count: 0 };
    user_data.count++;
    user_data.log.push({
        type: "입장",
        name: user.nickname,
        date: getKoreanTime().toString()
    });
    save(`data/${user.userId}.json`, JSON.stringify(user_data, null, 2));
});
  
client.on('user_left', async (leftLog, channel, user, feed) => {
    let user_data = read(`data/${user.userId}.json`);
    if (user_data) user_data = JSON.parse(user_data);
    const kicker = channel.getUserInfo(leftLog.sender);
    if (!user_data || !user_data.log) user_data = { log: [], count: 0 };
    user_data.log.push({
        type: (kicker ? `강퇴 by ${kicker.nickname}` : "퇴장"),
        name: user.nickname,
        date: getKoreanTime().toString()
    });
    save(`data/${user.userId}.json`, JSON.stringify(user_data, null, 2));
});

async function registerDevice(authClient) {
    let requestData = await authClient.requestPasscode({"email": EMAIL, "password": PASSWORD, "forced": true});
    if (!requestData.success) {
    return {"success": false, "message": `보안코드 요청 실패! 데이터: ${JSON.stringify(requestData, null, 2)}`};
    } else {
        let readline = require("readline");
        let inputInterface = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        let passcode = await new Promise((resolve) => inputInterface.question("보안코드 입력: ", resolve));
        inputInterface.close();
        let registerData = await authClient.registerDevice({"email": EMAIL, "password": PASSWORD, "forced": true}, passcode, true);
        if (!registerData.success) {
            return {"success": false, "message": `기기등록 실패! 데이터: ${JSON.stringify(registerData, null, 2)}`};
        }
        return {"success": true};
    }
}

async function login() {
    let config = { countryIso: "KR", language: "ko" };
    if (DEVICE_UUID === "") {
        if (DEVICE_TYPE === "pc") {
            DEVICE_UUID = util.randomWin32DeviceUUID();
        }
        if (DEVICE_TYPE === "tablet") {
            DEVICE_UUID = util.randomAndroidSubDeviceUUID();
        }
        console.log(`uuid: ${DEVICE_UUID}`);
    }
    let authClient = await AuthApiClient.create(DEVICE_NAME, DEVICE_UUID, config, xvc.AndroidSubXVCProvider);
    let loginData = await authClient.login({"email": EMAIL, "password": PASSWORD, "forced": true});
    if (!loginData.success) {
        if (loginData.status === KnownAuthStatusCode.DEVICE_NOT_REGISTERED) {
            let result = await registerDevice(authClient);
            if (!result.success) {
                console.log(result.message);
            } else {
                login();
            }
        } else {
            console.log(`로그인 실패! 데이터: ${JSON.stringify(loginData, null, 2)}`);
        }
    } else {
        let loginRes = await client.login(loginData.result);
        if (!loginRes.success) {
            console.log(`로그인 실패! 로그인 결과: ${JSON.stringify(loginRes, null, 2)}`);
        } else {
            token = `${loginData.result.accessToken}-${loginData.result.deviceUUID}`;
            console.log(`로그인 성공!`);
        }
    }
}

keepAlive();
login().then();