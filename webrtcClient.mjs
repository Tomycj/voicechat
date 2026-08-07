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


let currentLanguage = document.documentElement.lang;


let peerConnection;
const iceCandidatesBufferSymbol = Symbol("iceCandidatesBuffer");
let dataChannel;

let succesfullyAnswering = false;

await handleMicrophoneAccess();

const wsSignaler = {
    socket: null,
    
    async createSocket() {

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        //const socket = new WebSocket("wss://" + SIGNALING_SV_HOSTNAME + `/${ssPwInput.value}`); // dirty: appears as the name of the request
        const socket = new WebSocket("wss://" + SIGNALING_SV_HOSTNAME, `${ssPwInput.value || "empty"}`); // dirty: send password as a protocol

        socket.onmessage = (ev)=> {
            try {
                const data = JSON.parse(ev.data); //Json string to object, or string if it's a string

                if (data.candidate) {
                    console.log("WS: ICE candidate received");

                    // before adding it, I need to wait until I set a remote description on the connection.
                    if (!peerConnection.remoteDescription) {
                        peerConnection[iceCandidatesBufferSymbol].buffer.push(data)
                    }
                    else {
                        peerConnection.addIceCandidate(data);
                    }

                }
                else if (data.description) {
                    console.log("WS: description received.");
                }
                else if (data === "peer-disconnected") {
                    disconnectButton.click();
                }
                else {
                    console.warn("WS: Unknown signal received:", ev.data)
                }

            } catch (error) {
                console.error(ev.data)
            }
        }

        socket.onclose = (ev)=> {
            msgButton.removeEventListener("click", clickWsHandler);
            console.log("WSS: Closed.");
        }

        function clickWsHandler() {
            console.warn("Not implemented!");
            //sendSignal("Hello by websocket!")
        }

        msgButton.onclick = clickWsHandler;


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

    sendSignal(data) {

        if (data.candidate) {
            console.log("WS: Sending ICE candidate.")
        }
        const dataString = JSON.stringify(data);
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(dataString);
        } else {
            console.error("web socket is not open, can't send signal:", dataString);
        }
    },
}

micSelector.addEventListener("change", replaceTrackIfConnected);


ssConnectButton.onclick = _=> {

    const password = ssPwInput.value;

    wsSignaler.createSocket()
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


connectButton.onclick = _=>{connectButtonHandler()}

disconnectButton.addEventListener("click", disconnectHandler);

msgButton.addEventListener("click", sendMsgOverDataChannel);


document.getElementById("language-switch").addEventListener("click", switchLanguage);

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

    function findMicsAndSelectVirtualOne() {
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
        
            const virtualMicOption = Array.from(micSelector.options).find(option => option.text === CHOSEN_MIC_LABEL);
            if (virtualMicOption) {virtualMicOption.selected = true};
        });
    }

    if (permissionStatus.state === "granted") {
        findMicsAndSelectVirtualOne();
        return;
    }
    else {

        navigator.mediaDevices.getUserMedia({ audio: true })
        .catch(err => {
            console.log(`${err.name}: ${err.message}`);
            micSelectorInfo.text = translations.micSelectorError[currentLanguage];
            micSelectorInfo.value = "error";
        });

        permissionStatus.onchange = _=>{
            if (permissionStatus.state === "granted") {
                findMicsAndSelectVirtualOne();
                return;
            }
            if (permissionStatus.state === "denied") {
                micSelectorInfo.text = translations.micSelectorError[currentLanguage];
                micSelectorInfo.value = "error";
            }
        }
    }
}


async function connectButtonHandler() {

    connectButton.disabled = true;
    disconnectButton.disabled = false;
    
    connectStatus.innerText = translations.connectStatusConnecting[currentLanguage];
    console.log("\nInitiating new connection...");

    await createNewConnection(true);

    const exchangeSuccessful = await exchangeSdps();
    //console.warn("SDPS EXCHANGED")

    if (!exchangeSuccessful) {
        connectStatus.innerText = translations.connectStatusFail[currentLanguage];;
        connectButton.disabled = false;
    }
}

