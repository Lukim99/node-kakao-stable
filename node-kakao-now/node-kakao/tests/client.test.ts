import * as http2 from 'http2';
import { AuthApiClient, TalkClient } from "../src";
import { LoginData } from "../src/api";

const config = {
    "agent": "android",
    "mccmnc": "45008",
    "deviceModel": "SM-T976N",
    "version": "9.2.1",
    "netType": 0
};
const client = new TalkClient(config);

main().then();

async function main() {
    let credential: LoginData = {} as any;
    const authClient = await AuthApiClient.create("test", "050fcb27838722ff38717f9908f627dbe42de6bd", "", config);

    const loginRes = await authClient.login({
        email: "79823418068",
        password: "dudmleh1203"
    });
    console.log(loginRes);

    if(!loginRes.success) {
        return;
    }
    credential = loginRes.result;

    const connRes = await client.login({
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken,
        deviceUUID: credential.deviceUUID,
        userId: credential.userId
    });
    console.log(connRes);

    if(connRes.success) {
        const headers = {
            Authorization: `${credential.accessToken}-${credential.deviceUUID}`,
            "Talk-Agent": "android/9.7.2",
            "Talk-Language": "ko",
            "Accept-Encoding": "gzip, deflage",
            "User-Agent": "okhttp/4.9.1"
        }
        startHttpPing(headers);
        startHttpListen(headers);
    }
}

const PILSNER_HOST = "https://talk-pilsner.kakao.com";

async function startHttpPing(headers: Record<string, string>) {
    const session = http2.connect(PILSNER_HOST);
    const req = session.request({ ":method": "GET", ":path": "/ping", ...headers });

    req.setEncoding('utf8');
    const data: any[] = [];
    req.on('data', (chunk) => {
        data.push(chunk);
    });
    req.end();
    req.on('end', () => {
        console.log(data.join(""));
    });
    setTimeout(() => startHttpPing(headers), 180_000);
}

async function startHttpListen(headers: Record<string, string>) {
    const session = http2.connect(PILSNER_HOST);
    const req = session.request({ ":method": "GET", ":path": "/listen", ...headers });

    req.setEncoding('utf8');
    const data: any[] = [];
    req.on('data', (chunk) => {
        data.push(chunk);
        console.log(chunk);
    });
    req.end();
    req.on('end', () => {
        console.log(data.join(""));
    });
    setTimeout(() => startHttpListen(headers), 120_000);
}
