"use strict"
import translations from "./translations.mjs";

const SIGNALING_SV_HOSTNAME = "tomycj.ddnsfree.com";
const SIGNALING_SV_URL = "https://" + SIGNALING_SV_HOSTNAME; //window.location.href

const CHOSEN_MIC_LABEL = "Micrófono (VB-Audio Virtual Cable)";


const micSelector = document.getElementById("microphone-selector");
const micSelectorInfo = micSelector.querySelector("#selector-options-info");

const ssConnectButton = document.getElementById("ss-connect");
const ssPwInput = document.getElementById("ss-pw");

const connectButton = document.getElementById("connect-button");
const disconnectButton = document.getElementById("disconnect");
const connectStatus = document.getElementById("connect-status");

const msgButton = document.getElementById("message-button");

const display = document.getElementById("info-msg");

const remoteAudioElement = document.getElementById("remote-audio");


let currentLanguage = document.documentElement.lang;

/** @type {RTCPeerConnection} */
let peerConnection;
/** @type {MediaStream} */
let localStream;

/*
    if ("serviceWorker" in navigator) {
        
        navigator.serviceWorker.register("/service-worker.mjs")
        .then((registration) => {
            console.log("Service Worker registered with scope:", registration.scope);
        })
        .catch((error) => {
            console.error("Service Worker registration failed:", error);
        });
    }
*/



async function handleMicrophoneAccess() {

    const permissionStatus = await navigator.permissions.query({name: "microphone"});

    console.log("Permission status is", permissionStatus.state)

    function populateMicrophonesList() {
        navigator.mediaDevices.enumerateDevices()
        .then(devices => {
    
            const audioInputs = devices.filter(device => device.kind === "audioinput");
        
            if (audioInputs.length === 0) {
                micSelectorInfo.text = translations.micSelectorEmpty[currentLanguage];
                micSelectorInfo.value = "empty";
                return;
            }

            micSelectorInfo.remove();
            micSelectorInfo.value = null;

            for (const audioInput of audioInputs) {
                const option = document.createElement("option");
                option.text = audioInput.label || "Unlabeled audio device";
                option.value = audioInput.deviceId;
                micSelector.appendChild(option);
            }
        
            //const virtualMicOption = Array.from(micSelector.options).find(option => option.text === CHOSEN_MIC_LABEL);
            //if (virtualMicOption) {virtualMicOption.selected = true};
        });
    }

    if (permissionStatus.state === "granted") {
        populateMicrophonesList();
        return;
    }
    else {

        permissionStatus.onchange = _=>{

            console.log("Permission status is", permissionStatus.state)

            if (permissionStatus.state === "granted") {
                populateMicrophonesList();
                return;
            }
            if (permissionStatus.state === "denied") {
                micSelectorInfo.text = translations.micSelectorError[currentLanguage];
                micSelectorInfo.value = "error";
            }
        }

        navigator.mediaDevices.getUserMedia({ audio: true })
        .catch(err => {
            console.log(`${err.name}: ${err.message}`);
            micSelectorInfo.text = translations.micSelectorError[currentLanguage];
            micSelectorInfo.value = "error";
        });

    }
}

await handleMicrophoneAccess();


const signaling = {
    /** @type {WebSocket} */
    socket: null,
    
    async initialize() {

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        //const socket = new WebSocket("wss://" + SIGNALING_SV_HOSTNAME + `/${ssPwInput.value}`); // dirty: appears as the name of the request
        const socket = new WebSocket("wss://" + SIGNALING_SV_HOSTNAME, `${ssPwInput.value || "empty"}`); // dirty: send password as a protocol

        socket.onmessage = (ev)=> {

            if (!localStream) {
                console.warn("Message ignored. I'm not ready yet.")
                return;
            }

            const message = JSON.parse(ev.data);

            switch (message.type) {
                case "offer":
                    console.log("SDP: offer received")
                    handleOffer(message.content);
                break;
                
                case "answer":
                    console.log("SDP: answer received")
                    handleAnswer(message.content);
                break;
                
                case "candidate":
                    handleCandidate(message.content);
                break;

                case "ready":
                    // we both are ready
                    if (peerConnection) {
                        console.log("Already in call, ignored.");
                        return;
                    }
                    makeCall();
                break
                
                case "bye":
                    if (peerConnection) hangup();
                break;

                default:
                    console.warn("Unknown message:", message);
                break;
            }

        }

        socket.onclose = (ev)=> {
            console.log("WSS: Closed.");
        }

        return new Promise((resolve, reject) => {
            
            socket.onopen = ()=> {
                console.log("WS: Connected.");
                displayInfo("Conectado al servidor!");
                this.socket = socket;
                resolve();
            };

            socket.onerror = (ev)=>{
                displayInfo("No se pudo conectar al servidor. Revisar la contraseña!");
                reject("handled");
            };

        })

    },

    /** Sends the data stringifying the message object */
    sendMessage(message) {

        //if (message.candidate) console.log("WS: Sending ICE candidate.");
        const messageString = JSON.stringify(message);
        
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(messageString);
        } else {
            console.error("web socket is not open, can't send signal:", messageString);
        }
    },
}


micSelector.addEventListener("change", async _=> {

    if (!peerConnection) return;

    const newStream = await getAudioStream();

    peerConnection.getSenders()[0].replaceTrack(newStream.getTracks()[0]);
    console.log("Track changed.");

});