async function createNewConnection() {

    peerConnection = new RTCPeerConnection();

    peerConnection[iceCandidatesBufferSymbol] = {
        buffer: [],
        addCandidates() {
            for (const candidate of this.buffer) {
                peerConnection.addIceCandidate(candidate);
            }
            this.buffer = []
        }
    }

    

    //if (wsSignaler) ???

    await addAudioTrack();
    //await wait()  //TODO: this makes it so that only 1 negotiation needed event fires, dunno why.
    

    /* A negotiated channel with the same ID is shared between peers, resulting in the creation of only 1 channel
        (as opposed to a sendchannel and a receivechannel)
    */
    dataChannel = peerConnection.createDataChannel("negotiated channel", {negotiated: true, id: 100});
    // setup data channel
    dataChannel.onopen = ()=> {
        console.log("Connection open!");
        connectStatus.innerText = translations.connectStatusSuccess[currentLanguage];
        disconnectButton.disabled = false;
    };
    dataChannel.onclose = ()=> console.log("Connection closed!");
    dataChannel.onmessage = (ev)=> {
        displayInfo(ev.data);
    }
    
    /*
        peerConnection.onnegotiationneeded = ()=> {
            // I think this also triggers when a localdescription is set
            //console.warn("Negotiation needed event triggered");
        }
    */
    /* when using a negotiated channel, this doesn't trigger
        peerConnection.ondatachannel = (ev)=> {
            console.warn("ondatachannel event triggered")
            dataChannel = ev.channel;
            setupDataChannel();
        }
    */
    peerConnection.ontrack = (ev)=> { //fires when a track is received, not when it's locally created.
        //console.warn("Track received.")
        const [stream] = ev.streams;

        const audioElement = document.createElement("audio");
        audioElement.srcObject = stream;
        audioElement.play();
    }
    
    peerConnection.onicecandidate = (ev) => {
        //console.warn("ICE CANDIDATE EVENT TRIGGERED")
        if (ev.candidate) {

            /*
                console.log("ICE CANDIDATE CREATED")
                document.getElementById('signaling').value += JSON.stringify(event.candidate, null, 4) + '\n';
        
                if (!succesfullyAnswering) { // don't send an ice candidate if I already got one from the server together with an offer.
                    postJsonToSignalingServer("RTCIceCandidate", event.candidate, "RTCIceCandidate successfully sent to server.");
                }
                else {
                    console.log("Ice candidate sending cancelled")
                    succesfullyAnswering = false;
                }
            */

            wsSignaler.sendSignal(ev.candidate);

        }
        else if (ev.candidate === null) {
            console.log("ICE candidate gathering complete.");
        }
        else (console.warn("icecandidate event fired but no candidate was included"));
    };
    /* Doesn't trigger when the connection is closed the way I'm closing it.
        localConnection.onconnectionstatechange = (ev) => {
            if (localConnection.connectionState === "connected") {
                console.log("CONNECTION STATE IS NOW CONNECTED")
            }
            if (localConnection.connectionState === "closed") {
                console.log("CONNECTION STATE IS NOW CLOSED")
            }
            if (localConnection.connectionState === "disconnected") {
                console.log("CONNECTION STATE IS NOW DISCONNECTED")
            }
        }
    */
}
async function exchangeSdps(forceSend = false) {

    const findOfferAttempt = await tryFindingOffer();
    if (findOfferAttempt === "success") {
        return true;
    }
    else if (findOfferAttempt === "failure") {
        
        console.log("\nNo offer found in signaling server. Sending new offer...");
        connectStatus.innerText = translations.connectStatusAwaiting[currentLanguage];

        const sendOfferAttempt = await trySendingOffer();

        if (sendOfferAttempt === "success") {
            return true;
        }
    }
    return false;
}