ssConnectButton.onclick = _=> {

    const password = ssPwInput.value;

    signaling.initialize()
    .then(()=>{
        document.getElementById("call-controls").hidden = false;
        document.getElementById("ss-controls").hidden = true;
    })
    .catch((err)=>{
        if (err !== "handled") {
            console.error(err)
            displayInfo("Error inesperado!");
        }
    })
}

connectButton.onclick = async _=> {

    localStream = await getAudioStream();
    
    connectButton.disabled = true;
    disconnectButton.disabled = false;
    
    connectStatus.innerText = translations.connectStatusConnecting[currentLanguage];
    
    signaling.sendMessage({type: "ready"});
};

disconnectButton.onclick = _=> {
    hangup();
    signaling.sendMessage({type: "bye"});
};

msgButton.onclick = _=>{ };

document.getElementById("language-switch").addEventListener("click", switchLanguage);



/** @returns true but vscode doesn't know it */
function indeterminizer() {return true;}

async function handleOffer(offer) {
    // offer here is the sdp string.

    if (peerConnection && indeterminizer()) {
        console.error("peerConnection already present.");
        return;
    }

    await createPeerConnection();

    await peerConnection.setRemoteDescription({type: "offer", sdp: offer});
    console.log("_SDP: Remote description SET from offer");

    const answer = await peerConnection.createAnswer();
    signaling.sendMessage({type: "answer", content: answer.sdp});
    console.log("_SDP: Answer created and sent");

    await peerConnection.setLocalDescription(answer);
    console.log("_SDP: Local description SET from answer");
}

async function handleAnswer(answer) {
    if (!peerConnection && indeterminizer()) {
        console.error("No peerConnection");
        return;
    }
    await peerConnection.setRemoteDescription({type: "answer", sdp: answer});
    console.log("_SDP: Remote description SET from received answer");
}

async function handleCandidate(candidate) {
    if (!peerConnection && indeterminizer()) {
        console.error("No peerConnection");
        return;
    }

    if (candidate === "") {
        console.log("ICE: message received: a transport ran out of proposals")
        await peerConnection.addIceCandidate(null);
    }
    else if (candidate) {
        console.log("ICE: message received: Received candidate and added to the remote description!")
        await peerConnection.addIceCandidate(candidate)
    }
    else {
        console.error("Unexpected candidate format:", candidate);
    }
}

async function makeCall() {
    await createPeerConnection();
    const offer = await peerConnection.createOffer();
	signaling.sendMessage({type: "offer", content: offer.sdp});
    console.log("SDP: Offer created and sent");
	await peerConnection.setLocalDescription(offer);
    console.log("SDP: Local description SET from offer");
}

async function hangup() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    localStream.getTracks().forEach(track=>track.stop());
    localStream = null;
    connectButton.disabled = false;
    disconnectButton.disabled = true;
}

async function createPeerConnection() {

    peerConnection = new RTCPeerConnection();

    peerConnection.onicecandidate = (ev) => {
        if (ev.candidate !== null) {
            signaling.sendMessage({type: "candidate", content: ev.candidate});
        }

        // debug
		if (ev.candidate === null) {
			//console.log("ICE: sending message: All transports have finished gathering. iceGatheringState is now complete.");
		}
		else if (ev.candidate === "") {
			console.log("ICE: sending message: A transport has run out of proposals")
		}
		else {
			console.log("ICE: sending message with candidate (localDescription is set, and the candidate has been added to it)")
		}
    };

    peerConnection.ontrack = (ev)=> {
        remoteAudioElement.srcObject = ev.streams[0];
        //remoteAudioElement.play(); // should be autoplay
        console.log("[Peer Connection] Received a track. Added its stream to the remote audio.")
    }
    
    console.log("Peer connection created");


    const audioStream = await getAudioStream();
    audioStream.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, audioStream);
        console.log("[Peer Connection] Audio track added.");
    });
}


/** Get audio from user-selected microphone */
async function getAudioStream() {

    return navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: micSelector.value ? {exact: micSelector.value} : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1, //doesn't seem to work, still results in 2.
            //latency: //in seconds. Default = 0.01
            sampleRate: 8000,//audio samples per second. cd=44.1k (def), digital=48k, mastering=96k, hd=192k. can go as low as 8k for voice, 11025-22050 for music.
            sampleSize: 8,//bits per sample, per audio channel. Normal: 16 (def). lq=8, hq=24
        }
    });
}


function displayInfo(msg) {
    display.innerText = msg;

    const animation = display.getAnimations()[0];
    animation.cancel();
    animation.play();
}

function switchLanguage() {

    const lang = currentLanguage === "es" ? "en" : "es";

    if      (micSelectorInfo.value === "error") micSelectorInfo.text = translations.micSelectorError[lang];
    else if (micSelectorInfo.value === "empty") micSelectorInfo.text = translations.micSelectorEmpty[lang];
    else if (micSelectorInfo.value === "info")  micSelectorInfo.text = translations.micSelectorInfo[lang];

    document.getElementById("mic-selector-label").innerText = translations.audioInputLabel[lang];

    connectButton.innerText = translations.connectButton[lang];

    disconnectButton.innerText = translations.disconnectButton[lang];
    connectStatus.innerText = ""; //TODO:
    msgButton.innerText = translations.msgButton[lang];
    currentLanguage = lang;
    document.documentElement.lang = lang;
}

async function wait() {
    console.log("Awaiting for 1 second...")
    return new Promise((resolve, reject)=>{
        setTimeout(resolve,1000)
    })
}


fetch(SIGNALING_SV_URL + "/ping")
.then(res=>res.text())
.then(txt=>{
    console.log("Successfully pinged signaling server!");
    displayInfo(txt);
})