async function tryFindingOffer() {

    //somewhere here a negotiation needed event triggers. Why?
    const description = await getJsonFromSignalingSv("/RTCSessionDescription");

    if (description === null) {
        console.log("Could not get session description.");
        return "failure";
    }

    /*
        const candidate = await getJsonFromSignalingSv("RTCIceCandidate");
        if (candidate === null) {
            console.log("Could not get ICE candidate.");
            return "failure";
        }
    */

    await peerConnection.setRemoteDescription(description);
   
    peerConnection[iceCandidatesBufferSymbol].addCandidates();

    //succesfullyAnswering = true;

    await peerConnection.setLocalDescription(); // sets an automatically created answer

    
    // further attempts at immediately seting a local description fail because the signaling state is already set to stable.

    await postJsonToSignalingServer("/RTCSessionDescription-answer", peerConnection.localDescription, "Answer successfully sent to server.");
    return "success";
}
async function trySendingOffer() {

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);  //this triggers an icecandidate event
    //document.getElementById('signaling').value += JSON.stringify(peerConnection.localDescription, null, 4) + '\n';

    console.log("RTCSessionDescription: Awaiting answer to posted offer...");
    const response = await postJsonToSignalingServer("/RTCSessionDescription", peerConnection.localDescription, "Answer to offer received.")
    
    if (response.status === 200) {
        const answer = await response.json();
        await peerConnection.setRemoteDescription(answer);
        peerConnection[iceCandidatesBufferSymbol].addCandidates();
        console.log("Answer set as remote description.");
        return "success";
    }
    else if (response.status === 409){
        console.warn("Connection offer not uploaded: An RTCSessionDescription is probably already stored in the server.");
    }
    return "failure";
    
}


function replaceTrackIfConnected() {
    if (dataChannel?.readyState !== "open") {return;}

    getAudioStream()
    .then(stream => {
        peerConnection.getSenders()[0].replaceTrack(stream.getTracks()[0]);
        console.log("Track changed.");
    });
}



function disconnectHandler() {
    if (!peerConnection) {
        return;
    }
    peerConnection.close();
    peerConnection = null;

    connectStatus.innerText = dataChannel.readyState === "open" ? translations.connectStatusClosed[currentLanguage] : "";
    
    connectButton.disabled = false;

    micSelector.disabled = false;
    disconnectButton.disabled = true;
}

function sendMsgOverDataChannel() {

    if (dataChannel?.readyState !== "open") {
        displayInfo(translations.sendMsgFail[currentLanguage]);
        return;
    };

    displayInfo(translations.sendMsgSuccess[currentLanguage]);
    dataChannel.send(translations.sendMsgText[currentLanguage]);
}

async function addAudioTrack() {

    const audioStream = await getAudioStream();

    //console.log(audioStream.getTracks()[0].getSettings())
    //console.log(audioStream.getTracks()[0].getCapabilities())

    audioStream.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, audioStream);
        console.log("Audio track added to peer connection.");
    })
}

async function postJsonToSignalingServer(subdirectory, jsonData, successMsg) {
    
    return fetch(SIGNALING_SV_URL + subdirectory, {
        method: "POST",
        body: JSON.stringify(jsonData),
        headers: {
            "Content-type": "application/json",
            [`password-${ssPwInput.value}`]: ssPwInput.value
        }
    })
    .then(response=> {

        if (response.status === 200) {
            console.log(`${subdirectory}: ${successMsg}`);
            return response;
        }
        else if (response.status === 204) {return null;}
        else if (response.status === 409) {return null;}
        return response;
    })
}

async function getJsonFromSignalingSv(subdirectory) {

    return fetch(SIGNALING_SV_URL + subdirectory, {
        method: "GET",
        headers: {
            "Content-type": "application/json",
            [`password-${ssPwInput.value}`]: ssPwInput.value
        }
    })
    .then(response => {
        if (response.status === 200) return response.json();
        else if (response.status === 204) return null;
        else if (response.status === 409) return null;
    });
}


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
